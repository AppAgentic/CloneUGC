import type { PlaybackRateClass, TransitionType } from "./contracts.ts";

export type AnalysisLane = "static_default" | "static_5fps" | "static_10fps" | "hybrid_agentic";

export interface AnalysisEditSegment {
  startMs: number;
  endMs: number;
  playbackRateClass: PlaybackRateClass;
  transitionIn: TransitionType;
}

export interface AnnotationClaim {
  id: string;
  category: "action" | "continuity" | "lighting" | "text" | "audio" | "rights_risk";
}

export interface BlindAnnotation {
  schemaVersion: "0.2.0";
  blindToModelOutputs: true;
  annotatorId: string;
  sourceContentSha256: string;
  normalizedContentSha256: string;
  normalizedFps: number;
  originalOffsetMs: number;
  durationMs: number;
  playbackRateClass: PlaybackRateClass;
  editSegments: AnalysisEditSegment[];
  shotBoundariesMs: number[];
  actionEvents: Array<{ id: string; timeMs: number }>;
  claims: AnnotationClaim[];
}

export interface AdjudicatedPrediction {
  claimKey: string;
  annotationId?: string;
  adjudication: "supported" | "unsupported";
}

export interface AnalysisRun {
  id: string;
  lane: AnalysisLane;
  repeat: number;
  sourceContentSha256: string;
  normalizedContentSha256: string;
  exactModel: string;
  promptVersion: string;
  providerRunId: string;
  evidenceArtifactId: string;
  structuredPayloadArtifactId: string;
  playbackRateClass: PlaybackRateClass;
  editSegments: AnalysisEditSegment[];
  shotBoundariesMs: number[];
  actionEvents: Array<{ annotationId: string; timeMs: number }>;
  predictions: AdjudicatedPrediction[];
  latencyMs: number;
  totalTokens: number;
  costUsd: number;
  agenticFollowups: number;
}

export interface AnalysisBudget {
  maxAgenticFollowups: number;
  maxCostUsdPerRun: number;
  maxP95LatencyMs: number;
}

export interface BoundaryScore {
  toleranceMs: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

export interface RunScore {
  runId: string;
  boundary: BoundaryScore[];
  boundaryMaeMs: number | null;
  actionEventMaeMs: number | null;
  playbackRateCorrect: boolean | null;
  playbackRateCoverage: number | null;
  editSegmentCountError: number;
  editSegmentDurationMaeMs: number | null;
  segmentPlaybackRateAccuracy: number | null;
  segmentPlaybackRateCoverage: number;
  transitionTypeAccuracy: number;
  claimPrecision: number;
  claimRecall: number;
  lightingClaimRecall: number;
  rightsRiskRecall: number;
  unsupportedClaimRate: number;
}

export interface LaneScore {
  lane: AnalysisLane;
  exactModel: string;
  promptVersion: string;
  repeats: number;
  runs: RunScore[];
  claimStability: number;
  averageTokens: number;
  averageCostUsd: number;
  p95LatencyMs: number;
  budgetPassed: boolean;
  budgetFailures: string[];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? (numerator === 0 ? 1 : 0) : numerator / denominator;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertSha256(value: unknown, name: string): asserts value is string {
  assert(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), `${name} must be a lowercase SHA-256 hash`);
}

function assertFiniteNonNegative(value: unknown, name: string): asserts value is number {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${name} must be finite and non-negative`);
}

function validateTimes(times: readonly number[], name: string): void {
  assert(Array.isArray(times), `${name} must be an array`);
  for (const value of times) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} contains an invalid timestamp`);
  }
}

