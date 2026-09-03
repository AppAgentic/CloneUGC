import { contentHash } from "./canonical.ts";

export type Milliseconds = number;
export type EvidenceStatus = "accepted" | "disputed" | "rejected";
export type AnalysisMode = "deterministic" | "human" | "static" | "agentic";
export type RightsStatus = "unverified" | "owned" | "licensed" | "other_valid_right";
export type PlaybackRateClass = "real_time" | "sped_up" | "slowed_down" | "variable" | "unknown";
export type TransitionType = "none" | "hard_cut" | "dissolve" | "fade" | "wipe" | "match_cut" | "other";
export type SecondaryMotionDriver = "airflow" | "gravity" | "inertia" | "contact" | "vibration" | "fluid" | "heat" | "mechanical" | "unknown";
export type CreatorCaptureMode = "single_take" | "multi_take" | "hybrid" | "unknown";
export type AnchorFrameStrategy = "generate" | "edit_subject_anchor" | "edit_previous_setup" | "use_authorized_reference";
export type MotionGenerationStrategy = "image_to_video" | "reference_to_video" | "text_to_video" | "deterministic_source";

export interface EvidenceRange {
  startMs: Milliseconds;
  endMs: Milliseconds;
  originalStartMs: Milliseconds;
  originalEndMs: Milliseconds;
  normalizedStartFrame: number;
  normalizedEndFrame: number;
}

export interface ProviderRun {
  provider: string;
  exactModel: string;
  mode: AnalysisMode;
  runId: string;
  promptVersion: string;
  interactionId?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolUseTokens: number;
  processingCalls: number;
}

export interface EvidenceArtifact {
  schemaVersion: "0.2.0";
  id: string;
  workspaceId: string;
  sourceAssetId: string;
  sourceContentSha256: string;
  normalizedContentSha256: string;
  durationMs: Milliseconds;
  normalizedFps: number;
  originalOffsetMs: Milliseconds;
  providerRun: ProviderRun;
  structuredPayloadArtifactId: string;
  summaryTruncated: boolean;
}

export interface EvidenceClaim {
  id: string;
  artifactId: string;
  sourceContentSha256: string;
  kind: "shot" | "edit" | "playback_rate" | "action" | "continuity" | "lighting" | "secondary_motion" | "text" | "audio" | "risk" | "other";
  statement: string;
  status: EvidenceStatus;
  confidence: number;
  directObservation: boolean;
  range?: EvidenceRange;
}

export interface FidelityDirective {
  id: string;
  kind: "preserve" | "change" | "exclude" | "must_not_transfer";
  description: string;
  evidenceIds: string[];
}

export interface FidelityBeat {
  id: string;
  role: "hook" | "setup" | "escalation" | "payoff" | "cta" | "other";
  range: EvidenceRange;
  description: string;
  evidenceIds: string[];
}

export interface RiskConstraint {
  id: string;
  kind: "identity" | "voice" | "logo" | "watermark" | "minor" | "music" | "dialogue" | "bystander" | "other";
  disposition: "authorized" | "exclude" | "unresolved";
  evidenceIds: string[];
}

export interface PlaybackRateAssessment {
  classification: PlaybackRateClass;
  estimatedMultiplier?: number;
  confidence: number;
  cues: string[];
  evidenceIds: string[];
}

export interface LightingEvent {
  range: EvidenceRange;
  description: string;
  evidenceIds: string[];
}

export interface LightingAssessment {
  summary: string;
  sources: string[];
  direction: string;
  colorTemperature: string;
  exposure: string;
  contrast: string;
  captureArtifacts: string[];
  events: LightingEvent[];
  evidenceIds: string[];
}

export interface SecondaryMotionField {
  id: string;
  element: string;
  driver: SecondaryMotionDriver;
  range: EvidenceRange;
  direction: string;
  amplitude: string;
  cadence: string;
  coupling: string;
  confidence: number;
  directObservation: boolean;
  evidenceIds: string[];
}

export interface SecondaryMotionAssessment {
  summary: string;
  fields: SecondaryMotionField[];
  evidenceIds: string[];
}

