# แผนงาน: Performance, Security, Load Test & Incident Readiness

อัปเดตล่าสุด: 2026-07-03 · Branch: `charp`

เอกสารนี้สรุป checklist งานที่ต้องทำ เพื่อเตรียมระบบ (backend-bun + kiosk) ให้พร้อมรับโหลดจริงในโรงเรียน ครอบคลุม 6 หมวด: Security, ความถูกต้องของธุรกรรมการเงิน, ความทนทานของระบบ, การประเมิน/ทดสอบโหลด, Incident Response, และ Logging/Observability

---

## 0. สถานะปัจจุบัน (Code Audit — ตรวจจริงใน `backend-bun`)

### ✅ มีแล้ว / ทำถูกต้องแล้ว
- **Increment + row lock ครบทุกจุดที่แตะยอดเงิน** — `wallet_service.ts`, `topup_service.ts`, `pos_checkout_service.ts`, `pos_service.ts`, `refund_service.ts`, `returns_service.ts` ทุกจุดใช้ `pgClient.begin(...)` + `SELECT ... FOR UPDATE` แล้วคำนวณ `balanceAfter = balanceBefore ± amount` เสมอ ไม่มีจุดไหน set ยอดทับตรงๆ (แม้แต่ `transferWithinFamily` ก็ lock 2 wallet โดยเรียงตาม id กันไม่ให้ deadlock)
- **Timeout บน outbound request ที่มีอยู่ทั้งหมด** — `pymt_gateway.ts` มี `AbortController` timeout 30s ทุกเรียก BAY, `auth_service.ts` (Google OAuth) มี timeout 10s — ไม่มีจุดไหนยิง `fetch` แบบไม่ตั้ง timeout
- **Rate limit ระดับ IP+path มีอยู่แล้ว** — `RateLimitMiddleware.ts` ตั้ง global 300 req/min, auth endpoint 30 req/min — เลข 300 req/นาทีที่ระดมไอเดียกันไว้ตรงกับค่าที่ตั้งจริงในระบบพอดี ใช้เป็น baseline ของ load test ได้เลย
- **Request timing + request-id logging** — `TimerMiddleware.ts` + `logger.ts` มี log START/END พร้อมเวลาและ request-id ทุก request, log แยกไฟล์รายวัน (winston-daily-rotate, เก็บ 30 วัน) อยู่แล้ว
- **Webhook idempotency พื้นฐาน** — `handleBayCallback` เช็ค `status === 'confirmed'` ก่อนเสมอ ไม่ credit ซ้ำแม้ webhook ยิงซ้ำ

### ❌ ยังไม่มี / เป็นช่องโหว่จริง
- **ไม่มี process-level crash guard** — ไม่มี `process.on('uncaughtException' | 'unhandledRejection')` ใน `server.ts`/`app.ts` เลย ถ้ามี unhandled rejection จุดใดจุดหนึ่ง **ทั้ง process ตายทันที กระทบทุก request ที่ค้างอยู่** (ตรงกับที่กังวลเรื่อง "Process CPU ตาย MEMORY เต็ม")
- **ไม่มี CPU/Memory monitoring** — ไม่มี endpoint หรือ metric export (เช่น `/metrics` แบบ Prometheus) ให้ดู memory/event-loop lag ของ process จริง
- **ยังไม่มี deploy spec เป็นลายลักษณ์อักษร** — ไม่มีเอกสารระบุจำนวน instance / CPU-RAM ต่อเครื่อง / restart policy
- **ไม่มี VA scan / SQLi audit อย่างเป็นทางการ** — โครงสร้างปลอดภัยระดับหนึ่งเพราะใช้ Drizzle + postgres-js tagged template (parameterized เสมอ ไม่พบ string concat เข้า SQL ที่ไหน) แต่ยังไม่เคยรัน scan จริงเพื่อ confirm
- **ไม่มี automated test สำหรับ flow การเงินเลย** — โฟลเดอร์ `tests/` มีแค่ `health`, `isb_sync`, `shop_products`, `shops`, `response_util` — **ไม่มี test สำหรับ wallet/topup/pos-checkout** ซึ่งเป็นจุดเสี่ยงสูงสุดถ้าจะรีแฟคเตอร์หรือแก้โค้ดต่อ
- **ไม่มี load test script ในโปรเจกต์** — ไม่พบ k6/artillery/autocannon หรือ script อื่นใดสำหรับยิงโหลด ต้องสร้างใหม่ทั้งหมด
- **ไม่มี incident report template** — ยังไม่มีทั้ง flow เก็บ start/end date ของ incident และ HTML report template ที่มีกราฟ
- **Logging ยังเป็น file/console ล้วน** — ยังไม่มี central dashboard/APM (เช่น Grafana/ELK) ให้ query log ย้อนหลังง่ายๆ เวลาเกิดเหตุ

