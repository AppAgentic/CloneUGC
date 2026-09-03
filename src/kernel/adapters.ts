import type { CompiledPlan, FinishingStep } from "../compiler.ts";
import type { EvidenceArtifact, EvidenceClaim, FidelityMap } from "../contracts.ts";
import type { ProviderCapability, ProviderClass, Resolution } from "../estimate.ts";
import type { QAReport } from "../qa.ts";
import type { ProviderReceipt } from "./types.ts";

/**
 * Internal adapter boundary. Adapters know provider names; nothing above them does.
 */

export interface ProviderSubmitRequest {
  idempotencyKey: string;
  providerClass: ProviderClass;
  jobId: string;
  unitId: string;
  prompt: string;
  strategy: string;
  targetDurationMs: number;
  billedDurationMs: number;
  resolution: Resolution;
  inputAssetHashes: string[];
}

export type ProviderStatus =
  | { state: "pending" }
  | { state: "succeeded"; actualCostUsdMicros: number; deliveredDurationMs: number }
  | { state: "failed"; reason: string; actualCostUsdMicros: number };

/** The request may have been accepted but the response never arrived. */
export class ProviderResponseLostError extends Error {
  override name = "ProviderResponseLostError";
}

/** The provider rejected the request before accepting it; nothing was charged. */
export class ProviderRejectedError extends Error {
  override name = "ProviderRejectedError";
}

export interface ProviderAdapter {
  readonly capability: ProviderCapability;
  submit(request: ProviderSubmitRequest): ProviderReceipt;
  status(receipt: ProviderReceipt): ProviderStatus;
  /** Provider-side lookup by idempotency key, used only for reconciliation of unknown outcomes. */
  lookup(idempotencyKey: string): ProviderReceipt | undefined;
  fetchResult(receipt: ProviderReceipt): Uint8Array;
  cancel(receipt: ProviderReceipt): { supported: boolean; accepted: boolean };
}

export interface AssetPutResult {
  hash: string;
  key: string;
  bytes: number;
}

export interface AssetStore {
  put(content: Uint8Array | string, options: { workspaceId: string; prefix: string; provenance: string }): AssetPutResult;
  get(hash: string): Uint8Array | undefined;
  has(hash: string): boolean;
  keysUnder(prefix: string): string[];
  /** Publishes every entry under the final prefix or none of them. */
  publishAtomically(input: { workspaceId: string; finalPrefix: string; entries: Array<{ name: string; hash: string }> }): void;
  deletePrefix(prefix: string): number;
}

export interface RenderInput {
  plan: CompiledPlan;
  unitArtifacts: Readonly<Record<string, string>>;
  steps: readonly FinishingStep[];
}

export interface RenderResult {
  master: Uint8Array;
  manifest: {
    planHash: string;
    unitArtifacts: Record<string, string>;
    steps: Array<{ stepId: string; stepHash: string; inputHashes: string[] }>;
  };
}

export interface RenderAdapter {
  finish(input: RenderInput): RenderResult;
}

export interface QAScorer {
  score(input: { jobId: string; plan: CompiledPlan; masterAssetHash: string; sourceContentSha256: string }): Omit<QAReport, "reportHash">;
}

export interface AnalyzerAdapter {
  analyze(sourceContentSha256: string): { artifacts: EvidenceArtifact[]; evidence: EvidenceClaim[]; map: FidelityMap } | undefined;
}
