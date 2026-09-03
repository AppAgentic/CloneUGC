# CloneUGC Agent-Native Product Plan

Status: proposed for approval

Prepared: 2026-09-03
Supersedes: nothing; this plan turns the Phase 0 thesis into a gated product roadmap.

## Decision summary

CloneUGC should be a reconstruction compiler with a durable paid-job system behind it, not a thin wrapper around video models.

The primary product experience is conversational: a user gives ChatGPT, Claude, Codex, or another MCP client a video link or upload and asks to preserve or change parts of it. CloneUGC analyzes the reference, proposes an editable reconstruction, obtains exact rights and spend authority, creates the media, compares the result with the reference, performs targeted repairs, and saves reusable formats.

The standalone web app is the control plane for media-heavy and authority-bearing work: uploads, visual Preserve/Change editing, synchronized comparison, rights and identity permissions, billing, formats, outputs, audit, and recovery. Provider names remain internal.

The existing work is enough to approve a narrow headless kernel now. It is not yet enough to claim that generalized reference analysis reliably produces high-fidelity reconstructions. The product gate therefore has two independent parts:

1. reconstruction fidelity across representative reference families; and
2. repeatable format re-instantiation from a validated Fidelity Map.

Do not scaffold the customer web app or launch multi-tenant paid generation until those gates pass. Build the low-regret domain and job kernel while completing the evidence close-out.

## 1. Product mandate

### User promise

> Give CloneUGC a permission-safe short-form video, say what to preserve and what to change, approve a bounded cost, and receive a faithful, editable reconstruction plus evidence showing how it compares.

### What the agent owns

The agent may autonomously:

- ingest a URL or prepare an upload;
- normalize and inspect media;
- draft and revise a Fidelity Map;
- infer creator workflow, shots, transitions, playback rate, lighting, secondary motion, identity continuity, and deterministic overlays;
- create a reconstruction plan and reusable format draft;
- choose internal providers and generation-unit boundaries;
- estimate cost without spending;
- read QA evidence and propose repairs;
- reuse accepted artifacts when a revision does not invalidate them.

### What the human owns

The human must authorize:

- rights to use the reference and protected elements;
- identity or voice use when applicable;
- spend for a specific immutable estimate and ceiling;
- export or publication of a specific output when required by policy.

These authorities are server-minted, expiring approval records bound to content and spec hashes. Agents cannot mint them, broaden their scope, raise their ceiling, or reuse them against a changed reconstruction.

Standing per-job or daily budgets may later be configured in the standalone web app. They are not granted through natural-language MCP calls.

## 2. Product experience

### Conversational happy path

1. The user pastes a link or attaches a video.
2. CloneUGC returns a concise analysis: narrative, shot/take boundaries, timing, real-time versus altered speed, identity relationships, motion, lighting, audio, text, and rights-sensitive elements.
3. The user says what to change, such as a different identity, wardrobe, gender, product mention, or caption.
4. CloneUGC returns a Preserve/Change/Exclude summary and a bounded generation estimate.
5. The user completes rights and spend approval.
6. CloneUGC generates independent units, deterministically finishes them, and returns progress without keeping the MCP request open.
7. CloneUGC presents reference versus result, structured fidelity findings, and the cheapest useful repair options.
8. A requested repair creates a new immutable revision and reruns only invalidated units.
9. The user exports the result or saves the creative structure as a reusable Format Recipe.

### UI boundary

Use chat for intent, delegation, status, iteration, and simple approvals. Use visual UI only where it materially improves comprehension or authority:

- inline MCP App cards: analysis summary, Preserve/Change diff, estimate, approval deep-link, job status;
- fullscreen MCP App view: synchronized source/result scrubbing, timeline mismatches, dimension scores, repair selection;
- standalone web: resumable uploads, rights and identity authorization, billing and standing budgets, format/output library, agent connections, audit log, and stuck-job recovery.

Any surface that mints authority lives in the standalone web app. An MCP App may show the state and deep-link to it, but does not create its own approval path.

All public tools must remain fully usable without the optional UI, consistent with OpenAI's current plugin guidance.

## 3. Public MCP surface

Expose one remote Streamable HTTP endpoint, `/api/mcp`, backed by the same application services as the future REST surface. Start with two coarse OAuth scopes: `cloneugc:read` and `cloneugc:write`. Spend remains an application-level approval, not an OAuth scope.

