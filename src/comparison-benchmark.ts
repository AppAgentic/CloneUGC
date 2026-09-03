import { contentHash } from "./canonical.ts";
import { FIDELITY_DIMENSIONS, type FidelityDimension } from "./directives.ts";

export const COMPARISON_DIMENSIONS = [
  "timing_edits_playback",
  "camera_geometry",
  "action_causality",
  "secondary_motion",
  "continuity",
  "lighting_texture",
  "audio_performance",
  "requested_change",
  "unwanted_transfer",
  "commercial_usability",
] as const;

export type ComparisonDimension = (typeof COMPARISON_DIMENSIONS)[number];
export type ComparisonLane = "control" | "compiler";
export type BlindSlot = "A" | "B";

export interface PaidGenerationUnitEvidence {
  unitId: string;
  providerRequestId: string;
  seed: string;
  promptHash: string;
  sourceHash: string;
  specHash: string;
  outputHash: string;
  estimatedCostUsdMicros: number;
  actualCostUsdMicros: number;
  latencyMs: number;
  deliveredDurationMs: number;
}

export interface ComparisonVariantEvidence {
  slot: BlindSlot;
  outputHash: string;
  units: PaidGenerationUnitEvidence[];
}

/** The slot mapping is sealed away from scorers until every ballot is committed. */
export interface SealedComparisonPair {
  id: string;
  family: string;
  sourceHash: string;
  requestedChange: string;
  fidelityMapHash: string;
  slotToLane: Record<BlindSlot, ComparisonLane>;
  variants: [ComparisonVariantEvidence, ComparisonVariantEvidence];
}

export interface BlindComparisonBallot {
  pairId: string;
  scorerId: string;
  blindToLane: true;
  preferredSlot: BlindSlot | "tie";
  scores: Record<BlindSlot, Record<ComparisonDimension, number>>;
  rightsRegression: Record<BlindSlot, boolean>;
  commerciallyUsable: Record<BlindSlot, boolean>;
  /** Every material failure must point to a typed repair dimension. */
  repairableDimensions: Record<BlindSlot, FidelityDimension[]>;
}

export interface Phase0ComparisonBundle {
  schemaVersion: "0.1.0";
  pairs: SealedComparisonPair[];
  ballots: BlindComparisonBallot[];
  maxActualCostUsdMicrosPerPair: number;
}

export interface PairComparisonScore {
  pairId: string;
  family: string;
  compilerSlot: BlindSlot;
  compilerPreferences: number;
  controlPreferences: number;
  ties: number;
  compilerMedianScore: number;
  controlMedianScore: number;
  compilerRightsRegression: boolean;
  compilerCommerciallyUsable: boolean;
  allMaterialFailuresRepairable: boolean;
  actualCostUsdMicros: number;
  passed: boolean;
  failures: string[];
}

