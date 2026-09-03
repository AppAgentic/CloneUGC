import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeAssetStore } from "../src/adapters/fake-asset-store.ts";
import { FakeProvider } from "../src/adapters/fake-provider.ts";
import { FakeQAScorer } from "../src/adapters/fake-qa.ts";
import { FakeRender } from "../src/adapters/fake-render.ts";
import { mintApprovalToken } from "../src/authority.ts";
import { compilePlanFromFidelityMap, compilePlanFromFormat, type CompiledPlan } from "../src/compiler.ts";
import type { ReconstructionRevision } from "../src/directives.ts";
import { estimateGeneration, formatUsd, type ProviderCapability } from "../src/estimate.ts";
import { loadFidelityMapFixture, loadFidelityMapFixtures } from "../src/fidelity-map-fixture.ts";
import { compileFormatRecipe, formatRecipeHash, type CompiledFormatPlan, type FormatRecipe } from "../src/format-recipe.ts";
import { JobKernel } from "../src/kernel/kernel.ts";
import { ManualClock, MemoryStore, SequentialIds } from "../src/kernel/store.ts";
import { Worker } from "../src/kernel/worker.ts";

/**
 * Headless kernel CLI. Everything here runs offline against fake adapters; no provider call,
 * network access, or spend can occur. It replaces ad-hoc proof-script orchestration for the
 * compile -> estimate -> authorize -> run -> publish path so evidence is reproducible.
 */

const USAGE = `usage:
  kernel-cli validate-maps [dir]
  kernel-cli compile <fidelity-map-fixture.json> [--intent <text>] [--out <plan.json>]
  kernel-cli replay <replay-fixture.json> <recipe.json>
  kernel-cli simulate <fidelity-map-fixture.json | replay-fixture.json> [--recipe <recipe.json>]`;

