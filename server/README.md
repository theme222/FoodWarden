# Server 'S': Cloud Backend & Web Dashboard (`server/`)

**Server `'S'`** is the cloud backend, AI orchestrator, notification dispatcher, and user-facing web dashboard for the **FoodWarden** system. It provides the second primary user-facing interface in the ecosystem, serving a responsive **Vite + React** Single Page Application (SPA) with **React Router** optimized for mobile phones and desktop browsers, complete with **dynamic language switching between Thai and English**, Google SSO authentication, live fridge metric monitoring, and FEFO inventory inspection.

Built as a **Bun** and **TypeScript** project on **Firebase**, it persists sensor telemetry, door safety events, and bilingual food inventory in **Cloud Firestore**, orchestrates **Gemini 3.5 Flash Lite** (`'G'`) with live inventory context for grocery check-in/check-out classification, and dispatches real-time user alerts via the **LINE Messaging API** (`'L'`).

---

## 1. Documentation & File Index

### Local Subproject Files
* **[`ARCHITECTURE.md`](ARCHITECTURE.md):** Cloud topology, Firebase services, Vite + React + React Router web dashboard, Bun + TypeScript backend, Gemini 3.5 Flash Lite, LINE Messaging API, and Google SSO architecture.
* **[`GOAL.md`](GOAL.md):** Incremental checklist of required cloud endpoints, AI pipelines, edge-case handlers, and tests.
* **[`package.json`](package.json) & [`tsconfig.json`](tsconfig.json):** Bun scripts, dependencies, and strict TypeScript compiler rules.
* **[`.env.example`](.env.example):** Symlink to the root environment variable template ([`../.env.example`](../.env.example)).
* **[`index.ts`](index.ts):** Server entrypoint.

### System & Interface References
* **Root Documentation:** [`SUMMARY.md`](../SUMMARY.md) | [`AGENTS.md`](../AGENTS.md) | [`RUBRIC.md`](../RUBRIC.md)
* **Communication Contracts ([`interface/`](../interface/README.md)):**
  * [`CBS.md`](../interface/CBS.md) — Camera (`'C'`) ↔ Server (`'S'`) HTTPS Telemetry, Check-In/Out & Door Logs
  * [`SBG.md`](../interface/SBG.md) — Server (`'S'`) ↔ Gemini (`'G'`) Context-Enriched Multimodal Prompts & JSON Schemas
  * [`SUL.md`](../interface/SUL.md) — Server (`'S'`) → LINE (`'L'`) Outbound User Alert Webhooks *(Left to the Server engineering team to define message templates, bilingual Thai/English payloads, alert triggers, and account pairing)*.

---

### Production regions

The production Firestore database `(default)` uses `asia-southeast3` (Bangkok), matching [firebase.json](firebase.json). Cloud Functions and the Hosting API rewrite use `asia-southeast1` (Singapore). These are separate settings; the existing API URLs and local emulator commands still use the Functions region. Firebase web configuration in `.env.local` does not need a region change.

## 2. Run the Firebase backend locally

Install Node.js 22, JDK 21, and the Firebase CLI. Run these PowerShell commands from `server/`. The Firebase configuration is already in this directory.

```powershell
npm.cmd install -g firebase-tools
npm.cmd --prefix .\functions install
npm.cmd --prefix .\functions run build
firebase.cmd emulators:start --only functions,firestore --project demo-foodwarden
```

Keep the emulator running. In a second PowerShell window, also in `server/`, run:

```powershell
Invoke-RestMethod 'http://127.0.0.1:5001/demo-foodwarden/asia-southeast1/api/health'
node --test .\functions\test\telemetry.test.cjs
```

The health endpoint reads the Firestore emulator and returns `ok = True`. The integration test seeds a temporary fridge and gateway token, sends CBS telemetry, and checks authentication, payload validation, retry deduplication, and older readings arriving after newer ones. The Emulator UI is at `http://127.0.0.1:4000`. Rebuild Functions after changing TypeScript.

### Gateway telemetry

Send `POST /api/telemetry` with an `Authorization: Bearer <GATEWAY_TOKEN>` header and the `samples` JSON body defined in [CBS.md](../interface/CBS.md). Provision the SHA-256 token hash as `gatewayTokenHash` in `/fridges/{fridgeId}/private/config` and create the parent fridge document. A batch may contain up to 10,000 samples across 499 UTC minute buckets. Node IDs must be nonblank, have no surrounding whitespace and contain at most 128 characters. Split larger offline queues into separate requests. Retrying an accepted batch returns `ingested_count: 0`, and older samples do not replace the latest cached reading.