Every mutating tool accepts an idempotency key. Every response returns stable IDs and the immutable hashes it acted on. Long-running tools return a job ID immediately.

### Launch tools

| Tool | Outcome | Important behavior |
|---|---|---|
| `create_reference` | Register a URL or create a signed upload intent | Never accepts arbitrary storage keys; returns `referenceId` |
| `analyze_reference` | Produce a versioned Fidelity Map and evidence | Async; reports degraded-analysis reasons explicitly |
| `get_reference` | Read normalized facts, rights state, and analysis state | Read-only |
| `create_reconstruction` | Draft a reconstruction from a reference or format plus natural-language changes | Returns immutable revision and Preserve/Change/Exclude summary |
| `revise_reconstruction` | Apply natural language or a structured directive patch | Creates a child revision; never mutates in place |
| `estimate_generation` | Compile provider-neutral units and a bounded cost | Binds estimate, plan, reconstruction, and expiry hashes |
| `generate` | Start an approved paid job | Requires matching rights and spend authority; fails closed |
| `get_job` | Read stage, per-unit progress, outputs, and failure/recovery state | Polling first; webhooks later |
| `cancel_job` | Request cancellation | Stops unsubmitted work; never pretends an in-flight provider call was cancelled |
| `compare_output` | Return structured, timestamped fidelity findings | Includes evidence and affected generation units |
| `repair_output` | Propose a scoped repair and new estimate | Does not spend; reuses unaffected accepted artifacts |
| `save_format` | Save a validated reconstruction structure as a versioned recipe | Separates structure from variable content |
| `list_formats` | Discover reusable formats | Read-only and filterable |
| `instantiate_format` | Create a reconstruction draft from a recipe and variables | Returns a revision/plan, not a paid job |
| `approve_export` | Bind export authority to an output hash | No implicit publishing |
| `get_export` | Return a short-lived download URL and manifest | Workspace scoped |

This is the complete conceptual surface, not necessarily sixteen separate launch buttons. During schema design, combine only operations that share one authorization and confirmation boundary. Do not create a mode-heavy generic tool.

Expose read-heavy objects as MCP resources where client support is useful:

- `cloneugc://references/{referenceId}`
- `cloneugc://fidelity-maps/{fidelityMapId}`
- `cloneugc://reconstructions/{reconstructionId}/revisions/{revisionId}`
- `cloneugc://jobs/{jobId}`
- `cloneugc://formats/{formatId}/versions/{version}`

## 4. Core domain contracts

Retain the existing `ReferenceAsset`, `EvidenceArtifact`, `FidelityMap`, and `FormatRecipe` foundations. Add the missing product contracts before server or UI code:

- `Reconstruction`: reference/format lineage and immutable revision chain;
- `ReconstructionRevision`: normalized Preserve/Change/Exclude directives, user intent, affected dimensions, parent hash;
- `CompiledPlan`: provider-neutral generation units, dependencies, deterministic finishing, invalidation graph, content hash;
- `GenerationEstimate`: revision and plan hashes, unit cost breakdown, maximum cost, currency, expiry, policy assumptions;
- `RightsRecord`: source-content hash, protected-element scope, attester, expiry/revocation;
- `ApprovalToken`: authority type, exact bound hashes, ceiling, subject/workspace, expiry, single-use state;
- `GenerationJob`: immutable inputs, state machine, reservation, stage progress, terminal reason;
- `TaskLease`: owner, version, heartbeat, expiry;
- `ProviderCall`: job/stage/unit/attempt key, submission state, provider receipt, actual cost, reconciliation state;
- `Asset`: content-addressed object metadata, workspace, provenance, lifecycle policy;
- `QAReport`: structured scores, timestamped findings, evidence, affected dimensions/units, repair recommendations;
- `OutputArtifact`: master hash, deterministic finishing manifest, QA report, export lineage;
- `LedgerEntry`: reserve, capture, release, adjustment with exactly-once key;
- `AuditEvent`: actor, authority, object hashes, action, time, result.

### Required contract corrections

- Move provider minimum duration out of `FormatRecipe`; resolve it inside the provider adapter during estimation.
- Remove named model/provider guidance from public and durable provider-neutral schemas.
- Replace free-text-only changes with typed target dimensions and generation-unit impact while retaining natural-language intent.
- Make QA machine-readable rather than markdown-only.
- Require validated recipes to cite a real Fidelity Map hash, not only a run manifest or evidence hash.
- Add cost, rights scope, and approval binding to the generation eligibility check.

