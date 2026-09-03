import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
}

interface InputConfig {
  schemaVersion: "0.1.0";
  units: UnitInput[];
  directives?: TypedDirective[];
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
      `Preserve: ${motion.preserve.join(", ")}.`,
      `Change: ${motion.change.join(", ")}.`,
      `Constraints: ${motion.constraints.join("; ")}.`,
    ].join(" ");
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
      controlPromptPath: controlPath,
      compilerPromptPath: compilerPath,
      durationSeconds: motion.targetDurationMs <= 5_000 ? 5 : 10,
    };
  });
  const manifest = { schemaVersion: "0.1.0", units: manifestUnits };
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
  };
  writeFileSync(resolve(outputDir, "preparation-summary.json"), `${JSON.stringify(publicSummary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(publicSummary, null, 2)}\n`);
}

main();
