import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareBenchmarkAnalysisPlan, type DeterministicAnalysisEvidence } from "../src/analyzer-runner.ts";
import {
  McGeminiAnalyzerProvider,
  type AnalyzerCommandExecutor,
  type AnalysisPricingSnapshot,
} from "../src/adapters/mc-gemini-analyzer.ts";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const pricing: AnalysisPricingSnapshot = {
  id: "gemini-2026-09-04",
  capturedAt: "2026-09-04T00:00:00.000Z",
  estimateCostUsd: (usage) => (usage.inputTokens + usage.toolUseTokens) / 1_000_000 + (usage.outputTokens + usage.thoughtTokens) * 2 / 1_000_000,
};

test("live adapter binds exact source, model, static FPS and complete provider exchange", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloneugc-adapter-test-"));
  try {
    const sourcePath = join(directory, "normalized.mp4");
    const sourceBytes = new TextEncoder().encode("normalized video bytes");
    await writeFile(sourcePath, sourceBytes);
    const evidence: DeterministicAnalysisEvidence = {
      schemaVersion: "0.1.0",
      sourceAssetId: "asset-1",
      sourceContentSha256: "a".repeat(64),
      normalizedContentSha256: sha256(sourceBytes),
      durationMs: 10_000,
      normalizedFps: 30,
      originalOffsetMs: 0,
      probes: ["media_probe", "scene_detection", "audio_probe", "frame_cadence"].map((kind, index) => ({
        kind: kind as DeterministicAnalysisEvidence["probes"][number]["kind"],
        artifactSha256: `${index + 1}`.repeat(64),
      })),
    };
    const unit = prepareBenchmarkAnalysisPlan({ evidence, prompt: "inspect every action", promptVersion: "v1", orderingSeed: "seed" })
      .find((candidate) => candidate.lane === "static_5fps")!;
    const calls: Array<{ command: string; args: string[]; model: string | undefined }> = [];
    const executor: AnalyzerCommandExecutor = {
      async execute(command, args, options) {
        calls.push({ command, args: [...args], model: options.env.MC_VIDEO_ANALYSIS_MODEL });
        const outputIndex = args.indexOf("--evidence-output");
        const outputPath = args[outputIndex + 1]!;
        const request = Buffer.from(JSON.stringify({ model: unit.exactModel, input: [{ processing: { type: "static", fps: 5 } }] }));
        const response = Buffer.from(JSON.stringify({ id: "interaction-1", output_text: "full analysis" }));
        const providerEvidence = {
          schema_version: "0.1.0",
          provider: "google-gemini",
          model: unit.exactModel,
          mode: unit.mode,
          sampling_fps: unit.samplingFps,
          content_sha256: unit.normalizedContentSha256,
          provider_request_base64: request.toString("base64"),
          provider_response_base64: response.toString("base64"),
        };
        const encoded = new TextEncoder().encode(`${JSON.stringify(providerEvidence)}\n`);
        await writeFile(outputPath, encoded, { mode: 0o600 });
        return {
          stderr: "",
          stdout: JSON.stringify({
            status: "complete",
            summary: "short summary",
            provider: "google-gemini",
            model: unit.exactModel,
            mode: unit.mode,
            sampling_fps: unit.samplingFps,
            provider_run_id: "interaction-1",
            interaction_id: "interaction-1",
            content_sha256: unit.normalizedContentSha256,
            latency_ms: 1200,
            input_tokens: 100,
            output_tokens: 20,
            thought_tokens: 10,
            tool_use_tokens: 50,
            processing_calls: 2,
            summary_truncated: true,
            evidence_path: outputPath,
            evidence_sha256: sha256(encoded),
          }),
        };
      },
    };
    const provider = new McGeminiAnalyzerProvider({
      executable: "/tmp/mc-evidence",
      sources: { resolve: async () => sourcePath },
      pricing,
      executor,
    });

    const result = await provider.analyze(unit);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "/tmp/mc-evidence");
    assert.equal(calls[0]?.model, "gemini-3.8-flash");
    assert.deepEqual(calls[0]?.args.slice(-2), ["--sampling-fps", "5"]);
    assert.equal(result.providerRunId, "interaction-1");
    assert.equal(result.samplingFps, 5);
    assert.equal(result.summaryTruncated, true);
    assert(Math.abs(result.costUsd - 0.00021) < 1e-12);
    assert.equal((result.structuredPayload as { providerResponse: { id: string } }).providerResponse.id, "interaction-1");
    assert.equal(JSON.parse(new TextDecoder().decode(result.rawPayload)).provider_response_base64.length > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("live adapter rejects source and evidence drift before returning a result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloneugc-adapter-drift-"));
  try {
    const sourcePath = join(directory, "wrong.mp4");
    await writeFile(sourcePath, "wrong bytes");
    const evidence: DeterministicAnalysisEvidence = {
      schemaVersion: "0.1.0",
      sourceAssetId: "asset-1",
      sourceContentSha256: "a".repeat(64),
      normalizedContentSha256: "b".repeat(64),
      durationMs: 1_000,
      normalizedFps: 30,
      originalOffsetMs: 0,
      probes: ["media_probe", "scene_detection", "audio_probe", "frame_cadence"].map((kind, index) => ({
        kind: kind as DeterministicAnalysisEvidence["probes"][number]["kind"],
        artifactSha256: `${index + 1}`.repeat(64),
      })),
    };
    const unit = prepareBenchmarkAnalysisPlan({ evidence, prompt: "inspect", promptVersion: "v1", orderingSeed: "seed" })[0]!;
    let executed = false;
    const provider = new McGeminiAnalyzerProvider({
      executable: "/tmp/mc-evidence",
      sources: { resolve: async () => sourcePath },
      pricing,
      executor: { execute: async () => { executed = true; return { stdout: "{}", stderr: "" }; } },
    });
    await assert.rejects(provider.analyze(unit), /does not match normalizedContentSha256/);
    assert.equal(executed, false, "hash drift must fail before provider submission");
    assert.equal((await readFile(sourcePath, "utf8")), "wrong bytes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
