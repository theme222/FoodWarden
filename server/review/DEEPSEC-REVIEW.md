# Deepsec AI review — FoodWarden server

Date: 2026-11-15. Reviewed source commit: `4e81004bcd167fb79902bf6ce7a16b961c5f8b79`.

## Result and scope

Deepsec 2.3.12 ran AI processing using the user-approved `gpt-6.1-sol`, Codex CLI 0.169.0, local ChatGPT subscription authentication, reasoning `xhigh`, concurrency 1. No new API key, Vercel deployment or cloud resource changes were required.

The final pattern scan produced 79 candidate matches across 29 files. A static snapshot supplied 43 first-party TypeScript/TSX and migration files as context. The main AI run was `20261115035222-2b048eb11dae461f`, with 9 findings: **0 Critical, 0 High, 4 Medium, 1 High Bug and 4 Bug**. High Bug and Bug are correctness/reliability labels, not vulnerability severities. These counts describe tool output, not a security certification.

The CLI marked 29 target records analyzed, but its own response explicitly skipped `vite.config.ts` and `skills-lock.json`, absent from the initial snapshot. A separate supplied-context pass (`20261115040612-bb40ce1b28daeed3`) then reviewed both files with their related public build configuration: 2 analyses, 0 additional findings. The combined passes cover all 29 candidate files; the initial main pass alone does not.

The nine findings below were checked against the current source by the parent reviewer. All have static support, with prerequisites and scope qualified below. No live exploit, concurrent-request PoC, production attack, paid Gemini request or LINE push was performed. No automatic Deepsec revalidation pass ran.

## Findings

### 1. Established WebSockets can retain access after authorization ends

