# FoodWarden diagram guide

These diagrams describe the repository on `feat/server`. They are split by concern so that labels and connector paths stay readable. Start with [system-detailed.svg](system-detailed.svg), then open the focused diagrams below.

## Coverage and implementation status

The [server Worker](../workers/index.ts), [React application](../src/main.tsx), and [D1 migrations](../migrations/) contain implementation. The [camera entry point](../../camera/src/foodwarden_camera/__init__.py), [fridge firmware](../../fridge/src/main.cpp), and [door firmware](../../door/src/main.cpp) are scaffolds in this branch. Embedded diagrams describe the intended design from [SUMMARY.md](../../SUMMARY.md), [FUC](../../interface/FUC.md), and [CBD](../../interface/CBD.md); they are not evidence of functioning hardware or completed integration.

| Diagram                                                                      | Scope                                                                                                                        | Status / source                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [System detail](system-detailed.svg) / [source](system-detailed.mmd)         | All nodes, local safety, storage, frontend, external services                                                                | Separates embedded design from implemented server                                                                                                                              |
| [Inventory flow](inventory-flow.svg) / [source](inventory-flow.mmd)          | Camera draft/commit, inference, operation receipts, FEFO, photo retirement                                                   | [Gateway routes](../workers/index.ts), [operations](../workers/lib/operations.ts), [AI inventory](../workers/lib/ai-inventory.ts)                                              |
| [Server access](server-access.svg) / [source](server-access.mmd)             | Bearer tokens, verified sessions, owner/member roles, personal scope, webhook signatures, private photos, live access checks | [Auth](../workers/lib/auth.ts), [fridges](../workers/lib/fridges.ts), [LINE routes](../workers/line-routes.ts), [room](../workers/durable-objects/fridge-room.ts)              |
| [Dashboard data](dashboard-data.svg) / [source](dashboard-data.mmd)          | Route gate, session cache, SWR snapshots, WebSocket events, reconnect, access loss, translations                             | [Routes](../src/main.tsx), [cache](../src/components/session-cache.tsx), [data](../src/data.ts)                                                                                |
| [LINE delivery](line-delivery.svg) / [source](line-delivery.mmd)             | Personal/family pairing, signed callbacks, code expiry, outbox leases, retries, scheduled jobs                               | [Pairing](../workers/lib/line-pairing.ts), [family delivery](../workers/lib/line.ts), [personal delivery](../workers/lib/personal-notifications.ts), [Cron](../wrangler.jsonc) |
| [Data model](data-model.svg) / [source](data-model.mmd)                      | Identity, tenants, food, device history, operation receipts, quotas, pairing and outboxes                                    | [Migrations](../migrations/); logical groups, not a column-level ER diagram                                                                                                    |
| [Sensor telemetry](sensor-telemetry.svg) / [source](sensor-telemetry.mmd)    | Sampling, GATT time sync, authenticated envelope, sample batches, queue, cloud dedup                                         | Design: [FUC](../../interface/FUC.md); ingestion: [telemetry](../workers/lib/telemetry.ts)                                                                                     |
| [Door safety](door-safety.svg) / [source](door-safety.mmd)                   | Home ISR, current cutoff, motion deadline, software abort, retraction and fault handling                                     | Design: [CBD](../../interface/CBD.md), [door architecture](../../door/ARCHITECTURE.md)                                                                                         |
| [Gateway workflows](gateway-workflows.svg) / [source](gateway-workflows.mmd) | Local vision, LCD confirmation, cloud inventory, separate local motor safety path                                            | Design: [system flows](../../SUMMARY.md), [camera architecture](../../camera/ARCHITECTURE.md)                                                                                  |
| [System overview](fridge.svg) / [source](fridge.mmd)                         | Compact overview                                                                                                             | Design plus implemented cloud topology                                                                                                                                         |
| [Cloud overview](cloud.svg) / [source](cloud.mmd)                            | Worker, authentication, D1, R2, room, Gemini and LINE                                                                        | Implemented component overview                                                                                                                                                 |
| [Physical network](network.svg) / [source](network.mmd)                      | BLE, local TLS MQTT, home LAN and HTTPS                                                                                      | Embedded traffic is intended integration                                                                                                                                       |
| [Gateway hardware](gateway.svg) / [source](gateway.mmd)                      | Camera, PIR, LCD and power                                                                                                   | Hardware design                                                                                                                                                                |
| [Fridge sensor hardware](fridge-sensor.svg) / [source](fridge-sensor.mmd)    | Battery/BMS, LM73, SGP40 and LDR                                                                                             | Hardware design                                                                                                                                                                |
| [Door hardware](door-closer.svg) / [source](door-closer.mmd)                 | Power rails, current sensor, driver, motor, IR and limit switch                                                              | Hardware design                                                                                                                                                                |

## Corrections and unresolved verification

- The old gateway diagram comments named YOLOv8n, PyQt5 and Bullseye. The canonical current design specifies YOLO11n, PyQt6 and Bookworm. Comments now follow the current design; the camera implementation remains a scaffold.
- The old sensor drawing used SHT31 temperature/humidity. The current documented sensor is onboard LM73, I2C0 address `0x4D`, GPIO 4/5. SGP40 uses I2C1. The legacy drawing is retained as historical material.
- The old door diagram comment said 8 seconds. The current CBD command default is 30 seconds. The safety diagram describes a bounded deadline; actual motor timing, retraction, electrical suitability, current calibration and safe physical behavior still require hardware validation.
- Sensor application acknowledgement/retry and replay tracking remain design work. BLE notification delivery alone does not demonstrate the required packet delivery rate.
- Server telemetry currently alerts at `voc_index >= 250` or temperature `> 8.0` with cooldowns. The system summary describes sustained conditions over 15 minutes and VOC `> 250`. This discrepancy remains; the diagram set does not claim that duration filtering exists.
- Cloudflare is the implemented server stack. Some sibling README files still mention Firebase; no firmware or sibling documentation was changed here.
- These are architecture and workflow views, not exhaustive API schemas, electrical schematics, formal safety verification, measured latency, battery-life evidence or a completed 24-hour uptime test. Consult the linked implementation and contracts for field-level detail.

## Transparent SVG rendering

[render.ts](render.ts) preserves a transparent canvas. Dark connector lines, arrowheads and sequence lifelines receive a narrow white outline through an SVG filter. This provides a contrasting edge on both light and dark backgrounds without painting a full white rectangle. Pele theme variables are resolved to literal SVG values so viewers without CSS custom-property support can render the same colors. Node and label fills remain opaque for legibility. Highly patterned backgrounds can still interfere with diagram reading; no fixed stroke can guarantee contrast against every possible image.

Render one diagram from this directory:

```bash
bun run render cloud.mmd cloud.svg
```

Render all diagrams in PowerShell from this directory:

```powershell
Get-ChildItem -Filter *.mmd | ForEach-Object {
    bun run render $_.Name ($_.BaseName + '.svg')
    if ($LASTEXITCODE -ne 0) { throw "Render failed: $($_.Name)" }
}
```

The `.mmd` files are editable diagram sources. Repository Markdown uses relative links and does not embed Mermaid blocks. Generated SVGs are checked in for direct viewing without a Mermaid extension.
