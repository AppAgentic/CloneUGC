import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../src/canonical.ts";
import { assertEvidenceArtifact, assertFidelityMap, generationEligibility, type EvidenceArtifact, type EvidenceClaim, type FidelityMap } from "../src/contracts.ts";

const hash = "a".repeat(64);
const range = {
  startMs: 0,
  endMs: 1_000,
  originalStartMs: 2_000,
  originalEndMs: 3_000,
  normalizedStartFrame: 0,
  normalizedEndFrame: 30,
};
const fullRange = {
  startMs: 0,
  endMs: 10_000,
  originalStartMs: 2_000,
  originalEndMs: 12_000,
  normalizedStartFrame: 0,
  normalizedEndFrame: 300,
};
const evidence: EvidenceClaim[] = [
  {
    id: "e1",
    artifactId: "artifact-1",
    sourceContentSha256: hash,
    kind: "shot",
    statement: "A static medium shot begins the clip.",
    status: "accepted",
    confidence: 0.95,
    directObservation: true,
    range,
  },
  {
    id: "e-light",
    artifactId: "artifact-1",
    sourceContentSha256: hash,
    kind: "lighting",
    statement: "A warm overhead practical creates a soft top-front key.",
    status: "accepted",
    confidence: 0.9,
    directObservation: true,
    range: fullRange,
  },
];
const map: FidelityMap = {
  schemaVersion: "0.2.0",
  id: "map-1",
  revision: 1,
  sourceAssetId: "source-1",
  sourceContentSha256: hash,
  durationMs: 10_000,
  rightsStatus: "owned",
  requestedChange: "Change the shirt to blue.",
  playback: {
    classification: "real_time",
    estimatedMultiplier: 1,
    confidence: 0.9,
    cues: ["Natural gravity and repetition cadence"],
    evidenceIds: ["e1"],
  },
  lighting: {
    summary: "Warm, softly diffused practical lighting remains stable.",
    sources: ["Overhead practical"],
    direction: "Top-front",
    colorTemperature: "Warm",
    exposure: "Slightly underexposed",
    contrast: "Medium-low",
    captureArtifacts: ["Shadow noise"],
    events: [],
    evidenceIds: ["e-light"],
  },
  editSegments: [{
    id: "s1",
    sourceShotId: "shot-1",
    range: fullRange,
    durationMs: 10_000,
    transitionIn: "none",
    transitionDurationMs: 0,
    playback: {
      classification: "real_time",
      estimatedMultiplier: 1,
      confidence: 0.9,
      cues: ["Natural motion cadence"],
      evidenceIds: ["e1"],
    },
    evidenceIds: ["e1"],
  }],
  beats: [{ id: "b1", role: "hook", range, description: "Opening action", evidenceIds: ["e1"] }],
  directives: [{ id: "d1", kind: "preserve", description: "Preserve framing", evidenceIds: ["e1"] }],
  risks: [],
};

test("canonical hashes do not depend on object key order", () => {
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
});

test("accepted evidence produces a generation-eligible map", () => {
  assert.doesNotThrow(() => assertFidelityMap(map, evidence));
  assert.deepEqual(generationEligibility(map, evidence), { eligible: true, reasons: [] });
});

test("disputed evidence cannot reach the compiler", () => {
  const disputed = [{ ...evidence[0]!, status: "disputed" as const }];
  assert.throws(() => assertFidelityMap(map, disputed), /references disputed evidence/);
});

test("unverified rights block generation without invalidating analysis", () => {
  const result = generationEligibility({ ...map, rightsStatus: "unverified" }, evidence);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["rights attestation is required"]);
});

test("evidence from another source cannot enter a Fidelity Map", () => {
  const wrongSource = [{ ...evidence[0]!, sourceContentSha256: "b".repeat(64) }];
  assert.throws(() => assertFidelityMap(map, wrongSource), /different source/);
});

test("evidence artifacts require bounded media, exact models, and lossless payloads", () => {
  const artifact: EvidenceArtifact = {
    schemaVersion: "0.2.0",
    id: "artifact-1",
    workspaceId: "workspace-1",
    sourceAssetId: "source-1",
    sourceContentSha256: hash,
    normalizedContentSha256: "c".repeat(64),
    durationMs: 10_000,
    normalizedFps: 30,
    originalOffsetMs: 0,
    providerRun: {
      provider: "google-gemini",
      exactModel: "gemini-3.8-flash",
      mode: "agentic",
      runId: "run-1",
      promptVersion: "analysis-v5",
      latencyMs: 1_000,
      inputTokens: 100,
      outputTokens: 100,
      thoughtTokens: 100,
      toolUseTokens: 100,
      processingCalls: 1,
    },
    structuredPayloadArtifactId: "payload-1",
    summaryTruncated: false,
  };
  assert.doesNotThrow(() => assertEvidenceArtifact(artifact));
  assert.throws(() => assertEvidenceArtifact({
    ...artifact,
    providerRun: { ...artifact.providerRun, exactModel: "gemini-flash-latest" },
  }), /moving model aliases/);
  assert.throws(() => assertEvidenceArtifact({ ...artifact, durationMs: 30_001 }), /1-30 seconds/);
});

test("edit segments must cover the full timeline with explicit playback evidence", () => {
  assert.throws(() => assertFidelityMap({
    ...map,
    editSegments: [{ ...map.editSegments[0]!, durationMs: 9_999 }],
  }, evidence), /duration does not match/);
  assert.throws(() => assertFidelityMap({
    ...map,
    playback: { ...map.playback, cues: [] },
  }, evidence), /at least one observed cue/);
  assert.throws(() => assertFidelityMap({
    ...map,
    playback: { ...map.playback, classification: "sped_up", estimatedMultiplier: 0.5 },
  }, evidence), /sped-up multiplier must exceed 1x/);
  assert.throws(() => assertFidelityMap({
    ...map,
    playback: { ...map.playback, classification: "variable", estimatedMultiplier: 1.5 },
  }, evidence), /variable playback cannot use one scalar multiplier/);
});

test("lighting is required as evidence-backed reconstruction state", () => {
  assert.throws(() => assertFidelityMap({
    ...map,
    lighting: { ...map.lighting, sources: [] },
  }, evidence), /at least one source/);
  assert.throws(() => assertFidelityMap({
    ...map,
    lighting: { ...map.lighting, evidenceIds: [] },
  }, evidence), /lighting assessment requires evidence/);
});
