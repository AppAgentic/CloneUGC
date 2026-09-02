import assert from "node:assert/strict";
import test from "node:test";
import { TEMPORAL_OBSERVER_PROMPT, TEMPORAL_OBSERVER_PROMPT_VERSION } from "../src/analysis-prompt.ts";

test("temporal observer emits measurements without a scalar speed verdict", () => {
  assert.equal(TEMPORAL_OBSERVER_PROMPT_VERSION, "temporal-observer-v1");
  for (const required of ["Do not classify playback speed", "inspectionStartMs", "inspectionEndMs", "clockId", "gait_step", "physical_settling", "directlyObserved false", "empty event list"]) {
    assert.match(TEMPORAL_OBSERVER_PROMPT, new RegExp(required));
  }
});
