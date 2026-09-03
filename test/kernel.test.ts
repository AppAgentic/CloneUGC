import assert from "node:assert/strict";
import test from "node:test";
import { planRepairReuse } from "../src/compiler.ts";
import { deriveRevision, type TypedDirective } from "../src/directives.ts";
import { KernelError, LeaseLostError } from "../src/kernel/kernel.ts";
import { proposeRepairRevision } from "../src/qa.ts";
import { createHarness, runToSettled } from "./helpers/kernel.ts";
import { baseDirectives, sampleEstimate, samplePlan, sampleRevision } from "./helpers/sample.ts";

test("job creation is one transaction: job, reservation, consumed approvals, outbox, audit", () => {
  const harness = createHarness();
  const { jobId, estimate, input } = harness.createJob();
  const job = harness.kernel.getJob(jobId);
  assert.equal(job.state, "queued");
  assert.equal(job.reservationUsdMicros, estimate.maxCostUsdMicros);
  assert.equal(harness.kernel.getApproval(input.spendTokenId)!.consumedByJobId, jobId);
  assert.equal(harness.kernel.getApproval(input.rightsTokenId)!.consumedByJobId, jobId);
  assert.equal(harness.store.count("outbox"), 1);
  assert.deepEqual(harness.kernel.listLedger(jobId).map((entry) => [entry.kind, entry.amountUsdMicros]), [["reserve", estimate.maxCostUsdMicros]]);
  assert.ok(harness.kernel.listAudit().some((event) => event.action === "job.create" && event.result === "ok"));
});

test("job creation is idempotent per workspace key and consumed approvals cannot be reused", () => {
  const harness = createHarness();
  const first = harness.createJob({ idempotencyKey: "same" });
  const again = harness.kernel.createJob(first.input);
  assert.equal(again.created, false);
  assert.equal(again.job.id, first.jobId);
  assert.equal(harness.store.count("jobs"), 1);
  assert.throws(() => harness.kernel.createJob({ ...first.input, idempotencyKey: "different" }), /already consumed/);
  assert.throws(() => harness.kernel.createJob({ ...first.input, idempotencyKey: "forged", rightsTokenId: "not-minted", spendTokenId: "not-minted-either" }), /not server-minted/);
  const rejected = harness.kernel.listAudit().filter((event) => event.action === "job.create" && event.result === "rejected");
  assert.equal(rejected.length, 2);
});

test("a rejected job leaves no reservation, no outbox event, and no consumed token", () => {
  const harness = createHarness();
  const plan = samplePlan();
  const estimate = sampleEstimate(plan, harness.clock.nowMs());
  assert.throws(() => harness.kernel.createJob({ workspaceId: "workspace-1", actorId: "user-1", idempotencyKey: "x", revision: sampleRevision(), plan, estimate, rightsRecordId: "rights-1", rightsTokenId: "", spendTokenId: "" }), KernelError);
  assert.equal(harness.store.count("jobs"), 0);
  assert.equal(harness.store.count("ledger"), 0);
  assert.equal(harness.store.count("outbox"), 0);
});

test("a job runs anchors, motions, finishing, QA, and atomic publish with exactly one capture per paid unit", () => {
  const harness = createHarness();
  const { jobId, estimate } = harness.createJob();
  const log = runToSettled(harness, jobId);
  assert.equal(log.at(-1)!.kind, "published");
  const job = harness.kernel.getJob(jobId);
  assert.equal(job.state, "succeeded");
  assert.deepEqual(Object.keys(job.unitArtifacts).sort(), ["unit-1:anchor", "unit-1:motion", "unit-2:anchor", "unit-2:motion"]);
  const ledger = harness.kernel.ledgerSummary(jobId);
  assert.equal(ledger.captureEntries, 4);
  assert.equal(ledger.capturedUsdMicros, estimate.subtotalUsdMicros);
  assert.equal(ledger.releasedUsdMicros, estimate.maxCostUsdMicros - estimate.subtotalUsdMicros);
  assert.equal(ledger.outstandingUsdMicros, 0);
  assert.equal(harness.image.spendEvents.length + harness.video.spendEvents.length, 4);
  assert.equal(harness.image.duplicateSpendCount() + harness.video.duplicateSpendCount(), 0);
  const output = harness.kernel.getOutput(job.outputId!)!;
  assert.equal(output.masterAssetHash, job.finishing!.masterAssetHash);
  assert.deepEqual(harness.assets.keysUnder(`workspaces/workspace-1/outputs/${jobId}`).length, 2);
  assert.equal(output.exportLineage.capturedUsdMicros, estimate.subtotalUsdMicros);
  assert.equal(harness.kernel.getLease(jobId), undefined);
  assert.equal(harness.kernel.listTasks().length, 0);
  const calls = harness.kernel.listCalls(jobId);
  assert.ok(calls.every((call) => call.state === "succeeded" && call.receipt !== undefined));
  assert.ok(harness.kernel.getQAReport(job.qaReportId!) !== undefined);
});