- Deepsec classification: **MEDIUM**, confidence high.
- Source: [workers/durable-objects/fridge-room.ts](../workers/durable-objects/fridge-room.ts#L20).
- Tool finding: The Worker authenticates the handshake, but socket attachments contain no session identity or expiry, and broadcasts never recheck session validity or membership. A client retaining its socket continues receiving new private events after its session expires or is signed out or revoked. Membership removal also has a race: a handshake authorized before removal can reach the Durable Object after the member_revoked broadcast and remain connected indefinitely. Failed revocation notifications are discarded by notifyFridgeRoom, with no subsequent authorization check to recover.
- Source review: Source-supported: attachments contain email/fridge/connection time, but no session ID or expiry. Broadcasts use existing sockets without reauthorization. Membership removal has a best-effort close; session expiry/logout and a delayed handshake remain distinct gaps. No live socket exploit was run.
- Recommended change: Bind sockets to verified session identities and enforce session expiry and revocation. Recheck current membership when accepting sockets and before subsequent private delivery, and make membership revocation durable and ordered with connection acceptance.

### 2. An in-flight membership request can restore a revoked owner's access

- Deepsec classification: **MEDIUM**, confidence high.
- Source: [workers/index.ts](../workers/index.ts#L495).
- Tool finding: The members endpoint checks ownership before awaiting the request body. An owner can begin a request and delay completing its JSON body until another owner removes or demotes them. Completing that request with their own email and role 'owner' then reaches upsertFridgeMember, which performs the write without checking the caller's current membership. The account can regain ownership after revocation. This requires owner access when the request begins.
- Source review: Source-supported TOCTOU: requireFridgeRole runs before awaiting the JSON body; upsertFridgeMember receives no acting-user identity. Exploitation requires a caller who was an owner when the request began. Slow-body behavior and timing were not exercised on production.
- Recommended change: Pass the acting user's identity into the mutation and require current ownership within the same atomic SQL operation that changes membership. Parsing the body before authorization reduces the delay window but does not replace an atomic authorization check.

### 3. Self-provisioned gateways can consume shared Gemini credits without quotas

- Deepsec classification: **MEDIUM**, confidence high.
- Source: [workers/index.ts](../workers/index.ts#L270).
- Tool finding: Any verified user can create a fridge and retrieve its gateway token through owner settings. Both AI draft endpoints accept that token and invoke Gemini without application-level rate limits, spending quotas, or concurrency limits. resolveFridgeGeminiKey falls back to the server-wide GEMINI_API_KEY when no fridge key is configured. Where that fallback is enabled, an attacker can repeatedly submit valid images using self-provisioned fridges, exhausting shared credits or provider quota and affecting other tenants.
- Source review: Conditional exposure: an ordinary verified account can provision a fridge and obtain its token. The shared-key impact requires GEMINI_API_KEY to be configured. No application quota was found on these paths; provider/account limits may cap impact. No paid inference or quota exhaustion was attempted.
- Recommended change: Enforce durable per-user and per-fridge inference quotas, concurrency limits, and a global spending ceiling before invoking Gemini. Aggregate limits across fridges so creating additional fridges cannot bypass them.

### 4. Multipart size limits are enforced after the entire body is parsed

- Deepsec classification: **MEDIUM**, confidence high.
- Source: [workers/lib/ai-inventory.ts](../workers/lib/ai-inventory.ts#L71).
- Tool finding: parseMultipartJpeg calls request.formData() before checking the selected image's size. A gateway-token holder can submit an oversized image or large additional multipart fields, forcing the Worker to parse and materialize data far beyond the advertised 5 MB limit before rejection. Additional fields are never included in the size check. Gateway tokens are obtainable through ordinary fridge creation, making this a resource-exhaustion path for a registered attacker.
- Source review: Source-supported late validation: formData materializes the multipart input before checking the image Blob, and additional fields are not budgeted. Cloudflare platform limits still apply; platform-wide denial of service is not demonstrated. Requires a valid gateway token.
- Recommended change: Enforce a total request-byte budget while consuming the body, before materializing FormData. Include multipart overhead and extra fields in that budget; Content-Length checks alone are insufficient.

### 5. Concurrent membership changes can remove every owner

- Deepsec classification: **HIGH_BUG**, confidence high.
- Source: [workers/lib/fridges.ts](../workers/lib/fridges.ts#L265).
- Tool finding: Owner preservation is checked using reads separate from the membership writes. With two owners, concurrent requests demoting or deleting different owners can both observe two owners and then both succeed. Mixed deletion and demotion requests have the same problem. The schema supplies no owner-preservation constraint, leaving a fridge without anyone authorized to manage memberships, settings, tokens, or deletion through the application.
- Source review: Source-supported interleaving: two owners can each read owner count 2, then both demote/delete, leaving count 0. Separate awaits allow independent Worker requests to interleave. D1 serializing individual statements does not make the entire read/write sequence atomic. No concurrent production mutation was performed.
- Recommended change: Enforce owner preservation atomically within each mutation, using conditional SQL or database constraints that cover both demotion and deletion. Keep intentional whole-fridge deletion supported.

### 6. Deleting one item can permanently remove another item's photo

- Deepsec classification: **BUG**, confidence high.
- Source: [workers/lib/inventory.ts](../workers/lib/inventory.ts#L348).
- Tool finding: Camera check-in accepts any valid photo key within the fridge and creates a fresh inventory ID for every commit. Multiple commits, including a retry after a lost response, can therefore create rows referencing the same R2 object. deleteInventoryItem deletes that object unconditionally after removing one row, without checking remaining references. Other inventory items referencing the object then permanently lose their photo.
- Source review: Source-supported: camera commits accept a same-fridge photo path and generate a fresh item ID; the schema does not make image_storage_path unique. deleteInventoryItem deletes the photo without checking other references. This is a same-fridge data-integrity issue, not a cross-fridge photo authorization bypass.
- Recommended change: Give each inventory item exclusive ownership of its photo object, or manage shared references atomically and delete only after the final reference is removed. Add operation identifiers for idempotent camera check-in retries.

### 7. Concurrent partial inventory edits overwrite unrelated changes

- Deepsec classification: **BUG**, confidence high.
- Source: [workers/lib/inventory.ts](../workers/lib/inventory.ts#L303).
- Tool finding: updateInventoryItem reads the existing row and later writes every editable column, filling omitted fields from that earlier snapshot. Two concurrent PATCH requests changing different fields can both read the original row, then overwrite each other's changes. For example, a name edit can silently restore an expiry date that another request just corrected.
- Source review: Source-supported: the UPDATE writes all editable fields using values from an earlier SELECT. Concurrent partial patches can overwrite one another. A runtime concurrent-request reproduction was not run.
- Recommended change: Perform a single UPDATE that changes only supplied fields and preserves other values directly from the current database row, or use versioned optimistic concurrency with conflict handling.

### 8. Failed LINE deliveries consume cooldowns without scheduling a retry

- Deepsec classification: **BUG**, confidence high.
- Source: [workers/lib/line.ts](../workers/lib/line.ts#L63).
- Tool finding: tryAcquireAlertCooldown updates last_sent_s before sendLinePush attempts delivery. A network error or unsuccessful LINE response returns false without releasing the reservation or scheduling a retry. Subsequent alerts are suppressed for the cooldown despite no successful delivery. Retrying the original gateway report does not recover the alert because workers/index.ts only dispatches alerts when ingestion inserts new rows.
- Source review: Source-supported: the cooldown reservation is persisted before the push; failures return false without retry/outbox or reservation rollback. Fresh later events may eventually send again, so this means lost/delayed alerts during the cooldown, not that every future notification is permanently disabled.
- Recommended change: Persist pending alerts in a durable outbox alongside ingestion and retry failed deliveries. Track successful delivery separately from temporary reservations used to prevent concurrent duplicate sends.

### 9. Concurrent status reports can regress last-known device timestamps

- Deepsec classification: **BUG**, confidence high.
- Source: [workers/lib/status.ts](../workers/lib/status.ts#L98).
- Tool finding: The previous node timestamps are read and merged before the conditional upsert. Two reports can read the same old snapshot; an earlier report can then store a newer sensor timestamp, followed by a later gateway report containing a null sensor timestamp that restores the older last_known_seen_s. The gateway_seen_s condition preserves gateway ordering but does not protect the node history derived from the stale read.
- Source review: Source-supported: node history is merged from an earlier SELECT, then upserted as a complete nodes_json value. The gateway timestamp guard orders reports but cannot preserve node timestamps learned by an intervening write. Runtime concurrency was not reproduced.
- Recommended change: Merge against the current stored node state atomically, or use a compare-and-swap condition on the snapshot version and reread/recompute after a conflict.

## Recommended repair order

1. Make membership mutation authorization and last-owner preservation atomic. Both findings concern the same security boundary and should be fixed together.
2. Bind WebSockets to sessions and current membership, including expiry, revoked sessions, delayed handshakes and failed notifications.
3. Enforce request-byte limits before multipart parsing and set inference quotas before enabling a shared Gemini key.
4. Repair photo reference ownership, partial inventory updates, status merging and durable LINE delivery/retries.

These are recommendations for subsequent changes. This scan did not modify application source or claim the findings are fixed.

## Execution limitations and reproducibility

The normal initializer failed to detect pnpm/npm Windows shims. The documented manual scaffold flow was used. Its ignored workspace overrides the bundled Codex CLI 0.156.1 with 0.169.0; the older CLI rejected the requested model. Native child execution then blocked source reads. Earlier empty-result runs are invalid as clean scans and are excluded from this result.

The completed main pass instead received a line-numbered, tracked-source snapshot through project context. The sandbox stayed enabled and no shell tool was needed. This is static supplied-code review; it does not exercise live endpoints, inspect third-party dependency internals, or cover sibling subsystems. Private environment files, generated reports, node_modules and local state were excluded from the snapshot. A private-configuration record discovered by the initial pattern scan was removed from the candidate set before the successful AI run.

The snapshot manifest with source SHA-256 hashes is stored locally in ignored `.reports/deepsec-snapshot-manifest.json`. Raw reports and run histories remain under ignored `.deepsec/data/server/`. [DEV-TOOLS.md](../DEV-TOOLS.md) documents local execution and snapshot refresh. The server production dependencies and deployment bundle were not changed by this audit.
