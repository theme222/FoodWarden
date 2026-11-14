# Cloud Architecture Comparison & Migration Decision (`server/`)

- **Date:** 2026-11-14
- **Branch:** `feat/server`
- **Status:** Accepted
- **Related Documents:**
  - [Server Architecture](../ARCHITECTURE.md) | [Server Checklist](../GOAL.md) | [Server Review](SERVER-REVIEW.md) | [Diagram Audit](DIAGRAM-AUDIT.md)
  - [System Summary](../../SUMMARY.md) | [Project Proposal](../../resources/Embedded_Systems_Project.md) | [Course Rubric](../../RUBRIC.md)
  - [CBS Contract](../../interface/CBS.md) | [SBG Contract](../../interface/SBG.md) | [SUL Contract](../../interface/SUL.md)

---

## 1. Context & Why Re-evaluate Firebase

The initial `server/` design on `feat/server` targeted **Firebase** (Hosting, Auth, Cloud Firestore, Cloud Storage, and Cloud Functions v2) under the project proposal's `0 USD (Free tier)` budget in [Embedded_Systems_Project.md](../../resources/Embedded_Systems_Project.md).

During production provisioning evaluation (November 2026), three blockers and long-term constraints were identified on Firebase:

1. **Credit Card / Blaze Plan Requirement:**
   - **Cloud Functions v2** cannot be deployed on the Spark (no-card) plan; it requires upgrading to the pay-as-you-go **Blaze Plan**, which also provisions **Artifact Registry** container storage (0.5 GB free cap; excess triggers billing even with zero traffic).
   - **Cloud Storage for Firebase** requires the Blaze Plan (effective October 2025 for new buckets). Moreover, `*.firebasestorage.app` free-tier buckets are restricted to specific US regions (`us-central1`, `us-east1`, `us-west1`); creating a bucket in `asia-southeast1` bills from the first byte.
   - Blaze has no hard spending cap that automatically halts runaway traffic or container builds.
2. **Firestore Spark Plan Free Quota Ceiling (Long-Term Multi-Fridge Use):**
   - Spark provides **50,000 reads/day** and **20,000 writes/day** (with 1 GiB storage).
   - A single fridge generates up to 1,440 `telemetry_minute` document writes/day plus status heartbeats, door events, and dashboard queries. Expanding to multiple fridges or running 7d/30d analytics queries quickly approaches daily read/write limits.
3. **Production Real-Time UX Without Manual Refresh:**
   - The web dashboard must update inventory, telemetry charts, and door safety logs automatically in real time when Gateway `'C'` sends data—without polling delays or requiring manual page refreshes.

---

## 2. Workload Baseline (1–3+ Fridges, Continuous Operation)

Estimated from [SUMMARY.md](../../SUMMARY.md), [CBS.md](../../interface/CBS.md), and the 24-hour continuous operation requirement in [RUBRIC.md](../../RUBRIC.md):

| Workload Dimension               | 1 Fridge / Day                                              | 3 Fridges / Month (+ Testing)                | Notes                                                                                   |
| -------------------------------- | ----------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| **HTTP API Requests**            | ~2,000–5,000 req                                            | ~150,000–450,000 req                         | `/api/status` every 60s (1,440/day), `/api/telemetry`, `/api/door_events`, check-in/out |
| **Database Writes**              | ~1,500–3,000 writes (minute buckets) or up to ~18k SQL rows | ~150,000–550,000 writes                      | Requires idempotent retry deduplication for Gateway `'C'` offline SQLite queue          |
| **Database Reads**               | ~500–5,000 reads                                            | ~50,000–300,000 reads                        | Dashboard 1h/24h/7d/30d charts, inventory FEFO queries, token hash lookups              |
| **Object Storage (Food Photos)** | ~5–30 JPEGs (50 KB–1.5 MB), deleted on checkout             | < 500 MB stored, < 5k Class A, < 50k Class B | Must remain **private** (member-verified access only, never public URLs)                |
| **Web Hosting (SPA)**            | Vite + React bundle (~821 KB / ~252 KB gzip)                | < 1–5 GB bandwidth                           | SPA fallback (`** → /index.html`) + same-origin `/api/**`                               |
| **Scheduled Cron**               | 1–2 runs/day                                                | ~30–60 runs/month                            | Daily expiry digest + LINE alerts + orphan image cleanup                                |

