# Phase 0 Benchmark Evidence Report

Prepared: 2026-09-03

Scope: the Phase 0A evidence close-out and the Phase 0B / Phase 1 headless kernel authorized by `docs/plans/cloneugc-agent-native-product-plan.md`, section 14. Everything in this report was produced offline in this repository. No provider call, network request, deployment, or spend occurred during the work it describes.

## Decision

| Gate | Status | Basis |
|---|---|---|
| Phase 0B / Phase 1 headless kernel | **PASS (local)** | All four gate items below are covered by committed tests that run in `pnpm check`. |
| Phase 0A evidence close-out | **PARTIAL** | Three validator-accepted Fidelity Maps are linked to three validated recipes. Blind annotations, blind scoring, raw-versus-compiler pairs, and per-unit cost/latency capture require paid or human work that this session could not run. See `PARKED_ACTIONS.md`. |
| Private live route (Phase 2) | **NO-GO for now** | The kernel is ready to host one analyzer, one image, and one video adapter, but the Phase 0A fidelity gate has not passed and no rights records exist for the benchmark sources. |

## 1. Headless kernel gate

The plan's gate for Phase 0B / Phase 1 has four items.

### 1.1 Chaos tests show zero duplicate spend

`test/chaos.test.ts` runs the kernel against a scriptable fake provider that counts every accepted submission as a spend event, even when the idempotency key repeats. The tests assert the count of accepted submissions per unit and the number of ledger capture entries.

| Scenario | What is injected | Result |
|---|---|---|
| Duplicate outbox delivery | The same outbox event delivered three times; two workers claim concurrently | One task, one lease, four paid units, zero duplicates |
| Worker death after submit | Worker A submits a motion call and dies; lease expires; worker B takes over | B polls the existing receipt and never resubmits; the stale worker's step is rejected |
| Lease loss mid-stage | Lease expires while A holds it; B claims | A cannot reserve, heartbeat, or publish; no extra provider call is created |
| Lost provider response | Provider accepts but the response is lost | Call becomes `unknown`, only the anchor stage reconciles, job enters `needs_attention`; reconciliation recovers the receipt by request id; no resubmission |
| Unreachable provider, then confirmed loss | Lookup throws, then the provider has no record | Call stays `unknown` while unreachable; confirmed non-acceptance marks it failed and one bounded retry completes |
| Crash between `submitting` and receipt persistence | Provider hook throws after acceptance | The replacement worker treats `submitting` as `unknown` and never resubmits |
| Provider failure after acceptance | Two consecutive failed generations | Retries stop at `maxAttempts`; job fails and the full reservation is released |

Every scenario ends with `outstandingUsdMicros === 0` and one capture entry per succeeded call.

### 1.2 Deterministic replay yields the same compiled plan hash

`fixtures/replays/hand-wipe-blonde-r3ta-pepmod-v1.json` is the compiled plan from the accepted historical instantiation run (copied from the run output, not edited). `test/replay.test.ts` and `pnpm kernel:replay` recompile the committed recipe with the same prompt and values.

| Hash | Value |
|---|---|
| Recipe hash | `0d841fb7e2af81fbd76e6e698b5e4fbfaf2fe84ea8a158134cb11686d31613fa` |
| Historical format plan hash | `b0c7e2809328584b91b0f0ccaa56fe1a73c4460031024e3ec753d8ce6599d93b` |
| Replayed format plan hash | `b0c7e2809328584b91b0f0ccaa56fe1a73c4460031024e3ec753d8ce6599d93b` |

The replayed plan then compiles to a kernel plan and runs through the fake kernel twice with different workers; both runs publish the same master asset hash.

### 1.3 A repair invalidates only intended units

`test/compiler.test.ts` and `test/kernel.test.ts` cover the invalidation graph:

- a caption change invalidates the caption layer and final splice only; every generation unit is reusable;
- a wardrobe change scoped to one unit invalidates that unit's anchor, motion, trim, and transition, and leaves the other unit reusable;
- an identity change invalidates every unit regardless of scope;
- a repair job reuses accepted artifacts byte-for-byte, the estimate charges nothing for them, and the fake provider records exactly two new spend events for the two regenerated units.

### 1.4 All current contract and format tests remain green

| Suite | Base commit e20ed3b | This branch |
|---|---:|---:|
| Tests passing | 26 | 73 |
| Format recipes valid | 9 | 9 |
| Recipes marked validated | 7 | 7 |

No existing test was modified. `pnpm check` also runs the benchmark sample, the Fidelity Map validator, and the historical replay.

An owner review added a final fail-closed hardening pass: idempotency keys are now bound to the immutable create-job request; reused artifacts must come from a published, same-workspace, same-source output whose unit hash is unchanged; provider routing is checked against the compiled plan and estimate; estimate arithmetic and provider receipts are validated; and an actual-cost overrun records the real capture but terminates the job before any further paid submission.

## 2. Phase 0A evidence close-out

### 2.1 Materialized Fidelity Maps

Three maps were materialized from evidence already persisted under `output/` (read-only): the Gemini `gemini-3.7-flash` static analysis JSON and the FFmpeg `select=scene` `showinfo` log for each source. Deterministic cut timestamps are the system of record; the analyzer supplies labels and interpretation.

