import assert from "node:assert/strict";
import test from "node:test";
import { adjudicateTemporalEvents, type NaturalDurationPrior, type TemporalEventObservation } from "../src/temporal-adjudicator.ts";

const priors: NaturalDurationPrior[] = [
  { type: "gesture", medianMs: 800, logStandardDeviation: 0.25, minimumUsefulDurationMs: 200 },
  { type: "gait_step", medianMs: 600, logStandardDeviation: 0.2, minimumUsefulDurationMs: 200 },
];
const policy = { candidates: [0.5, 1, 1.5, 2, 3], minimumIndependentClockIds: 2, minimumLogLikelihoodMargin: 1 };

function observations(gestureMs: number, stepMs: number): TemporalEventObservation[] {
  const expansion = 4;
  return [
    { id: "gesture", type: "gesture", clockId: "foreground", inspectionStartMs: 0, inspectionEndMs: gestureMs * expansion, confidence: 1, directlyObserved: true },
    { id: "step", type: "gait_step", clockId: "background", inspectionStartMs: 0, inspectionEndMs: stepMs * expansion, confidence: 1, directlyObserved: true },
  ];
}

test("maps inspection timestamps back and adjudicates acceleration", () => {
  const result = adjudicateTemporalEvents(observations(400, 300), 4, priors, policy);
  assert.equal(result.classification, "sped_up");
  assert.equal(result.estimatedMultiplier, 2);
  assert.equal(result.status, "adjudicated");
});

test("adjudicates slowdown without asking the observer for a speed label", () => {
  const result = adjudicateTemporalEvents(observations(1_600, 1_200), 4, priors, policy);
  assert.equal(result.classification, "slowed_down");
  assert.equal(result.estimatedMultiplier, 0.5);
});

test("reports aligned 1x clocks as no retiming evidence, not proof of capture rate", () => {
  const result = adjudicateTemporalEvents(observations(800, 600), 4, priors, policy);
  assert.equal(result.classification, "real_time");
  assert.equal(result.status, "no_retiming_evidence");
});

test("fails closed when independent clocks are missing", () => {
  const result = adjudicateTemporalEvents(observations(400, 300).slice(0, 1), 4, priors, policy);
  assert.equal(result.classification, "unknown");
  assert.equal(result.status, "insufficient_evidence");
});

test("fails closed when clocks conflict and no candidate wins by the margin", () => {
  const result = adjudicateTemporalEvents(observations(400, 1_200), 4, priors, policy);
  assert.equal(result.classification, "unknown");
});
