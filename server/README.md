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
npm.cmd --prefix .\functions run test:emulator
```

The health endpoint reads the Firestore emulator and returns `ok = True`. The integration test seeds a temporary fridge and gateway token, sends CBS telemetry, and checks authentication, payload validation, retry deduplication, and older readings arriving after newer ones. The Emulator UI is at `http://127.0.0.1:4000`. Rebuild Functions after changing TypeScript.

### Gateway telemetry

Send `POST /api/telemetry` with an `Authorization: Bearer <GATEWAY_TOKEN>` header and the `samples` JSON body defined in [CBS.md](../interface/CBS.md). Provision the SHA-256 token hash as `gatewayTokenHash` in `/fridges/{fridgeId}/private/config` and create the parent fridge document. A batch may span up to 499 UTC minute buckets. Retrying an accepted batch returns `ingested_count: 0`, and older samples do not replace the latest cached reading.

The Gateway on `feature/C-camera` currently sends a `telemetry` array with different field names. Update that client to send the CBS payload before connecting the Pi. The included Firestore rules deny direct client access until the dashboard's authentication and fridge membership rules are implemented.

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
# Execute unit and integration tests with Bun's native test runner
bun test
```
