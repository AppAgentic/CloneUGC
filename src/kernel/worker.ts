import type { PlanUnit } from "../compiler.ts";
import { providerClassForUnit } from "../estimate.ts";
import { ProviderRejectedError, ProviderResponseLostError } from "./adapters.ts";
import { JobKernel, KernelError, LeaseLostError, isTerminal } from "./kernel.ts";
import type { GenerationJob, ProviderCall, StageName } from "./types.ts";

/**
 * A stateless worker. Every call to `step` performs one small durable action against the kernel
 * and returns; a worker that dies between steps can be replaced by any other worker that claims
 * the lease, because all progress lives in the store.
 */

export type StepOutcome =
  | { kind: "reserved"; callId: string }
  | { kind: "submitted"; callId: string }
  | { kind: "unknown"; callId: string }
  | { kind: "waiting"; callId: string }
  | { kind: "unit_complete"; unitId: string; captured: boolean }
  | { kind: "unit_failed"; callId: string; reason: string }
  | { kind: "stage_complete"; stage: StageName }
  | { kind: "rendered"; masterAssetHash: string }
  | { kind: "scored"; reportId: string }
  | { kind: "published"; outputId: string }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: string }
  | { kind: "reconciling" }
  | { kind: "terminal"; state: GenerationJob["state"] };

export class Worker {
  readonly id: string;
  private readonly kernel: JobKernel;

  constructor(id: string, kernel: JobKernel) {
    this.id = id;
    this.kernel = kernel;
  }

  claim(): string | undefined {
    return this.kernel.claim(this.id);
  }

  /** Runs steps until the job is terminal, paused for reconciliation, or the step budget is spent. */
  run(jobId: string, maxSteps = 500): StepOutcome[] {
    const log: StepOutcome[] = [];
    for (let index = 0; index < maxSteps; index += 1) {
      const outcome = this.step(jobId);
      log.push(outcome);
      if (outcome.kind === "terminal" || outcome.kind === "reconciling" || outcome.kind === "published" || outcome.kind === "cancelled" || outcome.kind === "failed") break;
    }
    return log;
  }

  step(jobId: string): StepOutcome {
    this.kernel.heartbeat(jobId, this.id);
    const job = this.kernel.getJob(jobId);
    if (isTerminal(job.state)) return { kind: "terminal", state: job.state };
    if (job.state === "needs_attention") return { kind: "reconciling" };
    const plan = this.kernel.getPlan(job.inputs.planHash);

    if (job.cancelRequestedAtMs !== undefined) {
      const inFlight = this.kernel.listCalls(jobId).filter((call) => call.state === "submitted");
      if (inFlight.length === 0) {
        this.kernel.finalizeCancellation(jobId, this.id);
        return { kind: "cancelled" };
      }
      return this.pollCall(inFlight[0]!, plan.units.find((unit) => unit.id === inFlight[0]!.unitId)!, job);
    }

    const stage = this.currentStage(job);
    if (stage === undefined) return { kind: "terminal", state: job.state };
    if (job.stages[stage].status !== "running") this.kernel.startStage(jobId, this.id, stage);

    switch (stage) {
      case "anchor":
      case "motion":
        return this.generationStep(job, stage, plan.units.filter((unit) => unit.kind === stage));
      case "finishing":
        return this.finishingStep(job);
      case "qa":
        return this.qaStep(job);
      case "publish": {
        const output = this.kernel.publishOutput(jobId, this.id);
        return { kind: "published", outputId: output.id };
      }
    }
  }

  private currentStage(job: GenerationJob): StageName | undefined {
    for (const stage of ["anchor", "motion", "finishing", "qa", "publish"] as const) {
      if (job.stages[stage].status !== "succeeded") return stage;
    }
    return undefined;
  }

