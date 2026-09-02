import { contentHash } from "./canonical.ts";

export type Milliseconds = number;
export type EvidenceStatus = "accepted" | "disputed" | "rejected";
export type AnalysisMode = "deterministic" | "human" | "static" | "agentic";
export type RightsStatus = "unverified" | "owned" | "licensed" | "other_valid_right";
export type PlaybackRateClass = "real_time" | "sped_up" | "slowed_down" | "variable" | "unknown";
export type TransitionType = "none" | "hard_cut" | "dissolve" | "fade" | "wipe" | "match_cut" | "other";

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
  kind: "shot" | "edit" | "playback_rate" | "action" | "continuity" | "text" | "audio" | "risk" | "other";
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
  editSegments: EditSegment[];
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
