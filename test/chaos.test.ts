import assert from "node:assert/strict";
import test from "node:test";
import { LeaseLostError } from "../src/kernel/kernel.ts";
import { SimulatedCrash } from "../src/kernel/store.ts";
import { createHarness, type Harness } from "./helpers/kernel.ts";

function totalSpend(harness: Harness): number {
  return harness.image.spendEvents.length + harness.video.spendEvents.length;
}

function duplicates(harness: Harness): number {
  return harness.image.duplicateSpendCount() + harness.video.duplicateSpendCount();
}

test("chaos: duplicate outbox delivery and concurrent claims never create a second task or second spend", () => {
  const harness = createHarness();
  const { jobId } = harness.createJob();
  const first = harness.kernel.dispatchOutbox();
  assert.deepEqual(first, { delivered: 1, newTasks: 1 });
  const eventId = harness.store.list<{ id: string }>("outbox")[0]!.id;
  assert.equal(harness.kernel.deliverOutbox(eventId), false, "re-delivery is a no-op");
  assert.equal(harness.kernel.deliverOutbox(eventId), false);
  assert.equal(harness.kernel.listTasks().length, 1);
  assert.equal(harness.kernel.listTasks()[0]!.deliveries, 3);

  const workerA = harness.worker("worker-a");
  const workerB = harness.worker("worker-b");
  assert.equal(workerA.claim(), jobId);
  assert.equal(workerB.claim(), undefined, "a leased job cannot be claimed twice");
  assert.throws(() => workerB.step(jobId), LeaseLostError);
  workerA.run(jobId);
  assert.equal(harness.kernel.getJob(jobId).state, "succeeded");
  assert.equal(totalSpend(harness), 4);
  assert.equal(duplicates(harness), 0);
});

test("chaos: a worker that dies after submitting is replaced after lease expiry with zero duplicate spend", () => {
  const harness = createHarness({ leaseMs: 1_000 });
  harness.video.script.autoComplete = false;
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const workerA = harness.worker("worker-a");
  workerA.claim();
  let outcome = workerA.step(jobId);
  while (outcome.kind !== "submitted" || !outcome.callId.includes(":motion:")) outcome = workerA.step(jobId);
  const submitted = outcome.callId;
  const spendAtDeath = totalSpend(harness);

  // Worker A dies here. Nothing else can claim until the lease expires.
  const workerB = harness.worker("worker-b");
  assert.equal(workerB.claim(), undefined);
  harness.clock.advance(1_500);
  assert.equal(workerB.claim(), jobId);
  assert.ok(harness.kernel.listAudit().some((event) => event.action === "lease.takeover"));

  // The late worker cannot continue.
  assert.throws(() => workerA.step(jobId), LeaseLostError);

  // Worker B finds the existing submitted call, polls, and never resubmits.
  const first = workerB.step(jobId);
  assert.equal(first.kind, "waiting");
  assert.equal(totalSpend(harness), spendAtDeath);
  for (const submission of harness.video.submissions.values()) harness.video.complete(submission.providerRequestId);
  harness.video.script.autoComplete = true;
  workerB.run(jobId);
  assert.equal(harness.kernel.getJob(jobId).state, "succeeded");
  assert.equal(harness.kernel.listCalls(jobId).filter((call) => call.id === submitted).length, 1);
  assert.equal(harness.video.submissionsFor(jobId, "unit-1:motion").length, 1);
  assert.equal(duplicates(harness), 0);
  assert.equal(harness.kernel.ledgerSummary(jobId).captureEntries, 4);
  assert.equal(harness.kernel.ledgerSummary(jobId).outstandingUsdMicros, 0);
});

