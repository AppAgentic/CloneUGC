import type { PlaybackRateClass } from "./contracts.ts";

export type SpeedTransformKind = "constant" | "ramp" | "freeze" | "reverse" | "loop";

export interface SpeedBenchmarkCase {
  id: string;
  family: string;
  transform: SpeedTransformKind;
  expectedClass: PlaybackRateClass;
  expectedMultiplier?: number;
  expectedSegments?: Array<{
    startMs: number;
    endMs: number;
    expectedClass: PlaybackRateClass;
    expectedMultiplier?: number;
  }>;
}

export interface SpeedPrediction {
  caseId: string;
  predictedClass: PlaybackRateClass;
  estimatedMultiplier?: number;
  confidence: number;
  segmentPredictions?: Array<{
    startMs: number;
    endMs: number;
    predictedClass: PlaybackRateClass;
    estimatedMultiplier?: number;
  }>;
}

export interface SpeedAcceptanceCriteria {
  minClassAccuracy: number;
  minCoverage: number;
  minPerClassRecall: number;
  maxRealTimeFalsePositiveRate: number;
  maxMedianMultiplierAbsoluteLog2Error: number;
  minVariableSegmentAccuracy: number;
}

export interface SpeedBenchmarkScore {
  totalCases: number;
  committedCases: number;
  coverage: number;
  classAccuracy: number;
  perClassRecall: Partial<Record<PlaybackRateClass, number>>;
  realTimeFalsePositiveRate: number;
  medianMultiplierAbsoluteLog2Error: number | null;
  variableSegmentAccuracy: number | null;
  passed: boolean;
  failures: string[];
}

