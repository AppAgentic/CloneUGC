import type { PlaybackRateClass } from "./contracts.ts";

export type TemporalEventType =
  | "blink"
  | "gesture"
  | "gait_step"
  | "action_cycle"
  | "object_fall"
  | "physical_settling"
  | "camera_tremor"
  | "speech_phrase"
  | "mechanical_cycle"
  | "other";

export interface TemporalEventObservation {
  id: string;
  type: TemporalEventType;
  clockId: string;
  inspectionStartMs: number;
  inspectionEndMs: number;
  confidence: number;
  directlyObserved: boolean;
}

export interface NaturalDurationPrior {
  type: TemporalEventType;
  medianMs: number;
  logStandardDeviation: number;
  minimumUsefulDurationMs: number;
}

export interface TemporalAdjudicationPolicy {
  candidates: number[];
  minimumIndependentClockIds: number;
  minimumLogLikelihoodMargin: number;
}

export interface CandidateLikelihood {
  multiplier: number;
  logLikelihood: number;
  probability: number;
}

export interface TemporalAdjudication {
  classification: PlaybackRateClass;
  estimatedMultiplier?: number;
  status: "adjudicated" | "no_retiming_evidence" | "insufficient_evidence";
  confidence: number;
  candidateLikelihoods: CandidateLikelihood[];
  evidenceIds: string[];
  reason: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function classificationFor(multiplier: number): PlaybackRateClass {
  if (multiplier < 0.95) return "slowed_down";
  if (multiplier > 1.05) return "sped_up";
  return "real_time";
}

export function adjudicateTemporalEvents(
  observations: readonly TemporalEventObservation[],
  inspectionExpansionFactor: number,
  priors: readonly NaturalDurationPrior[],
  policy: TemporalAdjudicationPolicy,
): TemporalAdjudication {
  assert(Number.isFinite(inspectionExpansionFactor) && inspectionExpansionFactor > 0, "inspection expansion factor must be positive");
  assert(policy.candidates.length >= 2 && policy.candidates.every((value) => Number.isFinite(value) && value > 0), "candidate multipliers must be positive");
  assert(new Set(policy.candidates).size === policy.candidates.length, "candidate multipliers must be unique");
  assert(Number.isInteger(policy.minimumIndependentClockIds) && policy.minimumIndependentClockIds >= 1, "minimum independent clocks must be positive");
  assert(Number.isFinite(policy.minimumLogLikelihoodMargin) && policy.minimumLogLikelihoodMargin >= 0, "likelihood margin must be non-negative");

  const priorByType = new Map(priors.map((prior) => {
    assert(prior.medianMs > 0 && prior.logStandardDeviation > 0 && prior.minimumUsefulDurationMs > 0, `${prior.type} prior must be positive`);
    return [prior.type, prior] as const;
  }));
  const useful = observations.filter((observation) => {
    assert(observation.id.length > 0 && observation.clockId.length > 0, "temporal observation requires id and clockId");
    assert(Number.isInteger(observation.inspectionStartMs) && Number.isInteger(observation.inspectionEndMs), `${observation.id} timestamps must be integers`);
    assert(observation.inspectionEndMs > observation.inspectionStartMs, `${observation.id} must have positive duration`);
    assert(observation.confidence >= 0 && observation.confidence <= 1, `${observation.id} confidence must be between 0 and 1`);
    const prior = priorByType.get(observation.type);
    const deliveredDurationMs = (observation.inspectionEndMs - observation.inspectionStartMs) / inspectionExpansionFactor;
    return observation.directlyObserved && observation.confidence > 0 && prior !== undefined && deliveredDurationMs >= prior.minimumUsefulDurationMs;
  });
  const clockCount = new Set(useful.map((event) => event.clockId)).size;
  if (clockCount < policy.minimumIndependentClockIds) {
    return {
      classification: "unknown",
      status: "insufficient_evidence",
      confidence: 0,
      candidateLikelihoods: [],
      evidenceIds: useful.map((event) => event.id),
      reason: `requires ${policy.minimumIndependentClockIds} independent clocks; found ${clockCount}`,
    };
  }

  const raw = policy.candidates.map((multiplier) => {
    const logLikelihood = useful.reduce((sum, event) => {
      const prior = priorByType.get(event.type)!;
      const deliveredDurationMs = (event.inspectionEndMs - event.inspectionStartMs) / inspectionExpansionFactor;
      const impliedNaturalDurationMs = deliveredDurationMs * multiplier;
      const z = (Math.log(impliedNaturalDurationMs) - Math.log(prior.medianMs)) / prior.logStandardDeviation;
      return sum + (-0.5 * z * z) * event.confidence;
    }, 0);
    return { multiplier, logLikelihood };
  }).sort((left, right) => right.logLikelihood - left.logLikelihood);
  const maxLogLikelihood = raw[0]!.logLikelihood;
  const weights = raw.map((candidate) => Math.exp(candidate.logLikelihood - maxLogLikelihood));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const candidateLikelihoods = raw.map((candidate, index) => ({
    ...candidate,
    probability: weights[index]! / totalWeight,
  }));
  const best = candidateLikelihoods[0]!;
  const second = candidateLikelihoods[1]!;
  const margin = best.logLikelihood - second.logLikelihood;
  const clockWinners = [...new Set(useful.map((event) => event.clockId))].map((clockId) => {
    const clockEvents = useful.filter((event) => event.clockId === clockId);
    return policy.candidates.map((multiplier) => ({
      multiplier,
      logLikelihood: clockEvents.reduce((sum, event) => {
        const prior = priorByType.get(event.type)!;
        const deliveredDurationMs = (event.inspectionEndMs - event.inspectionStartMs) / inspectionExpansionFactor;
        const z = (Math.log(deliveredDurationMs * multiplier) - Math.log(prior.medianMs)) / prior.logStandardDeviation;
        return sum + (-0.5 * z * z) * event.confidence;
      }, 0),
    })).sort((left, right) => right.logLikelihood - left.logLikelihood)[0]!;
  });
  const winningClasses = new Set(clockWinners.map((winner) => classificationFor(winner.multiplier)));
  if (winningClasses.size > 1) {
    return {
      classification: "unknown",
      status: "insufficient_evidence",
      confidence: best.probability,
      candidateLikelihoods,
      evidenceIds: useful.map((event) => event.id),
      reason: "independent clocks support conflicting playback classes",
    };
  }
  if (margin < policy.minimumLogLikelihoodMargin) {
    return {
      classification: "unknown",
      status: "insufficient_evidence",
      confidence: best.probability,
      candidateLikelihoods,
      evidenceIds: useful.map((event) => event.id),
      reason: `best-versus-second log-likelihood margin ${margin.toFixed(3)} is below ${policy.minimumLogLikelihoodMargin}`,
    };
  }
  const classification = classificationFor(best.multiplier);
  return {
    classification,
    estimatedMultiplier: best.multiplier,
    status: classification === "real_time" ? "no_retiming_evidence" : "adjudicated",
    confidence: best.probability,
    candidateLikelihoods,
    evidenceIds: useful.map((event) => event.id),
    reason: `${clockCount} independent clocks support ${best.multiplier}x with log-likelihood margin ${margin.toFixed(3)}`,
  };
}
