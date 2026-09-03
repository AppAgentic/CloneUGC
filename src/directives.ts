import { contentHash } from "./canonical.ts";
import type { Milliseconds } from "./contracts.ts";

/**
 * Typed reconstruction directives.
 *
 * A Fidelity Map keeps free-text Preserve/Change/Exclude descriptions for humans. The
 * reconstruction compiler needs each directive to name the fidelity dimension it targets and
 * the part of the plan it touches, so a repair can invalidate only the affected generation
 * units and finishing layers. Natural-language intent is retained alongside the typed target.
 */

export const FIDELITY_DIMENSIONS = [
  "identity",
  "body_state",
  "wardrobe",
  "setting",
  "props",
  "camera",
  "primary_motion",
  "secondary_motion",
  "lighting",
  "timing",
  "transition",
  "playback_rate",
  "caption",
  "overlay",
  "audio",
  "dialogue",
  "product",
  "narrative",
] as const;

export type FidelityDimension = (typeof FIDELITY_DIMENSIONS)[number];

/** Whether a dimension is realized by paid generation units, deterministic finishing, or both. */
export type DimensionImpact = "generation" | "finishing" | "both";

export const DIMENSION_IMPACT: Readonly<Record<FidelityDimension, DimensionImpact>> = {
  identity: "generation",
  body_state: "generation",
  wardrobe: "generation",
  setting: "generation",
  props: "generation",
  camera: "generation",
  primary_motion: "generation",
  secondary_motion: "generation",
  lighting: "generation",
  timing: "finishing",
  transition: "finishing",
  playback_rate: "generation",
  caption: "finishing",
  overlay: "finishing",
  audio: "finishing",
  dialogue: "finishing",
  product: "both",
  narrative: "generation",
};

/** Dimensions whose change invalidates every generation unit because they share one lineage. */
export const LINEAGE_DIMENSIONS: ReadonlySet<FidelityDimension> = new Set(["identity", "narrative"]);

export type DirectiveKind = "preserve" | "change" | "exclude" | "must_not_transfer";

export type DirectiveTarget =
  | { scope: "global" }
  | { scope: "units"; unitIds: string[] }
  | { scope: "layers"; layerIds: string[] }
  | { scope: "range"; startMs: Milliseconds; endMs: Milliseconds };

export interface TypedDirective {
  id: string;
  kind: DirectiveKind;
  dimension: FidelityDimension;
  target: DirectiveTarget;
  /** The user's natural-language intent, retained verbatim. */
  intent: string;
  /** Optional normalized value, for example the exact caption text or wardrobe description. */
  value?: string;
  evidenceIds: string[];
}

export interface ReconstructionRevision {
  schemaVersion: "0.1.0";
  id: string;
  reconstructionId: string;
  revision: number;
  parentRevisionHash?: string;
  /** Lineage: a validator-accepted Fidelity Map hash, a Format Recipe hash, or both. */
  fidelityMapHash?: string;
  formatRecipeHash?: string;
  sourceContentSha256: string;
  userIntent: string;
  directives: TypedDirective[];
}

export interface Reconstruction {
  schemaVersion: "0.1.0";
  id: string;
  workspaceId: string;
  referenceAssetId: string;
  sourceContentSha256: string;
  fidelityMapHash?: string;
  formatRecipeHash?: string;
  headRevisionHash: string;
  revisionHashes: string[];
}

export interface RevisionContext {
  durationMs: Milliseconds;
  unitIds: ReadonlySet<string> | readonly string[];
  layerIds: ReadonlySet<string> | readonly string[];
}

