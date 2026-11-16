# Issue: Deepsec dev dependency advisories

สถานะ: OPEN — แยกจาก 12 findings ของ application ที่แก้ในรอบนี้

`bun audit --json` ยังพบ [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) และ [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) ผ่าน Deepsec 2.3.12 ฝั่ง dev ณ 2026-11-15 ส่วน `bun audit --production --json` ไม่พบ advisory ใน production dependency set

ตรวจ registry แล้ว Deepsec 2.3.12 ยังเป็นรุ่นล่าสุดที่ตรวจพบ และ dependency รุ่นที่เข้ากันได้ของ Sandbox 1.10.2 ยัง pin Zod 3.24.4 ส่วน OIDC 3.8.10 ยังอ้าง CLI config 0.3.1 มี CLI config 0.3.8 ที่ใช้ Zod รุ่นแก้ไขแล้ว แต่เปลี่ยนเพียงจุดนี้ไม่ปิดทุกเส้นทาง

Deepsec CLI ยัง bundle โค้ด minimatch และ OIDC บางส่วนไว้ใน `dist/cli.mjs` ด้วย การ override leaf packages ให้ audit เขียวจึงไม่ได้พิสูจน์ว่าโค้ดที่ CLI เรียกจริงถูกแทนทั้งหมด ห้ามรายงานว่าปิด advisory แล้วโดยดู lockfile เพียงอย่างเดียว การบังคับ Zod 3 → 4 หรือ Sandbox 1 → 4 ต้องตรวจ compatibility ของ remote mode ซึ่งรอบนี้ไม่ได้ใช้งานและไม่ได้ทดสอบกับบัญชี Vercel

งานติดตาม:

- [ ] ใช้ release ของ Deepsec ที่ rebuild bundled dependencies เป็นรุ่นแก้ไขแล้ว หรือจัดทำ patch/fork ที่ทดสอบได้ครบ
- [ ] ตรวจ CLI config, Sandbox, OIDC และ minimatch ทั้ง dependency tree และ bundled artifact
- [ ] ทดสอบ local scan/process/report และ remote Sandbox API compatibility ก่อนเปลี่ยน parent major versions
- [ ] รัน production/full dependency audits และบันทึกผลใหม่

ยังเก็บ Deepsec และ React Doctor ตามความต้องการผู้ใช้ ไม่ได้ถอดเครื่องมือหรือซ่อน advisory ด้วย ignore/allowlist ไม่มีการส่ง issue ภายนอกหรือเรียก remote Sandbox ในงานนี้
