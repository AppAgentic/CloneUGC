import assert from "node:assert/strict";
import test from "node:test";
import { assertReconstruction, assertReconstructionRevision, assertTypedDirective, deriveRevision, diffRevisions, revisionHash, type TypedDirective } from "../src/directives.ts";
import { SOURCE_HASH, baseDirectives, omit, sampleMapHash, sampleRevision } from "./helpers/sample.ts";

test("typed directives require a known dimension, intent, and evidence for non-change kinds", () => {
  assert.doesNotThrow(() => assertTypedDirective(baseDirectives[0]!));
  assert.throws(() => assertTypedDirective({ ...baseDirectives[0]!, dimension: "vibes" as never }), /unknown dimension/);
  assert.throws(() => assertTypedDirective({ ...baseDirectives[0]!, evidenceIds: [] }), /requires evidence/);
  assert.throws(() => assertTypedDirective({ ...baseDirectives[0]!, intent: " " }), /natural-language intent/);
  assert.doesNotThrow(() => assertTypedDirective({ ...baseDirectives[2]!, evidenceIds: [] }));
});

test("directive targets are validated against the plan context", () => {
  const context = { durationMs: 10_000, unitIds: ["unit-1"], layerIds: ["layer:0"] };
  assert.throws(() => assertTypedDirective({ ...baseDirectives[0]!, target: { scope: "units", unitIds: ["unit-9"] } }, context), /unknown unit unit-9/);
  assert.throws(() => assertTypedDirective({ ...baseDirectives[2]!, target: { scope: "layers", layerIds: ["layer:9"] } }, context), /unknown layer layer:9/);
  assert.throws(() => assertTypedDirective({ ...baseDirectives[0]!, target: { scope: "range", startMs: 0, endMs: 12_000 } }, context), /exceeds the source duration/);
  assert.throws(() => assertTypedDirective({ ...baseDirectives[0]!, target: { scope: "range", startMs: 5_000, endMs: 5_000 } }, context), /reversed or empty/);
});

test("revisions form an immutable content-addressed chain", () => {
  const parent = sampleRevision();
  assert.doesNotThrow(() => assertReconstructionRevision(parent));
  const parentHash = revisionHash(parent);
  assert.match(parentHash, /^[a-f0-9]{64}$/);
  const child = deriveRevision(parent, { id: "rev-2", userIntent: "Change the wardrobe", directives: [...baseDirectives, { id: "t-wardrobe", kind: "change", dimension: "wardrobe", target: { scope: "units", unitIds: ["unit-2"] }, intent: "Green sweatpants", evidenceIds: [] }] });
  assert.equal(child.revision, 2);
  assert.equal(child.parentRevisionHash, parentHash);
  assert.equal(child.fidelityMapHash, sampleMapHash);
  assert.throws(() => assertReconstructionRevision(omit(child, "parentRevisionHash")), /must cite their parent hash/);
  assert.throws(() => assertReconstructionRevision({ ...parent, parentRevisionHash: "b".repeat(64) }), /first revision cannot cite a parent/);
  assert.throws(() => assertReconstructionRevision(omit(parent, "fidelityMapHash")), /lineage hash/);
  assert.throws(() => assertReconstructionRevision({ ...parent, directives: [...baseDirectives, baseDirectives[0]!] }), /duplicate directive id/);
});

test("revision diffs report only the directives and dimensions that changed", () => {
  const parent = sampleRevision();
  const wardrobe: TypedDirective = { id: "t-wardrobe", kind: "change", dimension: "wardrobe", target: { scope: "units", unitIds: ["unit-2"] }, intent: "Green sweatpants", evidenceIds: [] };
  const child = deriveRevision(parent, {
    id: "rev-2",
    userIntent: "Change the wardrobe and caption",
    directives: [baseDirectives[0]!, baseDirectives[1]!, { ...baseDirectives[2]!, value: "90 days of GymLevels" }, wardrobe],
  });
  const delta = diffRevisions(parent, child);
  assert.deepEqual(delta.added.map((directive) => directive.id), ["t-wardrobe"]);
  assert.deepEqual(delta.changed.map((directive) => directive.id), ["t-caption"]);
  assert.deepEqual(delta.removed, []);
  assert.deepEqual(delta.affectedDimensions, ["caption", "wardrobe"]);
  const unrelated = sampleRevision({ id: "rev-x", userIntent: "Different parent" });
  assert.throws(() => diffRevisions(unrelated, child), /does not descend/);
});

test("reconstructions track their revision chain head", () => {
  const head = revisionHash(sampleRevision());
  assert.doesNotThrow(() => assertReconstruction({ schemaVersion: "0.1.0", id: "recon-1", workspaceId: "workspace-1", referenceAssetId: "ref-1", sourceContentSha256: SOURCE_HASH, fidelityMapHash: sampleMapHash, headRevisionHash: head, revisionHashes: [head] }));
  assert.throws(() => assertReconstruction({ schemaVersion: "0.1.0", id: "recon-1", workspaceId: "workspace-1", referenceAssetId: "ref-1", sourceContentSha256: SOURCE_HASH, fidelityMapHash: sampleMapHash, headRevisionHash: "c".repeat(64), revisionHashes: [head] }), /head revision must be the newest/);
});
