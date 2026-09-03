# CloneUGC

## Overview

CloneUGC is an agent-first reference-video reconstruction product. A user pastes a link or uploads a permission-safe video under 30 seconds, chooses what to preserve and what to change, and receives a faithful, customizable recreation.

The durable product is the reconstruction intelligence layer: source forensics, a versioned Fidelity Map, a reference-aware prompt compiler, and comparative fidelity QA. It is not merely another URL-to-video wrapper.

## Product Boundaries

- Keep the human flow simple: ingest, analyze, edit Preserve/Change, approve cost, generate, compare, repair, export.
- Conversation is the primary creation and repair surface. Use UI for uploads, visual choices, side-by-side review, persistent settings, billing, and recovery.
- Keep CloneUGC separate from SeedViral. SeedViral is a brand-side creator-campaign control plane; CloneUGC is a focused media-reconstruction product.
- Reuse proven shared media infrastructure where practical, but do not couple this repository to another product's private application state.
- Require a rights/permission attestation before paid generation. Never silently copy a real person's identity or voice, logos, watermarks, or licensed music/dialogue.
- Keep provider names out of the customer-facing workflow. Provider adapters remain internal and swappable.

## Tech Stack

- **Human control plane:** Next.js and TypeScript
- **Web/API hosting:** Firebase App Hosting
- **Generation/render workers:** durable queue-backed workers; Cloud Run is the initial deployment target
- **Media storage:** private object storage with short-lived signed URLs; Cloudflare R2 is the initial candidate
- **Agent surface:** remote MCP over Streamable HTTP plus focused REST/OpenAPI endpoints
- **Identity:** WorkOS AuthKit for product identity and MCP OAuth, planned from day one but not provisioned in the project-shell phase

## Core Domain Objects

- `ReferenceAsset`: permission state, provenance, normalized media, source metadata
- `FidelityMap`: timestamped beats plus Preserve, Change, Exclude, and risk constraints
- `Reconstruction`: immutable source/spec lineage and editable revisions
- `GenerationEstimate`: bounded cost estimate tied to an immutable spec hash
- `GenerationJob`: leased, resumable, cancellable paid-provider workflow
- `OutputArtifact`: generated master, deterministic finishing, QA evidence, and export manifest

## Project Structure

The application has not been scaffolded yet. Phase 0 established the benchmark harness, the provider-neutral domain contracts, and the headless job kernel authorized by `docs/plans/cloneugc-agent-native-product-plan.md`. Do not run `create-next-app` until the Phase 0A evidence gate passes.

- `src/contracts.ts`, `src/format-recipe.ts`, `src/benchmark.ts`: Fidelity Map, evidence, Format Recipe, and scoring contracts
- `src/directives.ts`, `src/compiler.ts`, `src/estimate.ts`, `src/authority.ts`, `src/qa.ts`: typed directives, compiled plans, bounded estimates, rights/spend authority, machine-readable QA
- `src/kernel/`: transactional store, durable job kernel, and stateless worker
- `src/adapters/`: fake provider, asset store, render, QA, and analyzer adapters (offline only)
- `fixtures/fidelity-maps/`: validator-accepted Fidelity Maps materialized from persisted evidence
- `fixtures/replays/`: accepted historical runs replayed for hash parity
- `PARKED_ACTIONS.md`: external-only gates and what unblocks them

## Commands

```bash
pnpm install
pnpm check                 # typecheck, tests, benchmark sample, map validation, replay parity
pnpm test
pnpm kernel validate-maps
pnpm kernel simulate fixtures/fidelity-maps/fm-phone-laugh-to-lock-in-gym-v1.json
pnpm kernel:replay
```

All kernel commands run against fake adapters; none can reach a provider or spend.

## Environment Variables

No live credentials are required for the project shell. Future provider and infrastructure credentials belong in `mc-vault` and the deployment secret manager, never in repository files or Slack.

## Start Here

Read `docs/plans/cloneugc-agent-native-phase-0.md` before implementation.
