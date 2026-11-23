# Server 'S' (Cloud Backend & Web Dashboard) — Software Architecture

This document specifies the cloud infrastructure, runtime environment, third-party API integrations, database schema, and frontend software stack for **Server `'S'`** (`server/`), running on a **0 USD Free-Tier Cloudflare Workers** architecture alongside the **Vite + React** web application.

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
|  - D1 SQLite Database (`migrations/0001_init.sql` .. `0004_operation_receipts.sql`):                                    |
|      * user, session, account, verification       (Better Auth tables)                                               |
|      * fridges, fridge_members, fridge_secrets    (Tenant registry, owner/member RBAC, gateway token hash, API keys) |
|      * inventory                                  (FEFO bilingual grocery items; CAMERA or WEB_MANUAL)               |
|      * inventory_operations, draft_operations     (Durable UUID v4 Idempotency-Key receipts & uncertain error state) |
|      * telemetry_samples, door_events             (Deduplicated sensor time series & actuator safety events)          |
|      * system_status, alert_cooldowns             (Node heartbeat state & atomic LINE cooldown deduplication)        |
|      * line_pairing_codes, line_outbox, user_line_profiles, user_favorites, user_line_outbox                         |
|  - Private R2 Bucket (`PHOTOS`):                                                                                     |
|      * food_crops/{fridgeId}/{crop_or_hash}.jpg   (Served strictly to fridge members via cookie-authorized Worker)   |
|  - SQLite-Backed Durable Object (`FridgeRoom`):                                                                      |
|      * Hibernatable WebSocket room per fridge pushing live telemetry, door_events, status, inventory_changed,        |
|        member_revoked (4003), and fridge_deleted (4004) frames                                                       |
+----------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Software & Tech Stack Architecture

| Component / Layer                       | Specific Technology / Package                                    | Role in FoodWarden                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Package Manager & Test Runner**       | **Bun (`bun`)** + **Vitest**                                     | Fast dependency management, frontend unit testing (`bun test src`), formatting, builds, and Miniflare Worker testing (`@cloudflare/vitest-plugin`).                                                                |
| **Language**                            | **TypeScript (`strict: true`)**                                  | Strict static typing across [`workers/`](workers/index.ts), D1 query models, and [`src/`](src/main.tsx) with zero `any`.                                                                                           |
| **Frontend Framework & Build Tool**     | **Vite 7 + React 19 + React Router 7**                           | Compiles the mobile-first SPA bundle to `dist/`, served directly by Cloudflare Workers Static Assets (`run_worker_first: ["/api/*"]`).                                                                             |
| **Edge API Runtime & Router**           | **Cloudflare Workers + Hono (`hono`)**                           | Handles gateway ingestion, AI check-in/out orchestration, member-scoped REST APIs, photo streaming, WebSocket upgrades, and Cron triggers.                                                                         |
| **Relational Database**                 | **Cloudflare D1 (SQLite)**                                       | Stores Better Auth sessions, fridge RBAC, FEFO inventory, UUID v4 idempotency receipts, AI quotas, LINE pairing/outboxes, personal preferences, and deduplicated telemetry/door events (`migrations/0001`–`0004`). |
| **Private Object Storage**              | **Cloudflare R2 (`PHOTOS`)**                                     | Stores cropped grocery JPEGs under `food_crops/{fridgeId}/...` with no public bucket access; Worker enforces membership before streaming bytes.                                                                    |
| **Realtime Push**                       | **Durable Objects (`FridgeRoom` with WebSocket Hibernation)**    | One SQLite-backed DO instance per fridge accepts hibernatable WebSockets, auto-responds `ping` → `pong`, and broadcasts updates immediately after D1 commits.                                                      |
| **Authentication & Sessions**           | **Better Auth (`better-auth`) on D1 + Google OAuth 2.0**         | Authenticates users with Google OAuth (plus `APP_ENV=development` local dev bypass) using signed `HttpOnly` SameSite cookies (`session`).                                                                          |
| **Multimodal AI (Entity `'G'`)**        | **Gemini 3.5 Flash Lite REST API**                               | Structured `application/json` vision classification and context-enriched check-out matching (`gemini-2.5-flash-lite` fallback + 429/503 retries per [`SBG.md`](../interface/SBG.md)).                              |
| **Notification Service (Entity `'L'`)** | **LINE Messaging API v2 (`POST /v2/bot/message/push`)**          | Dispatches bilingual family and personalized LINE push alerts, signed webhook pairing, and scheduled FEFO digests backed by durable outboxes and D1 cooldowns ([`SUL.md`](../interface/SUL.md)).                   |
| **Scheduled Jobs**                      | **Cloudflare Workers Cron Triggers (`0 1 * * *` & `* * * * *`)** | Runs daily at 08:00 Asia/Bangkok (`01:00 UTC`) for family expiry digests + >24h orphan R2 cleanup, and every minute (`* * * * *`) for durable LINE outbox retries and personal morning digests.                    |

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
    ├── /fridges .................. Fridge list with sensor freshness, inventory counts, and upcoming expiry counts
    │
    ├── /me ....................... Appearance, personal LINE pairing, and notifications across memberships
    │
    └── /fridges/:fridgeId (Fridge Workspace: contextual navigation bar + live WebSocket pill)
        │
        ├── /fridges/:fridgeId ................ Food Dashboard & Live Metrics (optional `?sim=1` redirects owner to `/sim`)
        │                                       - Live readings, FEFO-sorted inventory, and private favorites below inventory
        │
        ├── /fridges/:fridgeId/charts ......... Multi-sensor charts with a 1h / 24h / 7d / 30d period slider and reading cursor
        │
        ├── /fridges/:fridgeId/history ........ Paginated inventory, door, and sensor history with a Bangkok date filter
        │
        ├── /fridges/:fridgeId/food/add ....... Manual food check-in with bilingual mapping & optional JPEG crop upload
        │
        ├── /fridges/:fridgeId/food/:itemId ... Item detail inspection, cookie-authorized R2 photo preview, inline edit & check-out delete
        │
        ├── /fridges/:fridgeId/devices ........ Gateway heartbeat tree (node last_seen_s vs last_known_seen_s) & door safety event timeline
        │
        ├── /fridges/:fridgeId/me ............. Legacy bookmark that redirects to /me
        │
        ├── /fridges/:fridgeId/settings ....... Owner-only fridge configuration:
        │                                       - Fridge rename & verified 1-use Family LINE pairing / disconnect
        │                                       - Per-fridge Gemini API key update
        │                                       - Permanent `GATEWAY_TOKEN` view/copy/rotate
        │                                       - Member invite/role management & revocation (closes revoked sockets with 4003)
        │                                       - Delete fridge (cleans up D1, R2, and closes active sockets with 4004)
        │
        └── /fridges/:fridgeId/sim ............ Owner-only hidden Gateway Data Simulator (`/simulator` alias & `?sim=1`)
                                                - Sends real Bearer-authenticated test payloads with optional dev-only `?bypass_cooldown=1` (requires authenticated owner session)
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

