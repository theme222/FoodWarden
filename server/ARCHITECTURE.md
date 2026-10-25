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
|  (Pi-top [4] Python)  |                                                      | (TypeScript / Bun Runtime)        |
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
|  - /fridges/{fridgeId}/inventory   (Food items, expiry dates, FEFO status)                                      |
|  - /fridges/{fridgeId}/telemetry   (LM73 temp, SGP40 VOC, LDR light time-series)                                 |
|  - /fridges/{fridgeId}/door_events (Actuator status, INA219 stall cutoffs, IR sensor events)                     |
|  - /fridges/{fridgeId}/members     (Google SSO user roles: owner, editor, viewer)                               |
|  - /storage/food_crops/{fridgeId}  (Cropped food images uploaded by Gateway 'C')                                 |
+------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Software & Tech Stack Architecture

| Component / Layer | Specific Technology / Package | Version / Details | Role in SmarterFridge |
|---|---|---|---|
| **JavaScript Runtime & Package Manager** | **Bun (`bun`)** | `v1.4+` | High-performance runtime and package manager for local development, building frontend assets, and executing backend scripts. |
| **Programming Language** | **TypeScript** | `5.x+` (`strict: true` in [`tsconfig.json`](tsconfig.json)) | Strict static typing across Cloud Functions, web application components, and Firestore schemas (no `any`). |
| **Frontend Framework & Build Tool** | **Vite + React (`@vitejs/plugin-react`)** | Vite 5+, React 18+ | Fast HMR dev server and optimized static production bundle builder compiling the SPA to `dist/` for Firebase Hosting. |
| **Client-Side Routing** | **React Router (`react-router-dom`)** | `v6+` / `v7+` | Declarative client-side routing supporting multi-page views, route parameters (`/fridges/:fridgeId`), nested layouts, and auth guards. |
| **Client Firebase SDK** | **Firebase Web SDK (Modular)** (`firebase/app`, `firebase/auth`, `firebase/firestore`) | `v10+` | Direct, secure browser integration for Google SSO login and reactive real-time database listeners (`onSnapshot`). |
| **Internationalization (i18n)** | **Custom React i18n Context & `Intl` API** | Built-in TypeScript module | Dynamic language switching between Thai (`th`) and English (`en`), persisting preference to `localStorage`, with localized date and category formatting. |
| **Cloud Backend & Compute** | **Firebase Cloud Functions (v2)** (`firebase-functions`, `firebase-admin`) | Node.js 20+ runtime | Serverless endpoints handling Gateway `'C'` telemetry ingestion, Gemini AI vision pipelines, and scheduled daily alert cron jobs. |
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
        └── /fridges/:fridgeId/settings ......... Fridge Management & Hardware Provisioning
                                                  - Members & Permissions: Invite Google accounts (Owner, Editor, Viewer)
                                                  - Gateway 'C' Provisioning: Generate / rotate permanent Bearer token
                                                  - AI Inference Key: Set/update fridge Google Gen AI (Gemini) API key
                                                  - LINE Notifications: Configure target LINE User/Group IDs
