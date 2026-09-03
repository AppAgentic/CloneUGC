import { contentHash } from "./canonical.ts";
import {
  assertFidelityMap,
  fidelityMapHash,
  type AnchorFrameStrategy,
  type EvidenceClaim,
  type FidelityMap,
  type GenerationUnit,
  type Milliseconds,
  type MotionGenerationStrategy,
  type TransitionType,
} from "./contracts.ts";
import {
  DIMENSION_IMPACT,
  LINEAGE_DIMENSIONS,
  assertReconstructionRevision,
  revisionHash,
  type FidelityDimension,
  type ReconstructionRevision,
  type TypedDirective,
} from "./directives.ts";
import type { CompiledFormatPlan } from "./format-recipe.ts";

/**
 * Provider-neutral compiled plans.
 *
 * A compiled plan turns a Fidelity Map (or an instantiated Format Recipe) plus a reconstruction
 * revision into independently auditable generation units, deterministic finishing steps, and an
 * invalidation graph. It never names a provider or model; the estimate and adapter registry
 * resolve provider classes, minimum durations, and pricing later.
 */

export type PlanUnitKind = "anchor" | "motion";
export type FinishingKind = "trim" | "transition" | "caption" | "audio" | "overlay" | "splice";

export interface PlanUnit {
  id: string;
  kind: PlanUnitKind;
  sourceShotIds: string[];
  setupId: string;
  startMs: Milliseconds;
  endMs: Milliseconds;
  targetDurationMs: Milliseconds;
  strategy: AnchorFrameStrategy | MotionGenerationStrategy;
  prompt: string;
  preserve: string[];
  change: string[];
  constraints: string[];
  dependsOn: string[];
  dimensions: FidelityDimension[];
  unitHash: string;
}

export interface FinishingStep {
  id: string;
  kind: FinishingKind;
  startMs: Milliseconds;
  endMs: Milliseconds;
  transition?: { type: TransitionType; durationMs: Milliseconds };
  instruction: string;
  dependsOn: string[];
  dimensions: FidelityDimension[];
  stepHash: string;
}

export interface PlanLineage {
  fidelityMapHash?: string;
  formatRecipeHash?: string;
  formatPlanHash?: string;
}

export interface CompiledPlan {
  schemaVersion: "0.1.0";
  revisionHash: string;
  sourceContentSha256: string;
  lineage: PlanLineage;
  durationMs: Milliseconds;
  aspectRatio: "9:16" | "1:1" | "16:9" | "other";
  singleGenerationProhibited: boolean;
  units: PlanUnit[];
  finishing: FinishingStep[];
  planHash: string;
}

export interface InvalidationResult {
  invalidatedUnitIds: string[];
  reusableUnitIds: string[];
  invalidatedStepIds: string[];
  reasons: Record<string, string[]>;
}

