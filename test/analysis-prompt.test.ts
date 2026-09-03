import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPARATIVE_FIDELITY_PROMPT,
  COMPARATIVE_FIDELITY_PROMPT_VERSION,
  SOURCE_FORENSICS_PROMPT,
  SOURCE_FORENSICS_PROMPT_VERSION,
} from "../src/analysis-prompt.ts";

test("source-forensics prompt requires playback-rate and edit-segment analysis", () => {
  assert.equal(SOURCE_FORENSICS_PROMPT_VERSION, "analysis-v9");
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
    "Audit every independently moving or deforming scene element",
    "source -> force -> affected elements -> visible response",
    "hair motion alone does not prove the window state",
    "none_observed",
    "single_take, multi_take, hybrid, or unknown",
    "same_person_across_states",
    "Do not infer different people from body size, wardrobe, hairstyle, or accessories alone",
    "identity lineage across all shots",
    "before/after weight loss",
    "Repeated A/B shots of the same action and framing",
    "one identity lineage with distinct state anchors",
    "state-specific soft-tissue distribution and silhouette",
    "cheek and lower-face fullness",
    "garment drape/tension",
    "prompt-ready relative deltas",
    "Do not estimate BMI, body-fat percentage, health, attractiveness, or medical status",
    "heavier body paired with an implausibly unchanged sculpted face",
    "full-frame hand or object occlusion does not prove continuous capture",
    "one generation unit per source shot",
    "edit_subject_anchor",
    "Provider minimum duration may exceed the source shot",
    "Persistent captions, logos, disclosures, audio, music, and exact cut timing belong in deterministic layers",
    "single-generation prohibition",
  ]) {
    assert.match(SOURCE_FORENSICS_PROMPT, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("comparative prompt scores lighting independently with timestamped repairs", () => {
  assert.equal(COMPARATIVE_FIDELITY_PROMPT_VERSION, "comparison-v2");
  for (const required of [
    "dedicated lighting and secondary-motion scores from 1 to 10",
    "scene-lighting mismatches from grading/camera-processing mismatches",
    "passing streetlights",
    "timestamp range",
    "concrete repair instruction",
    "Treat a missing subtle motion field as a fidelity failure",
  ]) {
    assert.match(COMPARATIVE_FIDELITY_PROMPT, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
