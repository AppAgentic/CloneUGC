# Phase 0A Evidence Workflow

This repository now contains fail-closed evaluators for both evidence gates. They intentionally do not fabricate the paid runs or human judgments required by the product plan.

## 1. Freeze blind source annotations

For each of the three permission-safe families—dialogue, movement, and product integration—create a `BlindAnnotation` before revealing analyzer output. Retain the source and normalized SHA-256 hashes, source offset, full edit timeline, action events, and evidence claims.

## 2. Run the analyzer bake-off

Create one `BenchmarkCorpus` JSON document containing exactly three distinct families. Every family must contain exactly these lanes:

- `static_default`
- `static_5fps`
- `static_10fps`
- `hybrid_agentic`

Every lane needs at least three repeats. All twelve lanes across the corpus must pin the same exact model identifier; moving `-latest` aliases are rejected. Each run must retain provider and artifact provenance plus latency, token, cost, and follow-up counts.

Evaluate it with:

```bash
pnpm phase0:evaluate analysis /absolute/path/to/analysis-corpus.json
```

This command can score complete real evidence only. A sample or partial fixture cannot be mistaken for Phase 0A corpus evidence.

## 3. Freeze generation comparisons

For each family, generate an otherwise controlled A/B pair: direct request control versus Fidelity Map compiler. Seal the A/B-to-lane mapping away from scorers until all ballots are committed.

Every variant must retain an output hash and at least one paid generation unit with its request ID, seed, exact prompt/source/spec/output hashes, estimated and actual USD micros, latency, and delivered duration. High-confidence multi-take references still require independently auditable units per source setup under the compiler contract.

## 4. Collect blind ballots

Collect at least three unique lane-blind ballots per pair. Each scorer must grade A and B on all ten comparison dimensions, record a preference, flag rights regressions and commercial usability, and map every material compiler failure below 800/1000 to at least one typed Fidelity Map repair dimension.

Evaluate the sealed bundle with:

```bash
pnpm phase0:evaluate comparisons /absolute/path/to/comparison-bundle.json
```

The report includes a content hash for the submitted bundle. The gate passes only when the compiler receives a majority preference and higher median score in all three families, has no rights regression, stays within the declared pair-level cost ceiling, has typed repair attribution for material failures, and produces at least one majority-rated commercially usable output.

## 5. Preserve the evidence

Store the input documents, raw provider interactions, deterministic probe outputs, generated artifacts, ballots, evaluator output, and their hashes together. Do not edit a scored bundle in place; create a new immutable evidence version and retain the earlier report.

The customer web app, remote MCP server, live provider adapters, billing, and cloud deployment remain gated until this evidence passes.
