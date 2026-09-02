import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scoreBenchmarkCase, type BenchmarkCase } from "../src/benchmark.ts";

const inputPath = process.argv[2];
if (inputPath === undefined) {
  throw new Error("usage: score-analysis <benchmark-case.json>");
}

const parsed = JSON.parse(await readFile(resolve(inputPath), "utf8")) as BenchmarkCase;
const result = scoreBenchmarkCase(parsed);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