  private generationStep(job: GenerationJob, stage: StageName, units: PlanUnit[]): StepOutcome {
    const pending = units.find((unit) => job.unitArtifacts[unit.id] === undefined);
    if (pending === undefined) {
      this.kernel.completeStage(job.id, this.id, stage);
      return { kind: "stage_complete", stage };
    }
    const providerClass = providerClassForUnit(pending);
    if (providerClass === "deterministic_finishing") {
      const staged = this.kernel.assets.put(`deterministic:${pending.unitHash}`, { workspaceId: job.workspaceId, prefix: `tmp/${job.id}/${stage}`, provenance: `deterministic unit ${pending.id}` });
      this.kernel.recordUnitArtifact(job.id, this.id, pending.id, staged.hash);
      return { kind: "unit_complete", unitId: pending.id, captured: false };
    }
    const adapter = this.kernel.providers[providerClass];
    if (adapter === undefined) throw new KernelError(`no adapter registered for ${providerClass}`);

    const active = this.kernel.activeCall(job.id, stage, pending.id);
    if (active === undefined) {
      try {
        const call = this.kernel.reserveProviderCall(job.id, this.id, stage, pending.id, providerClass);
        return { kind: "reserved", callId: call.id };
      } catch (error) {
        if (error instanceof LeaseLostError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        this.kernel.failJob(job.id, this.id, reason);
        return { kind: "failed", reason };
      }
    }
    switch (active.state) {
      case "reserved":
        return this.submitCall(active, pending, job);
      case "submitting":
        // A previous worker died between marking the call submitting and persisting the receipt.
        // The provider may have accepted it; never resubmit.
        this.kernel.markUnknown(active.id, this.id, "worker died while submitting; receipt not persisted");
        return { kind: "unknown", callId: active.id };
      case "submitted":
        return this.pollCall(active, pending, job);
      case "unknown":
        return { kind: "reconciling" };
      case "succeeded":
        return { kind: "unit_complete", unitId: pending.id, captured: false };
      case "failed":
        throw new KernelError("failed calls are never active");
    }
  }

  private submitCall(call: ProviderCall, unit: PlanUnit, job: GenerationJob): StepOutcome {
    const adapter = this.kernel.providers[call.providerClass]!;
    const estimate = this.kernel.getEstimate(job.inputs.estimateHash);
    const estimateUnit = estimate.units.find((candidate) => candidate.unitId === unit.id);
    if (estimateUnit === undefined) throw new KernelError(`estimate has no entry for unit ${unit.id}`);
    this.kernel.markSubmitting(call.id, this.id);
    try {
      const receipt = adapter.submit({
        idempotencyKey: call.idempotencyKey,
        providerClass: call.providerClass,
        jobId: job.id,
        unitId: unit.id,
        prompt: unit.prompt,
        strategy: unit.strategy,
        targetDurationMs: unit.targetDurationMs,
        billedDurationMs: estimateUnit.billedDurationMs,
        resolution: estimate.resolution,
        inputAssetHashes: unit.dependsOn.map((dependency) => job.unitArtifacts[dependency]).filter((hash): hash is string => hash !== undefined),
      });
      this.kernel.markSubmitted(call.id, this.id, receipt);
      return { kind: "submitted", callId: call.id };
    } catch (error) {
      if (error instanceof ProviderResponseLostError) {
        this.kernel.markUnknown(call.id, this.id, error.message);
        return { kind: "unknown", callId: call.id };
      }
      if (error instanceof ProviderRejectedError) {
        this.kernel.markFailed(call.id, this.id, error.message, 0);
        return this.afterFailedCall(job, call, error.message);
      }
      throw error;
    }
  }

  private pollCall(call: ProviderCall, unit: PlanUnit, job: GenerationJob): StepOutcome {
    const adapter = this.kernel.providers[call.providerClass]!;
    const status = adapter.status(call.receipt!);
    if (status.state === "pending") return { kind: "waiting", callId: call.id };
    if (status.state === "failed") {
      this.kernel.markFailed(call.id, this.id, status.reason, status.actualCostUsdMicros);
      return this.afterFailedCall(job, call, status.reason);
    }
    const bytes = adapter.fetchResult(call.receipt!);
    if (bytes.byteLength === 0) {
      this.kernel.markFailed(call.id, this.id, "provider returned an empty result", status.actualCostUsdMicros);
      return this.afterFailedCall(job, call, "provider returned an empty result");
    }
    const staged = this.kernel.assets.put(bytes, { workspaceId: job.workspaceId, prefix: `tmp/${job.id}/${call.stage}`, provenance: `provider call ${call.id}` });
    const result = this.kernel.completeProviderCall(call.id, this.id, { actualCostUsdMicros: status.actualCostUsdMicros, resultAssetHash: staged.hash });
    return { kind: "unit_complete", unitId: unit.id, captured: result.captured };
  }

  private afterFailedCall(job: GenerationJob, call: ProviderCall, reason: string): StepOutcome {
    if (job.cancelRequestedAtMs !== undefined) return { kind: "unit_failed", callId: call.id, reason };
    const failures = this.kernel.listCalls(job.id).filter((candidate) => candidate.stage === call.stage && candidate.unitId === call.unitId && candidate.state === "failed").length;
    if (failures >= this.kernel.policy.maxAttempts) {
      const detail = `unit ${call.unitId} failed ${failures} time(s): ${reason}`;
      this.kernel.failJob(job.id, this.id, detail);
      return { kind: "failed", reason: detail };
    }
    return { kind: "unit_failed", callId: call.id, reason };
  }

  private finishingStep(job: GenerationJob): StepOutcome {
    if (job.finishing !== undefined) {
      this.kernel.completeStage(job.id, this.id, "finishing");
      return { kind: "stage_complete", stage: "finishing" };
    }
    const plan = this.kernel.getPlan(job.inputs.planHash);
    const rendered = this.kernel.render.finish({ plan, unitArtifacts: job.unitArtifacts, steps: plan.finishing });
    const tempPrefix = `tmp/${job.id}/finishing`;
    const master = this.kernel.assets.put(rendered.master, { workspaceId: job.workspaceId, prefix: tempPrefix, provenance: "deterministic finishing master" });
    const manifest = this.kernel.assets.put(JSON.stringify(rendered.manifest), { workspaceId: job.workspaceId, prefix: tempPrefix, provenance: "deterministic finishing manifest" });
    this.kernel.recordFinishing(job.id, this.id, { masterAssetHash: master.hash, manifestAssetHash: manifest.hash, tempPrefix });
    return { kind: "rendered", masterAssetHash: master.hash };
  }

  private qaStep(job: GenerationJob): StepOutcome {
    if (job.qaReportId !== undefined) {
      this.kernel.completeStage(job.id, this.id, "qa");
      return { kind: "stage_complete", stage: "qa" };
    }
    const plan = this.kernel.getPlan(job.inputs.planHash);
    const report = this.kernel.qa.score({ jobId: job.id, plan, masterAssetHash: job.finishing!.masterAssetHash, sourceContentSha256: job.inputs.sourceContentSha256 });
    const stored = this.kernel.recordQAReport(job.id, this.id, report);
    return { kind: "scored", reportId: stored.id };
  }
}
