# UI and development tools

FoodWarden is a Vite React SPA and Cloudflare Worker. Vercel open-source packages do not require Vercel hosting.

## Components and theme

shadcn wrappers live in [src/components/ui](src/components/ui/) and use `@base-ui/react` for Button, Dialog, AlertDialog, Select and Tabs. [components.json](components.json) selects `base-nova` so future additions use the same primitive library. Table and Alert are semantic HTML wrappers; Sonner remains its own toast library. Class merging is local in [utils.ts](src/lib/utils.ts).

The application is deliberately **light-only**. [ui-theme.css](src/ui-theme.css) defines the tokens, [style.css](src/style.css) sets the color scheme and makes dark variants opt-in to an explicit `.dark` ancestor, and the mounted toaster uses the light theme. Scalar is a separate page with its own theme toggle.

Food and settings actions use a shared AlertDialog confirmation provider, success/error toasts and persistent error alerts. Cancel/Escape resolve confirmation as false; destructive requests begin only after explicit confirmation. The settings role selector uses Base UI Select. Settings loads as a separate JavaScript chunk.

Use the official CLI for additional components, reviewing generated code and dependencies:

```bash
bunx shadcn@latest add input label
```

Generated `cn` imports should use `@/lib/utils`; keep helpers in separate modules when they would break Fast Refresh. Tests cover confirmation, dialog focus return, tabs keyboard selection, controlled select, and semantic alerts/tables. Reusable registry subcomponent exports are intentionally retained; Knip ignores only their export/type warnings, not application files or runtime dependencies.

## SWR and realtime

[src/data.ts](src/data.ts) uses SWR for fridge lists, inventory, telemetry, status and door snapshots. Settings has its own SWR resource. Each signed-in user mounts a fresh in-memory [SessionCache](src/components/session-cache.tsx); logout or account changes discard the provider and its private data. Credentials and settings are never persisted to localStorage.

WebSocket telemetry/status/door events update their matching cache. Inventory events revalidate inventory, and reconnect refreshes all room snapshots. Before the first snapshot exists, stream events trigger revalidation so they cannot overwrite the initial historical snapshot. Terminal 401/403/404 responses do not retry automatically and are not displayed as stale private data. The existing FEFO and runtime payload parsers remain in use.

Tests verify account switching/logout isolation, WebSocket cache updates, inventory revalidation and access-revocation behavior. [api.ts](src/lib/api.ts) centralizes HTTP errors and retry policy.

## Quality commands