export interface EditSegment {
  id: string;
  sourceShotId: string;
  range: EvidenceRange;
  durationMs: Milliseconds;
  transitionIn: TransitionType;
  transitionDurationMs: Milliseconds;
  playback: PlaybackRateAssessment;
  evidenceIds: string[];
}

export interface CaptureSetup {
  id: string;
  sourceShotIds: string[];
  cameraSignature: string;
  environmentSignature: string;
  subjectState: string;
  wardrobeState: string;
  lightingState: string;
  evidenceIds: string[];
}

export interface GenerationUnit {
  id: string;
  sourceShotIds: string[];
  setupId: string;
  range: EvidenceRange;
  targetDurationMs: Milliseconds;
  providerDurationMs: Milliseconds;
  anchorFrameStrategy: AnchorFrameStrategy;
  endpointFrame?: {
    anchorFrameStrategy: AnchorFrameStrategy;
    prompt: string;
    evidenceIds: string[];
  };
  motionStrategy: MotionGenerationStrategy;
  transitionIn: TransitionType;
  transitionDurationMs: Milliseconds;
  trimInstruction: string;
  preserve: string[];
  change: string[];
  evidenceIds: string[];
}

export interface CreatorWorkflowPlan {
  captureMode: CreatorCaptureMode;
  confidence: number;
  rationale: string[];
  subjectAnchor: string;
  persistentElements: string[];
  shotLocalElements: string[];
  deterministicLayers: string[];
  setups: CaptureSetup[];
  generationUnits: GenerationUnit[];
  evidenceIds: string[];
}