---

## 1. Security

- [ ] ทำ **VA scan (Vulnerability Assessment)** ทั้งระบบ (API, dependencies, container image)
- [ ] ตรวจสอบ **SQL injection** อย่างเป็นทางการ (โครงสร้างปลอดภัยอยู่แล้ว — ORM parameterized ทั้งหมด — แต่ยังไม่เคย scan ยืนยัน)
- [ ] กำหนด SLA: **ทุก API ต้องตอบกลับภายใน 1 วินาที** ภายใต้โหลดปกติ — ใช้เป็นเกณฑ์ผ่าน/ไม่ผ่านของ load test (มี timing log อยู่แล้ว รอแค่เกณฑ์วัดผลอัตโนมัติ)

### 1.1 ช่องโหว่จริงที่เจอจากการอ่านโค้ด (เรียงตามความรุนแรง)

- [x] **🔴 Critical — BAY webhook ไม่ได้เช็ค signature จริงในทางปฏิบัติ — mitigated ใน production**: `BayCallbackController.ts` เขียน verify signature ไว้ถูกต้อง (`x-pymt-signature`, constant-time compare) แต่ทำงานเฉพาะเมื่อ `process.env.PYMT_WEBHOOK_SECRET` ถูกตั้งค่า — ผู้ใช้ยืนยันว่า **ได้ตั้งค่า `PYMT_WEBHOOK_SECRET` บน production แล้ว** จึงไม่ได้อยู่ในสถานะ fail-open อีกต่อไปในทางปฏิบัติ — หมายเหตุ: โค้ดยังไม่ได้แก้ให้ fail-closed (ถ้าใครลบ/ลืมตั้ง env นี้ในอนาคตจะย้อนกลับไปเป็นโหมดไม่เช็คแบบเดิม) เก็บไว้เป็น defense-in-depth ที่ยังไม่เร่งด่วน เพราะ risk หลักถูกปิดด้วย config จริงแล้ว
- [x] **🟠 High — CORS default เป็น wildcard + credentials — แก้แล้ว**: `config.ts` เดิมตั้ง `corsOrigins` default เป็น `"*"` ถ้าไม่ตั้ง `CORS_ORIGINS` ซึ่ง `app.ts` แปลงเป็น `origin: true` (สะท้อนกลับทุก Origin) พร้อม `credentials: true` — **แก้แล้ว**: เพิ่ม `corsOriginsFromEnv()` ใน `config.ts` ให้ **fail-closed เมื่อ `NODE_ENV=production`** — ถ้าไม่ตั้ง `CORS_ORIGINS` ตอน production จะ throw ตอน boot ทันที (เหมือน pattern เดิมที่ใช้กับ `JWT_SECRET`/`DATABASE_URL`) ส่วน dev ยังคง default เป็น `*` ได้เหมือนเดิมเพื่อความสะดวก — **ทดสอบจริงแล้ว**: (1) `NODE_ENV=production` ไม่ตั้ง `CORS_ORIGINS` → process ปฏิเสธ boot ทันที (`error: CORS_ORIGINS is required in production...`), server ไม่ขึ้นเลย ยิง `/health` ได้ connection refused (2) `NODE_ENV=production` ตั้ง `CORS_ORIGINS` ไว้ → boot ปกติ `/health` 200 (3) dev ไม่ตั้งอะไร → boot ปกติเหมือนเดิม — `bun test` ผ่านครบเหมือนเดิม (25 pass, 3 fail เดิมไม่เกี่ยวข้อง)
- [x] **🔴 Critical (อัปเกรดจาก 🟡 หลังทดสอบจริง) — rate limiter ไม่ทำงานเลยแม้แต่ instance เดียว — แก้แล้ว**: ตอนแรกประเมินไว้แค่ว่า in-memory store จะไม่รอด scale-out แต่พอเขียน integration test จริงมายิง (`scripts/test-rate-limit-scaleout.ts`) เจอว่า `rateLimitMiddleware` **ไม่ลิมิตอะไรเลยแม้แต่ process เดียว** — สาเหตุคือ `RateLimitMiddleware.ts:64` เรียก `.onBeforeHandle(globalRateLimit)` **ขาด `{ as: "global" }`** ทำให้ hook ผูกอยู่กับ instance ของปลั๊กอินเอง (ที่ไม่มี route ติดอยู่เลย) ไม่ propagate ไปที่ router จริงที่ `.use()` เข้ามาทีหลัง → 320 request ติดกันไป `/health` ผ่านหมด 320/320 ไม่มี 429 เลยสักตัว ยืนยันด้วย curl ตรงกับ dev server จริงด้วย ✅ **แก้แล้ว**: เพิ่ม `{ as: "global" }` เป็น argument แรก — ยืนยันซ้ำด้วย curl 320 req ได้ผล `ok=300, limited=20` ตรงตาม design แล้ว มี unit-ish evidence เก็บไว้ใน `scripts/test-rate-limit-scaleout.ts` (บันทึกผลไว้ด้านล่าง)
- [ ] **🟡 Medium — rate limiter เป็น in-memory ต่อ process — ตั้งใจ "ยังไม่แก้" (known limitation)**: หลังแก้บั๊ก critical ข้างบนแล้ว รัน `scripts/test-rate-limit-scaleout.ts` กับ 2 instance สดใหม่ (พอร์ตแยกกัน ไม่แชร์ window กัน) ยืนยันได้จริงว่า **2 instance รวมกันปล่อยผ่าน 598/700 request** (แทนที่จะ cap ที่ ~300) เพราะ counter อยู่คนละ `Map` คนละโปรเซส — ทางเลือกที่คุยกันไว้: (1) ย้ายไป Redis (มาตรฐาน เร็ว แต่ต้อง provision infra ใหม่) หรือ (2) ใช้ Postgres เดิมเป็น shared counter (ไม่ต้องเพิ่ม infra แต่เพิ่ม DB round-trip ทุก request ซึ่งเสี่ยงแย่งกับ pool เดิมตอนโหลดสูง) — **ตัดสินใจ: ยังไม่ทำตอนนี้** เพราะ `backend-bun` deploy เป็น instance เดียวอยู่ (`fly-deploy.yml` ปัจจุบัน deploy แค่ `backend/` เก่า ไม่ใช่ตัวนี้ด้วยซ้ำ) ยังไม่ scale-out จริง — ต้องกลับมาแก้ก่อนวันที่จะรันมากกว่า 1 instance จริง (ตรงกับแผน 15 POS ในหมวด 4)
- [x] **🟡 Medium — API key compare ไม่ใช่ constant-time — แก้แล้ว**: ดึง constant-time compare ที่เคยมีแค่ใน `BayCallbackController.ts` ออกมาเป็น `src/lib/crypto.ts::timingSafeEqual()` แล้วให้ `checkApiKey()` (`isb_sync_response.ts`) กับ `verifyWebhookSignature()` ใช้ตัวเดียวกัน — เพิ่ม `tests/crypto.test.ts` (5 tests, correctness เท่านั้น ไม่วัด timing ตามที่ตกลงกันไว้) — `bun test` ทั้งชุดผ่านเหมือนเดิม (25 pass, มี 3 fail เดิมที่ไม่เกี่ยวกับการแก้นี้ — schema drift เก่าใน `shops.test.ts`/`shop_products.test.ts`)
- [ ] **🟡 Medium — ไม่มี dependency/secret scanning ใน CI**: workflow เดียวที่มี (`fly-deploy.yml`) deploy แค่ `backend/` (FastAPI เดิม) ไม่ใช่ `backend-bun`, และไม่มี step รัน `bun audit`/secret scanner เลย ทำให้ VA-scan/SQLi ในเช็คลิสต์ข้างบนกลายเป็นงาน manual ครั้งเดียวแทนที่จะเป็นเกตอัตโนมัติ

