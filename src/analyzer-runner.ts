import { createHash } from "node:crypto";
import { contentHash } from "./canonical.ts";
import type { AnalysisLane } from "./benchmark.ts";

export const PRODUCTION_ANALYZER_MODEL = "gemini-3.8-flash";
export const PRODUCTION_ANALYZER_LANE: AnalysisLane = "hybrid_agentic";

export type DeterministicProbeKind = "media_probe" | "scene_detection" | "audio_probe" | "ocr" | "frame_cadence";

export interface DeterministicAnalysisEvidence {
  schemaVersion: "0.1.0";
  sourceAssetId: string;
  sourceContentSha256: string;
  normalizedContentSha256: string;
  durationMs: number;
  normalizedFps: number;
  originalOffsetMs: number;
  probes: Array<{ kind: DeterministicProbeKind; artifactSha256: string }>;
}

export interface AnalysisExecutionUnit {
  id: string;
  lane: AnalysisLane;
  repeat: number;
  exactModel: typeof PRODUCTION_ANALYZER_MODEL;
  mode: "static" | "agentic";
  samplingFps?: 5 | 10;
  prompt: string;
  promptSha256: string;
  promptVersion: string;
  sourceAssetId: string;
  sourceContentSha256: string;
  normalizedContentSha256: string;
  deterministicEvidenceHash: string;
  idempotencyKey: string;
}

export interface AnalyzerProviderResult {
  providerRunId: string;
  interactionId?: string;
  exactModel: string;
  mode: "static" | "agentic";
  samplingFps?: number;
  rawPayload: Uint8Array;
  structuredPayload: unknown;
  summary: string;
  summaryTruncated: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolUseTokens: number;
  processingCalls: number;
  costUsd: number;
}

export interface AnalyzerProvider {
  analyze(unit: AnalysisExecutionUnit): Promise<AnalyzerProviderResult>;
}

export interface AnalysisArtifactStore {
  putIfAbsent(input: { id: string; bytes: Uint8Array; sha256: string; provenance: string }): Promise<void>;
}

export interface AnalysisRunRecord {
  unitId: string;
  unitHash: string;
  status: "running" | "succeeded" | "failed";
  providerRunId?: string;
  failureReason?: string;
  rawPayloadArtifactId?: string;
  rawPayloadSha256?: string;
  structuredPayloadArtifactId?: string;
  structuredPayloadSha256?: string;
  completedResult?: CompletedAnalysisRun;
}

export interface AnalysisRunLedger {
  get(unitId: string): Promise<AnalysisRunRecord | undefined>;
  create(record: AnalysisRunRecord): Promise<void>;
  replace(record: AnalysisRunRecord): Promise<void>;
}

