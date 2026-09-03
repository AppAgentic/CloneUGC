import { mintApprovalToken, type ApprovalToken, type RightsRecord } from "../../src/authority.ts";
import { compilePlanFromFidelityMap, type CompiledPlan } from "../../src/compiler.ts";
import { fidelityMapHash, type EvidenceClaim, type EvidenceRange, type FidelityMap } from "../../src/contracts.ts";
import { type ReconstructionRevision, type TypedDirective } from "../../src/directives.ts";
import { estimateGeneration, type EstimatePolicy, type GenerationEstimate, type ProviderCapability, USD_MICROS } from "../../src/estimate.ts";

export const SOURCE_HASH = "a".repeat(64);
export const WORKSPACE = "workspace-1";

function range(startMs: number, endMs: number): EvidenceRange {
  return { startMs, endMs, originalStartMs: startMs, originalEndMs: endMs, normalizedStartFrame: startMs * 30 / 1000, normalizedEndFrame: endMs * 30 / 1000 };
}

const full = range(0, 10_000);
const first = range(0, 5_000);
const second = range(5_000, 10_000);

export const sampleEvidence: EvidenceClaim[] = [
  { id: "e-shot-1", artifactId: "artifact-1", sourceContentSha256: SOURCE_HASH, kind: "shot", statement: "Static low phone shot in a bathroom.", status: "accepted", confidence: 0.95, directObservation: true, range: first },
  { id: "e-shot-2", artifactId: "artifact-1", sourceContentSha256: SOURCE_HASH, kind: "shot", statement: "Same room, brighter light, hand reveals subject.", status: "accepted", confidence: 0.95, directObservation: true, range: second },
  { id: "e-cut", artifactId: "artifact-1", sourceContentSha256: SOURCE_HASH, kind: "edit", statement: "Hand-occluded hard cut at 5000ms.", status: "accepted", confidence: 0.98, directObservation: true, range: range(4_900, 5_100) },
  { id: "e-light", artifactId: "artifact-1", sourceContentSha256: SOURCE_HASH, kind: "lighting", statement: "Warm overhead practical then brighter cooler light.", status: "accepted", confidence: 0.9, directObservation: true, range: full },
  { id: "e-motion", artifactId: "artifact-1", sourceContentSha256: SOURCE_HASH, kind: "secondary_motion", statement: "Loose shorts fabric swings with body turns.", status: "accepted", confidence: 0.85, directObservation: true, range: full },
  { id: "e-identity", artifactId: "artifact-1", sourceContentSha256: SOURCE_HASH, kind: "risk", statement: "One identifiable adult appears.", status: "accepted", confidence: 0.99, directObservation: true, range: full },
  { id: "e-caption", artifactId: "artifact-1", sourceContentSha256: SOURCE_HASH, kind: "text", statement: "Caption reads 2 months of commitment.", status: "accepted", confidence: 0.99, directObservation: true, range: first },
];

