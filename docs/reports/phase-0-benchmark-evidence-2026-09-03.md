# Phase 0 Benchmark Evidence Report

Prepared: 2026-09-03

Scope: the Phase 0A evidence close-out and the Phase 0B / Phase 1 headless kernel authorized by `docs/plans/cloneugc-agent-native-product-plan.md`, section 14. Everything in this report was produced offline in this repository. No provider call, network request, deployment, or spend occurred during the work it describes.

## Decision

| Gate | Status | Basis |
|---|---|---|
| Phase 0B / Phase 1 headless kernel | **PASS (local)** | All four gate items below are covered by committed tests that run in `pnpm check`. |
| Phase 0A evidence close-out | **PARTIAL / COMPILER REPAIR REQUIRED** | Four validator-accepted Fidelity Maps are linked to validated recipes. Winter Arc established compiler non-inferiority, but the operator selected the concise control in both the hand-wipe and family montage pairs. The three-structure reconstruction gate has not passed. |
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
| Tests passing | 26 | 87 |
| Format recipes valid | 9 | 10 |
| Recipes marked validated | 7 | 7 |

The original coverage remains green and the new evidence-gate tests run alongside it. `pnpm check` also runs the benchmark sample, the Fidelity Map validator, and the historical replay.

An owner review added a final fail-closed hardening pass: idempotency keys are now bound to the immutable create-job request; reused artifacts must come from a published, same-workspace, same-source output whose unit hash is unchanged; provider routing is checked against the compiled plan and estimate; estimate arithmetic and provider receipts are validated; an actual-cost overrun records the real capture but terminates the job before any further paid submission; and QA lineage or rights-regression failures cannot be reconciled away or published.

## 2. Phase 0A evidence close-out

### 2.1 Materialized Fidelity Maps

Four maps were materialized from evidence already persisted under `output/` (read-only): Gemini analysis artifacts, deterministic FFmpeg evidence, and human review where required. Deterministic cut timestamps are the system of record. The Dcq Reel carries a persisted full-timeline human correction because the model's action label was visually wrong; the hand-wipe map uses its persisted Agentic Video analysis and a full-timeline human review.

| Map | Family | Source duration | Segments / units | Static analyzer latency | Static tokens (in / out / thought) |
|---|---|---:|---:|---:|---|
| `fm-phone-laugh-to-lock-in-gym-v1` | single-take performance | 6139 ms | 1 / 1 | 14.6 s | 873 / 867 / 548 |
| `fm-winter-arc-walk-in-stretch-checklist-v3` | single-take product/checklist | 9517 ms | 1 / 1 | 11.7 s | 1118 / 709 / 116 |
| `fm-childhood-to-family-gym-montage-v1` | multi-take posing montage | 12933 ms | 17 / 17 | 14.5 s | 1493 / 981 / 582 |
| `fm-hand-wipe-fitness-transformation-v2` | two-take matched transition | 10031 ms | 2 / 2 | persisted Agentic run + corrected choreography | persisted with artifact |

Hashes:

| Map | Fidelity Map hash |
|---|---|
| phone-laugh | `d792607c67c22199c61c0275a014ca5e94db1a7746957051136a0123f98873ab` |
| winter-arc walk-in/stretch | `ea97d9bc49dabe2c5e3a08c5063ae894c3ea7d61036e76cfc2654ea09887ef9e` |
| family montage | `e003a259a09975d209f22d633a0933375e202ce196f06b2864310b4a8cf505d3` |
| hand-wipe transformation | `264c503ea3b8f0c0925a96561b33b2e113335cf9668c8905ccd56fd89a245474` |

Notable honesty choices baked into the fixtures:

- rights status is `unverified` on all four, so `generationEligibility` reports "rights attestation is required"; the historical runs used Slack approvals, which are not durable rights records;
- the corrected Winter Arc map records real-time playback from observable gait, clothing and carried-item swing; the original model's shirt-removal label is superseded by the persisted human full-timeline review;
- the family montage map records a `minor` risk with `exclude` disposition for the childhood photograph; the rights contract refuses to ever authorize it;
- the family montage covers the 388-frame video timeline (12933 ms) rather than the longer container duration.
- the hand-wipe map preserves two independently recorded takes, one identity lineage, the hand-occlusion join, and deterministic caption/audio finishing.