Run from `server/`:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run knip
bun run build
bun run test:all
bun run doctor
bun run doctor:security
```

Prettier and its Tailwind plugin are pinned in the lockfile. The plugin reads the Tailwind v4 stylesheet and sorts `cn`/`cva` classes. Generated diagrams, runtime declarations and `.reports/` output are excluded from formatting; authored Markdown, TypeScript and configuration remain checked.

Knip scans the Vite, Worker, tests and root tooling entry points, including CSS imports. Lefthook is a documented dependency exception because its generated Git launcher lives outside the source graph. Deepsec and React Doctor remain installed as dev dependencies; neither is automatically run by the secret hook. Oxlint provides general linting; React Doctor provides additional diagnostics, with documented heuristic limitations.

Use `bun run doctor -- --json --json-out .reports/react-doctor.json` for disposable machine-readable output. Keep reviewed narrative findings in `review/`; do not commit generated JSON reports.

## Browser automation

```bash
bun run browser:install
bun run browser:doctor
bun run browser --session foodwarden-dev open http://localhost:5173
bun run browser --session foodwarden-dev snapshot -i
bun run browser --session foodwarden-dev close
```

Agent-browser is a local dev dependency. Before an agent uses it, read `bun run browser skills get core`. Chrome is installed per workstation, outside Git. Quote refs such as `'@e1'` in PowerShell. The tool is not part of the deployed application.

## Security tooling

See [repository secret protection](../SECURITY-TOOLS.md) for Gitleaks and Lefthook installation. Run `bun run security:help` for Deepsec CLI help. Deepsec is separate from the default quality commands: `scan` finds pattern candidates; `process` performs AI investigation. Neither a pattern hit nor an unvalidated AI finding is proof of an exploitable vulnerability.

Deepsec supports `--model-auth local` with an existing Codex/Claude subscription login, as well as direct API keys or Vercel AI Gateway. API-key billing is not mandatory. A local-subscription run still consumes the provider's subscription allowance. Set scope and concurrency deliberately; do not scan private environment files or generated reports.

On this Windows host, Deepsec 2.3.12's initializer failed to detect the available pnpm/npm command shims. The documented manual scaffold flow was used instead, with a separate ignored `.deepsec/` workspace. Its local dependency override selects `@openai/codex` 0.169.0, matching the working machine CLI; the bundled 0.156.1 CLI rejected the selected model. The server application's dependencies and lockfile are unaffected by this workspace override.

From the prepared `server/.deepsec/` workspace, resume the user-approved model with:

```bash
node node_modules/deepsec/dist/cli.mjs scan --project-id server
node node_modules/deepsec/dist/cli.mjs process --project-id server --agent codex --model gpt-6.1-sol --concurrency 1 --batch-size 5 --max-turns 60
node node_modules/deepsec/dist/cli.mjs report --project-id server
```

The local workspace contains its auth route (`local`), concise server context in `data/server/INFO.md`, and explicit exclusions for private configuration, generated output and scan state. Reviewed results belong in `review/`; raw state remains ignored. The manual flow does not run the initializer's automatic ingress inventory or matcher-generation phases, so it must not be described as exhaustive coverage.

## Other packages

AI SDK, json-render, Turborepo, skills and fx are optional for concrete new requirements. Workflow SDK needs deployment-adapter evaluation. Next.js, SvelteKit, Nuxt and Nitro are alternative architectures rather than additions required by this SPA. None has been added.

## Official references

- [shadcn Base UI](https://ui.shadcn.com/docs/changelog/2026-01-base-ui)
- [SWR mutation and revalidation](https://swr.vercel.app/docs/mutation)
- [React Doctor](https://www.react.doctor/docs/reference/cli-reference)
- [Knip issue handling](https://knip.dev/guides/handling-issues)
- [Prettier Tailwind plugin](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)
- [agent-browser](https://agent-browser.dev/installation)
- [deepsec](https://github.com/vercel-labs/deepsec)

The native Windows child sandbox also blocked source reads. A subsequent static-review run supplied a complete first-party source snapshot to Deepsec as context, without disabling the sandbox. Refresh it from `server/` with `bun .deepsec/prepare-snapshot.cjs` before processing; its manifest in `.reports/deepsec-snapshot-manifest.json` records the Git head and source hashes. This helper and workspace are local audit artifacts, not production dependencies. Snapshot review does not exercise live routes or dependencies outside the supplied files.

## React Doctor source scope

[doctor.config.json](doctor.config.json) excludes ignored local diagnostic workspaces (`.reports/`, `.deepsec/`), generated `dist/` output and the original user-supplied HTML design reference. These are not application source entries; `.reports/deploy-preview` is a Wrangler Worker dry-run bundle, not a browser asset. No React Doctor rules are disabled for `src/` or `workers/`. The unchanged photo preprocessing helper revokes its object URL in `finally`; treat a missing-revoke diagnostic there as a false positive rather than removing the cleanup. Sequential database leases and ordered webhook processing also require individual review before parallelizing loops.

## Current Deepsec audit

The [current Thai review](review/DEEPSEC-CURRENT-REVIEW.md) records the fresh `server-current-0d15b5c` audit: 59 completed direct AI file reviews, source hashes for 65 context files, and local validation evidence. Raw output remains in `.deepsec/data/server-current-0d15b5c/`; the earlier `server` project remains historical. `process` exits 1 when direct review produces findings even if all batches complete. Review coverage/errors/skips before treating an exit status as a tool failure. This audit did not remediate application findings or deploy code.
