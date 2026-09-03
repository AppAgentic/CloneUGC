import { contentHash } from "../canonical.ts";
import { checkGenerationAuthority, type ApprovalToken, type RightsRecord } from "../authority.ts";
import { assertCompiledPlan, type CompiledPlan } from "../compiler.ts";
import type { EvidenceClaim, FidelityMap } from "../contracts.ts";
import { assertReconstructionRevision, type ReconstructionRevision } from "../directives.ts";
import { assertGenerationEstimate, providerClassForUnit, type GenerationEstimate, type ProviderClass, type Resolution } from "../estimate.ts";
import { assertQAReport, finalizeQAReport, type QAReport } from "../qa.ts";
import type { AssetStore, ProviderAdapter, QAScorer, RenderAdapter } from "./adapters.ts";
import { MemoryStore, SequentialIds, type Clock, type Transaction } from "./store.ts";
import {
  COLLECTIONS,
  STAGES,
  type AuditEvent,
  type GenerationJob,
  type IdempotencyRecord,
  type JobState,
  type LedgerEntry,
  type OutboxEvent,
  type OutputArtifact,
  type ProviderCall,
  type ProviderReceipt,
  type QueueTask,
  type StageName,
  type StoredQAReport,
  type TaskLease,
} from "./types.ts";

/**
 * The durable job kernel.
 *
 * Every state transition is a transaction against the store. Paid-provider calls move through
 * reserved -> submitting -> submitted -> succeeded | failed with compare-and-set guards, unknown
 * outcomes pause the stage for reconciliation, cost is captured exactly once per call through
 * ledger keys, and unused reservation is released only when the job is terminal.
 */

export class KernelError extends Error {
  override name = "KernelError";
}

export class LeaseLostError extends Error {
  override name = "LeaseLostError";
}

export interface KernelPolicy {
  leaseMs: number;
  maxAttempts: number;
  resolution: Resolution;
}

export interface KernelDeps {
  store: MemoryStore;
  clock: Clock;
  ids?: SequentialIds;
  providers: Partial<Record<ProviderClass, ProviderAdapter>>;
  assets: AssetStore;
  render: RenderAdapter;
  qa: QAScorer;
  policy: KernelPolicy;
}

export interface CreateJobInput {
  workspaceId: string;
  actorId: string;
  idempotencyKey: string;
  map?: FidelityMap;
  evidence?: readonly EvidenceClaim[];
  revision: ReconstructionRevision;
  plan: CompiledPlan;
  estimate: GenerationEstimate;
  rightsRecordId: string;
  rightsTokenId: string;
  spendTokenId: string;
  reusedUnitArtifacts?: Readonly<Record<string, string>>;
}

export interface LedgerSummary {
  reservedUsdMicros: number;
  capturedUsdMicros: number;
  releasedUsdMicros: number;
  outstandingUsdMicros: number;
  captureEntries: number;
}

const ACTIVE_CALL_STATES: ReadonlySet<ProviderCall["state"]> = new Set(["reserved", "submitting", "submitted", "unknown", "succeeded"]);
const TERMINAL_STATES: ReadonlySet<JobState> = new Set(["succeeded", "failed", "cancelled"]);

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

export class JobKernel {
  readonly store: MemoryStore;
  readonly clock: Clock;
  readonly ids: SequentialIds;
  readonly providers: Partial<Record<ProviderClass, ProviderAdapter>>;
  readonly assets: AssetStore;
  readonly render: RenderAdapter;
  readonly qa: QAScorer;
  readonly policy: KernelPolicy;