const ANCHOR_DIMENSIONS: FidelityDimension[] = ["identity", "body_state", "wardrobe", "setting", "props", "camera", "lighting", "product"];
const MOTION_DIMENSIONS: FidelityDimension[] = ["identity", "body_state", "wardrobe", "setting", "props", "camera", "lighting", "product", "primary_motion", "secondary_motion", "playback_rate", "narrative"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function directiveApplies(directive: TypedDirective, unit: { id: string; startMs: number; endMs: number }, anchorId?: string): boolean {
  const target = directive.target;
  if (target.scope === "global") return true;
  if (target.scope === "units") return target.unitIds.includes(unit.id) || (anchorId !== undefined && target.unitIds.includes(anchorId));
  if (target.scope === "range") return overlaps(target.startMs, target.endMs, unit.startMs, unit.endMs);
  return false;
}

function directiveText(directive: TypedDirective): string {
  return directive.value !== undefined ? `${directive.intent} [${directive.value}]` : directive.intent;
}

function finishUnit(unit: Omit<PlanUnit, "unitHash">): PlanUnit {
  return { ...unit, unitHash: contentHash(unit) };
}

function finishStep(step: Omit<FinishingStep, "stepHash">): FinishingStep {
  return { ...step, stepHash: contentHash(step) };
}

function finishPlan(plan: Omit<CompiledPlan, "planHash">): CompiledPlan {
  const unitIds = new Set<string>();
  for (const unit of plan.units) {
    assert(!unitIds.has(unit.id), `duplicate plan unit id ${unit.id}`);
    unitIds.add(unit.id);
  }
  const stepIds = new Set<string>();
  for (const step of plan.finishing) {
    assert(!stepIds.has(step.id) && !unitIds.has(step.id), `duplicate finishing step id ${step.id}`);
    stepIds.add(step.id);
  }
  for (const unit of plan.units) unit.dependsOn.forEach((id) => assert(unitIds.has(id), `unit ${unit.id} depends on unknown unit ${id}`));
  for (const step of plan.finishing) step.dependsOn.forEach((id) => assert(unitIds.has(id) || stepIds.has(id), `step ${step.id} depends on unknown node ${id}`));
  return { ...plan, planHash: contentHash(plan) };
}

function finishingKindForDimension(dimension: FidelityDimension): FinishingKind {
  switch (dimension) {
    case "caption":
      return "caption";
    case "audio":
    case "dialogue":
      return "audio";
    case "transition":
      return "transition";
    case "timing":
      return "trim";
    default:
      return "overlay";
  }
}

function layerKindFromDescription(description: string): FinishingKind {
  const lower = description.toLowerCase();
  if (lower.includes("caption") || lower.includes("text") || lower.includes("checklist")) return "caption";
  if (lower.includes("audio") || lower.includes("music") || lower.includes("sound") || lower.includes("voice")) return "audio";
  if (lower.includes("cut") || lower.includes("transition") || lower.includes("join")) return "transition";
  return "overlay";
}

function dimensionsForFinishingKind(kind: FinishingKind): FidelityDimension[] {
  switch (kind) {
    case "caption":
      return ["caption", "product"];
    case "audio":
      return ["audio", "dialogue"];
    case "transition":
      return ["transition", "timing"];
    case "trim":
      return ["timing"];
    case "overlay":
      return ["overlay", "product"];
    case "splice":
      return ["timing", "transition"];
  }
}

interface UnitSeed {
  id: string;
  sourceShotIds: string[];
  setupId: string;
  startMs: number;
  endMs: number;
  anchorStrategy: AnchorFrameStrategy;
  motionStrategy: MotionGenerationStrategy;
  transitionIn: TransitionType;
  transitionDurationMs: number;
  anchorPrompt: string;
  motionPrompt: string;
  preserve: string[];
  change: string[];
  trimInstruction: string;
}

interface LayerSeed {
  id: string;
  kind: FinishingKind;
  startMs: number;
  endMs: number;
  instruction: string;
}

function buildPlan(input: {
  revision: ReconstructionRevision;
  sourceContentSha256: string;
  lineage: PlanLineage;
  durationMs: number;
  aspectRatio: CompiledPlan["aspectRatio"];
  singleGenerationProhibited: boolean;
  seeds: UnitSeed[];
  layers: LayerSeed[];
  globalConstraints: string[];
}): CompiledPlan {
  const { revision } = input;
  const units: PlanUnit[] = [];
  const finishing: FinishingStep[] = [];
  const hardConstraints = [
    ...input.globalConstraints,
    ...revision.directives.filter((directive) => directive.kind === "must_not_transfer" || directive.kind === "exclude").map((directive) => `${directive.kind}: ${directiveText(directive)}`),
  ];

  const seedIds = new Set(input.seeds.map((seed) => seed.id));
  for (const seed of input.seeds) {
    const anchorId = `${seed.id}:anchor`;
    const motionId = `${seed.id}:motion`;
    const applicable = revision.directives.filter((directive) => directive.kind === "preserve" || directive.kind === "change")
      .filter((directive) => directiveApplies(directive, { id: seed.id, startMs: seed.startMs, endMs: seed.endMs }) || directiveApplies(directive, { id: motionId, startMs: seed.startMs, endMs: seed.endMs }, anchorId))
      .filter((directive) => DIMENSION_IMPACT[directive.dimension] !== "finishing");
    const preserve = [...seed.preserve, ...applicable.filter((directive) => directive.kind === "preserve").map(directiveText)];
    const change = [...seed.change, ...applicable.filter((directive) => directive.kind === "change").map(directiveText)];
    const directiveSuffix = applicable.length === 0 ? "" : ` Directives: ${applicable.map((directive) => `${directive.kind} ${directive.dimension} — ${directiveText(directive)}`).join("; ")}.`;
    const dependsOn: string[] = [];
    if (seed.motionStrategy !== "deterministic_source") {
      units.push(finishUnit({
        id: anchorId,
        kind: "anchor",
        sourceShotIds: seed.sourceShotIds,
        setupId: seed.setupId,
        startMs: seed.startMs,
        endMs: seed.endMs,
        targetDurationMs: 0,
        strategy: seed.anchorStrategy,
        prompt: `${seed.anchorPrompt}${directiveSuffix}`,
        preserve,
        change,
        constraints: hardConstraints,
        dependsOn: [],
        dimensions: ANCHOR_DIMENSIONS,
      }));
      dependsOn.push(anchorId);
    }
    units.push(finishUnit({
      id: motionId,
      kind: "motion",
      sourceShotIds: seed.sourceShotIds,
      setupId: seed.setupId,
      startMs: seed.startMs,
      endMs: seed.endMs,
      targetDurationMs: seed.endMs - seed.startMs,
      strategy: seed.motionStrategy,
      prompt: `${seed.motionPrompt}${directiveSuffix}`,
      preserve,
      change,
      constraints: hardConstraints,
      dependsOn,
      dimensions: MOTION_DIMENSIONS,
    }));
    finishing.push(finishStep({
      id: `${seed.id}:trim`,
      kind: "trim",
      startMs: seed.startMs,
      endMs: seed.endMs,
      instruction: `${seed.trimInstruction} Restore the exact source interval ${seed.startMs}-${seed.endMs}ms before assembly.`,
      dependsOn: [motionId],
      dimensions: dimensionsForFinishingKind("trim"),
    }));
    if (seed.transitionIn !== "none") {
      finishing.push(finishStep({
        id: `${seed.id}:transition`,
        kind: "transition",
        startMs: Math.max(0, seed.startMs - seed.transitionDurationMs),
        endMs: Math.min(input.durationMs, seed.startMs + seed.transitionDurationMs),
        transition: { type: seed.transitionIn, durationMs: seed.transitionDurationMs },
        instruction: `Reproduce the source ${seed.transitionIn} into ${seed.id} at ${seed.startMs}ms over ${seed.transitionDurationMs}ms deterministically.`,
        dependsOn: [`${seed.id}:trim`],
        dimensions: dimensionsForFinishingKind("transition"),
      }));
    }
  }

  const layerIds = new Set(input.layers.map((layer) => layer.id));
  for (const layer of input.layers) {
    const applicable = revision.directives.filter((directive) => directive.target.scope === "layers" && directive.target.layerIds.includes(layer.id))
      .filter((directive) => directive.kind === "preserve" || directive.kind === "change");
    const suffix = applicable.length === 0 ? "" : ` Directives: ${applicable.map((directive) => `${directive.kind} ${directive.dimension} — ${directiveText(directive)}`).join("; ")}.`;
    finishing.push(finishStep({
      id: layer.id,
      kind: layer.kind,
      startMs: layer.startMs,
      endMs: layer.endMs,
      instruction: `${layer.instruction}${suffix}`,
      dependsOn: [],
      dimensions: dimensionsForFinishingKind(layer.kind),
    }));
  }

  // Finishing-only directives with global or range scope become their own deterministic steps.
  for (const directive of revision.directives) {
    if (directive.kind !== "change" && directive.kind !== "preserve") continue;
    if (DIMENSION_IMPACT[directive.dimension] !== "finishing") continue;
    if (directive.target.scope === "layers" || directive.target.scope === "units") continue;
    const kind = finishingKindForDimension(directive.dimension);
    const range = directive.target.scope === "range" ? directive.target : { startMs: 0, endMs: input.durationMs };
    const id = `directive:${directive.id}`;
    assert(!layerIds.has(id) && !seedIds.has(id), `directive step ${id} collides with a plan node`);
    finishing.push(finishStep({
      id,
      kind,
      startMs: range.startMs,
      endMs: range.endMs,
      instruction: `${directive.kind} ${directive.dimension}: ${directiveText(directive)}`,
      dependsOn: [],
      dimensions: [directive.dimension],
    }));
  }

  finishing.push(finishStep({
    id: "splice",
    kind: "splice",
    startMs: 0,
    endMs: input.durationMs,
    instruction: `Splice the trimmed units in source order, apply transitions and deterministic layers, and mux to ${input.durationMs}ms at ${input.aspectRatio}.`,
    dependsOn: finishing.map((step) => step.id),
    dimensions: dimensionsForFinishingKind("splice"),
  }));

  return finishPlan({
    schemaVersion: "0.1.0",
    revisionHash: revisionHash(revision),
    sourceContentSha256: input.sourceContentSha256,
    lineage: input.lineage,
    durationMs: input.durationMs,
    aspectRatio: input.aspectRatio,
    singleGenerationProhibited: input.singleGenerationProhibited,
    units,
    finishing,
  });
}

function describeUnitFromMap(map: FidelityMap, unit: GenerationUnit): { anchorPrompt: string; motionPrompt: string } {
  const setup = map.creatorWorkflow.setups.find((candidate) => candidate.id === unit.setupId);
  assert(setup !== undefined, `generation unit ${unit.id} references unknown setup ${unit.setupId}`);
  const segments = map.editSegments.filter((segment) => unit.sourceShotIds.includes(segment.sourceShotId));
  const beats = map.beats.filter((beat) => overlaps(beat.range.startMs, beat.range.endMs, unit.range.startMs, unit.range.endMs));
  const motionFields = map.secondaryMotion.fields.filter((field) => overlaps(field.range.startMs, field.range.endMs, unit.range.startMs, unit.range.endMs));
  const lightingEvents = map.lighting.events.filter((event) => overlaps(event.range.startMs, event.range.endMs, unit.range.startMs, unit.range.endMs));
  const playback = segments.map((segment) => `${segment.sourceShotId}: ${segment.playback.classification}${segment.playback.estimatedMultiplier === undefined ? "" : ` (${segment.playback.estimatedMultiplier}x)`}`).join(", ");
  const anchorPrompt = [
    `Subject anchor policy: ${map.creatorWorkflow.subjectAnchor}.`,
    `Camera: ${setup.cameraSignature}.`,
    `Environment: ${setup.environmentSignature}.`,
    `Subject state: ${setup.subjectState}.`,
    `Wardrobe: ${setup.wardrobeState}.`,
    `Lighting: ${setup.lightingState}; ${map.lighting.summary} Sources: ${map.lighting.sources.join(", ")}; direction ${map.lighting.direction}; ${map.lighting.colorTemperature}; exposure ${map.lighting.exposure}; contrast ${map.lighting.contrast}.`,
    `Persistent elements: ${map.creatorWorkflow.persistentElements.join(", ") || "none"}.`,
  ].join(" ");
  const motionPrompt = [
    `Requested outcome: ${map.requestedChange}.`,
    `Subject anchor policy: ${map.creatorWorkflow.subjectAnchor}.`,
    `Starting setup: camera ${setup.cameraSignature}; environment ${setup.environmentSignature}; subject ${setup.subjectState}; wardrobe ${setup.wardrobeState}; lighting ${setup.lightingState}.`,
    `Source shots ${unit.sourceShotIds.join(", ")} covering ${unit.range.startMs}-${unit.range.endMs}ms (${unit.targetDurationMs}ms).`,
    beats.length === 0 ? "" : `Beats: ${beats.map((beat) => `${beat.role} ${beat.range.startMs}-${beat.range.endMs}ms — ${beat.description}`).join("; ")}.`,
    `Playback: ${playback}.`,
    motionFields.length === 0 ? `Secondary motion: ${map.secondaryMotion.summary}` : `Secondary motion: ${motionFields.map((field) => `${field.element} driven by ${field.driver} (${field.direction}, ${field.amplitude}, ${field.cadence}; ${field.coupling})`).join("; ")}.`,
    lightingEvents.length === 0 ? "" : `Lighting events: ${lightingEvents.map((event) => `${event.range.startMs}-${event.range.endMs}ms ${event.description}`).join("; ")}.`,
    `Capture artifacts to keep: ${map.lighting.captureArtifacts.join(", ") || "none"}.`,
  ].filter((part) => part.length > 0).join(" ");
  return { anchorPrompt, motionPrompt };
}

/** Compiles a validator-accepted Fidelity Map plus a reconstruction revision into a provider-neutral plan. */
export function compilePlanFromFidelityMap(input: { map: FidelityMap; evidence: readonly EvidenceClaim[]; revision: ReconstructionRevision }): CompiledPlan {
  const { map, evidence, revision } = input;
  assertFidelityMap(map, evidence);
  const mapHash = fidelityMapHash(map);
  assert(revision.fidelityMapHash === mapHash, "revision does not cite this Fidelity Map hash");
  assert(revision.sourceContentSha256 === map.sourceContentSha256, "revision source hash does not match the Fidelity Map");
  const seeds: UnitSeed[] = map.creatorWorkflow.generationUnits.map((unit) => {
    const prompts = describeUnitFromMap(map, unit);
    return {
      id: unit.id,
      sourceShotIds: [...unit.sourceShotIds],
      setupId: unit.setupId,
      startMs: unit.range.startMs,
      endMs: unit.range.endMs,
      anchorStrategy: unit.anchorFrameStrategy,
      motionStrategy: unit.motionStrategy,
      transitionIn: unit.transitionIn,
      transitionDurationMs: unit.transitionDurationMs,
      anchorPrompt: prompts.anchorPrompt,
      motionPrompt: prompts.motionPrompt,
      preserve: [...unit.preserve],
      change: [...unit.change],
      trimInstruction: unit.trimInstruction,
    };
  });
  const layers: LayerSeed[] = map.creatorWorkflow.deterministicLayers.map((description, index) => ({
    id: `layer:${index}`,
    kind: layerKindFromDescription(description),
    startMs: 0,
    endMs: map.durationMs,
    instruction: `Deterministic layer: ${description}.`,
  }));
  assertReconstructionRevision(revision, {
    durationMs: map.durationMs,
    unitIds: seeds.flatMap((seed) => [seed.id, `${seed.id}:anchor`, `${seed.id}:motion`]),
    layerIds: layers.map((layer) => layer.id),
  });
  const globalConstraints = [
    ...map.risks.filter((risk) => risk.disposition !== "authorized").map((risk) => `must_not_transfer ${risk.kind} (${risk.disposition})`),
    ...map.directives.filter((directive) => directive.kind === "must_not_transfer" || directive.kind === "exclude").map((directive) => `${directive.kind}: ${directive.description}`),
  ];
  const multiTake = map.creatorWorkflow.captureMode === "multi_take" && map.creatorWorkflow.confidence >= 0.7;
  return buildPlan({
    revision,
    sourceContentSha256: map.sourceContentSha256,
    lineage: { fidelityMapHash: mapHash },
    durationMs: map.durationMs,
    aspectRatio: "9:16",
    singleGenerationProhibited: multiTake,
    seeds,
    layers,
    globalConstraints,
  });
}

/** Compiles an instantiated Format Recipe plan into the same provider-neutral plan shape. */
export function compilePlanFromFormat(input: { formatPlan: CompiledFormatPlan; revision: ReconstructionRevision; sourceContentSha256: string; fidelityMapHash?: string }): CompiledPlan {
  const { formatPlan, revision } = input;
  assert(revision.formatRecipeHash === formatPlan.recipeHash, "revision does not cite this Format Recipe hash");
  assert(revision.sourceContentSha256 === input.sourceContentSha256, "revision source hash does not match the instantiation source");
  if (input.fidelityMapHash !== undefined) assert(revision.fidelityMapHash === input.fidelityMapHash, "revision does not cite the recipe's Fidelity Map hash");
  const seeds: UnitSeed[] = formatPlan.shots.map((shot, index) => ({
    id: shot.id,
    sourceShotIds: [shot.id],
    setupId: shot.id,
    startMs: shot.startMs,
    endMs: shot.endMs,
    anchorStrategy: index === 0 ? "generate" : "edit_subject_anchor",
    motionStrategy: shot.generationStrategy,
    transitionIn: shot.transitionIn,
    transitionDurationMs: shot.transitionDurationMs,
    anchorPrompt: shot.anchorPrompt,
    motionPrompt: shot.motionPrompt,
    preserve: [...shot.lockedTraits],
    change: [],
    trimInstruction: `Trim the generated take to ${shot.endMs - shot.startMs}ms.`,
  }));
  const layers: LayerSeed[] = formatPlan.deterministicLayers.map((layer) => ({
    id: layer.id,
    kind: layer.kind,
    startMs: layer.startMs,
    endMs: layer.endMs,
    instruction: layer.instruction,
  }));
  assertReconstructionRevision(revision, {
    durationMs: formatPlan.durationMs,
    unitIds: seeds.flatMap((seed) => [seed.id, `${seed.id}:anchor`, `${seed.id}:motion`]),
    layerIds: layers.map((layer) => layer.id),
  });
  const lineage: PlanLineage = { formatRecipeHash: formatPlan.recipeHash, formatPlanHash: formatPlan.planHash };
  if (input.fidelityMapHash !== undefined) lineage.fidelityMapHash = input.fidelityMapHash;
  return buildPlan({
    revision,
    sourceContentSha256: input.sourceContentSha256,
    lineage,
    durationMs: formatPlan.durationMs,
    aspectRatio: formatPlan.aspectRatio,
    singleGenerationProhibited: formatPlan.shots.length > 1,
    seeds,
    layers,
    globalConstraints: ["must_not_transfer source identity, voice, music, logos, or exact dialogue (structure_only recipe)"],
  });
}

export function assertCompiledPlan(plan: CompiledPlan): void {
  assert(plan.schemaVersion === "0.1.0", "unsupported compiled plan schema version");
  const { planHash, ...rest } = plan;
  assert(contentHash(rest) === planHash, "compiled plan hash does not match its content");
  for (const unit of plan.units) {
    const { unitHash, ...unitRest } = unit;
    assert(contentHash(unitRest) === unitHash, `unit ${unit.id} hash does not match its content`);
  }
  for (const step of plan.finishing) {
    const { stepHash, ...stepRest } = step;
    assert(contentHash(stepRest) === stepHash, `finishing step ${step.id} hash does not match its content`);
  }
  if (plan.singleGenerationProhibited) {
    assert(plan.units.filter((unit) => unit.kind === "motion").length > 1, "a plan that prohibits single generation must contain more than one motion unit");
  }
}

/** Every plan node that transitively depends on the given ids. */
function dependents(plan: CompiledPlan, seedIds: Iterable<string>): Set<string> {
  const result = new Set(seedIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of [...plan.units, ...plan.finishing]) {
      if (result.has(node.id)) continue;
      if (node.dependsOn.some((id) => result.has(id))) {
        result.add(node.id);
        grew = true;
      }
    }
  }
  return result;
}

