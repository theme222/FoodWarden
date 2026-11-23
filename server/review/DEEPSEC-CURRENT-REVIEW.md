# Deepsec ตรวจ server ปัจจุบัน — 2026-11-15

สถานะ: AI ตรวจครบ 59/59 ไฟล์ ไม่มี error, refusal หรือ skipped file และ SHA-256 ของ source/config 65 ไฟล์ตรงกับ snapshot ตลอดการตรวจ

ผลดิบ 14 findings เมื่อรวมข้อซ้ำเหลือ **12 ประเด็น: High 1, Medium 3 และ BUG 8** ไม่มี Critical หรือ High Bug ในผลรอบนี้ BUG เป็นป้ายความถูกต้อง/ความน่าเชื่อถือ ไม่ใช่ระดับช่องโหว่ด้านสิทธิ์ ทั้ง 12 ประเด็นมี PoC หรือ characterization ในเครื่องตามขอบเขตที่อธิบาย ไม่ใช่ผลโจมตี production

ควรแก้ High เรื่องถอนสิทธิ์ owner และ Medium ทั้งสามก่อน deploy ส่วนบั๊กข้อมูลควรแก้ก่อนเริ่มใช้กับอาหารจริง

ฐานโค้ด: `0d15b5c69dd7935915450cf1cdd5fc628f8d6e4e` วันที่ 2026-11-15

## วิธีตรวจและหลักฐาน

- Deepsec 2.3.12, Codex CLI 0.169.0, โมเดล `gpt-6.1-sol`, reasoning `xhigh`, concurrency 1, batch size 10 ผ่าน local subscription login เดิม ไม่มี API key ใหม่หรือ Vercel hosting
- แยก project `server-current-0d15b5c` เพื่อไม่รวม findings ของฐานโค้ดเก่าเข้ากับผลปัจจุบัน
- Pattern scan พบ 137 candidate matches ใน 38 ไฟล์ ตัวเลขนี้ไม่ใช่จำนวนช่องโหว่
- AI direct review กำหนดเป้าหมาย 59 ไฟล์ รวมไฟล์ที่ไม่มี matcher hit มี source/config แบบ allowlist รวม 65 ไฟล์เป็นบริบท พร้อม SHA-256 ต่อไฟล์
- ใช้ supplied-source snapshot เนื่องจาก child sandbox บน Windows เคยอ่านไฟล์ไม่ได้ ผล AI เป็น static review ส่วนการทดสอบ runtime ด้านล่างทำโดยผู้ตรวจหลักใน workerd/D1 จำลอง ไม่ใช่ AI ที่เรียก production
- Process run: `20261115094239-2bbf0fb76d2e5df8` เสร็จครบ 7 batches (phase `done`) Exit 1 ของ process หมายถึงพบ findings ไม่ใช่ scanner ล้มเหลว
- นอกขอบเขต: secrets และ `.env*`/`.dev.vars*`, `node_modules`, generated output, HTML ต้นแบบ, โค้ดอุปกรณ์และ `interface/` ไม่มีการ deploy, migration remote, ส่ง LINE จริง หรือเรียก Gemini ที่คิดค่าบริการ

## ประเด็นด้านสิทธิ์ที่ทำซ้ำได้

### FW-SEC-01 — คำขอ Settings ค้างไว้ทำงานต่อหลัง owner ถูกถอดสิทธิ์

Deepsec: `finding_e9b07f4afbe8478c`, High, confidence high ผู้ตรวจยอมรับระดับ High เพราะได้ Gateway credential ใหม่กลับมาหลังเพิกถอนสิทธิ์ ทำให้เข้าถึง Gateway API ต่อได้ ผู้โจมตีต้องเป็น owner ที่มี session ใช้งานได้ตอนเริ่มคำขอ ไม่ใช่ผู้ใช้ anonymous

