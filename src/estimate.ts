import { contentHash } from "./canonical.ts";
import type { AnchorFrameStrategy, Milliseconds, MotionGenerationStrategy } from "./contracts.ts";
import { assertCompiledPlan, type CompiledPlan, type PlanUnit } from "./compiler.ts";

/**
 * Bounded generation estimates.
 *
 * Money is represented in integer USD micros so ledger arithmetic is exact. Provider minimum
 * durations, duration steps, and pricing live in provider capabilities resolved here, never in
 * public schemas. Provider classes are neutral; adapter ids stay internal.
 */

export type ProviderClass = "image_anchor" | "video_motion" | "deterministic_finishing";
export type Resolution = "480p" | "720p" | "768p" | "1080p";

export interface ProviderCapability {
  providerClass: ProviderClass;
  /** Internal adapter identifier. Never surfaced in customer-facing responses. */
  adapterId: string;
  supportedStrategies: Array<AnchorFrameStrategy | MotionGenerationStrategy>;
  minDurationMs: Milliseconds;
  maxDurationMs: Milliseconds;
  durationStepMs: Milliseconds;
  supportedResolutions: Resolution[];
  pricing: {
    fixedUsdMicros: number;
    perSecondUsdMicros: Partial<Record<Resolution, number>>;
  };
  supportsCancel: boolean;
}

export interface EstimatePolicy {
  resolution: Resolution;
  contingencyBasisPoints: number;
  ttlMs: Milliseconds;
}

export interface EstimateUnit {
  unitId: string;
  providerClass: ProviderClass;
  billedDurationMs: Milliseconds;
  costUsdMicros: number;
  reused: boolean;
}

export interface GenerationEstimate {
  schemaVersion: "0.1.0";
  id: string;
  planHash: string;
  revisionHash: string;
  lineage: CompiledPlan["lineage"];
  sourceContentSha256: string;
  currency: "USD";
  resolution: Resolution;
  units: EstimateUnit[];
  subtotalUsdMicros: number;
  contingencyUsdMicros: number;
  maxCostUsdMicros: number;
  createdAtMs: number;
  expiresAtMs: number;
  policyAssumptions: string[];
  estimateHash: string;
}

export const USD_MICROS = 1_000_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function providerClassForUnit(unit: PlanUnit): ProviderClass {
  if (unit.strategy === "deterministic_source" || unit.strategy === "use_authorized_reference") return "deterministic_finishing";
  return unit.kind === "anchor" ? "image_anchor" : "video_motion";
}

/** Rounds a target duration up to the provider's billable duration. */
export function resolveBilledDuration(targetMs: Milliseconds, capability: ProviderCapability): Milliseconds {
  assert(Number.isInteger(targetMs) && targetMs >= 0, "target duration must be a non-negative integer");
  if (capability.durationStepMs === 0) return Math.max(targetMs, capability.minDurationMs);
  const stepped = Math.ceil(targetMs / capability.durationStepMs) * capability.durationStepMs;
  const billed = Math.max(stepped, capability.minDurationMs);
  assert(billed <= capability.maxDurationMs, `target duration ${targetMs}ms exceeds the provider class maximum ${capability.maxDurationMs}ms`);
  return billed;
}

export function assertProviderCapability(capability: ProviderCapability): void {
  assert(capability.adapterId.length > 0, "provider capability requires an adapter id");
  assert(capability.minDurationMs >= 0 && capability.maxDurationMs >= capability.minDurationMs, "provider capability duration bounds are invalid");
  assert(capability.durationStepMs >= 0, "provider capability duration step cannot be negative");
  assert(capability.supportedResolutions.length > 0, "provider capability requires supported resolutions");
  assert(Number.isInteger(capability.pricing.fixedUsdMicros) && capability.pricing.fixedUsdMicros >= 0, "fixed pricing must be a non-negative integer of USD micros");
  for (const value of Object.values(capability.pricing.perSecondUsdMicros)) {
    assert(Number.isInteger(value) && value >= 0, "per-second pricing must be non-negative integer USD micros");
  }
}