---

## 3. Options Compared (Compare & Choose)

| Dimension                     | Option 1: Full Firebase (Blaze)                           | Option 2: Smart Hybrid _(CF Workers + R2 + Firebase Spark)_          | Option 3: Full Cloudflare 100% _(Chosen)_                                                   |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Compute / API**             | Cloud Functions v2 (Node 22, Blaze)                       | Workers Free (100k req/day, 10 ms CPU)                               | Workers Free (100k req/day, 10 ms CPU)                                                      |
| **Web Hosting**               | Firebase Hosting (360 MB/day free transfer)               | Workers Static Assets (unlimited bandwidth)                          | Workers Static Assets (unlimited bandwidth)                                                 |
| **Object Storage**            | Cloud Storage (Blaze; US-only free tier)                  | Cloudflare R2 (10 GB, 1M Class A, 10M Class B, 0 USD egress)         | Cloudflare R2 (10 GB, 1M Class A, 10M Class B, 0 USD egress)                                |
| **Database**                  | Firestore (Spark: 50k R / 20k W / day)                    | Firestore (Spark: 50k R / 20k W / day) via REST API from Worker      | **Cloudflare D1** (SQLite: 5M R / 100k W / day, 5 GB)                                       |
| **Real-Time UI Sync**         | Firestore `onSnapshot` (built-in)                         | Firestore `onSnapshot` (built-in)                                    | **Durable Objects (SQLite + WebSocket Hibernation)**                                        |
| **User Authentication**       | Firebase Auth (Google SSO, no card)                       | Firebase Auth (Google SSO) + `jose` JWKS verify in Worker            | **Better Auth (>= 1.6)** + Google OAuth (OIDC) in D1                                        |
| **Scheduled Jobs**            | Cloud Scheduler (Blaze)                                   | Workers Cron Triggers (5 free triggers)                              | Workers Cron Triggers (5 free triggers)                                                     |
| **Analytics & Deduplication** | NoSQL minute-bucket docs; timestamp-only dedup limitation | Same Firestore NoSQL limits                                          | **SQL queries** (1h/24h/7d/30d) + composite `PRIMARY KEY (fridge_id, node_id, timestamp_s)` |
| **Billing Risk**              | Blaze required; no hard stop                              | Workers Free hard-stops; R2 < 1% of free quota; Firestore Spark free | Workers Free hard-stops; R2 < 1% of free quota; D1/DO Free hard-stops                       |
| **Migration Effort**          | Minimal (existing scaffold)                               | Medium (port Functions to REST + R2; keep React UI)                  | Higher (port API + D1 schema + DO WebSocket + Better Auth + Miniflare tests)                |

### Why Option 1 (Full Firebase Blaze) Was Rejected

- Requires upgrading to Blaze + attaching a credit card for both Cloud Functions v2 and Cloud Storage.
- Introduces unbudgeted billing surfaces (Artifact Registry container images and non-US `firebasestorage.app` bucket egress/storage) with no automatic hard stop.

### Why Option 2 (Smart Hybrid) Was Not Selected as the Target

- Fast for an initial demo because [data.ts](../src/data.ts) and [firestore.rules](../firestore.rules) already exist, **but**:
  1. Splits data across two cloud providers (Cloudflare edge Workers making cross-cloud HTTPS REST calls to Google Cloud Firestore on every gateway write and token lookup).
  2. Remains bounded by Firestore Spark's **20,000 writes/day** and **50,000 reads/day** and lacks native SQL range aggregation for multi-day analytics and multi-node telemetry deduplication.

### Why Option 3 (Full Cloudflare 100%) Was Chosen

1. **Unified Production Architecture on One Edge Network:** Workers, Static Assets, D1, R2, Durable Objects, and Cron Triggers run together on Cloudflare's edge with zero cross-cloud Firestore REST hops.
2. **Real-Time UX Without Manual Refresh (Replacing `onSnapshot`):**
   - Each `fridgeId` maps to a **Durable Object (SQLite backend)** using the **WebSocket Hibernation API** (`ctx.acceptWebSocket`).
   - Idle connected browsers incur **0 GB-s** duration; outbound server broadcasts count as **0 requests**; incoming WebSocket messages meter at **20:1** toward the 100,000 req/day limit.
   - Free Plan limits for SQLite-backed DO: **100,000 req/day**, **13,000 GB-s/day** (~28.89 active hours/day), **5M SQL rows read/day** (developer docs; product page lists 50M), **100,000 SQL rows written/day**, **5 GB** total storage. _(Legacy KV-backed DO is Paid-only; SQLite-backed DO is required on Free Plan.)_
