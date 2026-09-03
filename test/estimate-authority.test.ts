import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovalToken, assertRightsRecord, checkGenerationAuthority, mintApprovalToken } from "../src/authority.ts";
import { assertGenerationEstimate, estimateGeneration, resolveBilledDuration } from "../src/estimate.ts";
import { WORKSPACE, omit, sampleCapabilities, sampleEstimate, sampleEvidence, sampleMap, samplePlan, samplePolicy, sampleRevision, sampleRights, sampleTokens } from "./helpers/sample.ts";

test("estimates resolve provider minimum durations internally and bound cost with contingency", () => {
  const plan = samplePlan();
  const estimate = sampleEstimate(plan);
  assert.doesNotThrow(() => assertGenerationEstimate(estimate));
  assert.equal(estimate.units.length, 4);
  const anchors = estimate.units.filter((unit) => unit.providerClass === "image_anchor");
  const motions = estimate.units.filter((unit) => unit.providerClass === "video_motion");
  assert.deepEqual(anchors.map((unit) => unit.costUsdMicros), [90_000, 90_000]);
  assert.deepEqual(motions.map((unit) => unit.billedDurationMs), [5_000, 5_000]);
  assert.deepEqual(motions.map((unit) => unit.costUsdMicros), [50_000, 50_000]);
  assert.equal(estimate.subtotalUsdMicros, 280_000);
  assert.equal(estimate.contingencyUsdMicros, 28_000);
  assert.equal(estimate.maxCostUsdMicros, 308_000);
  assert.equal(estimate.expiresAtMs, 1_000 + samplePolicy.ttlMs);
  assert.ok(!JSON.stringify(estimate).includes("fake-video"), "estimates never leak adapter ids");
  assert.equal(sampleEstimate(plan).estimateHash, estimate.estimateHash);
});

test("billed duration rounds up to the provider step and never below its minimum", () => {
  const video = sampleCapabilities[1]!;
  assert.equal(resolveBilledDuration(4_790, video), 5_000);
  assert.equal(resolveBilledDuration(5_241, video), 6_000);
  assert.equal(resolveBilledDuration(500, video), 5_000);
  assert.throws(() => resolveBilledDuration(16_000, video), /exceeds the provider class maximum/);
});

test("reused unit artifacts cost nothing and are recorded as a policy assumption", () => {
  const plan = samplePlan();
  const estimate = sampleEstimate(plan, 1_000, ["unit-1:anchor", "unit-1:motion"]);
  assert.equal(estimate.subtotalUsdMicros, 140_000);
  assert.ok(estimate.policyAssumptions.some((assumption) => /2 accepted unit artifact/.test(assumption)));
  assert.throws(() => estimateGeneration({ plan, capabilities: sampleCapabilities, policy: samplePolicy, nowMs: 1, reusedUnitIds: ["ghost"] }), /not in the plan/);
});

test("rights records and approval tokens are validated and content addressed", () => {
  assert.doesNotThrow(() => assertRightsRecord(sampleRights()));
  assert.throws(() => assertRightsRecord(sampleRights({ authorizedElements: ["minor"] })), /never authorize/);
  const plan = samplePlan();
  const estimate = sampleEstimate(plan);
  const { spendToken } = sampleTokens(plan, estimate);
  assert.doesNotThrow(() => assertApprovalToken(spendToken));
  assert.throws(() => assertApprovalToken({ ...spendToken, ceilingUsdMicros: spendToken.ceilingUsdMicros! * 10 }), /hash does not match/);
  assert.throws(() => mintApprovalToken({ id: "x", authority: "spend", workspaceId: WORKSPACE, subjectId: "u", binding: { sourceContentSha256: plan.sourceContentSha256, revisionHash: plan.revisionHash, planHash: plan.planHash }, issuedAtMs: 0, ttlMs: 10 }), /bind an estimate hash/);
});

test("generation authority passes only with matching rights, estimate, and single-use approvals", () => {
  const plan = samplePlan();
  const estimate = sampleEstimate(plan);
  const tokens = sampleTokens(plan, estimate);
  const base = { workspaceId: WORKSPACE, nowMs: 2_000, map: sampleMap, evidence: sampleEvidence, revision: sampleRevision(), plan, estimate, rights: sampleRights(), ...tokens };
  assert.deepEqual(checkGenerationAuthority(base), { eligible: true, reasons: [] });

  assert.deepEqual(checkGenerationAuthority(omit(base, "rights")).reasons, ["rights attestation is required"]);
  assert.deepEqual(checkGenerationAuthority(omit(base, "spendToken")).reasons, ["spend approval is required"]);
  assert.deepEqual(checkGenerationAuthority({ ...base, nowMs: estimate.expiresAtMs }).reasons, ["estimate has expired", "rights approval has expired", "spend approval has expired"]);
  assert.ok(checkGenerationAuthority({ ...base, spendToken: { ...tokens.spendToken, consumedByJobId: "job-0" } }).reasons.some((reason) => /already consumed/.test(reason)));
  assert.ok(checkGenerationAuthority({ ...base, workspaceId: "workspace-2" }).reasons.some((reason) => /another workspace/.test(reason)));
  assert.ok(checkGenerationAuthority({ ...base, rights: sampleRights({ revokedAtMs: 1_500 }) }).reasons.includes("rights record is expired or revoked"));
});

test("a changed reconstruction or a lower ceiling fails closed", () => {
  const plan = samplePlan();
  const estimate = sampleEstimate(plan);
  const tokens = sampleTokens(plan, estimate);
  const changedPlan = samplePlan(sampleRevision({ userIntent: "Slightly different intent" }));
  const changedEstimate = sampleEstimate(changedPlan);
  const mismatched = checkGenerationAuthority({ workspaceId: WORKSPACE, nowMs: 2_000, revision: sampleRevision({ userIntent: "Slightly different intent" }), plan: changedPlan, estimate: changedEstimate, rights: sampleRights(), ...tokens });
  assert.ok(mismatched.reasons.includes("approval is bound to a different reconstruction revision"));
  assert.ok(mismatched.reasons.includes("approval is bound to a different compiled plan"));
  assert.ok(mismatched.reasons.includes("approval is bound to a different estimate"));

  const lowCeiling = sampleTokens(plan, estimate, 1_000, estimate.maxCostUsdMicros - 1);
  assert.ok(checkGenerationAuthority({ workspaceId: WORKSPACE, nowMs: 2_000, revision: sampleRevision(), plan, estimate, rights: sampleRights(), ...lowCeiling }).reasons.includes("spend approval ceiling is below the estimate maximum"));

  const authorizedIdentityMap = { ...sampleMap, risks: [{ ...sampleMap.risks[0]!, disposition: "authorized" as const }] };
  const result = checkGenerationAuthority({ workspaceId: WORKSPACE, nowMs: 2_000, map: authorizedIdentityMap, evidence: sampleEvidence, revision: sampleRevision(), plan, estimate, rights: sampleRights(), ...tokens });
  assert.ok(result.reasons.includes("Fidelity Map authorizes identity transfer but the rights record does not"));
});
