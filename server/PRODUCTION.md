# Cloudflare production setup

## Provisioned resources

Account: Newisnooby. No unrelated databases or buckets were changed.

- D1: `foodwarden-db`, APAC, ID `5331bc4a-8ed9-4017-a7ae-f493e05434e6`.
- R2: `foodwarden-photos`, Standard, private (no public access configured).
- Migration: [0001_init.sql](migrations/0001_init.sql) applied remotely successfully.
- Planned Worker origin: `https://foodwarden.newisnooby.workers.dev`.
- [wrangler.jsonc](wrangler.jsonc) uses production defaults and this canonical Better Auth URL. Local `.dev.vars` overrides remain development-only.

The production Worker has not been deployed. A deployment dry run succeeded with real resource bindings. Resource provisioning alone does not make the app live or guarantee zero future cost; usage remains subject to each service's limits and billing.

## Required before usable deployment

Create a Google OAuth Web Application client with these authorized settings:

- JavaScript origin: `https://foodwarden.newisnooby.workers.dev`
- Redirect URI: `https://foodwarden.newisnooby.workers.dev/api/auth/callback/google`

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Worker secrets. Generate a fresh production-only `BETTER_AUTH_SECRET`; do not reuse the known local fallback secret or commit its value. Gemini fallback (`GEMINI_API_KEY`) and LINE (`LINE_CHANNEL_ACCESS_TOKEN`) credentials are needed to enable those external integrations; without them the relevant AI routes return service unavailable and notifications are not sent. A fridge owner can configure a per-fridge Gemini key through Settings after sign-in.

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
bunx wrangler deploy --dry-run
bunx wrangler deploy
```

Verify the live health route, anonymous private-route rejection, real Google sign-in/sign-out, owner/member permissions, private photos and WebSocket updates. Confirm `/api/auth/dev-login` returns 404 in production and Scalar loads its assets from the same origin with CSP. Exercise Gemini/LINE only with configured credentials and deliberate test data.

## Local browser testing on this Windows host

The standard persisted Wrangler dev server encountered native SQLite file creation failures. Browser smoke tests used `unstable_dev` under Node with persistence disabled and an ignored temporary initialization wrapper. That wrapper is not committed or deployed. Existing `.wrangler/state` data was not removed. Normal local setup remains documented in [README.md](README.md); reproduce persisted-storage behavior on the target development machine before relying on it.
