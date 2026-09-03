import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { FakeAnalyzer } from "../src/adapters/fake-analyzer.ts";
import { assertCompiledPlan, compilePlanFromFidelityMap } from "../src/compiler.ts";
import { generationEligibility } from "../src/contracts.ts";
import { estimateGeneration } from "../src/estimate.ts";
import { assertRecipeDerivesFromFidelityMap, loadFidelityMapFixtures, recipeLineage } from "../src/fidelity-map-fixture.ts";
import type { FormatRecipe } from "../src/format-recipe.ts";
import { sampleCapabilities, samplePolicy } from "./helpers/sample.ts";

const fixtures = loadFidelityMapFixtures(new URL("../fixtures/fidelity-maps/", import.meta.url));
const recipeDirectory = new URL("../fixtures/formats/", import.meta.url);
const recipes = readdirSync(recipeDirectory).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(new URL(name, recipeDirectory), "utf8")) as FormatRecipe);

test("at least three materialized Fidelity Maps across distinct families pass the contract validator", () => {
  assert.ok(fixtures.length >= 3);
  assert.equal(new Set(fixtures.map((fixture) => fixture.family)).size, fixtures.length, "families are distinct");
  assert.equal(new Set(fixtures.map((fixture) => fixture.map.sourceContentSha256)).size, fixtures.length, "sources are distinct");
  for (const fixture of fixtures) {
    assert.match(fixture.fidelityMapHash, /^[a-f0-9]{64}$/);
    assert.ok(fixture.artifacts.some((artifact) => artifact.providerRun.mode === "static" && artifact.providerRun.exactModel === "gemini-3.7-flash"));
    assert.ok(fixture.artifacts.some((artifact) => artifact.providerRun.mode === "deterministic"));
    assert.ok(fixture.evidence.every((claim) => claim.status === "accepted"));
  }
});

test("materialized maps stay analysis-only until a rights attestation exists", () => {
  for (const fixture of fixtures) {
    const eligibility = generationEligibility(fixture.map, fixture.evidence);
    assert.deepEqual(eligibility.reasons, ["rights attestation is required"], fixture.id);
    assert.ok(fixture.map.risks.every((risk) => risk.disposition === "exclude"), `${fixture.id} excludes every protected element by default`);
  }
});

test("three recipes cite a real Fidelity Map hash and re-derive their structure from it", () => {
  const linked = recipes.filter((recipe) => recipeLineage(recipe) === "fidelity_map");
  assert.deepEqual(linked.map((recipe) => recipe.id).sort(), ["childhood-to-family-gym-montage", "phone-laugh-to-lock-in-gym", "winter-arc-walk-in-stretch-checklist"]);
  for (const recipe of linked) {
    const fixture = fixtures.find((candidate) => candidate.fidelityMapHash === recipe.provenance.sourceFidelityMapHash);
    assert.ok(fixture !== undefined, `${recipe.id} cites an unknown Fidelity Map hash`);
    assert.equal(fixture.recipeId, recipe.id);
    assert.doesNotThrow(() => assertRecipeDerivesFromFidelityMap(recipe, fixture));
  }
  const manifestOnly = recipes.filter((recipe) => recipeLineage(recipe) !== "fidelity_map").map((recipe) => recipe.id).sort();
  assert.deepEqual(manifestOnly, ["alternating-gym-transformation-montage", "continuous-pec-fly-advice", "hand-wipe-fitness-transformation", "incline-press-checklist-loop", "kitchen-finger-count-palm-wipe", "night-car-list-reaction", "rapid-gym-exercise-montage"]);
});

test("the multi-take montage map enforces one unit per deterministic cut and prohibits single generation", () => {
  const family = fixtures.find((fixture) => fixture.id === "fm-childhood-to-family-gym-montage-v1")!;
  assert.equal(family.map.editSegments.length, 17);
  assert.equal(family.map.creatorWorkflow.generationUnits.length, 17);
  assert.deepEqual(family.map.editSegments.slice(1).map((segment) => segment.range.startMs), [1733, 2233, 2833, 3800, 5000, 5467, 5967, 6600, 7300, 7800, 8400, 8867, 9467, 10033, 11067, 11533]);
  assert.ok(family.map.risks.some((risk) => risk.kind === "minor" && risk.disposition === "exclude"));
  const revision = { schemaVersion: "0.1.0" as const, id: "rev-family", reconstructionId: "recon-family", revision: 1, fidelityMapHash: family.fidelityMapHash, sourceContentSha256: family.map.sourceContentSha256, userIntent: "Recreate with a fictional family", directives: [] };
  const plan = compilePlanFromFidelityMap({ map: family.map, evidence: family.evidence, revision });
  assertCompiledPlan(plan);
  assert.equal(plan.singleGenerationProhibited, true);
  assert.equal(plan.units.filter((unit) => unit.kind === "motion").length, 17);
  assert.equal(plan.units.filter((unit) => unit.strategy === "deterministic_source").length, 5);
  const estimate = estimateGeneration({ plan, capabilities: sampleCapabilities, policy: samplePolicy, nowMs: 1 });
  assert.equal(estimate.units.filter((unit) => unit.providerClass === "deterministic_finishing").length, 5);
  assert.equal(estimate.units.filter((unit) => unit.providerClass === "video_motion" && unit.billedDurationMs === 5_000).length, 12, "sub-second shots bill the provider minimum and trim deterministically");
});

test("the corrected Winter Arc map preserves the real-time walk and overhead stretch", () => {
  const winter = fixtures.find((fixture) => fixture.id === "fm-winter-arc-walk-in-stretch-checklist-v3")!;
  assert.equal(winter.map.playback.classification, "real_time");
  assert.equal(winter.map.playback.estimatedMultiplier, 1);
  assert.ok(winter.artifacts.some((artifact) => artifact.providerRun.mode === "human"));
  const grammar = JSON.stringify(winter.map).toLowerCase();
  assert.match(grammar, /walk/);
  assert.match(grammar, /stretch/);
  assert.match(grammar, /handheld/);
  assert.match(grammar, /parallax/);
  assert.match(grammar, /gait-synchronized/);
  assert.doesNotMatch(grammar, /locked-off static camera|framing never changes/);
  assert.doesNotMatch(grammar, /pull the shirt|shirt removal|removes shirt|back double-biceps/);
});

test("every fixture compiles deterministically and registers with the fake analyzer", () => {
  const analyzer = new FakeAnalyzer();
  for (const fixture of fixtures) {
    analyzer.register(fixture);
    const revision = { schemaVersion: "0.1.0" as const, id: `rev-${fixture.id}`, reconstructionId: `recon-${fixture.id}`, revision: 1, fidelityMapHash: fixture.fidelityMapHash, sourceContentSha256: fixture.map.sourceContentSha256, userIntent: fixture.map.requestedChange, directives: [] };
    const first = compilePlanFromFidelityMap({ map: fixture.map, evidence: fixture.evidence, revision });
    const second = compilePlanFromFidelityMap({ map: analyzer.analyze(fixture.map.sourceContentSha256)!.map, evidence: fixture.evidence, revision });
    assert.equal(first.planHash, second.planHash, `${fixture.id} replays to the same plan hash`);
    assert.ok(first.units.every((unit) => !/gemini|seedance|minimax|openai|gpt/i.test(unit.prompt)), `${fixture.id} prompts stay provider neutral`);
  }
  assert.equal(analyzer.analyze("0".repeat(64)), undefined);
});