export function estimateGeneration(input: {
  plan: CompiledPlan;
  capabilities: readonly ProviderCapability[];
  policy: EstimatePolicy;
  nowMs: number;
  /** Unit ids whose accepted artifacts will be reused byte-for-byte; they cost nothing. */
  reusedUnitIds?: readonly string[];
}): GenerationEstimate {
  const { plan, policy } = input;
  assertCompiledPlan(plan);
  input.capabilities.forEach(assertProviderCapability);
  assert(Number.isInteger(policy.contingencyBasisPoints) && policy.contingencyBasisPoints >= 0 && policy.contingencyBasisPoints <= 10_000, "contingency must be 0-10000 basis points");
  assert(policy.ttlMs > 0, "estimate ttl must be positive");
  const reused = new Set(input.reusedUnitIds ?? []);
  for (const id of reused) assert(plan.units.some((unit) => unit.id === id), `reused unit ${id} is not in the plan`);
  const byClass = new Map(input.capabilities.map((capability) => [capability.providerClass, capability]));
  const assumptions: string[] = [`resolution ${policy.resolution}`, `contingency ${policy.contingencyBasisPoints} bp`];

  const units: EstimateUnit[] = plan.units.map((unit) => {
    const providerClass = providerClassForUnit(unit);
    if (reused.has(unit.id)) {
      return { unitId: unit.id, providerClass, billedDurationMs: 0, costUsdMicros: 0, reused: true };
    }
    if (providerClass === "deterministic_finishing") {
      return { unitId: unit.id, providerClass, billedDurationMs: unit.targetDurationMs, costUsdMicros: 0, reused: false };
    }
    const capability = byClass.get(providerClass);
    assert(capability !== undefined, `no provider capability registered for ${providerClass}`);
    assert(capability.supportedStrategies.includes(unit.strategy), `provider class ${providerClass} does not support ${unit.strategy}`);
    assert(capability.supportedResolutions.includes(policy.resolution), `provider class ${providerClass} does not support ${policy.resolution}`);
    const billedDurationMs = unit.kind === "anchor" ? 0 : resolveBilledDuration(unit.targetDurationMs, capability);
    const perSecond = capability.pricing.perSecondUsdMicros[policy.resolution] ?? 0;
    const costUsdMicros = capability.pricing.fixedUsdMicros + Math.ceil((billedDurationMs * perSecond) / 1000);
    return { unitId: unit.id, providerClass, billedDurationMs, costUsdMicros, reused: false };
  });
  if (reused.size > 0) assumptions.push(`${reused.size} accepted unit artifact(s) reused at zero cost`);
  const padded = units.filter((unit) => !unit.reused && unit.providerClass === "video_motion" && unit.billedDurationMs > (plan.units.find((candidate) => candidate.id === unit.unitId)?.targetDurationMs ?? 0));
  if (padded.length > 0) assumptions.push(`${padded.length} motion unit(s) padded to the provider minimum or step and trimmed deterministically`);

  const subtotalUsdMicros = units.reduce((sum, unit) => sum + unit.costUsdMicros, 0);
  const contingencyUsdMicros = Math.ceil((subtotalUsdMicros * policy.contingencyBasisPoints) / 10_000);
  const core = {
    schemaVersion: "0.1.0" as const,
    planHash: plan.planHash,
    revisionHash: plan.revisionHash,
    lineage: plan.lineage,
    sourceContentSha256: plan.sourceContentSha256,
    currency: "USD" as const,
    resolution: policy.resolution,
    units,
    subtotalUsdMicros,
    contingencyUsdMicros,
    maxCostUsdMicros: subtotalUsdMicros + contingencyUsdMicros,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + policy.ttlMs,
    policyAssumptions: assumptions,
  };
  const estimateHash = contentHash(core);
  return { id: `est_${estimateHash.slice(0, 16)}`, ...core, estimateHash };
}

export function assertGenerationEstimate(estimate: GenerationEstimate): void {
  const { id, estimateHash, ...core } = estimate;
  assert(estimate.schemaVersion === "0.1.0", "unsupported estimate schema version");
  assert(estimate.currency === "USD", "estimate currency must be USD");
  assert(["480p", "720p", "768p", "1080p"].includes(estimate.resolution), "estimate resolution is invalid");
  assert(/^[a-f0-9]{64}$/.test(estimateHash), "estimate hash must be a lowercase SHA-256 hash");
  assert(contentHash(core) === estimateHash, "estimate hash does not match its content");
  assert(id === `est_${estimateHash.slice(0, 16)}`, "estimate id does not match its hash");
  const unitIds = new Set<string>();
  for (const unit of estimate.units) {
    assert(unit.unitId.length > 0, "estimate unit id is required");
    assert(!unitIds.has(unit.unitId), `estimate contains duplicate unit ${unit.unitId}`);
    unitIds.add(unit.unitId);
    assert(["image_anchor", "video_motion", "deterministic_finishing"].includes(unit.providerClass), `estimate unit ${unit.unitId} has an invalid provider class`);
    assert(Number.isSafeInteger(unit.billedDurationMs) && unit.billedDurationMs >= 0, `estimate unit ${unit.unitId} has an invalid billed duration`);
    assert(Number.isSafeInteger(unit.costUsdMicros) && unit.costUsdMicros >= 0, `estimate unit ${unit.unitId} has an invalid cost`);
    if (unit.reused) assert(unit.costUsdMicros === 0 && unit.billedDurationMs === 0, `reused estimate unit ${unit.unitId} must have zero duration and cost`);
  }
  assert(Number.isSafeInteger(estimate.subtotalUsdMicros) && estimate.subtotalUsdMicros >= 0, "estimate subtotal must be a non-negative integer");
  assert(Number.isSafeInteger(estimate.contingencyUsdMicros) && estimate.contingencyUsdMicros >= 0, "estimate contingency must be a non-negative integer");
  assert(Number.isSafeInteger(estimate.maxCostUsdMicros) && estimate.maxCostUsdMicros >= 0, "estimate ceiling must be a non-negative integer");
  assert(estimate.subtotalUsdMicros === estimate.units.reduce((sum, unit) => sum + unit.costUsdMicros, 0), "estimate subtotal must equal its unit costs");
  assert(estimate.maxCostUsdMicros === estimate.subtotalUsdMicros + estimate.contingencyUsdMicros, "estimate ceiling must equal subtotal plus contingency");
  assert(estimate.expiresAtMs > estimate.createdAtMs, "estimate must expire after it was created");
}

export function formatUsd(micros: number): string {
  return `$${(micros / USD_MICROS).toFixed(4)}`;
}