**บทเรียนจากรอบนี้**: การวางแผน "จะทดสอบยังไง" แล้วเขียน test จริงเจอบั๊กที่ใหญ่กว่าที่ประเมินจากการอ่านโค้ดอย่างเดียว (severity เปลี่ยนจาก 🟡 เป็น 🔴) — ยืนยันว่าหมวด 6 (ทำ test case ให้ครบ) ในเช็คลิสต์ควรทำเร็วๆ นี้ ไม่ใช่แค่หมวด security

## 2. ความถูกต้องของธุรกรรมการเงิน (เติมเงิน/หักเงิน)

- [x] เติมเงิน/หักเงินต้องใช้ **increment (บวก/ลบยอด)** ห้าม set ยอดใหม่ทับยอดปัจจุบัน — ✅ ทำถูกต้องแล้วทุกจุด (ดูหมวด 0)
- [x] **Lock resource ระหว่างอัปเดตยอด** ห้าม request อื่นมาแก้ไข record เดียวกันพร้อมกัน — ✅ ใช้ `SELECT ... FOR UPDATE` ในทุก transaction แล้ว
- [ ] **ยังขาด automated test** ที่ยิง concurrent request ซ้อนกันจริงเพื่อยืนยันว่า lock ทำงานถูกต้อง (ตอนนี้ verify ได้แค่จากอ่านโค้ด)