### 2.2 Recipes re-derived from Fidelity Map hashes

| Recipe | Lineage before | Lineage now | Derivation check |
|---|---|---|---|
| `phone-laugh-to-lock-in-gym` | run manifest | Fidelity Map | 1 shot equals 1 segment, same strategy |
| `winter-arc-walk-in-stretch-checklist` | run manifest | Fidelity Map + human correction + blind H3 pair | 1 shot equals 1 segment; recipe ends 117 ms inside the final segment; A was the slight preference and compiler B was subsequently accepted as negligibly different and production-usable |
| `childhood-to-family-gym-montage` | run manifest | Fidelity Map | 17 shots equal 17 deterministic segments; 5 deterministic-source photo units plus 12 image-to-video units |
| `hand-wipe-fitness-transformation` | run manifest | Fidelity Map + Agentic analysis + human review | 2 shots equal 2 independently recorded takes; the 5241 ms second unit uses the 5-second provider duration within the explicit 10% near-real-time tolerance |

The remaining three validated recipes and three manifest/evidence-only drafts still cite run manifests or evidence hashes. Their analyzer outputs are not persisted in the repository's evidence set, so re-deriving them requires a paid analyzer run and is parked.

### 2.3 Historical paid-unit cost and latency

The plan requires unit cost and latency for every paid generation unit. The persisted manifests only partly satisfy this:

| Run | Ceiling | Estimated image | Estimated video | Units | Latency per unit |
|---|---:|---:|---:|---:|---|
| phone-laugh run-v1 | $0.16 | $0.09 | $0.06 | 1 image + 1 video | not recorded |
| hand-wipe final (GymLevels) | $0.28 | $0.18 | $0.10 | 2 image + 2 video | not recorded |
| hand-wipe r3ta/pepmod instantiation | $0.28 | not split | not split | 2 image + 2 video | not recorded |
| family montage run-v1 | not recorded | not recorded | not recorded | 12 video | not recorded |
| winter-arc run-v1 (action misclassified; excluded) | not recorded | not recorded | not recorded | 1 image + 1 video | not recorded |

Per-unit latency was never captured. The kernel now records `createdAtMs`, `updatedAtMs`, receipt time, and `actualCostUsdMicros` per provider call, so future live runs satisfy this automatically.

### 2.4 Offline evidence evaluators

The repository now rejects incomplete Phase 0A evidence before it can be mistaken for a passing gate:

- `scoreBenchmarkCorpus` requires exactly three distinct reference families, all four analyzer lanes, at least three repeated runs per lane, one pinned exact model across the corpus, immutable source hashes, and run-level provider/artifact/cost/latency provenance;
- `scorePhase0Comparisons` requires three sealed A/B families, paid-unit request/seed/hash/cost/latency provenance, three unique lane-blind ballots per pair, complete ten-dimension scoring, majority preference plus higher median score, no rights regression, typed repair attribution for material failures, a cost ceiling, and at least one commercially usable compiler output;
- `pnpm phase0:evaluate analysis <file>` and `pnpm phase0:evaluate comparisons <file>` produce machine-readable reports. The comparison report also hashes its complete input bundle.

The exact evidence assembly sequence is documented in `docs/phase-0-evidence-workflow.md`.

### 2.5 Corrected live evidence and remaining work

Correction recorded 2026-09-03: the operator confirmed the intended source was Instagram `DcqCAe_Jl9o`. Direct full-timeline review shows a fully clothed subject walking away into the gym, raising both arms into an overhead shoulder/triceps stretch, lowering the arms, and continuing forward. No shirt is removed and no bodybuilding flex occurs. A first corrected-action H3 A/B pair then exposed a second miss: both prompts froze the camera, while the source is a handheld rear-follow shot with forward translation, background parallax, small lateral drift, and gait-synchronized vertical bob. Those earlier pairs remain excluded. A fresh blind pair used the same approved setup frame, seed, H3 route and settings in both lanes; the operator selected Candidate A as “perfect.” Unsealing showed A was the concise control and B was the compiler. The operator then clarified that the difference was negligible and explicitly accepted B if it simplified the product path. The result promotes `winter-arc-walk-in-stretch-checklist` revision 4 to validated, proves the corrected format and production route, and establishes the current compiler as non-inferior for this family. It does not prove compiler superiority, and the complete three-family scoring gate remains open. Exact hashes, request IDs, and both operator decisions are in `fixtures/evidence/instagram-DcqCAe_Jl9o-handheld-winner-v1.json`. TikTok `7665182154300624142` remains a separate incline-press checklist draft and was not the requested correction.

