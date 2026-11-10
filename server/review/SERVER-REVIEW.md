# Server review — 10 November 2026

Scope: `feat/server`, changes confined to `server/`. Read first: [instructions](../../AGENTS.md), [summary](../../SUMMARY.md), [rubric](../../RUBRIC.md), [proposal](../../resources/Embedded_Systems_Project.md), [English requirements](../../resources/Final_Project_Requirements_EN.md), local architecture/checklist/review notes, and [CBS](../../interface/CBS.md), [SBG](../../interface/SBG.md), [SUL](../../interface/SUL.md). Shared contracts remain unchanged.

## Coverage and changes

| Area inspected | Result |
| --- | --- |
| API and gateway authentication | Existing token lookup rejects ambiguous credentials and missing parent fridges. Added the missing CBS door-event route using transaction-scoped authentication. |
| Door events | Validates all seven statuses and the complete batch before writing. Atomic transactions and deterministic IDs preserve distinct same-second transitions while deduplicating concurrent retries. |
| Telemetry | Backfills preserve newer cached samples. Added a 10,000-sample bound, node ID limits and early rejection above 499 minute buckets. CBS timestamp-only deduplication remains unchanged. |
| Heartbeats | Existing validation bounds node count, rejects future timestamps and orders reports by C0's clock. Backward gateway clocks can suppress reports until the clock catches up. |
| Inventory/photos | Existing stable fingerprints, membership checks and private image paths remain. Photo component identity now includes user and fridge to prevent reuse of another fridge's image/error state. |
| Dashboard | Reviewed routes, listeners, bilingual labels, styling, charts and grouping. Invalid expiry dates now display as unknown instead of rolling into another month. |
| Rules | Verified members can read permitted subcollections; client writes, private config and raw Storage access remain denied. No rules were broadened. |
| Tests/build | Added standalone Functions validation tests and explicit unit/emulator commands. Lockfiles and dependency versions are unchanged. |
| Documentation/diagrams | Reviewed local Markdown and diagram sources; existing drawing exports were not regenerated. Architecture includes planned features as well as implemented paths. |

## Endpoint limits

`POST /api/door_events` implements CBS section 3.6 with gateway Bearer authentication. It accepts 1–499 events. Node IDs must be nonblank, have no surrounding whitespace and contain at most 128 characters. Timestamps are integer Unix seconds from zero through year 9999. Invalid batches write nothing.

Retry identity is `(node_id, timestamp_s, status)`. Different statuses or nodes in the same second survive. Two identical transitions in one second require a future event identifier to distinguish. Events are stored only under the authenticated fridge. LINE dispatch remains planned.

Telemetry accepts 10,000 samples across at most 499 UTC minute buckets, with the same node ID limits. Split larger offline queues into separate requests.

## Remaining priorities

1. **Notifications (M6):** LINE dispatch, registration, cooldowns and expiry scheduling are absent. SUL is empty. Define and approve that shared contract before implementing pairing, quotas and retries.
2. **Camera inventory:** All four CBS draft/commit routes and Gemini orchestration remain absent. Implement bounded images, output validation, FEFO, retries and inference metrics; confirm model/API configuration during integration.
3. **Multiple sensors:** CBS timestamp-only deduplication loses a second node's same-second sample. Coordinate an approved contract change to node plus timestamp. The dashboard needs sensor selection for independent inspection.
4. **Owner workflows:** Fridge creation, invitations, token provisioning/rotation, AI settings, expiry editing and checkout are absent. Keep settings private and make database/image deletion recoverable.
5. **Photo lifecycle:** Upload precedes the Firestore transaction; conflicts or failures can leave unreferenced objects. Cleanup must account for concurrent retries before deleting immutable images.
6. **Operational evidence:** Production indexes, bounded error diagnostics, gateway compatibility, real OAuth and 24-hour measurements remain to verify. The frontend still triggers Vite's bundle-size warning.
7. **Documentation:** Architecture/checklist describe the full target, not completed functionality. The Bun entry point remains a placeholder; use dashboard/Functions commands.

## Validation

Workspace dependency writes failed with filesystem errors, so builds used an isolated temporary copy of server sources and committed lockfiles. No deployment or remote Git operation occurred.

- Frontend strict TypeScript, five model tests and production build passed.
- Functions strict TypeScript and four validation tests passed.
- All three integration suites passed on Node 22.23.4 with Auth, Functions, Firestore and Storage emulators.
- New integration cases cover authentication, invalid-batch atomicity, concurrent retries, same-second transitions, tenant separation, ambiguous tokens and orphaned config. Existing telemetry/dashboard suites passed.
