import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compilePlanFromFormat } from "../src/compiler.ts";
import { estimateGeneration } from "../src/estimate.ts";
import { compileFormatRecipe, formatRecipeHash, type CompiledFormatPlan, type FormatRecipe } from "../src/format-recipe.ts";
import { createHarness, runToSettled } from "./helpers/kernel.ts";
import { sampleCapabilities, samplePolicy } from "./helpers/sample.ts";

const replay = JSON.parse(readFileSync(new URL("../fixtures/replays/hand-wipe-blonde-r3ta-pepmod-v1.json", import.meta.url), "utf8")) as CompiledFormatPlan;
const recipe = JSON.parse(readFileSync(new URL("../fixtures/formats/hand-wipe-fitness-transformation-v1.json", import.meta.url), "utf8")) as FormatRecipe;
const SOURCE_AUDIO_HASH = "0db4e5c295d0a8d7046a71e27605a8a6bf6bee8cd16f2219a2e88878f1862ec8";

test("replaying the accepted r3ta/pepmod instantiation reproduces its historical recipe and plan hashes", () => {
  assert.equal(formatRecipeHash(recipe), replay.recipeHash, "the committed recipe is byte-for-byte the one used in the accepted run");
  const compiled = compileFormatRecipe(recipe, { userPrompt: replay.userPrompt, values: replay.resolvedValues });
  assert.equal(compiled.planHash, replay.planHash);
  assert.equal(compiled.planHash, "b0c7e2809328584b91b0f0ccaa56fe1a73c4460031024e3ec753d8ce6599d93b");
  assert.deepEqual(compiled.shots.map((shot) => shot.anchorPrompt), replay.shots.map((shot) => shot.anchorPrompt));
  assert.deepEqual(compiled.deterministicLayers, replay.deterministicLayers);
});

test("the replayed format plan compiles to a stable kernel plan whose fake run is deterministic end to end", () => {
  const formatPlan = compileFormatRecipe(recipe, { userPrompt: replay.userPrompt, values: replay.resolvedValues });
  const revision = { schemaVersion: "0.1.0" as const, id: "rev-replay", reconstructionId: "recon-replay", revision: 1, formatRecipeHash: replay.recipeHash, sourceContentSha256: SOURCE_AUDIO_HASH, userIntent: replay.userPrompt, directives: [] };
  const planA = compilePlanFromFormat({ formatPlan, revision, sourceContentSha256: SOURCE_AUDIO_HASH });
  const planB = compilePlanFromFormat({ formatPlan, revision, sourceContentSha256: SOURCE_AUDIO_HASH });
  assert.equal(planA.planHash, planB.planHash);
  assert.equal(planA.lineage.formatPlanHash, replay.planHash);
  const estimate = estimateGeneration({ plan: planA, capabilities: sampleCapabilities, policy: samplePolicy, nowMs: 1 });
  assert.deepEqual(estimate.units.filter((unit) => unit.providerClass === "video_motion").map((unit) => unit.billedDurationMs), [5_000, 6_000], "4790ms and 5241ms takes bill 5s and 6s at a 1s step");

  const masters: string[] = [];
  for (const workerId of ["worker-a", "worker-b"]) {
    const harness = createHarness();
    harness.kernel.registerRightsRecord({ schemaVersion: "0.1.0", id: "rights-replay", workspaceId: "workspace-1", sourceContentSha256: SOURCE_AUDIO_HASH, status: "owned", authorizedElements: [], attesterId: "user-1", attestedAtMs: 0 });
    const { rightsToken, spendToken } = mintReplayTokens(planA.planHash, planA.revisionHash, estimateHashOf(planA, harness.clock.nowMs()));
    harness.kernel.registerApprovalToken(rightsToken);
    harness.kernel.registerApprovalToken(spendToken);
    const replayEstimate = estimateGeneration({ plan: planA, capabilities: sampleCapabilities, policy: samplePolicy, nowMs: harness.clock.nowMs() });
    const { job } = harness.kernel.createJob({ workspaceId: "workspace-1", actorId: "user-1", idempotencyKey: "replay", revision, plan: planA, estimate: replayEstimate, rightsRecordId: "rights-replay", rightsTokenId: rightsToken.id, spendTokenId: spendToken.id });
    runToSettled(harness, job.id, workerId);
    const finished = harness.kernel.getJob(job.id);
    assert.equal(finished.state, "succeeded");
    masters.push(finished.finishing!.masterAssetHash);
    assert.equal(harness.kernel.ledgerSummary(job.id).captureEntries, 4);
  }
  assert.equal(masters[0], masters[1], "deterministic finishing reproduces the same master hash from the same unit artifacts");
});

import { mintApprovalToken } from "../src/authority.ts";
import type { CompiledPlan } from "../src/compiler.ts";

function estimateHashOf(plan: CompiledPlan, nowMs: number): string {
  return estimateGeneration({ plan, capabilities: sampleCapabilities, policy: samplePolicy, nowMs }).estimateHash;
}

function mintReplayTokens(planHash: string, revisionHash: string, estimateHash: string) {
  const binding = { sourceContentSha256: SOURCE_AUDIO_HASH, revisionHash, planHash, formatRecipeHash: replay.recipeHash };
  return {
    rightsToken: mintApprovalToken({ id: "replay-rights", authority: "rights", workspaceId: "workspace-1", subjectId: "user-1", binding, issuedAtMs: 10_000, ttlMs: 3_600_000 }),
    spendToken: mintApprovalToken({ id: "replay-spend", authority: "spend", workspaceId: "workspace-1", subjectId: "user-1", binding: { ...binding, estimateHash }, ceilingUsdMicros: 10_000_000, issuedAtMs: 10_000, ttlMs: 3_600_000 }),
  };
}
