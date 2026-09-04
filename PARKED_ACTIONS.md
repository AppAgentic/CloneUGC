# Parked Actions

Actions the approved plan requires that cannot be completed inside this repository without paid provider calls, human work, secrets, or live services. Each entry names what unblocks it. Nothing here is started automatically.

## Phase 0A evidence close-out

| # | Action | Why parked | Unblocked by |
|---|---|---|---|
| P1 | Blind human annotations for the three benchmark clips (cuts, segment lengths, playback classes, action events, continuity, lighting, secondary motion, text, audio, rights risks) | Human work; must be authored before seeing model output | An annotator with the source clips and the `BlindAnnotation` contract in `src/benchmark.ts`; the complete corpus is evaluated by `pnpm phase0:evaluate analysis <file>` |
| P2 | Static-default, static-5fps, static-10fps, and Agentic production lanes, three repeats per clip, pinned exact model | The live evidence adapter, exact static-FPS boundary, and crash-durable local stores now exist and passed Agentic, 5fps, and restart canaries; a real three-family run must follow the blind annotations in P1 and use the final permission-safe corpus | Complete P1, freeze the three source hashes and pricing snapshot, then run the counterbalanced plan under the standing in-scope authority; partial evidence remains rejected by `scoreBenchmarkCorpus` |
| P3 | Re-derive the three remaining validated recipes and three drafts from validator-accepted Fidelity Maps | Their analyzer outputs are not persisted; a fresh analysis is a paid call | P2 tooling plus the source clips for `alternating-gym`, `continuous-pec-fly`, `rapid-gym`, `incline-press-checklist-loop`, `kitchen-finger-count`, and `night-car` |
| P4 | Complete a same-run hand-wipe control/compiler pair | The corrected compiler v6 is operator-accepted as “perfect,” but its paired control terminated at provider content-policy review after request acceptance, so that run cannot count as a complete blind pair. The family-montage retest is resolved: the operator selected compiler Candidate B from the complete equal-input pair | A provider-policy-safe equal-input control/compiler hand-wipe pair; never retry a terminal accepted request automatically |
| P5 | Three blind scorers with structured per-dimension QA on each pair | Human work | P4 outputs and sealed ballots using `Phase0ComparisonBundle` in `src/comparison-benchmark.ts`; evaluate with `pnpm phase0:evaluate comparisons <file>` |
| P6 | Route live evidence through the production kernel adapter | The exact-once benchmark runners now persist per-call request IDs, estimated cost, timestamps, latency, hashes, and terminal state, but remain evidence runners rather than the production `GenerationJob` adapter | P4 plus the Phase 2 live provider adapter; the kernel already persists the equivalent provider-call fields |
| P7 | Durable rights records for the benchmark sources | Only Slack approval messages exist; they are not `RightsRecord` attestations | The rights holder attests through the authority service once it exists, or an operator mints records for the internal canary |

## Phase 2 private live route

| # | Action | Why parked | Unblocked by |
|---|---|---|---|
| P8 | Firestore emulator adapter for `MemoryStore` semantics and re-run of `test/chaos.test.ts` against it | Requires the Firebase toolchain and project configuration | The Phase 0A gate passing and Firebase project provisioning approval |
| P9 | Live image and video adapters behind the provider-neutral `ProviderAdapter` interface | Provider credentials and paid calls; the separate live Gemini analysis adapter is implemented and canaried | Credentials in `mc-vault` and the pinned model decisions |
| P10 | Cloudflare R2 asset store with task-scoped prefixes and atomic publication | Requires R2 provisioning | Infrastructure approval |
| P11 | Orphan cleanup for assets published before the output record commits | Needs the real asset store's listing and lifecycle behavior | P10 |
| P12 | Cloud Tasks dispatch and scheduled reconciliation worker | Requires GCP provisioning | Infrastructure approval |

## Explicitly not started

- Next.js scaffold, WorkOS AuthKit, billing, MCP server, and any deployment: deferred by the plan until the Phase 0A gate passes.
- Slack notifications or any message to a live service about this work: outside the authorized scope of this session.
- Existing accepted artifacts under `output/` are read-only. New evidence is written to a new immutable path and never overwrites an earlier artifact.