test("duplicate completion delivery captures cost only once", () => {
  const harness = createHarness();
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  let outcome = worker.step(jobId);
  while (outcome.kind !== "unit_complete") outcome = worker.step(jobId);
  const call = harness.kernel.listCalls(jobId)[0]!;
  const repeat = harness.kernel.completeProviderCall(call.id, "worker-a", { actualCostUsdMicros: call.actualCostUsdMicros!, resultAssetHash: call.resultAssetHash! });
  assert.equal(repeat.captured, false);
  assert.equal(harness.kernel.ledgerSummary(jobId).captureEntries, 1);
  assert.equal(harness.kernel.getJob(jobId).capturedUsdMicros, call.actualCostUsdMicros);
});

test("cancelling a queued job releases the whole reservation without any provider call", () => {
  const harness = createHarness();
  const { jobId, estimate } = harness.createJob();
  const result = harness.kernel.cancelJob(jobId, "user-1");
  assert.equal(result.state, "cancelled");
  const ledger = harness.kernel.ledgerSummary(jobId);
  assert.equal(ledger.releasedUsdMicros, estimate.maxCostUsdMicros);
  assert.equal(ledger.outstandingUsdMicros, 0);
  assert.equal(harness.image.spendEvents.length + harness.video.spendEvents.length, 0);
  harness.kernel.dispatchOutbox();
  assert.equal(harness.worker("worker-a").claim(), undefined, "terminal jobs are never claimed");
});

test("cancelling a running job stops unsubmitted work and never pretends an in-flight call was cancelled", () => {
  const harness = createHarness();
  harness.video.script.autoComplete = false;
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  // Run until the first motion call has been submitted and is pending at the provider.
  let outcome = worker.step(jobId);
  while (!(outcome.kind === "waiting")) outcome = worker.step(jobId);
  const inFlight = harness.kernel.listCalls(jobId).find((call) => call.state === "submitted")!;
  assert.equal(inFlight.unitId, "unit-1:motion");
  const request = harness.kernel.cancelJob(jobId, "user-1");
  assert.deepEqual(request.inFlight, [inFlight.id]);
  const afterRequest = harness.kernel.listCalls(jobId).find((call) => call.id === inFlight.id)!;
  assert.equal(afterRequest.state, "submitted", "cancellation is only requested, not asserted");
  assert.deepEqual({ supported: afterRequest.cancel!.supported, accepted: afterRequest.cancel!.accepted }, { supported: true, accepted: true });
  assert.throws(() => harness.kernel.reserveProviderCall(jobId, "worker-a", "motion", "unit-2:motion", "video_motion"), /pending cancellation/);
  const log = worker.run(jobId);
  assert.equal(log.at(-1)!.kind, "cancelled");
  const job = harness.kernel.getJob(jobId);
  assert.equal(job.state, "cancelled");
  const settled = harness.kernel.listCalls(jobId).find((call) => call.id === inFlight.id)!;
  assert.equal(settled.state, "failed");
  assert.match(settled.failureReason!, /cancelled at provider/);
  assert.equal(harness.video.spendEvents.length, 1, "unit-2 motion was never submitted");
  assert.equal(harness.kernel.ledgerSummary(jobId).outstandingUsdMicros, 0);
});

test("publication is atomic: a failed asset publish leaves no output record and a retry succeeds without duplication", () => {
  const harness = createHarness();
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  let outcome = worker.step(jobId);
  while (!(outcome.kind === "stage_complete" && outcome.stage === "qa")) outcome = worker.step(jobId);
  harness.assets.failNextPublish = true;
  assert.throws(() => worker.step(jobId), /simulated publish failure/);
  const job = harness.kernel.getJob(jobId);
  assert.equal(job.state, "qa");
  assert.equal(job.outputId, undefined);
  assert.equal(harness.assets.keysUnder(`workspaces/workspace-1/outputs/${jobId}`).length, 0);
  assert.equal(harness.store.count("outputs"), 0);
  const retry = worker.step(jobId);
  assert.equal(retry.kind, "published");
  assert.equal(harness.store.count("outputs"), 1);
  assert.equal(harness.kernel.getJob(jobId).state, "succeeded");
});

test("a store crash between asset publish and record commit is recovered by republishing the same hashes", () => {
  const harness = createHarness();
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  let outcome = worker.step(jobId);
  while (!(outcome.kind === "stage_complete" && outcome.stage === "qa")) outcome = worker.step(jobId);
  harness.store.chaos.beforeCommit = (keys) => {
    if (keys.some((key) => key.startsWith("outputs/"))) {
      harness.store.chaos = {};
      throw new Error("simulated crash before the output record committed");
    }
  };
  assert.throws(() => worker.step(jobId), /simulated crash/);
  assert.equal(harness.store.count("outputs"), 0);
  assert.equal(harness.kernel.getJob(jobId).state, "qa");
  const retry = worker.step(jobId);
  assert.equal(retry.kind, "published");
  assert.equal(harness.store.count("outputs"), 1);
  assert.equal(harness.kernel.ledgerSummary(jobId).releasedUsdMicros > 0, true);
});

