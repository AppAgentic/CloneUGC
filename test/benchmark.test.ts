import assert from "node:assert/strict";
import test from "node:test";
import { scoreLane, scoreRun, type AnalysisRun, type BlindAnnotation } from "../src/benchmark.ts";

const sourceHash = "b".repeat(64);
const normalizedHash = "c".repeat(64);
const annotation: BlindAnnotation = {
  schemaVersion: "0.1.0",
  blindToModelOutputs: true,
  annotatorId: "annotator-a",
  sourceContentSha256: sourceHash,
  normalizedContentSha256: normalizedHash,
  normalizedFps: 30,
  originalOffsetMs: 0,
  shotBoundariesMs: [2_000, 5_000, 8_000],
  actionEvents: [{ id: "action-1", timeMs: 3_000 }],
  claims: [
    { id: "action-claim", category: "action" },
    { id: "music-risk", category: "rights_risk" },
  ],
};

function makeRun(repeat: number, overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: `run-${repeat}`,
    lane: "hybrid_agentic",
    repeat,
    sourceContentSha256: sourceHash,
    normalizedContentSha256: normalizedHash,
    exactModel: "gemini-3.8-flash",
    promptVersion: "analysis-v1",
    providerRunId: `provider-${repeat}`,
    evidenceArtifactId: `evidence-${repeat}`,
    structuredPayloadArtifactId: `payload-${repeat}`,
    shotBoundariesMs: [2_050, 5_200, 8_600],
    actionEvents: [{ annotationId: "action-1", timeMs: 3_120 }],
    predictions: [
      { claimKey: "action:raise", annotationId: "action-claim", adjudication: "supported" },
      { claimKey: "risk:music", annotationId: "music-risk", adjudication: "supported" },
      { claimKey: "camera:dolly", adjudication: "unsupported" },
    ],
    latencyMs: 30_000,
    totalTokens: 20_000,
    costUsd: 0.02,
    agenticFollowups: 2,
    ...overrides,
  };
}

test("scores timing windows, claims, rights risks, and unsupported claims", () => {
  const result = scoreRun(annotation, makeRun(1));
  assert.deepEqual(result.boundary.map((item) => item.truePositives), [1, 2, 2]);
  assert.equal(result.boundaryMaeMs, (50 + 200) / 2);
  assert.equal(result.actionEventMaeMs, 120);
  assert.equal(result.claimPrecision, 2 / 3);
  assert.equal(result.claimRecall, 1);
  assert.equal(result.rightsRiskRecall, 1);
  assert.equal(result.unsupportedClaimRate, 1 / 3);
});

test("boundary matching maximizes one-to-one matches before minimizing error", () => {
  const crossedAnnotation = { ...annotation, shotBoundariesMs: [0, 300] };
  const result = scoreRun(crossedAnnotation, makeRun(1, { shotBoundariesMs: [200, 500] }));
  assert.equal(result.boundary.find((item) => item.toleranceMs === 250)?.truePositives, 2);
  assert.equal(result.boundaryMaeMs, 200);
});

test("requires three pinned repeats and evaluates budgets", () => {
  assert.throws(() => scoreLane(annotation, [makeRun(1), makeRun(2)], {
    maxAgenticFollowups: 2,
    maxCostUsdPerRun: 0.05,
    maxP95LatencyMs: 45_000,
  }), /at least three/);

  const result = scoreLane(annotation, [makeRun(1), makeRun(2), makeRun(3, { latencyMs: 50_000 })], {
    maxAgenticFollowups: 2,
    maxCostUsdPerRun: 0.05,
    maxP95LatencyMs: 45_000,
  });
  assert.equal(result.budgetPassed, false);
  assert.deepEqual(result.budgetFailures, ["p95 latency limit exceeded"]);
  assert.equal(result.claimStability, 1);
});

test("rejects unsupported provenance shapes and agentic work in static lanes", () => {
  assert.throws(() => scoreLane(annotation, [1, 2, 3].map((repeat) => makeRun(repeat, {
    lane: "static_default",
    agenticFollowups: 1,
  })), {
    maxAgenticFollowups: 2,
    maxCostUsdPerRun: 0.05,
    maxP95LatencyMs: 45_000,
  }), /static lanes cannot contain agentic/);

  assert.throws(() => scoreRun(annotation, makeRun(1, {
    predictions: [{ claimKey: "invented", adjudication: "supported" }],
  })), /lacks a valid annotation id/);
});

test("rejects malformed runtime fixture values instead of coercing them", () => {
  const budget = { maxAgenticFollowups: 2, maxCostUsdPerRun: 0.05, maxP95LatencyMs: 45_000 };
  const runs = [makeRun(1), makeRun(2), makeRun(3)];
  const malformed = structuredClone(runs);
  Object.assign(malformed[0]!, { latencyMs: "12000" });
  assert.throws(() => scoreLane(annotation, malformed, budget), /latencyMs must be finite and non-negative/);

  const unknownAction = structuredClone(runs);
  unknownAction[0]!.actionEvents = [{ annotationId: "missing-action", timeMs: 100 }];
  assert.throws(() => scoreLane(annotation, unknownAction, budget), /unknown annotation missing-action/);
});