export interface CompletedAnalysisRun {
  schemaVersion: "0.1.0";
  unitId: string;
  unitHash: string;
  lane: AnalysisLane;
  repeat: number;
  providerRunId: string;
  interactionId?: string;
  exactModel: typeof PRODUCTION_ANALYZER_MODEL;
  mode: "static" | "agentic";
  samplingFps?: 5 | 10;
  promptSha256: string;
  promptVersion: string;
  sourceContentSha256: string;
  normalizedContentSha256: string;
  deterministicEvidenceHash: string;
  rawPayloadArtifactId: string;
  rawPayloadSha256: string;
  structuredPayloadArtifactId: string;
  structuredPayloadSha256: string;
  summary: string;
  summaryTruncated: boolean;
  latencyMs: number;
  totalTokens: number;
  costUsd: number;
  processingCalls: number;
  eligibleForMapMaterialization: boolean;
  mayDrivePaidGeneration: false;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertSha256(value: string, name: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${name} must be a lowercase SHA-256 hash`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function assertDeterministicAnalysisEvidence(evidence: DeterministicAnalysisEvidence): void {
  assert(evidence.schemaVersion === "0.1.0", "unsupported deterministic evidence version");
  assert(evidence.sourceAssetId.trim().length > 0, "sourceAssetId is required");
  assertSha256(evidence.sourceContentSha256, "sourceContentSha256");
  assertSha256(evidence.normalizedContentSha256, "normalizedContentSha256");
  assert(Number.isInteger(evidence.durationMs) && evidence.durationMs > 0 && evidence.durationMs <= 30_000, "durationMs must be 1-30000");
  assert(Number.isFinite(evidence.normalizedFps) && evidence.normalizedFps > 0, "normalizedFps must be positive");
  assert(Number.isInteger(evidence.originalOffsetMs) && evidence.originalOffsetMs >= 0, "originalOffsetMs must be non-negative");
  const kinds = new Set(evidence.probes.map((probe) => probe.kind));
  for (const probe of evidence.probes) assertSha256(probe.artifactSha256, `${probe.kind} artifactSha256`);
  for (const required of ["media_probe", "scene_detection", "audio_probe", "frame_cadence"] as const) {
    assert(kinds.has(required), `deterministic evidence requires ${required}`);
  }
}

export function prepareBenchmarkAnalysisPlan(input: {
  evidence: DeterministicAnalysisEvidence;
  prompt: string;
  promptVersion: string;
  repeats?: number;
  orderingSeed: string;
}): AnalysisExecutionUnit[] {
  assertDeterministicAnalysisEvidence(input.evidence);
  assert(input.prompt.trim().length > 0, "analysis prompt is required");
  assert(input.promptVersion.trim().length > 0, "promptVersion is required");
  const repeats = input.repeats ?? 3;
  assert(Number.isInteger(repeats) && repeats >= 3, "benchmark requires at least three repeats");
  assert(input.orderingSeed.trim().length > 0, "orderingSeed is required");
  const evidenceHash = contentHash(input.evidence);
  const lanes: Array<Pick<AnalysisExecutionUnit, "lane" | "mode" | "samplingFps">> = [
    { lane: "static_default", mode: "static" },
    { lane: "static_5fps", mode: "static", samplingFps: 5 },
    { lane: "static_10fps", mode: "static", samplingFps: 10 },
    { lane: PRODUCTION_ANALYZER_LANE, mode: "agentic" },
  ];
  const units = lanes.flatMap((lane) => Array.from({ length: repeats }, (_, index) => {
    const repeat = index + 1;
    const identity: Pick<AnalysisExecutionUnit, "lane" | "repeat" | "exactModel" | "promptSha256" | "promptVersion" | "sourceAssetId" | "sourceContentSha256" | "normalizedContentSha256" | "deterministicEvidenceHash"> = {
      lane: lane.lane,
      repeat,
      exactModel: PRODUCTION_ANALYZER_MODEL,
      promptSha256: sha256(utf8(input.prompt)),
      promptVersion: input.promptVersion,
      sourceAssetId: input.evidence.sourceAssetId,
      sourceContentSha256: input.evidence.sourceContentSha256,
      normalizedContentSha256: input.evidence.normalizedContentSha256,
      deterministicEvidenceHash: evidenceHash,
    };
    const id = `analysis-${contentHash(identity).slice(0, 24)}`;
    return {
      ...identity,
      id,
      mode: lane.mode,
      ...(lane.samplingFps === undefined ? {} : { samplingFps: lane.samplingFps }),
      prompt: input.prompt,
      idempotencyKey: contentHash({ id, identity }),
    };
  }));
  return units.sort((left, right) => contentHash({ seed: input.orderingSeed, id: left.id }).localeCompare(contentHash({ seed: input.orderingSeed, id: right.id })));
}

export function prepareProductionAnalysis(input: {
  evidence: DeterministicAnalysisEvidence;
  prompt: string;
  promptVersion: string;
}): AnalysisExecutionUnit {
  const [unit] = prepareBenchmarkAnalysisPlan({ ...input, repeats: 3, orderingSeed: "production" })
    .filter((candidate) => candidate.lane === PRODUCTION_ANALYZER_LANE && candidate.repeat === 1);
  return unit!;
}

function validateProviderResult(unit: AnalysisExecutionUnit, result: AnalyzerProviderResult): void {
  assert(result.providerRunId.trim().length > 0, "providerRunId is required");
  assert(result.exactModel === unit.exactModel, "provider returned a different model");
  assert(result.mode === unit.mode, "provider returned a different analysis mode");
  assert(result.samplingFps === unit.samplingFps, "provider returned a different sampling rate");
  assert(result.rawPayload.byteLength > 0, "lossless raw provider payload is required");
  assert(result.structuredPayload !== null && typeof result.structuredPayload === "object", "structured provider payload is required");
  for (const [name, value] of Object.entries({
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    thoughtTokens: result.thoughtTokens,
    toolUseTokens: result.toolUseTokens,
    processingCalls: result.processingCalls,
    costUsd: result.costUsd,
  })) assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${name} must be finite and non-negative`);
}

function validateExecutionUnit(unit: AnalysisExecutionUnit): void {
  assert(unit.exactModel === PRODUCTION_ANALYZER_MODEL, "analysis unit must use the pinned production model");
  assert(unit.prompt.trim().length > 0 && unit.promptVersion.trim().length > 0, "analysis unit requires prompt and version");
  assert(unit.promptSha256 === sha256(utf8(unit.prompt)), "analysis prompt hash does not match prompt bytes");
  assertSha256(unit.sourceContentSha256, "analysis sourceContentSha256");
  assertSha256(unit.normalizedContentSha256, "analysis normalizedContentSha256");
  assertSha256(unit.deterministicEvidenceHash, "analysis deterministicEvidenceHash");
  assertSha256(unit.idempotencyKey, "analysis idempotencyKey");
  assert(Number.isInteger(unit.repeat) && unit.repeat >= 1, "analysis repeat must be positive");
  if (unit.lane === "hybrid_agentic") {
    assert(unit.mode === "agentic" && unit.samplingFps === undefined, "production lane must use Agentic Video without static sampling");
  } else {
    assert(unit.mode === "static", "static benchmark lane must use static mode");
    if (unit.lane === "static_default") assert(unit.samplingFps === undefined, "static_default cannot force a sampling rate");
    if (unit.lane === "static_5fps") assert(unit.samplingFps === 5, "static_5fps must request 5 FPS");
    if (unit.lane === "static_10fps") assert(unit.samplingFps === 10, "static_10fps must request 10 FPS");
  }
}