- **`POST /api/inventory/checkin/draft`**: Requires `Idempotency-Key` UUID v4. Accepts `multipart/form-data` JPEG (`image`, max 5 MB), calls Gemini `CHECK_IN`, rejects `is_food === false` or `confidence < 0.60` with `422 UNIDENTIFIABLE` (zero inventory writes), uploads valid crops to R2 `food_crops/{fridgeId}/crop_{uuid}.jpg`, and caches `draft_operations` receipt so retries reuse the same result.
- **`POST /api/inventory/checkin`**: Requires `Idempotency-Key` UUID v4. Validates `CheckInCommitPayload` + tenant-scoped `image_storage_path`, atomically inserts D1 `inventory` (`check_in_source = 'CAMERA'`) + `inventory_operations` receipt, broadcasts `inventory_changed` (`created`), and returns `201 Created`.
- **`POST /api/inventory/checkout/draft`**: Requires `Idempotency-Key` UUID v4. Accepts `multipart/form-data` JPEG (`image`, max 5 MB), fetches active D1 inventory, invokes Gemini `CHECK_OUT`, filters returned IDs against real D1 rows (anti-hallucination guard), deterministically sorts matches by **FEFO** (`estimated_expiry_date ASC, check_in_timestamp_s ASC`), and caches the `draft_operations` receipt with zero inventory mutations.
- **`POST /api/inventory/checkout`**: Hard-deletes the confirmed `item_id` from D1 `inventory` and retires its photo from R2 `PHOTOS`, broadcasts `inventory_changed` (`deleted`), and returns `200 OK`.
- **`POST /api/telemetry`**: Deduplicates samples first-write-wins by `(fridge_id, node_id, timestamp_s)` (conflicting or duplicate retries are ignored without broadcasting or alerting), enforces bounded event times, updates `fridges.last_seen_s` and `last_telemetry_json` from accepted rows, broadcasts `telemetry` over `FridgeRoom`, and dispatches `voc_high` (`>= 250`) / `temp_high` (`> 8.0°C`) LINE push alerts (1800s cooldown; optional `?bypass_cooldown=1` is gated to `APP_ENV=development` + authenticated owner session and preserves replay receipts).
- **`POST /api/door_events`**: Deduplicates door events first-write-wins by `(fridge_id, node_id, timestamp_s, status)` (duplicate retries do not re-broadcast or re-alert), broadcasts `door_events` over `FridgeRoom`, and dispatches LINE alerts for `OBSTRUCTION_ERROR`, `TIMEOUT_ERROR`, `FAULT_LOCKOUT`, and `CONTRADICTION_ERROR` (300s cooldown; optional `?bypass_cooldown=1` is gated to `APP_ENV=development` + authenticated owner session and preserves replay receipts).
- **`POST /api/status`**: Stores gateway/subnode heartbeats in `system_status`, retains `last_known_seen_s` when a node reports `null`, ignores stale out-of-order reports, and broadcasts `status` over `FridgeRoom`.

### 4.2 Dashboard Member & Owner Endpoints (Better Auth Cookie)

- **Auth:** `GET /api/auth/config`, `POST /api/auth/dev-login` (only when `APP_ENV === "development"`), `GET|POST /api/auth/*`.
- **Fridges & RBAC:** `GET|POST /api/fridges`, `GET /api/fridges/:fridgeId/ws`, `PATCH|DELETE /api/fridges/:fridgeId`, `GET|PUT /api/fridges/:fridgeId/settings`, `POST /api/fridges/:fridgeId/gateway-token/rotate`, `POST /api/fridges/:fridgeId/members`, `DELETE /api/fridges/:fridgeId/members/:email`.
- **Inventory, Photos & History:** `GET|POST /api/fridges/:fridgeId/inventory`, `PATCH|DELETE /api/fridges/:fridgeId/inventory/:itemId`, `GET /api/fridges/:fridgeId/inventory/:itemId/photo`, `GET /api/fridges/:fridgeId/telemetry`, `GET /api/fridges/:fridgeId/status`, `GET /api/fridges/:fridgeId/door_events`.
