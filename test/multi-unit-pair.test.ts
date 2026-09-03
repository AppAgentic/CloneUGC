import assert from "node:assert/strict";
import test from "node:test";
import { assertControlStateHash, assertIdentityAnchor, providerDurationSeconds, providerPromptExclusions } from "../scripts/prepare-h3-multi-unit-pair.ts";

test("fails closed when the control prompt state is not the approved creative state", () => {
  const approved = "a".repeat(64);
  assert.doesNotThrow(() => assertControlStateHash(approved, approved));
  assert.throws(() => assertControlStateHash(approved, "b".repeat(64)), /approved creative state/);
  assert.throws(() => assertControlStateHash("not-a-hash", "not-a-hash"), /approved creative state/);
});

test("selects the shortest H3 duration that preserves near-real-time motion", () => {
  assert.equal(providerDurationSeconds(5_000), 5);
  assert.equal(providerDurationSeconds(5_241), 5);
  assert.equal(providerDurationSeconds(5_500), 5);
  assert.equal(providerDurationSeconds(5_501), 10);
  assert.equal(providerDurationSeconds(10_000), 10);
  assert.equal(providerDurationSeconds(11_000), 10);
  assert.throws(() => providerDurationSeconds(11_001), /near-real-time/);
});

test("requires explicit identity text when the setup frame is fully occluded", () => {
  const anchor = "the same fictional blonde adult woman";
  assert.doesNotThrow(() => assertIdentityAnchor(`Reveal ${anchor} in green gymwear.`, "fully_occluded", anchor));
  assert.throws(() => assertIdentityAnchor("Reveal the subject.", "fully_occluded", anchor), /missing identity anchor/);
  assert.throws(() => assertIdentityAnchor("Reveal the subject.", "fully_occluded"), /require an explicit identity anchor/);
  assert.doesNotThrow(() => assertIdentityAnchor("The setup visibly anchors identity.", "visible"));
});

test("translates internal rights constraints into short provider exclusions", () => {
  assert.equal(
    providerPromptExclusions(["must_not_transfer identity", "must_not_transfer logo", "exclude caption", "must_not_transfer music"]),
    "Exclusions: do not copy the source identity or change identity mid-take; no logos or watermarks; no generated dialogue or music; no generated text.",
  );
});