Two further source-bound blind pairs then ran on the production GPT Image setup-frame plus per-take H3 route using already accepted setup frames. All 28 H3 calls completed once with zero retries. For the hand-wipe pair, A was control and B compiler; the operator selected A. The compiler's after-take prompt carried only abstract “same identity” and “change wardrobe” directives even though its setup frame was fully occluded, omitting the concrete woman, hair, gender presentation and green outfit values; the revealed subject visibly broke continuity. For the 12-take family montage, A was compiler and B control; the operator selected B. The shared setup frames constrained the visible difference, so causality is not claimed, but the compiler prompts omitted both the concrete five-person roster and exact per-take choreography present in the controls. These results are recorded in `fixtures/evidence/phase0-hand-wipe-blind-pair-v1.json` and `fixtures/evidence/phase0-family-montage-blind-pair-v1.json`. The compiler must render resolved change values, identity continuity state, and per-unit motion instructions before another paid retest.

The compiler was repaired to render the requested outcome, subject-anchor policy, complete setup state, and typed resolved identity, wardrobe and body-state values into every affected motion prompt. A second 28-call blind retest completed with zero retries. For hand-wipe, A was control and B compiler; the operator rejected A because it changed from a woman to a man and preferred B. Audit established that A's approved woman setup frame had accidentally been paired with a stale male control-state prompt, so this was a benchmark input-provenance failure rather than a provider instruction failure. B preserved the requested woman but its 10-second after take invented a second palm occlusion; compressing that take into the 5241 ms source interval exposed the error. Preparation now binds the approved control-state hash, requires explicit identity text for a fully occluded setup frame, and chooses a 5-second H3 take through a 10% near-real-time tolerance. A zero-generation repair reuses the selected compiler before take and the previously operator-accepted 5-second after take. For family montage, A was control and B compiler; the operator selected A without yet stating whether B was materially worse or still commercially acceptable. The family gate therefore remains unresolved rather than being labelled a compiler failure or non-inferiority. Exact evidence is in `fixtures/evidence/phase0-hand-wipe-blind-pair-v2.json` and `fixtures/evidence/phase0-family-montage-blind-pair-v2.json`.

A third hand-wipe pair removed those confounds: both lanes used the same accepted setup frames, per-take seeds, five-second provider durations, 768P settings, and identical deterministic finishing. The operator selected B, the concise control; the sealed Gemini 3.8 Agentic preflight independently selected B. A was the compiler. Its before-take prompt had leaked the global cross-cut hand-withdraw/reveal interval into the local before take, causing an early palm cover, withdrawal, idle gap, and failed join; its after take also revealed a different identity. This is a fair compiler failure and the reconstruction gate remains closed. The compiler now emits only unit-contained action beats, an explicit local start or endpoint, resolved subject state, camera, and compact exclusions. Global timestamps, cross-boundary actions, rights prose, and deterministic-finishing instructions no longer enter paid provider prompts. The fix passes the full local suite, but requires a two-call compiler-only retest against immutable Candidate B before it can count as evidence. Exact failed evidence is in `fixtures/evidence/phase0-hand-wipe-blind-pair-v3.json`.

The two-call compiler-only retest confirmed that fix solved the palm timing but did not make the candidate non-inferior. Gemini 3.8 Agentic found that it omitted the raised-arm back flex, skipped the opening after-state flex, and revealed a different older/tanned woman. Audit traced those failures to two upstream contract defects: the materialized Fidelity Map reduced the exact arm/body sequence to an abstract “back pose,” and the after take began from a fully palm-occluded setup with no visible identity pixels. The map now carries the exact observed choreography, and the compiled plan can require an H3 endpoint frame. A fully occluded start now fails preparation unless paired with a visible endpoint identity anchor. This follows the current H3 Max Turbo API's supported `end_image_url` first-to-last keyframe contract. The failed retest is preserved in `fixtures/evidence/phase0-hand-wipe-compiler-retest-v4.json`; no further generation counts until a fresh equal-input pair passes blind review.

