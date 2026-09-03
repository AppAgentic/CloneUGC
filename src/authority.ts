import { contentHash } from "./canonical.ts";
import { assertCompiledPlan, type CompiledPlan } from "./compiler.ts";
import { generationEligibility, type EvidenceClaim, type FidelityMap, type RightsStatus, type RiskConstraint } from "./contracts.ts";
import { assertReconstructionRevision, revisionHash, type ReconstructionRevision } from "./directives.ts";
import { assertGenerationEstimate, type GenerationEstimate } from "./estimate.ts";

/**
 * Rights and spend authority.
 *
 * Authority records are server-minted, expiring, and bound to exact content and spec hashes.
 * Agents cannot mint them, broaden their scope, raise a ceiling, or reuse them against a changed
 * reconstruction. The kernel consumes single-use tokens inside the job-creation transaction.
 */

export type ProtectedElementKind = RiskConstraint["kind"];
export type AuthorityType = "rights" | "spend" | "export";

export interface RightsRecord {
  schemaVersion: "0.1.0";
  id: string;
  workspaceId: string;
  sourceContentSha256: string;
  status: Exclude<RightsStatus, "unverified">;
  /** Protected elements the attester explicitly authorizes for transfer. Everything else stays excluded. */
  authorizedElements: ProtectedElementKind[];
  attesterId: string;
  attestedAtMs: number;
  expiresAtMs?: number;
  revokedAtMs?: number;
}

export interface ApprovalBinding {
  sourceContentSha256: string;
  revisionHash: string;
  planHash: string;
  fidelityMapHash?: string;
  formatRecipeHash?: string;
  estimateHash?: string;
  outputHash?: string;
}

export interface ApprovalToken {
  schemaVersion: "0.1.0";
  id: string;
  authority: AuthorityType;
  workspaceId: string;
  subjectId: string;
  binding: ApprovalBinding;
  ceilingUsdMicros?: number;
  issuedAtMs: number;
  expiresAtMs: number;
  singleUse: true;
  consumedByJobId?: string;
  consumedAtMs?: number;
  /** Hash of the immutable fields, so a consumed token cannot be silently re-bound. */
  tokenHash: string;
}

