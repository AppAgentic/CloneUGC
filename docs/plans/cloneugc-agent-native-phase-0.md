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
- ordered edit segments with exact start, end, duration, source-shot identity, and transition type;
- an evidence-backed creator-workflow plan: single-take versus multi-take/hybrid classification, independently recorded capture setups, global continuity anchors, per-shot GPT Image generation/edit strategy, per-shot video-generation units, provider-duration padding, deterministic trims, and final splice instructions;
- global and per-segment playback-rate classification (`real_time`, `sped_up`, `slowed_down`, `variable`, or `unknown`), estimated multiplier where defensible, confidence, and observed cues;
- hook, setup, escalation, payoff, and CTA beats;
- camera position, lens feel, framing, path, triggers, and screen-space subject position;
- subject count, identity policy, pose, blocking, gaze, gesture, and motion rhythm;
- an evidence-backed secondary-motion inventory for hair, loose fabric, accessories, foliage, particles/fluids, reflections, shadows, background motion, and vibration, with timestamped onset/direction/amplitude/cadence/damping and inferred physical driver;
- continuity invariants for face, hair, wardrobe, product geometry, hands, props, and occlusion;
- setting and clutter plus an evidence-backed lighting state: source positions/direction/hardness, temperature and mixed casts, exposure/contrast, shadow/highlight geometry, reflective response, timestamped dynamic light events, and phone-camera processing/texture;
- dialogue, room tone, contact sounds, music policy, and caption intent;
- starting and ending state for each beat;
- explicit Preserve, Change, Exclude, and must-not-transfer fields;
- rights and safety flags;
- confidence and evidence timestamps for every important inference.

Each revision is immutable and content-addressed. Generation estimates and approvals bind to the exact revision hash.

### Reusable Format Recipes

Once a reconstruction exposes a useful creative pattern, the user can save its structure as a versioned, content-addressed Format Recipe. A recipe stores the durable grammar—shot count and timing, creator capture setups, camera geometry, action order, transitions, playback-rate intent, lighting changes, deterministic caption/audio layers, and provider-duration requirements—without silently carrying over source identity, voice, music, logos, dialogue, or other rights.

The recipe declares a small set of prompt-controlled variables such as subject identity, gender presentation, before/after appearance states, wardrobe, setting, caption text, product promotion, and audio policy. A conversational request is resolved into those variables, then compiled into fresh per-shot anchor prompts, motion prompts, deterministic finishing instructions, an immutable plan hash, a new rights scope, and a bounded cost estimate. Unknown variables fail closed; changing one variable does not rewrite the locked format grammar.

The first validated recipe is `hand-wipe-fitness-transformation`: two independently generated real-time takes, one consistent identity, a hand-to-lens match transition, a before/after lighting change, and a deterministic hook caption plus audio payoff. It lives at `fixtures/formats/hand-wipe-fitness-transformation-v1.json` and proves that the Harrison format can be recreated with a different character, gender, wardrobe, setting, or app caption without re-analyzing the original video.

### Gemini video-understanding strategy

Use Gemini Agentic Video through the Files and Interactions APIs as the first forensic-analysis provider. The shared adapter is currently live on the exact model `gemini-3.7-flash`; Google's current guide also lists `gemini-3.8-flash`, and a same-day analysis-only canary verified that it supports the required Agentic Video contract. Before the corpus analysis bake-off, compare 3.7 and 3.8 on one permission-safe calibration clip using identical prompts and a blind annotation, then pin one exact model identifier across every lane and repeat. Never use a moving model alias or mix models inside the corpus benchmark. Keep processing mode explicit and persist the model, mode, latency, token breakdown, file provenance, interaction lineage, prompt version, and evidence timestamps with every candidate Fidelity Map.

For CloneUGC's short references, agentic processing is a targeted semantic precision pass rather than a blanket replacement for static inspection:

