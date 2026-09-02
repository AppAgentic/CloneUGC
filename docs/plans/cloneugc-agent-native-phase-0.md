# CloneUGC Agent-Native Product Plan

Prepared: 2026-09-02

Status: canonical initial plan

## Product Thesis

CloneUGC accepts a permission-safe online reference or upload under 30 seconds, identifies the creative details that make it work, and recreates it with controlled changes.

The wedge is not generic video cloning. Direct competitors already offer URL ingestion, scene analysis, character or product swapping, generation, stitching, and MCP access. CloneUGC must win on measurable reconstruction intelligence:

1. forensic source analysis;
2. an editable, versioned Fidelity Map;
3. a reference-aware compiler that assigns each input a narrow job;
4. comparative fidelity QA and dimension-specific repair.

## Product Shape

### Human workflow

1. Paste a supported URL or upload a video under 30 seconds.
2. Normalize the media and create a rights/provenance record.
3. Analyze the source into “What makes this work.”
4. Present a concise Preserve / Change / Exclude decision.
5. Let the user describe a change conversationally or edit the decisions directly.
6. Show a bounded generation estimate and require rights plus spend confirmation.
7. Generate and finish the recreation through a durable job.
8. Compare source and output side by side with fidelity evidence.
9. Repair one dimension without blindly regenerating unrelated successful work.
10. Export the approved artifact and manifest.

### Fidelity Map

The first durable schema should include:

- source timeline and shot boundaries;
- hook, setup, escalation, payoff, and CTA beats;
- camera position, lens feel, framing, path, triggers, and screen-space subject position;
- subject count, identity policy, pose, blocking, gaze, gesture, and motion rhythm;
- continuity invariants for face, hair, wardrobe, product geometry, hands, props, and occlusion;
- setting, clutter, lighting direction, temperature, contrast, and texture;
- dialogue, room tone, contact sounds, music policy, and caption intent;
- starting and ending state for each beat;
- explicit Preserve, Change, Exclude, and must-not-transfer fields;
- rights and safety flags;
- confidence and evidence timestamps for every important inference.

Each revision is immutable and content-addressed. Generation estimates and approvals bind to the exact revision hash.

## Phase 0: Prove The Compiler Before The Platform

### Corpus

Use three permission-safe 8–12 second vertical references:

1. selfie or dialogue performance;
2. movement or dance with meaningful camera/blocking;
3. natural product integration.

### Comparison

For each reference, produce two otherwise controlled variants:

- **Control:** the reference plus a concise direct change request;
- **Compiler:** the same reference and requested change, compiled from the Fidelity Map into explicit reference roles, starting state, timestamped actions, camera geometry, continuity, audio, ending state, and constraints.

Start at 480p to test composition and reference weighting cheaply. Re-run only winning seeds at 720p. Preserve provider request IDs, seeds, exact prompts, source/spec hashes, cost, duration, and outputs.

### Blind evaluation

Score each pair without revealing which lane produced it:

- shot and beat timing;
- camera geometry and movement;
- blocking, action causality, and physical settling;
- subject, object, wardrobe, and environment continuity;
- lighting, texture, and natural imperfection;
- audio rhythm and dialogue performance;
- success of the requested change;
- absence of unwanted reference transfer;
- commercial usability without source-specific manual prompt rewriting.

### Pass gate

Proceed to product scaffolding only if:

- the compiler lane wins consistently across the three reference families;
- at least one output is commercially usable without hand-written source-specific prompting;
- failures can be attributed to a repairable Fidelity Map dimension rather than opaque whole-prompt changes;
- measured generation cost supports a plausible paid workflow.

If the compiler does not beat the control, stop. Do not hide a failed differentiation test behind a polished SaaS interface.

## Architecture After The Phase 0 Gate

### Control plane

- Next.js and TypeScript on Firebase App Hosting.
- WorkOS AuthKit as product identity and OAuth provider from day one.
- One personal workspace per account initially; teams and agencies are later.
- Private media with short-lived signed URLs and server-derived identity.

### Media and job plane

- Queue-backed workers with atomic claim, lease, heartbeat, cancellation, bounded retry, and stale-worker recovery.
- A transactional outbox between job creation, credit reservation, and dispatch.
- Atomic paid-provider compare-and-set so duplicate delivery cannot trigger duplicate generation or spend.
- Unknown paid-provider outcomes pause for reconciliation rather than retrying automatically.
- Generation, deterministic finishing, QA, and export are independently resumable stages.
- Task-scoped temporary object prefixes and atomic final artifact plus manifest publication.