test("chaos: a worker that loses its lease mid-stage cannot reserve, complete, or publish", () => {
  const harness = createHarness({ leaseMs: 1_000 });
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const workerA = harness.worker("worker-a");
  workerA.claim();
  let outcome = workerA.step(jobId);
  while (outcome.kind !== "unit_complete") outcome = workerA.step(jobId);
  harness.clock.advance(1_500);
  const workerB = harness.worker("worker-b");
  assert.equal(workerB.claim(), jobId);
  assert.throws(() => harness.kernel.reserveProviderCall(jobId, "worker-a", "motion", "unit-1:motion", "video_motion"), LeaseLostError);
  assert.throws(() => harness.kernel.heartbeat(jobId, "worker-a"), LeaseLostError);
  assert.throws(() => harness.kernel.publishOutput(jobId, "worker-a"), /no finished master|LeaseLost/);
  const callsBefore = harness.kernel.listCalls(jobId).length;
  assert.throws(() => workerA.step(jobId), LeaseLostError);
  assert.equal(harness.kernel.listCalls(jobId).length, callsBefore, "the stale worker created no provider call");
  workerB.run(jobId);
  assert.equal(harness.kernel.getJob(jobId).state, "succeeded");
  assert.equal(duplicates(harness), 0);
  assert.equal(totalSpend(harness), 4);
});

test("chaos: a lost provider response pauses only that stage, reconciles by request id, and never resubmits", () => {
  const harness = createHarness();
  const { jobId, estimate } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  // Reserve the first anchor call so its idempotency key is known, then lose that response.
  let outcome = worker.step(jobId);
  while (outcome.kind !== "reserved") outcome = worker.step(jobId);
  const call = harness.kernel.listCalls(jobId)[0]!;
  harness.image.script.loseResponseFor.add(call.idempotencyKey);
  const log = worker.run(jobId);
  assert.equal(log.at(-1)!.kind, "reconciling");
  const paused = harness.kernel.getJob(jobId);
  assert.equal(paused.state, "needs_attention");
  assert.equal(paused.stages.anchor.status, "reconciling");
  assert.equal(paused.stages.motion.status, "pending");
  assert.equal(harness.kernel.listCalls(jobId)[0]!.state, "unknown");
  assert.equal(totalSpend(harness), 1, "the provider accepted the request once");
  assert.equal(worker.step(jobId).kind, "reconciling", "the paused worker does nothing while the stage reconciles");
  assert.equal(totalSpend(harness), 1);

  // A second dispatch cannot resume the job while it needs attention.
  harness.kernel.dispatchOutbox();
  assert.equal(harness.worker("worker-b").claim(), undefined);

  // Reconciliation recovers the receipt by idempotency key; no new submission is made.
  const reconciled = harness.kernel.reconcile(jobId);
  assert.deepEqual(reconciled, { resumed: true, resolved: [call.id], stillUnknown: [] });
  assert.equal(harness.kernel.listCalls(jobId)[0]!.state, "submitted");
  assert.equal(harness.kernel.getJob(jobId).state, "running");
  harness.kernel.dispatchOutbox();
  const workerB = harness.worker("worker-b");
  assert.equal(workerB.claim(), jobId);
  workerB.run(jobId);
  assert.equal(harness.kernel.getJob(jobId).state, "succeeded");
  assert.equal(harness.image.submissionsFor(jobId, "unit-1:anchor").length, 1);
  assert.equal(totalSpend(harness), 4);
  assert.equal(duplicates(harness), 0);
  assert.equal(harness.kernel.ledgerSummary(jobId).capturedUsdMicros, estimate.subtotalUsdMicros);
  assert.equal(harness.kernel.ledgerSummary(jobId).captureEntries, 4);
});

