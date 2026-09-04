import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisRunner,
  PRODUCTION_ANALYZER_MODEL,
  prepareBenchmarkAnalysisPlan,
  prepareProductionAnalysis,
  type AnalyzerProviderResult,
  type DeterministicAnalysisEvidence,
} from "../src/analyzer-runner.ts";
import { FakeAnalyzerProvider, MemoryAnalysisArtifactStore, MemoryAnalysisRunLedger } from "../src/adapters/fake-analysis-runtime.ts";

const sourceHash = "a".repeat(64);
const normalizedHash = "b".repeat(64);
const evidence: DeterministicAnalysisEvidence = {
  schemaVersion: "0.1.0",
  sourceAssetId: "source-1",
  sourceContentSha256: sourceHash,
  normalizedContentSha256: normalizedHash,
  durationMs: 10_000,
  normalizedFps: 30,
  originalOffsetMs: 0,
  probes: ["media_probe", "scene_detection", "audio_probe", "frame_cadence"].map((kind, index) => ({
    kind: kind as DeterministicAnalysisEvidence["probes"][number]["kind"],
    artifactSha256: `${index + 1}`.repeat(64),
  })),
};

function response(unit: ReturnType<typeof prepareProductionAnalysis>): AnalyzerProviderResult {
  return {
    providerRunId: `provider-${unit.id}`,
    interactionId: "interaction-1",
    exactModel: unit.exactModel,
    mode: unit.mode,
    ...(unit.samplingFps === undefined ? {} : { samplingFps: unit.samplingFps }),
    rawPayload: new TextEncoder().encode('{"complete":"provider interaction"}'),
    structuredPayload: { claims: [{ kind: "action", statement: "walks forward" }] },
    summary: "short display summary",
    summaryTruncated: false,
    latencyMs: 12_000,
    inputTokens: 1_000,
    outputTokens: 500,
    thoughtTokens: 250,
    toolUseTokens: 4_000,
    processingCalls: 3,
    costUsd: 0.03,
  };
}

test("builds a counterbalanced four-lane benchmark while keeping Agentic as production default", () => {
  const plan = prepareBenchmarkAnalysisPlan({ evidence, prompt: "inspect everything", promptVersion: "analysis-v10", orderingSeed: "sealed-seed" });
  assert.equal(plan.length, 12);
  assert.deepEqual([...new Set(plan.map((unit) => unit.exactModel))], [PRODUCTION_ANALYZER_MODEL]);
  assert.deepEqual([...new Set(plan.filter((unit) => unit.lane === "static_5fps").map((unit) => unit.samplingFps))], [5]);
  assert.deepEqual([...new Set(plan.filter((unit) => unit.lane === "static_10fps").map((unit) => unit.samplingFps))], [10]);
  assert(plan.filter((unit) => unit.lane === "hybrid_agentic").every((unit) => unit.mode === "agentic" && unit.samplingFps === undefined));
  assert.notDeepEqual(plan.map((unit) => unit.lane), [...plan].sort((a, b) => a.lane.localeCompare(b.lane)).map((unit) => unit.lane));
  const production = prepareProductionAnalysis({ evidence, prompt: "inspect everything", promptVersion: "analysis-v10" });
  assert.equal(production.lane, "hybrid_agentic");
  assert.equal(production.mode, "agentic");
  assert.match(production.promptSha256, /^[a-f0-9]{64}$/);
});

test("persists the complete provider payload before returning an Agentic materialization candidate", async () => {
  const unit = prepareProductionAnalysis({ evidence, prompt: "inspect everything", promptVersion: "analysis-v10" });
  const provider = new FakeAnalyzerProvider(response);
  const artifacts = new MemoryAnalysisArtifactStore();
  const ledger = new MemoryAnalysisRunLedger();
  const runner = new AnalysisRunner(provider, artifacts, ledger);
  const result = await runner.run(unit);
  assert.equal(result.eligibleForMapMaterialization, true);
  assert.equal(result.mayDrivePaidGeneration, false, "only a validated map plus rights and spend authority can unlock generation");
  assert.equal(result.totalTokens, 5_750, "tool-use tokens must be included in total cost telemetry");
  assert.equal(artifacts.entries.size, 2);
  assert(artifacts.entries.has(result.rawPayloadArtifactId));
  assert(artifacts.entries.has(result.structuredPayloadArtifactId));
  assert.equal((await ledger.get(unit.id))?.status, "succeeded");
  assert.deepEqual(await runner.run(unit), result, "an identical retry returns the persisted result without another provider call");
  assert.equal(provider.calls.length, 1);
});

test("static control output cannot materialize the production map or unlock generation", async () => {
  const unit = prepareBenchmarkAnalysisPlan({ evidence, prompt: "inspect everything", promptVersion: "analysis-v10", orderingSeed: "seed" })
    .find((candidate) => candidate.lane === "static_5fps")!;
  const runner = new AnalysisRunner(new FakeAnalyzerProvider(response), new MemoryAnalysisArtifactStore(), new MemoryAnalysisRunLedger());
  const result = await runner.run(unit);
  assert.equal(result.eligibleForMapMaterialization, false);
  assert.equal(result.mayDrivePaidGeneration, false);
});

test("fails closed on incomplete probes, model drift, summary-only output, and ambiguous resubmission", async () => {
  assert.throws(() => prepareProductionAnalysis({
    evidence: { ...evidence, probes: evidence.probes.filter((probe) => probe.kind !== "frame_cadence") },
    prompt: "inspect",
    promptVersion: "analysis-v10",
  }), /requires frame_cadence/);

  const unit = prepareProductionAnalysis({ evidence, prompt: "inspect", promptVersion: "analysis-v10" });
  const ledger = new MemoryAnalysisRunLedger();
  const provider = new FakeAnalyzerProvider((candidate) => ({ ...response(candidate), rawPayload: new Uint8Array() }));
  const runner = new AnalysisRunner(provider, new MemoryAnalysisArtifactStore(), ledger);
  await assert.rejects(runner.run(unit), /raw provider payload/);
  await assert.rejects(runner.run(unit), /already failed; reconcile instead of resubmitting/);
  assert.equal(provider.calls.length, 1);

  const driftRunner = new AnalysisRunner(new FakeAnalyzerProvider((candidate) => ({ ...response(candidate), exactModel: "gemini-3.8-flash-002" })), new MemoryAnalysisArtifactStore(), new MemoryAnalysisRunLedger());
  await assert.rejects(driftRunner.run(unit), /different model/);

  const staticAsAgentic = { ...unit, lane: "static_5fps" as const, samplingFps: 5 as const };
  await assert.rejects(
    new AnalysisRunner(new FakeAnalyzerProvider(response), new MemoryAnalysisArtifactStore(), new MemoryAnalysisRunLedger()).run(staticAsAgentic),
    /static benchmark lane must use static mode/,
  );

  await assert.rejects(
    new AnalysisRunner(new FakeAnalyzerProvider(response), new MemoryAnalysisArtifactStore(), new MemoryAnalysisRunLedger()).run({ ...unit, prompt: "changed without updating its hash" }),
    /prompt hash does not match/,
  );
});
