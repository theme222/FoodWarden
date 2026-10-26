# Server 'S' (Cloud Backend & Dashboard) — Completion Checklist (`GOAL.md`)

> [!IMPORTANT]
> **Incremental Development Guideline:**
> This file is a master checklist of features, use cases, tests, and edge-case handlers strictly required before the **Server & Web Dashboard (`server/`)** subsystem is considered finished.
> **This checklist does NOT need to be completed in a single prompt.** Developers and AI agents are expected to implement and verify these components incrementally across multiple steps.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## 1. Core Features
- [ ] **Direct User Interface (Mobile-Responsive Web App):** Build and host a mobile-optimized Single Page Application (Vite + React + React Router) allowing users to view fridge metrics, inventory, door safety events, and analytics directly on their phones or browsers.
- [ ] **Language Selection Method (Thai ↔ English):** Provide a dynamic language switcher in the web dashboard header allowing the user to toggle between Thai (`th`) and English (`en`), persisting selection in client storage and dynamically translating all UI labels, navigation menus, metric units, and status indicators.
- [ ] **Bilingual Food Data Storage & Translation:** Store grocery items in Firestore `inventory` with names and descriptions in both languages (`name_th`, `name_en`, `storage_recommendation_th`, `storage_recommendation_en`). Implement bidirectional translation lookup for canonical food categories (`Dairy` ↔ `นมและผลิตภัณฑ์นม`, `Produce` ↔ `ผักและผลไม้`, etc.) and locale-aware date formatting (Buddhist Era `พ.ศ.` vs Gregorian `CE`).
- [ ] **Strict TypeScript Interfaces:** Mirror data contracts from [`CBS.md`](../interface/CBS.md), [`SBG.md`](../interface/SBG.md), and [`SUL.md`](../interface/SUL.md) locally in TypeScript with zero `any` types.
- [ ] **Firestore Database & Security Rules:** Define collections for `inventory`, `telemetry_minute`, and `door_events` with strict Firebase Security Rules tied to Google SSO authentication.
- [ ] **Telemetry & Event Ingestion Endpoints ([`CBS.md`](../interface/CBS.md)):** Implement HTTPS Cloud Functions to ingest batched sensor telemetry (`temp_celsius`, `voc_index`, `light_ldr`, `timestamp_s`) and door actuation logs from Gateway `'C'`.
- [ ] **Gemini 3.5 Flash Lite Orchestration ([`SBG.md`](../interface/SBG.md)):** Implement check-in classification and context-enriched check-out matching using `@google/genai` with structured JSON schemas returning bilingual food metadata.
- [ ] **LINE Messaging API Dispatcher ([`SUL.md`](../interface/SUL.md)):** Send push notifications to LINE for expiring items, VOC spoilage spikes, door-ajar warnings, and door obstruction errors.
- [ ] **Web Dashboard with Google SSO:** Host the web interface displaying active fridge inventory (sorted by FEFO), historical temperature/VOC charts, and door safety logs protected by Firebase Google Sign-In.

---

## 2. Use Cases
- [ ] **Mobile-First Fridge Monitoring:** User opens the web app on their smartphone, signs in with Google SSO, views their fridges, checks live temperature/VOC metrics, and switches between Thai and English with a single tap.
- [ ] **Signup, fridge creation and permissions:** User signs up using a google account and is led to a page where they can view many fridges. They may create a fridge and invite other google accounts to have access to a fridge. Each fridge's contents are separate from one another.
- [ ] **Hardware setup and registration:** A user can request for a unique permanent identifier that the gateway `'C'` may use to authenticate itself to modify the contents of the fridge.
- [ ] **API Key:** Each fridge may own one google AI API key for LLM inference. Users must add this into the system explicitly.
- [ ] **Bilingual Grocery Check-In Pipeline:** On `POST /api/inventory/checkin/draft`, receive compressed JPEG food image from Gateway `'C'` → call Gemini 3.5 Flash Lite with bilingual extraction schema → upload JPEG to Firebase Storage and deterministically compute `estimated_expiry_date` → return draft bilingual metadata and `image_storage_path` to Gateway `'C'` (zero Firestore writes). On `POST /api/inventory/checkin`, persist the confirmed item to Firestore `inventory`.
- [ ] **Context-Enriched Check-Out Pipeline:** On `POST /api/inventory/checkout/draft`, receive compressed JPEG food image from Gateway `'C'` → query active Firestore `inventory` → inject candidate items into Gemini 3.5 Flash Lite prompt → deterministically sort candidate matches by FEFO (`estimated_expiry_date ASC`) and return draft candidates with their `item_id`s to Gateway `'C'`. On `POST /api/inventory/checkout`, permanently hard-delete the confirmed item document from Firestore `inventory` and delete its associated JPEG image from Firebase Storage.
- [ ] **Alerts:** Trigger LINE notifications when node `'F'` reports sustained elevated SGP40 VOC index values, temperature increase beyond normal levels, and when node `'D'` fails to close the door.

---

## 3. Edge Cases & Failure Mode Handlers
- [ ] **Malformed or Unrecognizable Food Images:** Handle low-confidence or unrecognizable Gemini responses gracefully by returning a structured fallback prompt for manual selection on Gateway `'C'`.
- [ ] **Idempotent Batched Telemetry Ingestion:** Deduplicate re-sent telemetry batches from Gateway `'C'` (when flushing its offline store-and-forward buffer) strictly by `node_id` and `timestamp_s`.
- [ ] **LINE Notification Rate Limiting & Cooldown:** Enforce per-alert cooldown windows so continuous VOC spikes or repeated door events do not spam the user's LINE chat.
- [ ] **Unauthorized API Access:** Reject unauthenticated requests to Cloud Functions and Firestore collections with proper HTTP `401`/`403` status codes.

---

## 4. Tests & Quantitative Metrics
- [ ] **Unit & Schema Validation Tests:** Test all request/response validators, FEFO sorting logic, and Gemini prompt builders using `bun test`.
- [ ] **Static Type Verification:** Pass `bun run typecheck` (`tsc --noEmit`) with zero errors under `strict: true`.
- [ ] **Gemini API Latency & Accuracy Logging:** Record cloud round-trip latency (`ms`) and classification accuracy across test grocery items.
