# Server 'S' (Cloud Backend & Web Dashboard) — Software Architecture

This document specifies the cloud infrastructure, runtime environment, third-party API integrations, database schemas, and frontend software stack for **Server `'S'`** (`server/`), encompassing the Firebase serverless backend, AI orchestrator, notification dispatcher, and the multi-page **Vite + React** web application.

* **Related Documents:**
  * [`README.md`](README.md) — Setup, development, formatting, testing, and typecheck commands
  * [`GOAL.md`](GOAL.md) — Feature and edge-case checklist
  * [`SUMMARY.md`](../SUMMARY.md) — System-wide architecture
  * **Interfaces:** [`CBS.md`](../interface/CBS.md) (Camera ↔ Server), [`SBG.md`](../interface/SBG.md) (Server ↔ Gemini), [`SUL.md`](../interface/SUL.md) (Server → LINE)

---

## 1. System Topology & Data Flow

```text
+-----------------------+              HTTPS JSON / Images (CBS.md)            +-----------------------------------+
|  Node 'C' Gateway     | <==================================================> | Firebase Cloud Functions          |
|  (Pi-top [4] Python)  |                                                      | (TypeScript / Node.js 20 Runtime) |
+-----------------------+                                                      +-----------------------------------+
                                                                                     ^           |           |
+------------------------------------------------------+                             |           |           | Context-Enriched
|  Web Dashboard User (Browser)                        |                             |           |           | Prompts (SBG.md)
|  - Vite + React Single Page App (TypeScript)         |                             |           |           v
|  - React Router (Multi-Page Client Navigation)       |                             |           |   +-----------------------+
|  - Real-Time Firestore onSnapshot Listeners          |                             |           |   | Entity 'G': Gemini    |
+------------------------------------------------------+                             |           |   | 3.5 Flash Lite VLM    |
         | Google SSO           | Static Assets                                      |           |   +-----------------------+
         | Auth (Client SDK)    | (SPA HTML/JS/CSS)                                  |           |
         v                      v                                                    |           | HTTPS Outbound
+------------------------------------------------------+                             |           | Alerts (SUL.md)
|  Firebase Hosting & Firebase Authentication          |                             |           v
|  - Serves compiled Vite SPA bundles (dist/)          |                             |   +-----------------------+
|  - Enforces Google OAuth 2.0 / OpenID Connect        |                             |   | Entity 'L': LINE      |
+------------------------------------------------------+                             |   | Messaging API Push    |
         |                                                                           |   +-----------------------+
         | Direct Real-Time Queries (Client Firestore SDK with Security Rules)       |
         v                                                                           v
+------------------------------------------------------------------------------------------------------------------+
|  Cloud Firestore Database & Cloud Storage                                                                        |
|  - /fridges/{fridgeId}                  (Document: name, createdAt, members, last_seen_s, last_telemetry)        |
|  - /fridges/{fridgeId}/private          (Owner-only subdocument: config with geminiApiKey, gatewayTokenHash)     |
|  - /fridges/{fridgeId}/inventory        (Active food items, expiry dates, FEFO status; hard-deleted on checkout) |
|  - /fridges/{fridgeId}/telemetry_minute (Minute-bucketed LM73 temp, SGP40 VOC, LDR light time-series)            |
|  - /fridges/{fridgeId}/door_events      (Actuator status, INA219 stall cutoffs, IR sensor events)                |
|  - /storage/food_crops/{fridgeId}       (Cropped JPEG food images uploaded by Gateway 'C'; deleted on checkout)  |
+------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Software & Tech Stack Architecture

| Component / Layer | Specific Technology / Package | Version / Details | Role in SmarterFridge |
|---|---|---|---|
| **Package Manager & Dev Tool** | **Bun (`bun`)** | `v1.2+` | High-performance package manager and script runner for fast local dependency resolution, test execution, and building frontend assets. |
| **Programming Language** | **TypeScript** | `5.x+` (`strict: true` in [`tsconfig.json`](tsconfig.json)) | Strict static typing across Cloud Functions, web application components, and Firestore schemas (no `any`). |
| **Frontend Framework & Build Tool** | **Vite + React (`@vitejs/plugin-react`)** | Vite 5+, React 18+ | Fast HMR dev server and optimized static production bundle builder compiling the SPA to `dist/` for Firebase Hosting. |
| **Client-Side Routing** | **React Router (`react-router-dom`)** | `v6+` / `v7+` | Declarative client-side routing supporting multi-page views, route parameters (`/fridges/:fridgeId`), nested layouts, and auth guards. |
| **Client Firebase SDK** | **Firebase Web SDK (Modular)** (`firebase/app`, `firebase/auth`, `firebase/firestore`) | `v10+` | Direct, secure browser integration for Google SSO login and reactive real-time database listeners (`onSnapshot`). |
| **Internationalization (i18n)** | **Custom React i18n Context & `Intl` API** | Built-in TypeScript module | Dynamic language switching between Thai (`th`) and English (`en`), persisting preference to `localStorage`, with localized date and category formatting. |
| **Cloud Backend & Compute** | **Firebase Cloud Functions (v2)** (`firebase-functions`, `firebase-admin`) | Node.js 20 runtime | Serverless endpoints running on official Node.js 20 environment handling Gateway `'C'` telemetry ingestion, Gemini AI vision pipelines, and scheduled daily alert cron jobs. |
| **NoSQL Database & Object Storage** | **Cloud Firestore & Cloud Storage** | Firestore v1, Google Cloud Storage | Real-time hierarchical document storage for multi-tenant fridge data, sensor time series, and uploaded cropped food images. |
| **Multimodal AI (Entity `'G'`)** | **Google Gen AI SDK (`@google/genai`) — Gemini 3.5 Flash Lite** | `gemini-3.5-flash-lite` | Multimodal VLM performing food identification, shelf-life estimation, and FEFO inventory matching ([`SBG.md`](../interface/SBG.md)). |
| **Notification Service (Entity `'L'`)** | **LINE Messaging API (`@line/bot-sdk` / HTTPS REST)** | LINE Messaging API v2 | Dispatches push notifications for expiring food, VOC spoilage warnings, door-left-open alerts, and obstruction errors ([`SUL.md`](../interface/SUL.md)). |
| **Authentication & Access Control** | **Firebase Auth — Google SSO (`GoogleAuthProvider`)** | OAuth 2.0 / OpenID Connect | Authenticates dashboard users with Google accounts; verified in Firestore Security Rules to enforce fridge-level permissions. |
| **Web Hosting & CDN** | **Firebase Hosting** | Firebase Hosting CLI | Serves the Vite-compiled static Single Page Application with URL rewrites mapping all subroutes to `/index.html`. |
| **Testing & Quality** | **Bun Test (`bun test`)**, **TypeScript (`tsc --noEmit`)**, **Prettier** | Configured in [`package.json`](package.json) | Unit tests, static type verification, and automated code formatting. |

---

## 3. Frontend Web Application Architecture (Vite + React + React Router)

The web dashboard is an interactive, responsive Single Page Application (SPA) designed for desktop and mobile browsers, allowing users to monitor their fridges, manage inventory, view live sensor telemetry, inspect door safety logs, and configure hardware and AI keys.

### 3.1 Multi-Page Route Hierarchy (React Router)

The application uses **React Router (`react-router-dom`)** to structure navigation into distinct pages with nested layouts and protected route guards:

```text
/ (Public Layout)
│
├── /login ...................... Google SSO login page (Firebase Auth)
│
└── /fridges (Protected Layout: requires authenticated Google account)
    │
    ├── /fridges ................ Multi-fridge hub: list owned/shared fridges, create new fridge modal
    │
    └── /fridges/:fridgeId (Fridge Layout: contextual header with active fridge selector)
        │
        ├── /fridges/:fridgeId .................. Live Dashboard & Inventory Overview
        │                                         - FEFO-sorted active grocery inventory table
        │                                         - Live environmental metrics (LM73 temp, SGP40 VOC, LDR light)
        │                                         - Door closer status (closed/open, motor state, IR sensor)
        │                                         - Manual check-in / check-out / edit food modal
        │
        ├── /fridges/:fridgeId/analytics ........ Deep-Dive Analytics & Sensor History
        │                                         - Interactive time-series charts (1h, 24h, 7d, 30d)
        │                                         - Temperature deviation and VOC spoilage spike tracking
        │                                         - Door actuation history and obstruction incident log
        │
        └── /fridges/:fridgeId/settings ......... Fridge Management & Hardware Provisioning (Owner Only)
                                                  - Members & Permissions: Invite Google accounts by email (`member` role) and revoke access
                                                  - Gateway 'C' Provisioning: View and copy permanent Bearer token (`GATEWAY_TOKEN`) to paste into camera `.env`
                                                  - AI Inference Key: Set/update fridge Google Gen AI (Gemini) API key
                                                  - LINE Notifications: Configure target LINE User/Group IDs
                                                  - Refrigerator Lifecycle: Rename or delete refrigerator
