import { readFileSync, readdirSync } from "node:fs";
import { assertEvidenceArtifact, assertFidelityMap, fidelityMapHash, type EvidenceArtifact, type EvidenceClaim, type FidelityMap } from "./contracts.ts";
import type { FormatRecipe } from "./format-recipe.ts";

/**
 * A materialized Fidelity Map fixture: the validator-accepted map, the evidence it cites, the
 * evidence artifacts that produced that evidence, and the provenance of the materialization.
 */
export interface FidelityMapFixture {
  schemaVersion: "0.1.0";
  id: string;
  recipeId: string;
  family: string;
  materializedFrom: {
    analyzerOutput: string;
    sceneDetectLog: string;
    sourceProbe: { sha256: string; durationMs: number; fps: number; frames: number; width: number; height: number };
    materializedAt: string;
    notes: string[];
    [key: string]: unknown;
  };
  artifacts: EvidenceArtifact[];
  evidence: EvidenceClaim[];
  map: FidelityMap;
  fidelityMapHash: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Validates a fixture end to end: artifacts, evidence, map, stored hash, and provenance linkage. */
export function assertFidelityMapFixture(fixture: FidelityMapFixture): void {
  assert(fixture.schemaVersion === "0.1.0", "unsupported Fidelity Map fixture schema version");
  assert(fixture.id === fixture.map.id, "fixture id must equal the map id");
  assert(fixture.artifacts.length > 0, "fixture requires at least one evidence artifact");
  const artifactIds = new Set<string>();
  for (const artifact of fixture.artifacts) {
    assertEvidenceArtifact(artifact);
    assert(!artifactIds.has(artifact.id), `duplicate artifact id ${artifact.id}`);
    artifactIds.add(artifact.id);
    assert(artifact.sourceContentSha256 === fixture.map.sourceContentSha256, `artifact ${artifact.id} belongs to a different source`);
    assert(artifact.durationMs === fixture.map.durationMs, `artifact ${artifact.id} duration does not match the map`);
  }
  for (const claim of fixture.evidence) {
    assert(artifactIds.has(claim.artifactId), `evidence ${claim.id} cites unknown artifact ${claim.artifactId}`);
  }
  assertFidelityMap(fixture.map, fixture.evidence);
  assert(fidelityMapHash(fixture.map) === fixture.fidelityMapHash, "stored fidelityMapHash does not match the map content");
  assert(fixture.materializedFrom.sourceProbe.sha256 === fixture.map.sourceContentSha256, "source probe hash does not match the map");
  assert(fixture.materializedFrom.notes.length > 0, "fixture requires materialization notes");
  const modes = new Set(fixture.artifacts.map((artifact) => artifact.providerRun.mode));
  assert(modes.has("deterministic"), "fixture requires deterministic probe evidence alongside model evidence");
}

export function loadFidelityMapFixture(path: string | URL): FidelityMapFixture {
  const fixture = JSON.parse(readFileSync(path, "utf8")) as FidelityMapFixture;
  assertFidelityMapFixture(fixture);
  return fixture;
}

export function loadFidelityMapFixtures(directory: URL): FidelityMapFixture[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => loadFidelityMapFixture(new URL(name, directory)));
}

export type RecipeLineage = "fidelity_map" | "run_manifest" | "evidence_hash";

/** Reports how a recipe proves its structure: a validator-accepted Fidelity Map is the product-grade lineage. */
export function recipeLineage(recipe: FormatRecipe): RecipeLineage {
  if (recipe.provenance.sourceFidelityMapHash !== undefined) return "fidelity_map";
  if (recipe.provenance.sourceRunManifestSha256 !== undefined) return "run_manifest";
  return "evidence_hash";
}

/**
 * Checks that a recipe's structure can be re-derived from its Fidelity Map: same source, the same
 * ordered cut grammar, and shot boundaries equal to the map's edit segments. A recipe may end
 * inside the map's final segment when the validated run trimmed a tail deterministically.
 */
export function assertRecipeDerivesFromFidelityMap(recipe: FormatRecipe, fixture: FidelityMapFixture): void {
  assert(recipe.provenance.sourceFidelityMapHash === fixture.fidelityMapHash, `recipe ${recipe.id} does not cite Fidelity Map ${fixture.id}`);
  assert(recipe.provenance.sourceAssetId === fixture.map.sourceAssetId, `recipe ${recipe.id} cites a different source asset than the map`);
  assert(recipe.durationMs <= fixture.map.durationMs, `recipe ${recipe.id} duration ${recipe.durationMs} exceeds map duration ${fixture.map.durationMs}`);
  assert(recipe.shots.length === fixture.map.editSegments.length, `recipe ${recipe.id} has ${recipe.shots.length} shots but the map has ${fixture.map.editSegments.length} edit segments`);
  recipe.shots.forEach((shot, index) => {
    const segment = fixture.map.editSegments[index]!;
    const last = index === recipe.shots.length - 1;
    assert(shot.startMs === segment.range.startMs, `recipe ${recipe.id} shot ${shot.id} starts at ${shot.startMs}, map segment ${segment.id} starts at ${segment.range.startMs}`);
    assert(last ? shot.endMs <= segment.range.endMs : shot.endMs === segment.range.endMs, `recipe ${recipe.id} shot ${shot.id} ends at ${shot.endMs}, map segment ${segment.id} ends at ${segment.range.endMs}`);
    assert(shot.transitionIn === segment.transitionIn, `recipe ${recipe.id} shot ${shot.id} transition ${shot.transitionIn} does not match map segment ${segment.transitionIn}`);
    const unit = fixture.map.creatorWorkflow.generationUnits.find((candidate) => candidate.sourceShotIds.includes(segment.sourceShotId));
    assert(unit !== undefined, `map has no generation unit for ${segment.sourceShotId}`);
    assert(shot.generationStrategy === unit.motionStrategy, `recipe ${recipe.id} shot ${shot.id} strategy ${shot.generationStrategy} does not match map unit ${unit.motionStrategy}`);
  });
}
