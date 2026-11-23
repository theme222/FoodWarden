# ตรวจ server อีกครั้ง — 2026-11-16

ตรวจ branch `feat/server` ที่ HEAD `493063e7ceb3b0543ed87eba7a28ac0b3936d600` รวม working tree ปัจจุบัน ผล DeepSec ใหม่ 6 รายการเมื่อรวมข้อซ้ำเหลือ **3 ประเด็น: Medium 1 และ BUG 2** ทั้งสามทำซ้ำใน Miniflare ได้โดย mock LINE ไม่มีการส่งข้อความจริง รอบนี้ตรวจและบันทึกผล ไม่ได้แก้ application findings

## ขอบเขตและความครบถ้วน

- DeepSec 2.3.12 ใช้ local Codex `gpt-6.1-sol`, medium effort, concurrency 1 ตรวจโดยตรง 67 ไฟล์: application/migrations 61 ไฟล์ และ public config/development entry/renderer อีก 6 ไฟล์ รวมถึงไฟล์ที่ไม่มี pattern hit
- Pattern scan ใช้ 77 matchers จาก 198 ที่ตรงกับ stack พบ 146 hits ใน 40 ไฟล์ ตัวเลขนี้เป็น candidate ไม่ใช่จำนวนช่องโหว่
- ทั้งสอง AI runs จบครบ ไม่มี refusal หรือ skipped analysis ตรวจ SHA-256 ของ snapshot 68 ไฟล์หลังจบแล้วตรงทั้งหมด มี declaration file หนึ่งไฟล์ใน context ซึ่ง direct mode ไม่เลือกเป็นเป้าหมาย
- ใช้ source snapshot เป็น context เพราะ child sandbox บน Windows อ่าน source ไม่ได้ การตรวจ AI จึงเป็น static review; การทำซ้ำด้านล่างใช้ local Worker runtime แยกต่างหาก ไม่ได้ทดสอบระบบ deploy จริงหรือฮาร์ดแวร์
- เก็บ state เดิมไว้ แยกผลรอบนี้ด้วย `producedByRunId` ไม่ได้นำ findings เก่ามานับเป็นผลใหม่ Runs: `20261116030916-a249cb68ebc66567` และ `20261116031853-445789c4de9ba815`
- Raw JSON, source hashes และ PoC อยู่ใน ignored `.reports/` / `.deepsec/` ของเครื่องนี้ ไม่รวมไว้ใน Git รายงานนี้เป็นผลที่อ่านได้ถาวร
- ไม่ได้ audit implementation ภายใน dependencies ทุกตัว, private environment files, production IAM/configuration, sibling firmware หรือทำ dependency advisory scan จึงไม่ถือเป็นการรับรองว่าระบบไม่มีช่องโหว่อื่น

## ประเด็นที่ยืนยัน

### FW-20261116-01 — Gateway ข้าม notification cooldown และ replay guard ใน production ได้

ระดับ **Medium**, ต้องมี gateway Bearer token ของ fridge เป้าหมาย ไม่ใช่ unauthenticated access

