import { createHash } from "node:crypto";
import type { ProviderCapability } from "../estimate.ts";
import { ProviderRejectedError, ProviderResponseLostError, type ProviderAdapter, type ProviderStatus, type ProviderSubmitRequest } from "../kernel/adapters.ts";
import type { Clock } from "../kernel/store.ts";
import type { ProviderReceipt } from "../kernel/types.ts";

/**
 * A scriptable fake paid provider.
 *
 * Every accepted submission is a spend event, even when the idempotency key repeats, because real
 * providers bill per request. The kernel is responsible for never submitting twice; this fake
 * simply counts, so chaos tests can assert zero duplicate spend.
 */

export interface FakeSubmission {
  providerRequestId: string;
  request: ProviderSubmitRequest;
  acceptedAtMs: number;
  state: "pending" | "succeeded" | "failed" | "cancelled";
  actualCostUsdMicros: number;
  result: Uint8Array;
}

export interface FakeProviderScript {
  /** Idempotency keys whose submission is accepted but whose response is lost. */
  loseResponseFor: Set<string>;
  /** Idempotency keys the provider rejects before accepting. */
  rejectFor: Set<string>;
  /** Idempotency keys whose generation fails after acceptance. */
  failAfterAcceptFor: Set<string>;
  /** Hook invoked after a submission was accepted and before the receipt returns; throwing simulates a crash. */
  afterAccept?: ((request: ProviderSubmitRequest) => void) | undefined;
  /** When true, status reports succeeded as soon as it is polled. */
  autoComplete: boolean;
  /** When set, lookups throw to emulate a provider that cannot be reached. */
  lookupUnavailable: boolean;
}

export class FakeProvider implements ProviderAdapter {
  readonly submissions = new Map<string, FakeSubmission>();
  readonly spendEvents: Array<{ idempotencyKey: string; jobId: string; unitId: string; costUsdMicros: number }> = [];
  readonly script: FakeProviderScript = { loseResponseFor: new Set(), rejectFor: new Set(), failAfterAcceptFor: new Set(), autoComplete: true, lookupUnavailable: false };
  private counter = 0;

  readonly capability: ProviderCapability;
  private readonly clock: Clock;

  constructor(capability: ProviderCapability, clock: Clock) {
    this.capability = capability;
    this.clock = clock;
  }

  private priceFor(request: ProviderSubmitRequest): number {
    const perSecond = this.capability.pricing.perSecondUsdMicros[request.resolution] ?? 0;
    return this.capability.pricing.fixedUsdMicros + Math.ceil((request.billedDurationMs * perSecond) / 1000);
  }

  submit(request: ProviderSubmitRequest): ProviderReceipt {
    if (this.script.rejectFor.has(request.idempotencyKey)) throw new ProviderRejectedError(`provider rejected ${request.idempotencyKey}`);
    this.counter += 1;
    const providerRequestId = `${this.capability.adapterId}-req-${String(this.counter).padStart(4, "0")}`;
    const cost = this.priceFor(request);
    const result = Buffer.from(createHash("sha256").update(`${providerRequestId}:${request.prompt}:${request.inputAssetHashes.join(",")}`).digest("hex"));
    const submission: FakeSubmission = { providerRequestId, request, acceptedAtMs: this.clock.nowMs(), state: "pending", actualCostUsdMicros: cost, result };
    this.submissions.set(providerRequestId, submission);
    this.spendEvents.push({ idempotencyKey: request.idempotencyKey, jobId: request.jobId, unitId: request.unitId, costUsdMicros: cost });
    this.script.afterAccept?.(request);
    if (this.script.loseResponseFor.has(request.idempotencyKey)) {
      this.script.loseResponseFor.delete(request.idempotencyKey);
      throw new ProviderResponseLostError(`response lost for ${request.idempotencyKey}`);
    }
    return { providerRequestId, acceptedAtMs: submission.acceptedAtMs };
  }

  private find(receipt: ProviderReceipt): FakeSubmission {
    const submission = this.submissions.get(receipt.providerRequestId);
    if (submission === undefined) throw new Error(`unknown provider request ${receipt.providerRequestId}`);
    return submission;
  }

  status(receipt: ProviderReceipt): ProviderStatus {
    const submission = this.find(receipt);
    if (submission.state === "pending" && this.script.autoComplete) {
      submission.state = this.script.failAfterAcceptFor.has(submission.request.idempotencyKey) ? "failed" : "succeeded";
    }
    switch (submission.state) {
      case "pending":
        return { state: "pending" };
      case "succeeded":
        return { state: "succeeded", actualCostUsdMicros: submission.actualCostUsdMicros, deliveredDurationMs: submission.request.billedDurationMs };
      case "failed":
        return { state: "failed", reason: "generation failed", actualCostUsdMicros: 0 };
      case "cancelled":
        return { state: "failed", reason: "cancelled at provider", actualCostUsdMicros: 0 };
    }
  }

  complete(providerRequestId: string): void {
    this.submissions.get(providerRequestId)!.state = "succeeded";
  }

  lookup(idempotencyKey: string): ProviderReceipt | undefined {
    if (this.script.lookupUnavailable) throw new Error("provider lookup unavailable");
    for (const submission of this.submissions.values()) {
      if (submission.request.idempotencyKey === idempotencyKey) return { providerRequestId: submission.providerRequestId, acceptedAtMs: submission.acceptedAtMs };
    }
    return undefined;
  }

  fetchResult(receipt: ProviderReceipt): Uint8Array {
    const submission = this.find(receipt);
    if (submission.state !== "succeeded") throw new Error(`result for ${receipt.providerRequestId} is not ready`);
    return submission.result;
  }

  cancel(receipt: ProviderReceipt): { supported: boolean; accepted: boolean } {
    if (!this.capability.supportsCancel) return { supported: false, accepted: false };
    const submission = this.find(receipt);
    if (submission.state !== "pending") return { supported: true, accepted: false };
    submission.state = "cancelled";
    return { supported: true, accepted: true };
  }

  submissionsFor(jobId: string, unitId: string): FakeSubmission[] {
    return [...this.submissions.values()].filter((submission) => submission.request.jobId === jobId && submission.request.unitId === unitId);
  }

  duplicateSpendCount(): number {
    const seen = new Map<string, number>();
    for (const event of this.spendEvents) {
      const key = `${event.jobId}:${event.unitId}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.values()].filter((count) => count > 1).length;
  }
}