### Provider boundary

- An internal adapter exposes estimate, submit, status, cancel-if-supported, and result.
- Seedance 2.5 reference-to-video is the first benchmark route, not a permanent public product dependency.
- Reference inputs receive narrow roles: source video for motion/camera/timing, clean images for product or allowed identity, audio only when its timing or content is authorized.
- Captions, product proof, disclosures, and UI are deterministic finishing layers rather than generated in-frame text.

## First REST/OpenAPI Surface

- `POST /v1/references` — create upload or URL-ingestion intent
- `POST /v1/references/{id}/analyze` — start forensic analysis
- `GET /v1/references/{id}` — read normalized source and analysis status
- `POST /v1/reconstructions` — create from a reference and requested changes
- `PATCH /v1/reconstructions/{id}` — create a new Fidelity Map revision
- `POST /v1/reconstructions/{id}/estimates` — freeze a bounded cost estimate
- `POST /v1/reconstructions/{id}/generations` — confirm rights/spend and start a job
- `GET /v1/jobs/{id}` — status, progress, evidence, and outputs
- `POST /v1/jobs/{id}/cancel` — request cancellation
- `POST /v1/outputs/{id}/approve` — approve immutable export
- `GET /v1/outputs/{id}/download` — obtain a short-lived signed download

All create/mutate requests require idempotency keys. Webhooks are deferred until the durable job contract is proven; polling and resumable status are sufficient for Phase 1.

## Initial MCP Surface

Expose a remote Streamable HTTP MCP server after the Phase 0 gate. Keep the public allowlist outcome-oriented:

1. `analyze_reference`
2. `create_reconstruction`
3. `update_reconstruction`
4. `estimate_generation`
5. `generate_preview`
6. `get_job`
7. `approve_export`
8. `cancel_job`

The agent may analyze, draft, and revise without spend. Paid generation requires a current estimate and explicit confirmation bound to the immutable source plus Fidelity Map hash. OAuth scopes should remain coarse: read/analyze and create/generate. Every call is audited and revocable.

An optional MCP Apps UI can show inline job/approval cards and a fullscreen source-versus-output comparison. It is not required for the Phase 0 proof.

## Account, Billing, And Authority

- Humans sign in through WorkOS AuthKit.
- Agent clients use OAuth; server integrations may later use revocable workspace API keys.
- Server identity, never a caller-supplied user ID, determines workspace access.
- Analysis may have a small free allowance; every paid generation is estimated before spend.
- Reserve credits before dispatch, capture actual cost exactly once, and release unused holds on terminal failure.
- Bind approvals to source hash, Fidelity Map revision hash, provider class, duration, resolution, and maximum cost.
- Agents cannot waive rights attestations, expand identity/voice use, auto-publish, or increase the approved spend ceiling.

## Rights And Safety Baseline

- Require the user to confirm ownership, permission, or another valid right to use the reference.
- Default to “inspired reconstruction” for third-party trend references, not verbatim copying.
- Do not transfer a real person's face or voice without explicit authority.
- Detect and exclude logos, watermarks, private people, minors, licensed music, and verbatim dialogue unless authorized.
- Preserve source and output provenance, prompt/spec lineage, and generation metadata.
- Keep publishing external and human-approved in early phases.

## Existing Infrastructure To Reuse Deliberately

- Mobile Ad Agent: paid generation adapter patterns, cost estimation, Gemini video QA, and deterministic proof/caption finishing.
- Mission Control: video understanding and source-analysis orchestration patterns.
- Shared render architecture: durable leases, atomic publishing, deterministic finishing, and output manifests.
- Existing MCP/OAuth work: WorkOS/AuthKit identity, Streamable HTTP MCP, revocation, audit, and approval contracts.

Reuse should happen through extracted contracts or shared packages. Do not import another product's private application state or turn CloneUGC into a mode inside SeedViral.

## Explicitly Deferred

- consistent-character libraries;
- trend discovery or scraping feeds;
- team and agency workspaces;
- auto-posting to social platforms;
- a multi-provider model marketplace;
- a full nonlinear video editor;
- performance analytics and campaign optimization;
- directory submission to OpenAI or Anthropic;
- production Firebase, WorkOS, R2, Cloud Run, billing, or provider provisioning before the Phase 0 gate.

## Phase 0 Next Action

Obtain one permission-safe reference clip and one requested change from Joe. Freeze the benchmark schema and evaluation rubric, then run the first control-versus-compiler pair with full cost and provenance capture.
