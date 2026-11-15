# Family dashboard verification — 2026-11-15

## Implemented behavior

- React routes for inventory, charts, devices, private account preferences and owner settings use real scoped API data. Charts, account and settings pages load lazily.
- Owner/member setup supports copying the fridge link; adding an email grants access but does not send invitation email.
- LINE pairing supports a family target per fridge and a private target per Google account, one-use ten-minute hashed codes, current session/owner checks, raw-body HMAC verification and lifecycle redelivery ordering.
- Personal favorites remain private and retain out-of-stock entries. Morning summaries use Asia/Bangkok time; instant alerts respect account preferences.
- Personal delivery uses an independent durable outbox with stable retry keys, current recipient/membership/preference checks and cancellation on disconnect or opt-out.

See the Thai [family workflow](../FAMILY-WORKFLOW.md) for user and operator instructions.

## Checks performed

- `bun run typecheck`: passed for frontend and Worker configurations.
- `bun run test:all`: 65 passing tests — 6 model, 9 UI and 50 Worker tests. UI tests were repeated successfully after the final inventory state cleanup.
- Worker tests cover personal/group pairing, owner/session revocation, code expiry and issuance limits, cross-account LINE conflicts, untrusted origins, signed lifecycle ordering, private favorite isolation, out-of-stock counts, morning deduplication, membership cancellation, retry-key stability and opt-out cancellation.
- `bun run lint`: exit 0; semantic-role suggestions remain, including existing components and inline SVG charts.
- `bun run knip`: passed.
- `bun run format:check`: passed.
- `bun run build`: passed. Main JavaScript chunk is approximately 475 KB / 153 KB gzip; the chart page is approximately 6 KB / 3 KB gzip. Fonts are self-hosted, with license notices under [public/font-licenses](../public/font-licenses/).
- Gitleaks runs on staged changes through the repository pre-commit hook. The backend commit passed without findings.
- `bun run doctor`: exit 0, score **75/100**, 21 warnings and no error-severity findings in the configured source scope. Warnings include component complexity/size, repeated array lookups, sequential authorization/delivery loops and an object-URL diagnostic whose cleanup exists in `finally`. No source rules were disabled. This score is not a security guarantee or a 100/100 result.

## Scope and remaining live validation

DOM tests do not establish visual fidelity on physical phones. No browser screenshot comparison was performed in this pass. LINE HTTP calls were mocked; no real LINE messages were sent. Google OAuth was not exercised against the live provider. The historical Deepsec report was not rerun for this feature.

Migrations [0002](../migrations/0002_security_and_delivery.sql) and [0003](../migrations/0003_line_pairing_and_prefs.sql) remain unapplied remotely. The production Worker remains undeployed. Before release, follow [PRODUCTION.md](../PRODUCTION.md), configure the LINE webhook and bot group permissions, and verify real Google login, family memberships, LINE pairing/reconnection, private notifications and mobile layouts.

Embedded code and shared cross-device contracts were not changed. Hardware firmware, real sensor calibration and motor fail-safe validation remain separate work.