## 5. Architecture

### Control plane

- Next.js and TypeScript after the product gate;
- Firebase App Hosting for the web/API control plane;
- WorkOS AuthKit from the first authenticated product phase;
- one personal workspace per user initially, with organization expansion later;
- Firestore for product state, immutable revisions, leases, outbox, ledger, and audit events;
- Cloud Tasks for durable dispatch and scheduled reconciliation;
- private Cloudflare R2 objects with short-lived signed URLs;
- remote MCP over Streamable HTTP;
- REST/OpenAPI generated from the same service layer only when needed.

### Worker plane

- Cloud Run workers, separated by workload and timeout profile;
- ingest/normalize worker;
- source-forensics worker;
- image/video generation workers through provider-neutral adapters;
- deterministic FFmpeg finishing worker;
- comparative QA and repair-planning worker;
- provider-call reconciliation worker;
- asset lifecycle/cleanup worker.

### Service boundaries

1. Reference service: provenance, rights state, upload/link intake, normalization.
2. Forensics service: deterministic evidence, multimodal analysis, evidence reconciliation, Fidelity Map versions.
3. Reconstruction compiler: intent and recipe compilation, unit graph, invalidation graph, deterministic finishing plan.
4. Estimate and authority service: bounded estimates, rights/spend/export approval records.
5. Job orchestrator: durable state machine, leases, outbox, cancellation, recovery.
6. Provider adapter registry: estimate, submit, status, cancel, retrieve; never leaks provider naming publicly.
7. Asset service: streaming upload/download, content hashes, signed URLs, retention.
8. Render service: deterministic overlay, captions, audio, cuts, muxing, validation.
9. QA/repair service: source/result comparison, structured findings, minimal invalidation.
10. Format registry: save, validate, version, instantiate, and deprecate reusable formats.

## 6. Paid-job state machine

The paid rail is part of the product, not later infrastructure.

### Job creation

1. Authenticate the caller and derive workspace/actor on the server.
2. Validate reconstruction, plan, estimate, rights, spend authority, expiry, and exact hashes.
3. In one Firestore transaction, create the job, reserve the estimate ceiling, consume or lock the spend authority, and write an outbox event.
4. A dispatcher converts the outbox event to a Cloud Task. Re-delivery is expected and safe.

### Worker execution

1. Claim a stage with a conditional lease update.
2. Heartbeat while working; a worker that loses the lease must stop publishing.
3. Stream inputs into a task-scoped temporary prefix.
4. Before each paid request, create a unique `ProviderCall` keyed by job, stage, unit, and attempt.
5. Compare-and-set the call through `reserved -> submitting -> submitted` and persist the provider receipt.
6. If the request outcome is unknown, mark it `unknown` and reconcile by provider request ID. Never automatically resubmit an unknown call.
7. Capture actual cost exactly once for a completed provider call.
8. Publish stage assets only after validation; publish the final artifact and manifest atomically.
9. Release unused reservation only when the job is terminal.

### Resumability and repair

Stages are independently resumable: source anchors, one generation unit per shot/take, deterministic finishing, QA, and export. Assets are content-addressed. A repair creates a new reconstruction revision, recomputes the invalidation graph, and reuses unaffected accepted artifacts byte-for-byte.

### State outline

`draft -> awaiting_rights -> awaiting_spend -> queued -> running -> qa -> succeeded`

Terminal alternatives: `failed`, `cancelled`, or `needs_attention`. A provider call with unknown outcome puts only the affected stage into reconciliation; it must not trigger duplicate spend.

## 7. Fidelity intelligence

The durable intelligence layer has four parts:

1. Evidence graph: deterministic and model-derived claims with timestamps, confidence, provenance, and conflict state.
2. Fidelity Map: versioned description of narrative, identity relationships, shots/takes, timing, speed, motion, lighting, audio, overlays, creator workflow, risks, and Preserve/Change/Exclude intent.
3. Reconstruction compiler: turns the map and user changes into independent generation units, prompts, anchors, deterministic finishing, and invalidation rules.
4. Comparative QA: evaluates source and result on matched timestamps/dimensions and proposes the smallest repair.

