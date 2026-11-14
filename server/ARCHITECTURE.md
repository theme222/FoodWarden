# Server 'S' (Cloud Backend & Web Dashboard) — Software Architecture

This document specifies the cloud infrastructure, runtime environment, third-party API integrations, database schema, and frontend software stack for **Server `'S'`** (`server/`), running on a **$0 Free-Tier Cloudflare Workers** architecture alongside the **Vite + React** web application.

- **Related Documents:**
  - [`README.md`](README.md) — Setup, development, formatting, testing, and deployment commands
  - [`GOAL.md`](GOAL.md) — Feature and edge-case checklist
  - [`SUMMARY.md`](../SUMMARY.md) — System-wide architecture
  - **Interfaces:** [`CBS.md`](../interface/CBS.md) (Camera ↔ Server), [`SBG.md`](../interface/SBG.md) (Server ↔ Gemini), [`SUL.md`](../interface/SUL.md) (Server → LINE)

---

## 1. System Topology & Data Flow

```text
+-----------------------+              HTTPS JSON / Multipart (CBS.md)       +----------------------------------------+
|  Node 'C' Gateway     | <==================================================> |  Cloudflare Worker (Hono TypeScript)   |
|  (Pi-top [4] Python)  |                                                      |  workers/index.ts (API + Scheduled Cron)|
+-----------------------+                                                      +----------------------------------------+
                                                                                     |          |            |
+------------------------------------------------------+                             |          |            | Context-Enriched
|  Web Dashboard User (Browser)                        |                             |          |            | REST (SBG.md)
|  - Vite + React Single Page App (TypeScript)         |                             |          |            v
|  - React Router (Multi-Page Client Navigation)       |                             |          |   +------------------------+
|  - Same-Origin REST + Auto-Reconnecting WebSockets   |                             |          |   | Entity 'G': Gemini     |
+------------------------------------------------------+                             |          |   | 3.5 Flash Lite VLM     |
         | Same-Origin Cookie    | Static Assets                                     |          |   +------------------------+
         | (Better Auth OAuth)   | (SPA dist/)                                       |          |
         v                       v                                                   |          | Outbound HTTPS Push
+------------------------------------------------------+                             |          | Alerts & Digest (SUL.md)
|  Cloudflare Workers Static Assets & Better Auth      |                             |          v
|  - Serves SPA bundle (`dist/`) with SPA fallback     |                             |   +------------------------+
|  - Enforces Google OAuth 2.0 & signed HttpOnly cookie|                             |   | Entity 'L': LINE       |
+------------------------------------------------------+                             |   | Messaging API v2       |
         |                                                                           |   +------------------------+
         | Member-Scoped WebSocket Upgrades & API Calls                              |
         v                                                                           v
+----------------------------------------------------------------------------------------------------------------------+
|  Cloudflare Persistence & Realtime Edge State                                                                        |
|  - D1 SQLite Database (`migrations/0001_init.sql`):                                                                  |
|      * user, session, account, verification       (Better Auth tables)                                               |
|      * fridges, fridge_members, fridge_secrets    (Tenant registry, owner/member RBAC, gateway token hash, API keys) |
|      * inventory                                  (FEFO bilingual grocery items; CAMERA or WEB_MANUAL)               |
|      * telemetry_samples, door_events             (Deduplicated LM73/SGP40/LDR time series & actuator safety events)  |
|      * system_status, alert_cooldowns             (Node heartbeat state & atomic LINE cooldown deduplication)        |
|  - Private R2 Bucket (`PHOTOS`):                                                                                     |
|      * food_crops/{fridgeId}/{crop_or_hash}.jpg   (Served strictly to fridge members via cookie-authorized Worker)   |
|  - SQLite-Backed Durable Object (`FridgeRoom`):                                                                      |
|      * Hibernatable WebSocket room per fridge pushing live telemetry, door_events, status, inventory_changed,        |
|        member_revoked (4003), and fridge_deleted (4004) frames                                                       |
+----------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Software & Tech Stack Architecture

| Component / Layer                       | Specific Technology / Package                                 | Role in FoodWarden                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Package Manager & Test Runner**       | **Bun (`bun`)** + **Vitest**                                  | Fast dependency management, frontend unit testing (`bun test src`), formatting, builds, and Miniflare Worker testing (`@cloudflare/vitest-plugin`).                                   |
| **Language**                            | **TypeScript (`strict: true`)**                               | Strict static typing across [`workers/`](workers/index.ts), D1 query models, and [`src/`](src/main.tsx) with zero `any`.                                                              |
| **Frontend Framework & Build Tool**     | **Vite 7 + React 19 + React Router 7**                        | Compiles the mobile-first SPA bundle to `dist/`, served directly by Cloudflare Workers Static Assets (`run_worker_first: ["/api/*"]`).                                                |
| **Edge API Runtime & Router**           | **Cloudflare Workers + Hono (`hono`)**                        | Handles gateway ingestion, AI check-in/out orchestration, member-scoped REST APIs, photo streaming, WebSocket upgrades, and Cron triggers.                                            |
| **Relational Database**                 | **Cloudflare D1 (SQLite)**                                    | Stores Better Auth sessions, fridge RBAC, FEFO inventory, deduplicated telemetry/door events, node heartbeats, and alert cooldowns (`migrations/0001_init.sql`).                      |
| **Private Object Storage**              | **Cloudflare R2 (`PHOTOS`)**                                  | Stores cropped grocery JPEGs under `food_crops/{fridgeId}/...` with no public bucket access; Worker enforces membership before streaming bytes.                                       |
| **Realtime Push**                       | **Durable Objects (`FridgeRoom` with WebSocket Hibernation)** | One SQLite-backed DO instance per fridge accepts hibernatable WebSockets, auto-responds `ping` → `pong`, and broadcasts updates immediately after D1 commits.                         |
| **Authentication & Sessions**           | **Better Auth (`better-auth`) on D1 + Google OAuth 2.0**      | Authenticates users with Google OAuth (plus `APP_ENV=development` local dev bypass) using signed `HttpOnly` SameSite cookies (`session`).                                             |
| **Multimodal AI (Entity `'G'`)**        | **Gemini 3.5 Flash Lite REST API**                            | Structured `application/json` vision classification and context-enriched check-out matching (`gemini-2.5-flash-lite` fallback + 429/503 retries per [`SBG.md`](../interface/SBG.md)). |
| **Notification Service (Entity `'L'`)** | **LINE Messaging API v2 (`POST /v2/bot/message/push`)**       | Dispatches bilingual Thai/English door safety, high VOC/temp, and daily FEFO expiry digest push messages backed by atomic D1 cooldown deduplication.                                  |
| **Scheduled Jobs**                      | **Cloudflare Workers Cron Triggers (`0 1 * * *`)**            | Runs daily at 08:00 Asia/Bangkok (`01:00 UTC`) to send FEFO expiry digests and clean up unreferenced R2 `food_crops/` objects older than 24 hours.                                    |

---

## 3. Frontend Web Application Architecture (Vite + React + React Router)

The web dashboard is a responsive Single Page Application designed for mobile and desktop browsers. Static assets load from the edge while dynamic state hydrates via same-origin cookie API calls and a per-fridge hibernating WebSocket (`/api/fridges/:fridgeId/ws`).

### 3.1 Multi-Page Route Hierarchy (React Router)

```text
/ (Public / Auth Gate)
│
├── Login Screen .................. Google OAuth SSO ("Sign in with Google") + local dev bypass (when APP_ENV=development)
│
└── /fridges (Protected Routes: requires verified Better Auth session cookie)
    │
    ├── /fridges .................. Multi-fridge hub: lists accessible fridges (owner/member), create new fridge form
    │
    └── /fridges/:fridgeId (Fridge Workspace: contextual navigation bar + live WebSocket pill)
        │
        ├── /fridges/:fridgeId ................ Food Dashboard & Live Metrics
        │                                       - Live environmental readings (LM73 temp, SGP40 VOC, LDR light)
        │                                       - 1h / 24h / 7d / 30d historical charts
        │                                       - FEFO-sorted active grocery inventory list with status badges
        │
        ├── /fridges/:fridgeId/food/add ....... Manual food check-in with bilingual mapping & optional JPEG crop upload
        │
        ├── /fridges/:fridgeId/food/:itemId ... Item detail inspection, cookie-authorized R2 photo preview, inline edit & check-out delete
        │
        ├── /fridges/:fridgeId/devices ........ Gateway heartbeat tree (node last_seen_s vs last_known_seen_s) & door safety event timeline
        │
        └── /fridges/:fridgeId/settings ....... Owner-only fridge configuration:
                                                - Fridge rename & LINE target ID (`line_target_id`)
                                                - Per-fridge Gemini API key update
                                                - Permanent `GATEWAY_TOKEN` view/copy/rotate
                                                - Member invite/role management & revocation (closes revoked sockets with 4003)
                                                - Delete fridge (cleans up D1, R2, and closes active sockets with 4004)
