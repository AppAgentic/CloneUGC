import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { contentHash } from "../src/canonical.ts";
import {
  AnalysisRunner,
  prepareProductionAnalysis,
  type AnalyzerProviderResult,
  type DeterministicAnalysisEvidence,
} from "../src/analyzer-runner.ts";
import { FileAnalysisArtifactStore, FileAnalysisRunLedger } from "../src/adapters/file-analysis-runtime.ts";
import { FakeAnalyzerProvider } from "../src/adapters/fake-analysis-runtime.ts";

const evidence: DeterministicAnalysisEvidence = {
  schemaVersion: "0.1.0",
  sourceAssetId: "durable-source",
  sourceContentSha256: "a".repeat(64),
  normalizedContentSha256: "b".repeat(64),
  durationMs: 5_000,
  normalizedFps: 30,
  originalOffsetMs: 0,
  probes: ["media_probe", "scene_detection", "audio_probe", "frame_cadence"].map((kind, index) => ({
    kind: kind as DeterministicAnalysisEvidence["probes"][number]["kind"],
    artifactSha256: `${index + 1}`.repeat(64),
  })),
};

function response(unit: ReturnType<typeof prepareProductionAnalysis>): AnalyzerProviderResult {
  return {
    providerRunId: "durable-provider-run",
    interactionId: "durable-provider-run",
    exactModel: unit.exactModel,
    mode: unit.mode,
    rawPayload: new TextEncoder().encode('{"id":"durable-provider-run"}'),
    structuredPayload: { id: "durable-provider-run", claims: [] },
    summary: "durable summary",
    summaryTruncated: false,
    latencyMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    thoughtTokens: 2,
    toolUseTokens: 20,
    processingCalls: 1,
    costUsd: 0.001,
  };
}

test("filesystem analysis stores survive reopen and never repeat a succeeded provider call", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloneugc-analysis-store-"));
  try {
    const unit = prepareProductionAnalysis({ evidence, prompt: "inspect", promptVersion: "v1" });
    const provider = new FakeAnalyzerProvider(response);
    const first = new AnalysisRunner(
      provider,
      new FileAnalysisArtifactStore(join(root, "artifacts")),
      new FileAnalysisRunLedger(join(root, "ledger")),
    );
    const completed = await first.run(unit);
    const reopened = new AnalysisRunner(
      new FakeAnalyzerProvider(() => { throw new Error("provider must not run after reopen"); }),
      new FileAnalysisArtifactStore(join(root, "artifacts")),
      new FileAnalysisRunLedger(join(root, "ledger")),
    );
    assert.deepEqual(await reopened.run(unit), completed);
    assert.equal(provider.calls.length, 1);

    const rawPath = join(root, "artifacts", "raw", `${completed.rawPayloadSha256}.bin`);
    assert.equal((await stat(rawPath)).mode & 0o777, 0o600);
    assert.equal(new TextDecoder().decode(await readFile(rawPath)), '{"id":"durable-provider-run"}');
    const receiptPath = join(root, "artifacts", "raw", `${completed.rawPayloadSha256}.provenance`, `${completed.unitHash}.json`);
    assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).provenance, completed.unitHash);
    assert.equal((await stat(join(root, "ledger", `${unit.id}.json`))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem ledger makes concurrent duplicate execution exact once and blocks abandoned running work", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloneugc-analysis-race-"));
  try {
    const unit = prepareProductionAnalysis({ evidence, prompt: "inspect concurrently", promptVersion: "v1" });
    const provider = new FakeAnalyzerProvider(response);
    const makeRunner = () => new AnalysisRunner(
      provider,
      new FileAnalysisArtifactStore(join(root, "artifacts")),
      new FileAnalysisRunLedger(join(root, "ledger")),
    );
    const outcomes = await Promise.allSettled([makeRunner().run(unit), makeRunner().run(unit)]);
    assert.equal(provider.calls.length, 1, "exclusive ledger create must precede the provider call");
    assert(outcomes.some((outcome) => outcome.status === "fulfilled"));

    const abandoned = prepareProductionAnalysis({ evidence, prompt: "abandoned", promptVersion: "v1" });
    const ledger = new FileAnalysisRunLedger(join(root, "ledger"));
    await ledger.create({ unitId: abandoned.id, unitHash: contentHash(abandoned), status: "running" });
    const blockedProvider = new FakeAnalyzerProvider(response);
    await assert.rejects(
      new AnalysisRunner(blockedProvider, new FileAnalysisArtifactStore(join(root, "artifacts")), ledger).run(abandoned),
      /already running; reconcile instead of resubmitting/,
    );
    assert.equal(blockedProvider.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem artifact store rejects hash and path confusion", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloneugc-analysis-artifact-"));
  try {
    const store = new FileAnalysisArtifactStore(root);
    await assert.rejects(store.putIfAbsent({
      id: `analysis/raw/${"a".repeat(64)}`,
      bytes: new TextEncoder().encode("different"),
      sha256: "a".repeat(64),
      provenance: "b".repeat(64),
    }), /hash does not match/);
    await assert.rejects(store.putIfAbsent({
      id: "analysis/raw/../../escape",
      bytes: new TextEncoder().encode("x"),
      sha256: "a".repeat(64),
      provenance: "b".repeat(64),
    }), /invalid analysis artifact id/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
