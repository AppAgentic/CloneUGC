import { contentHash } from "./canonical.ts";

export type Milliseconds = number;
export type EvidenceStatus = "accepted" | "disputed" | "rejected";
export type AnalysisMode = "deterministic" | "human" | "static" | "agentic";
export type RightsStatus = "unverified" | "owned" | "licensed" | "other_valid_right";

export interface EvidenceRange {
  startMs: Milliseconds;
  endMs: Milliseconds;
  originalStartMs: Milliseconds;
  originalEndMs: Milliseconds;
  normalizedStartFrame: number;
  normalizedEndFrame: number;
}

export interface ProviderRun {
  provider: string;
  exactModel: string;
  mode: AnalysisMode;
  runId: string;
  promptVersion: string;
  interactionId?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolUseTokens: number;
  processingCalls: number;
}

export interface EvidenceArtifact {
  schemaVersion: "0.1.0";
  id: string;
  workspaceId: string;
  sourceAssetId: string;
  sourceContentSha256: string;
  normalizedContentSha256: string;
  durationMs: Milliseconds;
  normalizedFps: number;
  originalOffsetMs: Milliseconds;
  providerRun: ProviderRun;
  structuredPayloadArtifactId: string;
  summaryTruncated: boolean;
}

export interface EvidenceClaim {
  id: string;
  artifactId: string;
  sourceContentSha256: string;
  kind: "shot" | "action" | "continuity" | "text" | "audio" | "risk" | "other";
  statement: string;
  status: EvidenceStatus;
  confidence: number;
  directObservation: boolean;
  range?: EvidenceRange;
}

export interface FidelityDirective {
  id: string;
  kind: "preserve" | "change" | "exclude" | "must_not_transfer";
  description: string;
  evidenceIds: string[];
}

export interface FidelityBeat {
  id: string;
  role: "hook" | "setup" | "escalation" | "payoff" | "cta" | "other";
  range: EvidenceRange;
  description: string;
  evidenceIds: string[];
}

export interface RiskConstraint {
  id: string;
  kind: "identity" | "voice" | "logo" | "watermark" | "minor" | "music" | "dialogue" | "bystander" | "other";
  disposition: "authorized" | "exclude" | "unresolved";
  evidenceIds: string[];
}

