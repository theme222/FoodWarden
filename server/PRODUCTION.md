# Cloudflare production setup

## Provisioned resources

Account: Newisnooby. No unrelated databases or buckets were changed.

- D1: `foodwarden-db`, APAC, ID `5331bc4a-8ed9-4017-a7ae-f493e05434e6`.
- R2: `foodwarden-photos`, Standard, private (no public access configured).
- Migrations: [0001_init.sql](migrations/0001_init.sql) through [0008_alert_jobs.sql](migrations/0008_alert_jobs.sql) (including [0005_inventory_activity.sql](migrations/0005_inventory_activity.sql), [0006_status_history.sql](migrations/0006_status_history.sql), [0007_camera_packs.sql](migrations/0007_camera_packs.sql), and [0008_alert_jobs.sql](migrations/0008_alert_jobs.sql)) are applied remotely on `foodwarden-db`.
- Live Worker origin: `https://foodwarden.newisnooby.workers.dev` (deployed with `/api/health` returning `{"ok":true,"database":"ok"}`).
- [wrangler.jsonc](wrangler.jsonc) uses production defaults and this canonical Better Auth URL. Local `.dev.vars` overrides remain development-only.

Resource provisioning and software deployment remain subject to each Cloudflare service's free-tier limits; end-to-end physical hardware testing (`Node 'F' -> Gateway 'C' -> Server 'S'`) remains field validation.

## Open review findings

The [Deepsec review](review/DEEPSEC-REVIEW.md) records the historical source baseline. The remediation changes membership writes, socket authorization, body limits, inference admission, photo reclamation, partial updates, status concurrency and durable LINE delivery. Production rollout requires the new migration and live verification; a successful dry run alone does not establish application security.

## Required before usable deployment

Create a Google OAuth Web Application client with these authorized settings:

- JavaScript origin: `https://foodwarden.newisnooby.workers.dev`
- Redirect URI: `https://foodwarden.newisnooby.workers.dev/api/auth/callback/google`

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Worker secrets. Generate a fresh production-only `BETTER_AUTH_SECRET`; do not reuse the known local fallback secret or commit its value. Gemini fallback (`GEMINI_API_KEY`) and LINE (`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, and optional `LINE_BOT_BASIC_ID`) credentials are needed to enable those external integrations; without them the relevant AI routes return service unavailable and LINE webhook/notifications stay disabled. Set the LINE Messaging API Webhook URL to `https://foodwarden.newisnooby.workers.dev/api/line/webhook` with "Use webhook" enabled for 1-click pairing codes. A fridge owner can configure a per-fridge Gemini key through Settings after sign-in.

Never configure `DEV_AUTH_BYPASS_EMAIL` for production. Even if it is present, the production environment rejects dev-login and does not trust localhost origins. Missing production auth secrets fail closed.

## Final deployment and verification

From `server/`, after credentials are configured:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run knip
bun run test:all
bun run build
bunx wrangler d1 migrations apply foodwarden-db --remote
bunx wrangler deploy --dry-run
bunx wrangler deploy
```

Verify the live health route, anonymous private-route rejection, real Google sign-in/sign-out, owner/member permissions, private photos and WebSocket updates. Confirm `/api/auth/dev-login` returns 404 in production and Scalar loads its assets from the same origin with CSP. Exercise Gemini/LINE only with configured credentials and deliberate test data.

## Local browser testing on this Windows host

The standard persisted Wrangler dev server encountered native SQLite file creation failures. Browser smoke tests used `unstable_dev` under Node with persistence disabled and an ignored temporary initialization wrapper. That wrapper is not committed or deployed. Existing `.wrangler/state` data was not removed. Normal local setup remains documented in [README.md](README.md); reproduce persisted-storage behavior on the target development machine before relying on it.

## Remediation rollout requirements

[0002_security_and_delivery.sql](migrations/0002_security_and_delivery.sql) and [0004_operation_receipts.sql](migrations/0004_operation_receipts.sql) are applied on remote `foodwarden-db`. They backfill legacy fridge budget ownership and previously ingested LINE event identities, and add AI reservations, LINE outbox/event records, photo-retirement guards, and UUID v4 `Idempotency-Key` operation receipts. New app-created fridges charge the stable authenticated creator ID; changing members or deleting/recreating a fridge does not reset that creator's retained budget. Legacy fridges without any attributable owner fail AI admission until repaired.

AI admission defaults are rolling 24-hour budgets of 200 inference jobs globally and 50 per creator, 20 per fridge per minute, at most four concurrent global jobs and one per creator. Each job can make at most eight upstream attempts, each with a 15-second timeout; concurrency leases expire after five minutes if a Worker dies. Model output is bounded to 4,096 tokens. These are request/token bounds, not an exact currency spending guarantee. Quota failures return HTTP 429 with Retry-After; daily exhaustion can last longer than that minimum delay. All keys, including per-fridge keys, use these limits.

WebSockets recheck the live session, verified identity and fridge membership before acceptance and private delivery. Durable alarms also check idle sockets every 30 seconds; ping passes through authorization. Old sockets lacking session attachments close and must reconnect. This increases D1 authorization reads compared with handshake-only authentication.

LINE retry processing runs every minute in addition to the daily maintenance cron. Pending messages use a stable retry key, current-recipient checks and exponential backoff. Permanent failures and jobs older than 23 hours remain in `line_outbox` with `failed = 1` for operator inspection; they are not silently treated as delivered. Inspect failed jobs and correct configuration rather than replaying ambiguously accepted messages outside LINE's retry-key lifetime. Event identities prevent old gateway retries from creating new notifications after cooldown. Delivery to a LINE user who blocks the bot is not guaranteed even when LINE accepts a push request; see [LINE retry guidance](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/).

Photo deletion now retires an object atomically only after its last inventory reference is gone. Shared images remain available to remaining items. A retired photo path cannot be reused; re-upload with a fresh item/draft identity if the API returns a photo conflict. The daily orphan sweep uses the same guard. Keep the audit's original report as historical evidence; current regression tests live in [security-regressions.test.ts](workers/security-regressions.test.ts) and [fridge-room.test.ts](workers/fridge-room.test.ts).

## Family dashboard and LINE pairing rollout

[0003_line_pairing_and_prefs.sql](migrations/0003_line_pairing_and_prefs.sql) adds per-account LINE profiles, one-use pairing codes, ordered webhook lifecycle records, private favorites and a separate personal notification outbox, and is applied on remote `foodwarden-db`. See [FAMILY-WORKFLOW.md](FAMILY-WORKFLOW.md) for owner/member setup, LINE console configuration, private versus family messages and remaining live hardware verification. The minute cron now also queues personal morning summaries using Asia/Bangkok time. Automated Worker tests mock upstream LINE calls; production LINE pairing and test pushes require verified LINE credentials on the live Worker.
