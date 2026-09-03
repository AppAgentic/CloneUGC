import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertCompiledPlan, compilePlanFromFidelityMap, compilePlanFromFormat, computeInvalidation, planRepairReuse } from "../src/compiler.ts";
import { deriveRevision, type TypedDirective } from "../src/directives.ts";
import { compileFormatRecipe, formatRecipeHash, type FormatRecipe } from "../src/format-recipe.ts";
import { SOURCE_HASH, baseDirectives, sampleEvidence, sampleMap, samplePlan, sampleRevision } from "./helpers/sample.ts";

test("a Fidelity Map compiles into one anchor and one motion unit per generation unit plus deterministic finishing", () => {
  const plan = samplePlan();
  assert.doesNotThrow(() => assertCompiledPlan(plan));
  assert.deepEqual(plan.units.map((unit) => unit.id), ["unit-1:anchor", "unit-1:motion", "unit-2:anchor", "unit-2:motion"]);
  assert.deepEqual(plan.units.find((unit) => unit.id === "unit-2:motion")!.dependsOn, ["unit-2:anchor"]);
  assert.equal(plan.singleGenerationProhibited, true);
  assert.deepEqual(plan.finishing.map((step) => step.id), ["unit-1:trim", "unit-2:trim", "unit-2:transition", "layer:0", "layer:1", "splice"]);
  assert.equal(plan.finishing.find((step) => step.id === "layer:0")!.kind, "caption");
  assert.equal(plan.finishing.find((step) => step.id === "layer:1")!.kind, "audio");
  assert.match(plan.finishing.find((step) => step.id === "layer:0")!.instruction, /2 months of GymLevels/);
  assert.match(plan.units[0]!.prompt, /Static low phone/);
  assert.ok(plan.units.every((unit) => unit.constraints.some((constraint) => /identity/.test(constraint))));
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  for (const unit of plan.units) assert.ok(!/gemini|seedance|minimax|openai/i.test(unit.prompt), "plans stay provider neutral");
});

test("compilation is deterministic and rejects revisions that cite another map", () => {
  assert.equal(samplePlan().planHash, samplePlan().planHash);
  assert.throws(() => compilePlanFromFidelityMap({ map: sampleMap, evidence: sampleEvidence, revision: sampleRevision({ fidelityMapHash: "b".repeat(64) }) }), /does not cite this Fidelity Map/);
  assert.throws(() => compilePlanFromFidelityMap({ map: sampleMap, evidence: sampleEvidence, revision: sampleRevision({ directives: [{ id: "bad", kind: "change", dimension: "wardrobe", target: { scope: "units", unitIds: ["unit-7"] }, intent: "x", evidenceIds: [] }] }) }), /unknown unit unit-7/);
  const tampered = { ...samplePlan(), durationMs: 9_000 };
  assert.throws(() => assertCompiledPlan(tampered), /hash does not match/);
});

test("a caption repair invalidates only the caption layer and final splice", () => {
  const plan = samplePlan();
  const changed: TypedDirective[] = [{ ...baseDirectives[2]!, value: "90 days" }];
  const result = computeInvalidation(plan, changed);
  assert.deepEqual(result.invalidatedUnitIds, []);
  assert.deepEqual(result.reusableUnitIds, plan.units.map((unit) => unit.id));
  assert.deepEqual(result.invalidatedStepIds, ["layer:0", "splice"]);
});

test("a wardrobe repair on one unit invalidates only that unit's anchor, motion, trim, and downstream splice", () => {
  const plan = samplePlan();
  const changed: TypedDirective[] = [{ id: "t-wardrobe", kind: "change", dimension: "wardrobe", target: { scope: "units", unitIds: ["unit-2"] }, intent: "Green sweatpants", evidenceIds: [] }];
  const result = computeInvalidation(plan, changed);
  assert.deepEqual(result.invalidatedUnitIds, ["unit-2:anchor", "unit-2:motion"]);
  assert.deepEqual(result.reusableUnitIds, ["unit-1:anchor", "unit-1:motion"]);
  assert.deepEqual(result.invalidatedStepIds, ["unit-2:trim", "unit-2:transition", "splice"]);
  assert.deepEqual(result.reasons["unit-2:anchor"], ["change wardrobe (t-wardrobe)"]);
});

