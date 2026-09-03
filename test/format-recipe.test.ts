import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { assertFormatRecipe, compileFormatRecipe, formatRecipeHash, type FormatRecipe } from "../src/format-recipe.ts";

const fixtureUrl = new URL("../fixtures/formats/hand-wipe-fitness-transformation-v1.json", import.meta.url);
const recipe = JSON.parse(readFileSync(fixtureUrl, "utf8")) as FormatRecipe;
const familyRecipe = JSON.parse(readFileSync(new URL("../fixtures/formats/childhood-to-family-gym-montage-v1.json", import.meta.url), "utf8")) as FormatRecipe;
const checklistLoopRecipe = JSON.parse(readFileSync(new URL("../fixtures/formats/incline-press-checklist-loop-v1.json", import.meta.url), "utf8")) as FormatRecipe;
const winterRecipe = JSON.parse(readFileSync(new URL("../fixtures/formats/winter-arc-walk-in-stretch-checklist-v2.json", import.meta.url), "utf8")) as FormatRecipe;

test("the discovered Harrison format is a valid content-addressed recipe", () => {
  assert.doesNotThrow(() => assertFormatRecipe(recipe));
  assert.match(formatRecipeHash(recipe), /^[a-f0-9]{64}$/);
  assert.equal(recipe.provenance.rightsTransferPolicy, "structure_only");
});

test("every processed format is stored and valid, with quality status preserved", () => {
  const directory = new URL("../fixtures/formats/", import.meta.url);
  const recipes = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, directory), "utf8")) as FormatRecipe);
  assert.equal(recipes.length, 10);
  recipes.forEach((item) => assert.doesNotThrow(() => assertFormatRecipe(item), item.id));
  assert.deepEqual(
    recipes.filter((item) => item.validation.status === "validated").map((item) => item.id).sort(),
    ["alternating-gym-transformation-montage", "childhood-to-family-gym-montage", "continuous-pec-fly-advice", "hand-wipe-fitness-transformation", "phone-laugh-to-lock-in-gym", "rapid-gym-exercise-montage"],
  );
  assert.deepEqual(
    recipes.filter((item) => item.validation.status === "draft").map((item) => item.id).sort(),
    ["incline-press-checklist-loop", "kitchen-finger-count-palm-wipe", "night-car-list-reaction", "winter-arc-walk-in-stretch-checklist"],
  );
});

test("a short user prompt compiles the recipe into shot and finishing prompts", () => {
  const plan = compileFormatRecipe(recipe, {
    userPrompt: "Make this with a blonde woman and promote GymLevels.",
    values: {
      subject_identity: "a fictional blonde young woman with a chin-length wavy bob and a consistent face",
      gender_presentation: "female",
      before_wardrobe: "black gymwear and earbuds",
      after_wardrobe: "green gymwear without earbuds",
      caption_text: "90 days with GymLevels",
    },
  });

  assert.equal(plan.shots.length, 2);
  assert.match(plan.shots[0]!.anchorPrompt, /blonde young woman/);
  assert.match(plan.shots[1]!.anchorPrompt, /fictional blonde young woman/);
  assert.match(plan.deterministicLayers[0]!.instruction, /90 days with GymLevels/);
  assert.equal(plan.resolvedValues.setting, "a small ordinary beige bathroom with a ceiling vent, framed wall art and toilet");
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
});

test("the family montage compiles prompt variables without changing its 17-shot grammar", () => {
  const plan = compileFormatRecipe(familyRecipe, {
    userPrompt: "Use five blonde siblings and promote GymLevels.",
    values: {
      family_identity: "five fictional blonde siblings with stable distinct faces",
      caption_text: "pov: the whole family locked in on GymLevels",
    },
  });

  assert.equal(plan.shots.length, 17);
  assert.equal(plan.shots.filter((shot) => shot.generationStrategy === "image_to_video").length, 12);
  assert.equal(plan.shots.filter((shot) => shot.transitionIn === "hard_cut").length, 16);
  assert.match(plan.deterministicLayers[0]!.instruction, /GymLevels/);
});

test("the corrected Winter Arc walk-in recipe compiles its stretch and a natural product insertion", () => {
  const plan = compileFormatRecipe(winterRecipe, {
    userPrompt: "Use the Winter Arc format and add GymLevels naturally.",
    values: { product_promo: "Track workouts in GymLevels" },
  });

  assert.equal(plan.shots.length, 1);
  assert.equal(plan.shots[0]!.providerDurationMs, 10_000);
  assert.match(plan.shots[0]!.motionPrompt, /walk steadily away/i);
  assert.match(plan.shots[0]!.motionPrompt, /stretch/i);
  assert.match(plan.shots[0]!.motionPrompt, /fully clothed|every item of clothing on/i);
  assert.match(plan.shots[0]!.motionPrompt, /No shirt removal, undressing, back reveal, bodybuilding flex/i);
  assert.doesNotMatch(plan.shots[0]!.motionPrompt, /pull (?:a |the )?shirt (?:over|off)|complete (?:a |the )?(?:strong )?double-biceps/i);
  assert.match(plan.deterministicLayers[0]!.instruction, /Track workouts in GymLevels/);
});

test("the original TikTok checklist format preserves the sped-up press and walking background action", () => {
  assert.equal(checklistLoopRecipe.provenance.sourceAssetId, "tiktok-7665182154300624142");
  assert.equal(checklistLoopRecipe.shots.length, 1);
  const plan = compileFormatRecipe(checklistLoopRecipe, {
    userPrompt: "Use the original checklist format with a fictional woman and GymLevels.",
    values: { gender_presentation: "female", product_promo: "Track every workout in GymLevels." },
  });
  assert.match(plan.shots[0]!.motionPrompt, /five to six cycles/i);
  assert.match(plan.shots[0]!.motionPrompt, /walks about four strides/i);
  assert.match(plan.shots[0]!.motionPrompt, /2\.0x to 2\.5x accelerated/i);
  assert.doesNotMatch(plan.shots[0]!.motionPrompt, /remove (?:a |the )?shirt|pull (?:a |the )?shirt/);
  assert.match(plan.deterministicLayers[0]!.instruction, /GymLevels/);
});

test("recipe compilation rejects undeclared or unresolved prompt variables", () => {
  assert.throws(() => compileFormatRecipe(recipe, {
    userPrompt: "Change a hidden provider option.",
    values: { provider_model: "anything" },
  }), /unknown format variable provider_model/);

  const requiredIdentity = {
    ...recipe,
    variables: recipe.variables.map((variable) => variable.key === "subject_identity"
      ? { ...variable, required: true, defaultValue: undefined }
      : variable),
  } as FormatRecipe;
  assert.throws(() => compileFormatRecipe(requiredIdentity, {
    userPrompt: "Use the default format.",
    values: {},
  }), /required format variable subject_identity is missing/);
});

test("format recipes cannot transfer source-specific rights by default", () => {
  const unsafe = {
    ...recipe,
    provenance: { ...recipe.provenance, rightsTransferPolicy: "copy_everything" },
  } as unknown as FormatRecipe;
  assert.throws(() => assertFormatRecipe(unsafe), /transfer structure only/);
});
