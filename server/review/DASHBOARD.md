# Dashboard work log

This work lives on `feat/server`. It adds the requested dashboard flows and documents the physical system without changing the canonical cross-device contracts.

## Decisions and evidence

| Step | Evidence reviewed | Decision and implementation |
| --- | --- | --- |
| 1. Locate the running code | The branch had Firebase telemetry ingestion, a Bun scaffold and dashboard specifications. There was no runnable React UI. | Added the Vite and React entry point under [server](../index.html) and kept the existing Bun scaffold commands. Hosting routes API requests to Functions and deep links to the SPA. |
| 2. Compare the hardware references | Draw.io Page-1, [SUMMARY.md](../../SUMMARY.md), the camera, door and fridge trees, the live GitHub PRs and issues, and the named hardware implementation branches. | Retained a short overview and added external network, cloud and internal hardware views. The [diagram audit](DIAGRAM-AUDIT.md) maps each group of original shapes, paths and photos to its new location and records discrepancies. |
| 3. Define device status | [PR #5](https://github.com/theme222/FoodWarden/pull/5) adds a 60-second gateway report with one timestamp per node, explicit null before first contact and support for additional IDs. | The [receiver](../functions/src/status.ts) uses the gateway token, requires a timestamp for C0 to order reports, and stores the latest report under `system_status/latest`. Older and repeated C0 timestamps are acknowledged with zero updates. Latest reported null stays null. A missing node entry is distinguished from a reported null. The previous known timestamp is retained for display. A report accepts up to 200 distinct IDs and rejects timestamps more than five minutes ahead of receipt. |
| 4. Present device status | F can sleep between updates. A lost gateway connection does not show whether its children are offline. | [Devices](../src/Devices.tsx) puts C0 above F0, D0 and additional reported IDs. It displays last contact and last report time in Asia/Bangkok, plus plain-language states. The UI treats gateway and door reports older than three minutes as stale and fridge-sensor observations older than ten minutes as stale. These thresholds are display choices. |
| 5. Keep one row per physical item | [Issue #2](https://github.com/theme222/FoodWarden/issues/2) proposes a distinct document per unit and display grouping by English name plus expiry. | Group the view by normalized name and exact expiry, then sort earliest expiry first. [Food details](../src/Food.tsx) count the other matching rows and link to each individual item's own photo. The UI preserves the name stored on each item. Manual entry reuses a single known bilingual name pair when the typed name matches. For older Thai-only rows, the view groups with a bilingual row only when the Thai alias is unambiguous for that expiry. |
| 6. Keep the graphs compact | CBS telemetry already contains light level. [Issue #1](https://github.com/theme222/FoodWarden/issues/1) describes suppressing VOC during door-open and cooldown windows. | [Metric cards](../src/Metrics.tsx) use SVG thermometer, air and sun icons and show an hour of temperature, VOC and light readings for one sensor. Missing or suppressed values break the line. Light is raw LDR, not lux. |
| 7. Add food with a photo | [CBS](../../interface/CBS.md) and [Architecture](../ARCHITECTURE.md) place JPEGs in a fridge-scoped Storage directory. | One add-food form accepts an optional file or camera capture, shows a preview and saves one item. The browser resizes the picture to JPEG. The [API](../functions/src/inventory.ts) checks membership, bounds the payload, stores the JPEG privately and gives retries the same item identity. Existing camera crops use their stored path. |
| 8. Limit data access and keep navigation simple | The parent fridge document contains member emails. Access is per verified member email. | A protected fridge-list endpoint returns only dashboard fields. Firestore rules grant member reads to inventory, sensor history, door events and the latest device report. Functions handle writes and return private photo bytes after membership checks. Thai is the default with an English toggle, large touch targets and two primary fridge tabs. |

## GitHub references checked

- [PR #4](https://github.com/theme222/FoodWarden/pull/4) is merged. Its project resource drawings and guidelines form part of the design baseline.
- [PR #5](https://github.com/theme222/FoodWarden/pull/5) is open. It supplies the contract for the server heartbeat. The reviewed camera branch has no sender for it yet.
- [Issue #1](https://github.com/theme222/FoodWarden/issues/1) concerns VOC firmware and cooldown. The dashboard handles the resulting missing values. The fridge branch contains its own implementation.
- [Issue #2](https://github.com/theme222/FoodWarden/issues/2) covers multi-pack detection, name normalization and grouped rows. Grouping and individual item details are covered here. Automatic unit detection and Gemini name reuse belong to the camera check-in pipeline.
- [Issue #3](https://github.com/theme222/FoodWarden/issues/3) covers LINE registration, notification triggers and quota. It is tracked separately from this dashboard work.

## Verification checklist

See [verification results](VERIFICATION.md) for the checks performed and the remaining field evidence.

- Run the [development commands](../README.md) for strict TypeScript, the production bundle and emulator tests.
- Verify that a current C0 report shows F0 and D0, explicit null stays unknown, extra IDs appear, and an old report cannot replace the latest.
- Verify a fridge member can see status and inventory while an outsider and an unverified account cannot read the data. Verify member-list fields and private config remain private.
- Add the same food name and expiry twice with separate photos. Check the row count and open each item's original saved picture. Add an item without a photo and verify the empty state.
- Send a temperature, VOC and light series with an explicit VOC null. Check that the three plots show valid readings and only the VOC line breaks.
- Review in a narrow browser viewport and switch between Thai and English. Record emulator results separately from actual hardware observations.