| Map | Family | Source duration | Segments / units | Static analyzer latency | Static tokens (in / out / thought) |
|---|---|---:|---:|---:|---|
| `fm-phone-laugh-to-lock-in-gym-v1` | single-take performance | 6139 ms | 1 / 1 | 14.6 s | 873 / 867 / 548 |
| `fm-winter-arc-shirt-reveal-checklist-v1` | single-take product/checklist | 9517 ms | 1 / 1 | 11.7 s | 1118 / 709 / 116 |
| `fm-childhood-to-family-gym-montage-v1` | multi-take posing montage | 12933 ms | 17 / 17 | 14.5 s | 1493 / 981 / 582 |

Hashes:

| Map | Fidelity Map hash |
|---|---|
| phone-laugh | `d792607c67c22199c61c0275a014ca5e94db1a7746957051136a0123f98873ab` |
| winter-arc | `0e312cab94bcde687aa7b00dfaf853b35a5cb22b7665287f072f52857bb52c5a` |
| family montage | `e003a259a09975d209f22d633a0933375e202ce196f06b2864310b4a8cf505d3` |

Notable honesty choices baked into the fixtures:

- rights status is `unverified` on all three, so `generationEligibility` reports "rights attestation is required"; the historical runs used Slack approvals, which are not durable rights records;
- the Winter Arc map records playback as `unknown` because the analyzer could not rule out a slight ramp and no independent anchor was verifiable;
- the family montage map records a `minor` risk with `exclude` disposition for the childhood photograph; the rights contract refuses to ever authorize it;
- the family montage covers the 388-frame video timeline (12933 ms) rather than the longer container duration.

### 2.2 Recipes re-derived from Fidelity Map hashes

| Recipe | Lineage before | Lineage now | Derivation check |
|---|---|---|---|
| `phone-laugh-to-lock-in-gym` | run manifest | Fidelity Map | 1 shot equals 1 segment, same strategy |
| `winter-arc-shirt-reveal-checklist` | run manifest | Fidelity Map | 1 shot equals 1 segment; recipe ends 117 ms inside the final segment (deterministic tail trim of the validated run) |
| `childhood-to-family-gym-montage` | run manifest | Fidelity Map | 17 shots equal 17 deterministic segments; 5 deterministic-source photo units plus 12 image-to-video units |

The remaining four validated recipes and two drafts still cite run manifests or evidence hashes. Their analyzer outputs are not persisted in the repository's evidence set, so re-deriving them requires a paid analyzer run and is parked.

### 2.3 Historical paid-unit cost and latency

The plan requires unit cost and latency for every paid generation unit. The persisted manifests only partly satisfy this:

| Run | Ceiling | Estimated image | Estimated video | Units | Latency per unit |
|---|---:|---:|---:|---:|---|
| phone-laugh run-v1 | $0.16 | $0.09 | $0.06 | 1 image + 1 video | not recorded |
| hand-wipe final (GymLevels) | $0.28 | $0.18 | $0.10 | 2 image + 2 video | not recorded |
| hand-wipe r3ta/pepmod instantiation | $0.28 | not split | not split | 2 image + 2 video | not recorded |
| family montage run-v1 | not recorded | not recorded | not recorded | 12 video | not recorded |
| winter-arc run-v1 | not recorded | not recorded | not recorded | 1 image + 1 video | not recorded |

Per-unit latency was never captured. The kernel now records `createdAtMs`, `updatedAtMs`, receipt time, and `actualCostUsdMicros` per provider call, so future live runs satisfy this automatically.

### 2.4 Not run in this session

- blind human annotations for the three clips;
- one raw-request versus compiler generation pair per family;
- three blind scorers with structured per-dimension QA;
- static-versus-hybrid analyzer bake-off with repeated runs.

Each is a paid or human gate and is listed with its unblocking condition in `PARKED_ACTIONS.md`.

## 3. Contract corrections from the plan

| Correction | Status |
|---|---|
| Move provider minimum duration out of `FormatRecipe` | Estimates resolve minimum, step, and pricing from internal provider capabilities. The recipe field is retained for compatibility with the nine committed recipes and their historical hashes; it is no longer consulted by the kernel estimate. |
| Remove named model/provider guidance from public schemas | Compiled plans, estimates, jobs, and outputs use provider classes only; tests assert prompts and estimates contain no provider or adapter names. |
| Typed target dimensions and generation-unit impact | `TypedDirective` carries dimension, target scope, intent, and value; the invalidation graph maps dimensions to units and finishing steps. |
| Machine-readable QA | `QAReport` scores per dimension and attaches typed repair directives to timestamped findings. |
| Validated recipes cite a real Fidelity Map hash | Three of seven validated recipes now do; a derivation check proves the structure matches. The other four are parked on analyzer re-runs. |
| Cost, rights scope, and approval binding in eligibility | `checkGenerationAuthority` binds source, revision, plan, estimate, expiry, rights coverage, and single-use approval ceilings, and the kernel consumes approvals inside the creation transaction. |

## 4. Risks

- The in-memory store emulates Firestore transaction semantics synchronously. Asynchronous contention, document size limits, and index behavior are not exercised; the Phase 2 adapter must run the same tests against the Firestore emulator.
- Atomic publication is two steps: the asset store commits master and manifest atomically, then the store transaction records the output. A crash between the two leaves published objects without a record; the tests show a retry republishes the same hashes, but orphan cleanup is not implemented.
- Compiled prompts are assembled from map fields by fixed rules. They are provider-neutral and deterministic, but their generation quality is untested until the Phase 0A comparison runs.
- Materialized maps are faithful to persisted evidence, but the evidence itself is one static analyzer pass per clip with no repeats, so claim stability is unknown.
