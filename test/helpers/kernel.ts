import { FakeAssetStore } from "../../src/adapters/fake-asset-store.ts";
import { mintApprovalToken } from "../../src/authority.ts";
import { FakeProvider } from "../../src/adapters/fake-provider.ts";
import { FakeQAScorer } from "../../src/adapters/fake-qa.ts";
import { FakeRender } from "../../src/adapters/fake-render.ts";
import type { CompiledPlan } from "../../src/compiler.ts";
import type { ReconstructionRevision } from "../../src/directives.ts";
import type { GenerationEstimate } from "../../src/estimate.ts";
import { JobKernel, type CreateJobInput } from "../../src/kernel/kernel.ts";
import { ManualClock, MemoryStore, SequentialIds } from "../../src/kernel/store.ts";
import { Worker } from "../../src/kernel/worker.ts";
import { WORKSPACE, sampleCapabilities, sampleEstimate, sampleEvidence, sampleMap, samplePlan, sampleRevision, sampleRights, sampleTokens } from "./sample.ts";

export interface Harness {
  store: MemoryStore;
  clock: ManualClock;
  kernel: JobKernel;
  image: FakeProvider;
  video: FakeProvider;
  assets: FakeAssetStore;
  render: FakeRender;
  qa: FakeQAScorer;
  worker(id: string): Worker;
  /** Registers rights, approvals, and plan, then creates a queued job. */
  createJob(options?: { revision?: ReconstructionRevision; plan?: CompiledPlan; estimate?: GenerationEstimate; reusedUnitArtifacts?: Record<string, string>; idempotencyKey?: string; tokenSuffix?: string }): { jobId: string; plan: CompiledPlan; estimate: GenerationEstimate; input: CreateJobInput };
}

export function createHarness(options: { leaseMs?: number; maxAttempts?: number; requiredProductionWorkflow?: boolean } = {}): Harness {
  const store = new MemoryStore();
  const clock = new ManualClock(10_000);
  const image = new FakeProvider(sampleCapabilities[0]!, clock);
  const video = new FakeProvider(sampleCapabilities[1]!, clock);
  const assets = new FakeAssetStore();
  const render = new FakeRender();
  const qa = new FakeQAScorer();
  const kernel = new JobKernel({
    store,
    clock,
    ids: new SequentialIds(),
    providers: { image_anchor: image, video_motion: video },
    assets,
    render,
    qa,
    policy: {
      leaseMs: options.leaseMs ?? 5_000,
      maxAttempts: options.maxAttempts ?? 2,
      resolution: "480p",
      ...(options.requiredProductionWorkflow ? { requiredWorkflowId: "setup-frame-image-to-video-per-take-v1" as const } : {}),
    },
  });
  kernel.registerRightsRecord(sampleRights());
  let tokenCounter = 0;
  return {
    store,
    clock,
    kernel,
    image,
    video,
    assets,
    render,
    qa,
    worker: (id) => new Worker(id, kernel),
    createJob: (jobOptions = {}) => {
      tokenCounter += 1;
      const revision = jobOptions.revision ?? sampleRevision();
      const plan = jobOptions.plan ?? samplePlan(revision);
      const estimate = jobOptions.estimate ?? sampleEstimate(plan, clock.nowMs(), Object.keys(jobOptions.reusedUnitArtifacts ?? {}));
      const tokens = sampleTokens(plan, estimate, clock.nowMs());
      const suffix = jobOptions.tokenSuffix ?? String(tokenCounter);
      const rightsToken = { ...tokens.rightsToken, id: `approval-rights-${suffix}` };
      const spendToken = { ...tokens.spendToken, id: `approval-spend-${suffix}` };
      // Re-mint with the unique ids so the token hash covers the id.
      const mintedRights = mintApprovalToken({ id: rightsToken.id, authority: "rights", workspaceId: WORKSPACE, subjectId: "user-1", binding: rightsToken.binding, issuedAtMs: rightsToken.issuedAtMs, ttlMs: rightsToken.expiresAtMs - rightsToken.issuedAtMs });
      const mintedSpend = mintApprovalToken({ id: spendToken.id, authority: "spend", workspaceId: WORKSPACE, subjectId: "user-1", binding: spendToken.binding, ceilingUsdMicros: spendToken.ceilingUsdMicros!, issuedAtMs: spendToken.issuedAtMs, ttlMs: spendToken.expiresAtMs - spendToken.issuedAtMs });
      kernel.registerApprovalToken(mintedRights);
      kernel.registerApprovalToken(mintedSpend);
      const input: CreateJobInput = {
        workspaceId: WORKSPACE,
        actorId: "user-1",
        idempotencyKey: jobOptions.idempotencyKey ?? `idem-${tokenCounter}`,
        map: sampleMap,
        evidence: sampleEvidence,
        revision,
        plan,
        estimate,
        rightsRecordId: "rights-1",
        rightsTokenId: mintedRights.id,
        spendTokenId: mintedSpend.id,
        ...(jobOptions.reusedUnitArtifacts === undefined ? {} : { reusedUnitArtifacts: jobOptions.reusedUnitArtifacts }),
      };
      const { job } = kernel.createJob(input);
      return { jobId: job.id, plan, estimate, input };
    },
  };
}

/** Runs dispatch, claim, and the worker loop until the job settles. */
export function runToSettled(harness: Harness, jobId: string, workerId = "worker-a"): ReturnType<Worker["run"]> {
  harness.kernel.dispatchOutbox();
  const worker = harness.worker(workerId);
  const claimed = worker.claim();
  if (claimed !== jobId) throw new Error(`worker ${workerId} claimed ${claimed ?? "nothing"} instead of ${jobId}`);
  return worker.run(jobId);
}