const FAKE_CAPABILITIES: ProviderCapability[] = [
  { providerClass: "image_anchor", adapterId: "fake-image", supportedStrategies: ["generate", "edit_subject_anchor", "edit_previous_setup"], minDurationMs: 0, maxDurationMs: 0, durationStepMs: 0, supportedResolutions: ["480p", "720p"], pricing: { fixedUsdMicros: 90_000, perSecondUsdMicros: {} }, supportsCancel: false },
  { providerClass: "video_motion", adapterId: "fake-video", supportedStrategies: ["image_to_video", "reference_to_video", "text_to_video"], minDurationMs: 5_000, maxDurationMs: 15_000, durationStepMs: 1_000, supportedResolutions: ["480p", "720p"], pricing: { fixedUsdMicros: 0, perSecondUsdMicros: { "480p": 10_000, "720p": 30_000 } }, supportsCancel: true },
];
const POLICY = { resolution: "480p" as const, contingencyBasisPoints: 1_000, ttlMs: 3_600_000 };

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function print(value: unknown): void {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

function compileFromMapFixture(path: string, intent: string): { plan: CompiledPlan; revision: ReconstructionRevision } {
  const fixture = loadFidelityMapFixture(resolve(path));
  const revision: ReconstructionRevision = { schemaVersion: "0.1.0", id: `rev-${fixture.id}`, reconstructionId: `recon-${fixture.id}`, revision: 1, fidelityMapHash: fixture.fidelityMapHash, sourceContentSha256: fixture.map.sourceContentSha256, userIntent: intent, directives: [] };
  return { plan: compilePlanFromFidelityMap({ map: fixture.map, evidence: fixture.evidence, revision }), revision };
}

function compileFromReplay(path: string, recipePath: string): { plan: CompiledPlan; revision: ReconstructionRevision; formatPlan: CompiledFormatPlan; historical: CompiledFormatPlan } {
  const historical = JSON.parse(readFileSync(resolve(path), "utf8")) as CompiledFormatPlan;
  const recipe = JSON.parse(readFileSync(resolve(recipePath), "utf8")) as FormatRecipe;
  if (formatRecipeHash(recipe) !== historical.recipeHash) throw new Error(`recipe hash ${formatRecipeHash(recipe)} does not match the replay's ${historical.recipeHash}`);
  const formatPlan = compileFormatRecipe(recipe, { userPrompt: historical.userPrompt, values: historical.resolvedValues });
  const sourceContentSha256 = "0".repeat(64);
  const revision: ReconstructionRevision = { schemaVersion: "0.1.0", id: `rev-${historical.recipeId}`, reconstructionId: `recon-${historical.recipeId}`, revision: 1, formatRecipeHash: historical.recipeHash, sourceContentSha256, userIntent: historical.userPrompt, directives: [] };
  return { plan: compilePlanFromFormat({ formatPlan, revision, sourceContentSha256 }), revision, formatPlan, historical };
}

function simulate(plan: CompiledPlan, revision: ReconstructionRevision): void {
  const store = new MemoryStore();
  const clock = new ManualClock(1_000);
  const kernel = new JobKernel({
    store,
    clock,
    ids: new SequentialIds(),
    providers: { image_anchor: new FakeProvider(FAKE_CAPABILITIES[0]!, clock), video_motion: new FakeProvider(FAKE_CAPABILITIES[1]!, clock) },
    assets: new FakeAssetStore(),
    render: new FakeRender(),
    qa: new FakeQAScorer(),
    policy: { leaseMs: 30_000, maxAttempts: 2, resolution: "480p" },
  });
  const estimate = estimateGeneration({ plan, capabilities: FAKE_CAPABILITIES, policy: POLICY, nowMs: clock.nowMs() });
  kernel.registerRightsRecord({ schemaVersion: "0.1.0", id: "rights-sim", workspaceId: "workspace-sim", sourceContentSha256: plan.sourceContentSha256, status: "owned", authorizedElements: [], attesterId: "operator", attestedAtMs: 0 });
  const binding = { sourceContentSha256: plan.sourceContentSha256, revisionHash: plan.revisionHash, planHash: plan.planHash };
  const rightsToken = mintApprovalToken({ id: "rights-approval-sim", authority: "rights", workspaceId: "workspace-sim", subjectId: "operator", binding, issuedAtMs: clock.nowMs(), ttlMs: 3_600_000 });
  const spendToken = mintApprovalToken({ id: "spend-approval-sim", authority: "spend", workspaceId: "workspace-sim", subjectId: "operator", binding: { ...binding, estimateHash: estimate.estimateHash }, ceilingUsdMicros: estimate.maxCostUsdMicros, issuedAtMs: clock.nowMs(), ttlMs: 3_600_000 });
  kernel.registerApprovalToken(rightsToken);
  kernel.registerApprovalToken(spendToken);
  const { job } = kernel.createJob({ workspaceId: "workspace-sim", actorId: "operator", idempotencyKey: "sim", revision, plan, estimate, rightsRecordId: "rights-sim", rightsTokenId: rightsToken.id, spendTokenId: spendToken.id });
  kernel.dispatchOutbox();
  const worker = new Worker("worker-sim", kernel);
  worker.claim();
  const log = worker.run(job.id);
  const finished = kernel.getJob(job.id);
  print({
    jobId: job.id,
    planHash: plan.planHash,
    estimate: { max: formatUsd(estimate.maxCostUsdMicros), subtotal: formatUsd(estimate.subtotalUsdMicros), units: estimate.units.length },
    state: finished.state,
    steps: log.length,
    providerCalls: kernel.listCalls(job.id).map((call) => `${call.unitId}:${call.state}`),
    ledger: kernel.ledgerSummary(job.id),
    masterAssetHash: finished.finishing?.masterAssetHash,
    outputId: finished.outputId,
  });
}

const command = process.argv[2];
switch (command) {
  case "validate-maps": {
    const directory = process.argv[3] ?? "fixtures/fidelity-maps";
    const fixtures = loadFidelityMapFixtures(new URL(`${resolve(directory)}/`, "file://"));
    print(fixtures.map((fixture) => ({ id: fixture.id, recipeId: fixture.recipeId, family: fixture.family, durationMs: fixture.map.durationMs, segments: fixture.map.editSegments.length, units: fixture.map.creatorWorkflow.generationUnits.length, fidelityMapHash: fixture.fidelityMapHash })));
    break;
  }
  case "compile": {
    const path = process.argv[3];
    if (path === undefined) throw new Error(USAGE);
    const { plan } = compileFromMapFixture(path, flag("--intent") ?? "Recreate the reference with a fictional subject.");
    const out = flag("--out");
    if (out === undefined) print(plan);
    else {
      writeFileSync(resolve(out), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
      print(plan.planHash);
    }
    break;
  }
  case "replay": {
    const [path, recipePath] = [process.argv[3], process.argv[4]];
    if (path === undefined || recipePath === undefined) throw new Error(USAGE);
    const { plan, formatPlan, historical } = compileFromReplay(path, recipePath);
    const match = formatPlan.planHash === historical.planHash;
    print({ recipeHash: historical.recipeHash, historicalPlanHash: historical.planHash, replayedPlanHash: formatPlan.planHash, match, kernelPlanHash: plan.planHash });
    if (!match) process.exit(1);
    break;
  }
  case "simulate": {
    const path = process.argv[3];
    if (path === undefined) throw new Error(USAGE);
    const recipePath = flag("--recipe");
    const compiled = recipePath === undefined ? compileFromMapFixture(path, flag("--intent") ?? "Recreate the reference with a fictional subject.") : compileFromReplay(path, recipePath);
    simulate(compiled.plan, compiled.revision);
    break;
  }
  default:
    throw new Error(USAGE);
}