1. Normalize the analysis copy to a constant frame rate while preserving the original timebase mapping. Run deterministic media probes, scene detection, OCR, frame-cadence/duplication checks, and audio inspection first. Hard-cut timestamps and measured media properties come from these probes, with both normalized frame index and original-source timestamp retained. Playback-rate inference remains separate from the delivered file's nominal FPS: classify real-time, sped-up, slowed-down, variable-speed, or unknown from motion/gravity/settling, gait/blink cadence, motion blur, audio pitch/cadence, and duplicated/dropped-frame evidence.
2. Run a static broad pass to inventory the complete clip: shots, subjects, objects, text, audio, environment, coarse beats, global lighting state, and all secondary motion fields. Lighting evidence separates physical illumination from grading/camera processing and timestamps passing lights, flicker, moving shadows, reflections, and auto-exposure/white-balance/HDR changes. Secondary-motion evidence records causal chains from source to force to affected elements to visible response, rather than using clip-specific checks such as hard-coded hair movement. Benchmark default and higher static sampling rates because a short clip may get cheaper frame coverage without an agentic loop.
3. Escalate focused questions to Agentic Video for split-second gestures, periodic or fast motion, counting, speed ramps, freeze/reverse/loop hypotheses, ambiguous transitions, and the CloneUGC hypotheses that it may improve action causality, occlusion, and continuity-conflict analysis. Gemini labels and interprets detected cuts; it is not the timestamp system of record for unambiguous hard cuts. Fast subject movement must not be treated as sped-up playback without independent cues.
4. Generate follow-up questions from a versioned policy over unresolved evidence categories. A human who has watched the clip may not author lane-specific prompts.
5. Reuse the uploaded file and stateful interaction for follow-up questions instead of uploading or re-tokenizing the source independently for every dimension.
6. Persist the structured provider response and processing steps as a private evidence artifact before producing a bounded human-readable summary. The current shared CLI truncates summaries at 6,000 UTF-8 bytes, so its displayed JSON summary is useful for inspection but is not the durable Fidelity Map source.
7. Merge the structured outputs into an evidence graph before compiling the Fidelity Map. Every accepted claim must retain a timestamp or interval, normalized frame index where applicable, confidence, analysis mode, and source prompt. Conflicts and missing evidence remain explicit; disputed claims cannot reach the compiler.
8. If Agentic Video times out, is safety-blocked, exhausts its budget, or loses its interaction state, preserve the static map with an explicit degraded-analysis reason. An expired file may be re-uploaded under a new lineage event; it must never be silently treated as the same provider interaction.
9. Reconstruct how the creator made the artifact, not only what the flattened export contains. Camera/environment/wardrobe/equipment discontinuities define independently recorded setups even when a palm, whip, or object occlusion hides the cut. At confidence >=0.70, a multi-take classification prohibits compiling the whole source into one video-model request: create one rights-safe subject anchor, generate or edit a setup-specific frame for each take, animate each take independently, trim to its exact source interval, then reproduce the source cuts and persistent overlay/audio deterministically.

This routing is deliberate. Google's September 2026 Agentic Video release adds dynamic timeline navigation, adaptive frame rate and resolution, transcript/audio inspection, sub-second moment retrieval, anomaly detection, and action/object counting. Those published capabilities map directly to reconstruction forensics. Improved causality, occlusion, and continuity analysis remain CloneUGC hypotheses to test, while static processing remains faster and cheaper for broad coverage of a short clip.

## Phase 0: Prove The Compiler Before The Platform

### Corpus

Use three permission-safe 8–12 second vertical references:

1. selfie or dialogue performance;
2. movement or dance with meaningful camera/blocking;
3. natural product integration.

The first benchmark clip must still satisfy the rights and duration rules. A public social link may be analyzed to test ingestion and understanding, but it is not eligible for paid recreation until the user attests to sufficient rights. Clips longer than the product's 30-second limit must be rejected or physically trimmed to an explicitly selected permission-safe excerpt before any Agentic Video or generation request. The excerpt retains its offset into the original source.

### Analysis bake-off

Before seeing any model output or spending on generation, create a blind human annotation for each reference. The annotation must include cut/transition intervals, ordered segment lengths, global and per-segment playback-rate classes, speed-ramp/freeze/reverse/loop events, action events, repeated-action counts, continuity facts, lighting facts and dynamic-light events, secondary-motion fields and their physical drivers, on-screen text, audio/dialogue events, and rights-risk items. Then compare:

- **Static default:** deterministic probes plus one broad pass with the pinned Gemini Flash model at the default sampling rate;
- **Static high-FPS:** the same probes and prompt with static sampling at 5 FPS and 10 FPS, subject to the same resolution and cost accounting;
- **Hybrid:** the winning static configuration plus at most two policy-generated Agentic Video follow-ups, merged through the evidence graph.

