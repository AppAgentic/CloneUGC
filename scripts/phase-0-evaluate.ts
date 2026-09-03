import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scoreBenchmarkCorpus, type BenchmarkCorpus } from "../src/benchmark.ts";
import {
  comparisonBundleHash,
  scorePhase0Comparisons,
  type Phase0ComparisonBundle,
} from "../src/comparison-benchmark.ts";

function usage(): never {
  throw new Error("usage: phase-0-evaluate.ts <analysis|comparisons> <evidence.json>");
}

const [command, inputPath, ...extra] = process.argv.slice(2);
if ((command !== "analysis" && command !== "comparisons") || inputPath === undefined || extra.length > 0) usage();

const absolutePath = resolve(inputPath);
const input: unknown = JSON.parse(await readFile(absolutePath, "utf8"));
const result = command === "analysis"
  ? { kind: "phase0_analysis", source: absolutePath, score: scoreBenchmarkCorpus(input as BenchmarkCorpus) }
  : {
      kind: "phase0_comparisons",
      source: absolutePath,
      bundleHash: comparisonBundleHash(input as Phase0ComparisonBundle),
      score: scorePhase0Comparisons(input as Phase0ComparisonBundle),
    };

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