Analysis should default to one pinned economical multimodal configuration plus deterministic FFmpeg evidence. Agentic follow-up is invoked only for ambiguity or failed evidence coverage. Avoid hard-coded content-specific heuristics such as exercise rep counts; represent general signals such as periodic motion, optical-flow cadence, audio/visual tempo disagreement, and edit boundaries.

Sensitive morphology and identity instructions require policy review and neutral, observable language before customer launch. Do not infer medical diagnoses or hidden attributes.

## 8. Reusable formats

Format Recipes are a launch wedge, not a later add-on. The recent creative work already demonstrates the value of separating a reusable structure from variable content.

A validated recipe contains:

- source Fidelity Map and reconstruction revision hashes;
- semantic variables and constraints;
- identity continuity rules;
- shot/take templates and relative timing;
- transition and creator-workflow structure;
- lighting and secondary-motion expectations;
- deterministic overlay/audio/caption layers;
- generation-unit graph and invalidation rules;
- validation history, QA thresholds, and compatible provider capabilities;
- version and content hash.

Instantiation always produces a new reconstruction revision and estimate. It never spends automatically. Formats are private to a workspace initially; sharing/marketplace behavior is deferred.

## 9. Phased delivery

### Phase 0A — evidence close-out

Goal: prove the analysis-to-reconstruction path, not only manually authored recipes.

- Run the current analyzer on at least three existing permission-safe source clips across distinct families.
- Materialize real Fidelity Maps that pass the contract validator.
- Re-derive at least three existing formats from Fidelity Map hashes.
- Collect blind human annotations and run one raw-request versus compiler pair per family.
- Use three blind scorers and structured per-dimension QA.
- Record unit cost and latency for every paid generation unit.

Gate:

- the existing Phase 0 fidelity criteria pass;
- every validated recipe cites a validator-accepted Fidelity Map hash;
- recipe re-instantiation preserves structure while changing requested variables;
- no critical identity/narrative/cut/timing fact is absent from the compiled plan.

### Phase 0B / Phase 1 — headless kernel

This may begin now in parallel because it is low-regret and makes the evidence reproducible.

- Add the missing domain contracts and typed repair semantics.
- Implement the reconstruction compiler and invalidation graph as a package.
- Implement job/lease/outbox/ledger/provider-call state machines against emulated Firestore.
- Add fake analyzer, provider, asset, and render adapters.
- Replace proof-script orchestration with a CLI over the kernel; do not delete evidence scripts until replay parity is proven.
- Replay one accepted historical run and reproduce its plan/content hashes.

Gate:

- chaos tests for duplicate delivery, worker death, lease loss, and lost provider response show zero duplicate spend;
- deterministic replay yields the same compiled plan hash;
- a repair invalidates only intended units;
- all current contract and format tests remain green.

### Phase 2 — private live route

- Add one analyzer route, one image route, one video route, deterministic finishing, and QA through provider-neutral adapters.
- Add R2 private assets, Cloud Tasks, and Cloud Run workers.
- Use manual/internal approval records before customer billing.
- Run internal canaries on the validated benchmark families.

Gate:

- bounded estimates match or exceed actual cost on every canary;
- no duplicate provider submissions;
- interrupted jobs resume or enter explicit reconciliation;
- source and output retention/deletion policies work end to end.

### Phase 3 — authenticated MCP beta

- Add WorkOS identity and workspace isolation.
- Ship the Streamable HTTP MCP server and workflow skill.
- Implement exact rights/spend approval tokens and audit.
- Validate from at least two independent MCP clients.

Gate:

- the complete link/upload -> analyze -> revise -> estimate -> approve -> generate -> compare -> repair -> export loop works from two clients;
- unauthorized or hash-mismatched spend always fails closed;
- public responses contain no provider names;
- reconnecting a client does not lose job state.

### Phase 4 — minimal web control plane

- Resumable uploads, rights/identity permissions, billing, formats, outputs, audit, agent connections, and recovery.
- Keep creation conversation-first; do not build a full timeline editor.

Gate:

- a user can recover a stuck or interrupted job without operator intervention;
- workspace isolation and signed-URL expiry pass security tests;
- a non-agent entry point can complete the essential flow.

### Phase 5 — MCP Apps visual surfaces

- Inline diff, estimate, approval-status, and job cards.
- Fullscreen synchronized comparison and scoped repair selection.
- Reuse the same APIs and approval paths as headless clients.

Gate:

- UI and headless clients produce identical object hashes and authority checks;
- every visual repair action maps to a typed directive patch.