/**
 * Determines which generation units and finishing steps a set of changed directives invalidates.
 * Everything not listed as invalidated can be reused byte-for-byte from an accepted prior run.
 */
export function computeInvalidation(plan: CompiledPlan, changed: readonly TypedDirective[]): InvalidationResult {
  const reasons = new Map<string, string[]>();
  const mark = (id: string, reason: string): void => {
    const existing = reasons.get(id) ?? [];
    if (!existing.includes(reason)) existing.push(reason);
    reasons.set(id, existing);
  };
  const seeds = new Set<string>();
  const motionByBase = new Map(plan.units.filter((unit) => unit.kind === "motion").map((unit) => [unit.id.replace(/:motion$/, ""), unit.id]));

  for (const directive of changed) {
    const impact = DIMENSION_IMPACT[directive.dimension];
    const reason = `${directive.kind} ${directive.dimension} (${directive.id})`;
    const target = directive.target;
    if (impact !== "finishing") {
      for (const unit of plan.units) {
        const lineage = LINEAGE_DIMENSIONS.has(directive.dimension);
        const inScope = lineage || target.scope === "global"
          || (target.scope === "units" && (target.unitIds.includes(unit.id) || target.unitIds.some((id) => motionByBase.get(id) === unit.id || `${id}:anchor` === unit.id)))
          || (target.scope === "range" && overlaps(target.startMs, target.endMs, unit.startMs, unit.endMs));
        if (inScope && unit.dimensions.includes(directive.dimension)) {
          seeds.add(unit.id);
          mark(unit.id, reason);
        }
      }
    }
    if (impact !== "generation") {
      for (const step of plan.finishing) {
        if (step.kind === "splice") continue;
        const inScope = target.scope === "global"
          || (target.scope === "layers" && target.layerIds.includes(step.id))
          || (target.scope === "range" && overlaps(target.startMs, target.endMs, step.startMs, step.endMs))
          || (target.scope === "units" && step.kind === "trim" && target.unitIds.some((id) => step.id === `${id}:trim` || step.id === `${id.replace(/:(motion|anchor)$/, "")}:trim`));
        if (inScope && (step.dimensions.includes(directive.dimension) || step.id === `directive:${directive.id}`)) {
          seeds.add(step.id);
          mark(step.id, reason);
        }
      }
    }
  }

  const invalidated = dependents(plan, seeds);
  for (const id of invalidated) if (!reasons.has(id)) mark(id, "depends on an invalidated node");
  if (invalidated.size > 0) {
    invalidated.add("splice");
    mark("splice", "final assembly always reruns after any change");
  }
  const invalidatedUnitIds = plan.units.filter((unit) => invalidated.has(unit.id)).map((unit) => unit.id);
  const reusableUnitIds = plan.units.filter((unit) => !invalidated.has(unit.id)).map((unit) => unit.id);
  const invalidatedStepIds = plan.finishing.filter((step) => invalidated.has(step.id)).map((step) => step.id);
  return { invalidatedUnitIds, reusableUnitIds, invalidatedStepIds, reasons: Object.fromEntries([...reasons.entries()].sort(([a], [b]) => a.localeCompare(b))) };
}