export class AnalysisRunner {
  private readonly provider: AnalyzerProvider;
  private readonly artifacts: AnalysisArtifactStore;
  private readonly ledger: AnalysisRunLedger;

  constructor(
    provider: AnalyzerProvider,
    artifacts: AnalysisArtifactStore,
    ledger: AnalysisRunLedger,
  ) {
    this.provider = provider;
    this.artifacts = artifacts;
    this.ledger = ledger;
  }

  async run(unit: AnalysisExecutionUnit): Promise<CompletedAnalysisRun> {
    validateExecutionUnit(unit);
    const unitHash = contentHash(unit);
    const existing = await this.ledger.get(unit.id);
    if (existing !== undefined) {
      assert(existing.unitHash === unitHash, "analysis unit id was reused with different content");
      if (existing.status === "succeeded" && existing.completedResult !== undefined) return existing.completedResult;
      throw new Error(`analysis unit ${unit.id} is already ${existing.status}; reconcile instead of resubmitting`);
    }
    await this.ledger.create({ unitId: unit.id, unitHash, status: "running" });
    try {
      const providerResult = await this.provider.analyze(unit);
      validateProviderResult(unit, providerResult);
      const rawPayloadSha256 = sha256(providerResult.rawPayload);
      const structuredBytes = utf8(JSON.stringify(providerResult.structuredPayload));
      const structuredPayloadSha256 = sha256(structuredBytes);
      const rawPayloadArtifactId = `analysis/raw/${rawPayloadSha256}`;
      const structuredPayloadArtifactId = `analysis/structured/${structuredPayloadSha256}`;
      // Persist the unabridged provider response before any summary-derived result
      // can become visible to the compiler.
      await this.artifacts.putIfAbsent({ id: rawPayloadArtifactId, bytes: providerResult.rawPayload, sha256: rawPayloadSha256, provenance: unitHash });
      await this.artifacts.putIfAbsent({ id: structuredPayloadArtifactId, bytes: structuredBytes, sha256: structuredPayloadSha256, provenance: rawPayloadSha256 });
      const completed: CompletedAnalysisRun = {
        schemaVersion: "0.1.0",
        unitId: unit.id,
        unitHash,
        lane: unit.lane,
        repeat: unit.repeat,
        providerRunId: providerResult.providerRunId,
        ...(providerResult.interactionId === undefined ? {} : { interactionId: providerResult.interactionId }),
        exactModel: PRODUCTION_ANALYZER_MODEL,
        mode: unit.mode,
        ...(unit.samplingFps === undefined ? {} : { samplingFps: unit.samplingFps }),
        promptSha256: unit.promptSha256,
        promptVersion: unit.promptVersion,
        sourceContentSha256: unit.sourceContentSha256,
        normalizedContentSha256: unit.normalizedContentSha256,
        deterministicEvidenceHash: unit.deterministicEvidenceHash,
        rawPayloadArtifactId,
        rawPayloadSha256,
        structuredPayloadArtifactId,
        structuredPayloadSha256,
        summary: providerResult.summary,
        summaryTruncated: providerResult.summaryTruncated,
        latencyMs: providerResult.latencyMs,
        totalTokens: providerResult.inputTokens + providerResult.outputTokens + providerResult.thoughtTokens + providerResult.toolUseTokens,
        costUsd: providerResult.costUsd,
        processingCalls: providerResult.processingCalls,
        eligibleForMapMaterialization: unit.mode === "agentic",
        mayDrivePaidGeneration: false,
      };
      await this.ledger.replace({
        unitId: unit.id,
        unitHash,
        status: "succeeded",
        providerRunId: providerResult.providerRunId,
        rawPayloadArtifactId,
        rawPayloadSha256,
        structuredPayloadArtifactId,
        structuredPayloadSha256,
        completedResult: completed,
      });
      return completed;
    } catch (error) {
      await this.ledger.replace({
        unitId: unit.id,
        unitHash,
        status: "failed",
        failureReason: error instanceof Error ? error.message : "unknown analyzer failure",
      });
      throw error;
    }
  }
}
