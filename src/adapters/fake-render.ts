import { createHash } from "node:crypto";
import type { RenderAdapter, RenderInput, RenderResult } from "../kernel/adapters.ts";

/**
 * Deterministic finishing: the master's bytes are a pure function of the plan hash, the accepted
 * unit artifacts, and the finishing steps, so replaying the same inputs reproduces the same hash.
 */
export class FakeRender implements RenderAdapter {
  finish(input: RenderInput): RenderResult {
    const unitArtifacts = Object.fromEntries(Object.entries(input.unitArtifacts).sort(([a], [b]) => a.localeCompare(b)));
    const steps = input.steps.map((step) => ({
      stepId: step.id,
      stepHash: step.stepHash,
      inputHashes: step.dependsOn.map((dependency) => unitArtifacts[dependency] ?? dependency).sort(),
    }));
    for (const unit of input.plan.units) {
      if (unitArtifacts[unit.id] === undefined) throw new Error(`finishing requires an accepted artifact for ${unit.id}`);
    }
    const digest = createHash("sha256").update(JSON.stringify({ planHash: input.plan.planHash, unitArtifacts, steps })).digest("hex");
    return { master: Buffer.from(`master:${digest}`), manifest: { planHash: input.plan.planHash, unitArtifacts, steps } };
  }
}