  constructor(deps: KernelDeps) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.ids = deps.ids ?? new SequentialIds();
    this.providers = deps.providers;
    this.assets = deps.assets;
    this.render = deps.render;
    this.qa = deps.qa;
    this.policy = deps.policy;
  }

  // ---------------------------------------------------------------------------------------------
  // Registration of server-side records. Agents never call these.

  registerRightsRecord(record: RightsRecord): void {
    this.store.transaction((tx) => tx.set(COLLECTIONS.rights, record.id, record));
  }

  registerApprovalToken(token: ApprovalToken): void {
    this.store.transaction((tx) => {
      if (tx.get(COLLECTIONS.approvals, token.id) !== undefined) throw new KernelError(`approval ${token.id} already exists`);
      tx.set(COLLECTIONS.approvals, token.id, token);
    });
  }

  registerPlan(plan: CompiledPlan, estimate: GenerationEstimate, revision: ReconstructionRevision): void {
    assertCompiledPlan(plan);
    assertGenerationEstimate(estimate);
    assertReconstructionRevision(revision);
    this.store.transaction((tx) => {
      tx.set("plans", plan.planHash, plan);
      tx.set("estimates", estimate.estimateHash, estimate);
      tx.set("revisions", plan.revisionHash, revision);
    });
  }

  getPlan(planHash: string): CompiledPlan {
    const plan = this.store.get<CompiledPlan>("plans", planHash);
    if (plan === undefined) throw new KernelError(`plan ${planHash} is not registered`);
    return plan;
  }

  getEstimate(estimateHash: string): GenerationEstimate {
    const estimate = this.store.get<GenerationEstimate>("estimates", estimateHash);
    if (estimate === undefined) throw new KernelError(`estimate ${estimateHash} is not registered`);
    return estimate;
  }

  getJob(jobId: string): GenerationJob {
    const job = this.store.get<GenerationJob>(COLLECTIONS.jobs, jobId);
    if (job === undefined) throw new KernelError(`job ${jobId} does not exist`);
    return job;
  }

  getApproval(id: string): ApprovalToken | undefined {
    return this.store.get<ApprovalToken>(COLLECTIONS.approvals, id);
  }

  listCalls(jobId: string): ProviderCall[] {
    return this.store.list<ProviderCall>(COLLECTIONS.providerCalls).map((entry) => entry.data).filter((call) => call.jobId === jobId).sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
  }

  listLedger(jobId?: string): LedgerEntry[] {
    return this.store.list<LedgerEntry>(COLLECTIONS.ledger).map((entry) => entry.data).filter((entry) => jobId === undefined || entry.jobId === jobId);
  }

  listAudit(): AuditEvent[] {
    return this.store.list<AuditEvent>(COLLECTIONS.audit).map((entry) => entry.data).sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
  }

  listTasks(): QueueTask[] {
    return this.store.list<QueueTask>(COLLECTIONS.tasks).map((entry) => entry.data);
  }

  getOutput(outputId: string): OutputArtifact | undefined {
    return this.store.get<OutputArtifact>(COLLECTIONS.outputs, outputId);
  }

  getQAReport(reportId: string): QAReport | undefined {
    return this.store.get<StoredQAReport>(COLLECTIONS.qaReports, reportId)?.report;
  }

  ledgerSummary(jobId: string): LedgerSummary {
    const entries = this.listLedger(jobId);
    const sum = (kind: LedgerEntry["kind"]): number => entries.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amountUsdMicros, 0);
    const reserved = sum("reserve");
    const captured = sum("capture") + sum("adjustment");
    const released = sum("release");
    return { reservedUsdMicros: reserved, capturedUsdMicros: captured, releasedUsdMicros: released, outstandingUsdMicros: reserved - captured - released, captureEntries: entries.filter((entry) => entry.kind === "capture").length };
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers used inside transactions.

  private audit(tx: Transaction, event: Omit<AuditEvent, "id" | "atMs" | "detail"> & { detail?: string | undefined }): void {
    const id = this.ids.next("audit");
    const { detail, ...rest } = event;
    tx.set(COLLECTIONS.audit, id, { id, atMs: this.clock.nowMs(), ...rest, ...(detail === undefined ? {} : { detail }) });
  }

  private requireJob(tx: Transaction, jobId: string): GenerationJob {
    const job = tx.get<GenerationJob>(COLLECTIONS.jobs, jobId);
    if (job === undefined) throw new KernelError(`job ${jobId} does not exist`);
    return job;
  }

  private requireLease(tx: Transaction, jobId: string, workerId: string): TaskLease {
    const lease = tx.get<TaskLease>(COLLECTIONS.leases, jobId);
    const now = this.clock.nowMs();
    if (lease === undefined || lease.owner !== workerId || lease.expiresAtMs <= now) {
      throw new LeaseLostError(`worker ${workerId} no longer holds the lease for ${jobId}`);
    }
    return lease;
  }

  private saveJob(tx: Transaction, job: GenerationJob): void {
    job.updatedAtMs = this.clock.nowMs();
    tx.set(COLLECTIONS.jobs, job.id, job);
  }

  private ledgerOnce(tx: Transaction, entry: Omit<LedgerEntry, "createdAtMs">): boolean {
    if (tx.get<LedgerEntry>(COLLECTIONS.ledger, entry.id) !== undefined) return false;
    tx.set(COLLECTIONS.ledger, entry.id, { ...entry, createdAtMs: this.clock.nowMs() });
    return true;
  }

  private createJobRequestHash(input: CreateJobInput): string {
    return contentHash({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      planHash: input.plan.planHash,
      revisionHash: input.plan.revisionHash,
      estimateHash: input.estimate.estimateHash,
      sourceContentSha256: input.plan.sourceContentSha256,
      rightsRecordId: input.rightsRecordId,
      rightsTokenId: input.rightsTokenId,
      spendTokenId: input.spendTokenId,
      reusedUnitArtifacts: input.reusedUnitArtifacts ?? {},
    });
  }

  private assertActualCost(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new KernelError("actual provider cost must be a non-negative integer of USD micros");
  }

  private finalize(tx: Transaction, job: GenerationJob, state: "succeeded" | "failed" | "cancelled", reason: string, actorId: string): void {
    if (isTerminal(job.state)) return;
    job.state = state;
    job.terminalReason = reason;
    const unused = job.reservationUsdMicros - job.capturedUsdMicros;
    const releaseAmount = Math.max(0, unused);
    if (this.ledgerOnce(tx, { id: `release:${job.id}`, jobId: job.id, kind: "release", amountUsdMicros: releaseAmount })) {
      job.releasedUsdMicros += releaseAmount;
    }
    if (unused < 0) job.attentionReason = `captured cost exceeded the reserved ceiling by ${-unused} USD micros`;
    for (const stage of STAGES) {
      const progress = job.stages[stage];
      if (progress.status === "running" || progress.status === "reconciling") progress.status = state === "succeeded" ? "succeeded" : "failed";
    }
    tx.delete(COLLECTIONS.leases, job.id);
    for (const task of tx.list<QueueTask>(COLLECTIONS.tasks)) if (task.data.jobId === job.id) tx.delete(COLLECTIONS.tasks, task.id);
    this.saveJob(tx, job);
    this.audit(tx, { actorId, action: `job.${state}`, objectHashes: { planHash: job.inputs.planHash }, result: "ok", detail: reason });
  }

  private enqueueOutbox(tx: Transaction, jobId: string, kind: OutboxEvent["kind"]): OutboxEvent {
    const id = this.ids.next("outbox");
    const event: OutboxEvent = { id, kind, jobId, createdAtMs: this.clock.nowMs(), deliveries: 0 };
    tx.set(COLLECTIONS.outbox, id, event);
    return event;
  }

  // ---------------------------------------------------------------------------------------------
  // Job creation: one transaction creates the job, reserves the ceiling, consumes both approvals,
  // and writes the outbox event.

  createJob(input: CreateJobInput): { job: GenerationJob; created: boolean } {
    const result = this.store.transaction((tx): { job: GenerationJob; created: boolean } | { rejected: string[] } => {
      const requestHash = this.createJobRequestHash(input);
      const existing = tx.get<IdempotencyRecord>(COLLECTIONS.idempotency, `${input.workspaceId}:${input.idempotencyKey}`);
      if (existing !== undefined) {
        if (existing.requestHash !== requestHash) return { rejected: ["idempotency key was already used for a different generation request"] };
        return { job: this.requireJob(tx, existing.jobId), created: false };
      }

      const rights = tx.get<RightsRecord>(COLLECTIONS.rights, input.rightsRecordId);
      const rightsToken = tx.get<ApprovalToken>(COLLECTIONS.approvals, input.rightsTokenId);
      const spendToken = tx.get<ApprovalToken>(COLLECTIONS.approvals, input.spendTokenId);
      const check = checkGenerationAuthority({
        workspaceId: input.workspaceId,
        nowMs: this.clock.nowMs(),
        ...(input.map === undefined ? {} : { map: input.map }),
        ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
        revision: input.revision,
        plan: input.plan,
        estimate: input.estimate,
        ...(rights === undefined ? {} : { rights }),
        ...(rightsToken === undefined ? {} : { rightsToken }),
        ...(spendToken === undefined ? {} : { spendToken }),
      });
      const reasons = [...check.reasons];
      if (input.workspaceId.length === 0) reasons.push("workspace identity is required");
      if (input.actorId.length === 0) reasons.push("actor identity is required");
      if (input.idempotencyKey.length === 0) reasons.push("idempotency key is required");
      if (rightsToken === undefined && input.rightsTokenId.length > 0) reasons.push("rights approval is not server-minted");
      if (spendToken === undefined && input.spendTokenId.length > 0) reasons.push("spend approval is not server-minted");
      const reused: Record<string, string> = {};
      for (const [unitId, hash] of Object.entries(input.reusedUnitArtifacts ?? {})) {
        const currentUnit = input.plan.units.find((unit) => unit.id === unitId);
        if (currentUnit === undefined) reasons.push(`reused artifact targets unknown unit ${unitId}`);
        else if (!this.assets.has(hash)) reasons.push(`reused artifact ${hash} for ${unitId} is missing from the asset store`);
        else {
          const accepted = tx.list<OutputArtifact>(COLLECTIONS.outputs).map((entry) => entry.data).some((output) => {
            if (output.workspaceId !== input.workspaceId || output.sourceContentSha256 !== input.plan.sourceContentSha256 || output.unitArtifacts[unitId] !== hash) return false;
            const previousPlan = tx.get<CompiledPlan>("plans", output.planHash);
            return previousPlan?.units.find((unit) => unit.id === unitId)?.unitHash === currentUnit.unitHash;
          });
          if (!accepted) reasons.push(`reused artifact ${hash} for ${unitId} is not an accepted unchanged output in this workspace`);
          else reused[unitId] = hash;
        }
      }
      for (const estimateUnit of input.estimate.units) {
        if (estimateUnit.reused && reused[estimateUnit.unitId] === undefined) reasons.push(`estimate assumes reuse of ${estimateUnit.unitId} but no accepted artifact was supplied`);
        if (!estimateUnit.reused && reused[estimateUnit.unitId] !== undefined) reasons.push(`estimate charges for ${estimateUnit.unitId} although its artifact is reused`);
      }
      if (reasons.length > 0) return { rejected: reasons };

      const now = this.clock.nowMs();
      const jobId = this.ids.next("job");
      const stages = Object.fromEntries(STAGES.map((stage) => [stage, { status: "pending", attempts: 0 }])) as GenerationJob["stages"];
      const job: GenerationJob = {
        schemaVersion: "0.1.0",
        id: jobId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        inputs: {
          planHash: input.plan.planHash,
          revisionHash: input.plan.revisionHash,
          estimateHash: input.estimate.estimateHash,
          sourceContentSha256: input.plan.sourceContentSha256,
          rightsRecordId: input.rightsRecordId,
          rightsTokenId: input.rightsTokenId,
          spendTokenId: input.spendTokenId,
          reusedUnitArtifacts: reused,
        },
        state: "queued",
        stages,
        reservationUsdMicros: input.estimate.maxCostUsdMicros,
        capturedUsdMicros: 0,
        releasedUsdMicros: 0,
        unitArtifacts: { ...reused },
        createdAtMs: now,
        updatedAtMs: now,
      };
      tx.set("plans", input.plan.planHash, input.plan);
      tx.set("estimates", input.estimate.estimateHash, input.estimate);
      tx.set("revisions", input.plan.revisionHash, input.revision);
      tx.set(COLLECTIONS.jobs, jobId, job);
      tx.set(COLLECTIONS.approvals, rightsToken!.id, { ...rightsToken!, consumedByJobId: jobId, consumedAtMs: now });
      tx.set(COLLECTIONS.approvals, spendToken!.id, { ...spendToken!, consumedByJobId: jobId, consumedAtMs: now });
      this.ledgerOnce(tx, { id: `reserve:${jobId}`, jobId, kind: "reserve", amountUsdMicros: input.estimate.maxCostUsdMicros });
      this.enqueueOutbox(tx, jobId, "job.dispatch");
      tx.set(COLLECTIONS.idempotency, `${input.workspaceId}:${input.idempotencyKey}`, { jobId, requestHash } satisfies IdempotencyRecord);
      this.audit(tx, { actorId: input.actorId, authority: `${rightsToken!.id},${spendToken!.id}`, action: "job.create", objectHashes: { planHash: input.plan.planHash, revisionHash: input.plan.revisionHash, estimateHash: input.estimate.estimateHash }, result: "ok" });
      return { job, created: true };
    });
    if ("rejected" in result) {
      // The rejection is audited in its own transaction so it survives the aborted creation.
      this.store.transaction((tx) => this.audit(tx, { actorId: input.actorId, action: "job.create", objectHashes: { planHash: input.plan.planHash, revisionHash: input.plan.revisionHash }, result: "rejected", detail: result.rejected.join("; ") }));
      throw new KernelError(`generation is not authorized: ${result.rejected.join("; ")}`);
    }
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // Outbox dispatch and task claiming. Re-delivery is expected and safe.

  dispatchOutbox(): { delivered: number; newTasks: number } {
    let delivered = 0;
    let newTasks = 0;
    for (const entry of this.store.list<OutboxEvent>(COLLECTIONS.outbox)) {
      if (entry.data.deliveredAtMs !== undefined) continue;
      if (this.deliverOutbox(entry.id)) newTasks += 1;
      delivered += 1;
    }
    return { delivered, newTasks };
  }

  /** Delivers one outbox event. Calling it again for the same event never creates a second task. */
  deliverOutbox(eventId: string): boolean {
    return this.store.transaction((tx) => {
      const event = tx.get<OutboxEvent>(COLLECTIONS.outbox, eventId);
      if (event === undefined) throw new KernelError(`outbox event ${eventId} does not exist`);
      const now = this.clock.nowMs();
      tx.set(COLLECTIONS.outbox, eventId, { ...event, deliveredAtMs: event.deliveredAtMs ?? now, deliveries: event.deliveries + 1 });
      const existing = tx.get<QueueTask>(COLLECTIONS.tasks, eventId);
      if (existing !== undefined) {
        tx.set(COLLECTIONS.tasks, eventId, { ...existing, deliveries: existing.deliveries + 1 });
        return false;
      }
      const job = tx.get<GenerationJob>(COLLECTIONS.jobs, event.jobId);
      if (job === undefined || isTerminal(job.state)) return false;
      tx.set(COLLECTIONS.tasks, eventId, { id: eventId, jobId: event.jobId, enqueuedAtMs: now, deliveries: 1 });
      return true;
    });
  }

  claim(workerId: string): string | undefined {
    return this.store.transaction((tx) => {
      const now = this.clock.nowMs();
      for (const task of tx.list<QueueTask>(COLLECTIONS.tasks)) {
        const job = tx.get<GenerationJob>(COLLECTIONS.jobs, task.data.jobId);
        if (job === undefined || isTerminal(job.state)) {
          tx.delete(COLLECTIONS.tasks, task.id);
          continue;
        }
        if (job.state === "needs_attention") continue;
        const lease = tx.get<TaskLease>(COLLECTIONS.leases, job.id);
        if (lease !== undefined && lease.expiresAtMs > now && lease.owner !== workerId) continue;
        const next: TaskLease = { jobId: job.id, owner: workerId, version: (lease?.version ?? 0) + 1, acquiredAtMs: now, heartbeatAtMs: now, expiresAtMs: now + this.policy.leaseMs };
        tx.set(COLLECTIONS.leases, job.id, next);
        if (job.state === "queued") job.state = "running";
        this.saveJob(tx, job);
        this.audit(tx, { actorId: workerId, action: lease === undefined ? "lease.acquire" : "lease.takeover", objectHashes: { planHash: job.inputs.planHash }, result: "ok", detail: lease === undefined ? undefined : `previous owner ${lease.owner}` });
        return job.id;
      }
      return undefined;
    });
  }

  heartbeat(jobId: string, workerId: string): TaskLease {
    return this.store.transaction((tx) => {
      const lease = this.requireLease(tx, jobId, workerId);
      const now = this.clock.nowMs();
      const next = { ...lease, heartbeatAtMs: now, expiresAtMs: now + this.policy.leaseMs };
      tx.set(COLLECTIONS.leases, jobId, next);
      return next;
    });
  }

  getLease(jobId: string): TaskLease | undefined {
    return this.store.get<TaskLease>(COLLECTIONS.leases, jobId);
  }

  // ---------------------------------------------------------------------------------------------
  // Stage bookkeeping.

  startStage(jobId: string, workerId: string, stage: StageName): void {
    this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const job = this.requireJob(tx, jobId);
      const progress = job.stages[stage];
      if (progress.status === "succeeded") return;
      if (progress.status !== "running") {
        progress.status = "running";
        progress.attempts += 1;
        progress.startedAtMs = this.clock.nowMs();
      }
      if (stage === "qa") job.state = "qa";
      else if (job.state === "queued") job.state = "running";
      this.saveJob(tx, job);
    });
  }

  completeStage(jobId: string, workerId: string, stage: StageName): void {
    this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const job = this.requireJob(tx, jobId);
      job.stages[stage].status = "succeeded";
      job.stages[stage].finishedAtMs = this.clock.nowMs();
      this.saveJob(tx, job);
    });
  }

  failJob(jobId: string, actorId: string, reason: string): void {
    this.store.transaction((tx) => {
      const job = this.requireJob(tx, jobId);
      this.finalize(tx, job, "failed", reason, actorId);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Provider calls.

  activeCall(jobId: string, stage: StageName, unitId: string): ProviderCall | undefined {
    return this.listCalls(jobId).find((call) => call.stage === stage && call.unitId === unitId && ACTIVE_CALL_STATES.has(call.state));
  }

  reserveProviderCall(jobId: string, workerId: string, stage: StageName, unitId: string, providerClass: ProviderClass): ProviderCall {
    return this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const job = this.requireJob(tx, jobId);
      if (job.cancelRequestedAtMs !== undefined) throw new KernelError(`job ${jobId} has a pending cancellation; no new provider calls`);
      if (stage !== "anchor" && stage !== "motion") throw new KernelError(`stage ${stage} cannot reserve a paid provider call`);
      const plan = tx.get<CompiledPlan>("plans", job.inputs.planHash);
      const estimate = tx.get<GenerationEstimate>("estimates", job.inputs.estimateHash);
      if (plan === undefined || estimate === undefined) throw new KernelError(`job ${jobId} is missing its registered plan or estimate`);
      const unit = plan.units.find((candidate) => candidate.id === unitId);
      if (unit === undefined || unit.kind !== stage) throw new KernelError(`unit ${unitId} does not belong to stage ${stage}`);
      const expectedClass = providerClassForUnit(unit);
      if (providerClass !== expectedClass || expectedClass === "deterministic_finishing") throw new KernelError(`unit ${unitId} cannot use provider class ${providerClass}`);
      const estimateUnit = estimate.units.find((candidate) => candidate.unitId === unitId);
      if (estimateUnit === undefined || estimateUnit.reused) throw new KernelError(`unit ${unitId} has no payable estimate entry`);
      if (job.capturedUsdMicros + estimateUnit.costUsdMicros > job.reservationUsdMicros) throw new KernelError(`unit ${unitId} would exceed the approved spend ceiling`);
      const calls = tx.list<ProviderCall>(COLLECTIONS.providerCalls).map((entry) => entry.data).filter((call) => call.jobId === jobId && call.stage === stage && call.unitId === unitId);
      const active = calls.find((call) => ACTIVE_CALL_STATES.has(call.state));
      if (active !== undefined) return active;
      const attempt = calls.length + 1;
      if (attempt > this.policy.maxAttempts) throw new KernelError(`unit ${unitId} exhausted ${this.policy.maxAttempts} attempts`);
      const now = this.clock.nowMs();
      const id = `${jobId}:${stage}:${unitId}:${attempt}`;
      const call: ProviderCall = { schemaVersion: "0.1.0", id, jobId, stage, unitId, attempt, providerClass, idempotencyKey: contentHash({ jobId, stage, unitId, attempt }), state: "reserved", createdAtMs: now, updatedAtMs: now };
      tx.set(COLLECTIONS.providerCalls, id, call);
      this.audit(tx, { actorId: workerId, action: "call.reserve", objectHashes: { planHash: job.inputs.planHash, call: id }, result: "ok" });
      return call;
    });
  }

  private transitionCall(callId: string, from: readonly ProviderCall["state"][], to: ProviderCall["state"], mutate: (call: ProviderCall, tx: Transaction, job: GenerationJob) => void, options: { workerId?: string; actorId: string; action: string }): ProviderCall {
    return this.store.transaction((tx) => {
      const call = tx.get<ProviderCall>(COLLECTIONS.providerCalls, callId);
      if (call === undefined) throw new KernelError(`provider call ${callId} does not exist`);
      if (options.workerId !== undefined) this.requireLease(tx, call.jobId, options.workerId);
      if (!from.includes(call.state)) throw new KernelError(`provider call ${callId} is ${call.state}; expected ${from.join("|")}`);
      const job = this.requireJob(tx, call.jobId);
      call.state = to;
      call.updatedAtMs = this.clock.nowMs();
      mutate(call, tx, job);
      tx.set(COLLECTIONS.providerCalls, callId, call);
      this.saveJob(tx, job);
      this.audit(tx, { actorId: options.actorId, action: options.action, objectHashes: { call: callId }, result: "ok" });
      return call;
    });
  }

  markSubmitting(callId: string, workerId: string): ProviderCall {
    return this.transitionCall(callId, ["reserved"], "submitting", () => undefined, { workerId, actorId: workerId, action: "call.submitting" });
  }

  /** Persists the provider receipt. Deliberately does not require the lease: the receipt is the record of money already spent. */
  markSubmitted(callId: string, actorId: string, receipt: ProviderReceipt): ProviderCall {
    if (receipt.providerRequestId.length === 0 || !Number.isSafeInteger(receipt.acceptedAtMs) || receipt.acceptedAtMs < 0) throw new KernelError("provider receipt is invalid");
    return this.transitionCall(callId, ["submitting", "unknown"], "submitted", (call) => {
      call.receipt = receipt;
    }, { actorId, action: "call.submitted" });
  }

  /** The outcome is unknown. Pauses only this stage for reconciliation; never resubmits. */
  markUnknown(callId: string, actorId: string, reason: string): ProviderCall {
    return this.transitionCall(callId, ["submitting", "submitted"], "unknown", (call, _tx, job) => {
      call.failureReason = reason;
      call.reconciliation = { checks: 0, lastCheckedAtMs: this.clock.nowMs(), note: reason };
      job.stages[call.stage].status = "reconciling";
      job.state = "needs_attention";
      job.attentionKind = "provider_unknown";
      job.attentionReason = `provider call ${call.id} has an unknown outcome`;
    }, { actorId, action: "call.unknown" });
  }

  markFailed(callId: string, actorId: string, reason: string, actualCostUsdMicros = 0): ProviderCall {
    this.assertActualCost(actualCostUsdMicros);
    return this.transitionCall(callId, ["reserved", "submitting", "submitted", "unknown"], "failed", (call, tx, job) => {
      call.failureReason = reason;
      call.actualCostUsdMicros = actualCostUsdMicros;
      if (actualCostUsdMicros > 0 && this.ledgerOnce(tx, { id: `capture:${call.id}`, jobId: job.id, kind: "capture", amountUsdMicros: actualCostUsdMicros, providerCallId: call.id })) {
        job.capturedUsdMicros += actualCostUsdMicros;
      }
      if (job.capturedUsdMicros > job.reservationUsdMicros) this.finalize(tx, job, "failed", "actual provider cost exceeded the approved spend ceiling", actorId);
    }, { actorId, action: "call.failed" });
  }

  /** Captures actual cost exactly once and records the accepted unit artifact. Idempotent for repeated delivery. */
  completeProviderCall(callId: string, workerId: string, outcome: { actualCostUsdMicros: number; resultAssetHash: string }): { call: ProviderCall; captured: boolean; overCeiling: boolean } {
    this.assertActualCost(outcome.actualCostUsdMicros);
    return this.store.transaction((tx) => {
      const call = tx.get<ProviderCall>(COLLECTIONS.providerCalls, callId);
      if (call === undefined) throw new KernelError(`provider call ${callId} does not exist`);
      this.requireLease(tx, call.jobId, workerId);
      const job = this.requireJob(tx, call.jobId);
      if (call.state === "succeeded") return { call, captured: false, overCeiling: job.capturedUsdMicros > job.reservationUsdMicros };
      if (call.state !== "submitted") throw new KernelError(`provider call ${callId} is ${call.state}; expected submitted`);
      if (!this.assets.has(outcome.resultAssetHash)) throw new KernelError(`result asset ${outcome.resultAssetHash} was not staged before completion`);
      call.state = "succeeded";
      call.actualCostUsdMicros = outcome.actualCostUsdMicros;
      call.resultAssetHash = outcome.resultAssetHash;
      call.updatedAtMs = this.clock.nowMs();
      const captured = this.ledgerOnce(tx, { id: `capture:${call.id}`, jobId: job.id, kind: "capture", amountUsdMicros: outcome.actualCostUsdMicros, providerCallId: call.id });
      if (captured) job.capturedUsdMicros += outcome.actualCostUsdMicros;
      job.unitArtifacts[call.unitId] = outcome.resultAssetHash;
      tx.set(COLLECTIONS.providerCalls, callId, call);
      if (job.capturedUsdMicros > job.reservationUsdMicros) this.finalize(tx, job, "failed", "actual provider cost exceeded the approved spend ceiling", workerId);
      this.saveJob(tx, job);
      this.audit(tx, { actorId: workerId, action: "call.succeeded", objectHashes: { call: callId, artifact: outcome.resultAssetHash }, result: "ok", detail: `captured ${outcome.actualCostUsdMicros}` });
      return { call, captured, overCeiling: job.capturedUsdMicros > job.reservationUsdMicros };
    });
  }

  /** Records a deterministic (unpaid) unit artifact. */
  recordUnitArtifact(jobId: string, workerId: string, unitId: string, assetHash: string): void {
    this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const job = this.requireJob(tx, jobId);
      if (!this.assets.has(assetHash)) throw new KernelError(`artifact ${assetHash} is missing from the asset store`);
      job.unitArtifacts[unitId] = assetHash;
      this.saveJob(tx, job);
    });
  }

  /**
   * Reconciles unknown calls by provider request lookup. Found receipts resume the stage; a
   * provider that confirms it never accepted the request marks the call failed so a bounded new
   * attempt may follow. A provider that cannot answer leaves the call unknown.
   */
  reconcile(jobId: string, actorId = "reconciler"): { resumed: boolean; resolved: string[]; stillUnknown: string[] } {
    const resolved: string[] = [];
    const stillUnknown: string[] = [];
    for (const call of this.listCalls(jobId).filter((candidate) => candidate.state === "unknown")) {
      const adapter = this.providers[call.providerClass];
      if (adapter === undefined) throw new KernelError(`no adapter for ${call.providerClass}`);
      let receipt: ProviderReceipt | undefined;
      let lookupFailed = false;
      try {
        receipt = adapter.lookup(call.idempotencyKey);
      } catch {
        lookupFailed = true;
      }
      if (lookupFailed) {
        this.store.transaction((tx) => {
          const current = tx.get<ProviderCall>(COLLECTIONS.providerCalls, call.id)!;
          current.reconciliation = { checks: (current.reconciliation?.checks ?? 0) + 1, lastCheckedAtMs: this.clock.nowMs(), note: "provider lookup unavailable" };
          tx.set(COLLECTIONS.providerCalls, call.id, current);
        });
        stillUnknown.push(call.id);
        continue;
      }
      if (receipt !== undefined) {
        this.transitionCall(call.id, ["unknown"], "submitted", (current) => {
          current.receipt = receipt;
          current.reconciliation = { checks: (current.reconciliation?.checks ?? 0) + 1, lastCheckedAtMs: this.clock.nowMs(), note: `recovered receipt ${receipt.providerRequestId}` };
        }, { actorId, action: "call.reconciled" });
      } else {
        this.markFailed(call.id, actorId, "provider has no record of the request", 0);
      }
      resolved.push(call.id);
    }
    const resumed = this.store.transaction((tx) => {
      const job = this.requireJob(tx, jobId);
      if (job.state !== "needs_attention") return false;
      if (job.attentionKind !== "provider_unknown") return false;
      const unknown = tx.list<ProviderCall>(COLLECTIONS.providerCalls).map((entry) => entry.data).some((candidate) => candidate.jobId === jobId && candidate.state === "unknown");
      if (unknown) return false;
      for (const stage of STAGES) if (job.stages[stage].status === "reconciling") job.stages[stage].status = "running";
      job.state = "running";
      delete job.attentionKind;
      delete job.attentionReason;
      tx.delete(COLLECTIONS.leases, jobId);
      this.saveJob(tx, job);
      this.enqueueOutbox(tx, jobId, "job.resume");
      this.audit(tx, { actorId, action: "job.resume", objectHashes: { planHash: job.inputs.planHash }, result: "ok" });
      return true;
    });
    return { resumed, resolved, stillUnknown };
  }

  // ---------------------------------------------------------------------------------------------
  // Cancellation. Unsubmitted work stops; in-flight provider calls are asked to cancel when the
  // adapter supports it, and are never reported cancelled until the provider confirms.

  cancelJob(jobId: string, actorId: string): { state: JobState; inFlight: string[] } {
    const prepared = this.store.transaction((tx) => {
      const job = this.requireJob(tx, jobId);
      if (isTerminal(job.state)) return { state: job.state, inFlight: [] as string[], finalized: true };
      const now = this.clock.nowMs();
      job.cancelRequestedAtMs = job.cancelRequestedAtMs ?? now;
      const calls = tx.list<ProviderCall>(COLLECTIONS.providerCalls).map((entry) => entry.data).filter((call) => call.jobId === jobId);
      const inFlight = calls.filter((call) => call.state === "submitted" || call.state === "submitting" || call.state === "unknown");
      if (inFlight.length === 0 && (job.state === "queued" || job.state === "running" || job.state === "qa" || job.state === "needs_attention")) {
        this.finalize(tx, job, "cancelled", "cancelled before any provider call was in flight", actorId);
        return { state: job.state, inFlight: [] as string[], finalized: true };
      }
      this.saveJob(tx, job);
      this.audit(tx, { actorId, action: "job.cancel_requested", objectHashes: { planHash: job.inputs.planHash }, result: "ok", detail: `${inFlight.length} provider call(s) in flight` });
      return { state: job.state, inFlight: inFlight.map((call) => call.id), finalized: false };
    });
    if (prepared.finalized) return { state: prepared.state, inFlight: prepared.inFlight };
    for (const callId of prepared.inFlight) {
      const call = this.store.get<ProviderCall>(COLLECTIONS.providerCalls, callId)!;
      if (call.receipt === undefined) continue;
      const adapter = this.providers[call.providerClass];
      const outcome = adapter?.cancel(call.receipt) ?? { supported: false, accepted: false };
      this.store.transaction((tx) => {
        const current = tx.get<ProviderCall>(COLLECTIONS.providerCalls, callId)!;
        current.cancel = { requestedAtMs: this.clock.nowMs(), supported: outcome.supported, accepted: outcome.accepted };
        tx.set(COLLECTIONS.providerCalls, callId, current);
        this.audit(tx, { actorId, action: "call.cancel_requested", objectHashes: { call: callId }, result: outcome.accepted ? "ok" : "rejected", detail: outcome.supported ? undefined : "provider does not support cancellation" });
      });
    }
    return { state: prepared.state, inFlight: prepared.inFlight };
  }

  /** Called by the worker once every in-flight call has settled after a cancellation request. */
  finalizeCancellation(jobId: string, workerId: string): void {
    this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const job = this.requireJob(tx, jobId);
      if (job.cancelRequestedAtMs === undefined) throw new KernelError(`job ${jobId} has no cancellation request`);
      const inFlight = tx.list<ProviderCall>(COLLECTIONS.providerCalls).map((entry) => entry.data).some((call) => call.jobId === jobId && (call.state === "submitted" || call.state === "submitting" || call.state === "unknown"));
      if (inFlight) throw new KernelError(`job ${jobId} still has in-flight provider calls`);
      this.finalize(tx, job, "cancelled", "cancelled after in-flight provider calls settled", workerId);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Finishing, QA, and atomic publication.

  recordFinishing(jobId: string, workerId: string, finishing: NonNullable<GenerationJob["finishing"]>): void {
    this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const job = this.requireJob(tx, jobId);
      for (const hash of [finishing.masterAssetHash, finishing.manifestAssetHash]) {
        if (!this.assets.has(hash)) throw new KernelError(`finishing asset ${hash} was not staged`);
      }
      job.finishing = finishing;
      this.saveJob(tx, job);
    });
  }

  recordQAReport(jobId: string, workerId: string, report: Omit<QAReport, "reportHash">): QAReport {
    const finished = finalizeQAReport(report);
    const current = this.getJob(jobId);
    const plan = this.getPlan(current.inputs.planHash);
    assertQAReport(finished, plan);
    if (finished.jobId !== jobId) throw new KernelError(`QA report belongs to another job`);
    if (finished.revisionHash !== current.inputs.revisionHash) throw new KernelError(`QA report is bound to another revision`);
    if (finished.sourceContentSha256 !== current.inputs.sourceContentSha256) throw new KernelError(`QA report is bound to another source`);
    if (finished.outputAssetHash !== current.finishing?.masterAssetHash) throw new KernelError(`QA report is bound to another output asset`);
    this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const job = this.requireJob(tx, jobId);
      tx.set(COLLECTIONS.qaReports, finished.id, { jobId, report: finished } satisfies StoredQAReport);
      job.qaReportId = finished.id;
      if (finished.rightsRegression) {
        job.state = "needs_attention";
        job.attentionKind = "qa_rights_regression";
        job.attentionReason = `QA report ${finished.id} detected a rights regression`;
      }
      this.saveJob(tx, job);
    });
    return finished;
  }

  /**
   * Publishes the final artifact and manifest atomically. The asset store commits both objects or
   * neither; the store transaction then records the output, marks the job succeeded, and releases
   * the unused reservation. If the record commit fails, a retry republishes the same hashes.
   */
  publishOutput(jobId: string, workerId: string): OutputArtifact {
    const job = this.getJob(jobId);
    if (job.finishing === undefined) throw new KernelError(`job ${jobId} has no finished master to publish`);
    if (job.qaReportId === undefined) throw new KernelError(`job ${jobId} has no QA report`);
    const report = this.getQAReport(job.qaReportId)!;
    if (report.rightsRegression) throw new KernelError(`job ${jobId} cannot publish an output with a rights regression`);
    if (report.jobId !== jobId || report.planHash !== job.inputs.planHash || report.revisionHash !== job.inputs.revisionHash || report.sourceContentSha256 !== job.inputs.sourceContentSha256 || report.outputAssetHash !== job.finishing.masterAssetHash) {
      throw new KernelError(`job ${jobId} has a QA report with mismatched lineage`);
    }
    this.store.transaction((tx) => this.requireLease(tx, jobId, workerId));
    const finalPrefix = `workspaces/${job.workspaceId}/outputs/${jobId}`;
    this.assets.publishAtomically({ workspaceId: job.workspaceId, finalPrefix, entries: [{ name: "master.mp4", hash: job.finishing.masterAssetHash }, { name: "manifest.json", hash: job.finishing.manifestAssetHash }] });
    return this.store.transaction((tx) => {
      this.requireLease(tx, jobId, workerId);
      const current = this.requireJob(tx, jobId);
      if (current.outputId !== undefined) return tx.get<OutputArtifact>(COLLECTIONS.outputs, current.outputId)!;
      const core = {
        schemaVersion: "0.1.0" as const,
        id: this.ids.next("output"),
        jobId,
        workspaceId: current.workspaceId,
        planHash: current.inputs.planHash,
        revisionHash: current.inputs.revisionHash,
        sourceContentSha256: current.inputs.sourceContentSha256,
        masterAssetHash: current.finishing!.masterAssetHash,
        manifestAssetHash: current.finishing!.manifestAssetHash,
        unitArtifacts: { ...current.unitArtifacts },
        qaReportHash: report.reportHash,
        exportLineage: { estimateHash: current.inputs.estimateHash, rightsTokenId: current.inputs.rightsTokenId, spendTokenId: current.inputs.spendTokenId, capturedUsdMicros: current.capturedUsdMicros },
        publishedAtMs: this.clock.nowMs(),
      };
      const output: OutputArtifact = { ...core, outputHash: contentHash(core) };
      tx.set(COLLECTIONS.outputs, output.id, output);
      current.outputId = output.id;
      current.stages.publish.status = "succeeded";
      current.stages.publish.finishedAtMs = this.clock.nowMs();
      this.finalize(tx, current, "succeeded", "published", workerId);
      this.audit(tx, { actorId: workerId, action: "output.publish", objectHashes: { outputHash: output.outputHash, masterAssetHash: output.masterAssetHash }, result: "ok" });
      return output;
    });
  }
}