export interface FidelityMap {
  schemaVersion: "0.2.0";
  id: string;
  revision: number;
  parentRevisionHash?: string;
  sourceAssetId: string;
  sourceContentSha256: string;
  durationMs: Milliseconds;
  rightsStatus: RightsStatus;
  requestedChange: string;
  playback: PlaybackRateAssessment;
  lighting: LightingAssessment;
  secondaryMotion: SecondaryMotionAssessment;
  editSegments: EditSegment[];
  creatorWorkflow: CreatorWorkflowPlan;
  beats: FidelityBeat[];
  directives: FidelityDirective[];
  risks: RiskConstraint[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHash(value: string, field: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${field} must be a lowercase SHA-256 hash`);
}

function assertRange(range: EvidenceRange, durationMs: number, field: string): void {
  for (const [name, value] of Object.entries(range)) {
    assert(Number.isInteger(value) && value >= 0, `${field}.${name} must be a non-negative integer`);
  }
  assert(range.startMs <= range.endMs, `${field} normalized timestamps are reversed`);
  assert(range.originalStartMs <= range.originalEndMs, `${field} original timestamps are reversed`);
  assert(range.endMs <= durationMs, `${field} exceeds normalized duration`);
  assert(range.normalizedStartFrame <= range.normalizedEndFrame, `${field} frame range is reversed`);
}

export function assertEvidenceArtifact(artifact: EvidenceArtifact): void {
  assert(artifact.schemaVersion === "0.2.0", "unsupported evidence schema version");
  assert(artifact.workspaceId.length > 0, "workspaceId is required");
  assert(artifact.durationMs > 0 && artifact.durationMs <= 30_000, "analysis artifact must be 1-30 seconds");
  assert(artifact.normalizedFps > 0, "normalizedFps must be positive");
  assert(Number.isInteger(artifact.originalOffsetMs) && artifact.originalOffsetMs >= 0, "originalOffsetMs must be a non-negative integer");
  assertHash(artifact.sourceContentSha256, "sourceContentSha256");
  assertHash(artifact.normalizedContentSha256, "normalizedContentSha256");
  assert(artifact.providerRun.exactModel.length > 0, "an exact model identifier is required");
  assert(!artifact.providerRun.exactModel.endsWith("-latest"), "moving model aliases are forbidden");
  assert(artifact.structuredPayloadArtifactId.length > 0, "lossless structured payload is required");
  const usage = artifact.providerRun;
  assert(usage.latencyMs >= 0 && usage.inputTokens >= 0 && usage.outputTokens >= 0, "provider usage cannot be negative");
  assert(usage.thoughtTokens >= 0 && usage.toolUseTokens >= 0 && usage.processingCalls >= 0, "provider usage cannot be negative");
}

export function assertFidelityMap(map: FidelityMap, evidence: readonly EvidenceClaim[]): void {
  assert(map.schemaVersion === "0.2.0", "unsupported Fidelity Map schema version");
  assert(map.revision >= 1 && Number.isInteger(map.revision), "revision must be a positive integer");
  assert(map.durationMs > 0 && map.durationMs <= 30_000, "Fidelity Map must cover 1-30 seconds");
  assertHash(map.sourceContentSha256, "sourceContentSha256");
  if (map.parentRevisionHash !== undefined) assertHash(map.parentRevisionHash, "parentRevisionHash");

  const evidenceById = new Map<string, EvidenceClaim>();
  for (const claim of evidence) {
    assert(!evidenceById.has(claim.id), `duplicate evidence id ${claim.id}`);
    assert(claim.confidence >= 0 && claim.confidence <= 1, `${claim.id} confidence must be between 0 and 1`);
    assertHash(claim.sourceContentSha256, `evidence.${claim.id}.sourceContentSha256`);
    assert(claim.sourceContentSha256 === map.sourceContentSha256, `${claim.id} belongs to a different source`);
    if (claim.range !== undefined) assertRange(claim.range, map.durationMs, `evidence.${claim.id}.range`);
    evidenceById.set(claim.id, claim);
  }

  const requireAccepted = (evidenceId: string, owner: string): void => {
    const claim = evidenceById.get(evidenceId);
    assert(claim !== undefined, `${owner} references missing evidence ${evidenceId}`);
    assert(claim.status === "accepted", `${owner} references ${claim.status} evidence ${evidenceId}`);
  };

  const assertUniqueIds = (items: readonly { id: string }[], field: string): void => {
    const ids = new Set<string>();
    for (const item of items) {
      assert(!ids.has(item.id), `duplicate ${field} id ${item.id}`);
      ids.add(item.id);
    }
  };
  assertUniqueIds(map.beats, "beat");
  assertUniqueIds(map.directives, "directive");
  assertUniqueIds(map.risks, "risk");
  assertUniqueIds(map.editSegments, "edit segment");

  const playbackClasses: PlaybackRateClass[] = ["real_time", "sped_up", "slowed_down", "variable", "unknown"];
  const transitionTypes: TransitionType[] = ["none", "hard_cut", "dissolve", "fade", "wipe", "match_cut", "other"];
  const assertPlayback = (playback: PlaybackRateAssessment, owner: string): void => {
    assert(playbackClasses.includes(playback.classification), `${owner} has an invalid playback-rate class`);
    assert(Number.isFinite(playback.confidence) && playback.confidence >= 0 && playback.confidence <= 1, `${owner} confidence must be between 0 and 1`);
    if (playback.estimatedMultiplier !== undefined) {
      assert(Number.isFinite(playback.estimatedMultiplier) && playback.estimatedMultiplier > 0, `${owner} estimated multiplier must be positive`);
      if (playback.classification === "real_time") {
        assert(playback.estimatedMultiplier >= 0.95 && playback.estimatedMultiplier <= 1.05, `${owner} real-time multiplier must be approximately 1x`);
      }
      if (playback.classification === "sped_up") {
        assert(playback.estimatedMultiplier > 1, `${owner} sped-up multiplier must exceed 1x`);
      }
      if (playback.classification === "slowed_down") {
        assert(playback.estimatedMultiplier < 1, `${owner} slowed-down multiplier must be below 1x`);
      }
      assert(playback.classification !== "variable" && playback.classification !== "unknown", `${owner} ${playback.classification} playback cannot use one scalar multiplier`);
    }
    assert(playback.cues.length > 0, `${owner} requires at least one observed cue`);
    assert(playback.evidenceIds.length > 0, `${owner} requires evidence`);
    playback.evidenceIds.forEach((id) => requireAccepted(id, owner));
  };

  assertPlayback(map.playback, "global playback assessment");
  assert(map.lighting.summary.length > 0, "lighting assessment requires a summary");
  assert(map.lighting.sources.length > 0, "lighting assessment requires at least one source or an explicit unknown source");
  assert(map.lighting.direction.length > 0, "lighting assessment requires direction or unknown");
  assert(map.lighting.colorTemperature.length > 0, "lighting assessment requires color temperature or unknown");
  assert(map.lighting.exposure.length > 0, "lighting assessment requires exposure or unknown");
  assert(map.lighting.contrast.length > 0, "lighting assessment requires contrast or unknown");
  assert(map.lighting.evidenceIds.length > 0, "lighting assessment requires evidence");
  map.lighting.evidenceIds.forEach((id) => requireAccepted(id, "lighting assessment"));
  for (const [index, event] of map.lighting.events.entries()) {
    assertRange(event.range, map.durationMs, `lighting event.${index}.range`);
    assert(event.description.length > 0, `lighting event ${index} requires a description`);
    assert(event.evidenceIds.length > 0, `lighting event ${index} requires evidence`);
    event.evidenceIds.forEach((id) => requireAccepted(id, `lighting event ${index}`));
  }
  assert(map.secondaryMotion.summary.length > 0, "secondary-motion assessment requires a summary");
  assert(map.secondaryMotion.evidenceIds.length > 0, "secondary-motion assessment requires audit evidence");
  map.secondaryMotion.evidenceIds.forEach((id) => requireAccepted(id, "secondary-motion assessment"));
  const secondaryMotionDrivers: SecondaryMotionDriver[] = ["airflow", "gravity", "inertia", "contact", "vibration", "fluid", "heat", "mechanical", "unknown"];
  const secondaryMotionIds = new Set<string>();
  for (const field of map.secondaryMotion.fields) {
    assert(!secondaryMotionIds.has(field.id), `duplicate secondary-motion field id ${field.id}`);
    secondaryMotionIds.add(field.id);
    assert(field.element.length > 0, `secondary-motion field ${field.id} requires an element`);
    assert(secondaryMotionDrivers.includes(field.driver), `secondary-motion field ${field.id} has an invalid driver`);
    assertRange(field.range, map.durationMs, `secondary-motion field.${field.id}.range`);
    assert(field.direction.length > 0, `secondary-motion field ${field.id} requires direction or unknown`);
    assert(field.amplitude.length > 0, `secondary-motion field ${field.id} requires amplitude or unknown`);
    assert(field.cadence.length > 0, `secondary-motion field ${field.id} requires cadence or unknown`);
    assert(field.coupling.length > 0, `secondary-motion field ${field.id} requires coupling or none_observed`);
    assert(Number.isFinite(field.confidence) && field.confidence >= 0 && field.confidence <= 1, `secondary-motion field ${field.id} confidence must be between 0 and 1`);
    assert(field.evidenceIds.length > 0, `secondary-motion field ${field.id} requires evidence`);
    field.evidenceIds.forEach((id) => requireAccepted(id, `secondary-motion field ${field.id}`));
  }
  assert(map.editSegments.length > 0, "Fidelity Map requires at least one edit segment");
  let expectedSegmentStart = 0;
  for (const [index, segment] of map.editSegments.entries()) {
    assertRange(segment.range, map.durationMs, `edit segment.${segment.id}.range`);
    assert(segment.range.startMs === expectedSegmentStart, `edit segment ${segment.id} leaves a gap or overlap`);
    assert(segment.range.endMs > segment.range.startMs, `edit segment ${segment.id} must have positive duration`);
    assert(segment.durationMs === segment.range.endMs - segment.range.startMs, `edit segment ${segment.id} duration does not match its range`);
    assert(segment.sourceShotId.length > 0, `edit segment ${segment.id} requires a source shot id`);
    assert(transitionTypes.includes(segment.transitionIn), `edit segment ${segment.id} has an invalid transition type`);
    assert(Number.isInteger(segment.transitionDurationMs) && segment.transitionDurationMs >= 0, `edit segment ${segment.id} transition duration must be a non-negative integer`);
    assert(segment.transitionDurationMs <= segment.durationMs, `edit segment ${segment.id} transition exceeds segment duration`);
    assert(index !== 0 || segment.transitionIn === "none", "first edit segment must use transitionIn none");
    assertPlayback(segment.playback, `edit segment ${segment.id} playback`);
    assert(segment.evidenceIds.length > 0, `edit segment ${segment.id} requires evidence`);
    segment.evidenceIds.forEach((id) => requireAccepted(id, `edit segment ${segment.id}`));
    expectedSegmentStart = segment.range.endMs;
  }
  assert(expectedSegmentStart === map.durationMs, "edit segments must cover the full source timeline");

  const captureModes: CreatorCaptureMode[] = ["single_take", "multi_take", "hybrid", "unknown"];
  const anchorStrategies: AnchorFrameStrategy[] = ["generate", "edit_subject_anchor", "edit_previous_setup", "use_authorized_reference"];
  const motionStrategies: MotionGenerationStrategy[] = ["image_to_video", "reference_to_video", "text_to_video", "deterministic_source"];
  const workflow = map.creatorWorkflow;
  assert(captureModes.includes(workflow.captureMode), "creator workflow has an invalid capture mode");
  assert(Number.isFinite(workflow.confidence) && workflow.confidence >= 0 && workflow.confidence <= 1, "creator workflow confidence must be between 0 and 1");
  assert(workflow.rationale.length > 0, "creator workflow requires evidence-backed rationale");
  assert(workflow.subjectAnchor.length > 0, "creator workflow requires a subject-anchor policy");
  assert(workflow.evidenceIds.length > 0, "creator workflow requires evidence");
  workflow.evidenceIds.forEach((id) => requireAccepted(id, "creator workflow"));
  assert(workflow.setups.length > 0, "creator workflow requires at least one capture setup");
  assert(workflow.generationUnits.length > 0, "creator workflow requires at least one generation unit");

  const editSegmentByShot = new Map(map.editSegments.map((segment) => [segment.sourceShotId, segment]));
  assert(editSegmentByShot.size === map.editSegments.length, "sourceShotId must be unique across edit segments");
  const setupIds = new Set<string>();
  const setupByShot = new Map<string, string>();
  for (const setup of workflow.setups) {
    assert(!setupIds.has(setup.id), `duplicate capture setup id ${setup.id}`);
    setupIds.add(setup.id);
    assert(setup.sourceShotIds.length > 0, `capture setup ${setup.id} requires source shots`);
    for (const shotId of setup.sourceShotIds) {
      assert(editSegmentByShot.has(shotId), `capture setup ${setup.id} references unknown source shot ${shotId}`);
      assert(!setupByShot.has(shotId), `source shot ${shotId} appears in multiple capture setups`);
      setupByShot.set(shotId, setup.id);
    }
    for (const field of [setup.cameraSignature, setup.environmentSignature, setup.subjectState, setup.wardrobeState, setup.lightingState]) {
      assert(field.length > 0, `capture setup ${setup.id} requires explicit state signatures`);
    }
    assert(setup.evidenceIds.length > 0, `capture setup ${setup.id} requires evidence`);
    setup.evidenceIds.forEach((id) => requireAccepted(id, `capture setup ${setup.id}`));
  }
  assert(setupByShot.size === editSegmentByShot.size, "every source shot must appear in exactly one capture setup");

  let expectedUnitStart = 0;
  const plannedShotIds = new Set<string>();
  const generationUnitIds = new Set<string>();
  for (const unit of workflow.generationUnits) {
    assert(!generationUnitIds.has(unit.id), `duplicate generation unit id ${unit.id}`);
    generationUnitIds.add(unit.id);
    assert(setupIds.has(unit.setupId), `generation unit ${unit.id} references unknown setup ${unit.setupId}`);
    assertRange(unit.range, map.durationMs, `generation unit.${unit.id}.range`);
    assert(unit.range.startMs === expectedUnitStart, `generation unit ${unit.id} leaves a gap or overlap`);
    assert(unit.range.endMs > unit.range.startMs, `generation unit ${unit.id} must have positive duration`);
    assert(unit.targetDurationMs === unit.range.endMs - unit.range.startMs, `generation unit ${unit.id} target duration does not match its range`);
    assert(Number.isInteger(unit.providerDurationMs) && unit.providerDurationMs >= unit.targetDurationMs, `generation unit ${unit.id} provider duration must cover its target`);
    assert(unit.sourceShotIds.length > 0, `generation unit ${unit.id} requires source shots`);
    for (const shotId of unit.sourceShotIds) {
      assert(editSegmentByShot.has(shotId), `generation unit ${unit.id} references unknown source shot ${shotId}`);
      assert(setupByShot.get(shotId) === unit.setupId, `generation unit ${unit.id} assigns source shot ${shotId} to the wrong setup`);
      assert(!plannedShotIds.has(shotId), `source shot ${shotId} appears in multiple generation units`);
      plannedShotIds.add(shotId);
    }
    assert(anchorStrategies.includes(unit.anchorFrameStrategy), `generation unit ${unit.id} has an invalid anchor-frame strategy`);
    if (unit.endpointFrame !== undefined) {
      assert(anchorStrategies.includes(unit.endpointFrame.anchorFrameStrategy), `generation unit ${unit.id} has an invalid endpoint-frame strategy`);
      assert(unit.endpointFrame.prompt.length > 0, `generation unit ${unit.id} endpoint frame requires a prompt`);
      assert(unit.endpointFrame.evidenceIds.length > 0, `generation unit ${unit.id} endpoint frame requires evidence`);
      unit.endpointFrame.evidenceIds.forEach((id) => requireAccepted(id, `generation unit ${unit.id} endpoint frame`));
    }
    assert(motionStrategies.includes(unit.motionStrategy), `generation unit ${unit.id} has an invalid motion strategy`);
    assert(transitionTypes.includes(unit.transitionIn), `generation unit ${unit.id} has an invalid transition type`);
    assert(Number.isInteger(unit.transitionDurationMs) && unit.transitionDurationMs >= 0, `generation unit ${unit.id} transition duration must be non-negative`);
    assert(unit.trimInstruction.length > 0, `generation unit ${unit.id} requires a deterministic trim instruction`);
    assert(unit.preserve.length > 0, `generation unit ${unit.id} requires preserve instructions`);
    assert(unit.evidenceIds.length > 0, `generation unit ${unit.id} requires evidence`);
    unit.evidenceIds.forEach((id) => requireAccepted(id, `generation unit ${unit.id}`));
    expectedUnitStart = unit.range.endMs;
  }
  assert(expectedUnitStart === map.durationMs, "generation units must cover the full source timeline");
  assert(plannedShotIds.size === editSegmentByShot.size, "every source shot must appear in exactly one generation unit");
  if (workflow.captureMode === "multi_take" && workflow.confidence >= 0.7) {
    assert(workflow.generationUnits.every((unit) => unit.sourceShotIds.length === 1), "high-confidence multi-take sources require one generation unit per source shot");
  }

  let previousBeatStart = -1;
  for (const beat of map.beats) {
    assertRange(beat.range, map.durationMs, `beat.${beat.id}.range`);
    assert(beat.range.startMs >= previousBeatStart, "beats must be ordered by normalized start time");
    previousBeatStart = beat.range.startMs;
    assert(beat.evidenceIds.length > 0, `beat ${beat.id} requires evidence`);
    beat.evidenceIds.forEach((id) => requireAccepted(id, `beat ${beat.id}`));
  }
  for (const directive of map.directives) {
    if (directive.kind !== "change") {
      assert(directive.evidenceIds.length > 0, `${directive.kind} directive ${directive.id} requires evidence`);
    }
    directive.evidenceIds.forEach((id) => requireAccepted(id, `directive ${directive.id}`));
  }
  for (const risk of map.risks) {
    assert(risk.evidenceIds.length > 0, `risk ${risk.id} requires evidence`);
    risk.evidenceIds.forEach((id) => requireAccepted(id, `risk ${risk.id}`));
  }
}

export function fidelityMapHash(map: FidelityMap): string {
  assert(map.parentRevisionHash !== "", "parentRevisionHash cannot be empty");
  return contentHash(map);
}

export function generationEligibility(map: FidelityMap, evidence: readonly EvidenceClaim[]): {
  eligible: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  try {
    assertFidelityMap(map, evidence);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "invalid Fidelity Map");
  }
  if (map.rightsStatus === "unverified") reasons.push("rights attestation is required");
  if (map.risks.some((risk) => risk.disposition === "unresolved")) reasons.push("unresolved rights or safety risk");
  return { eligible: reasons.length === 0, reasons };
}
