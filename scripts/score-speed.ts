import { readFile } from "node:fs/promises";
import { scoreSpeedBenchmark, type SpeedAcceptanceCriteria, type SpeedBenchmarkCase, type SpeedPrediction } from "../src/speed-benchmark.ts";

const [manifestPath, predictionsPath] = process.argv.slice(2);
if (manifestPath === undefined || predictionsPath === undefined) {
  throw new Error("usage: score-speed.ts MANIFEST PREDICTIONS");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { cases: SpeedBenchmarkCase[] };
const predictionFile = JSON.parse(await readFile(predictionsPath, "utf8")) as { predictions: SpeedPrediction[] };
const criteria: SpeedAcceptanceCriteria = {
  minClassAccuracy: 0.9,
  minCoverage: 0.9,
  minPerClassRecall: 0.8,
  maxRealTimeFalsePositiveRate: 0.1,
  maxMedianMultiplierAbsoluteLog2Error: Math.log2(1.2),
  minVariableSegmentAccuracy: 0.8,
};
console.log(JSON.stringify(scoreSpeedBenchmark(manifest.cases, predictionFile.predictions, criteria), null, 2));
