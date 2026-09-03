import { contentHash } from "./canonical.ts";
import type { CompiledPlan } from "./compiler.ts";
import type { AnalysisMode, Milliseconds } from "./contracts.ts";
import { FIDELITY_DIMENSIONS, deriveRevision, type DirectiveKind, type DirectiveTarget, type FidelityDimension, type ReconstructionRevision, type RevisionContext, type TypedDirective } from "./directives.ts";

/**
 * Machine-readable comparative QA.
 *
 * A QA report scores each fidelity dimension, lists timestamped findings with the plan units and
 * finishing steps they affect, and attaches a typed repair directive to every finding so a repair
 * is a revision patch rather than a whole-prompt rewrite.
 */

export type QASeverity = "low" | "medium" | "high" | "critical";

export interface QAFinding {
  id: string;
  dimension: FidelityDimension;
  severity: QASeverity;
  startMs: Milliseconds;
  endMs: Milliseconds;
  referenceObservation: string;
  resultObservation: string;
  affectedUnitIds: string[];
  affectedStepIds: string[];
  repair: {
    kind: DirectiveKind;
    target: DirectiveTarget;
    intent: string;
    value?: string;
  };
  evidenceIds: string[];
}

export interface QAReport {
  schemaVersion: "0.1.0";
  id: string;
  jobId: string;
  planHash: string;
  revisionHash: string;
  sourceContentSha256: string;
  outputAssetHash: string;
  scorer: {
    mode: AnalysisMode;
    exactModel?: string;
    promptVersion: string;
    runId: string;
  };
  /** 0-100 per scored dimension; unscored dimensions are absent, never guessed. */
  scores: Partial<Record<FidelityDimension, number>>;
  overallScore: number;
  rightsRegression: boolean;
  findings: QAFinding[];
  reportHash: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function finalizeQAReport(report: Omit<QAReport, "reportHash">): QAReport {
  const finished = { ...report, reportHash: contentHash(report) };
  assertQAReport(finished);
  return finished;
}

export function assertQAReport(report: QAReport, plan?: CompiledPlan): void {
  assert(report.schemaVersion === "0.1.0", "unsupported QA report schema version");
  const { reportHash, ...core } = report;
  assert(contentHash(core) === reportHash, "QA report hash does not match its content");
  assert(report.scorer.promptVersion.length > 0 && report.scorer.runId.length > 0, "QA report requires scorer prompt version and run id");
  if (report.scorer.exactModel !== undefined) assert(!report.scorer.exactModel.endsWith("-latest"), "moving model aliases are forbidden");
  assert(Number.isFinite(report.overallScore) && report.overallScore >= 0 && report.overallScore <= 100, "overall score must be 0-100");
  for (const [dimension, score] of Object.entries(report.scores)) {
    assert((FIDELITY_DIMENSIONS as readonly string[]).includes(dimension), `unknown scored dimension ${dimension}`);
    assert(Number.isFinite(score) && score >= 0 && score <= 100, `score for ${dimension} must be 0-100`);
  }
  const ids = new Set<string>();
  const unitIds = plan === undefined ? undefined : new Set(plan.units.map((unit) => unit.id));
  const stepIds = plan === undefined ? undefined : new Set(plan.finishing.map((step) => step.id));
  for (const finding of report.findings) {
    assert(!ids.has(finding.id), `duplicate QA finding id ${finding.id}`);
    ids.add(finding.id);
    assert((FIDELITY_DIMENSIONS as readonly string[]).includes(finding.dimension), `finding ${finding.id} has an unknown dimension`);
    assert(["low", "medium", "high", "critical"].includes(finding.severity), `finding ${finding.id} has an invalid severity`);
    assert(Number.isInteger(finding.startMs) && Number.isInteger(finding.endMs) && finding.startMs >= 0 && finding.endMs >= finding.startMs, `finding ${finding.id} has an invalid range`);
    if (plan !== undefined) assert(finding.endMs <= plan.durationMs, `finding ${finding.id} exceeds the plan duration`);
    assert(finding.referenceObservation.length > 0 && finding.resultObservation.length > 0, `finding ${finding.id} requires reference and result observations`);
    assert(finding.affectedUnitIds.length + finding.affectedStepIds.length > 0, `finding ${finding.id} must name affected units or steps`);
    if (unitIds !== undefined) finding.affectedUnitIds.forEach((id) => assert(unitIds.has(id), `finding ${finding.id} names unknown unit ${id}`));
    if (stepIds !== undefined) finding.affectedStepIds.forEach((id) => assert(stepIds.has(id), `finding ${finding.id} names unknown step ${id}`));
    assert(finding.repair.intent.length > 0, `finding ${finding.id} requires a repair intent`);
  }
  if (plan !== undefined) {
    assert(report.planHash === plan.planHash, "QA report is bound to a different plan");
  }
}

/** Orders findings by severity then start time so the cheapest useful repair is easy to pick. */
export function rankFindings(findings: readonly QAFinding[]): QAFinding[] {
  const weight: Record<QASeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...findings].sort((a, b) => weight[a.severity] - weight[b.severity] || a.startMs - b.startMs || a.id.localeCompare(b.id));
}

/**
 * Turns selected QA findings into a child revision. The repair directives are typed, so the
 * invalidation graph can limit regeneration to the units the findings actually touch.
 */
export function proposeRepairRevision(input: {
  report: QAReport;
  parent: ReconstructionRevision;
  findingIds?: readonly string[];
  revisionId: string;
  context?: RevisionContext;
}): { revision: ReconstructionRevision; directives: TypedDirective[] } {
  assertQAReport(input.report);
  const selected = input.findingIds === undefined ? input.report.findings : input.report.findings.filter((finding) => input.findingIds!.includes(finding.id));
  assert(selected.length > 0, "a repair requires at least one QA finding");
  const directives: TypedDirective[] = selected.map((finding) => ({
    id: `repair:${finding.id}`,
    kind: finding.repair.kind,
    dimension: finding.dimension,
    target: finding.repair.target,
    intent: finding.repair.intent,
    ...(finding.repair.value === undefined ? {} : { value: finding.repair.value }),
    evidenceIds: finding.evidenceIds,
  }));
  const existingIds = new Set(directives.map((directive) => directive.id));
  const revision = deriveRevision(input.parent, {
    id: input.revisionId,
    userIntent: `Repair QA findings ${selected.map((finding) => finding.id).join(", ")} from report ${input.report.id}`,
    directives: [...input.parent.directives.filter((directive) => !existingIds.has(directive.id)), ...directives],
  }, input.context);
  return { revision, directives };
}
