import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileFormatRecipe, type FormatInstantiation, type FormatRecipe } from "../src/format-recipe.ts";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const recipePath = process.argv[2];
const userPrompt = valueAfter("--prompt");
const valuesJson = valueAfter("--values") ?? "{}";
const outputPath = valueAfter("--out");

if (recipePath === undefined || userPrompt === undefined) {
  throw new Error("usage: compile-format.ts <recipe.json> --prompt <request> [--values <json>] [--out <plan.json>]");
}

const recipe = JSON.parse(readFileSync(resolve(recipePath), "utf8")) as FormatRecipe;
const values = JSON.parse(valuesJson) as FormatInstantiation["values"];
const plan = compileFormatRecipe(recipe, { userPrompt, values });
const serialized = `${JSON.stringify(plan, null, 2)}\n`;

if (outputPath === undefined) {
  process.stdout.write(serialized);
} else {
  writeFileSync(resolve(outputPath), serialized, { flag: "wx" });
  process.stdout.write(`${plan.planHash}\n`);
}