export const sampleMap: FidelityMap = {
  schemaVersion: "0.2.0",
  id: "map-sample",
  revision: 1,
  sourceAssetId: "source-sample",
  sourceContentSha256: SOURCE_HASH,
  durationMs: 10_000,
  rightsStatus: "owned",
  requestedChange: "Recreate with a fictional subject and a new caption.",
  playback: { classification: "real_time", estimatedMultiplier: 1, confidence: 0.9, cues: ["Natural turn cadence"], evidenceIds: ["e-shot-1"] },
  lighting: {
    summary: "Warm practical before, brighter cooler after.",
    sources: ["Overhead practical"],
    direction: "Top-front",
    colorTemperature: "Warm then cool",
    exposure: "Balanced then slightly over",
    contrast: "Medium",
    captureArtifacts: ["Phone sharpening"],
    events: [{ range: range(5_000, 5_500), description: "Exposure jumps brighter after the reveal.", evidenceIds: ["e-light"] }],
    evidenceIds: ["e-light"],
  },
  secondaryMotion: {
    summary: "Fabric swing follows body turns.",
    fields: [{ id: "motion-shorts", element: "Loose shorts", driver: "inertia", range: full, direction: "Lateral with turns", amplitude: "Low", cadence: "Follows each turn", coupling: "Small shadow shifts on legs", confidence: 0.85, directObservation: true, evidenceIds: ["e-motion"] }],
    evidenceIds: ["e-motion"],
  },
  editSegments: [
    { id: "s1", sourceShotId: "shot-1", range: first, durationMs: 5_000, transitionIn: "none", transitionDurationMs: 0, playback: { classification: "real_time", confidence: 0.9, cues: ["Turn cadence"], evidenceIds: ["e-shot-1"] }, evidenceIds: ["e-shot-1"] },
    { id: "s2", sourceShotId: "shot-2", range: second, durationMs: 5_000, transitionIn: "match_cut", transitionDurationMs: 200, playback: { classification: "real_time", confidence: 0.9, cues: ["Breathing cadence"], evidenceIds: ["e-shot-2"] }, evidenceIds: ["e-shot-2", "e-cut"] },
  ],
  creatorWorkflow: {
    captureMode: "multi_take",
    confidence: 0.95,
    rationale: ["Wardrobe and lighting reset under the hand occlusion."],
    subjectAnchor: "Generate one fictional rights-safe subject anchor and reuse it for both takes.",
    persistentElements: ["Subject identity", "Room geometry", "Camera placement"],
    shotLocalElements: ["Wardrobe", "Lighting temperature"],
    deterministicLayers: ["Hook caption over the first take", "Audio beat drop at the reveal"],
    setups: [
      { id: "setup-1", sourceShotIds: ["shot-1"], cameraSignature: "Static low phone", environmentSignature: "Beige bathroom", subjectState: "Relaxed", wardrobeState: "Dark shorts", lightingState: "Warm practical", evidenceIds: ["e-shot-1"] },
      { id: "setup-2", sourceShotIds: ["shot-2"], cameraSignature: "Static low phone", environmentSignature: "Beige bathroom", subjectState: "Flexed", wardrobeState: "Grey sweatpants", lightingState: "Brighter cooler", evidenceIds: ["e-shot-2"] },
    ],
    generationUnits: [
      { id: "unit-1", sourceShotIds: ["shot-1"], setupId: "setup-1", range: first, targetDurationMs: 5_000, providerDurationMs: 5_000, anchorFrameStrategy: "generate", motionStrategy: "image_to_video", transitionIn: "none", transitionDurationMs: 0, trimInstruction: "Trim to shot 1.", preserve: ["Framing"], change: ["Identity"], evidenceIds: ["e-shot-1"] },
      { id: "unit-2", sourceShotIds: ["shot-2"], setupId: "setup-2", range: second, targetDurationMs: 5_000, providerDurationMs: 5_000, anchorFrameStrategy: "edit_subject_anchor", motionStrategy: "image_to_video", transitionIn: "match_cut", transitionDurationMs: 200, trimInstruction: "Trim to shot 2.", preserve: ["Framing", "Identity from take one"], change: ["Identity"], evidenceIds: ["e-shot-2"] },
    ],
    evidenceIds: ["e-shot-1", "e-shot-2", "e-cut"],
  },
  beats: [
    { id: "b1", role: "hook", range: first, description: "Relaxed turn and hand to lens", evidenceIds: ["e-shot-1"] },
    { id: "b2", role: "payoff", range: second, description: "Reveal and flex", evidenceIds: ["e-shot-2"] },
  ],
  directives: [
    { id: "d-preserve-camera", kind: "preserve", description: "Preserve the low static framing", evidenceIds: ["e-shot-1"] },
    { id: "d-no-identity", kind: "must_not_transfer", description: "Do not transfer the source identity", evidenceIds: ["e-identity"] },
  ],
  risks: [{ id: "r-identity", kind: "identity", disposition: "exclude", evidenceIds: ["e-identity"] }],
};

export const sampleMapHash = fidelityMapHash(sampleMap);