const classes: PlaybackRateClass[] = ["real_time", "sped_up", "slowed_down", "variable", "unknown"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? null;
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function validateCase(item: SpeedBenchmarkCase): void {
  assert(item.id.length > 0 && item.family.length > 0, "speed case requires id and family");
  assert(classes.includes(item.expectedClass), `${item.id} has invalid expected class`);
  if (item.expectedMultiplier !== undefined) {
    assert(Number.isFinite(item.expectedMultiplier) && item.expectedMultiplier > 0, `${item.id} expected multiplier must be positive`);
    assert(item.expectedClass !== "variable" && item.expectedClass !== "unknown", `${item.id} cannot attach one multiplier to ${item.expectedClass}`);
  }
  for (const segment of item.expectedSegments ?? []) {
    assert(Number.isInteger(segment.startMs) && Number.isInteger(segment.endMs) && segment.endMs > segment.startMs, `${item.id} has invalid expected segment`);
    assert(classes.includes(segment.expectedClass), `${item.id} has invalid segment class`);
  }
}

function validatePrediction(prediction: SpeedPrediction): void {
  assert(classes.includes(prediction.predictedClass), `${prediction.caseId} has invalid predicted class`);
  assert(Number.isFinite(prediction.confidence) && prediction.confidence >= 0 && prediction.confidence <= 1, `${prediction.caseId} confidence must be between 0 and 1`);
  if (prediction.estimatedMultiplier !== undefined) {
    assert(Number.isFinite(prediction.estimatedMultiplier) && prediction.estimatedMultiplier > 0, `${prediction.caseId} multiplier must be positive`);
  }
}

function overlapMs(left: { startMs: number; endMs: number }, right: { startMs: number; endMs: number }): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

export function scoreSpeedBenchmark(
  cases: readonly SpeedBenchmarkCase[],
  predictions: readonly SpeedPrediction[],
  criteria: SpeedAcceptanceCriteria,
): SpeedBenchmarkScore {
  assert(cases.length > 0, "speed benchmark requires at least one case");
  const caseById = new Map<string, SpeedBenchmarkCase>();
  for (const item of cases) {
    validateCase(item);
    assert(!caseById.has(item.id), `duplicate speed case ${item.id}`);
    caseById.set(item.id, item);
  }
  const predictionById = new Map<string, SpeedPrediction>();
  for (const prediction of predictions) {
    validatePrediction(prediction);
    assert(caseById.has(prediction.caseId), `prediction references unknown speed case ${prediction.caseId}`);
    assert(!predictionById.has(prediction.caseId), `duplicate speed prediction ${prediction.caseId}`);
    predictionById.set(prediction.caseId, prediction);
  }

  const committed = cases.filter((item) => {
    const prediction = predictionById.get(item.id);
    return prediction !== undefined && prediction.predictedClass !== "unknown";
  });
  const correct = committed.filter((item) => predictionById.get(item.id)?.predictedClass === item.expectedClass);
  const expectedClasses = [...new Set(cases.map((item) => item.expectedClass).filter((item) => item !== "unknown"))];
  const perClassRecall: Partial<Record<PlaybackRateClass, number>> = {};
  for (const expectedClass of expectedClasses) {
    const matching = cases.filter((item) => item.expectedClass === expectedClass);
    perClassRecall[expectedClass] = ratio(
      matching.filter((item) => predictionById.get(item.id)?.predictedClass === expectedClass).length,
      matching.length,
    );
  }

  const realTime = cases.filter((item) => item.expectedClass === "real_time");
  const falsePositiveRealTime = realTime.filter((item) => {
    const predicted = predictionById.get(item.id)?.predictedClass;
    return predicted !== undefined && predicted !== "unknown" && predicted !== "real_time";
  });
  const multiplierErrors = cases.flatMap((item) => {
    const expected = item.expectedMultiplier;
    const predicted = predictionById.get(item.id)?.estimatedMultiplier;
    return expected === undefined || predicted === undefined ? [] : [Math.abs(Math.log2(predicted / expected))];
  });

  let variableSegmentCorrect = 0;
  let variableSegmentTotal = 0;
  for (const item of cases.filter((candidate) => candidate.expectedClass === "variable")) {
    const prediction = predictionById.get(item.id);
    for (const expected of item.expectedSegments ?? []) {
      variableSegmentTotal += 1;
      const best = (prediction?.segmentPredictions ?? [])
        .map((candidate) => ({ candidate, overlap: overlapMs(expected, candidate) }))
        .sort((left, right) => right.overlap - left.overlap)[0];
      if (best !== undefined && best.overlap > 0 && best.candidate.predictedClass === expected.expectedClass) {
        variableSegmentCorrect += 1;
      }
    }
  }

  const score = {
    totalCases: cases.length,
    committedCases: committed.length,
    coverage: ratio(committed.length, cases.length),
    classAccuracy: ratio(correct.length, committed.length),
    perClassRecall,
    realTimeFalsePositiveRate: ratio(falsePositiveRealTime.length, realTime.length),
    medianMultiplierAbsoluteLog2Error: median(multiplierErrors),
    variableSegmentAccuracy: variableSegmentTotal === 0 ? null : ratio(variableSegmentCorrect, variableSegmentTotal),
  };
  const failures: string[] = [];
  if (score.classAccuracy < criteria.minClassAccuracy) failures.push("class accuracy below gate");
  if (score.coverage < criteria.minCoverage) failures.push("answer coverage below gate");
  for (const [className, recall] of Object.entries(score.perClassRecall)) {
    if (recall < criteria.minPerClassRecall) failures.push(`${className} recall below gate`);
  }
  if (score.realTimeFalsePositiveRate > criteria.maxRealTimeFalsePositiveRate) failures.push("real-time false-positive rate above gate");
  if (score.medianMultiplierAbsoluteLog2Error === null || score.medianMultiplierAbsoluteLog2Error > criteria.maxMedianMultiplierAbsoluteLog2Error) {
    failures.push("multiplier error above gate or unmeasured");
  }
  if (score.variableSegmentAccuracy !== null && score.variableSegmentAccuracy < criteria.minVariableSegmentAccuracy) {
    failures.push("variable-speed segment accuracy below gate");
  }
  return { ...score, passed: failures.length === 0, failures };
}