function validateAnnotation(annotation: BlindAnnotation): void {
  assert(annotation !== null && typeof annotation === "object", "annotation must be an object");
  assert(annotation.schemaVersion === "0.2.0" && annotation.blindToModelOutputs === true, "annotation must be versioned and blind to model outputs");
  assert(typeof annotation.annotatorId === "string" && annotation.annotatorId.length > 0, "annotation requires an annotator id");
  assertSha256(annotation.sourceContentSha256, "annotation sourceContentSha256");
  assertSha256(annotation.normalizedContentSha256, "annotation normalizedContentSha256");
  assertFiniteNonNegative(annotation.normalizedFps, "annotation normalizedFps");
  assert(annotation.normalizedFps > 0, "annotation normalizedFps must be positive");
  assert(Number.isInteger(annotation.originalOffsetMs) && annotation.originalOffsetMs >= 0, "annotation originalOffsetMs must be a non-negative integer");
  assert(Number.isInteger(annotation.durationMs) && annotation.durationMs > 0 && annotation.durationMs <= 30_000, "annotation durationMs must be an integer from 1 to 30000");
  validatePlaybackRateClass(annotation.playbackRateClass, "annotation playback rate");
  validateEditSegments(annotation.editSegments, annotation.durationMs, "annotation");
  validateTimes(annotation.shotBoundariesMs, "annotation shot boundaries");
  assert(annotation.shotBoundariesMs.every((time) => time > 0 && time < annotation.durationMs), "annotation shot boundaries must be internal to the clip");
  assert(Array.isArray(annotation.actionEvents), "annotation action events must be an array");
  assert(Array.isArray(annotation.claims), "annotation claims must be an array");
  const actionIds = new Set<string>();
  for (const event of annotation.actionEvents) {
    assert(typeof event.id === "string" && event.id.length > 0, "annotation action event requires an id");
    assert(!actionIds.has(event.id), `duplicate annotation action event ${event.id}`);
    actionIds.add(event.id);
    validateTimes([event.timeMs], `annotation action event ${event.id}`);
  }
  const claimIds = new Set<string>();
  for (const claim of annotation.claims) {
    assert(typeof claim.id === "string" && claim.id.length > 0, "annotation claim requires an id");
    assert(!claimIds.has(claim.id), `duplicate annotation claim ${claim.id}`);
    claimIds.add(claim.id);
    assert(["action", "continuity", "lighting", "text", "audio", "rights_risk"].includes(claim.category), `annotation claim ${claim.id} has an invalid category`);
  }
}

const playbackRateClasses: PlaybackRateClass[] = ["real_time", "sped_up", "slowed_down", "variable", "unknown"];
const transitionTypes: TransitionType[] = ["none", "hard_cut", "dissolve", "fade", "wipe", "match_cut", "other"];

function validatePlaybackRateClass(value: PlaybackRateClass, name: string): void {
  assert(playbackRateClasses.includes(value), `${name} has an invalid classification`);
}

function validateEditSegments(segments: readonly AnalysisEditSegment[], durationMs: number, owner: string): void {
  assert(Array.isArray(segments) && segments.length > 0, `${owner} requires edit segments`);
  let expectedStart = 0;
  for (const [index, segment] of segments.entries()) {
    assert(Number.isInteger(segment.startMs) && Number.isInteger(segment.endMs), `${owner} edit segment timestamps must be integers`);
    assert(segment.startMs === expectedStart && segment.endMs > segment.startMs, `${owner} edit segments must be positive, ordered, and contiguous`);
    validatePlaybackRateClass(segment.playbackRateClass, `${owner} edit segment playback rate`);
    assert(transitionTypes.includes(segment.transitionIn), `${owner} edit segment has an invalid transition`);
    assert(index !== 0 || segment.transitionIn === "none", `${owner} first edit segment must use transitionIn none`);
    expectedStart = segment.endMs;
  }
  assert(expectedStart === durationMs, `${owner} edit segments must cover the full clip`);
}