```

### 3.2 Internationalization (i18n) Architecture

Users switch cleanly between **Thai (`th`)** and **English (`en`)** without reloading (`src/words.ts` + `src/model.ts`):

1. **Dynamic Language Toggle:** Switches all headings, tabs, sensor labels, door event badges, and relative expiry alerts immediately (`th` / `en`), persisted in `localStorage`.
2. **Bilingual Food Storage & Category Bridge:** Canonical categories (`Dairy`, `Produce`, `Meat`, `Seafood`, `Beverage`, `Condiments`, `Leftovers`, `Bakery`, `Snacks`, `Other`) map dynamically between English keys and Thai display names.
3. **Calendar Formatting:** Formats dates using Buddhist Era (`พ.ศ.`) in Thai mode and Gregorian calendar in English mode.

---

## 4. Database & API Architecture (`workers/`)

### 4.1 Gateway Endpoints (`Authorization: Bearer <GATEWAY_TOKEN>`)

All gateway routes authenticate Node `'C'` by hashing the Bearer token with SHA-256 and matching `fridge_secrets.gateway_token_hash`:

- **`POST /api/inventory/checkin/draft`**: Accepts `multipart/form-data` JPEG (`image`, max 5 MB), calls Gemini `CHECK_IN`, rejects `is_food === false` or `confidence < 0.60` with `422 UNIDENTIFIABLE` (zero R2/D1 writes), uploads valid crops to R2 `food_crops/{fridgeId}/crop_{uuid}.jpg`, and deterministically computes `estimated_expiry_date`.
- **`POST /api/inventory/checkin`**: Validates `CheckInCommitPayload` + tenant-scoped `image_storage_path`, inserts into D1 `inventory` (`check_in_source = 'CAMERA'`), broadcasts `inventory_changed` (`created`), and returns `201 Created`.
- **`POST /api/inventory/checkout/draft`**: Accepts `multipart/form-data` JPEG (`image`, max 5 MB), fetches active D1 inventory, invokes Gemini `CHECK_OUT`, filters returned IDs against real D1 rows (anti-hallucination guard), deterministically sorts matches by **FEFO** (`estimated_expiry_date ASC, check_in_timestamp_s ASC`), and returns `EXACT_MATCH` / `AMBIGUOUS_MULTIPLE` / `NO_MATCH` (or `422 UNIDENTIFIABLE` when `< 0.60`) with zero mutations.
- **`POST /api/inventory/checkout`**: Hard-deletes the confirmed `item_id` from D1 `inventory` and its photo from R2 `PHOTOS`, broadcasts `inventory_changed` (`deleted`), and returns `200 OK`.
- **`POST /api/telemetry`**: Deduplicates samples by `(fridge_id, node_id, timestamp_s)`, updates `fridges.last_seen_s` and `last_telemetry_json` monotonically, broadcasts `telemetry` over `FridgeRoom`, and dispatches `voc_high` (`>= 250`) / `temp_high` (`> 8.0°C`) LINE push alerts (1800s cooldown).
- **`POST /api/door_events`**: Deduplicates door events by `(fridge_id, node_id, timestamp_s, status)`, broadcasts `door_events` over `FridgeRoom`, and dispatches LINE alerts for `OBSTRUCTION_ERROR`, `TIMEOUT_ERROR`, `FAULT_LOCKOUT`, and `CONTRADICTION_ERROR` (300s cooldown).
- **`POST /api/status`**: Stores gateway/subnode heartbeats in `system_status`, retains `last_known_seen_s` when a node reports `null`, ignores stale out-of-order reports, and broadcasts `status` over `FridgeRoom`.

### 4.2 Dashboard Member & Owner Endpoints (Better Auth Cookie)

- **Auth:** `GET /api/auth/config`, `POST /api/auth/dev-login` (only when `APP_ENV === "development"`), `GET|POST /api/auth/*`.
- **Fridges & RBAC:** `GET|POST /api/fridges`, `GET /api/fridges/:fridgeId/ws`, `PATCH|DELETE /api/fridges/:fridgeId`, `GET|PUT /api/fridges/:fridgeId/settings`, `POST /api/fridges/:fridgeId/gateway-token/rotate`, `POST /api/fridges/:fridgeId/members`, `DELETE /api/fridges/:fridgeId/members/:email`.
- **Inventory, Photos & History:** `GET|POST /api/fridges/:fridgeId/inventory`, `PATCH|DELETE /api/fridges/:fridgeId/inventory/:itemId`, `GET /api/fridges/:fridgeId/inventory/:itemId/photo`, `GET /api/fridges/:fridgeId/telemetry`, `GET /api/fridges/:fridgeId/status`, `GET /api/fridges/:fridgeId/door_events`.
