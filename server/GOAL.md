# Server 'S' (Cloud Backend & Dashboard) — Completion Checklist (`GOAL.md`)

> [!IMPORTANT]
> Master verification checklist for the **Server & Web Dashboard (`server/`)** subsystem.

- **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## 1. Core Features

- [x] **Direct User Interface (Mobile-Responsive Web App):** Built and served as a Vite + React + React Router SPA via Cloudflare Workers Static Assets (`dist/` + SPA fallback).
- [x] **Language Selection Method (Thai ↔ English):** Instant dynamic language switcher (`src/words.ts`, `src/model.ts`) persisted in `localStorage` across navigation, telemetry, door events, settings, and inventory views.
- [x] **Bilingual Food Data Storage & Translation:** D1 `inventory` stores `name_th`, `name_en`, `storage_recommendation_th`, `storage_recommendation_en`, canonical categories with Thai mappings, and Buddhist Era (`พ.ศ.`) / Gregorian date formatting.
- [x] **Strict TypeScript Interfaces:** Strictly typed Hono Worker modules, D1 queries, and React components (`strict: true`, zero `any`).
- [x] **D1 Database & Private R2 Storage:** D1 schema (`migrations/0001_init.sql`) and tenant-isolated R2 bucket (`PHOTOS`) served exclusively through authenticated Worker endpoints.
- [x] **Telemetry, Status & Door Event Ingestion Endpoints ([`CBS.md`](../interface/CBS.md)):** `POST /api/telemetry`, `POST /api/status`, and `POST /api/door_events` with Bearer auth, validation, and atomic deduplication.
- [x] **Gemini 3.5 Flash Lite Orchestration ([`SBG.md`](../interface/SBG.md)):** Strict `application/json` schema calls for `CHECK_IN` and context-enriched `CHECK_OUT`, deterministic expiry computation, FEFO ordering, `429`/`503` retries, and `gemini-2.5-flash-lite` fallback.
- [x] **LINE Messaging API Dispatcher:** Bilingual push alerts for door obstruction/timeout/lockout/contradiction events, VOC/temperature spikes, and scheduled daily FEFO expiry digests with atomic `alert_cooldowns` deduplication.
- [x] **Web Dashboard with Google OAuth & Live WebSockets:** Better Auth Google OAuth SSO (plus dev-only local login) and SQLite-backed `FridgeRoom` Durable Object hibernating WebSockets.

---

## 2. Use Cases

- [x] **Mobile-First Fridge Monitoring:** View live metrics, 1h–30d history charts, FEFO inventory, node heartbeats, and door safety logs with instant `th`/`en` toggling.
- [x] **Signup, Fridge Creation & RBAC:** Google OAuth onboarding, multi-fridge hub (`/fridges`), owner vs member access controls, member invites, and immediate WebSocket revocation (`4003`).
- [x] **Hardware Provisioning & Gateway Token Rotation:** Owner-only gateway Bearer token view, copy, and rotation (`POST /api/fridges/:fridgeId/gateway-token/rotate`).
- [x] **Per-Fridge Gemini API Key Management:** Stored securely in owner-only `fridge_secrets` and configurable in Settings (`PUT /api/fridges/:fridgeId/settings`).
- [x] **Bilingual Grocery Check-In Pipeline:** `POST /api/inventory/checkin/draft` (AI analysis + R2 crop staging, zero DB writes) → `POST /api/inventory/checkin` (D1 commit + live WebSocket broadcast).
- [x] **Context-Enriched Check-Out Pipeline:** `POST /api/inventory/checkout/draft` (active inventory prompt injection, anti-hallucination ID filter, FEFO sort, zero mutations) → `POST /api/inventory/checkout` (hard-delete D1 + R2 + WebSocket broadcast).
- [x] **Alerts & Scheduled Maintenance:** Instant LINE safety/spoilage alerts (`voc_index >= 250`, `temp_celsius > 8.0`, door errors) plus daily `0 1 * * *` Cron trigger for FEFO expiry digests and >24h orphan R2 crop cleanup.

---

## 3. Edge Cases & Failure Mode Handlers

- [x] **Malformed or Unrecognizable Food Images:** Rejects non-JPEG (`400`), `> 5 MB` (`413`), and `is_food = false` or `confidence < 0.60` (`422 UNIDENTIFIABLE`) without leaving R2/D1 artifacts.
- [x] **Idempotent Batched Telemetry & Multi-Node Safety:** Deduplicates telemetry by `(fridge_id, node_id, timestamp_s)` and door events by `(fridge_id, node_id, timestamp_s, status)` so multi-sensor readings in the same second are never dropped.
- [x] **LINE Notification Cooldowns:** Atomic SQLite `alert_cooldowns` upsert prevents alert storms from sustained spikes or rapid retries.
- [x] **Tenant & Role Authorization:** Rejects unauthenticated (`401`), invalid gateway token (`403`), non-owner settings access (`403`), and cross-fridge photo paths (`400`/`404`).

---

## 4. Tests & Quantitative Metrics

- [x] **Frontend Unit Tests (`bun run test`):** `src/model.test.ts` covers FEFO ordering and bilingual formatters.
- [x] **Miniflare Worker Integration Tests (`bun run test:worker`):** Covers health, gateway telemetry/status/door events, Better Auth & RBAC, `FridgeRoom` WebSocket hibernation, Gemini check-in/out & retries, LINE alerts/cooldowns, and Cron jobs.
- [x] **Static Type Verification (`bun run typecheck`):** Passes `tsc --noEmit` for both frontend (`tsconfig.json`) and Worker (`worker/tsconfig.json`).