export interface Phase0ComparisonScore {
  pairs: PairComparisonScore[];
  allFamiliesPassed: boolean;
  atLeastOneCommerciallyUsable: boolean;
  costPlausible: boolean;
  passed: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHash(value: string, field: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${field} must be a lowercase SHA-256 hash`);
}

function assertNonNegativeInteger(value: number, field: string): void {
  assert(Number.isSafeInteger(value) && value >= 0, `${field} must be a non-negative integer`);
}

function assertBlindSlot(value: unknown, field: string): asserts value is BlindSlot {
  assert(value === "A" || value === "B", `${field} must be A or B`);
}

function assertComparisonLane(value: unknown, field: string): asserts value is ComparisonLane {
  assert(value === "control" || value === "compiler", `${field} must be control or compiler`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function validateUnit(unit: PaidGenerationUnitEvidence, pair: SealedComparisonPair): void {
  assert(unit !== null && typeof unit === "object", `pair ${pair.id} paid unit must be an object`);
  assert(unit.unitId.length > 0 && unit.providerRequestId.length > 0 && unit.seed.length > 0, "paid unit requires id, provider request id, and seed");
  for (const [name, value] of [["promptHash", unit.promptHash], ["sourceHash", unit.sourceHash], ["specHash", unit.specHash], ["outputHash", unit.outputHash]] as const) assertHash(value, `unit ${unit.unitId} ${name}`);
  assert(unit.sourceHash === pair.sourceHash, `unit ${unit.unitId} source hash differs from pair`);
  for (const [name, value] of [["estimatedCostUsdMicros", unit.estimatedCostUsdMicros], ["actualCostUsdMicros", unit.actualCostUsdMicros], ["latencyMs", unit.latencyMs], ["deliveredDurationMs", unit.deliveredDurationMs]] as const) assertNonNegativeInteger(value, `unit ${unit.unitId} ${name}`);
  assert(unit.deliveredDurationMs > 0, `unit ${unit.unitId} delivered duration must be positive`);
}

function validatePair(pair: SealedComparisonPair): void {
  assert(pair !== null && typeof pair === "object", "comparison pair must be an object");
  assert(pair.id.trim().length > 0 && pair.family.trim().length > 0 && pair.requestedChange.trim().length > 0, "comparison pair requires id, family, and requested change");
  assertHash(pair.sourceHash, `pair ${pair.id} sourceHash`);
  assertHash(pair.fidelityMapHash, `pair ${pair.id} fidelityMapHash`);
  assert(pair.slotToLane !== null && typeof pair.slotToLane === "object", `pair ${pair.id} requires a blind slot mapping`);
  assertComparisonLane(pair.slotToLane.A, `pair ${pair.id} slot A lane`);
  assertComparisonLane(pair.slotToLane.B, `pair ${pair.id} slot B lane`);
  assert(pair.slotToLane.A !== pair.slotToLane.B, `pair ${pair.id} must map one blind slot to each lane`);
  assert(Array.isArray(pair.variants) && pair.variants.length === 2, `pair ${pair.id} requires unique A and B variants`);
  for (const variant of pair.variants) assertBlindSlot(variant.slot, `pair ${pair.id} variant slot`);
  assert(new Set(pair.variants.map((variant) => variant.slot)).size === 2, `pair ${pair.id} requires unique A and B variants`);
  for (const variant of pair.variants) {
    assertHash(variant.outputHash, `pair ${pair.id} variant ${variant.slot} outputHash`);
    assert(variant.units.length > 0, `pair ${pair.id} variant ${variant.slot} requires paid-unit evidence`);
    const ids = new Set<string>();
    for (const unit of variant.units) {
      assert(!ids.has(unit.unitId), `pair ${pair.id} variant ${variant.slot} has duplicate unit ${unit.unitId}`);
      ids.add(unit.unitId);
      validateUnit(unit, pair);
    }
  }
}

function ballotTotal(ballot: BlindComparisonBallot, slot: BlindSlot): number {
  return COMPARISON_DIMENSIONS.reduce((sum, dimension) => sum + ballot.scores[slot][dimension], 0);
}

export function scorePhase0Comparisons(bundle: Phase0ComparisonBundle): Phase0ComparisonScore {
  assert(bundle !== null && typeof bundle === "object", "comparison bundle must be an object");
  assert(bundle.schemaVersion === "0.1.0", "unsupported comparison bundle version");
  assert(Array.isArray(bundle.pairs) && bundle.pairs.length === 3, "Phase 0A requires exactly three comparison families");
  assertNonNegativeInteger(bundle.maxActualCostUsdMicrosPerPair, "maximum actual cost per pair");
  assert(bundle.maxActualCostUsdMicrosPerPair > 0, "maximum actual cost per pair must be positive");
  const pairIds = new Set<string>();
  const families = new Set<string>();
  assert(Array.isArray(bundle.ballots), "comparison ballots must be an array");
  const pairScores = bundle.pairs.map((pair) => {
    validatePair(pair);
    assert(!pairIds.has(pair.id), `duplicate comparison pair ${pair.id}`);
    assert(!families.has(pair.family), `duplicate comparison family ${pair.family}`);
    pairIds.add(pair.id);
    families.add(pair.family);
    const ballots = bundle.ballots.filter((ballot) => ballot.pairId === pair.id);
    assert(ballots.length >= 3, `pair ${pair.id} requires at least three blind scorers`);
    assert(new Set(ballots.map((ballot) => ballot.scorerId)).size === ballots.length, `pair ${pair.id} contains duplicate scorer ballots`);
    for (const ballot of ballots) {
      assert(ballot !== null && typeof ballot === "object", `pair ${pair.id} ballot must be an object`);
      assert(ballot.scorerId.trim().length > 0 && ballot.blindToLane === true, `pair ${pair.id} ballots must identify a lane-blind scorer`);
      assert(["A", "B", "tie"].includes(ballot.preferredSlot), `pair ${pair.id} ballot has invalid preference`);
      for (const slot of ["A", "B"] as const) {
        assert(ballot.scores !== null && typeof ballot.scores === "object" && ballot.scores[slot] !== null && typeof ballot.scores[slot] === "object", `pair ${pair.id} ballot requires ${slot} scores`);
        assert(Object.keys(ballot.scores[slot]).length === COMPARISON_DIMENSIONS.length, `pair ${pair.id} ballot must score every dimension`);
        for (const dimension of COMPARISON_DIMENSIONS) {
          const value = ballot.scores[slot][dimension];
          assert(Number.isFinite(value) && value >= 0 && value <= 100, `pair ${pair.id} score ${slot}.${dimension} must be 0-100`);
        }
        assert(ballot.rightsRegression !== null && typeof ballot.rightsRegression?.[slot] === "boolean", `pair ${pair.id} ballot requires ${slot} rights regression judgment`);
        assert(ballot.commerciallyUsable !== null && typeof ballot.commerciallyUsable?.[slot] === "boolean", `pair ${pair.id} ballot requires ${slot} commercial usability judgment`);
        assert(Array.isArray(ballot.repairableDimensions?.[slot]), `pair ${pair.id} ballot requires ${slot} repair dimensions`);
        for (const dimension of ballot.repairableDimensions[slot]) assert((FIDELITY_DIMENSIONS as readonly string[]).includes(dimension), `pair ${pair.id} ballot names an invalid repair dimension`);
      }
    }
    const compilerSlot: BlindSlot = pair.slotToLane.A === "compiler" ? "A" : "B";
    const controlSlot: BlindSlot = compilerSlot === "A" ? "B" : "A";
    const compilerPreferences = ballots.filter((ballot) => ballot.preferredSlot === compilerSlot).length;
    const controlPreferences = ballots.filter((ballot) => ballot.preferredSlot === controlSlot).length;
    const ties = ballots.length - compilerPreferences - controlPreferences;
    const compilerMedianScore = median(ballots.map((ballot) => ballotTotal(ballot, compilerSlot)));
    const controlMedianScore = median(ballots.map((ballot) => ballotTotal(ballot, controlSlot)));
    const compilerRightsRegression = ballots.some((ballot) => ballot.rightsRegression[compilerSlot]);
    const compilerCommerciallyUsable = ballots.filter((ballot) => ballot.commerciallyUsable[compilerSlot]).length > ballots.length / 2;
    const allMaterialFailuresRepairable = ballots.every((ballot) => ballotTotal(ballot, compilerSlot) >= 800 || ballot.repairableDimensions[compilerSlot].length > 0);
    const actualCostUsdMicros = pair.variants.flatMap((variant) => variant.units).reduce((sum, unit) => sum + unit.actualCostUsdMicros, 0);
    const failures: string[] = [];
    if (compilerPreferences <= ballots.length / 2) failures.push("compiler lacks a majority preference");
    if (compilerMedianScore <= controlMedianScore) failures.push("compiler median rubric score does not beat control");
    if (compilerRightsRegression) failures.push("compiler has a rights or safety regression");
    if (!allMaterialFailuresRepairable) failures.push("a material compiler failure lacks a typed repair dimension");
    if (actualCostUsdMicros > bundle.maxActualCostUsdMicrosPerPair) failures.push("pair exceeds the plausible paid-workflow cost ceiling");
    return { pairId: pair.id, family: pair.family, compilerSlot, compilerPreferences, controlPreferences, ties, compilerMedianScore, controlMedianScore, compilerRightsRegression, compilerCommerciallyUsable, allMaterialFailuresRepairable, actualCostUsdMicros, passed: failures.length === 0, failures };
  });
  for (const ballot of bundle.ballots) assert(pairIds.has(ballot.pairId), `ballot references unknown pair ${ballot.pairId}`);
  const allFamiliesPassed = pairScores.every((pair) => pair.passed);
  const atLeastOneCommerciallyUsable = pairScores.some((pair) => pair.compilerCommerciallyUsable);
  const costPlausible = pairScores.every((pair) => pair.actualCostUsdMicros <= bundle.maxActualCostUsdMicrosPerPair);
  return { pairs: pairScores, allFamiliesPassed, atLeastOneCommerciallyUsable, costPlausible, passed: allFamiliesPassed && atLeastOneCommerciallyUsable && costPlausible };
}

export function comparisonBundleHash(bundle: Phase0ComparisonBundle): string {
  return contentHash(bundle);
}