test("a worker that lost its lease cannot publish", () => {
  const harness = createHarness({ leaseMs: 1_000 });
  const { jobId } = harness.createJob();
  harness.kernel.dispatchOutbox();
  const worker = harness.worker("worker-a");
  worker.claim();
  let outcome = worker.step(jobId);
  while (!(outcome.kind === "stage_complete" && outcome.stage === "qa")) outcome = worker.step(jobId);
  harness.clock.advance(2_000);
  assert.throws(() => worker.step(jobId), LeaseLostError);
  assert.equal(harness.store.count("outputs"), 0);
});

test("a repair reuses accepted unit artifacts byte-for-byte and only regenerates invalidated units", () => {
  const harness = createHarness();
  const parent = sampleRevision();
  const first = harness.createJob({ revision: parent });
  runToSettled(harness, first.jobId, "worker-a");
  const firstJob = harness.kernel.getJob(first.jobId);
  const spendBefore = harness.image.spendEvents.length + harness.video.spendEvents.length;

  const wardrobe: TypedDirective = { id: "t-wardrobe", kind: "change", dimension: "wardrobe", target: { scope: "units", unitIds: ["unit-2"] }, intent: "Green sweatpants in the reveal", evidenceIds: [] };
  const child = deriveRevision(parent, { id: "rev-2", userIntent: "Change the reveal wardrobe", directives: [...baseDirectives, wardrobe] });
  const nextPlan = samplePlan(child);
  const repair = planRepairReuse({ previousPlan: first.plan, previousAcceptedArtifacts: firstJob.unitArtifacts, nextPlan, changed: [wardrobe] });
  assert.deepEqual(Object.keys(repair.reuse).sort(), ["unit-1:anchor", "unit-1:motion"]);

  const second = harness.createJob({ revision: child, plan: nextPlan, reusedUnitArtifacts: repair.reuse });
  assert.equal(second.estimate.units.filter((unit) => unit.reused).length, 2);
  runToSettled(harness, second.jobId, "worker-b");
  const secondJob = harness.kernel.getJob(second.jobId);
  assert.equal(secondJob.state, "succeeded");
  assert.equal(secondJob.unitArtifacts["unit-1:anchor"], firstJob.unitArtifacts["unit-1:anchor"]);
  assert.equal(secondJob.unitArtifacts["unit-1:motion"], firstJob.unitArtifacts["unit-1:motion"]);
  assert.notEqual(secondJob.unitArtifacts["unit-2:motion"], firstJob.unitArtifacts["unit-2:motion"]);
  assert.equal(harness.image.spendEvents.length + harness.video.spendEvents.length - spendBefore, 2, "only the two invalidated units were paid for");
  assert.equal(harness.kernel.ledgerSummary(second.jobId).capturedUsdMicros, second.estimate.subtotalUsdMicros);
  assert.equal(harness.kernel.listCalls(second.jobId).length, 2);
});

test("an estimate that assumes reuse without artifacts, or artifacts without reuse, is rejected at creation", () => {
  const harness = createHarness();
  const plan = samplePlan();
  const reuseEstimate = sampleEstimate(plan, harness.clock.nowMs(), ["unit-1:anchor"]);
  assert.throws(() => harness.createJob({ plan, estimate: reuseEstimate }), /assumes reuse of unit-1:anchor/);
  const staged = harness.assets.put("accepted-anchor", { workspaceId: "workspace-1", prefix: "tmp/x", provenance: "test" });
  assert.throws(() => harness.createJob({ plan, estimate: sampleEstimate(plan, harness.clock.nowMs()), reusedUnitArtifacts: { "unit-1:anchor": staged.hash } }), /charges for unit-1:anchor although its artifact is reused/);
});

test("QA findings become a typed repair revision whose invalidation touches only the affected units", () => {
  const harness = createHarness();
  harness.qa.findings = [{
    id: "f-wardrobe",
    dimension: "wardrobe",
    severity: "high",
    startMs: 5_000,
    endMs: 10_000,
    referenceObservation: "Grey sweatpants after the reveal",
    resultObservation: "Black shorts persisted after the reveal",
    affectedUnitIds: ["unit-2:anchor", "unit-2:motion"],
    affectedStepIds: [],
    repair: { kind: "change", target: { scope: "units", unitIds: ["unit-2"] }, intent: "Switch the reveal wardrobe to grey sweatpants", value: "light grey sweatpants" },
    evidenceIds: [],
  }];
  const parent = sampleRevision();
  const { jobId, plan } = harness.createJob({ revision: parent });
  runToSettled(harness, jobId);
  const job = harness.kernel.getJob(jobId);
  const report = harness.kernel.getQAReport(job.qaReportId!)!;
  assert.equal(report.findings.length, 1);
  const { revision, directives } = proposeRepairRevision({ report, parent, revisionId: "rev-2" });
  assert.equal(revision.revision, 2);
  assert.equal(directives[0]!.dimension, "wardrobe");
  const nextPlan = samplePlan(revision);
  const reuse = planRepairReuse({ previousPlan: plan, previousAcceptedArtifacts: job.unitArtifacts, nextPlan, changed: directives });
  assert.deepEqual(reuse.regenerate, ["unit-2:anchor", "unit-2:motion"]);
});
