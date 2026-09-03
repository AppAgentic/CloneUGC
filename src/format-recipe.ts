import { contentHash } from "./canonical.ts";
import type { Milliseconds, MotionGenerationStrategy, TransitionType } from "./contracts.ts";

export type FormatVariableKind =
  | "subject_identity"
  | "gender_presentation"
  | "body_state"
  | "wardrobe"
  | "setting"
  | "caption_text"
  | "audio"
  | "product_promo"
  | "other";

export interface FormatVariable {
  key: string;
  kind: FormatVariableKind;
  description: string;
  required: boolean;
  defaultValue?: string;
  examples: string[];
}

export interface FormatShotTemplate {
  id: string;
  startMs: Milliseconds;
  endMs: Milliseconds;
  transitionIn: TransitionType;
  transitionDurationMs: Milliseconds;
  generationStrategy: MotionGenerationStrategy;
  providerDurationMs: Milliseconds;
  anchorPromptTemplate: string;
  motionPromptTemplate: string;
  lockedTraits: string[];
}

export interface DeterministicLayerTemplate {
  id: string;
  kind: "caption" | "audio" | "transition" | "overlay";
  startMs: Milliseconds;
  endMs: Milliseconds;
  template: string;
}

export interface FormatRecipe {
  schemaVersion: "0.1.0";
  id: string;
  revision: number;
  parentRecipeHash?: string;
  name: string;
  description: string;
  provenance: {
    sourceAssetId: string;
    sourceFidelityMapHash?: string;
    sourceRunManifestSha256?: string;
    sourceEvidenceHash?: string;
    extractionPromptVersion: string;
    rightsTransferPolicy: "structure_only";
  };
  durationMs: Milliseconds;
  aspectRatio: "9:16" | "1:1" | "16:9" | "other";
  lockedGrammar: string[];
  variables: FormatVariable[];
  shots: FormatShotTemplate[];
  deterministicLayers: DeterministicLayerTemplate[];
  promptExamples: string[];
  validation: {
    status: "draft" | "validated";
    fidelityScore?: number;
    qaMode?: "manual" | "static" | "agentic" | "hybrid";
    sourceOutputId?: string;
    notes: string[];
  };
}

export interface FormatInstantiation {
  userPrompt: string;
  values: Record<string, string>;
}