3. **SQL Data Model & Multi-Node Scalability (D1 SQLite):**
   - D1 Free Plan provides **5M rows read/day**, **100k rows written/day**, **5 GB storage**, and **0 USD egress**.
   - Relational tables cleanly resolve the [CBS.md](../../interface/CBS.md#35-telemetry-ingestion-post-apitelemetry) timestamp-only deduplication bug using `(fridge_id, node_id, timestamp_s)` uniqueness and make 1h/24h/7d/30d queries fast and explicit.
4. **Owned Authentication via Better Auth + Google OAuth:**
   - Uses **`better-auth` (>= 1.6.x)** (`better-auth/minimal` + Drizzle/D1 + `nodejs_compat`) with **Google OAuth only** (no email/password `scrypt` hashing, staying well under the **10 ms CPU/request** Workers Free limit).
   - Requires one-time free setup of a Google OAuth 2.0 Web Client ID in Google Cloud Console (`Google Auth Platform`, zero billing/card required).
   - Keeps sessions in D1 (not Workers KV, which is eventually consistent and enforces a 60s minimum TTL).
5. **Additional Free Cloudflare Capabilities Available for Next Phases:**
   - **Cloudflare Queues** (10,000 ops/day free): Async retryable delivery for LINE Messaging API alerts ([SUL.md](../../interface/SUL.md)) outside the HTTP request path.
   - **Cloudflare AI Gateway** (free): Proxy, latency/error telemetry, rate limiting, and model fallback (`gemini-3.5-flash-lite` → `gemini-2.5-flash-lite`) in front of Gemini ([SBG.md](../../interface/SBG.md)).

---

## 4. Target Architecture

```text
+-----------------------+       HTTPS JSON / JPEG (CBS.md)        +----------------------------------------+
|  Node 'C' Gateway     | <=====================================> | Cloudflare Worker (TypeScript / Edge)  |
|  (Pi-top [4] Python)  |      Bearer GATEWAY_TOKEN               | - Serves Vite SPA (Workers Static Assets)|
+-----------------------+                                         | - Better Auth (Google OAuth + D1)      |
                                                                  | - /api/** REST + Cron Triggers         |
+-----------------------+       Google OAuth + Session Cookie     +------+-------------+------------+------+
|  Web Dashboard User   | <=====================================>        |             |            |
|  (Vite + React SPA)   |       WSS Real-Time (DO Hibernation)           |             |            |
+-----------------------+ <----------------------------------------------+             |            |
                                     |                                                 |            |
                                     v                                                 v            v
                    +-------------------------------+                 +-------------------+  +-------------+
                    | Durable Object: FridgeRoom    |                 | Cloudflare D1     |  | Cloudflare  |
                    | (SQLite + WS Hibernation)     |                 | (SQLite DB)       |  | R2 Bucket   |
                    | - 1 room per fridgeId         |                 | - inventory       |  | (Private    |
                    | - Instant UI push on writes   |                 | - telemetry       |  |  food JPEGs)|
                    +-------------------------------+                 | - door_events     |  +-------------+
                                                                      | - auth & members  |
                                                                      +-------------------+
                                     |
        +----------------------------+----------------------------+
        | HTTPS (SBG.md / AI Gateway optional)                    | HTTPS POST (SUL.md / Queues optional)
        v                                                         v
+-------------------------------+                       +---------------------------------+
| Entity 'G': Gemini 3.5        |                       | Entity 'L': LINE Messaging API  |
| Flash Lite VLM                |                       | Push Alerts & Daily Digest      |
+-------------------------------+                       +---------------------------------+
```

### CLI Tooling Choice: `wrangler` (`wrangler.jsonc`) vs `cf` (`cloudflare.config.ts`)

Cloudflare launched `cf` in open beta (Sept 2026) with `cloudflare.config.ts`, Vite bundling, and OpenAPI command coverage, while `wrangler` enters maintenance for 18 months _after_ `cf` beta ends.

For FoodWarden `server/`, **`wrangler` (`wrangler.jsonc`) is retained as the primary project configuration and dev/test toolchain**:

1. `server/` uses **Bun**, whereas `cf`'s `cloudflare.config.ts` currently requires Node.js 22.18+ and fails on Bun.
2. `cf` is still in beta and lacks `wrangler tail`, single `secret put`, and mature Durable Objects migration automation (`cf migrate` flags DO migrations manually).
3. `@cloudflare/vitest-pool-workers` (Miniflare) integrates directly with `wrangler.jsonc`.
4. `cf` can still be used alongside `wrangler` for account/API inspection (`cf cli search`, `cf d1`, `cf r2`).

---

## 5. Academic & Contract Alignment

- **Course Requirement M5 & Section 2.2 ([Final_Project_Requirements_EN.md](../../resources/Final_Project_Requirements_EN.md)):** Any cloud storage/database platform that stores raw sensor data and serves a live dashboard satisfies M5.
- **Engineering Depth E5 (Security):** Gateway `'C'` retains **HTTPS TLS + permanent Bearer token** ([CBS.md](../../interface/CBS.md)); dashboard users authenticate via Google OAuth + `HttpOnly` session cookies with per-fridge membership enforcement; R2 objects stay strictly private behind authenticated Worker routes.
- **Gateway `'C'` Compatibility:** All existing `CBS.md` URL paths (`/api/health`, `/api/telemetry`, `/api/status`, `/api/door_events`, and planned `/api/inventory/*`) remain unchanged; only `SERVER_BASE_URL` on Pi-top `[4]` updates to the Worker domain.
- **Proposal / Report Note:** [Embedded_Systems_Project.md](../../resources/Embedded_Systems_Project.md) originally named Firebase under `0 USD (Free tier)`. The final report should explain this trade-off (moving from Firebase Functions/Storage/Firestore to Cloudflare Workers/R2/D1/DO to stay truly zero-cost without Blaze billing risk while gaining SQL analytics and WebSocket push).

---

## 6. Incremental Implementation & Commit Plan

Each step is implemented, verified (`tsc --noEmit`, unit/Miniflare tests), and committed separately:

1. **Git Hygiene (Done):** Commit `wrangler` dependency and ignore local AI skill files.
2. **Decision Record (This Document):** Record comparison, limits, and chosen Full Cloudflare stack.
3. **Diagrams & Audit Sync:** Update [Fridge.drawio](../diagram/Fridge.drawio), [cloud.mmd](../diagrams/cloud.mmd), [fridge.mmd](../diagrams/fridge.mmd), [network.mmd](../diagrams/network.mmd) (plus rendered SVGs), and [DIAGRAM-AUDIT.md](DIAGRAM-AUDIT.md) to reflect the Full Cloudflare backend and fix known diagram text drift (`GPIO 18` SGP40 heater gate, `FEFO` not `FIFO`, `CBS.md`/`SBG.md`/`SUL.md` labels, `Gemini 3.5 Flash Lite`).
4. **Worker Scaffold & D1 Schema:** Add `wrangler.jsonc`, D1 SQLite migrations, and `/api/health`.
5. **Gateway Ingestion & Private R2 Storage:** Port `/api/telemetry`, `/api/status`, `/api/door_events`, and R2 JPEG storage with Miniflare integration tests.
6. **Better Auth (Google OAuth) & Membership API:** Add Better Auth + Google OAuth + fridge CRUD + owner/member permissions.
7. **Durable Objects WebSocket (`FridgeRoom`):** Implement SQLite Hibernation WebSocket room per `fridgeId` and trigger broadcasts on writes.
8. **Frontend Migration (`server/src/`):** Replace Firebase SDK in [firebase.ts](../src/firebase.ts) and [data.ts](../src/data.ts) with Better Auth client + REST + WebSocket hook (`useFridgeSocket`).
9. **AI (`SBG.md`) & LINE (`SUL.md`) + Cron:** Implement Gemini 3.5 Flash Lite check-in/out endpoints and LINE Messaging API push alerts / daily digest.