export interface FidelityMap {
  schemaVersion: "0.1.0";
  id: string;
  revision: number;
  parentRevisionHash?: string;
  sourceAssetId: string;
  sourceContentSha256: string;
  durationMs: Milliseconds;
  rightsStatus: RightsStatus;
  requestedChange: string;
  beats: FidelityBeat[];
  directives: FidelityDirective[];
  risks: RiskConstraint[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHash(value: string, field: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${field} must be a lowercase SHA-256 hash`);
}

function assertRange(range: EvidenceRange, durationMs: number, field: string): void {
  for (const [name, value] of Object.entries(range)) {
    assert(Number.isInteger(value) && value >= 0, `${field}.${name} must be a non-negative integer`);
  }
  assert(range.startMs <= range.endMs, `${field} normalized timestamps are reversed`);
  assert(range.originalStartMs <= range.originalEndMs, `${field} original timestamps are reversed`);
  assert(range.endMs <= durationMs, `${field} exceeds normalized duration`);
  assert(range.normalizedStartFrame <= range.normalizedEndFrame, `${field} frame range is reversed`);
}

export function assertEvidenceArtifact(artifact: EvidenceArtifact): void {
  assert(artifact.schemaVersion === "0.1.0", "unsupported evidence schema version");
  assert(artifact.workspaceId.length > 0, "workspaceId is required");
  assert(artifact.durationMs > 0 && artifact.durationMs <= 30_000, "analysis artifact must be 1-30 seconds");
  assert(artifact.normalizedFps > 0, "normalizedFps must be positive");
  assert(Number.isInteger(artifact.originalOffsetMs) && artifact.originalOffsetMs >= 0, "originalOffsetMs must be a non-negative integer");
  assertHash(artifact.sourceContentSha256, "sourceContentSha256");
  assertHash(artifact.normalizedContentSha256, "normalizedContentSha256");
  assert(artifact.providerRun.exactModel.length > 0, "an exact model identifier is required");
  assert(!artifact.providerRun.exactModel.endsWith("-latest"), "moving model aliases are forbidden");
  assert(artifact.structuredPayloadArtifactId.length > 0, "lossless structured payload is required");
  const usage = artifact.providerRun;
  assert(usage.latencyMs >= 0 && usage.inputTokens >= 0 && usage.outputTokens >= 0, "provider usage cannot be negative");
  assert(usage.thoughtTokens >= 0 && usage.toolUseTokens >= 0 && usage.processingCalls >= 0, "provider usage cannot be negative");
}

export function assertFidelityMap(map: FidelityMap, evidence: readonly EvidenceClaim[]): void {
  assert(map.schemaVersion === "0.1.0", "unsupported Fidelity Map schema version");
  assert(map.revision >= 1 && Number.isInteger(map.revision), "revision must be a positive integer");
  assert(map.durationMs > 0 && map.durationMs <= 30_000, "Fidelity Map must cover 1-30 seconds");
  assertHash(map.sourceContentSha256, "sourceContentSha256");
  if (map.parentRevisionHash !== undefined) assertHash(map.parentRevisionHash, "parentRevisionHash");

  const evidenceById = new Map<string, EvidenceClaim>();
  for (const claim of evidence) {
    assert(!evidenceById.has(claim.id), `duplicate evidence id ${claim.id}`);
    assert(claim.confidence >= 0 && claim.confidence <= 1, `${claim.id} confidence must be between 0 and 1`);
    assertHash(claim.sourceContentSha256, `evidence.${claim.id}.sourceContentSha256`);
    assert(claim.sourceContentSha256 === map.sourceContentSha256, `${claim.id} belongs to a different source`);
    if (claim.range !== undefined) assertRange(claim.range, map.durationMs, `evidence.${claim.id}.range`);
    evidenceById.set(claim.id, claim);
  }

  const requireAccepted = (evidenceId: string, owner: string): void => {
    const claim = evidenceById.get(evidenceId);
    assert(claim !== undefined, `${owner} references missing evidence ${evidenceId}`);
    assert(claim.status === "accepted", `${owner} references ${claim.status} evidence ${evidenceId}`);
  };

  const assertUniqueIds = (items: readonly { id: string }[], field: string): void => {
    const ids = new Set<string>();
    for (const item of items) {
      assert(!ids.has(item.id), `duplicate ${field} id ${item.id}`);
      ids.add(item.id);
    }
  };
  assertUniqueIds(map.beats, "beat");
  assertUniqueIds(map.directives, "directive");
  assertUniqueIds(map.risks, "risk");

  let previousBeatStart = -1;
  for (const beat of map.beats) {
    assertRange(beat.range, map.durationMs, `beat.${beat.id}.range`);
    assert(beat.range.startMs >= previousBeatStart, "beats must be ordered by normalized start time");
    previousBeatStart = beat.range.startMs;
    assert(beat.evidenceIds.length > 0, `beat ${beat.id} requires evidence`);
    beat.evidenceIds.forEach((id) => requireAccepted(id, `beat ${beat.id}`));
  }
  for (const directive of map.directives) {
    if (directive.kind !== "change") {
      assert(directive.evidenceIds.length > 0, `${directive.kind} directive ${directive.id} requires evidence`);
    }
    directive.evidenceIds.forEach((id) => requireAccepted(id, `directive ${directive.id}`));
  }
  for (const risk of map.risks) {
    assert(risk.evidenceIds.length > 0, `risk ${risk.id} requires evidence`);
    risk.evidenceIds.forEach((id) => requireAccepted(id, `risk ${risk.id}`));
  }
}

export function fidelityMapHash(map: FidelityMap): string {
  assert(map.parentRevisionHash !== "", "parentRevisionHash cannot be empty");
  return contentHash(map);
}

export function generationEligibility(map: FidelityMap, evidence: readonly EvidenceClaim[]): {
  eligible: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  try {
    assertFidelityMap(map, evidence);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "invalid Fidelity Map");
  }
  if (map.rightsStatus === "unverified") reasons.push("rights attestation is required");
  if (map.risks.some((risk) => risk.disposition === "unresolved")) reasons.push("unresolved rights or safety risk");
  return { eligible: reasons.length === 0, reasons };
}