test("identity changes invalidate every unit regardless of scope, and range targets select overlapping units", () => {
  const plan = samplePlan();
  const identity = computeInvalidation(plan, [{ id: "t-id", kind: "change", dimension: "identity", target: { scope: "units", unitIds: ["unit-1"] }, intent: "New person", evidenceIds: [] }]);
  assert.deepEqual(identity.reusableUnitIds, []);
  const lighting = computeInvalidation(plan, [{ id: "t-light", kind: "change", dimension: "lighting", target: { scope: "range", startMs: 6_000, endMs: 7_000 }, intent: "Cooler", evidenceIds: [] }]);
  assert.deepEqual(lighting.invalidatedUnitIds, ["unit-2:anchor", "unit-2:motion"]);
  const nothing = computeInvalidation(plan, []);
  assert.deepEqual(nothing.invalidatedStepIds, []);
});

test("repair reuse returns accepted artifacts byte-for-byte for untouched units only", () => {
  const parent = sampleRevision();
  const previousPlan = samplePlan(parent);
  const wardrobe: TypedDirective = { id: "t-wardrobe", kind: "change", dimension: "wardrobe", target: { scope: "units", unitIds: ["unit-2"] }, intent: "Green sweatpants", evidenceIds: [] };
  const child = deriveRevision(parent, { id: "rev-2", userIntent: "Change wardrobe in the reveal", directives: [...baseDirectives, wardrobe] });
  const nextPlan = samplePlan(child);
  const accepted = { "unit-1:anchor": "1".repeat(64), "unit-1:motion": "2".repeat(64), "unit-2:anchor": "3".repeat(64), "unit-2:motion": "4".repeat(64) };
  const repair = planRepairReuse({ previousPlan, previousAcceptedArtifacts: accepted, nextPlan, changed: [wardrobe] });
  assert.deepEqual(repair.reuse, { "unit-1:anchor": "1".repeat(64), "unit-1:motion": "2".repeat(64) });
  assert.deepEqual(repair.regenerate, ["unit-2:anchor", "unit-2:motion"]);
  assert.notEqual(previousPlan.planHash, nextPlan.planHash);
});

test("an instantiated Format Recipe compiles into the same plan shape with recipe lineage", () => {
  const recipe = JSON.parse(readFileSync(new URL("../fixtures/formats/hand-wipe-fitness-transformation-v2.json", import.meta.url), "utf8")) as FormatRecipe;
  const formatPlan = compileFormatRecipe(recipe, { userPrompt: "Blonde woman with a GymLevels caption", values: { caption_text: "90 days with GymLevels" } });
  const revision = sampleRevision({ fidelityMapHash: undefined, formatRecipeHash: formatRecipeHash(recipe), directives: [] });
  const plan = compilePlanFromFormat({ formatPlan, revision, sourceContentSha256: SOURCE_HASH });
  assert.doesNotThrow(() => assertCompiledPlan(plan));
  assert.deepEqual(plan.units.map((unit) => unit.id), ["before-take:anchor", "before-take:motion", "after-take:anchor", "after-take:motion"]);
  assert.equal(plan.units[2]!.strategy, "edit_subject_anchor");
  assert.equal(plan.lineage.formatPlanHash, formatPlan.planHash);
  assert.ok(plan.finishing.some((step) => step.id === "hook-caption" && step.kind === "caption"));
  assert.equal(compilePlanFromFormat({ formatPlan, revision, sourceContentSha256: SOURCE_HASH }).planHash, plan.planHash);
  assert.throws(() => compilePlanFromFormat({ formatPlan, revision: { ...revision, formatRecipeHash: "b".repeat(64) }, sourceContentSha256: SOURCE_HASH }), /does not cite this Format Recipe/);
});
