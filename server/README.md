# Server 'S': Cloud Backend & Web Dashboard (`server/`)

**Server `'S'`** is the cloud backend, AI orchestrator, LINE notification dispatcher, and mobile-responsive **Vite + React** web dashboard for **FoodWarden**. It runs 100% on **Cloudflare Workers** (`Hono` + TypeScript), **Cloudflare D1** (SQLite), **Cloudflare R2** (private cropped photo storage), **SQLite-backed Durable Objects** (hibernating WebSockets), and **Better Auth** (Google OAuth + local dev bypass).

---

## 1. Documentation & File Index

- **[`FAMILY-WORKFLOW.md`](FAMILY-WORKFLOW.md):** Thai family setup guide, private favorites, personal/group LINE pairing and rollout requirements.
- **[`API-REFERENCE.md`](API-REFERENCE.md):** authenticated Scalar UI, OpenAPI coverage, test requests, and CDN/runtime costs.
- **[`DEV-TOOLS.md`](DEV-TOOLS.md):** shadcn/ui components, SWR status, local agent-browser commands, deepsec setup boundaries, and Vercel OSS fit.
- **[`ARCHITECTURE.md`](ARCHITECTURE.md):** Cloudflare topology, D1 schema, R2 private photo flow, `FridgeRoom` Durable Object WebSockets, React routes, Gemini/LINE pipelines, and security model.
- **[`GOAL.md`](GOAL.md):** Feature, integration, edge-case, and test verification checklist.
- **[`wrangler.jsonc`](wrangler.jsonc) & [`migrations/0001_init.sql`](migrations/0001_init.sql):** Cloudflare Worker bindings (`DB`, `PHOTOS`, `FRIDGE_ROOM`, `ASSETS`), Cron Trigger (`0 1 * * *`), and D1 SQLite schema.
- **[`.dev.vars.example`](.dev.vars.example):** Local Wrangler secrets template for Worker development.
- **Interfaces ([`interface/`](../interface/README.md)):**
  - [`CBS.md`](../interface/CBS.md) — Camera (`'C'`) ↔ Server (`'S'`) HTTPS Telemetry, Check-In/Out & Door Logs
  - [`SBG.md`](../interface/SBG.md) — Server (`'S'`) ↔ Gemini (`'G'`) Context-Enriched Multimodal Prompts & JSON Schemas
  - [`SUMMARY.md`](../SUMMARY.md) | [`AGENTS.md`](../AGENTS.md) | [`RUBRIC.md`](../RUBRIC.md)

---

## 2. Local Development Setup (`bun` + `wrangler`)

### Prerequisites

- **Bun `1.2+`**
- Node.js 22+ (required by Vitest + Miniflare / Wrangler tooling)

### Install & Configure Secrets

```bash
cd server
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

Populate `.dev.vars` (gitignored) with:

Set `APP_ENV="development"` locally. The committed Wrangler configuration defaults to `production` and does not enable local login or localhost trusted origins on deployment.

- `BETTER_AUTH_SECRET`: random 32+ character string
- `BETTER_AUTH_URL`: `http://127.0.0.1:8787`
- `DEV_AUTH_BYPASS_EMAIL`: local test email (active when `APP_ENV="development"`)
- Optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_BOT_BASIC_ID`

### Apply Local D1 Migrations & Start Stack

In terminal 1 (Cloudflare Worker + local D1/R2/DO):

```bash
bunx wrangler d1 migrations apply foodwarden-db --local
bun run dev:worker
```

In terminal 2 (Vite SPA dev server with HMR proxying `/api` and WebSockets to `http://127.0.0.1:8787`):

```bash
bun run dev:dashboard
```

Open the Vite URL (default `http://localhost:5173`), click **Dev Sign In** (or **Sign in with Google** when configured), create a fridge, and copy its `GATEWAY_TOKEN` from **Settings** for Node `'C'`.

---

## 3. Verification, Build & Deployment Commands

### Quality tooling

See [DEV-TOOLS.md](DEV-TOOLS.md) for `format:check`, `lint`, `knip`, React Doctor, UI tests, SWR and Base UI. See [SECURITY-TOOLS.md](../SECURITY-TOOLS.md) for repository-wide secret protection.

### Typecheck (`tsc`)

```bash
bun run typecheck
```

### Tests (Frontend Unit + Miniflare Worker Integration)

```bash
# Frontend logic unit tests (FEFO sorting, bilingual formatters)
bun run test

# Miniflare Cloudflare Worker tests (D1 migrations, R2, DO WebSocket hibernation, Better Auth, Gemini, LINE, Cron)
bun run test:worker

# Full suite
bun run test:all
```

### Format & Build

```bash
bun run format:check
bun run build
```

### Deploy to Cloudflare Workers

```bash
# Configure production secrets once:
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bunx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# Optional fallback key (fridge owners can also set per-fridge keys in Settings):
bunx wrangler secret put GEMINI_API_KEY

# Build SPA, apply remote D1 migrations, and deploy Worker + Static Assets + Cron:
bun run build
bunx wrangler d1 migrations apply foodwarden-db --remote
bunx wrangler deploy
```

---

## 4. Diagrams

Start with the [diagram guide](diagrams/README.md) and [detailed system view](diagrams/system-detailed.svg). The guide links all 15 hardware, workflow, server, data and safety views and distinguishes implemented server behavior from embedded designs. Legacy hardware references remain in [diagram/](diagram/Fridge.drawio). See [ARCHITECTURE.md](ARCHITECTURE.md) for the Cloudflare Worker topology.
