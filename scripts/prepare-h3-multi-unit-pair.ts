import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contentHash } from "../src/canonical.ts";
import { compilePlanFromFidelityMap } from "../src/compiler.ts";
import { fidelityMapHash, type EvidenceClaim, type FidelityMap } from "../src/contracts.ts";
import type { TypedDirective } from "../src/directives.ts";

interface FidelityFixture {
  map: FidelityMap;
  evidence: EvidenceClaim[];
  fidelityMapHash: string;
}

interface ControlState {
  shots: Record<string, { prompt: string }>;
}

interface UnitInput {
  id: string;
  imagePath: string;
  imageSha256: string;
  controlStateKey: string;
  imageProvenance: string;
  identityVisibility?: "visible" | "fully_occluded";
  identityAnchor?: string;
  endImagePath?: string;
  endImageSha256?: string;
  endImageProvenance?: string;
  endIdentityVisibility?: "visible" | "fully_occluded";
}

interface InputConfig {
  schemaVersion: "0.1.0";
  controlStateSha256: string;
  units: UnitInput[];
  directives?: TypedDirective[];
}

export function providerDurationSeconds(targetDurationMs: number): 5 | 10 {
  if (!Number.isInteger(targetDurationMs) || targetDurationMs <= 0) fail("target duration must be a positive integer");
  if (targetDurationMs <= 5_500) return 5;
  if (targetDurationMs <= 11_000) return 10;
  fail("target duration exceeds the supported near-real-time H3 window");
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function assertControlStateHash(expected: string, actual: string): void {
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) {
    fail("control state hash does not match the approved creative state");
  }
}

export function assertIdentityAnchor(prompt: string, visibility: UnitInput["identityVisibility"], anchor?: string): void {
  if (visibility !== "fully_occluded") return;
  if (!anchor?.trim()) fail("fully occluded setup frames require an explicit identity anchor");
  const promptTerms = new Set(prompt.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []);
  const anchorTerms = anchor.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (anchorTerms.some((term) => !promptTerms.has(term))) {
    fail(`fully occluded setup frame prompt is missing identity anchor: ${anchor}`);
  }
}

export function assertIdentityEndpoint(
  startVisibility: UnitInput["identityVisibility"],
  endVisibility: UnitInput["endIdentityVisibility"],
  hasEndImage: boolean,
  unitId = "unit",
): void {
  if (startVisibility === "fully_occluded" && (!hasEndImage || endVisibility !== "visible")) {
    fail(`${unitId} fully occluded start requires a visible endpoint identity anchor`);
  }
}

export function providerPromptExclusions(constraints: readonly string[]): string {
  const joined = constraints.join(" ").toLocaleLowerCase();
  const exclusions = [
    joined.includes("identity") ? "do not copy the source identity or change identity mid-take" : "",
    joined.includes("logo") ? "no logos or watermarks" : "",
    joined.includes("dialogue") || joined.includes("music") ? "no generated dialogue or music" : "",
    joined.includes("caption") || joined.includes("text") ? "no generated text" : "",
  ].filter((value) => value.length > 0);
  return exclusions.length === 0 ? "" : `Exclusions: ${exclusions.join("; ")}.`;
}

function fail(message: string): never {
  throw new Error(message);
}

