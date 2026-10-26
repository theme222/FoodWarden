# Server 'S': Cloud Backend & Web Dashboard (`server/`)

**Server `'S'`** is the cloud backend, AI orchestrator, notification dispatcher, and user-facing web dashboard for the **SmarterFridge** system. It provides the second primary user-facing interface in the ecosystem, serving a responsive **Vite + React** Single Page Application (SPA) with **React Router** optimized for mobile phones and desktop browsers, complete with **dynamic language switching between Thai and English**, Google SSO authentication, live fridge metric monitoring, and FEFO inventory inspection.

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

## 2. Development, Formatting, Typecheck & Test Commands (`bun`)

### Setup & Dependencies
```bash
# 1. Copy environment template and populate Firebase, Gemini, and LINE keys
cp .env.example .env

# 2. Install dependencies
bun install
```

### Run / Development
```bash
# Run backend server in watch mode for local development
bun run dev

# Run server entrypoint directly
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
