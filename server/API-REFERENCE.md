# API reference

After signing in to the dashboard, choose **API reference / เอกสาร API** in the header.

- Scalar UI: `/api/reference`
- OpenAPI 3.1 JSON: `/api/openapi.json`

Both routes require a verified, unexpired Better Auth session and return `Cache-Control: private, no-store`. A gateway Bearer token alone does not grant access to documentation. Paths under `/api/` work through the existing Vite proxy and Workers Static Assets routing without new hosting rules.

## Implementation and coverage

[workers/lib/openapi.ts](workers/lib/openapi.ts) mirrors the explicit application handlers in [workers/index.ts](workers/index.ts): authentication configuration, development login, fridge and membership management, settings, inventory and private photos, monitoring, WebSocket handshake, and gateway check-in/check-out and ingestion.

This is a typed, maintained OpenAPI document, not automatic generation from Zod. Existing runtime validators and API behavior remain in place. The route coverage test fails when an explicit application route is added or removed without a matching documentation update; field-level schema changes still require review. Better Auth's delegated wildcard routes and full WebSocket event schemas are outside this document. See [ARCHITECTURE.md](ARCHITECTURE.md) for realtime behavior and the canonical [interface documentation](../interface/README.md) for cross-node contracts.

The installed Scalar integration uses `Scalar({ url: ... })`. The older `apiReference` export is deprecated in the installed release. Migrating all routes to `@hono/zod-openapi` would require describing them with OpenAPI-aware route/schema definitions, not merely replacing `new Hono()`.

## Trying requests

Browser endpoints use the existing same-origin HttpOnly session and still enforce fridge membership and owner permissions. Sign in through the dashboard first; do not paste session cookies. Gateway endpoints use the fridge-specific Bearer token obtained by an owner from Settings. Test requests run real operations, including deletes, token rotation, AI calls and notifications; use development data.

No real keys, tokens, sample inventory or private photos are embedded in the document. Credential persistence, Scalar telemetry and the external request proxy are disabled. Scalar's JavaScript is copied from the pinned `@scalar/api-reference` development dependency by [vite.config.ts](vite.config.ts), served as `/vendor/scalar-1.78.1.js`, and loaded only when opening the API reference. There is no runtime CDN requirement. The route sets a fresh script nonce and a Content-Security-Policy allowing same-origin scripts/connections, blocking framing and base URL overrides. Inline styles remain allowed for Scalar's runtime layout; inline scripts require the nonce. Review the package version and [scalar-assets.ts](scalar-assets.ts) together when updating.

## Size and runtime costs

The browser downloads and runs the self-hosted Scalar UI bundle (about 5 MB uncompressed), so it is not added to the dashboard JavaScript or bundled into the Worker. This does not make the feature zero-cost: the Worker still contains the middleware and document, checks authentication, and serves HTML/JSON. Those requests consume Worker resources and session checks can query D1. Browser JavaScript still has a download and execution cost.

## Verification

[workers/api-reference.test.ts](workers/api-reference.test.ts) checks documentation access for anonymous, unverified and expired sessions; Scalar configuration; explicit route coverage; and separation of browser and gateway authentication schemes. Production auth regression tests also check that local origins and dev-bypass remain disabled even when a development email is configured. The normal typecheck, build and Worker tests also apply. Browser smoke testing confirmed that the self-hosted Scalar page renders under CSP, loads the authenticated OpenAPI document, and executes GET /api/health with a successful JSON response and no reported browser errors.

## Official references

- [Scalar with Hono](https://hono.dev/examples/scalar)
- [Scalar Hono documentation](https://scalar.com/docs-for/hono)
- [Microsoft OpenAPI generation](https://learn.microsoft.com/aspnet/core/fundamentals/openapi/aspnetcore-openapi?view=aspnetcore-9.0): ASP.NET Core 9 provides built-in document generation; interactive Swagger UI or Scalar must be added separately.
