# CloneUGC

CloneUGC turns a permission-safe reference video under 30 seconds into an editable Fidelity Map, then recreates its creative DNA while changing only what the user requests.

This repository contains the project shell, canonical Phase 0 plan, and the provider-neutral benchmark/domain contracts needed to test the fidelity-compiler thesis. Application scaffolding begins only after the benchmark is approved.

See [`docs/plans/cloneugc-agent-native-phase-0.md`](docs/plans/cloneugc-agent-native-phase-0.md).

## Phase 0 commands

```bash
pnpm install
pnpm check
```

`pnpm check` type-checks the contracts, runs the deterministic scoring, compiler, authority, kernel, and chaos tests, scores the permission-safe synthetic sample manifest, validates the materialized Fidelity Maps, and replays one accepted historical run for plan-hash parity. The harness treats cut timing, exact segment lengths, transition type, and global/per-segment playback speed as first-class fidelity evidence. Live provider calls and paid generation are intentionally outside this harness.

Phase 0 also includes a provider-neutral Format Recipe compiler. Validated creative structures can be saved once and instantiated from a short prompt with different characters, gender presentation, body-state arcs, wardrobe, setting, captions, and audio policy while locked timing/camera/edit grammar stays unchanged. The first recipe fixture is [`fixtures/formats/hand-wipe-fitness-transformation-v1.json`](fixtures/formats/hand-wipe-fitness-transformation-v1.json).

The agent resolves a natural-language request into the recipe's declared variables, then freezes the provider-neutral plan with:

```bash
pnpm format:compile fixtures/formats/hand-wipe-fitness-transformation-v1.json \
  --prompt "Use this format with a blonde woman and a new caption" \
  --values '{"subject_identity":"a fictional blonde woman","gender_presentation":"female","caption_text":"90 days with GymLevels"}'
```

## Headless kernel

The Phase 0B / Phase 1 kernel lives in `src/kernel/` and runs entirely offline against the fake adapters in `src/adapters/`. It provides typed directives and immutable revisions, provider-neutral compiled plans with an invalidation graph, bounded estimates in integer USD micros, server-minted rights and spend approvals, and a durable job state machine with an outbox, leases, provider-call compare-and-set, unknown-outcome reconciliation, exact-once ledger settlement, cancellation, atomic publication, and byte-for-byte reuse of accepted unit artifacts on repair.

```bash
pnpm kernel validate-maps
pnpm kernel compile fixtures/fidelity-maps/fm-childhood-to-family-gym-montage-v1.json --intent "Recreate with a fictional family"
pnpm kernel simulate fixtures/fidelity-maps/fm-childhood-to-family-gym-montage-v1.json
pnpm kernel:replay
```

Four validator-accepted Fidelity Maps in `fixtures/fidelity-maps/` are linked from the `phone-laugh-to-lock-in-gym`, `winter-arc-walk-in-stretch-checklist`, `childhood-to-family-gym-montage`, and `hand-wipe-fitness-transformation` recipes. The corrected Winter Arc blind pair established operator-accepted compiler non-inferiority for one family. In the next two source-bound tests, the operator selected the concise control for both the hand-wipe and family montage; the compiler therefore has not passed the three-structure reconstruction gate. The hand-wipe result exposes missing concrete identity and wardrobe values after an occluded setup frame, while the montage result leaves per-take choreography and identity-roster specificity as the leading diagnostic hypothesis. The evidence report is in `docs/reports/phase-0-benchmark-evidence-2026-09-03.md`; remaining paid and human gates are listed in `PARKED_ACTIONS.md`.