export const baseDirectives: TypedDirective[] = [
  { id: "t-camera", kind: "preserve", dimension: "camera", target: { scope: "global" }, intent: "Keep the locked low phone framing", evidenceIds: ["e-shot-1"] },
  { id: "t-identity", kind: "must_not_transfer", dimension: "identity", target: { scope: "global" }, intent: "Never reproduce the source person", evidenceIds: ["e-identity"] },
  { id: "t-caption", kind: "change", dimension: "caption", target: { scope: "layers", layerIds: ["layer:0"] }, intent: "Use the new caption", value: "2 months of GymLevels", evidenceIds: [] },
];

export type RevisionOverrides = { [K in keyof ReconstructionRevision]?: ReconstructionRevision[K] | undefined };

/** Returns a copy without the named keys, keeping optional properties genuinely absent. */
export function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of keys) delete copy[key as string];
  return copy as Omit<T, K>;
}

export function sampleRevision(overrides: RevisionOverrides = {}): ReconstructionRevision {
  const merged: Record<string, unknown> = {
    schemaVersion: "0.1.0",
    id: "rev-1",
    reconstructionId: "recon-1",
    revision: 1,
    fidelityMapHash: sampleMapHash,
    sourceContentSha256: SOURCE_HASH,
    userIntent: "Recreate with a fictional subject and a new caption.",
    directives: baseDirectives,
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
  return merged as unknown as ReconstructionRevision;
}

export function samplePlan(revision: ReconstructionRevision = sampleRevision()): CompiledPlan {
  return compilePlanFromFidelityMap({ map: sampleMap, evidence: sampleEvidence, revision });
}

export const sampleCapabilities: ProviderCapability[] = [
  { providerClass: "image_anchor", adapterId: "fake-image", supportedStrategies: ["generate", "edit_subject_anchor", "edit_previous_setup"], minDurationMs: 0, maxDurationMs: 0, durationStepMs: 0, supportedResolutions: ["480p", "720p"], pricing: { fixedUsdMicros: 90_000, perSecondUsdMicros: {} }, supportsCancel: false },
  { providerClass: "video_motion", adapterId: "fake-video", supportedStrategies: ["image_to_video", "reference_to_video", "text_to_video"], minDurationMs: 5_000, maxDurationMs: 15_000, durationStepMs: 1_000, supportedResolutions: ["480p", "720p"], pricing: { fixedUsdMicros: 0, perSecondUsdMicros: { "480p": 10_000, "720p": 30_000 } }, supportsCancel: true },
];

export const samplePolicy: EstimatePolicy = { resolution: "480p", contingencyBasisPoints: 1_000, ttlMs: 60 * 60 * 1000 };

export function sampleEstimate(plan: CompiledPlan, nowMs = 1_000, reusedUnitIds: string[] = []): GenerationEstimate {
  return estimateGeneration({ plan, capabilities: sampleCapabilities, policy: samplePolicy, nowMs, reusedUnitIds });
}

export function sampleRights(overrides: Partial<RightsRecord> = {}): RightsRecord {
  return { schemaVersion: "0.1.0", id: "rights-1", workspaceId: WORKSPACE, sourceContentSha256: SOURCE_HASH, status: "owned", authorizedElements: [], attesterId: "user-1", attestedAtMs: 0, ...overrides };
}

export function sampleTokens(plan: CompiledPlan, estimate: GenerationEstimate, nowMs = 1_000, ceilingUsdMicros = estimate.maxCostUsdMicros): { rightsToken: ApprovalToken; spendToken: ApprovalToken } {
  const binding = { sourceContentSha256: plan.sourceContentSha256, revisionHash: plan.revisionHash, planHash: plan.planHash, ...(plan.lineage.fidelityMapHash === undefined ? {} : { fidelityMapHash: plan.lineage.fidelityMapHash }) };
  return {
    rightsToken: mintApprovalToken({ id: "approval-rights", authority: "rights", workspaceId: WORKSPACE, subjectId: "user-1", binding, issuedAtMs: nowMs, ttlMs: 3_600_000 }),
    spendToken: mintApprovalToken({ id: "approval-spend", authority: "spend", workspaceId: WORKSPACE, subjectId: "user-1", binding: { ...binding, estimateHash: estimate.estimateHash }, ceilingUsdMicros, issuedAtMs: nowMs, ttlMs: 3_600_000 }),
  };
}

export const ONE_USD = USD_MICROS;