```

### 3.2 Page Component Breakdown

1. **Login Page (`/login`):**
   * Presents branding, system overview, and a single **"Sign in with Google"** button triggering `signInWithPopup(auth, googleAuthProvider)`.
   * Automatically redirects authenticated users to `/fridges` (or their previous redirect target).
2. **Fridge Hub Page (`/fridges`):**
   * Queries Firestore for all fridges where the authenticated user's email exists in the `members` map (`members[request.auth.token.email] != null`).
   * Displays responsive cards for each accessible fridge showing current online status, item count, and temperature.
   * Includes a **"Create New Fridge"** action that initializes a new fridge document with the current user's email registered as `'owner'`.
3. **Fridge Dashboard Page (`/fridges/:fridgeId`):**
   * **Active Inventory Panel:**
     * Lists all active items from `/fridges/{fridgeId}/inventory` ordered by `estimated_expiry_date` ascending (**First Expired, First Out — FEFO**).
     * Color-coded status badges: **Fresh** (green), **Expiring Soon** (yellow, within 2 days), **Expired** (red).
     * Filterable by category (`Dairy`, `Produce`, `Meat`, `Beverage`, `Leftovers`) and searchable by item name.
     * Quick actions: Manual Check-In, Manual Check-Out (hard-deletes item and image), and Expiry Date Edit (available to all members and owners).
   * **Real-Time Telemetry Bar:**
     * Live metrics fed by Firestore `onSnapshot` listeners on `last_telemetry` in `/fridges/{fridgeId}` (and `/fridges/{fridgeId}/telemetry_minute`).
     * Displays temperature (°C) with safety threshold alert (`> 8.0 °C`), VOC Index (0–500) with spoilage warning (`> 250`), and door light level (LDR).
   * **Door Actuator & Safety Card:**
     * Shows current door physical state (`CLOSED`, `OPEN`, `CLOSING`, `ABORTED`) derived from `/fridges/{fridgeId}/door_events`.
     * Highlights obstruction stall events (`INA219 ≥ 1200 mA`) and limit switch home confirmations.
4. **Analytics Page (`/fridges/:fridgeId/analytics`):**
   * Time-series graphs plotting historical temperature readings against safety thresholds.
   * VOC Index trend graphs correlating VOC spikes with spoiled food items.
   * Door opening frequency and duration metrics to analyze cold-air loss.
5. **Fridge Settings Page (`/fridges/:fridgeId/settings` — Owner Only):**
   * **Role Enforcement:** Accessible only to users holding the `'owner'` role. Non-owner members attempting to navigate here are redirected back to the dashboard.
   * **Access Control:** Add or revoke permissions for other Google accounts by email (`'member'` role).
   * **Gateway `'C'` Configuration:** Displays the permanent Bearer API token (`GATEWAY_TOKEN`). The token is permanent and does not expire automatically; the owner copies this token and manually pastes it into `.env` on the Pi-top [4] via connected keyboard/mouse during one-time hardware setup. A manual revocation and token regeneration button is provided exclusively for the owner in case the token is ever compromised.
   * **Google AI Key Management:** Form to securely store or update the fridge's dedicated Google Gen AI API key in the owner-only `/fridges/{fridgeId}/private/config` subdocument ([`SBG.md`](../interface/SBG.md)).
   * **Refrigerator Management:** Options to rename or delete the refrigerator.

### 3.3 Internationalization (i18n) & Language Selection Architecture

The web application provides an intuitive language selection mechanism enabling users to switch between **Thai (`th`)** and **English (`en`)** seamlessly across mobile and desktop viewports:

1. **Language Switcher Widget (`LanguageToggle.tsx`):**
   * Placed prominently in the global navigation bar / mobile header.
   * Toggles the active locale with instant reactive UI re-rendering without page reload.
   * Persists user preference to browser `localStorage` (`smarterfridge_locale = "th" | "en"`) and synchronizes with user profile settings.
2. **Category Translation Bridge:**
   * Canonical categories are stored in English in Firestore (`FoodCategory`), and translated dynamically in the UI:
     * `Dairy` ↔ `นมและผลิตภัณฑ์นม`
     * `Produce` ↔ `ผักและผลไม้`
     * `Meat` ↔ `เนื้อสัตว์`
     * `Seafood` ↔ `อาหารทะเล`
     * `Beverage` ↔ `เครื่องดื่ม`
     * `Condiments` ↔ `เครื่องปรุงและซอส`
     * `Leftovers` ↔ `อาหารปรุงสุก / ของเหลือ`
     * `Bakery` ↔ `เบเกอรี่และขนมปัง`
     * `Snacks` ↔ `ขนมขบเคี้ยว`
     * `Other` ↔ `อื่นๆ`
3. **Locale-Aware Date & Expiry Formatter:**
   * **English (`en`):** Standard Gregorian formatting (`Nov 4, 2026`) and relative badges (`"Expires in 2 days"`, `"Expired 1 day ago"`).
   * **Thai (`th`):** Thai Buddhist Era formatting (`4 พ.ย. 2569`) via `Intl.DateTimeFormat('th-TH-u-ca-buddhist')` and localized relative badges (`"หมดอายุในอีก 2 วัน"`, `"หมดอายุแล้ว 1 วัน"`).

### 3.4 SPA Deployment & Firebase Hosting Configuration

Because React Router performs client-side routing, Firebase Hosting must rewrite all dynamic URL paths to `/index.html` so that deep links (e.g. `/fridges/kitchen-fridge/settings`) load the single-page application correctly rather than returning a 404.

In `firebase.json`:
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

---

## 4. Firestore Database & Security Rules Architecture

### 4.1 Collection Hierarchy

```text
/fridges/{fridgeId}
  ├── Document Fields:
  │     - name: string
  │     - createdAt: uint64
  │     - members: { [email: string]: "owner" | "member" }
  │     - lineTargetId: string | null
  │     - last_seen_s: uint64                # Epoch timestamp of latest gateway contact (online if now - last_seen_s < 60s)
  │     - last_telemetry: {                  # Cached latest reading for fast dashboard rendering
  │         node_id: string,
  │         timestamp_s: uint64,
  │         temp_celsius: number | null,
  │         voc_index: number | null,
  │         light_ldr: number | null
  │       }
  │
  ├── /private/config (Owner-only subdocument)
  │     Fields:
  │       - geminiApiKey: string               # Dedicated Google Gen AI API key for Gemini 3.5 Flash Lite
  │       - gatewayToken: string               # Plaintext Bearer token (displayed to owner to paste into .env)
  │       - gatewayTokenHash: string           # SHA-256 hash verified by Cloud Functions
  │
  ├── /inventory/{itemId}                      # Active items only; hard-deleted from DB + Storage upon check-out
  │     Fields:
  │       - name_th: string                     # Thai food name (e.g. "นมสดพาสเจอร์ไรส์")
  │       - name_en: string                     # English food name (e.g. "Pasteurized Whole Milk")
  │       - storage_recommendation_th: string   # Thai storage advice (e.g. "เก็บในช่องแช่เย็นหลัก")
  │       - storage_recommendation_en: string   # English storage advice (e.g. "Store in main refrigerator shelf")
  │       - category: FoodCategory              # Canonical category key (e.g. "Dairy")
  │       - estimated_expiry_date: string       # ISO 8601 date string ("YYYY-MM-DD")
  │       - check_in_timestamp_s: uint64        # Epoch timestamp of check-in
  │       - image_storage_path: string | null   # Firebase Storage path (null for manual web check-ins; deleted on check-out)
  │       - confidence: number                  # Recognition confidence: 0.0-1.0 (defaults to 1.0 for manual web entries)
  │       - check_in_source: string             # "CAMERA" or "WEB_MANUAL"
  │
  ├── /telemetry_minute/{YYYYMMDD_HHMM}        # Minute bucketing (1,440 docs/day per fridge, well under 20k/day free quota)
  │     Fields:
  │       - bucket_minute: string               # "20261026_2030"
  │       - samples: TelemetrySamplePayload[]   # Array of batched samples from CBS.md
  │
  └── /door_events/{eventId}
        Fields: node_id, timestamp_s, status ('CLOSING' | 'SUCCESS' | 'OBSTRUCTION_ERROR' | 'ABORTED' | 'TIMEOUT_ERROR' | 'FAULT_LOCKOUT' | 'CONTRADICTION_ERROR')
