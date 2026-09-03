import type { QAScorer } from "../kernel/adapters.ts";
import type { QAFinding, QAReport } from "../qa.ts";

/** A deterministic scorer that returns scripted findings so repair flows can be tested offline. */
export class FakeQAScorer implements QAScorer {
  public findings: QAFinding[] = [];
  public overallScore = 80;
  public rightsRegression = false;
  private runs = 0;

  score(input: { jobId: string; plan: { planHash: string; revisionHash: string }; masterAssetHash: string; sourceContentSha256: string }): Omit<QAReport, "reportHash"> {
    this.runs += 1;
    return {
      schemaVersion: "0.1.0",
      id: `qa_${input.jobId}_${this.runs}`,
      jobId: input.jobId,
      planHash: input.plan.planHash,
      revisionHash: input.plan.revisionHash,
      sourceContentSha256: input.sourceContentSha256,
      outputAssetHash: input.masterAssetHash,
      scorer: { mode: "deterministic", promptVersion: "fake-qa-v1", runId: `fake-qa-run-${this.runs}` },
      scores: { timing: 90, camera: 85, wardrobe: this.findings.some((finding) => finding.dimension === "wardrobe") ? 40 : 90 },
      overallScore: this.overallScore,
      rightsRegression: this.rightsRegression,
      findings: this.findings.map((finding) => structuredClone(finding)),
    };
  }
}
