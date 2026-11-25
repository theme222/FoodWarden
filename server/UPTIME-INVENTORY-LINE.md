# Uptime, camera check-in and LINE follow-up

This note records the decisions and verification for [#13](https://github.com/theme222/FoodWarden/issues/13), [#2](https://github.com/theme222/FoodWarden/issues/2) and [#3](https://github.com/theme222/FoodWarden/issues/3). The [five UX and systems skills](skills/README.md) have their own entry points.

## #13 — Device uptime

The Devices page shows a 24- or 72-hour window for each reported node, including C0, F0 and D0. The timeline splits each window into 24 buckets. Each bucket reports seconds online, offline and unknown, with an expandable text alternative. Uptime divides online by known duration. Coverage divides known duration by the complete window.

The [shared rules](src/lib/node-contact.ts) use the existing 180-second freshness threshold for the gateway and door node and 600 seconds for fridge sensors. If the gateway is stale, downstream nodes are unknown. A child that has never reported is likewise unknown. Once a child has been observed, a healthy gateway explicitly failing to report fresh contact provides evidence that the child is offline. Delayed and duplicate gateway reports do not overwrite history.

The [history migration](migrations/0006_status_history.sql) records accepted snapshots in the same transaction that updates current status. History starts with the next accepted report after migration. There is no synthetic backfill. The initial UI window supports the rubric's continuous run of more than 24 hours. For the submission, run for at least 24 hours, record the Bangkok start/end and coverage, and record deliberate disconnects separately from periods with no evidence. Test data is not a physical uptime measurement.

## #2 — Gemini naming and multi-packs

The Gateway draft contract sends a JPEG. This checkout has a camera entry-point scaffold rather than a runnable production Gateway pipeline, so the server endpoint and integration fixtures are the available evidence. The Worker asks Gemini for a bilingual name, category, count and confidence. For a new draft it now sends up to 40 distinct names and categories from that fridge. A valid catalog index, matching category and confidence of at least 0.90 are required to reuse the stored bilingual names. The prompt instructs Gemini to keep different brands, flavors, varieties, preparations and sizes separate, and to abstain when the label is unclear. This improves naming consistency but visual identification remains probabilistic.

For a clearly counted pack of identical units, Gemini returns the individual unit name. The server accepts an integer count of 1–48 at high confidence and stores counts above one against the staged image. The [atomic commit](workers/lib/operations.ts) creates one row per unit with a shared expiry and crop. A replay with the same idempotency key returns the original item ID. A second operation key cannot consume the same counted pack. FEFO checkout still deletes one selected unit. The crop remains referenced while another unit uses it.

The existing Gateway draft and commit response formats are preserved. Changes are internal to the Worker, including the Gemini prompt/schema. Updating the canonical [SBG reference](../interface/SBG.md) requires separate approval under the repository instructions.

## #3 — LINE behavior

Household daily digest runs at 06:00 Asia/Bangkok. It includes expiring food, door faults for the previous Bangkok calendar day, and the distinct sensor observations queued for alerts on that day. Personal digests retain each user's selected schedule and add the previous-day counts. Counts of queued observations do not claim confirmed LINE delivery. Door faults continue to alert immediately.

Temperature above 8°C and VOC at or above 250 are evaluated independently for each node. The latest accepted sample must be current and the persisted run of above-threshold readings must span at least 15 minutes, with no gap over six minutes. Missing or safe values break that metric's run. Existing request deduplication, cooldowns and outbox retries remain in place. The authenticated development bypass still allows an immediate simulator test.

LINE counts recipient deliveries, including people in a group, rather than pushes or bubbles. The account's configured monthly ceiling remains authoritative. The Worker backs off on provider 429/5xx and reuses the retry key. No claim is made that a local 300-request counter would enforce 300 deliveries. Verify the actual allowance and additional-message limit in LINE Official Account Manager before rollout. [LINE counting rules](https://developers.line.biz/en/tips/2026/05/28/how-to-count-messages/) · [LINE pricing and usage](https://developers.line.biz/en/docs/messaging-api/pricing)

## LINE message and delivery follow-up

Urgent notifications use one title, the fridge name, the Bangkok time, one action and a link. Morning summaries show at most three food examples plus the remaining count. Personal and fridge messages omit emails and visible internal IDs. Links use the HTTPS origin in `BETTER_AUTH_URL` and open the relevant authorized route. Google sign-in preserves a validated internal destination. If the HTTPS origin is unavailable, notifications still include the explanation and action text.

[Migration 0008](migrations/0008_alert_jobs.sql) records eligible alert jobs in the transaction that stores the door event or sensor sample. The Worker leases jobs when it creates recipient outbox rows. It retries recoverable errors and expires jobs after 23 hours. Scheduled digest generation, job recovery and recipient dispatch run independently. Production ingestion acknowledges the committed event without waiting for LINE. Existing outbox payloads keep their original wording during retry and use their original retry key.

A connection test distinguishes queued, accepted by LINE, and failed. Acceptance does not indicate that the person received or read it. The configured LINE account remains authoritative for its delivery quota.

## Dashboard changes

Devices show the status rows before the optional schematic. Expanded rows use one surface, and keyboard focus is still visible. Independent inventory, readings, device status and door-history errors no longer block unrelated data. The dashboard links to its expired/expiring filters, and the fridge list explicitly marks stale readings. Inventory take-out still confirms the action. The old Undo was removed because it created a new row without the original photo. A true restore remains a separate operation.

## Verification

Build, typecheck, lint, Knip and formatting passed. The local suites passed with 7 source, 23 UI, 8 simulated and 78 Worker tests. These cover accepted status history and replay, uptime timing boundaries, same-product catalog reuse and a six-unit pack commit, unchanged Gateway payload, 15-minute sensor notification gating and previous-day digest counts.

Both migrations were applied locally. Chromium at 320 and 1440 CSS pixels reached the real authenticated uptime API, rendered controlled three-node history fixtures, switched the window and opened the interval details. The graph remained usable with a simulated door-history HTTP 503 and neither viewport overflowed.

Apply both migrations before releasing the server. Actual LINE delivery, Gemini recognition accuracy and more than 24 hours of physical-device uptime need a run with the deployed equipment.