Run each model lane at least three times per clip and report claim stability. Measure shot-boundary precision/recall at ±100, ±250, and ±500 ms; boundary and segment-duration mean absolute error; segment-count error; global and per-segment playback-rate accuracy plus answer coverage; transition-type accuracy; action-event timing error; Preserve/Change/Exclude schema completeness; continuity-fact precision/recall; lighting-fact recall; secondary-motion-fact recall; rights-risk recall; unsupported-claim rate; latency; input/output/thought/tool-use tokens; and estimated analysis cost. Pair segments by maximum chronological time overlap so one missed early cut does not shift every later score. `unknown` is an abstention: exclude it from accuracy and report the resulting coverage separately, so uncertainty is visible without rewarding guesses. Treat `variable` as a committed class that must match the annotation. Treat gradual transitions as annotated intervals rather than point events. An unsupported claim is one lacking a valid evidence interval/frame or contradicted by the blind annotation after adjudication.

Retain the exact model identifier, prompts, raw provider interactions, deterministic-probe outputs, hashes, and run IDs so disagreements can be audited. Provisional interactive budgets are no more than two agentic follow-ups, $0.05 total analysis cost per reference, and 45 seconds p95 end-to-end analysis latency; Phase 0 replaces these with measured ceilings before product scaffolding.

Select the hybrid lane only if its sub-second motion, causality, counting, occlusion, or continuity evidence improves against the human annotation without increasing unsupported claims or breaching the budgets. If it does not, keep the winning static configuration for that reference family and route Agentic Video only when a user's question requires it. Three reference clips remain a deliberately thin thesis test, not a production-quality claim.

### Comparison

For each reference, produce two otherwise controlled variants:

- **Control:** the reference plus a concise direct change request;
- **Compiler:** the same reference and requested change, compiled from the Fidelity Map into explicit reference roles, starting state, timestamped primary and secondary motion with physical drivers, camera geometry, evidence-backed lighting geometry and dynamic events, continuity, audio, ending state, and constraints.
- **Workflow compiler:** for references classified as high-confidence multi-take, the compiler lane must additionally use one independently auditable generation unit per source shot/setup. A one-request whole-timeline render is an invalid compiler output for this family, not merely a lower-quality variant.

Start at 480p to test composition and reference weighting cheaply. Re-run only winning seeds at 720p. Preserve provider request IDs, seeds, exact prompts, source/spec hashes, cost, duration, and outputs.

Freeze one selected analyzer configuration and its evidence-backed Fidelity Map before the generation comparison. The control lane receives the source plus concise change request; the compiler lane additionally receives the compiled Fidelity Map by definition. Do not vary analyzer configuration between generation lanes, because that would confound analyzer quality with the intended raw-request-versus-compiler test.

### Blind evaluation

Use at least three scorers and score each pair without revealing which lane produced it. A clip-level compiler win requires a majority preference plus a higher median rubric score with no rights/safety regression. Score:

- shot and beat timing;
- edit-segment lengths, transition types, and playback-rate fidelity, including speed ramps and real-time motion;
- camera geometry and movement;
- blocking, action causality, and physical settling;
- secondary-motion fields and environmental causality;
- subject, object, wardrobe, and environment continuity;
- lighting, texture, and natural imperfection;
- audio rhythm and dialogue performance;
- success of the requested change;
- absence of unwanted reference transfer;
- commercial usability without source-specific manual prompt rewriting.

### Pass gate

Proceed to product scaffolding only if:

- the compiler lane wins at clip level across all three reference families;
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
- `POST /v1/formats` — save a validated reconstruction's structure as a reusable Format Recipe
- `GET /v1/formats/{id}` — read a recipe and its prompt-controlled variables
- `POST /v1/formats/{id}/instantiate` — resolve a user prompt into a new immutable reconstruction plan and estimate
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
9. `list_formats`
10. `instantiate_format`

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
- Before sending user media to Gemini, approve provider data-use terms for the selected paid or enterprise tier, define a bounded retention period, and keep provider file plus interaction handles workspace-scoped.
- Delete provider-side files and invalidate cached handles on user deletion, rights revocation, retention expiry, or failed ingestion. Never reuse a file or interaction handle across workspaces.

## Existing Infrastructure To Reuse Deliberately

- Mobile Ad Agent: paid generation adapter patterns, cost estimation, Gemini video QA, and deterministic proof/caption finishing.
- Mission Control: the shared `mc video-analyze` Gemini 3.7 Flash path, static-first/intent-driven Agentic Video routing, streamed uploads, provider-expiry caching, stateful follow-ups, bounded concurrency and agentic budgets, and persisted provenance.
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

Obtain one permission-safe 8–12 second reference clip and one requested change from Joe. First produce its human-audited annotation and run the static-versus-hybrid analysis bake-off. Freeze the winning evidence-backed Fidelity Map, benchmark schema, and evaluation rubric, then run the first control-versus-compiler generation pair with full cost and provenance capture.
