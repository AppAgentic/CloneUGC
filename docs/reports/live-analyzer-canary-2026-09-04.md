# Live analyzer transport canary — 2026-09-04

Status: passed for transport/provenance only. This is not the three-family Phase 0 quality gate.

## Scope

- Source: permission-safe `instagram-DcqCAe_Jl9o` reference already used in the CloneUGC thread
- Source SHA-256: `719d4d3f9fb1118cb54a13127cc5a5f41c4bd2561a6a33d81161448c82bafdc7`
- Exact model: `gemini-3.8-flash`
- Mode: Agentic Video
- Pricing snapshot: Google introductory pricing checked 2026-09-04 — $0.75 per million input tokens and $3.75 per million output tokens including thinking, through 2026-12-31
- Pricing source: <https://ai.google.dev/gemini-api/docs/pricing>

## Shared boundary canary

- Provider interaction: `v1_ChdQbWlhYXJXRkFyZmw3TThQM0tySS1RVRIXUG1pYWFyV0ZBcmZsN004UDNLckktUVU`
- Agentic processing calls/results: 8 / 8
- Tokens: 1,301 initial input; 28,043 tool use; 1,258 output; 1,756 thought; 32,358 total
- Estimated cost from the captured pricing snapshot: $0.03331050
- Private evidence artifact SHA-256: `3187b62b56e4c01e6e8859d12c980474c2e45fa43e6b86974b721f14e0079e0e`
- Evidence permissions: `0600`
- The response correctly recovered the rear-follow camera, initial backward reveal, overhead stretch, stationary hold, arm lowering, and forward camera tracking as the subject walks into the gym.

## CloneUGC adapter-to-runner canary

- Unit: `analysis-e959ed72b3c58a7434ac30f6`
- Provider interaction: `v1_ChdlbWlhYXEtTERiR2czYm9QemF5VWdRRRIXZW1pYWFxLUxEYkdnM2JvUHpheVVnUUU`
- Agentic processing calls: 7
- Total tokens: 28,275
- Estimated cost from the same pricing snapshot: $0.03376425
- Lossless exchange SHA-256: `3bb908cdb7f6cdfd8fe6776a23c643e5f85135148c0564e80a971755f2649852`
- Parsed structured payload SHA-256: `8c2ebffb97e50af92e0dd3156adfa38046ec8878984fec4a53fdcb7a1da6e154`
- Runner result: succeeded; two artifacts were written to the configured in-memory canary store before return; eligible for Fidelity Map materialization; explicitly ineligible to drive paid generation without the later map/rights/spend gates. Durable object-store wiring remains a later infrastructure task.

Total estimated canary spend: $0.06707475 across two explicitly separate Agentic analysis calls.

## Exact static-FPS canaries

The same source and prompt were also used to exercise the benchmark-only 5fps route:

- Shared boundary interaction: `v1_ChZBV21hYW9saWpPM0d6UV9odnBqWURnEhZBV21hYW9saWpPM0d6UV9odnBqWURn`; 4,369 total tokens; 6,689ms; evidence SHA-256 `9536c24c48244ff7ba5b2f31f9a714267f08caa2ce1ea8a6c4aeeaa2220649ac`; estimated cost $0.00599175.
- Adapter-to-runner interaction after the explicit-zero telemetry fix: `v1_ChdUbW1hYW9QWEhzT1MzYm9Qc0pIRmtBRRIXVG1tYWFvUFhIc09TM2JvUHNKSEZrQUU`; unit `analysis-eedc72be3790326b0a704216`; 4,763 total tokens; lossless exchange SHA-256 `85f3893c5f000e98c9f3fe75e758a8ae0e58a761fe767b409de838632bf0b107`; structured payload SHA-256 `fcf84f3e986c59e86e01133b6c80e1bfc6ec2e0b87e673c28e1389d78d2820ad`; estimated cost $0.00746925.
- The provider accepted `processing: {"type":"static","fps":5}`. CloneUGC preserved `samplingFps: 5`, correctly recorded zero Agentic processing calls, and marked the static output ineligible for Fidelity Map materialization and paid generation.

Total estimated spend for all four transport canaries: $0.08053575.

## What this proves

The production analysis transport is live and fail-closed: exact source/model/mode identity, complete request/response bytes, interaction lineage, usage telemetry, pricing lineage, and private artifact hashes survive the shared CLI-to-CloneUGC boundary. It does not prove analysis quality across the required dialogue, movement, and product-integration corpus; that remains dependent on blind annotations and the complete repeated bake-off.