export interface CompiledFormatPlan {
  schemaVersion: "0.1.0";
  recipeId: string;
  recipeRevision: number;
  recipeHash: string;
  userPrompt: string;
  resolvedValues: Record<string, string>;
  durationMs: Milliseconds;
  aspectRatio: FormatRecipe["aspectRatio"];
  lockedGrammar: string[];
  shots: Array<{
    id: string;
    startMs: Milliseconds;
    endMs: Milliseconds;
    transitionIn: TransitionType;
    transitionDurationMs: Milliseconds;
    generationStrategy: MotionGenerationStrategy;
    providerDurationMs: Milliseconds;
    anchorPrompt: string;
    motionPrompt: string;
    lockedTraits: string[];
  }>;
  deterministicLayers: Array<Omit<DeterministicLayerTemplate, "template"> & { instruction: string }>;
  planHash: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHash(value: string, field: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${field} must be a lowercase SHA-256 hash`);
}

const SLOT = /\{\{([a-z][a-z0-9_]*)\}\}/g;

function templateKeys(template: string): string[] {
  return [...template.matchAll(SLOT)].map((match) => match[1]!);
}

function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(SLOT, (_, key: string) => {
    const value = values[key];
    assert(value !== undefined && value.trim().length > 0, `template variable ${key} is unresolved`);
    return value;
  });
}

export function assertFormatRecipe(recipe: FormatRecipe): void {
  assert(recipe.schemaVersion === "0.1.0", "unsupported Format Recipe schema version");
  assert(recipe.id.length > 0 && recipe.name.length > 0 && recipe.description.length > 0, "Format Recipe identity fields are required");
  assert(Number.isInteger(recipe.revision) && recipe.revision >= 1, "Format Recipe revision must be a positive integer");
  if (recipe.parentRecipeHash !== undefined) assertHash(recipe.parentRecipeHash, "parentRecipeHash");
  assert(
    recipe.provenance.sourceFidelityMapHash !== undefined || recipe.provenance.sourceRunManifestSha256 !== undefined || recipe.provenance.sourceEvidenceHash !== undefined,
    "Format Recipe requires a source Fidelity Map, validated run manifest, or evidence hash",
  );
  if (recipe.provenance.sourceFidelityMapHash !== undefined) assertHash(recipe.provenance.sourceFidelityMapHash, "sourceFidelityMapHash");
  if (recipe.provenance.sourceRunManifestSha256 !== undefined) assertHash(recipe.provenance.sourceRunManifestSha256, "sourceRunManifestSha256");
  if (recipe.provenance.sourceEvidenceHash !== undefined) assertHash(recipe.provenance.sourceEvidenceHash, "sourceEvidenceHash");
  assert(recipe.provenance.sourceAssetId.length > 0, "sourceAssetId is required");
  assert(recipe.provenance.extractionPromptVersion.length > 0, "extractionPromptVersion is required");
  assert(recipe.provenance.rightsTransferPolicy === "structure_only", "reusable formats may transfer structure only");
  assert(Number.isInteger(recipe.durationMs) && recipe.durationMs > 0 && recipe.durationMs <= 30_000, "Format Recipe duration must be 1-30 seconds");
  assert(recipe.lockedGrammar.length > 0, "Format Recipe requires locked creative grammar");
  assert(recipe.variables.length > 0, "Format Recipe requires prompt variables");
  assert(recipe.shots.length > 0, "Format Recipe requires shots");
  assert(["9:16", "1:1", "16:9", "other"].includes(recipe.aspectRatio), "Format Recipe has an invalid aspect ratio");
  assert(["draft", "validated"].includes(recipe.validation.status), "Format Recipe has an invalid validation status");
  assert(recipe.validation.notes.length > 0, "Format Recipe requires validation notes");
  if (recipe.validation.fidelityScore !== undefined) {
    assert(Number.isFinite(recipe.validation.fidelityScore) && recipe.validation.fidelityScore >= 0 && recipe.validation.fidelityScore <= 100, "Format Recipe fidelity score must be between 0 and 100");
  }
  assert(recipe.promptExamples.length > 0, "Format Recipe requires prompt examples");

  const variables = new Set<string>();
  const variableKinds: FormatVariableKind[] = ["subject_identity", "gender_presentation", "body_state", "wardrobe", "setting", "caption_text", "audio", "product_promo", "other"];
  for (const variable of recipe.variables) {
    assert(/^[a-z][a-z0-9_]*$/.test(variable.key), `invalid variable key ${variable.key}`);
    assert(!variables.has(variable.key), `duplicate variable key ${variable.key}`);
    variables.add(variable.key);
    assert(variableKinds.includes(variable.kind), `variable ${variable.key} has an invalid kind`);
    assert(variable.description.length > 0, `variable ${variable.key} requires a description`);
    assert(variable.examples.length > 0, `variable ${variable.key} requires examples`);
    if (!variable.required) assert(variable.defaultValue !== undefined && variable.defaultValue.length > 0, `optional variable ${variable.key} requires a default`);
  }

  const validateTemplate = (template: string, owner: string): void => {
    assert(template.length > 0, `${owner} template is required`);
    for (const key of templateKeys(template)) assert(variables.has(key), `${owner} references undeclared variable ${key}`);
  };

  const shotIds = new Set<string>();
  const transitions: TransitionType[] = ["none", "hard_cut", "dissolve", "fade", "wipe", "match_cut", "other"];
  const generationStrategies: MotionGenerationStrategy[] = ["image_to_video", "reference_to_video", "text_to_video", "deterministic_source"];
  let expectedStart = 0;
  for (const [index, shot] of recipe.shots.entries()) {
    assert(!shotIds.has(shot.id), `duplicate format shot id ${shot.id}`);
    shotIds.add(shot.id);
    assert(Number.isInteger(shot.startMs) && shot.startMs === expectedStart, `format shot ${shot.id} leaves a gap or overlap`);
    assert(Number.isInteger(shot.endMs) && shot.endMs > shot.startMs, `format shot ${shot.id} has invalid timing`);
    assert(shot.providerDurationMs >= shot.endMs - shot.startMs, `format shot ${shot.id} provider duration is too short`);
    assert(transitions.includes(shot.transitionIn), `format shot ${shot.id} has an invalid transition`);
    assert(generationStrategies.includes(shot.generationStrategy), `format shot ${shot.id} has an invalid generation strategy`);
    assert(index !== 0 || shot.transitionIn === "none", "first format shot must use transitionIn none");
    assert(Number.isInteger(shot.transitionDurationMs) && shot.transitionDurationMs >= 0, `format shot ${shot.id} has invalid transition duration`);
    assert(shot.lockedTraits.length > 0, `format shot ${shot.id} requires locked traits`);
    validateTemplate(shot.anchorPromptTemplate, `format shot ${shot.id} anchor`);
    validateTemplate(shot.motionPromptTemplate, `format shot ${shot.id} motion`);
    expectedStart = shot.endMs;
  }
  assert(expectedStart === recipe.durationMs, "format shots must cover the full duration");

  const layerIds = new Set<string>();
  const layerKinds: DeterministicLayerTemplate["kind"][] = ["caption", "audio", "transition", "overlay"];
  for (const layer of recipe.deterministicLayers) {
    assert(!layerIds.has(layer.id), `duplicate deterministic layer id ${layer.id}`);
    layerIds.add(layer.id);
    assert(layerKinds.includes(layer.kind), `deterministic layer ${layer.id} has an invalid kind`);
    assert(Number.isInteger(layer.startMs) && Number.isInteger(layer.endMs), `deterministic layer ${layer.id} timestamps must be integers`);
    assert(layer.startMs >= 0 && layer.endMs > layer.startMs && layer.endMs <= recipe.durationMs, `deterministic layer ${layer.id} exceeds the format timeline`);
    validateTemplate(layer.template, `deterministic layer ${layer.id}`);
  }
}

export function formatRecipeHash(recipe: FormatRecipe): string {
  assertFormatRecipe(recipe);
  return contentHash(recipe);
}

export function compileFormatRecipe(recipe: FormatRecipe, instantiation: FormatInstantiation): CompiledFormatPlan {
  assertFormatRecipe(recipe);
  assert(instantiation.userPrompt.trim().length > 0, "format instantiation requires the user's prompt");
  const definitions = new Map(recipe.variables.map((variable) => [variable.key, variable]));
  for (const [key, value] of Object.entries(instantiation.values)) {
    assert(definitions.has(key), `unknown format variable ${key}`);
    assert(value.trim().length > 0, `format variable ${key} cannot be empty`);
  }
  const resolvedValues: Record<string, string> = {};
  for (const variable of recipe.variables) {
    const value = instantiation.values[variable.key] ?? variable.defaultValue;
    assert(value !== undefined && value.trim().length > 0, `required format variable ${variable.key} is missing`);
    resolvedValues[variable.key] = value;
  }

  const corePlan = {
    schemaVersion: "0.1.0" as const,
    recipeId: recipe.id,
    recipeRevision: recipe.revision,
    recipeHash: formatRecipeHash(recipe),
    userPrompt: instantiation.userPrompt,
    resolvedValues,
    durationMs: recipe.durationMs,
    aspectRatio: recipe.aspectRatio,
    lockedGrammar: [...recipe.lockedGrammar],
    shots: recipe.shots.map((shot) => ({
      id: shot.id,
      startMs: shot.startMs,
      endMs: shot.endMs,
      transitionIn: shot.transitionIn,
      transitionDurationMs: shot.transitionDurationMs,
      generationStrategy: shot.generationStrategy,
      providerDurationMs: shot.providerDurationMs,
      anchorPrompt: renderTemplate(shot.anchorPromptTemplate, resolvedValues),
      motionPrompt: renderTemplate(shot.motionPromptTemplate, resolvedValues),
      lockedTraits: [...shot.lockedTraits],
    })),
    deterministicLayers: recipe.deterministicLayers.map(({ template, ...layer }) => ({
      ...layer,
      instruction: renderTemplate(template, resolvedValues),
    })),
  };
  return { ...corePlan, planHash: contentHash(corePlan) };
}
