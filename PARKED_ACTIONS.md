# Parked Actions

Actions the approved plan requires that cannot be completed inside this repository without paid provider calls, human work, secrets, or live services. Each entry names what unblocks it. Nothing here is started automatically.

## Phase 0A evidence close-out

| # | Action | Why parked | Unblocked by |
|---|---|---|---|
| P1 | Blind human annotations for the three benchmark clips (cuts, segment lengths, playback classes, action events, continuity, lighting, secondary motion, text, audio, rights risks) | Human work; must be authored before seeing model output | An annotator with the source clips and the `BlindAnnotation` contract in `src/benchmark.ts`; the complete corpus is evaluated by `pnpm phase0:evaluate analysis <file>` |
| P2 | Static-default, static-5fps, static-10fps, and hybrid analyzer lanes, three repeats per clip, pinned exact model | Paid Gemini calls over the network | Provider credentials in `mc-vault`, approved data-use terms, a budget approval, and the pinned model decision (3.7 versus 3.8); partial evidence is rejected by `scoreBenchmarkCorpus` |
| P3 | Re-derive the four remaining validated recipes and two drafts from validator-accepted Fidelity Maps | Their analyzer outputs are not persisted; a fresh analysis is a paid call | P2 tooling plus the source clips for `hand-wipe`, `alternating-gym`, `continuous-pec-fly`, `rapid-gym`, `kitchen-finger-count`, and `night-car` |
| P4 | One raw-request versus compiler generation pair per family at 480p, winning seeds at 720p | Paid image and video generation | Rights attestations for the three sources, spend approval bound to kernel estimates, and live image/video adapters |
| P5 | Three blind scorers with structured per-dimension QA on each pair | Human work | P4 outputs and sealed ballots using `Phase0ComparisonBundle` in `src/comparison-benchmark.ts`; evaluate with `pnpm phase0:evaluate comparisons <file>` |
| P6 | Record unit cost and latency for every paid generation unit | No live run has happened through the kernel | P4; the kernel already persists per-call cost and timestamps |
| P7 | Durable rights records for the benchmark sources | Only Slack approval messages exist; they are not `RightsRecord` attestations | The rights holder attests through the authority service once it exists, or an operator mints records for the internal canary |

## Phase 2 private live route

| # | Action | Why parked | Unblocked by |
|---|---|---|---|
| P8 | Firestore emulator adapter for `MemoryStore` semantics and re-run of `test/chaos.test.ts` against it | Requires the Firebase toolchain and project configuration | The Phase 0A gate passing and Firebase project provisioning approval |
| P9 | Live analyzer, image, and video adapters behind the provider-neutral `ProviderAdapter` interface | Provider credentials and paid calls | Credentials in `mc-vault` and the pinned model decisions |
| P10 | Cloudflare R2 asset store with task-scoped prefixes and atomic publication | Requires R2 provisioning | Infrastructure approval |
| P11 | Orphan cleanup for assets published before the output record commits | Needs the real asset store's listing and lifecycle behavior | P10 |
| P12 | Cloud Tasks dispatch and scheduled reconciliation worker | Requires GCP provisioning | Infrastructure approval |

## Explicitly not started

- Next.js scaffold, WorkOS AuthKit, billing, MCP server, and any deployment: deferred by the plan until the Phase 0A gate passes.
- Slack notifications or any message to a live service about this work: outside the authorized scope of this session.
- Any edit under `output/`: read-only evidence.