[workers/index.ts](../workers/index.ts#L410) ตรวจ owner ก่อน `parseJsonBody` แต่ [updateFridgeSettings](../workers/lib/fridges.ts#L193) ไม่รับ actor และไม่มีเงื่อนไขตรวจ owner ใน SQL หลังเขียนยังเรียก `getFridgeSettings` ซึ่งคืน Gateway token

ทดสอบโดยเปิด PUT Settings ด้วย request stream ที่ยังไม่ส่ง JSON จนครบ รอจน handler เริ่มอ่าน body แล้วถอด owner นั้นและหมุน Gateway token จากนั้นปล่อย body ให้จบ ผลคือ HTTP 200, ชื่อตู้ถูกแก้ และ response มี token ใหม่ที่หมุนหลังถอดสิทธิ์แล้ว

ผลกระทบ: อดีต owner อาจได้ credential ของ Gateway กลับมาหลังถูกถอดสิทธิ์ และแก้การตั้งค่าต่อได้ภายในคำขอที่ค้างไว้ ไม่ได้พิสูจน์การเข้าถึงตู้ของบุคคลอื่นโดยไม่เคยมีสิทธิ์

แนวทางแก้: ตรวจ actor ที่ยังเป็น owner ภายใน SQL ของแต่ละ mutation และตรวจสิทธิ์ใน query ที่อ่าน settings/secret กลับ ไม่อาศัยเพียง check ก่อนอ่าน body ตรวจ PATCH ทั่วไปและ owner-only mutations ที่มีรูปแบบเดียวกันด้วย การย้าย parse body มาก่อน check ช่วยลดหน้าต่างแต่ไม่แทน atomic authorization

การแก้ members ในรอบก่อนยังมีอยู่และผ่าน regression test ปัญหานี้เป็นช่องใน settings ที่ใช้รูปแบบคล้ายกัน

### FW-SEC-02 — API ตั้งค่า LINE เดิมยังข้ามขั้นตอน pairing ได้

Deepsec: `finding_16d0198a128c5456` และ `finding_dd32770fcf8c05f4` เป็นประเด็นเดียวกัน, Medium, confidence high

[PATCH ตู้](../workers/index.ts#L323) และ [PUT Settings](../workers/index.ts#L410) ยังรับ `line_target_id` และส่งเข้า [updateFridgeSettings](../workers/lib/fridges.ts#L193) จึงกำหนดผู้รับได้โดยไม่ต้องมี pairing claim หรือ signed webhook จากปลายทางนั้น

ทดสอบด้วย owner ของตู้ใหม่ ใส่ recipient ID ใน Settings โดยไม่มี pairing record แล้ว POST `/line/test` ผลคือ HTTP 202 และ request ไป LINE Push API จำลองมีปลายทางตามค่าที่ใส่จริง

เงื่อนไข: ต้องรู้ recipient ID และบอทต้องส่งถึงปลายทางนั้นได้ตามข้อกำหนด LINE เช่น ยังอยู่ในกลุ่ม ผล mock ยืนยันการข้าม pairing และการสร้างคำขอส่ง ไม่ใช่หลักฐานว่า LINE ส่งถึงผู้รับจริงทุกกรณี

ผลกระทบ: คนที่เคยได้ ID ของกลุ่มหรือผู้รับอาจกำหนดกลับจากตู้ที่ตนสร้างใหม่ เพื่อส่งข้อความไม่พึงประสงค์ผ่านบอทและกินโควตาของ channel การตรวจ current recipient ใน outbox ไม่ช่วย เพราะตรวจเทียบกับ field ที่ผู้ใช้แก้เองได้

อีกผลของทางเดิม: การตั้ง `line_target_id: null` ผ่าน Settings ไม่ revokes pending pairing codes แบบ dedicated disconnect จึงต้องรวม lifecycle cleanup ด้วย

แนวทางแก้: ปิดการตั้ง raw recipient ผ่าน API ทั่วไป ผูกปลายทางผ่าน pairing ที่ตรวจ HMAC และสิทธิ์แล้วเท่านั้น รวมการตัดการเชื่อมต่อให้ใช้ implementation ที่ยกเลิกรหัสและงานค้าง

### FW-SEC-03 — JSON body ถูก buffer และ parse ก่อนมีเพดานขนาดของแอป

Deepsec: `finding_d66361a7bdfb06f5`, Medium, confidence high

[parseJsonBody](../workers/index.ts#L91) เรียก `c.req.json()` โดยไม่มี bounded reader และผู้ใช้ Google ที่ verified เข้าถึงได้ผ่าน POST สร้างตู้ก่อนจะมีสมาชิกตู้ใด ๆ การตรวจ field เกิดหลัง materialize JSON แล้ว

PoC ส่งชื่อตู้ที่ถูกต้องพร้อม padding ที่ไม่ใช้ขนาด 3 MiB ได้ HTTP 201 ยืนยันว่าทางนี้อ่าน body ขนาดใหญ่ก่อน validation แต่ไม่ได้ทดลองทำให้ memory หมดหรือล่มบน production ข้อสรุปเรื่อง resource exhaustion อาศัย source path และข้อจำกัด runtime เพิ่มเติม

Cloudflare กำหนด memory ต่อ isolate 128 MB และ request-body limit ของ platform ไม่เท่ากับ budget ที่ปลอดภัยสำหรับ JSON ของแอป ดู [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) ไม่อ้างว่าส่ง 3 MiB ครั้งเดียวทำให้ Worker ล่ม

แนวทางแก้: จำกัด bytes ขณะอ่าน stream ก่อน JSON.parse และตอบ 413 เลือก budget ตาม endpoint โดยให้ manual-photo JSON มี allowance ของ base64 ที่เหมาะสม การแก้ multipart และ LINE routes เดิมยังอยู่ แต่ไม่ครอบคลุม helper นี้

### FW-SEC-04 — Unfollow receipts กินโควตาจับคู่ LINE ส่วนกลาง

Deepsec: `finding_2dbe90c636fb5d7b`, Medium, confidence high

[processLifecycle](../workers/lib/line-pairing.ts#L291) บันทึก unfollow/leave ลง `line_webhook_attempts` โดยไม่ใช้ admission limit ของ pairing แต่ [pairing admission](../workers/lib/line-pairing.ts#L213) นับทุกแถวของตารางในสิบนาทีและหยุดเมื่อถึง 200

PoC ส่ง webhook จำลองที่มี HMAC ถูกต้อง 200 requests แต่ละ request เป็น unfollow ของผู้ใช้เดียว จากนั้นส่งรหัสจริงของ Google account อื่นที่ยังไม่หมดอายุ ผล webhook ตอบ 200 แต่บัญชีไม่ถูกจับคู่ ไม่มีการเดารหัสและไม่ต้องมี Google session สำหรับ lifecycle events

LINE ส่ง unfollow เมื่อผู้ใช้บล็อกบอทตาม [เอกสาร webhook](https://developers.line.biz/en/docs/messaging-api/receiving-messages/) ผู้ใช้ LINE จึงสร้างเหตุการณ์ชนิดนี้ได้ อย่างไรก็ตามรอบนี้ไม่ได้ทดสอบอัตราการ block/unblock จริงหรือ rate limits ของ LINE การโจมตีจริงขึ้นกับการเกิด/ส่งต่อ events ภายในหน้าต่างเวลา; ปัญหาการนับ lifecycle traffic เป็น guessing attempts ยืนยันในเครื่องแล้ว

แนวทางแก้: แยกตารางหรือชนิด receipt สำหรับ lifecycle dedup ออกจาก pairing-attempt budget อย่าหยุดการประมวลผล unlink ที่ถูกต้องเพื่อประหยัดโควตา

## บั๊กข้อมูลและความน่าเชื่อถือที่ยืนยันพฤติกรรมได้

### FW-BUG-01 — Manual retry ทำให้อาหารที่นำออกแล้วกลับมา

Deepsec: `finding_97f5e6c1e05e1560`, BUG, confidence high

[addManualFood](../workers/lib/inventory.ts#L192) เก็บหลักฐาน idempotency ไว้ใน inventory row เดียวกัน เมื่อ [deleteInventoryItem](../workers/lib/inventory.ts#L337) ลบแถว หลักฐานนั้นหายไปด้วย

PoC: POST เดิมครั้งแรกได้ 201, retry ขณะ item ยังอยู่ได้ 200, DELETE สำเร็จ แล้วส่ง POST เดิมอีกครั้งได้ 201 และเกิดแถวใหม่ เป็นกรณี response เดิมสูญหายแล้ว client retry หลังสมาชิกอีกคน checkout อาหารไปแล้ว โดยเฉพาะรายการไม่มีรูปซึ่งไม่ติด photo-retirement guard

แนวทางแก้: แยก operation ID/fingerprint/outcome ออกจากแถวอาหารและเก็บ tombstone ในช่วงเวลาที่รองรับ retry เพื่อรับรู้คำขอเก่าโดยไม่สร้างอาหารกลับมา

### FW-BUG-02 — Camera retry เพิ่มอาหารซ้ำ

Deepsec: `finding_f4a2cd161825f1b7` และ `finding_eb143f874477ad06` เป็นประเด็นเดียวกัน, BUG, confidence high

[commitCameraCheckIn](../workers/lib/ai-inventory.ts#L194) สร้าง item ID ใหม่ทุกครั้ง ไม่มี stable operation ID ทดสอบ commit payload เดิมสองครั้งได้ ID ต่างกันและ inventory สองแถว เป็นอีกประเด็นหนึ่งจากการป้องกันลบรูป shared ซึ่งแก้แล้ว

แนวทางแก้: ใช้ operation ID ต่อเหตุการณ์จริง ไม่ใช่ dedup ด้วยชื่อ/รูปซึ่งอาจเป็นอาหารจริงคนละชิ้น เก็บ unique constraint ต่อ fridge และตอบ ID เดิมเมื่อ retry เหมือนเดิม การเพิ่ม contract กับ Gateway ต้องพิจารณา [CBS.md](../../interface/CBS.md) และขออนุมัติก่อนแก้ไฟล์ใน `interface/`

### FW-BUG-03 — Timestamp อนาคตตรึงค่าล่าสุดของเซนเซอร์

Deepsec: `finding_d45bd52128c13762`, BUG, confidence high

[telemetry.ts](../workers/lib/telemetry.ts#L25) ยอมรับ timestamp ถึงปี 9999 โดยไม่เทียบ receipt time และเลือกค่ามากที่สุดเป็น `last_telemetry_json`

PoC: ส่งตัวอย่างล่วงหน้า 10 ปี แล้วส่งตัวอย่างเวลาปัจจุบัน ค่าล่าสุดยังคงเป็นตัวอย่างอนาคต ประวัติ telemetry ก็ไม่มี upper bound ของเวลาใน query ปัจจุบัน

แนวทางแก้: กำหนด future-clock allowance ที่เหมาะกับ RTC แล้ว reject/quarantine เวลาที่เกินนั้น พร้อมป้องกันข้อมูลที่เสียอยู่เดิมครองสถานะ latest ต้องคงการรับข้อมูลเก่าจาก store-and-forward

### FW-BUG-04 — Door event อนาคตติดประวัติล่าสุดและถูกนับซ้ำในสรุปรายวัน

Deepsec: `finding_5914c62383423bd9`, BUG, confidence high

[door-events.ts](../workers/lib/door-events.ts#L23) รับเวลาอนาคต ส่วน [สรุปส่วนตัว](../workers/lib/personal-notifications.ts#L319) นับ SUCCESS โดยมีเฉพาะ lower bound ของเวลา

PoC: บันทึก SUCCESS ล่วงหน้า 10 ปี แล้วสร้าง morning summary สองวันติดกัน พบทั้งสองข้อความนับเหตุการณ์นั้นเป็นการปิดใน 24 ชั่วโมงที่ผ่านมา

แนวทางแก้: ตรวจ future skew ตอนรับ และเพิ่ม upper bound ใน query ที่สื่อว่าเป็นประวัติหรือจำนวนในช่วงเวลาปัจจุบัน ไม่ใช่การยกเลิกการรับ buffered events เก่า

### FW-BUG-05 — JSON ผิดรูปแบบจาก HTTP 200 ถูก retry เป็น generation ใหม่สูงสุดแปดครั้ง

Deepsec: `finding_ae9b3aea932a3d49`, BUG, confidence high

[gemini.ts](../workers/lib/gemini.ts#L148) รวม network request, `response.json()` และ JSON parse ของผล generation ไว้ใน try/catch เดียวกัน ทำให้ parse error ถูกจัดเป็น transient failure และเข้า retry/fallback

ทดสอบ upstream จำลองที่ตอบ 200 พร้อม JSON generation ไม่ครบ พบ 4 requests ไป primary และ 4 ไป fallback ก่อน throw ไม่มีการเรียก Gemini จริง จึงไม่ได้พิสูจน์ค่าบริการที่เกิดจริง

ขอบเขต: ไม่ใช่ quota bypass หรือค่าใช้จ่ายไร้ขีดจำกัด เพราะมี reservation และเพดาน attempts เดิมอยู่ ควรแยก protocol/parse error จาก retryable transport error และกำหนดนโยบายว่าจะยอม regenerate เมื่อสำเร็จแต่ parse ไม่ได้หรือไม่ ส่วน timeout ที่ upstream อาจรับไปแล้วต้องถือว่าผลไม่แน่นอนหากไม่มี idempotency จาก provider

### FW-BUG-06 — WebSocket status ที่มาถึงช้าทับสถานะใหม่บนหน้าเว็บ

Deepsec: `finding_7aad708a900311ee`, BUG, confidence high

[src/data.ts](../src/data.ts#L107) ใช้ `status.mutate(event.status)` โดยไม่เทียบ `gatewaySeenS` แม้ D1 จะกันการเขียน status ย้อนหลังแล้ว แต่คำขอที่ broadcast ภายหลังอาจมาถึงหน้าเว็บผิดลำดับได้

PoC ใน DOM/SWR จริงพร้อม WebSocket จำลอง: ส่ง version 2000 แล้วส่ง version 1000 ผล heartbeat ที่ hook คืนและหน้าเว็บใช้ย้อนกลับเป็น 1000 ไม่มีการทำให้ D1 ย้อนหลังในเคสนี้

แนวทางแก้: functional cache update ที่เก็บ snapshot ใหม่ที่สุดตาม gateway timestamp และทดสอบทั้ง event ย้อนลำดับและ REST snapshot ที่กำลังโหลดพร้อมกัน

### FW-BUG-07 — สลับรายการอาหารระหว่างแก้ไขแล้วส่ง draft ของรายการเดิมไปทับรายการใหม่

Deepsec: `finding_d3275a7abe0a8b39`, BUG, confidence high

[ItemPage](../src/main.tsx#L113) ส่ง item ID ใหม่เข้า FoodDetail ที่ไม่มี key ตามตัวตนรายการ ส่วน [FoodDetail](../src/Food.tsx#L59) เก็บ editing state และ input แบบ uncontrolled ไว้ ลิงก์สลับรายการที่ชื่อและวันหมดอายุตรงกันยังใช้ได้ขณะเปิดฟอร์ม

PoC ผ่าน MemoryRouter และ DOM: เปิดรายการ A แก้ชื่อค้างไว้ คลิก Item 2 ไป B แล้วกด Save พบ PATCH ไป URL ของ B พร้อมชื่อ draft ที่กรอกให้ A จริง ใช้ FormData ของ DOM เพื่อจำลองการ submit form ตามพฤติกรรม browser

แนวทางแก้: key editor ตาม fridge/item ID หรือ reset state และ draft เมื่อ identity เปลี่ยน พร้อมทดสอบว่าการสลับรายการไม่ส่ง draft เก่าไปผิดเป้าหมาย

### FW-BUG-08 — Retry ของ draft ไม่ reuse ผล inference ที่สำเร็จแล้ว

Deepsec: `finding_2f5086a60e95aa79`, BUG, confidence high

[check-in draft](../workers/index.ts#L798) และ check-out draft ไม่มี logical operation ID หรือผลลัพธ์ที่บันทึกไว้เพื่อ reuse แต่ละ invocation เริ่ม quota reservation ใหม่ PoC เรียก draft ด้วยภาพเดิมสองครั้งโดยจำลอง Gemini ที่ตอบสำเร็จ พบ upstream requests 2 ครั้ง, reservations 2 แถว และ photo paths ต่างกัน

ผลกระทบ: กรณี generation สำเร็จแต่ response ไป Gateway สูญหาย การ retry จะทำงานอีกครั้งและอาจคิดค่าบริการเพิ่มตามนโยบาย provider ทั้งนี้เพดาน quota เดิมยังจำกัดยอดรวมอยู่ ไม่ได้พิสูจน์ค่าบริการจริงหรือ unlimited spending

แนวทางแก้: stable operation ID, durable result cache และสถานะ uncertain สำหรับผล upstream ที่ไม่ทราบแน่ชัด ต้องแยก retry ของ logical operation เดิมออกจากการขอวิเคราะห์ภาพเดิมโดยตั้งใจใหม่

## Dependency audit เพิ่มเติม แยกจาก Deepsec AI findings

`bun audit --production --json` ไม่รายงาน advisory ใน production dependency set ณ เวลาตรวจ (`{}`, exit 0) ส่วน `bun audit --json` ที่รวม dev พบ advisory 2 กลุ่ม:

- [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): advisory ระดับ High สำหรับรุ่นต่ำกว่า 4.6.6 ใน dependency tree พบรุ่นเก่าผ่าน `@vercel/cli-config` และ `@vercel/sandbox` ซึ่งมากับ Deepsec ฝั่ง dev ส่วน Better Auth resolve เป็น 4.6.7 และ Cloudflare test tooling มี 4.6.6 ซึ่งอยู่ในรุ่นแก้ไขแล้ว ไม่ได้พิสูจน์ production exploit จากรายการ audit นี้
- [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): advisory ระดับ Moderate พบ 10.2.6 ผ่าน Deepsec dev dependency ปัญหาต้องเกี่ยวกับ pattern ที่ผู้โจมตีควบคุมและ preprocessing ที่เข้าเงื่อนไขของ advisory ยังไม่พบเส้นทางจาก HTTP ของแอปมาถึง minimatch นี้

ควรอัปเดตหรือ override แบบตรวจ compatibility แล้วในงานแก้ไข โดยเก็บ Deepsec ไว้ตามความต้องการผู้ใช้ รอบ audit นี้ไม่ได้เปลี่ยน lockfile หรือบังคับข้าม major version

## การยืนยันเพิ่มเติม

- ชุด security regression, WebSocket และ LINE pairing เดิมผ่าน 29 tests
- PoC/characterization ใน workerd/D1 จำลองผ่าน 10 tests และ DOM/SWR อีก 2 tests รวม 12 cases ตามพฤติกรรมที่รายงานข้างต้น การผ่าน PoC หมายถึงทำซ้ำปัญหาได้ ไม่ใช่โค้ดปลอดภัย
- Gitleaks `--all` ไม่พบ secrets ในชุดไฟล์ tracked/ordinary-untracked ที่ตรวจ รวมประมาณ 25.64 MB ไฟล์ ignored ไม่ได้อยู่ในการตรวจนี้
- ไม่แก้ runtime application, migration, deployment configuration, production resources หรือ credentials ในรอบนี้
- ไม่ได้รันคำสั่ง AI `revalidate` ซ้ำ การ validation รอบนี้เป็นการตรวจ source และทดสอบจริงในเครื่องโดยผู้ตรวจหลัก
- ใช้ manual workspace และ supplied snapshot ไม่ได้รัน automatic ingress inventory/matcher-generation gate; third-party internals และ static asset ที่ bundle มาแล้วไม่ได้ถูกตรวจครบจาก dependency audit เพียงอย่างเดียว

## สถานะประเด็นจากรายงานฐานเก่า

การแก้ใน `1fa3615` ยังอยู่ใน source ที่ตรวจ รอบนี้ไม่เหมารวม findings เก่ากับ findings ปัจจุบัน

| ประเด็นเดิม                               | สถานะที่ตรวจพบปัจจุบัน                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| WebSocket ไม่ reauthorize session/member | มี session attachment, ตรวจตอน accept/private delivery/ping และ idle alarm; regression ผ่าน                             |
| สมาชิกแก้สิทธิ์หลัง owner ถูกถอด               | สมาชิกใช้ atomic actor check แล้ว แต่ Settings ยังมีช่องคนละ path ตาม FW-SEC-01                                              |
| AI ไม่มี quota                            | มี durable creator/global quotas และ concurrency reservation; draft dedup และ parse-retry เป็นข้อเพิ่มเติม ไม่ใช่ quota ถูกถอด |
| Multipart materialize ก่อนจำกัด           | มี bounded reader ก่อน formData แล้ว; JSON helper ทั่วไปยังมี FW-SEC-03                                                      |
| Concurrent changes ทำให้ไม่มี owner        | มี conditional SQL ป้องกัน last owner; regression ผ่าน                                                                    |
| ลบอาหารแล้วรูป shared หาย                 | มี photo retirement/reference guards; camera commit ซ้ำเป็นคนละบั๊กตาม FW-BUG-02                                           |
| PATCH ทับ field ที่ไม่ได้ส่ง                  | อัปเดตเฉพาะ supplied fields แล้ว; draft ของ UI ผิด item เป็นอีก path ตาม FW-BUG-07                                         |
| LINE ล้มเหลวแล้วไม่มี retry                 | มี durable outbox/retry keys; raw-recipient และ pairing-budget เป็นข้อเพิ่มเติม                                             |
| Status ใน D1 ย้อนหลัง                     | มี CAS/recompute retry แล้ว; cache หน้าเว็บยังมี FW-BUG-06                                                                  |

## ลำดับแก้ที่แนะนำ

1. FW-SEC-01: atomic authorization และ credential reads หลัง revoke
2. FW-SEC-02/03/04: ปิด raw LINE recipient, จำกัด JSON ก่อน parse และแยก lifecycle quota
3. FW-BUG-07/01/02: ป้องกันแก้ผิด item และทำ idempotency/tombstones ให้ครบ
4. FW-BUG-03/04/06: clock skew และลำดับ cache updates
5. FW-BUG-05/08: แยกชนิด error กับ durable logical inference results และแก้ dependency advisories ฝั่ง dev โดยตรวจ compatibility

## ข้อจำกัดและแหล่งอ้างอิง

AI ผลลัพธ์อาจตกหล่นหรือผิด ต้องพิจารณา actor, entry point, ความเป็นไปได้และผลกระทบทีละข้อ ไม่สรุปว่าไม่มีช่องโหว่จากการไม่มี findings ในไฟล์หนึ่ง ผลนี้ไม่ใช่ security certification หรือ browser/production pentest

- [D1 batch และ transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [LINE signature verification](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE push conditions](https://developers.line.biz/en/reference/messaging-api/nojs/#send-push-message)
- [LINE retry keys](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [รายงาน Deepsec ฐานเดิม](DEEPSEC-REVIEW.md)