export interface RevisionDelta {
  added: TypedDirective[];
  removed: TypedDirective[];
  changed: TypedDirective[];
  /** Directives that differ between parent and child, including removed ones. */
  effective: TypedDirective[];
  affectedDimensions: FidelityDimension[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHash(value: string, field: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${field} must be a lowercase SHA-256 hash`);
}

function toSet(values: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return values instanceof Set ? values : new Set(values);
}

export function assertTypedDirective(directive: TypedDirective, context?: RevisionContext): void {
  assert(directive.id.length > 0, "directive id is required");
  assert(["preserve", "change", "exclude", "must_not_transfer"].includes(directive.kind), `directive ${directive.id} has an invalid kind`);
  assert((FIDELITY_DIMENSIONS as readonly string[]).includes(directive.dimension), `directive ${directive.id} targets unknown dimension ${directive.dimension}`);
  assert(directive.intent.trim().length > 0, `directive ${directive.id} requires natural-language intent`);
  if (directive.value !== undefined) assert(directive.value.trim().length > 0, `directive ${directive.id} value cannot be empty`);
  if (directive.kind !== "change") assert(directive.evidenceIds.length > 0, `${directive.kind} directive ${directive.id} requires evidence`);
  const target = directive.target;
  switch (target.scope) {
    case "global":
      break;
    case "units":
      assert(target.unitIds.length > 0, `directive ${directive.id} unit target is empty`);
      if (context) target.unitIds.forEach((id) => assert(toSet(context.unitIds).has(id), `directive ${directive.id} targets unknown unit ${id}`));
      break;
    case "layers":
      assert(target.layerIds.length > 0, `directive ${directive.id} layer target is empty`);
      if (context) target.layerIds.forEach((id) => assert(toSet(context.layerIds).has(id), `directive ${directive.id} targets unknown layer ${id}`));
      break;
    case "range":
      assert(Number.isInteger(target.startMs) && Number.isInteger(target.endMs), `directive ${directive.id} range must use integer milliseconds`);
      assert(target.startMs >= 0 && target.endMs > target.startMs, `directive ${directive.id} range is reversed or empty`);
      if (context) assert(target.endMs <= context.durationMs, `directive ${directive.id} range exceeds the source duration`);
      break;
    default:
      throw new Error(`directive ${directive.id} has an invalid target scope`);
  }
}

export function assertReconstructionRevision(revision: ReconstructionRevision, context?: RevisionContext): void {
  assert(revision.schemaVersion === "0.1.0", "unsupported reconstruction revision schema version");
  assert(revision.id.length > 0 && revision.reconstructionId.length > 0, "revision identity fields are required");
  assert(Number.isInteger(revision.revision) && revision.revision >= 1, "revision number must be a positive integer");
  assert(revision.fidelityMapHash !== undefined || revision.formatRecipeHash !== undefined, "revision requires a Fidelity Map or Format Recipe lineage hash");
  if (revision.fidelityMapHash !== undefined) assertHash(revision.fidelityMapHash, "fidelityMapHash");
  if (revision.formatRecipeHash !== undefined) assertHash(revision.formatRecipeHash, "formatRecipeHash");
  assertHash(revision.sourceContentSha256, "sourceContentSha256");
  if (revision.parentRevisionHash !== undefined) assertHash(revision.parentRevisionHash, "parentRevisionHash");
  assert(revision.revision === 1 || revision.parentRevisionHash !== undefined, "revisions after the first must cite their parent hash");
  assert(revision.revision !== 1 || revision.parentRevisionHash === undefined, "the first revision cannot cite a parent");
  assert(revision.userIntent.trim().length > 0, "revision requires the user's intent");
  const ids = new Set<string>();
  for (const directive of revision.directives) {
    assert(!ids.has(directive.id), `duplicate directive id ${directive.id}`);
    ids.add(directive.id);
    assertTypedDirective(directive, context);
  }
}

export function revisionHash(revision: ReconstructionRevision): string {
  assertReconstructionRevision(revision);
  return contentHash(revision);
}

export function assertReconstruction(reconstruction: Reconstruction): void {
  assert(reconstruction.schemaVersion === "0.1.0", "unsupported reconstruction schema version");
  assert(reconstruction.id.length > 0 && reconstruction.workspaceId.length > 0 && reconstruction.referenceAssetId.length > 0, "reconstruction identity fields are required");
  assertHash(reconstruction.sourceContentSha256, "sourceContentSha256");
  assert(reconstruction.fidelityMapHash !== undefined || reconstruction.formatRecipeHash !== undefined, "reconstruction requires a Fidelity Map or Format Recipe lineage hash");
  if (reconstruction.fidelityMapHash !== undefined) assertHash(reconstruction.fidelityMapHash, "fidelityMapHash");
  if (reconstruction.formatRecipeHash !== undefined) assertHash(reconstruction.formatRecipeHash, "formatRecipeHash");
  assert(reconstruction.revisionHashes.length > 0, "reconstruction requires at least one revision");
  reconstruction.revisionHashes.forEach((hash, index) => assertHash(hash, `revisionHashes[${index}]`));
  assert(reconstruction.revisionHashes.at(-1) === reconstruction.headRevisionHash, "head revision must be the newest revision hash");
}

function directiveFingerprint(directive: TypedDirective): string {
  return contentHash({ kind: directive.kind, dimension: directive.dimension, target: directive.target, value: directive.value ?? null, intent: directive.intent });
}

/** Creates a child revision. The parent hash is computed here so callers cannot forge lineage. */
export function deriveRevision(parent: ReconstructionRevision, input: { id: string; userIntent: string; directives: TypedDirective[] }, context?: RevisionContext): ReconstructionRevision {
  const child: ReconstructionRevision = {
    schemaVersion: "0.1.0",
    id: input.id,
    reconstructionId: parent.reconstructionId,
    revision: parent.revision + 1,
    parentRevisionHash: revisionHash(parent),
    ...(parent.fidelityMapHash === undefined ? {} : { fidelityMapHash: parent.fidelityMapHash }),
    ...(parent.formatRecipeHash === undefined ? {} : { formatRecipeHash: parent.formatRecipeHash }),
    sourceContentSha256: parent.sourceContentSha256,
    userIntent: input.userIntent,
    directives: input.directives,
  };
  assertReconstructionRevision(child, context);
  return child;
}

/** Computes which directives and dimensions differ between a parent and child revision. */
export function diffRevisions(parent: ReconstructionRevision, child: ReconstructionRevision): RevisionDelta {
  assert(child.parentRevisionHash === revisionHash(parent), "child revision does not descend from the given parent");
  const parentById = new Map(parent.directives.map((directive) => [directive.id, directive]));
  const childById = new Map(child.directives.map((directive) => [directive.id, directive]));
  const added: TypedDirective[] = [];
  const changed: TypedDirective[] = [];
  const removed: TypedDirective[] = [];
  for (const directive of child.directives) {
    const previous = parentById.get(directive.id);
    if (previous === undefined) added.push(directive);
    else if (directiveFingerprint(previous) !== directiveFingerprint(directive)) changed.push(directive);
  }
  for (const directive of parent.directives) {
    if (!childById.has(directive.id)) removed.push(directive);
  }
  const effective = [...added, ...changed, ...removed];
  const affectedDimensions = [...new Set(effective.map((directive) => directive.dimension))].sort();
  return { added, removed, changed, effective, affectedDimensions };
}