test("chaos: an unreachable provider keeps the call unknown, and a confirmed non-acceptance allows one bounded retry", () => {
  const harness = createHarness({ maxAttempts: 2 });
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  let outcome = worker.step(jobId);
  while (outcome.kind !== "reserved") outcome = worker.step(jobId);
  const call = harness.kernel.listCalls(jobId)[0]!;
  harness.image.script.loseResponseFor.add(call.idempotencyKey);
  worker.run(jobId);
  assert.equal(harness.kernel.getJob(jobId).state, "needs_attention");

  harness.image.script.lookupUnavailable = true;
  const stuck = harness.kernel.reconcile(jobId);
  assert.deepEqual(stuck, { resumed: false, resolved: [], stillUnknown: [call.id] });
  assert.equal(harness.kernel.listCalls(jobId)[0]!.state, "unknown");
  assert.equal(harness.kernel.listCalls(jobId)[0]!.reconciliation!.checks, 1);

  // Simulate a provider that lost the request entirely: delete its record, then let lookups answer.
  harness.image.script.lookupUnavailable = false;
  for (const [id, submission] of harness.image.submissions) if (submission.request.idempotencyKey === call.idempotencyKey) harness.image.submissions.delete(id);
  const resolved = harness.kernel.reconcile(jobId);
  assert.equal(resolved.resumed, true);
  assert.equal(harness.kernel.listCalls(jobId)[0]!.state, "failed");
  harness.kernel.dispatchOutbox();
  const workerB = harness.worker("worker-b");
  assert.equal(workerB.claim(), jobId);
  workerB.run(jobId);
  assert.equal(harness.kernel.getJob(jobId).state, "succeeded");
  const anchorCalls = harness.kernel.listCalls(jobId).filter((candidate) => candidate.unitId === "unit-1:anchor");
  assert.deepEqual(anchorCalls.map((candidate) => [candidate.attempt, candidate.state]), [[1, "failed"], [2, "succeeded"]]);
  assert.equal(harness.kernel.ledgerSummary(jobId).captureEntries, 4);
});

test("chaos: a crash between submitting and persisting the receipt is treated as unknown, never resubmitted", () => {
  const harness = createHarness({ leaseMs: 1_000 });
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const workerA = harness.worker("worker-a");
  workerA.claim();
  harness.image.script.afterAccept = () => {
    harness.image.script.afterAccept = undefined;
    throw new SimulatedCrash("worker process died after the provider accepted the request");
  };
  let crashed = false;
  try {
    workerA.run(jobId);
  } catch (error) {
    crashed = error instanceof SimulatedCrash;
  }
  assert.equal(crashed, true);
  const call = harness.kernel.listCalls(jobId)[0]!;
  assert.equal(call.state, "submitting");
  assert.equal(totalSpend(harness), 1);

  harness.clock.advance(1_500);
  const workerB = harness.worker("worker-b");
  assert.equal(workerB.claim(), jobId);
  const outcome = workerB.step(jobId);
  assert.equal(outcome.kind, "unknown");
  assert.equal(harness.kernel.getJob(jobId).state, "needs_attention");
  assert.equal(totalSpend(harness), 1, "the replacement worker did not resubmit");
  assert.equal(harness.kernel.reconcile(jobId).resumed, true);
  harness.kernel.dispatchOutbox();
  const workerC = harness.worker("worker-c");
  assert.equal(workerC.claim(), jobId);
  workerC.run(jobId);
  assert.equal(harness.kernel.getJob(jobId).state, "succeeded");
  assert.equal(totalSpend(harness), 4);
  assert.equal(duplicates(harness), 0);
});

test("chaos: a provider failure after acceptance is retried within bounds and then fails the job with a full release", () => {
  const harness = createHarness({ maxAttempts: 2 });
  const { jobId, estimate } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  let outcome = worker.step(jobId);
  while (outcome.kind !== "reserved") outcome = worker.step(jobId);
  harness.image.script.failAfterAcceptFor.add(harness.kernel.listCalls(jobId)[0]!.idempotencyKey);
  outcome = worker.step(jobId);
  outcome = worker.step(jobId);
  assert.equal(outcome.kind, "unit_failed");
  // The second attempt also fails.
  outcome = worker.step(jobId);
  assert.equal(outcome.kind, "reserved");
  harness.image.script.failAfterAcceptFor.add(harness.kernel.listCalls(jobId)[1]!.idempotencyKey);
  const log = worker.run(jobId);
  assert.equal(log.at(-1)!.kind, "failed");
  const job = harness.kernel.getJob(jobId);
  assert.equal(job.state, "failed");
  assert.equal(harness.kernel.listCalls(jobId).length, 2, "retries are bounded by maxAttempts");
  const ledger = harness.kernel.ledgerSummary(jobId);
  assert.equal(ledger.capturedUsdMicros, 0);
  assert.equal(ledger.releasedUsdMicros, estimate.maxCostUsdMicros);
  assert.equal(ledger.outstandingUsdMicros, 0);
});