/**
 * Determines which accepted unit artifacts from a previous plan may be reused for a new plan.
 * A unit is reusable only when it exists in both plans with an identical content hash and the
 * revision delta did not invalidate it.
 */
export function planRepairReuse(input: {
  previousPlan: CompiledPlan;
  previousAcceptedArtifacts: Readonly<Record<string, string>>;
  nextPlan: CompiledPlan;
  changed: readonly TypedDirective[];
}): { reuse: Record<string, string>; regenerate: string[]; invalidation: InvalidationResult } {
  const invalidation = computeInvalidation(input.previousPlan, input.changed);
  const previousUnits = new Map(input.previousPlan.units.map((unit) => [unit.id, unit]));
  const invalidated = new Set(invalidation.invalidatedUnitIds);
  const reuse: Record<string, string> = {};
  const regenerate: string[] = [];
  for (const unit of input.nextPlan.units) {
    const previous = previousUnits.get(unit.id);
    const artifact = input.previousAcceptedArtifacts[unit.id];
    if (previous !== undefined && artifact !== undefined && previous.unitHash === unit.unitHash && !invalidated.has(unit.id)) {
      reuse[unit.id] = artifact;
    } else {
      regenerate.push(unit.id);
    }
  }
  return { reuse, regenerate, invalidation };
}
