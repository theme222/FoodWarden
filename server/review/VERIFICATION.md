# Verification results

The checks below used `feat/server`, the original `Fridge.drawio` Page-1 and Firebase project `demo-foodwarden` running locally. See [the work log](DASHBOARD.md) for implementation decisions and [the diagram audit](DIAGRAM-AUDIT.md) for the drawing cross-check.

| Requirement | Verification and result |
| --- | --- |
| Device tree and exact contact times | The [integration suite](../functions/test/dashboard.test.cjs) posted C0, F0, D0 and an extra F1 using the PR #5 contract. It checked unauthorized writes, missing C0, duplicate IDs, stale reports, explicit null, and retention of the prior known timestamp. The 390 px browser view showed C0 above F0 and D0 with an exact local timestamp and a clear state for D0's reported null. |
| Duplicate count and original image per item | The API test stored separate documents and checked that private photo responses returned the exact saved bytes. It also exercised an existing camera path, rejection of cross-fridge paths, and reuse of a bilingual name. In the browser, two original milk rows and a manual addition appeared as one `×3` row. Its detail page showed two other matching items and separate item links. The uploaded JPEG opened at its saved 240 × 180 dimensions. An item without an image showed the empty state. |
| Compact temperature, VOC and light charts | The browser displayed all three SVG plots without horizontal overflow at 390 px. Test samples included a light change and an explicit VOC null. The [model tests](../src/model.test.ts) assert that the VOC line breaks and the light line remains continuous. The member history query is covered in the integration suite. |
| Simple operation and language | The mobile browser test switched between Thai and English, opened the Devices tab, opened a food row, and saved from the add-food form. The app uses labelled controls and 44 px primary controls. These checks exercised the interface in a browser, with a verified emulator account. |
| Optional picture | The browser attached a synthetic JPEG using the file chooser, showed a preview and saved the item. The API suite also created an item without a picture, replayed an identical upload, rejected a conflicting retry and verified that a non-member could neither add food nor read its photo. |
| Original drawing and GitHub review | Inspected the matching draw.io XML and its embedded location images, checked the relevant hardware branches, and read all three issues and both PRs returned by GitHub. Rendered all six Pele diagrams and checked the overview in [Pele Playground](https://pele.run/playground). The audit identifies differences in source facts rather than treating all diagrams as wiring specifications. |
| Build and runtime | `bun run typecheck`, four frontend model tests, `bun run build` and the Functions TypeScript build passed. Both Firebase integration suites passed on Node.js 22.23.4 against Auth, Functions, Firestore and Storage emulators. |

## Test findings and boundaries

- The browser found that the emulator rejected a descending document-key scan for history. The query now orders by the existing `bucket_minute` field, with a member-access regression test.
- The first Node.js 22 emulator run stopped at the default Functions discovery timeout. With the local discovery timeout increased to 60 seconds, the same code loaded and both integration suites passed.
- The in-app browser did not expose the Google popup during the test. The browser walkthrough used a verified Auth Emulator account and the real dashboard and Functions. Production Google OAuth, a real phone camera and a household usability session require field verification.
- Real C0, F0 and D0 contact times depend on the gateway sending PR #5 reports. The reviewed camera implementation has no matching sender. The server has been verified against synthetic heartbeat traffic. No hardware measurement or production deployment is represented by these tests.
- The Vite build reports the bundle-size warning for the Firebase SDK and dashboard bundle. Its emitted JavaScript is about 821 kB before gzip and 252 kB with gzip.
