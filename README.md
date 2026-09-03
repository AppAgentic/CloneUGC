# CloneUGC

CloneUGC turns a permission-safe reference video under 30 seconds into an editable Fidelity Map, then recreates its creative DNA while changing only what the user requests.

This repository contains the project shell, canonical Phase 0 plan, and the provider-neutral benchmark/domain contracts needed to test the fidelity-compiler thesis. Application scaffolding begins only after the benchmark is approved.

See [`docs/plans/cloneugc-agent-native-phase-0.md`](docs/plans/cloneugc-agent-native-phase-0.md).

## Phase 0 commands

```bash
pnpm install
pnpm check
```

`pnpm check` type-checks the contracts, runs the deterministic scoring tests, and scores the permission-safe synthetic sample manifest. The harness treats cut timing, exact segment lengths, transition type, and global/per-segment playback speed as first-class fidelity evidence. Live provider calls and paid generation are intentionally outside this harness.

Phase 0 also includes a provider-neutral Format Recipe compiler. Validated creative structures can be saved once and instantiated from a short prompt with different characters, gender presentation, body-state arcs, wardrobe, setting, captions, and audio policy while locked timing/camera/edit grammar stays unchanged. The first recipe fixture is [`fixtures/formats/hand-wipe-fitness-transformation-v1.json`](fixtures/formats/hand-wipe-fitness-transformation-v1.json).

The agent resolves a natural-language request into the recipe's declared variables, then freezes the provider-neutral plan with:

```bash
pnpm format:compile fixtures/formats/hand-wipe-fitness-transformation-v1.json \
  --prompt "Use this format with a blonde woman and a new caption" \
  --values '{"subject_identity":"a fictional blonde woman","gender_presentation":"female","caption_text":"90 days with GymLevels"}'
```