## 3. ความทนทานของระบบ (Resilience)

- [x] ทุก outbound request (เรียก service ปลายทาง) ต้องมี **timeout** — ✅ มีครบทุกจุดที่เรียกออกนอกระบบ (BAY gateway 30s, Google OAuth 10s)
- [ ] Monitor **CPU/Memory** ของ process — ยังไม่มี metric endpoint ใดๆ
- [ ] **ไม่มี process crash guard** — ยังไม่มี `uncaughtException`/`unhandledRejection` handler ทำให้ process ตายทั้งตัวได้จาก error จุดเดียว (ความเสี่ยงสูงสุดในหมวดนี้)
- [ ] จัดการเคส **"ยิง request ออกไปแล้วปลายทางไม่ได้รับจริง"** — มี idempotency พื้นฐานที่ webhook แล้ว (เช็ค status ก่อน credit ซ้ำ) แต่ยังไม่มี retry policy ที่เป็นระบบ (เช่น exponential backoff/queue)
- [ ] ระบุ **deploy spec** ให้ชัดเจน (จำนวน instance, CPU/RAM ต่อ instance, restart/autoscaling policy) — ยังไม่มีเอกสาร

## 4. การประเมิน/ทดสอบโหลด (Capacity Planning & Load Test)

### 4.1 ข้อมูลตั้งต้นที่ต้องรู้
- จำนวนผู้ใช้แต่ละกลุ่ม: **นักเรียน / สต๊าฟ / ผู้ปกครอง**
- จำนวน request ต่อคนต่อมื้อ:
  - เด็กกินข้าวเช้า: อย่างน้อย 2 req (ข้าว + น้ำ) + ขนม 1 req รวม ~3 req
  - มื้อกลางวัน: เด็กจำนวนมากลงพักพร้อมกัน (สมมติ 2,000 คน) — ต้องเช็คว่าลงพร้อมกันจริงหรือแบ่งรอบ
- เวลาที่แต่ละคนใช้ต่อ transaction (จับเวลาจริงหน้างาน)
- ช่วงเวลาที่เกิด **peak/normal spike** (เช่น ตอนพักเที่ยง)
- Capacity ทางกายภาพอ้างอิง: โรงเรียนรัฐ/เอกชนทั่วไปรองรับพักพร้อมกันได้ ~800–1,200 คน (ไม่มีพื้นที่รองรับทุกคนพร้อมกัน)

### 4.2 ตัวอย่าง setup ที่ต้องคำนวณโหลดต่อเครื่อง
- สมมติ 15 ร้าน → POS 15 เครื่อง (แบ่ง ม.ต้น / ม.ปลาย)
- เด็ก ~800 req กระจายลงกี่เครื่อง → คำนวณโหลดเฉลี่ยต่อเครื่อง POS 1 เครื่อง
- เข้าใจ flow ว่าแต่ละ request (1 การสั่งซื้อ/1 การสแกนบัตร) ทำงานผ่าน service อะไรบ้าง

### 4.3 Load test scenarios
- Baseline: 300 req/นาที
- ทดสอบที่ระดับ **1x, 2x, 5x, 6x** ของ baseline
- เก็บ **timer log**: 1 request ใช้เวลากี่วินาที (p50/p95/p99) — เป็นข้อมูลป้อนให้ทีม/AI ประเมิน capacity เพิ่มเติม

## 5. Incident Response

- [ ] เมื่อเกิดเหตุ ต้องหาได้ว่า **user ไหน**, **start date / end date** ของช่วงที่มีปัญหา
- [ ] จัดทำ **Incident Report** ตอบ 3 คำถามเสมอ:
  1. ทำไมระบบล่ม (root cause)
  2. แก้ปัญหาอย่างไร (remediation)
  3. มี preventive measure ป้องกันไม่ให้เกิดซ้ำหรือไม่
