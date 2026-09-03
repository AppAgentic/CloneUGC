import type { ProviderClass } from "../estimate.ts";
import type { QAReport } from "../qa.ts";

/**
 * Durable job-plane records. Everything here is persisted through the transactional store;
 * workers hold no authoritative state of their own.
 */

export type JobState = "queued" | "running" | "qa" | "succeeded" | "failed" | "cancelled" | "needs_attention";
export type StageName = "anchor" | "motion" | "finishing" | "qa" | "publish";
export const STAGES: readonly StageName[] = ["anchor", "motion", "finishing", "qa", "publish"];
export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "reconciling";

export interface StageProgress {
  status: StageStatus;
  attempts: number;
  startedAtMs?: number;
  finishedAtMs?: number;
}

export interface GenerationJob {
  schemaVersion: "0.1.0";
  id: string;
  workspaceId: string;
  actorId: string;
  idempotencyKey: string;
  inputs: {
    planHash: string;
    revisionHash: string;
    estimateHash: string;
    sourceContentSha256: string;
    rightsRecordId: string;
    rightsTokenId: string;
    spendTokenId: string;
    reusedUnitArtifacts: Record<string, string>;
  };
  state: JobState;
  stages: Record<StageName, StageProgress>;
  reservationUsdMicros: number;
  capturedUsdMicros: number;
  releasedUsdMicros: number;
  /** Accepted unit artifacts by unit id, content addressed. */
  unitArtifacts: Record<string, string>;
  finishing?: { masterAssetHash: string; manifestAssetHash: string; tempPrefix: string };
  qaReportId?: string;
  outputId?: string;
  cancelRequestedAtMs?: number;
  terminalReason?: string;
  attentionReason?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface TaskLease {
  jobId: string;
  owner: string;
  version: number;
  acquiredAtMs: number;
  heartbeatAtMs: number;
  expiresAtMs: number;
}

export type ProviderCallState = "reserved" | "submitting" | "submitted" | "succeeded" | "failed" | "unknown";

export interface ProviderReceipt {
  providerRequestId: string;
  acceptedAtMs: number;
}

export interface ProviderCall {
  schemaVersion: "0.1.0";
  id: string;
  jobId: string;
  stage: StageName;
  unitId: string;
  attempt: number;
  providerClass: ProviderClass;
  idempotencyKey: string;
  state: ProviderCallState;
  receipt?: ProviderReceipt;
  actualCostUsdMicros?: number;
  resultAssetHash?: string;
  failureReason?: string;
  reconciliation?: { checks: number; lastCheckedAtMs: number; note: string };
  cancel?: { requestedAtMs: number; supported: boolean; accepted: boolean; confirmedAtMs?: number };
  createdAtMs: number;
  updatedAtMs: number;
}

export type LedgerKind = "reserve" | "capture" | "release" | "adjustment";

export interface LedgerEntry {
  /** Exactly-once key such as reserve:<job>, capture:<call>, release:<job>. */
  id: string;
  jobId: string;
  kind: LedgerKind;
  amountUsdMicros: number;
  providerCallId?: string;
  createdAtMs: number;
}

export interface OutboxEvent {
  id: string;
  kind: "job.dispatch" | "job.resume";
  jobId: string;
  createdAtMs: number;
  deliveredAtMs?: number;
  deliveries: number;
}

export interface QueueTask {
  id: string;
  jobId: string;
  enqueuedAtMs: number;
  deliveries: number;
}

export interface IdempotencyRecord {
  jobId: string;
  /** Hash of the immutable create-job request, excluding the idempotency key itself. */
  requestHash: string;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  authority?: string;
  action: string;
  objectHashes: Record<string, string>;
  atMs: number;
  result: "ok" | "rejected";
  detail?: string;
}

export interface AssetRecord {
  hash: string;
  workspaceId: string;
  key: string;
  bytes: number;
  provenance: string;
  lifecycle: "temporary" | "published" | "deleted";
  createdAtMs: number;
}

export interface OutputArtifact {
  schemaVersion: "0.1.0";
  id: string;
  jobId: string;
  workspaceId: string;
  planHash: string;
  revisionHash: string;
  sourceContentSha256: string;
  masterAssetHash: string;
  manifestAssetHash: string;
  unitArtifacts: Record<string, string>;
  qaReportHash: string;
  exportLineage: {
    estimateHash: string;
    rightsTokenId: string;
    spendTokenId: string;
    capturedUsdMicros: number;
  };
  publishedAtMs: number;
  outputHash: string;
}

export interface StoredQAReport {
  jobId: string;
  report: QAReport;
}

export const COLLECTIONS = {
  jobs: "jobs",
  leases: "leases",
  providerCalls: "providerCalls",
  ledger: "ledger",
  outbox: "outbox",
  tasks: "tasks",
  audit: "audit",
  approvals: "approvals",
  rights: "rights",
  outputs: "outputs",
  qaReports: "qaReports",
  idempotency: "idempotency",
} as const;