The earlier [gateway review](review/GATEWAY.md) records a camera payload mismatch; verify CBS compatibility before connecting the Pi. Firestore rules allow verified fridge members to read inventory, telemetry, door events and the latest heartbeat. Direct client writes, parent fridge documents and private configuration remain denied; Functions mediate dashboard writes and fridge summaries.

## 3. Other development commands (`bun`)

### Setup & Dependencies
```bash
# 1. Copy environment template and populate Firebase, Gemini, and LINE keys
cp .env.example .env

# 2. Install dependencies
bun install
```

### Run / Development
```bash
# Run the Bun scaffold in watch mode
bun run dev

# Run the Bun scaffold directly
bun run start

# Run Vite dev server for web dashboard with hot module replacement (HMR)
bunx vite
```

### Build Frontend
```bash
# Compile Vite + React SPA to dist/ for Firebase Hosting
bunx vite build
```

### Run the dashboard locally

Use Node.js 22 and JDK 21. From `server/`, install and start the emulator suite:

```powershell
npm.cmd --prefix functions ci
npm.cmd --prefix functions run build
$env:FIREBASE_STORAGE_BUCKET = 'demo-foodwarden.appspot.com'
firebase.cmd emulators:start --only auth,functions,firestore,storage --project demo-foodwarden
```

In another PowerShell window in `server/`:

```powershell
bun install --frozen-lockfile
$env:VITE_USE_EMULATORS = 'true'
bun run dev:dashboard
```

Open the Vite URL and use the emulator's Google sign-in popup. To grant access, use the emulator UI to create a Firestore document at `/fridges/kitchen` with `name` set to `Kitchen fridge` and a `members` map whose key is the account's exact verified email and whose value is `owner`. The same document shape applies to provisioned fridges. In a real Firebase project enable Google Auth and use the `VITE_FIREBASE_*` settings from [.env.example](../.env.example).

Run `bun run typecheck`, `bun test src/model.test.ts`, and `bun run build` from `server/`. With the four emulators running, `npm.cmd --prefix functions run test:emulator` exercises the telemetry and dashboard endpoints. See the [work log](review/DASHBOARD.md) for scope and decisions and [verification](review/VERIFICATION.md) for results.

### Render the fridge block diagram

The [original draw.io drawing](diagram/Fridge.drawio) is available as [HTML](diagram/Fridge.html), [SVG](diagram/Fridge.svg) and [PNG](diagram/Fridge.png). The HTML export uses the diagrams.net viewer over HTTPS. The SVG and PNG can be opened offline.

Start with the [system overview](diagrams/fridge.mmd) and read from the fridge sensor through the gateway to Firebase. The local MQTTS branch connects the gateway and door closer. The overview treats the home router as network infrastructure for both LAN MQTT and internet-bound HTTPS.

Use the [network](diagrams/network.mmd) and [cloud](diagrams/cloud.mmd) diagrams for the external links. Use the separate [gateway](diagrams/gateway.mmd), [fridge sensor](diagrams/fridge-sensor.mmd), and [door closer](diagrams/door-closer.mmd) diagrams for hardware. The [diagram audit](review/DIAGRAM-AUDIT.md) records coverage and differences between Page-1 of `Fridge.drawio` and the code branches.

From the repository root:

```bash
cd server/diagrams
bun install --frozen-lockfile
bun run render fridge.mmd out/fridge.svg
```

Open `out/fridge.svg` in a browser. To render another diagram, pass its `.mmd` source and the desired `.svg` output path.

### Typecheck (`tsc`)
```bash
# Run strict TypeScript compiler check without emitting files
bun run typecheck
```

### Format (`prettier`)
```bash
# Format all TypeScript, JSON, and Markdown files
bun run format

# Check formatting without modifying files
bun run format:check
```

### Test (`bun test`)
```bash
# Dashboard unit tests (no emulators needed)
bun run test

# Functions build and validation unit tests (no emulators needed)
npm --prefix functions test

# With Auth, Functions, Firestore and Storage emulators running
npm --prefix functions run test:emulator
```

## Server review and door events

See the [server review](review/SERVER-REVIEW.md) for implementation coverage, validation and remaining priorities.

`POST /api/door_events` accepts the `events` array in [CBS section 3.6](../interface/CBS.md#36-door-event-ingestion-post-apidoor_events), using the gateway token. A batch contains 1–499 events with the node ID limits above and integer Unix seconds from zero through year 9999. All seven CBS statuses are supported. Invalid batches write nothing. Events are stored under the authenticated fridge's `door_events` collection.

Retries deduplicate by node ID, timestamp and status, including concurrent requests. Different statuses or nodes in the same second remain distinct. Identical transitions in one second require a future shared event identifier to distinguish. This endpoint stores events; LINE dispatch remains planned.
