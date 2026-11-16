# Issue: ทำ Gateway ให้รองรับ idempotency และ sync สัญญา CBS

สถานะ: OPEN — งานติดตามที่ผู้ใช้ให้บันทึกไว้ โดยยังไม่อนุมัติการแก้ `interface/` หรือ `camera/` ในรอบนี้

อ้างอิง: [FW-BUG-02 และ FW-BUG-08](DEEPSEC-CURRENT-REVIEW.md), [CBS ปัจจุบัน](../../interface/CBS.md), [OpenAPI ของ Server](../workers/lib/openapi.ts), [operation receipts](../workers/lib/operations.ts)

## ปัญหาและการเปลี่ยนแปลงฝั่ง Server

เมื่อ Gateway ส่ง commit สำเร็จแต่ไม่ได้รับ response การ retry แบบเดิมสร้างอาหารซ้ำ ส่วน draft ที่สำเร็จแล้วอาจเรียก Gemini และอัปโหลดรูปใหม่ การ dedup ด้วยชื่อหรือ hash รูปอย่างเดียวไม่ถูกต้อง เพราะอาหารจริงสองชิ้นอาจใช้ข้อมูลหรือรูปเหมือนกัน

Server กำหนดให้สาม endpoint ต่อไปนี้ส่ง `Idempotency-Key` เป็น UUID v4:

| Endpoint                             | ขอบเขต key              | ผล retry เดิม                                           |
| ------------------------------------ | ----------------------- | ------------------------------------------------------ |
| `POST /api/inventory/checkin/draft`  | fridge + checkin draft  | response/status เดิมและรูป R2 เดิม ไม่เรียก inference ใหม่   |
| `POST /api/inventory/checkout/draft` | fridge + checkout draft | candidate response เดิม ไม่วิเคราะห์หรือเลือก candidates ใหม่ |
| `POST /api/inventory/checkin`        | fridge + camera commit  | item ID เดิม แม้อาหารถูก checkout ไปแล้ว ไม่สร้างกลับมา       |

Check-out commit ยังใช้ `item_id` ตามเดิม; manual check-in ใช้ `item_id` UUID เดิมเป็น operation identity ตาม API เดิม ไม่ต้องเพิ่ม header ให้ dashboard

Request hash ของ draft คำนวณจาก JPEG bytes ที่ parse แล้ว จึงไม่ขึ้นกับ multipart boundary หรือ filename ส่วน commit ใช้ payload ที่ normalize/validate แล้ว Key เดิมกับเนื้อหาต่างกันได้ `409 CONFLICT` Key เดียวกันคนละ fridge หรือคนละชนิด operation แยกจากกัน

## งานที่ต้องทำใน Gateway เมื่ออนุมัติ

- [ ] สร้าง UUID v4 เมื่อเริ่ม logical operation แล้ว persist ลง store-and-forward queue **ก่อน** ส่งครั้งแรก
- [ ] ใช้ key เดิมหลัง timeout, lost response, reconnect และ process/device reboot ห้ามสร้างใหม่ในแต่ละ HTTP attempt
- [ ] แยก key ของ draft และ commit และบันทึก confirmed commit payload ให้คงเดิมทุกครั้งที่ retry
- [ ] สร้าง key ใหม่สำหรับอาหารจริงอีกชิ้นหรือการวิเคราะห์ใหม่ที่ผู้ใช้ตั้งใจ แม้ JPEG จะเหมือนเดิม
- [ ] เก็บ draft response/image path และ confirmation state ก่อนส่ง commit; การ retry commit ต้องไม่เรียก draft ใหม่
- [ ] แสดงสถานะ pending/uncertain ให้ผู้ใช้เข้าใจ และอย่าสร้าง operation ใหม่อัตโนมัติเพื่อหลบ error
- [ ] เพิ่มการทดสอบ lost response, concurrent attempts, reboot recovery, offline queue replay และ checkout ก่อน delayed check-in retry

ตอนนี้ `camera/src/foodwarden_camera/__init__.py` ยังไม่มี HTTP client implementation จึงไม่มี client ที่แก้ในรอบ Server นี้

## Error และ uncertain outcomes

- `400 INVALID_PAYLOAD`: header ไม่มีหรือไม่ใช่ UUID v4 ให้แก้ client; ห้าม retry payload ที่เสียแบบเดิม
- `409 CONFLICT`: key เดิมถูกใช้กับ input ต่างกัน เป็นข้อผิดพลาดของ operation identity; ห้ามเปลี่ยน key อัตโนมัติแล้วส่งต่อ
- `409 OPERATION_PENDING`: มีคำขอแรกกำลังทำงาน หรือหยุดก่อนบันทึกผลสำเร็จ Retry key เดิมตรวจสถานะได้ แต่ Server จะไม่ takeover/re-run inference อัตโนมัติ
- `429 RATE_LIMITED`: quota ปฏิเสธก่อน inference; Server ปลด receipt นี้ให้ retry **key เดิม** หลัง backoff ได้
- `503 SERVICE_UNAVAILABLE`: หากคำขอเริ่มแล้ว ผลจะถูกเก็บแบบ uncertain และ retry key เดิมได้รับ error เดิมโดยไม่ regenerate ต้องตรวจสอบก่อนเริ่มงานใหม่โดยเจตนา
- ถ้า Worker หยุดหลัง upstream รับงานแต่ก่อนบันทึกผล จะเหลือ pending/uncertain receipt โดยไม่มีผลที่กู้คืนได้ นโยบายนี้ให้ความสำคัญกับการไม่เรียกงานซ้ำโดยไม่ทราบผล ไม่รับประกัน exactly-once ที่ Gemini ซึ่งไม่มี idempotency agreement กับแอปนี้
- Gemini ยัง retry/fallback เฉพาะ response 429/503 ที่ระบุชัดตาม policy เดิม แต่ไม่ retry network ambiguity หรือ JSON เสียจาก HTTP 200

Receipts เก็บแยกจาก inventory ตลอดอายุตู้ และถูกลบเมื่อเจ้าของลบตู้ ไม่มี TTL/takeover อัตโนมัติ การเปลี่ยน retention ภายหลังต้องกำหนด retry window และการตอบ key เก่าก่อน

## งานสัญญาและ rollout ที่ยังรอ

- [ ] ขออนุมัติแก้ `interface/CBS.md` แล้วเพิ่ม header, UUID lifecycle, error semantics และ queue persistence ตามรายการนี้
- [ ] แก้ข้อความ draft “ไม่เขียน database” ให้ชัดว่าไม่สร้าง/ลบ inventory แต่เขียน operation receipt และ quota metadata
- [ ] Mirror contract เป็น Python types/client ภายใน `camera/` โดยไม่ import/link `interface/` โดยตรง
- [ ] Implement Gateway ก่อนเปิดใช้จริง; client เดิมที่ไม่ส่ง header จะได้ 400 จาก Server รุ่นนี้
- [ ] รัน D1 migration `0004_operation_receipts.sql` ก่อนใช้ Worker รุ่นใหม่ โดยตรวจ migrations ก่อนหน้า 0002/0003 ด้วย
- [ ] ทดสอบ end-to-end กับ Gateway จริงก่อน deploy production และตรวจการคง queue หลัง reboot

รอบนี้ทำเฉพาะ Server, OpenAPI, tests และเอกสาร ไม่มีการแก้ canonical interface, Gateway implementation, remote migration หรือ deployment