```

### 4.2 User Roles & Access Control Model

Every dashboard user is identified by their Google email address (`request.auth.token.email`). The system supports a many-to-many relationship: a single user can belong to multiple refrigerators, and a refrigerator can have multiple users with assigned roles:

| Role | Permissions & Capabilities |
|---|---|
| **`owner`** | • Full administrative authority.<br>• Rename or delete the refrigerator.<br>• Invite new users by Gmail address (assigning `'member'` role) and revoke access.<br>• Update the Google Gen AI (Gemini) API key.<br>• View the permanent Bearer token (`gatewayToken`) to manually copy/paste into Node `'C'`'s `.env` on device.<br>• Add, modify, and delete inventory items and view all telemetry. |
| **`member`** | • Operational access.<br>• Add, edit, and remove food items in the active inventory.<br>• View all live sensor telemetry, historical charts, and door safety logs.<br>• **Restricted:** Cannot view or edit API keys, Bearer tokens, member lists, or delete the fridge. |

### 4.3 Security Rules Architecture

Firestore security rules enforce role-based access control and strict data isolation directly at the database layer:

1. **User Authentication:** Enforced via `request.auth != null && request.auth.token.email != null`.
2. **Refrigerator Document (`/fridges/{fridgeId}`):**
   * **Read:** Allowed if `request.auth.token.email in resource.data.members`.
   * **Create:** Allowed for any authenticated user, provided `request.resource.data.members[request.auth.token.email] == 'owner'`.
   * **Update / Delete:** Allowed strictly if `resource.data.members[request.auth.token.email] == 'owner'`.
3. **Subcollections (`/inventory`, `/telemetry_minute`, `/door_events`):**
   * Allowed for both `owner` and `member` roles:
     ```javascript
     function isFridgeMember(fridgeId) {
       return request.auth.token.email in get(/databases/$(database)/documents/fridges/$(fridgeId)).data.members;
     }
     ```
   * Both `owner` and `member` can read/write to `/inventory`.
   * Both `owner` and `member` can read `/telemetry_minute` and `/door_events`.
4. **Owner-Only Subdocument (`/fridges/{fridgeId}/private/config`):**
   * **Read / Write:** Restricted strictly to the refrigerator's `owner`:
     ```javascript
     function isFridgeOwner(fridgeId) {
       return get(/databases/$(database)/documents/fridges/$(fridgeId)).data.members[request.auth.token.email] == 'owner';
     }
     ```
   * Regular members have zero read or write access to `/private/config`, guaranteeing that `geminiApiKey`, `gatewayToken`, and `gatewayTokenHash` cannot be read or leaked.
5. **Hardware Ingestion Security:** Gateway `'C'` never talks to Firestore directly with client SDKs. It connects to Cloud Functions over HTTPS using its permanent Bearer token. Cloud Functions validate the token against `gatewayTokenHash` in `/private/config` using the Firebase Admin SDK.
