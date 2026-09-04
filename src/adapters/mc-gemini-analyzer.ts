import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  PRODUCTION_ANALYZER_MODEL,
  type AnalysisExecutionUnit,
  type AnalyzerProvider,
  type AnalyzerProviderResult,
} from "../analyzer-runner.ts";

const execFileAsync = promisify(execFile);

export interface AnalysisSourceResolver {
  resolve(unit: AnalysisExecutionUnit): Promise<string>;
}

export interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolUseTokens: number;
}

export interface AnalysisPricingSnapshot {
  id: string;
  capturedAt: string;
  estimateCostUsd(usage: AnalysisUsage): number;
}

export interface AnalyzerCommandResult {
  stdout: string;
  stderr: string;
}

export interface AnalyzerCommandExecutor {
  execute(command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<AnalyzerCommandResult>;
}

class NodeAnalyzerCommandExecutor implements AnalyzerCommandExecutor {
  async execute(command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<AnalyzerCommandResult> {
    const result = await execFileAsync(command, args, {
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: result.stdout, stderr: result.stderr };
  }
}

interface McVideoAnalysisResult {
  status: string;
  summary?: string;
  provider?: string;
  model?: string;
  mode?: string;
  sampling_fps?: number;
  provider_run_id?: string;
  interaction_id?: string;
  content_sha256?: string;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  thought_tokens?: number;
  tool_use_tokens?: number;
  processing_calls?: number;
  summary_truncated?: boolean;
  evidence_path?: string;
  evidence_sha256?: string;
}

interface McVideoAnalysisEvidence {
  schema_version: string;
  provider: string;
  model: string;
  mode: string;
  sampling_fps?: number;
  content_sha256: string;
  provider_request_base64: string;
  provider_response_base64: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function finiteNonNegative(value: unknown, name: string): number {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${name} must be finite and non-negative`);
  return value;
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function parseJSON<T>(value: string | Uint8Array, name: string): T {
  try {
    return JSON.parse(typeof value === "string" ? value : new TextDecoder().decode(value)) as T;
  } catch {
    throw new Error(`${name} was not valid JSON`);
  }
}

function decodeBase64(value: string, name: string): Uint8Array {
  assert(value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), `${name} was not canonical base64`);
  const decoded = Buffer.from(value, "base64");
  assert(decoded.toString("base64") === value, `${name} was not canonical base64`);
  return Uint8Array.from(decoded);
}

export class McGeminiAnalyzerProvider implements AnalyzerProvider {
  private readonly executable: string;
  private readonly sources: AnalysisSourceResolver;
  private readonly pricing: AnalysisPricingSnapshot;
  private readonly executor: AnalyzerCommandExecutor;
  private readonly timeoutMs: number;

  constructor(input: {
    executable: string;
    sources: AnalysisSourceResolver;
    pricing: AnalysisPricingSnapshot;
    executor?: AnalyzerCommandExecutor;
    timeoutMs?: number;
  }) {
    assert(input.executable.trim().length > 0, "analyzer executable is required");
    assert(input.pricing.id.trim().length > 0, "analysis pricing snapshot id is required");
    assert(!Number.isNaN(Date.parse(input.pricing.capturedAt)), "analysis pricing capturedAt must be an ISO timestamp");
    this.executable = input.executable;
    this.sources = input.sources;
    this.pricing = input.pricing;
    this.executor = input.executor ?? new NodeAnalyzerCommandExecutor();
    this.timeoutMs = input.timeoutMs ?? 4 * 60 * 1000;
  }

  async analyze(unit: AnalysisExecutionUnit): Promise<AnalyzerProviderResult> {
    assert(unit.exactModel === PRODUCTION_ANALYZER_MODEL, "live adapter only supports the pinned production model");
    assert(unit.mode === "static" || (unit.mode === "agentic" && unit.samplingFps === undefined), "Agentic analysis cannot request static sampling");
    const sourcePath = resolve(await this.sources.resolve(unit));
    assert(await hashFile(sourcePath) === unit.normalizedContentSha256, "resolved analysis source does not match normalizedContentSha256");

    const evidenceDirectory = await mkdtemp(join(tmpdir(), "cloneugc-analysis-"));
    const evidencePath = join(evidenceDirectory, "provider-exchange.json");
    try {
      const args = [
        "video-analyze", sourcePath,
        "--mode", unit.mode,
        "--prompt", unit.prompt,
        "--evidence-output", evidencePath,
        "--json",
      ];
      if (unit.samplingFps !== undefined) args.push("--sampling-fps", String(unit.samplingFps));
      const command = await this.executor.execute(this.executable, args, {
        env: { ...process.env, MC_VIDEO_ANALYSIS_MODEL: PRODUCTION_ANALYZER_MODEL },
        timeoutMs: this.timeoutMs,
      });
      assert(command.stderr.trim().length === 0, "analyzer command wrote unexpected stderr");
      const result = parseJSON<McVideoAnalysisResult>(command.stdout, "analyzer command output");
      const evidenceBytes = await readFile(evidencePath);
      const evidence = parseJSON<McVideoAnalysisEvidence>(evidenceBytes, "analyzer evidence");

      assert(result.status === "complete", "analyzer command did not complete");
      assert(result.provider === "google-gemini" && evidence.provider === "google-gemini", "unexpected analyzer provider");
      assert(result.model === unit.exactModel && evidence.model === unit.exactModel, "analyzer model drifted");
      assert(result.mode === unit.mode && evidence.mode === unit.mode, "analyzer mode drifted");
      assert(result.sampling_fps === unit.samplingFps && evidence.sampling_fps === unit.samplingFps, "analyzer sampling rate drifted");
      assert(result.content_sha256 === unit.normalizedContentSha256 && evidence.content_sha256 === unit.normalizedContentSha256, "analyzer source hash drifted");
      assert(result.evidence_path === evidencePath, "analyzer returned a different evidence path");
      assert(result.evidence_sha256 === sha256(evidenceBytes), "analyzer evidence hash did not match its bytes");
      assert(evidence.schema_version === "0.1.0", "unsupported analyzer evidence version");

      const requestBytes = decodeBase64(evidence.provider_request_base64, "provider request");
      const responseBytes = decodeBase64(evidence.provider_response_base64, "provider response");
      assert(requestBytes.byteLength > 0 && responseBytes.byteLength > 0, "complete provider exchange is required");
      const providerResponse = parseJSON<Record<string, unknown>>(responseBytes, "raw provider response");
      const providerRunId = result.provider_run_id ?? result.interaction_id;
      assert(typeof providerRunId === "string" && providerRunId.trim().length > 0, "provider interaction id is required");
      assert(providerResponse.id === providerRunId, "provider interaction id does not match raw response");

      const usage: AnalysisUsage = {
        inputTokens: finiteNonNegative(result.input_tokens, "input_tokens"),
        outputTokens: finiteNonNegative(result.output_tokens, "output_tokens"),
        thoughtTokens: finiteNonNegative(result.thought_tokens, "thought_tokens"),
        toolUseTokens: finiteNonNegative(result.tool_use_tokens, "tool_use_tokens"),
      };
      const costUsd = this.pricing.estimateCostUsd(usage);
      finiteNonNegative(costUsd, "estimated analysis cost");

      return {
        providerRunId,
        ...(result.interaction_id === undefined ? {} : { interactionId: result.interaction_id }),
        exactModel: PRODUCTION_ANALYZER_MODEL,
        mode: unit.mode,
        ...(unit.samplingFps === undefined ? {} : { samplingFps: unit.samplingFps }),
        rawPayload: evidenceBytes,
        structuredPayload: {
          schemaVersion: "0.1.0",
          pricingSnapshotId: this.pricing.id,
          pricingCapturedAt: this.pricing.capturedAt,
          providerRequest: parseJSON<Record<string, unknown>>(requestBytes, "raw provider request"),
          providerResponse,
        },
        summary: result.summary ?? "",
        summaryTruncated: result.summary_truncated ?? false,
        latencyMs: finiteNonNegative(result.latency_ms, "latency_ms"),
        ...usage,
        processingCalls: finiteNonNegative(result.processing_calls, "processing_calls"),
        costUsd,
      };
    } finally {
      await rm(evidenceDirectory, { recursive: true, force: true });
    }
  }
}