export interface AuthorityCheck {
  eligible: boolean;
  reasons: string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHash(value: string, field: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${field} must be a lowercase SHA-256 hash`);
}

export function assertRightsRecord(record: RightsRecord): void {
  assert(record.schemaVersion === "0.1.0", "unsupported rights record schema version");
  assert(record.id.length > 0 && record.workspaceId.length > 0 && record.attesterId.length > 0, "rights record identity fields are required");
  assertHash(record.sourceContentSha256, "sourceContentSha256");
  assert(["owned", "licensed", "other_valid_right"].includes(record.status), "rights record must attest a valid right");
  assert(record.attestedAtMs >= 0, "attestedAtMs must be non-negative");
  if (record.expiresAtMs !== undefined) assert(record.expiresAtMs > record.attestedAtMs, "rights record must expire after attestation");
  const kinds: ProtectedElementKind[] = ["identity", "voice", "logo", "watermark", "minor", "music", "dialogue", "bystander", "other"];
  record.authorizedElements.forEach((kind) => assert(kinds.includes(kind), `unknown protected element ${kind}`));
  assert(!record.authorizedElements.includes("minor"), "a rights record can never authorize transferring a minor's likeness");
}

export function rightsRecordActive(record: RightsRecord, nowMs: number): boolean {
  if (record.revokedAtMs !== undefined && record.revokedAtMs <= nowMs) return false;
  if (record.expiresAtMs !== undefined && record.expiresAtMs <= nowMs) return false;
  return true;
}

function tokenCore(token: Omit<ApprovalToken, "tokenHash" | "consumedByJobId" | "consumedAtMs">): unknown {
  return {
    schemaVersion: token.schemaVersion,
    id: token.id,
    authority: token.authority,
    workspaceId: token.workspaceId,
    subjectId: token.subjectId,
    binding: token.binding,
    ceilingUsdMicros: token.ceilingUsdMicros ?? null,
    issuedAtMs: token.issuedAtMs,
    expiresAtMs: token.expiresAtMs,
    singleUse: token.singleUse,
  };
}

/** Mints a server-side approval token. Callers are the estimate/authority service, never an agent. */
export function mintApprovalToken(input: {
  id: string;
  authority: AuthorityType;
  workspaceId: string;
  subjectId: string;
  binding: ApprovalBinding;
  ceilingUsdMicros?: number;
  issuedAtMs: number;
  ttlMs: number;
}): ApprovalToken {
  assert(input.ttlMs > 0, "approval ttl must be positive");
  assertHash(input.binding.sourceContentSha256, "binding.sourceContentSha256");
  assertHash(input.binding.revisionHash, "binding.revisionHash");
  assertHash(input.binding.planHash, "binding.planHash");
  if (input.binding.estimateHash !== undefined) assertHash(input.binding.estimateHash, "binding.estimateHash");
  if (input.binding.outputHash !== undefined) assertHash(input.binding.outputHash, "binding.outputHash");
  if (input.authority === "spend") {
    assert(input.binding.estimateHash !== undefined, "spend authority must bind an estimate hash");
    assert(input.ceilingUsdMicros !== undefined && Number.isInteger(input.ceilingUsdMicros) && input.ceilingUsdMicros >= 0, "spend authority requires an integer ceiling");
  }
  if (input.authority === "export") assert(input.binding.outputHash !== undefined, "export authority must bind an output hash");
  const core = {
    schemaVersion: "0.1.0" as const,
    id: input.id,
    authority: input.authority,
    workspaceId: input.workspaceId,
    subjectId: input.subjectId,
    binding: input.binding,
    ...(input.ceilingUsdMicros === undefined ? {} : { ceilingUsdMicros: input.ceilingUsdMicros }),
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.issuedAtMs + input.ttlMs,
    singleUse: true as const,
  };
  return { ...core, tokenHash: contentHash(tokenCore(core)) };
}

export function assertApprovalToken(token: ApprovalToken): void {
  assert(token.schemaVersion === "0.1.0", "unsupported approval token schema version");
  assert(token.singleUse === true, "approval tokens must be single use");
  assert(contentHash(tokenCore(token)) === token.tokenHash, "approval token hash does not match its immutable fields");
  assert(token.expiresAtMs > token.issuedAtMs, "approval token must expire after issue");
}

function tokenUsable(token: ApprovalToken, nowMs: number, workspaceId: string): string | undefined {
  try {
    assertApprovalToken(token);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid approval token";
  }
  if (token.workspaceId !== workspaceId) return `${token.authority} approval belongs to another workspace`;
  if (token.consumedByJobId !== undefined) return `${token.authority} approval was already consumed by job ${token.consumedByJobId}`;
  if (token.expiresAtMs <= nowMs) return `${token.authority} approval has expired`;
  return undefined;
}

function bindingMatches(binding: ApprovalBinding, plan: CompiledPlan, estimate?: GenerationEstimate): string[] {
  const reasons: string[] = [];
  if (binding.sourceContentSha256 !== plan.sourceContentSha256) reasons.push("approval is bound to a different source");
  if (binding.revisionHash !== plan.revisionHash) reasons.push("approval is bound to a different reconstruction revision");
  if (binding.planHash !== plan.planHash) reasons.push("approval is bound to a different compiled plan");
  if (binding.fidelityMapHash !== undefined && binding.fidelityMapHash !== plan.lineage.fidelityMapHash) reasons.push("approval is bound to a different Fidelity Map");
  if (binding.formatRecipeHash !== undefined && binding.formatRecipeHash !== plan.lineage.formatRecipeHash) reasons.push("approval is bound to a different Format Recipe");
  if (estimate !== undefined && binding.estimateHash !== undefined && binding.estimateHash !== estimate.estimateHash) reasons.push("approval is bound to a different estimate");
  return reasons;
}

/**
 * The complete generation eligibility check: Fidelity Map validity, rights attestation coverage,
 * revision/plan/estimate hash binding, estimate freshness, and rights plus spend approval tokens.
 */
export function checkGenerationAuthority(input: {
  workspaceId: string;
  nowMs: number;
  map?: FidelityMap;
  evidence?: readonly EvidenceClaim[];
  revision: ReconstructionRevision;
  plan: CompiledPlan;
  estimate: GenerationEstimate;
  rights?: RightsRecord;
  rightsToken?: ApprovalToken;
  spendToken?: ApprovalToken;
}): AuthorityCheck {
  const reasons: string[] = [];
  const { plan, estimate, revision } = input;

  try {
    assertReconstructionRevision(revision);
    assertCompiledPlan(plan);
    assertGenerationEstimate(estimate);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "invalid reconstruction inputs");
    return { eligible: false, reasons };
  }
  if (revisionHash(revision) !== plan.revisionHash) reasons.push("compiled plan does not descend from the given revision");
  if (estimate.planHash !== plan.planHash) reasons.push("estimate is bound to a different compiled plan");
  if (estimate.revisionHash !== plan.revisionHash) reasons.push("estimate is bound to a different revision");
  if (estimate.expiresAtMs <= input.nowMs) reasons.push("estimate has expired");

  if (input.map !== undefined) {
    const eligibility = generationEligibility(input.map, input.evidence ?? []);
    for (const reason of eligibility.reasons) if (reason !== "rights attestation is required") reasons.push(reason);
    if (plan.lineage.fidelityMapHash !== undefined && input.map.sourceContentSha256 !== plan.sourceContentSha256) reasons.push("Fidelity Map source does not match the plan");
  }

  if (input.rights === undefined) {
    reasons.push("rights attestation is required");
  } else {
    try {
      assertRightsRecord(input.rights);
      if (input.rights.workspaceId !== input.workspaceId) reasons.push("rights record belongs to another workspace");
      if (input.rights.sourceContentSha256 !== plan.sourceContentSha256) reasons.push("rights record covers a different source");
      if (!rightsRecordActive(input.rights, input.nowMs)) reasons.push("rights record is expired or revoked");
      if (input.map !== undefined) {
        for (const risk of input.map.risks) {
          if (risk.disposition === "authorized" && !input.rights.authorizedElements.includes(risk.kind)) {
            reasons.push(`Fidelity Map authorizes ${risk.kind} transfer but the rights record does not`);
          }
        }
      }
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "invalid rights record");
    }
  }

  if (input.rightsToken === undefined) {
    reasons.push("rights approval is required");
  } else {
    const problem = tokenUsable(input.rightsToken, input.nowMs, input.workspaceId);
    if (problem !== undefined) reasons.push(problem);
    if (input.rightsToken.authority !== "rights") reasons.push("rights approval has the wrong authority type");
    reasons.push(...bindingMatches(input.rightsToken.binding, plan));
  }

  if (input.spendToken === undefined) {
    reasons.push("spend approval is required");
  } else {
    const problem = tokenUsable(input.spendToken, input.nowMs, input.workspaceId);
    if (problem !== undefined) reasons.push(problem);
    if (input.spendToken.authority !== "spend") reasons.push("spend approval has the wrong authority type");
    reasons.push(...bindingMatches(input.spendToken.binding, plan, estimate));
    if (input.spendToken.binding.estimateHash === undefined) reasons.push("spend approval must bind an estimate");
    if (input.spendToken.ceilingUsdMicros === undefined || input.spendToken.ceilingUsdMicros < estimate.maxCostUsdMicros) {
      reasons.push("spend approval ceiling is below the estimate maximum");
    }
  }

  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}