```

### 3.2 Page Component Breakdown

1. **Login Page (`/login`):**
   * Presents branding, system overview, and a single **"Sign in with Google"** button triggering `signInWithPopup(auth, googleAuthProvider)`.
   * Automatically redirects authenticated users to `/fridges` (or their previous redirect target).
2. **Fridge Hub Page (`/fridges`):**
   * Queries Firestore for all fridges where `members[userId]` exists.
   * Displays responsive cards for each accessible fridge showing current online status, item count, and temperature.
   * Includes a **"Create New Fridge"** action that initializes a new fridge document with the current user as `owner`.
3. **Fridge Dashboard Page (`/fridges/:fridgeId`):**
   * **Active Inventory Panel:**
     * Lists all non-consumed items from `/fridges/{fridgeId}/inventory` ordered by `estimated_expiry_date` ascending (**First Expired, First Out — FEFO**).
     * Color-coded status badges: **Fresh** (green), **Expiring Soon** (yellow, within 2 days), **Expired** (red).
     * Filterable by category (`Dairy`, `Produce`, `Meat`, `Beverage`, `Leftovers`) and searchable by item name.
     * Quick actions: Manual Check-In, Manual Check-Out, and Expiry Date Edit.
   * **Real-Time Telemetry Bar:**
     * Live metrics fed by Firestore `onSnapshot` listeners on the latest document in `/fridges/{fridgeId}/telemetry`.
     * Displays temperature (°C) with safety threshold alert (`> 8.0 °C`), VOC Index (0–500) with spoilage warning (`> 250`), and door light level (LDR).
   * **Door Actuator & Safety Card:**
     * Shows current door physical state (`CLOSED`, `OPEN`, `CLOSING`, `ABORTED`) derived from `/fridges/{fridgeId}/door_events`.
     * Highlights obstruction stall events (`INA219 ≥ 1200 mA`) and limit switch home confirmations.
4. **Analytics Page (`/fridges/:fridgeId/analytics`):**
   * Time-series graphs plotting historical temperature readings against safety thresholds.
   * VOC Index trend graphs correlating VOC spikes with spoiled food items.
   * Door opening frequency and duration metrics to analyze cold-air loss.
5. **Fridge Settings Page (`/fridges/:fridgeId/settings`):**
   * **Access Control:** Add or revoke permissions for other Google accounts by email with role enforcement (`owner`, `editor`, `viewer`).
   * **Gateway `'C'` Authentication:** Generate, view, and regenerate the unique permanent Bearer API token that Node `'C'` (Pi-top [4]) uses in the `Authorization` header when calling Cloud Functions ([`CBS.md`](../interface/CBS.md)).
   * **Google AI Key Management:** Input field to securely store the fridge's dedicated Google Gen AI API key in Firestore (encrypted/restricted via Security Rules) for Gemini 3.5 Flash Lite inference ([`SBG.md`](../interface/SBG.md)).
   * **LINE Messaging API Setup:** Enter target LINE User ID or Group ID to receive automated push alerts dispatched by Cloud Functions ([`SUL.md`](../interface/SUL.md)).

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

### 3.4 Directory Structure

```text
server/
├── index.ts                   # Backend entrypoint (Cloud Functions / local dev server)
├── package.json               # Dependencies, scripts, and build tasks
├── tsconfig.json              # Strict TypeScript compiler options
├── vite.config.ts             # Vite build configuration (React plugin, path aliases, proxy)
├── firebase.json              # Firebase Hosting configuration & SPA rewrites
│
└── src/                       # Web application source tree
    ├── main.tsx               # Application bootstrap (mounts React DOM & Router)
    ├── App.tsx                # Root route definitions (<Routes>, <Route>, <ProtectedRoute>)
    │
    ├── routes/                # Page route components
    │   ├── LoginPage.tsx
    │   ├── FridgeListPage.tsx
    │   ├── FridgeDashboardPage.tsx
    │   ├── FridgeAnalyticsPage.tsx
    │   ├── FridgeSettingsPage.tsx
    │   └── NotFoundPage.tsx
    │
    ├── layouts/               # Shared page scaffolding
    │   ├── RootLayout.tsx     # Global layout (toaster, modal root)
    │   ├── AuthLayout.tsx     # Centered card layout for login
    │   └── DashboardLayout.tsx# Navigation sidebar, fridge selector, user profile menu
    │
    ├── components/            # Reusable UI widgets
    │   ├── common/            # Button, Card, Badge, Modal, Input, Spinner, LanguageToggle
    │   ├── inventory/         # InventoryTable, ItemRow, ExpiryBadge, CategoryFilter
    │   ├── telemetry/         # TelemetryGauge, MetricCard, RealtimeChart
    │   ├── door/              # DoorStatusWidget, ActuationEventFeed
    │   └── settings/          # MemberListModal, ApiKeyForm, GatewayTokenWidget
    │
    ├── context/               # React Context providers
    │   ├── AuthContext.tsx    # Google SSO user session state & login/logout methods
    │   ├── FridgeContext.tsx  # Active fridge metadata, user permissions, and switchers
    │   └── LanguageContext.tsx# Active language ('th' | 'en') & translation methods
    │
    ├── hooks/                 # Custom React hooks
    │   ├── useAuth.ts         # Access AuthContext
    │   ├── useFridge.ts       # Access active FridgeContext
    │   ├── useTranslation.ts  # Access active locale, dictionary lookups, and category translators
    │   ├── useInventory.ts    # onSnapshot subscription to /fridges/{id}/inventory (FEFO sorted)
    │   ├── useTelemetry.ts    # onSnapshot subscription to /fridges/{id}/telemetry
    │   └── useDoorEvents.ts   # onSnapshot subscription to /fridges/{id}/door_events
    │
    ├── locales/               # Static UI translation dictionaries
    │   ├── th.ts              # Thai strings, button labels, error alerts, and category translations
    │   └── en.ts              # English strings, button labels, error alerts, and category translations
    │
    ├── utils/                 # Helpers
    │   └── dateFormatters.ts  # Bilingual date formatting (Buddhist Era th-TH vs Gregorian en-US)
    │
    ├── services/              # External client services
    │   ├── firebase.ts        # Client Firebase app initialization (Auth, Firestore, Storage)
    │   └── api.ts             # Cloud Functions HTTPS client helpers (token provisioning, manual triggers)
    │
    └── types/                 # Static TypeScript contracts
        ├── auth.ts            # User profile, role definitions (owner, editor, viewer)
        ├── fridge.ts          # Fridge document schema, gateway credentials, API keys
        ├── inventory.ts       # Food item schema (bilingual names, category, expiry, status)
        ├── telemetry.ts       # Sensor readings (temp_celsius, voc_index, light_ldr, timestamp_s)
        └── door.ts            # Door event schema (timestamp_s, status)
