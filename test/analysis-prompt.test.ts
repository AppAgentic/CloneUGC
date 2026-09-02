import assert from "node:assert/strict";
import test from "node:test";
import { SOURCE_FORENSICS_PROMPT, SOURCE_FORENSICS_PROMPT_VERSION } from "../src/analysis-prompt.ts";

test("source-forensics prompt requires playback-rate and edit-segment analysis", () => {
  assert.equal(SOURCE_FORENSICS_PROMPT_VERSION, "analysis-v2");
  for (const required of [
    "real_time, sped_up, slowed_down, variable, or unknown",
    "startMs, endMs, durationMs",
    "speed ramps",
    "loop points",
    "motion blur",
    "audio pitch/cadence",
  ]) {
    assert.match(SOURCE_FORENSICS_PROMPT, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
