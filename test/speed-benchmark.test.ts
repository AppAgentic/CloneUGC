import assert from "node:assert/strict";
import test from "node:test";
import { scoreSpeedBenchmark, type SpeedAcceptanceCriteria, type SpeedBenchmarkCase, type SpeedPrediction } from "../src/speed-benchmark.ts";

const cases: SpeedBenchmarkCase[] = [
  { id: "human-05", family: "human", transform: "constant", expectedClass: "slowed_down", expectedMultiplier: 0.5 },
  { id: "human-10", family: "human", transform: "constant", expectedClass: "real_time", expectedMultiplier: 1 },
  { id: "human-20", family: "human", transform: "constant", expectedClass: "sped_up", expectedMultiplier: 2 },
  {
    id: "human-ramp", family: "human", transform: "ramp", expectedClass: "variable",
    expectedSegments: [
      { startMs: 0, endMs: 2_000, expectedClass: "real_time", expectedMultiplier: 1 },
      { startMs: 2_000, endMs: 4_000, expectedClass: "sped_up", expectedMultiplier: 2 },
    ],
  },
];

const criteria: SpeedAcceptanceCriteria = {
  minClassAccuracy: 0.9,
  minCoverage: 0.9,
  minPerClassRecall: 0.8,
  maxRealTimeFalsePositiveRate: 0.1,
  maxMedianMultiplierAbsolutePercentError: 0.2,
  minVariableSegmentAccuracy: 0.8,
};

test("scores class, coverage, multiplier, false-positive, and variable-segment gates", () => {
  const predictions: SpeedPrediction[] = [
    { caseId: "human-05", predictedClass: "slowed_down", estimatedMultiplier: 0.55, confidence: 0.9 },
    { caseId: "human-10", predictedClass: "real_time", estimatedMultiplier: 1, confidence: 0.9 },
    { caseId: "human-20", predictedClass: "sped_up", estimatedMultiplier: 1.8, confidence: 0.9 },
    {
      caseId: "human-ramp", predictedClass: "variable", confidence: 0.9,
      segmentPredictions: [
        { startMs: 0, endMs: 2_100, predictedClass: "real_time", estimatedMultiplier: 1 },
        { startMs: 2_100, endMs: 4_000, predictedClass: "sped_up", estimatedMultiplier: 2 },
      ],
    },
  ];
  const score = scoreSpeedBenchmark(cases, predictions, criteria);
  assert.equal(score.passed, true);
  assert.equal(score.coverage, 1);
  assert.equal(score.classAccuracy, 1);
  assert.equal(score.realTimeFalsePositiveRate, 0);
  assert.equal(score.variableSegmentAccuracy, 1);
  assert.ok((score.medianMultiplierAbsolutePercentError ?? 1) <= 0.1);
});

test("does not let abstentions or real-time false alarms hide behind accuracy", () => {
  const predictions: SpeedPrediction[] = [
    { caseId: "human-05", predictedClass: "unknown", confidence: 0.2 },
    { caseId: "human-10", predictedClass: "sped_up", estimatedMultiplier: 1.5, confidence: 0.8 },
    { caseId: "human-20", predictedClass: "sped_up", estimatedMultiplier: 2, confidence: 0.9 },
    { caseId: "human-ramp", predictedClass: "unknown", confidence: 0.2 },
  ];
  const score = scoreSpeedBenchmark(cases, predictions, criteria);
  assert.equal(score.passed, false);
  assert.equal(score.coverage, 0.5);
  assert.equal(score.realTimeFalsePositiveRate, 1);
  assert.ok((score.medianMultiplierAbsolutePercentError ?? 0) > 0.2);
  assert.match(score.failures.join("\n"), /coverage|real-time|slowed_down|variable/);
});

test("rejects duplicate and unknown case predictions", () => {
  const prediction: SpeedPrediction = { caseId: "human-10", predictedClass: "real_time", confidence: 1 };
  assert.throws(() => scoreSpeedBenchmark(cases, [prediction, prediction], criteria), /duplicate/);
  assert.throws(() => scoreSpeedBenchmark(cases, [{ ...prediction, caseId: "missing" }], criteria), /unknown speed case/);
});

test("counts missing predictions as uncovered rather than committed wrong answers", () => {
  const score = scoreSpeedBenchmark(cases, [
    { caseId: "human-10", predictedClass: "real_time", estimatedMultiplier: 1, confidence: 1 },
  ], criteria);
  assert.equal(score.committedCases, 1);
  assert.equal(score.coverage, 0.25);
  assert.equal(score.classAccuracy, 1);
  assert.equal(score.passed, false);
});
