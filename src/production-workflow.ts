import type { CompiledPlan, PlanUnit } from "./compiler.ts";
import { assertCompiledPlan } from "./compiler.ts";
import type { EstimatePolicy, ProviderCapability } from "./estimate.ts";

/**
 * CloneUGC's approved production generation profile.
 *
 * Provider names and routes stay inside adapters. The domain-level invariant is that a
 * rights-safe setup frame establishes appearance for every take before an image-to-video motion
 * call. Direct source-video-to-video and text-to-video calls cannot satisfy this profile.
 */

export const PRODUCTION_WORKFLOW_ID = "setup-frame-image-to-video-per-take-v1" as const;
export const PRODUCTION_RESOLUTION = "768p" as const;

export interface ProductionPriceSnapshot {
  id: string;
  capturedAtMs: number;
  currency: "USD";
  imageAnchorFixedUsdMicros: number;
  videoMotionPerSecondUsdMicros: number;
  sourceUrls: string[];
}

export interface ProductionWorkflowProfile {
  id: typeof PRODUCTION_WORKFLOW_ID;
  estimatePolicy: EstimatePolicy;
  capabilities: [ProviderCapability, ProviderCapability];
  priceSnapshotId: string;
}

const SETUP_STRATEGIES = new Set(["generate", "edit_subject_anchor", "edit_previous_setup"]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertMicros(value: number, field: string): void {
  assert(Number.isSafeInteger(value) && value >= 0, `${field} must be a non-negative integer of USD micros`);
}

function pairedAnchor(plan: CompiledPlan, motion: PlanUnit): PlanUnit {
  assert(motion.dependsOn.length === 1, `motion unit ${motion.id} must depend on exactly one setup frame`);
  const anchor = plan.units.find((unit) => unit.id === motion.dependsOn[0]);
  assert(anchor !== undefined && anchor.kind === "anchor", `motion unit ${motion.id} must depend on an anchor unit`);
  return anchor;
}

export function assertProductionWorkflowPlan(plan: CompiledPlan): void {
  assertCompiledPlan(plan);
  const anchors = plan.units.filter((unit) => unit.kind === "anchor");
  const motions = plan.units.filter((unit) => unit.kind === "motion");
  assert(motions.length > 0, "production plan requires at least one motion unit");
  assert(anchors.length === motions.length, "production plan requires one setup frame per take");
  if (plan.singleGenerationProhibited) {
    assert(motions.length > 1, "a multi-take plan cannot collapse into one motion request");
  }
  for (const anchor of anchors) {
    assert(SETUP_STRATEGIES.has(anchor.strategy), `anchor unit ${anchor.id} must be generated or edited with the setup-frame provider`);
    assert(anchor.targetDurationMs === 0, `anchor unit ${anchor.id} cannot have a video duration`);
  }
  for (const motion of motions) {
    assert(motion.strategy === "image_to_video", `motion unit ${motion.id} must use image-to-video`);
    const anchor = pairedAnchor(plan, motion);
    assert(anchor.setupId === motion.setupId, `motion unit ${motion.id} and its setup frame must share a setup id`);
    assert(
      anchor.sourceShotIds.length === motion.sourceShotIds.length && anchor.sourceShotIds.every((id, index) => id === motion.sourceShotIds[index]),
      `motion unit ${motion.id} and its setup frame must cover the same source shots`,
    );
  }
}

export function buildProductionWorkflowProfile(input: {
  priceSnapshot: ProductionPriceSnapshot;
  nowMs: number;
  estimateTtlMs: number;
  contingencyBasisPoints?: number;
}): ProductionWorkflowProfile {
  const { priceSnapshot } = input;
  assert(priceSnapshot.id.trim().length > 0, "price snapshot requires an id");
  assert(priceSnapshot.currency === "USD", "production price snapshot must use USD");
  assert(Number.isSafeInteger(priceSnapshot.capturedAtMs) && priceSnapshot.capturedAtMs > 0, "price snapshot requires a capture timestamp");
  assert(priceSnapshot.capturedAtMs <= input.nowMs, "price snapshot cannot be from the future");
  assert(priceSnapshot.sourceUrls.length > 0 && priceSnapshot.sourceUrls.every((url) => /^https:\/\//.test(url)), "price snapshot requires authoritative HTTPS sources");
  assertMicros(priceSnapshot.imageAnchorFixedUsdMicros, "image anchor price");
  assertMicros(priceSnapshot.videoMotionPerSecondUsdMicros, "video motion price");
  assert(Number.isSafeInteger(input.estimateTtlMs) && input.estimateTtlMs > 0, "estimate ttl must be positive");
  const contingencyBasisPoints = input.contingencyBasisPoints ?? 1_000;
  assert(Number.isSafeInteger(contingencyBasisPoints) && contingencyBasisPoints >= 0 && contingencyBasisPoints <= 10_000, "contingency must be 0-10000 basis points");
  return {
    id: PRODUCTION_WORKFLOW_ID,
    priceSnapshotId: priceSnapshot.id,
    estimatePolicy: { resolution: PRODUCTION_RESOLUTION, contingencyBasisPoints, ttlMs: input.estimateTtlMs },
    capabilities: [
      {
        providerClass: "image_anchor",
        adapterId: "openai-gpt-image-2",
        supportedStrategies: ["generate", "edit_subject_anchor", "edit_previous_setup"],
        minDurationMs: 0,
        maxDurationMs: 0,
        durationStepMs: 0,
        supportedResolutions: [PRODUCTION_RESOLUTION],
        pricing: { fixedUsdMicros: priceSnapshot.imageAnchorFixedUsdMicros, perSecondUsdMicros: {} },
        supportsCancel: false,
      },
      {
        providerClass: "video_motion",
        adapterId: "fal-minimax-h3-max-turbo-i2v",
        supportedStrategies: ["image_to_video"],
        minDurationMs: 5_000,
        maxDurationMs: 15_000,
        durationStepMs: 1_000,
        supportedResolutions: [PRODUCTION_RESOLUTION],
        pricing: { fixedUsdMicros: 0, perSecondUsdMicros: { [PRODUCTION_RESOLUTION]: priceSnapshot.videoMotionPerSecondUsdMicros } },
        supportsCancel: true,
      },
    ],
  };
}
