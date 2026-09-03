import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPARATIVE_FIDELITY_PROMPT,
  COMPARATIVE_FIDELITY_PROMPT_VERSION,
  SOURCE_FORENSICS_PROMPT,
  SOURCE_FORENSICS_PROMPT_VERSION,
} from "../src/analysis-prompt.ts";

test("source-forensics prompt requires playback-rate and edit-segment analysis", () => {
  assert.equal(SOURCE_FORENSICS_PROMPT_VERSION, "analysis-v5");
  for (const required of [
    "real_time, sped_up, slowed_down, variable, or unknown",
    "startMs, endMs, durationMs",
    "speed ramps",
    "loop points",
    "motion blur",
    "audio pitch/cadence",
    "two independent temporal anchors",
    "Do not require a repeated action",
    "plausible natural-duration range",
    "Return unknown when fewer than two useful anchors exist",
    "60 fps versus 24 fps",
    "Timestamp passing lights",
    "Separate physical scene illumination from camera processing or grading",
    "catchlights",
    "explicit preserve/change instructions for lighting geometry",
  ]) {
    assert.match(SOURCE_FORENSICS_PROMPT, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("comparative prompt scores lighting independently with timestamped repairs", () => {
  assert.equal(COMPARATIVE_FIDELITY_PROMPT_VERSION, "comparison-v1");
  for (const required of [
    "dedicated lighting score from 1 to 10",
    "scene-lighting mismatches from grading/camera-processing mismatches",
    "passing streetlights",
    "timestamp range",
    "concrete repair instruction",
  ]) {
    assert.match(COMPARATIVE_FIDELITY_PROMPT, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
