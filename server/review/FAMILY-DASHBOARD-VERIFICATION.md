# Family dashboard verification — 2026-11-15

This is the initial feature baseline. The subsequent [React Doctor refactor review](REACT-DOCTOR-REFACTOR.md) records the current 78/100 score, eight remaining reviewed warnings and 68 passing tests.

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

Remote D1 migrations `0001` through `0004` are now applied and the production Worker (including Deepsec hardening, fridge/account-disambiguated LINE notifications, and the hidden `/fridges/:fridgeId/sim` Gateway Data Simulator) is deployed at `https://foodwarden.newisnooby.workers.dev`. Live browser verification confirmed Google login, owner Settings/LINE pairing, and the styled standalone Simulator UI. Embedded firmware, real sensor calibration, motor fail-safe validation, and end-to-end hardware field testing (`Node 'F' -> Gateway 'C' -> Server 'S'`) remain separate hardware work.