function main(): void {
  const [fixtureArg, stateArg, configArg, outputArg] = process.argv.slice(2);
  if (!fixtureArg || !stateArg || !configArg || !outputArg) {
    fail("usage: prepare-h3-multi-unit-pair.ts <fidelity-map> <control-state> <input-config> <output-dir>");
  }
  const fixturePath = resolve(fixtureArg);
  const statePath = resolve(stateArg);
  const configPath = resolve(configArg);
  const outputDir = resolve(outputArg);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FidelityFixture;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as ControlState;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as InputConfig;
  if (config.schemaVersion !== "0.1.0") fail("unsupported input config schema");
  const controlStateSha256 = fileSha256(statePath);
  assertControlStateHash(config.controlStateSha256, controlStateSha256);
  const mapHash = fidelityMapHash(fixture.map);
  if (mapHash !== fixture.fidelityMapHash) fail("fixture Fidelity Map hash mismatch");
  const revision = {
    schemaVersion: "0.1.0" as const,
    id: `benchmark-${fixture.map.id}`,
    reconstructionId: `benchmark-${fixture.map.sourceAssetId}`,
    revision: 1,
    fidelityMapHash: mapHash,
    sourceContentSha256: fixture.map.sourceContentSha256,
    userIntent: fixture.map.requestedChange,
    directives: config.directives ?? [],
  };
  const plan = compilePlanFromFidelityMap({ map: fixture.map, evidence: fixture.evidence, revision });
  const generative = plan.units.filter((unit) => unit.kind === "motion" && unit.strategy !== "deterministic_source");
  if (generative.length !== config.units.length) fail("input config does not cover every generative plan unit");
  mkdirSync(outputDir, { recursive: true });
  const manifestUnits = generative.map((motion, index) => {
    const input = config.units[index];
    if (!input || input.id !== motion.id.replace(/:motion$/, "")) fail(`input unit order mismatch at ${motion.id}`);
    const control = state.shots[input.controlStateKey]?.prompt;
    if (!control) fail(`control prompt ${input.controlStateKey} is missing`);
    const compiler = [
      motion.prompt,
      providerPromptExclusions(motion.constraints),
    ].filter((part) => part.length > 0).join(" ");
    assertIdentityAnchor(control, input.identityVisibility, input.identityAnchor);
    assertIdentityAnchor(compiler, input.identityVisibility, input.identityAnchor);
    const requiresEndImage = motion.dependsOn.some((id) => id.endsWith(":end-anchor"));
    if (requiresEndImage !== Boolean(input.endImagePath && input.endImageSha256 && input.endImageProvenance)) {
      fail(`unit ${input.id} endpoint image configuration does not match the compiled plan`);
    }
    const endImagePath = input.endImagePath ? resolve(dirname(configPath), input.endImagePath) : undefined;
    if (endImagePath && fileSha256(endImagePath) !== input.endImageSha256) fail(`unit ${input.id} endpoint image hash mismatch`);
    assertIdentityEndpoint(input.identityVisibility, input.endIdentityVisibility, Boolean(endImagePath), `unit ${input.id}`);
    const unitDir = resolve(outputDir, input.id);
    mkdirSync(unitDir, { recursive: true });
    const controlPath = resolve(unitDir, "control.txt");
    const compilerPath = resolve(unitDir, "compiler.txt");
    writeFileSync(controlPath, `${control}\n`);
    writeFileSync(compilerPath, `${compiler}\n`);
    return {
      id: input.id,
      imagePath: resolve(dirname(configPath), input.imagePath),
      imageSha256: input.imageSha256,
      imageProvenance: input.imageProvenance,
      endImagePath,
      endImageSha256: input.endImageSha256,
      endImageProvenance: input.endImageProvenance,
      endIdentityVisibility: input.endIdentityVisibility,
      identityVisibility: input.identityVisibility ?? "visible",
      identityAnchor: input.identityAnchor,
      controlPromptPath: controlPath,
      compilerPromptPath: compilerPath,
      targetDurationMs: motion.targetDurationMs,
      durationSeconds: providerDurationSeconds(motion.targetDurationMs),
      maxAbsoluteRetimePercent: 10,
    };
  });
  const manifest = {
    schemaVersion: "0.1.0",
    controlStatePath: statePath,
    controlStateSha256,
    units: manifestUnits,
  };
  writeFileSync(resolve(outputDir, "unit-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const publicSummary = {
    schemaVersion: "0.1.0",
    sourceAssetId: fixture.map.sourceAssetId,
    sourceContentSha256: fixture.map.sourceContentSha256,
    fidelityMapSha256: mapHash,
    compilerPlanSha256: plan.planHash,
    unitCount: manifestUnits.length,
    billedSecondsPerLane: manifestUnits.reduce((sum, unit) => sum + unit.durationSeconds, 0),
    configSha256: contentHash(config),
    controlStatePath: statePath,
    controlStateSha256,
  };
  writeFileSync(resolve(outputDir, "preparation-summary.json"), `${JSON.stringify(publicSummary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(publicSummary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