### Phase 6 — scale and distribution

- usage billing, quotas, retention controls, operational dashboards, provider failover, policy review, abuse controls;
- webhook/event delivery after polling is proven;
- ChatGPT directory readiness and broader client documentation;
- team workspaces and shared formats only after personal-workspace isolation is mature.

## 10. Evaluation and observability

Measure the complete product, not only model quality:

- analysis recall for shots, cuts, speed, motion, lighting, identity relationship, overlays, and audio;
- compiler fidelity versus a raw-request control;
- narrative and identity continuity;
- timing/edit-structure match;
- format re-instantiation reproducibility;
- repair precision: accepted units reused versus unnecessarily regenerated;
- estimate ceiling versus actual cost;
- duplicate paid-call count, target zero;
- time to first analysis, generation latency, and recovery time;
- completion rate per client and per workflow stage;
- user acceptance without repair and after one repair.

Every model-derived claim and QA score retains model/prompt version, source evidence, timestamp, and confidence. Every paid call retains an immutable provider receipt and cost record.

## 11. Security, rights, and media lifecycle

- Derive actor and workspace from verified OAuth; never trust caller-supplied ownership fields.
- Use OAuth 2.1 metadata/discovery and PKCE-compatible clients.
- Keep private beta client registration narrow; add dynamic client registration only when distribution requires it.
- Use short-lived signed URLs, workspace-scoped object keys, content hashes, and task-scoped prefixes.
- Reject SSRF-prone URLs and validate downloaded content type, size, duration, and codec.
- Never silently reproduce a real identity, voice, watermark, logo, licensed dialogue, or music.
- Support deletion and retention policies across source, temporary, provider, and output assets.
- Keep provider file handles workspace scoped and expiring.
- Audit every authority mint, use, revocation, generation, repair, export, and deletion.

## 12. Explicit deferrals

Do not build these before the relevant gate:

- a broad REST API separate from the MCP service layer;
- a customer-visible provider/model picker;
- a full browser timeline editor;
- format marketplace or public sharing;
- team/enterprise workspace complexity;
- automatic social publishing;
- webhooks before polling/recovery is proven;
- dynamic MCP client registration before distribution requires it;
- multi-provider optimization before one route is reliable and measured.

## 13. Reconciliation with the independent Claude review

The independent review agreed with the core architecture: immutable revisions, evidence-gated compilation, one unit per shot/take, deterministic finishing, coarse OAuth scopes, polling before webhooks, content-addressed reuse, and exact-once paid rails.

It changed the roadmap in four material ways:

1. Treat Format Recipes as an early commercial wedge because that is what the current evidence most strongly validates.
2. Add estimate, approval, job, provider-call, output, and structured-QA contracts before any server or UI.
3. Split the old Phase 0 gate into reconstruction fidelity and recipe reproducibility.
4. Approve only the headless kernel before the evidence gate; defer Next.js, WorkOS, billing, and hosted multi-tenant generation until it passes.

It also found that current recipes are manually authored and generally cite manifests/evidence rather than validator-produced Fidelity Maps. Existing results are valuable product evidence, but they do not yet prove the complete analyzer -> Fidelity Map -> compiler path. This plan closes that gap explicitly.

## 14. Immediate approval package

Approval of this plan authorizes only Phase 0A and the Phase 0B/Phase 1 headless kernel. It does not authorize paid generation, cloud provisioning, customer web scaffolding, authentication setup, billing setup, deployment, or directory submission.

The first implementation slice should produce:

1. missing domain contracts and validation tests;
2. typed directive targeting and repair invalidation;
3. provider-neutral compiled plans and estimates;
4. fake-provider durable job rails with chaos tests;
5. three real Fidelity Maps linked to three existing recipes;
6. a benchmark report and explicit go/no-go decision for the private live route.

## Sources

- Existing CloneUGC Phase 0 plan and contracts in this repository.
- OpenAI, [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins).
- OpenAI, [Define tools](https://developers.openai.com/plugins/plan/tools).
- OpenAI, [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server).
- OpenAI, [Add UI to your plugin](https://developers.openai.com/plugins/build/chatgpt-ui).
- OpenAI, [Authentication](https://developers.openai.com/plugins/build/auth).
- Independent Claude Code architecture review, session `55e4eab9-b73b-4299-9b82-e5891e1ad981`, run read-only on 2026-09-03.