```

### 3.5 SPA Deployment & Firebase Hosting Configuration

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
  ├── (document fields: name, createdAt, ownerId, members, gatewayTokenHash, geminiApiKey, lineTargetId)
  │
  ├── /inventory/{itemId}
  │     Fields:
  │       - name_th: string                     # Thai food name (e.g. "นมสดพาสเจอร์ไรส์")
  │       - name_en: string                     # English food name (e.g. "Pasteurized Whole Milk")
  │       - storage_recommendation_th: string   # Thai storage advice (e.g. "เก็บในช่องแช่เย็นหลัก")
  │       - storage_recommendation_en: string   # English storage advice (e.g. "Store in main refrigerator shelf")
  │       - category: FoodCategory              # Canonical category key (e.g. "Dairy")
  │       - estimated_expiry_date: string       # ISO 8601 date string ("YYYY-MM-DD")
  │       - check_in_timestamp_s: uint64        # Epoch timestamp of check-in
  │       - consumed: boolean                   # Check-out flag (true if removed)
  │       - consumed_timestamp_s: uint64 | null # Epoch timestamp of removal
  │       - image_storage_path: string          # Firebase Storage path to cropped image
  │       - confidence: number                  # Gemini recognition confidence (0.0 to 1.0)
  │
  ├── /telemetry/{telemetryId}
  │     Fields: timestamp_s, temp_celsius, voc_index, light_ldr
  │
  └── /door_events/{eventId}
        Fields: timestamp_s, status ('SUCCESS' | 'OBSTRUCTION_ERROR' | 'TIMEOUT_ERROR' | 'CONTRADICTION_ERROR')
```

### 4.2 Bilingual Data Representation & Translation Policy

1. **Food Names & Descriptions:** Food items are populated by Gemini 3.5 Flash Lite ([`SBG.md`](../interface/SBG.md)) with explicit bilingual fields (`name_th`, `name_en`, `storage_recommendation_th`, `storage_recommendation_en`). This guarantees that both the edge LCD display (Node `'C'`) and the cloud web application (Server `'S'`) have immediate access to localized text without on-the-fly machine translation calls.
2. **Canonical Categories Translation:** The database stores canonical category keys in English (`FoodCategory` enum: `'Dairy'`, `'Produce'`, `'Meat'`, `'Seafood'`, `'Beverage'`, `'Condiments'`, `'Leftovers'`, `'Bakery'`, `'Snacks'`, `'Other'`). Client applications use standard translation tables to render either Thai or English labels.
3. **Dates & Timestamps:** Timestamps are stored uniformly as UTC-based second epochs (`uint64 timestamp_s`) and standard ISO 8601 dates (`YYYY-MM-DD`). Web clients translate and render dates according to the user's active locale (e.g. Thai Buddhist Era `พ.ศ.` vs Western Gregorian `CE`).

### 4.3 Security Rules Model
* **User Authentication:** Enforced via Firebase Auth (`request.auth != null`).
* **Multi-Tenant Isolation:** Read and write access to `/fridges/{fridgeId}` and all subcollections require `request.auth.uid in resource.data.members` or `request.auth.token.email in resource.data.memberEmails`.
* **Hardware Ingestion Security:** Gateway `'C'` connects to Firebase Cloud Functions over HTTPS using its provisioned Bearer token. Cloud Functions validate the token against `gatewayTokenHash` using the Admin SDK, bypassing client rules.
* **Sensitive Field Protection:** The fridge's `geminiApiKey` and `gatewayTokenHash` are restricted so only users with the `owner` role can read or update them.