The first endpoint-bound pair stopped after two completed before-take calls and one accepted after-take request whose result was rejected by the provider content checker; the fourth call was never submitted. The input depicted a fully clothed adult in gymwear, so this is treated as a safety false positive, but not retried. The exact-once runner now persists a terminal content-policy result after provider acceptance instead of leaving the receipt in `submitted`. The incomplete run is recorded in `fixtures/evidence/phase0-hand-wipe-endpoint-pair-v5.json` and cannot count as benchmark evidence.

A second endpoint-bound run used shorter, fully clothed workout-state wording. Both compiler units completed; the control before unit completed, while the control after request was accepted and again terminated at result retrieval with `CONTENT_POLICY_VIOLATION`. The complete compiler output passed Gemini 3.8 Agentic on identity continuity, exact before and after choreography, palm endpoint timing, camera, cadence, and artifact integrity, and was judged commercially usable and non-inferior to the previously operator-accepted control B. The operator then reviewed that exact hash-bound output and accepted it as “perfect” in Slack message `1788478559.542179`. This is commercially usable compiler evidence, but not a completed same-run blind pair; the evidence record preserves that distinction in `fixtures/evidence/phase0-hand-wipe-endpoint-compiler-v6.json`.

The family montage was then re-materialized from three fresh Gemini 3.8 Agentic source-only passes. Fidelity Map revision 2 preserves all 12 adult takes separately, including the lowered-arm starts, sequential fan reveals, ripple snaps, deliberate four-person visible shot, and dumbbell-rack double-biceps endpoint. Four missing start states were prepared while the accepted endpoint frames, fictional family, source cut grammar, and audio remained fixed. The resulting 24-call H3 pair completed exactly once with zero retries. A finishing audit caught that the first assembly had kept only each five-second take's opening frames, thereby discarding late choreography; all paid outputs were reused and the complete actions were retimed into their exact 388-frame source timeline. Independent Gemini 3.8 Agentic reviews then found both candidates commercially strong, scoring A 9.0/10 and confirming that B completed all four complex motion sequences. The operator selected B in Slack message `1788480654.050329`; unsealing showed B was the compiler and A the concise control. This closes the family-montage comparison in favor of the compiler. Exact plan, request, output, audio, QA, and human-verdict hashes are in `fixtures/evidence/phase0-family-montage-blind-pair-v3.json`.

- blind human annotations for the remaining comparison families;
- a complete same-run hand-wipe control/compiler pair if provider policy permits it; the accepted compiler v6 is commercially usable but its paired control terminated at provider policy review;
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
| Recipes cite a real Fidelity Map hash | Four recipes do and all four are validated. The Winter Arc compiler is operator-accepted as negligibly different from the slight control preference; cross-format evidence remains open. Three other validated recipes are parked on analyzer re-runs. |
| Cost, rights scope, and approval binding in eligibility | `checkGenerationAuthority` binds source, revision, plan, estimate, expiry, rights coverage, and single-use approval ceilings, and the kernel consumes approvals inside the creation transaction. |

## 4. Risks

- The in-memory store emulates Firestore transaction semantics synchronously. Asynchronous contention, document size limits, and index behavior are not exercised; the Phase 2 adapter must run the same tests against the Firestore emulator.
- Atomic publication is two steps: the asset store commits master and manifest atomically, then the store transaction records the output. A crash between the two leaves published objects without a record; the tests show a retry republishes the same hashes, but orphan cleanup is not implemented.
- Compiled prompts are assembled from map fields by fixed rules. They are provider-neutral and deterministic. The first corrected live comparison slightly preferred the concise control, but the operator judged the difference negligible and accepted the compiler output; broader quality remains untested across the other two benchmark families.
- Materialized maps are faithful to persisted evidence, but the evidence itself is one static analyzer pass per clip with no repeats, so claim stability is unknown.