[telemetry route](../workers/index.ts#L1148) และ [door route](../workers/index.ts#L1216) อ่าน `bypass_cooldown=1` โดยไม่ตรวจ environment หรือ owner session จากนั้น [clearFridgeAlertCooldowns](../workers/index.ts#L1111) ลบ cooldown และ event receipts ของทั้ง family/personal แม้ ingestion ไม่เพิ่มข้อมูลใหม่ ระบบยังเรียก alert helpers ต่อ

PoC ตั้ง `APP_ENV=production` และ mock upstream สำเร็จ: ส่ง telemetry ร้อนหนึ่งรายการเกิด push 1 ครั้ง; ส่ง payload เดิมปกติยังเป็น 1 ครั้ง; ส่งเดิมพร้อม bypass ได้ `ingested_count=0` แต่ push เพิ่มเป็น 2 ครั้ง จึงยืนยันการส่งซ้ำและการใช้โควตา LINE โดยไม่ต้องมี event ใหม่ ผลดิบ 4 รายการจาก simulator, route และสอง delivery helpers เป็นปัญหารากเดียวกัน

แนวทางแก้: ปิด bypass ใน production หรือใช้ test operation ที่ต้องมีทั้ง explicit development configuration และ owner authorization; หลีกเลี่ยงการลบ replay receipts เพื่อทดสอบ cooldown

### FW-20261116-02 — Telemetry ซ้ำที่ค่าขัดกันทำให้ข้อมูลที่แสดงและ alert ต่างจากฐานข้อมูล

ระดับ **BUG**, ต้องส่งข้อมูลด้วย gateway token

[ingestTelemetry](../workers/lib/telemetry.ts#L73) เก็บค่าชุดแรกต่อ `(node_id, timestamp_s)` และใช้ `INSERT OR IGNORE` แต่ [route](../workers/index.ts#L1149) ส่ง array เดิมทั้งหมดเข้า broadcast และ alert helpers ขณะที่ [mergeTelemetrySamples](../src/model.ts) ฝั่ง dashboard ใช้ค่าซ้ำชุดสุดท้าย

PoC ส่ง sample `F0` timestamp เดียวกันสองชุด อุณหภูมิ 3°C ตามด้วย 18°C: D1 เก็บ 3°C, เกิด LINE high-temperature push 1 ครั้ง และ client merge ให้ 18°C การ reload จากประวัติจึงสามารถแสดงอีกค่าหนึ่ง ประเด็นนี้ไม่ทำให้ gateway เข้าถึง fridge อื่น

แนวทางแก้: ให้ ingestion คืนข้อมูล canonical ที่ยอมรับจริง และใช้ชุดนั้นสำหรับ latest snapshot, WebSocket และ notifications พร้อมกำหนดนโยบาย conflicting retry ให้ชัด

### FW-20261116-03 — ข้อความ personal safety alert ยาวเกินจนถูกทิ้งถาวร

ระดับ **BUG**, ส่งผลต่อความน่าเชื่อถือของ safety notification

[personalDoorAlerts](../workers/lib/personal-notifications.ts#L300) รวม node IDs ทั้งหมดในข้อความเดียว โดย [parser](../workers/lib/door-events.ts) ยอมรับได้ถึง 499 events และ node ID 128 ตัวอักษร [push helper](../workers/lib/personal-notifications.ts#L28) ไม่แบ่งข้อความ และ [dispatcher](../workers/lib/personal-notifications.ts#L193) จัด HTTP 400 เป็น permanent failure

PoC ส่ง 60 node IDs ยาว 128 ตัวอักษร ผ่าน parser ได้จริง ข้อความที่สร้างยาวเกิน 5,000 ตัวอักษร ให้ mock upstream ตอบ 400 แล้วพบ `failed=1` และ `delivered_s=null` ใน outbox ข้อจำกัด 5,000 ตัวอักษรอ้างอิง [LINE text message reference](https://developers.line.biz/en/reference/messaging-api/nojs/#text-message) โดยนับ UTF-16 code units ตาม [character counting](https://developers.line.biz/en/docs/messaging-api/text-character-count/) การตอบ 400 ของบริการจริงไม่ได้ถูกเรียกทดสอบในรอบนี้

แนวทางแก้: จำกัด/สรุปรายชื่อพร้อมจำนวนที่ละไว้ หรือแบ่งข้อความก่อน enqueue ให้แต่ละ message และทั้ง request อยู่ภายในขอบเขต LINE รวมถึง personal test/digest paths

## React Doctor

React Doctor 0.9.23 full scan: **79/100, 0 errors, 7 warnings ใน 6 ไฟล์** Security category: **0 errors และ 0 warnings** คะแนนใน JSON ของ security run ยังเป็นคะแนนรวม 79 ไม่ใช่คะแนน security แยก

| Warning                               | ตำแหน่ง                                                                     | ผลพิจารณา                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `no-create-object-url-without-revoke` | [Food.tsx](../src/Food.tsx#L294)                                           | False positive: URL เดียวกันถูก revoke ใน `finally` ทั้งเส้นทางสำเร็จและล้มเหลว                                                            |
| `no-pass-data-to-parent`              | [data.ts](../src/data.ts#L149)                                             | เป็นการแจ้ง access loss เมื่อพบ terminal 401/403/404 ไม่ควรลบทิ้งเพื่อเพิ่มคะแนน; หากปรับต้องคงพฤติกรรมออกจาก private workspace                  |
| `async-await-in-loop` 2 จุด            | [fridge-room.ts](../workers/durable-objects/fridge-room.ts#L127)           | ตรวจ session/membership ก่อนส่ง event และตรวจซ้ำใน alarm; bounded concurrency เป็น performance option แต่ต้องคง fail-closed และ ordering |
| `async-await-in-loop`                 | [line-pairing.ts](../workers/lib/line-pairing.ts#L196)                     | การประมวลผล webhook/lifecycle มีลำดับและ watermark ควรรักษา semantics ก่อนเพิ่ม concurrency                                              |
| `async-await-in-loop`                 | [personal-notifications.ts](../workers/lib/personal-notifications.ts#L120) | Dispatch ผ่าน lease และ recipient recheck; ไม่เปลี่ยนเป็น unbounded parallel loop โดยไม่มีหลักฐาน                                          |
| `async-await-in-loop`                 | [telemetry.ts](../workers/lib/telemetry.ts#L106)                           | เขียน D1 เป็น chunk จำกัดขนาด; เป็น throughput consideration ไม่ใช่หลักฐาน correctness defect ด้วยตัวมันเอง                                  |

ไม่มีการ suppress rules หรือแก้ application code เพื่อให้คะแนนดูดีขึ้น

## ผล verification

| Check                  | ผล                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `bun run typecheck`    | ผ่าน                                                                                      |
| `bun run test:all`     | ผ่าน 93 tests: logic 6, UI 15, Worker 72                                                  |
| Local PoC suite        | ผ่าน 3 characterization cases; ยืนยันว่าปัญหายังเกิด ไม่ใช่ regression tests ของ fix              |
| `bun run build`        | ผ่าน                                                                                      |
| `bun run lint`         | ผ่าน exit 0 แต่มี 17 warnings                                                               |
| `bun run knip`         | ผ่าน                                                                                      |
| `bun run secrets:all`  | ผ่าน ไม่พบ secret ใน tracked/ordinary untracked non-ignored snapshot                       |
| `bun run format:check` | ไม่ผ่าน 115 ไฟล์เดิมนอกงานนี้; ไม่ได้จัดรูปแบบ application ทั้ง branch                               |
| Diagram rendering      | ผ่าน 15 ไฟล์ ทั้ง XML, ไม่มี opaque root canvas และไม่มี unresolved CSS variables                |
| SVG raster checks      | cloud, inventory-flow และ system-detailed บนพื้นขาว/มืด/เทา; transparent corner alpha เป็น 0 |
| `git diff --check`     | ผ่าน                                                                                      |

การผ่าน tests ปัจจุบันไม่ได้ลบล้างปัญหาที่ PoC ใหม่ยืนยัน พบข้อจำกัด coverage ที่ยังไม่มี regression ใน suite ปกติ

Local reproduction artifacts: [PoC suite](../.reports/audit-poc.worker.test.ts), [local config](../.reports/audit-vitest.config.ts), [source/coverage summary](../.reports/deepsec-complete-summary.json), [full React Doctor JSON](../.reports/react-doctor-latest.json), [security category JSON](../.reports/react-doctor-security-latest.json) ลิงก์กลุ่มนี้ใช้ได้เฉพาะเครื่องที่รัน audit เพราะไฟล์ถูก ignore

```bash
bunx vitest run --config .reports/audit-vitest.config.ts
```

DeepSec reported input 2,303,925 tokens, output 8,731, cached input 77,824; รวม input + output 2,312,656 tokens (cached input เป็นส่วนหนึ่งของ input ไม่ได้นับซ้ำ) Local subscription ใช้ allowance; ตัวเลข `totalCostUsd=0` ใน CLI ไม่ได้ยืนยันว่าไม่มีต้นทุนหรือไม่มีการใช้โควตา

## Diagram changes

ดู [diagram guide](../diagrams/README.md) สำหรับมุมมองใหม่ 9 ชุด รวมเป็น 15 ชุด แยก implemented server จาก embedded design และบันทึกความคลาดเคลื่อนเรื่อง sensor, software versions, motion timeout และ alert duration ที่ยังต้องตัดสินใจ Renderer คง canvas โปร่งใส ใช้เส้นเข้มพร้อมขอบสว่างบน connectors/arrowheads/lifelines และ resolve theme variables เป็นค่าสีจริง

## ผลการแก้ไขและตรวจซ้ำ (Remediation — 2026-11-16)

แก้ไขทั้ง 3 ประเด็นจากผล DeepSec เรียบร้อยแล้ว และเพิ่ม regression suite ถาวรใน [workers/server-check-2026-11-16.test.ts](../workers/server-check-2026-11-16.test.ts) และ [src/model.test.ts](../src/model.test.ts)

### สรุปการแก้ไข

1. **FW-20261116-01 (Medium) — จำกัด `bypass_cooldown=1` และคง replay guard**
   - [workers/index.ts](../workers/index.ts): เพิ่ม `authorizeCooldownBypass` (คืน `400` ถ้าค่าไม่ถูกต้อง, คืน `403` นอก `APP_ENV === "development"` หรือเมื่อไม่มี owner session cookie ที่ผ่านการยืนยัน) และเปลี่ยน `clearFridgeAlertCooldowns` เป็น `clearScopedAlertCooldowns` ที่ล้างเฉพาะ cooldown ตาม scope (`telemetry` หรือ `door`) ของ fridge และ owner ผู้ส่ง โดย **ไม่ลบ** `line_alert_events` หรือ `user_line_events` และจะทำงาน/broadcast/แจ้งเตือนเฉพาะเมื่อมีแถวใหม่ถูกบันทึกจริง (`acceptedSamples.length > 0` / `acceptedEvents.length > 0`)
   - [src/GatewaySimulator.tsx](../src/GatewaySimulator.tsx): ปิด default `bypassCooldown` เป็น `false`, นำ `?bypass_cooldown=1` ออกจาก `RAW_ENDPOINTS`, ส่ง `credentials: "same-origin"` และระบุชัดเจนว่า bypass ใช้ได้เฉพาะ dev + owner
   - อัปเดต [workers/ai-and-alerts.test.ts](../workers/ai-and-alerts.test.ts), [test/ui/family.test.tsx](../test/ui/family.test.tsx), [workers/lib/openapi.ts](../workers/lib/openapi.ts) และ [ARCHITECTURE.md](../ARCHITECTURE.md)

2. **FW-20261116-02 (BUG) — First-write-wins canonical telemetry & door events**
   - [workers/lib/telemetry.ts](../workers/lib/telemetry.ts): `ingestTelemetry` คืน `{ ingestedCount, acceptedSamples }` จากแถวที่ `INSERT OR IGNORE` บันทึกได้จริง (`meta.changes > 0`) และอัปเดต `fridges.last_telemetry_json` เฉพาะจาก `acceptedSamples` (ถ้าซ้ำทั้งหมดจะอัปเดตเฉพาะ `last_seen_s`)
   - [workers/lib/door-events.ts](../workers/lib/door-events.ts): `ingestDoorEvents` คืน `{ ingestedCount, acceptedEvents }` จากแถวที่บันทึกได้จริงเช่นเดียวกัน
   - [workers/index.ts](../workers/index.ts): ส่งเฉพาะ `acceptedSamples` / `acceptedEvents` เข้า `notifyFridgeRoom` และ LINE alert helpers
   - [src/model.ts](../src/model.ts): ปรับ `mergeTelemetrySamples` ให้ใช้ first-write-wins สอดคล้องกับ D1

3. **FW-20261116-03 (BUG) — คุมความยาวข้อความ LINE ภายใน 5,000 UTF-16 code units และกันตัดกลาง surrogate pair**
   - [workers/lib/line-format.ts](../workers/lib/line-format.ts): เพิ่ม `LINE_MAX_TEXT_LENGTH = 5000`, `LINE_MAX_MESSAGES_PER_REQUEST = 5`, `safeSliceText`, `capLineText` และ `summarizeLineItems`
   - [workers/lib/personal-notifications.ts](../workers/lib/personal-notifications.ts): `personalDoorAlerts` สรุป `node_id` ไม่เกิน 1,200 หน่วยพร้อม `และอีก N โหนด`; `enqueuePersonalTest`, `queueInstant`, `queueMorningDigests` และ `push()` คุมความยาวปลอดภัยต่อ surrogate pair ทั้งหมด
   - [workers/lib/line.ts](../workers/lib/line.ts) และ [workers/lib/line-pairing.ts](../workers/lib/line-pairing.ts): ใช้ `capLineText` / `LINE_MAX_MESSAGES_PER_REQUEST` ใน `queueLineAlert`, `sendLinePush` และ `reply`

### ผล verification หลังแก้ไข

| Check                                | ผลหลังแก้ไข                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`                  | ผ่าน (0 errors)                                                                                                                                          |
| `bun run test:all`                   | ผ่าน **97 tests**: logic 7 ([model.test.ts](../src/model.test.ts)), UI 15, Worker 75 (11 test files รวม `server-check-2026-11-16.test.ts`)               |
| Old PoC characterization suite       | Fail ทั้ง 3 exploit assertions ตามคาด (production bypass ได้ `403`, conflicting duplicate ส่ง `0` alerts, batch 60 nodes ถูกสรุปเหลือ `1434` chars และส่งสำเร็จ) |
| `bun run build`                      | ผ่าน (`vite build`)                                                                                                                                      |
| `bun run lint`                       | ผ่าน exit 0 (17 jsx-a11y warnings เดิม, 0 errors)                                                                                                         |
| `bun run knip`                       | ผ่าน                                                                                                                                                     |
| `bun run secrets:all`                | ผ่าน (0 leaks)                                                                                                                                           |
| `bun run doctor` / `doctor:security` | 79/100 (ลดจาก 7 เหลือ 6 warnings), Security: 0 warnings / 0 errors                                                                                       |
| Prettier (ไฟล์ที่แก้/เพิ่ม)                | ผ่านทั้งหมด (`--end-of-line crlf` สำหรับไฟล์ CRLF และ `lf` สำหรับ `ARCHITECTURE.md`, รายงานนี้)                                                                 |
| `git diff --check`                   | ผ่าน (0 whitespace errors)                                                                                                                               |
