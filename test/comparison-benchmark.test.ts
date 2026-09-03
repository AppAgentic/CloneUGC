import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPARISON_DIMENSIONS,
  comparisonBundleHash,
  scorePhase0Comparisons,
  type BlindComparisonBallot,
  type ComparisonDimension,
  type Phase0ComparisonBundle,
  type SealedComparisonPair,
} from "../src/comparison-benchmark.ts";

function hash(character: string): string {
  return character.repeat(64);
}

function dimensionScores(value: number): Record<ComparisonDimension, number> {
  return Object.fromEntries(COMPARISON_DIMENSIONS.map((dimension) => [dimension, value])) as Record<ComparisonDimension, number>;
}

function pair(index: number): SealedComparisonPair {
  const sourceHash = hash(String(index));
  return {
    id: `pair-${index}`,
    family: ["dialogue", "movement", "product"][index - 1]!,
    sourceHash,
    requestedChange: `requested change ${index}`,
    fidelityMapHash: hash("a"),
    slotToLane: { A: "compiler", B: "control" },
    variants: [
      {
        slot: "A",
        outputHash: hash("b"),
        units: [{
          unitId: `compiler-${index}`,
          providerRequestId: `provider-compiler-${index}`,
          seed: `seed-compiler-${index}`,
          promptHash: hash("c"),
          sourceHash,
          specHash: hash("d"),
          outputHash: hash("e"),
          estimatedCostUsdMicros: 9_000,
          actualCostUsdMicros: 10_000,
          latencyMs: 20_000,
          deliveredDurationMs: 8_000,
        }],
      },
      {
        slot: "B",
        outputHash: hash("f"),
        units: [{
          unitId: `control-${index}`,
          providerRequestId: `provider-control-${index}`,
          seed: `seed-control-${index}`,
          promptHash: hash("a"),
          sourceHash,
          specHash: hash("b"),
          outputHash: hash("c"),
          estimatedCostUsdMicros: 9_000,
          actualCostUsdMicros: 10_000,
          latencyMs: 19_000,
          deliveredDurationMs: 8_000,
        }],
      },
    ],
  };
}

function ballot(pairId: string, scorer: number): BlindComparisonBallot {
  return {
    pairId,
    scorerId: `scorer-${scorer}`,
    blindToLane: true,
    preferredSlot: "A",
    scores: { A: dimensionScores(90), B: dimensionScores(70) },
    rightsRegression: { A: false, B: false },
    commerciallyUsable: { A: pairId === "pair-1", B: false },
    repairableDimensions: { A: [], B: [] },
  };
}

function bundle(): Phase0ComparisonBundle {
  const pairs = [pair(1), pair(2), pair(3)];
  return {
    schemaVersion: "0.1.0",
    pairs,
    ballots: pairs.flatMap((entry) => [1, 2, 3].map((scorer) => ballot(entry.id, scorer))),
    maxActualCostUsdMicrosPerPair: 25_000,
  };
}

test("passes only complete three-family blind evidence with paid-unit provenance", () => {
  const input = bundle();
  const result = scorePhase0Comparisons(input);
  assert.equal(result.passed, true);
  assert.equal(result.pairs.length, 3);
  assert(result.pairs.every((score) => score.compilerPreferences === 3));
  assert(result.pairs.every((score) => score.compilerMedianScore === 900));
  assert.equal(result.atLeastOneCommerciallyUsable, true);
  assert.match(comparisonBundleHash(input), /^[a-f0-9]{64}$/);
});

test("rejects incomplete blind scoring and malformed runtime slot mappings", () => {
  const incomplete = bundle();
  incomplete.ballots = incomplete.ballots.filter((entry) => entry.pairId !== "pair-1" || entry.scorerId !== "scorer-3");
  assert.throws(() => scorePhase0Comparisons(incomplete), /at least three blind scorers/);

  const malformed = bundle();
  (malformed.pairs[0]!.slotToLane as Record<string, string>).A = "mystery";
  assert.throws(() => scorePhase0Comparisons(malformed), /must be control or compiler/);

  const invalidVariant = bundle();
  (invalidVariant.pairs[0]!.variants[0] as { slot: string }).slot = "C";
  assert.throws(() => scorePhase0Comparisons(invalidVariant), /must be A or B/);
});

test("fails closed on preference, rights, repairability, and cost gates", () => {
  const input = bundle();
  const firstBallots = input.ballots.filter((entry) => entry.pairId === "pair-1");
  firstBallots[0]!.preferredSlot = "B";
  firstBallots[1]!.preferredSlot = "tie";
  firstBallots[0]!.rightsRegression.A = true;
  for (const item of firstBallots) item.scores.A = dimensionScores(70);
  input.pairs[0]!.variants[0].units[0]!.actualCostUsdMicros = 20_000;

  const result = scorePhase0Comparisons(input);
  assert.equal(result.passed, false);
  assert.deepEqual(result.pairs[0]!.failures, [
    "compiler lacks a majority preference",
    "compiler median rubric score does not beat control",
    "compiler has a rights or safety regression",
    "a material compiler failure lacks a typed repair dimension",
    "pair exceeds the plausible paid-workflow cost ceiling",
  ]);
});

test("rejects incomplete paid provenance and invalid typed repair dimensions", () => {
  const missingProvenance = bundle();
  missingProvenance.pairs[0]!.variants[0].units[0]!.providerRequestId = "";
  assert.throws(() => scorePhase0Comparisons(missingProvenance), /requires id, provider request id, and seed/);

  const invalidRepair = bundle();
  (invalidRepair.ballots[0]!.repairableDimensions.A as string[]).push("whole_prompt_magic");
  assert.throws(() => scorePhase0Comparisons(invalidRepair), /invalid repair dimension/);
});