function matchTimeErrors(expected: readonly number[], predicted: readonly number[], toleranceMs: number): number[] {
  const actual = [...expected].sort((a, b) => a - b);
  const guesses = [...predicted].sort((a, b) => a - b);
  type Match = { errors: number[]; totalError: number };
  const memo = new Map<string, Match>();

  const better = (left: Match, right: Match): Match => {
    if (left.errors.length !== right.errors.length) return left.errors.length > right.errors.length ? left : right;
    return left.totalError <= right.totalError ? left : right;
  };

  const solve = (actualIndex: number, guessIndex: number): Match => {
    if (actualIndex >= actual.length || guessIndex >= guesses.length) return { errors: [], totalError: 0 };
    const key = `${actualIndex}:${guessIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let best = better(solve(actualIndex + 1, guessIndex), solve(actualIndex, guessIndex + 1));
    const error = Math.abs(actual[actualIndex]! - guesses[guessIndex]!);
    if (error <= toleranceMs) {
      const rest = solve(actualIndex + 1, guessIndex + 1);
      best = better(best, { errors: [error, ...rest.errors], totalError: error + rest.totalError });
    }
    memo.set(key, best);
    return best;
  };

  return solve(0, 0).errors;
}

function matchEditSegments(
  expected: readonly AnalysisEditSegment[],
  predicted: readonly AnalysisEditSegment[],
): Array<{ expectedIndex: number; predictedIndex: number }> {
  type Match = { pairs: Array<{ expectedIndex: number; predictedIndex: number }>; totalOverlapMs: number };
  const memo = new Map<string, Match>();
  const better = (left: Match, right: Match): Match => {
    if (left.totalOverlapMs !== right.totalOverlapMs) return left.totalOverlapMs > right.totalOverlapMs ? left : right;
    return left.pairs.length >= right.pairs.length ? left : right;
  };
  const solve = (expectedIndex: number, predictedIndex: number): Match => {
    if (expectedIndex >= expected.length || predictedIndex >= predicted.length) return { pairs: [], totalOverlapMs: 0 };
    const key = `${expectedIndex}:${predictedIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best = better(solve(expectedIndex + 1, predictedIndex), solve(expectedIndex, predictedIndex + 1));
    const actual = expected[expectedIndex]!;
    const guess = predicted[predictedIndex]!;
    const overlapMs = Math.max(0, Math.min(actual.endMs, guess.endMs) - Math.max(actual.startMs, guess.startMs));
    if (overlapMs > 0) {
      const rest = solve(expectedIndex + 1, predictedIndex + 1);
      best = better(best, {
        pairs: [{ expectedIndex, predictedIndex }, ...rest.pairs],
        totalOverlapMs: overlapMs + rest.totalOverlapMs,
      });
    }
    memo.set(key, best);
    return best;
  };
  return solve(0, 0).pairs;
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export function scoreRun(annotation: BlindAnnotation, run: AnalysisRun): RunScore {
  validateAnnotation(annotation);
  if (annotation.sourceContentSha256 !== run.sourceContentSha256) throw new Error("annotation and run source hashes differ");
  if (annotation.normalizedContentSha256 !== run.normalizedContentSha256) throw new Error("annotation and run normalized hashes differ");
  validateTimes(run.shotBoundariesMs, "run shot boundaries");

  const boundary = [100, 250, 500].map((toleranceMs) => {
    const truePositives = matchTimeErrors(annotation.shotBoundariesMs, run.shotBoundariesMs, toleranceMs).length;
    return {
      toleranceMs,
      truePositives,
      falsePositives: run.shotBoundariesMs.length - truePositives,
      falseNegatives: annotation.shotBoundariesMs.length - truePositives,
      precision: ratio(truePositives, run.shotBoundariesMs.length),
      recall: ratio(truePositives, annotation.shotBoundariesMs.length),
    };
  });

  const actionById = new Map(annotation.actionEvents.map((event) => [event.id, event.timeMs]));
  const actionErrors = run.actionEvents.flatMap((event) => {
    const actual = actionById.get(event.annotationId);
    if (actual === undefined) throw new Error(`run action event references unknown annotation ${event.annotationId}`);
    return [Math.abs(actual - event.timeMs)];
  });
  const supported = run.predictions.filter((prediction) => prediction.adjudication === "supported");
  const matchedIds = new Set(supported.flatMap((prediction) => prediction.annotationId === undefined ? [] : [prediction.annotationId]));
  const annotationIds = new Set(annotation.claims.map((claim) => claim.id));
  for (const prediction of supported) {
    if (prediction.annotationId === undefined || !annotationIds.has(prediction.annotationId)) {
      throw new Error(`supported prediction ${prediction.claimKey} lacks a valid annotation id`);
    }
  }
  const validMatches = new Set([...matchedIds].filter((id) => annotationIds.has(id)));
  const lightingIds = new Set(annotation.claims.filter((claim) => claim.category === "lighting").map((claim) => claim.id));
  const matchedLighting = [...validMatches].filter((id) => lightingIds.has(id)).length;
  const rightsRiskIds = new Set(annotation.claims.filter((claim) => claim.category === "rights_risk").map((claim) => claim.id));
  const matchedRightsRisks = [...validMatches].filter((id) => rightsRiskIds.has(id)).length;

  const boundaryErrors = matchTimeErrors(annotation.shotBoundariesMs, run.shotBoundariesMs, 500);
  const segmentPairs = matchEditSegments(annotation.editSegments, run.editSegments);
  const segmentDurationErrors = segmentPairs.map(({ expectedIndex, predictedIndex }) => {
    const segment = annotation.editSegments[expectedIndex]!;
    const predicted = run.editSegments[predictedIndex]!;
    return Math.abs((segment.endMs - segment.startMs) - (predicted.endMs - predicted.startMs));
  });
  const knownAnnotationSegments = annotation.editSegments.filter((segment) => segment.playbackRateClass !== "unknown").length;
  const committedSegmentPairs = segmentPairs.filter(({ expectedIndex, predictedIndex }) => (
    annotation.editSegments[expectedIndex]!.playbackRateClass !== "unknown"
      && run.editSegments[predictedIndex]!.playbackRateClass !== "unknown"
  ));
  const segmentPlaybackMatches = committedSegmentPairs
    .filter(({ expectedIndex, predictedIndex }) => annotation.editSegments[expectedIndex]!.playbackRateClass === run.editSegments[predictedIndex]!.playbackRateClass).length;
  const unmatchedCommittedPredictions = run.editSegments.filter((segment, predictedIndex) => (
    segment.playbackRateClass !== "unknown" && !segmentPairs.some((pair) => pair.predictedIndex === predictedIndex)
  )).length;
  const committedSegmentAnswers = committedSegmentPairs.length + unmatchedCommittedPredictions;
  const transitionMatches = segmentPairs
    .filter(({ expectedIndex, predictedIndex }) => annotation.editSegments[expectedIndex]!.transitionIn === run.editSegments[predictedIndex]!.transitionIn).length;
  const segmentDenominator = Math.max(annotation.editSegments.length, run.editSegments.length);
  const globalPlaybackScorable = annotation.playbackRateClass !== "unknown";
  const globalPlaybackCommitted = run.playbackRateClass !== "unknown";
  return {
    runId: run.id,
    boundary,
    boundaryMaeMs: boundaryErrors.length === 0 ? null : boundaryErrors.reduce((sum, error) => sum + error, 0) / boundaryErrors.length,
    actionEventMaeMs: actionErrors.length === 0 ? null : actionErrors.reduce((sum, value) => sum + value, 0) / actionErrors.length,
    playbackRateCorrect: globalPlaybackScorable && globalPlaybackCommitted ? annotation.playbackRateClass === run.playbackRateClass : null,
    playbackRateCoverage: globalPlaybackScorable ? (globalPlaybackCommitted ? 1 : 0) : null,
    editSegmentCountError: Math.abs(annotation.editSegments.length - run.editSegments.length),
    editSegmentDurationMaeMs: segmentDurationErrors.length === 0 ? null : segmentDurationErrors.reduce((sum, value) => sum + value, 0) / segmentDurationErrors.length,
    segmentPlaybackRateAccuracy: committedSegmentAnswers === 0 ? null : ratio(segmentPlaybackMatches, committedSegmentAnswers),
    segmentPlaybackRateCoverage: ratio(committedSegmentPairs.length, knownAnnotationSegments),
    transitionTypeAccuracy: ratio(transitionMatches, segmentDenominator),
    claimPrecision: ratio(validMatches.size, run.predictions.length),
    claimRecall: ratio(validMatches.size, annotation.claims.length),
    lightingClaimRecall: ratio(matchedLighting, lightingIds.size),
    rightsRiskRecall: ratio(matchedRightsRisks, rightsRiskIds.size),
    unsupportedClaimRate: ratio(run.predictions.length - supported.length, run.predictions.length),
  };
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((value) => right.has(value)).length / union.size;
}

export function scoreLane(annotation: BlindAnnotation, runs: readonly AnalysisRun[], budget: AnalysisBudget): LaneScore {
  validateAnnotation(annotation);
  assert(budget !== null && typeof budget === "object", "budget must be an object");
  assert(Number.isInteger(budget.maxAgenticFollowups) && budget.maxAgenticFollowups >= 0, "agentic follow-up budget must be a non-negative integer");
  assertFiniteNonNegative(budget.maxCostUsdPerRun, "per-run cost budget");
  assertFiniteNonNegative(budget.maxP95LatencyMs, "p95 latency budget");
  if (runs.length < 3) throw new Error("a lane requires at least three repeated runs");
  const first = runs[0];
  if (first === undefined) throw new Error("lane has no runs");
  const repeats = new Set<number>();
  for (const run of runs) {
    assert(run !== null && typeof run === "object", "lane run must be an object");
    assert(typeof run.id === "string" && run.id.length > 0, "lane run requires an id");
    assert(Number.isInteger(run.repeat) && run.repeat >= 1, "repeat must be a positive integer");
    assertSha256(run.sourceContentSha256, "run sourceContentSha256");
    assertSha256(run.normalizedContentSha256, "run normalizedContentSha256");
    assert(typeof run.exactModel === "string" && run.exactModel.length > 0, "run requires an exact model");
    assert(typeof run.promptVersion === "string" && run.promptVersion.length > 0, "run requires a prompt version");
    if (!Array.isArray(run.shotBoundariesMs)) throw new Error("run shot boundaries must be an array");
    if (!Array.isArray(run.editSegments)) throw new Error("run edit segments must be an array");
    if (!Array.isArray(run.actionEvents)) throw new Error("run action events must be an array");
    if (!Array.isArray(run.predictions)) throw new Error("run predictions must be an array");
    if (run.lane !== first.lane || run.exactModel !== first.exactModel || run.promptVersion !== first.promptVersion) {
      throw new Error("lane repeats must pin lane, exact model, and prompt version");
    }
    if (run.sourceContentSha256 !== annotation.sourceContentSha256) throw new Error("lane contains a different source hash");
    if (run.normalizedContentSha256 !== annotation.normalizedContentSha256) throw new Error("lane contains a different normalized hash");
    validatePlaybackRateClass(run.playbackRateClass, "run playback rate");
    validateEditSegments(run.editSegments, annotation.durationMs, "run");
    if (run.exactModel.endsWith("-latest")) throw new Error("moving model aliases are forbidden");
    if (run.providerRunId.length === 0 || run.evidenceArtifactId.length === 0 || run.structuredPayloadArtifactId.length === 0) {
      throw new Error("lane run is missing evidence provenance");
    }
    if (!Number.isInteger(run.agenticFollowups) || run.agenticFollowups < 0) throw new Error("agentic follow-ups must be a non-negative integer");
    if (run.lane !== "hybrid_agentic" && run.agenticFollowups !== 0) throw new Error("static lanes cannot contain agentic follow-ups");
    assertFiniteNonNegative(run.latencyMs, "run latencyMs");
    assertFiniteNonNegative(run.totalTokens, "run totalTokens");
    assertFiniteNonNegative(run.costUsd, "run costUsd");
    assert(Number.isInteger(run.totalTokens), "run totalTokens must be an integer");
    validateTimes(run.shotBoundariesMs, "run shot boundaries");
    for (const event of run.actionEvents) {
      assert(typeof event.annotationId === "string" && event.annotationId.length > 0, "run action event requires an annotation id");
      validateTimes([event.timeMs], `run action event ${event.annotationId}`);
    }
    for (const prediction of run.predictions) {
      assert(typeof prediction.claimKey === "string" && prediction.claimKey.length > 0, "prediction requires a claim key");
      assert(prediction.adjudication === "supported" || prediction.adjudication === "unsupported", `prediction ${prediction.claimKey} has an invalid adjudication`);
    }
    if (repeats.has(run.repeat)) throw new Error(`duplicate repeat ${run.repeat}`);
    repeats.add(run.repeat);
  }

  const claimSets = runs.map((run) => new Set(run.predictions.filter((item) => item.adjudication === "supported").map((item) => item.claimKey)));
  const stabilityPairs: number[] = [];
  for (let left = 0; left < claimSets.length; left += 1) {
    for (let right = left + 1; right < claimSets.length; right += 1) {
      stabilityPairs.push(jaccard(claimSets[left] ?? new Set(), claimSets[right] ?? new Set()));
    }
  }

  const p95LatencyMs = percentile95(runs.map((run) => run.latencyMs));
  const averageCostUsd = runs.reduce((sum, run) => sum + run.costUsd, 0) / runs.length;
  const budgetFailures: string[] = [];
  if (runs.some((run) => run.agenticFollowups > budget.maxAgenticFollowups)) budgetFailures.push("agentic follow-up limit exceeded");
  if (runs.some((run) => run.costUsd > budget.maxCostUsdPerRun)) budgetFailures.push("per-run cost limit exceeded");
  if (p95LatencyMs > budget.maxP95LatencyMs) budgetFailures.push("p95 latency limit exceeded");

  return {
    lane: first.lane,
    exactModel: first.exactModel,
    promptVersion: first.promptVersion,
    repeats: runs.length,
    runs: runs.map((run) => scoreRun(annotation, run)),
    claimStability: stabilityPairs.reduce((sum, value) => sum + value, 0) / stabilityPairs.length,
    averageTokens: runs.reduce((sum, run) => sum + run.totalTokens, 0) / runs.length,
    averageCostUsd,
    p95LatencyMs,
    budgetPassed: budgetFailures.length === 0,
    budgetFailures,
  };
}

export interface BenchmarkCase {
  schemaVersion: "0.2.0";
  annotation: BlindAnnotation;
  budget: AnalysisBudget;
  runs: AnalysisRun[];
}

export function scoreBenchmarkCase(input: BenchmarkCase): LaneScore[] {
  assert(input !== null && typeof input === "object", "benchmark case must be an object");
  if (input.schemaVersion !== "0.2.0") throw new Error("unsupported benchmark case version");
  validateAnnotation(input.annotation);
  assert(Array.isArray(input.runs), "benchmark case runs must be an array");
  const groups = new Map<string, AnalysisRun[]>();
  for (const run of input.runs) {
    const key = `${run.lane}:${run.exactModel}:${run.promptVersion}`;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return [...groups.values()].map((runs) => scoreLane(input.annotation, runs, input.budget));
}
