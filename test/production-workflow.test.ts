import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../src/canonical.ts";
import type { CompiledPlan, FinishingStep, PlanUnit } from "../src/compiler.ts";
import { estimateGeneration } from "../src/estimate.ts";
import { assertProductionWorkflowPlan, buildProductionWorkflowProfile, PRODUCTION_RESOLUTION } from "../src/production-workflow.ts";
import { createHarness } from "./helpers/kernel.ts";
import { sampleEstimate, samplePlan, sampleRevision } from "./helpers/sample.ts";

const nowMs = Date.UTC(2026, 8, 3);

function rehashPlan(plan: CompiledPlan): void {
  plan.units = plan.units.map((unit) => {
    const { unitHash: _oldHash, ...core } = unit;
    return { ...core, unitHash: contentHash(core) } as PlanUnit;
  });
  plan.finishing = plan.finishing.map((step) => {
    const { stepHash: _oldHash, ...core } = step;
    return { ...core, stepHash: contentHash(core) } as FinishingStep;
  });
  const { planHash: _oldHash, ...core } = plan;
  plan.planHash = contentHash(core);
}

function profile() {
  return buildProductionWorkflowProfile({
    nowMs,
    estimateTtlMs: 3_600_000,
    priceSnapshot: {
      id: "pricing-2026-09-03",
      capturedAtMs: nowMs,
      currency: "USD",
      imageAnchorFixedUsdMicros: 100_000,
      videoMotionPerSecondUsdMicros: 80_000,
      sourceUrls: [
        "https://developers.openai.com/api/docs/models/gpt-image-2",
        "https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api",
      ],
    },
  });
}

test("accepts the setup-frame plus image-to-video per-take compiler graph", () => {
  const plan = samplePlan();
  assert.doesNotThrow(() => assertProductionWorkflowPlan(plan));
  assert.equal(plan.units.filter((unit) => unit.kind === "anchor").length, 2);
  assert.equal(plan.units.filter((unit) => unit.kind === "motion").length, 2);
});

test("rejects direct video-to-video, text-to-video, and collapsed multi-take plans", () => {
  const plan = samplePlan();
  const directVideo = structuredClone(plan);
  directVideo.units.find((unit) => unit.kind === "motion")!.strategy = "reference_to_video";
  rehashPlan(directVideo);
  assert.throws(() => assertProductionWorkflowPlan(directVideo), /must use image-to-video/);

  const textVideo = structuredClone(plan);
  textVideo.units.find((unit) => unit.kind === "motion")!.strategy = "text_to_video";
  rehashPlan(textVideo);
  assert.throws(() => assertProductionWorkflowPlan(textVideo), /must use image-to-video/);

  const collapsed = structuredClone(plan);
  collapsed.units = collapsed.units.filter((unit) => unit.id.startsWith("unit-1:"));
  const survivingUnitIds = new Set(collapsed.units.map((unit) => unit.id));
  collapsed.finishing = collapsed.finishing.filter((step) => step.id === "splice" || step.dependsOn.every((id) => survivingUnitIds.has(id) || !id.startsWith("unit-2:")));
  const splice = collapsed.finishing.find((step) => step.id === "splice")!;
  splice.dependsOn = collapsed.finishing.filter((step) => step.id !== "splice").map((step) => step.id);
  rehashPlan(collapsed);
  assert.throws(() => assertProductionWorkflowPlan(collapsed), /prohibits single generation|multi-take plan cannot collapse/);
});

test("production profile exposes only GPT Image setup strategies and H3 image-to-video at 768p", () => {
  const production = profile();
  assert.equal(production.estimatePolicy.resolution, PRODUCTION_RESOLUTION);
  assert.deepEqual(production.capabilities[0].supportedStrategies, ["generate", "edit_subject_anchor", "edit_previous_setup"]);
  assert.deepEqual(production.capabilities[1].supportedStrategies, ["image_to_video"]);
  assert.deepEqual(production.capabilities[1].supportedResolutions, ["768p"]);
  assert(!production.capabilities[1].supportedStrategies.includes("reference_to_video"));

  const estimate = estimateGeneration({ plan: samplePlan(), capabilities: production.capabilities, policy: production.estimatePolicy, nowMs });
  assert.equal(estimate.resolution, "768p");
  assert.equal(estimate.units.filter((unit) => unit.providerClass === "image_anchor").length, 2);
  assert.equal(estimate.units.filter((unit) => unit.providerClass === "video_motion").length, 2);
  assert.equal(estimate.subtotalUsdMicros, 1_000_000);
});

test("a production-configured kernel rejects an off-profile plan before it can be registered", () => {
  const harness = createHarness({ requiredProductionWorkflow: true });
  const directVideo = structuredClone(samplePlan());
  directVideo.units.find((unit) => unit.kind === "motion")!.strategy = "reference_to_video";
  rehashPlan(directVideo);
  assert.throws(
    () => harness.kernel.registerPlan(directVideo, sampleEstimate(directVideo), sampleRevision()),
    /must use image-to-video/,
  );
});

test("price snapshots fail closed when unpriced or unauditable", () => {
  assert.throws(() => buildProductionWorkflowProfile({
    nowMs,
    estimateTtlMs: 1,
    priceSnapshot: { id: "x", capturedAtMs: nowMs, currency: "USD", imageAnchorFixedUsdMicros: -1, videoMotionPerSecondUsdMicros: 80_000, sourceUrls: ["https://fal.ai"] },
  }), /non-negative integer/);
  assert.throws(() => buildProductionWorkflowProfile({
    nowMs,
    estimateTtlMs: 1,
    priceSnapshot: { id: "x", capturedAtMs: nowMs, currency: "USD", imageAnchorFixedUsdMicros: 1, videoMotionPerSecondUsdMicros: 80_000, sourceUrls: [] },
  }), /authoritative HTTPS sources/);
});