- [ ] ทำ report เป็น **HTML พร้อมกราฟ** เพื่อใช้คุยกับทีม support/ภายนอกได้ง่าย อ่านเข้าใจเร็ว

## 6. Logging & Observability

- [ ] ประเมินว่า logging ปัจจุบัน (in-system + file) **เพียงพอหรือไม่** ต่อการ debug/ตรวจสอบ incident
- [ ] เขียน **test case** ให้ครอบคลุม flow สำคัญ (เติมเงิน, หักเงิน, เชื่อม hardware)
- [ ] ทำระบบ **Track/Monitor performance** ไว้ย้อนดูเมื่อเกิดเหตุการณ์ผิดปกติ หรือใช้ดู performance ปกติ
- [ ] Log ต้องมี **stack trace + error code** ในระดับ API ที่ระบบเราเรียกใช้ (รวมถึง 3rd-party API ที่ไปเรียก)

---

## 7. ลำดับที่ควรเริ่มทำ (Priority)

เกณฑ์จัดลำดับ: อะไรที่ **ยังไม่มีเลย + เสี่ยงทำระบบล่มทั้งระบบ** มาก่อน อะไรที่ **มีฐานอยู่แล้วแค่ต้องต่อยอด** มาทีหลัง

**P0 — ทำก่อนสุด (ช่องโหว่จริง ยังไม่มีการป้องกันเลย)**
1. เพิ่ม `process.on('uncaughtException'/'unhandledRejection')` guard ใน `server.ts` — ตอนนี้ error จุดเดียวฆ่าทั้ง process ได้ กระทบทุกร้าน/ทุกเครื่อง POS พร้อมกัน
2. เขียน automated test สำหรับ wallet/topup/pos-checkout รวมเคส concurrent request — ตอนนี้ `tests/` ไม่มี test เงินเลยแม้แต่ไฟล์เดียว ทั้งที่ logic (increment+lock) ถูกต้องแล้วแต่ไม่มีอะไรกันการ regression ตอนแก้โค้ดครั้งต่อไป
3. เขียน deploy spec เป็นเอกสาร (instance/CPU/RAM/restart policy) — จำเป็นก่อนคุยกับทีม infra/support

**P1 — เตรียม capacity/load test (ต้องมีข้อมูลก่อนถึงจะทดสอบได้จริง)**
4. เก็บจำนวน user จริง (นักเรียน/สต๊าฟ/ผู้ปกครอง) + เวลาต่อ transaction จากหน้างาน
5. สร้าง load test script (k6/autocannon — ยังไม่มีในโปรเจกต์) ยิงที่ 300 req/min (ตรงกับ rate limit ที่ตั้งไว้จริงแล้ว) แล้วขยับเป็น 1x/2x/5x/6x
6. เพิ่ม CPU/Memory metric endpoint เพื่อดูผลตอนรัน load test (ไม่งั้นรู้แค่ response time แต่ไม่รู้ว่า resource ใกล้เต็มหรือยัง)

**P2 — VA scan / SQLi / SLA formalize**
7. รัน VA scan + SQLi scan อย่างเป็นทางการเพื่อ "ยืนยัน" สิ่งที่โครงสร้างโค้ดทำถูกอยู่แล้ว
8. ตั้งเกณฑ์ SLA 1 วิ ให้เป็น automated check (เช่น alert ถ้า p95 > 1s) ต่อยอดจาก timing log ที่มีอยู่

**P3 — Incident readiness / observability (ต่อยอดจากของเดิม ไม่เร่งเท่า P0-P2)**
9. ทำ retry policy ที่เป็นระบบสำหรับ outbound request (ต่อยอดจาก idempotency ที่มีอยู่แล้วในหมวด webhook)
10. ทำ HTML incident report template + graph
11. พิจารณาต่อ log ปัจจุบัน (winston + file) เข้า dashboard กลาง ถ้าทีมเริ่มเจอ incident บ่อยจนอ่าน log ไฟล์ไม่ทัน

---

## หมายเหตุ

เอกสารนี้เป็นสรุป requirement/checklist จากการระดมความคิด (brainstorm) ผสานกับผลตรวจโค้ดจริง — ยังไม่ใช่ implementation plan รายละเอียดของแต่ละ task แต่ละหัวข้อใน P0-P1 ควรถูกแตกเป็น task/spec แยกก่อนเริ่มลงมือทำจริง
