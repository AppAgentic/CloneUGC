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

`hybrid_agentic` is the backward-compatible benchmark schema name for the production lane: deterministic probes merged with a complete Gemini 3.8 Agentic Video analysis. The three static lanes are controls/fallback measurements only; they are not candidates for the normal production default.

Every lane needs at least three repeats. All twelve lanes across the corpus must pin the same exact model identifier; moving `-latest` aliases are rejected. Each run must retain provider and artifact provenance plus latency, token, cost, and follow-up counts.

`src/analyzer-runner.ts` prepares the counterbalanced lane order and enforces the execution contract: pinned model/mode/sampling, deterministic-probe hash, idempotency key, full raw interaction persistence before summaries, structured-payload persistence, complete token/cost telemetry, and no resubmission of an ambiguous or failed unit. A static result is never eligible to materialize the production Fidelity Map. Even an Agentic result remains ineligible for paid generation until the resulting map, rights, and spend authority pass their separate validators.

`src/adapters/mc-gemini-analyzer.ts` is the live boundary. It resolves and re-hashes the normalized source before submission, pins `gemini-3.8-flash` in the child environment, invokes the shared analyzer without a shell, and verifies provider/model/mode/FPS/source/evidence/interaction identity before returning. The shared command supports exact `--sampling-fps` only with `--mode static` and writes the complete request/response exchange to a new private `0600` file with `--evidence-output`; it refuses to overwrite an existing artifact. The adapter stores that lossless exchange plus a parsed payload and pricing-snapshot lineage, then deletes only its own temporary handoff directory.

The 2026-09-04 live canaries used the corrected Winter Arc source. The shared Agentic boundary returned a real interaction ID and eight adaptive processing calls/results; the full Agentic adapter-to-runner path returned a second real interaction with seven processing calls, wrote two independently hashed artifacts to its configured canary store before returning, marked the candidate eligible for Fidelity Map materialization, and correctly left `mayDrivePaidGeneration` false. Separate live 5fps static calls proved that Gemini accepts the exact sampling object and that the adapter preserves an explicit zero processing-call count; the runner correctly kept that static result ineligible for map materialization. These canaries prove the transport and provenance rail, not the three-family quality gate or durable object-store wiring.

Evaluate it with:

```bash
pnpm phase0:evaluate analysis /absolute/path/to/analysis-corpus.json
```

This command can score complete real evidence only. A sample or partial fixture cannot be mistaken for Phase 0A corpus evidence.

## 3. Freeze generation comparisons

For each family, generate an otherwise controlled A/B pair: direct request control versus Fidelity Map compiler. Seal the A/B-to-lane mapping away from scorers until all ballots are committed.

Before spend, bind the pair to the operator-confirmed originating source asset and its exact format recipe. The runner must reject a recipe whose `provenance.sourceAssetId` differs from that intended source or whose linked Fidelity Map hash differs from the supplied map. A visually similar later recipe is not an acceptable substitute. Confirm the source action grammar from frames as well as its label.

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

The customer web app, remote MCP server, live generation adapters, billing, and cloud deployment remain gated until this evidence passes.
