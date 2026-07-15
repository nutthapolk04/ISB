# UAT Issues — รอบทดสอบ 2026-07-14 / 2026-07-15

รวบรวม feedback จากรอบ UAT (14–15 ก.ค. 2569) เพื่อ track สถานะและวางแผนแก้ไข
เอกสารนี้เป็น living doc — จะอัปเดตสถานะ/แผนแก้ต่อเนื่องหลังวิเคราะห์ละเอียดแต่ละเคส

> หมายเหตุ: คอลัมน์ "จุดที่น่าจะเกี่ยวในโค้ด" มาจากการอ่านโค้ดจริงใน `backend-bun/src`
> (read-only, ยังไม่ได้แก้โค้ด) — อ้างอิง file:line ที่เจอระหว่างการวิเคราะห์ Task B (504)
> และการไล่โค้ดคร่าว ๆ ของ endpoint ที่เกี่ยวข้องกับเคสอื่น ยังไม่ได้ debug ลึกเท่า sync bottleneck

## ตารางสรุป

| # | เรื่อง | อาการ | ระดับ | จุดที่น่าจะเกี่ยวในโค้ด | สถานะ | แผนแก้ (เบื้องต้น) |
|---|--------|-------|-------|--------------------------|--------|----------------------|
| 1 | QR code callback ช้า | ช้ามาก ต้องแก้ไขใหม่ | สูง | `backend-bun/src/services/pos_qr_service.ts` (flow confirm 3 phase: A/B/C, บรรทัด ~174-286), `backend-bun/src/controllers/BayCallbackController.ts`, `backend-bun/src/services/pymt_gateway.ts` — payment_intents + BAY webhook | กำลังรอเช็ค/ต้องแก้ | ต้อง trace latency จริงจาก webhook ถึง flip status (phase C) ก่อน สงสัย polling interval ฝั่ง frontend หรือ webhook delay จาก gateway เอง — ยังไม่ได้วัด ต้องเก็บ log เวลาเพิ่ม |
| 2 | Sheet Spending Limit Clean Data | เสร็จแล้ว | เสร็จ | — | เสร็จแล้ว ✅ | ไม่มี (แจ้งสถานะเฉยๆ) |
| 3 | ยิง request ซ้ำแล้ว error เดิม ข้อมูลเข้าไม่ครบ | Retry แล้วยัง fail แบบเดิม | ต้องแก้ | `backend-bun/src/services/powerschool_sync.ts` — unique-collision fallback บน `email`/`username`/`cardUid` (บรรทัด 203-220, 279-288, 392-398) อาจเป็นสาเหตุที่ retry แล้วยัง error ซ้ำ (ข้อมูลที่ conflict ไม่เปลี่ยนระหว่าง retry); ดู error log ผ่าน `GET /admin/sync-logs/:id` และ `GET /admin/sync-audit/:syncLogId` (`backend-bun/src/routes.ts:323-325`, `SyncController.ts`) | ต้องแก้ | ต้องดึง `errorLog`/`sync_audit_logs` ของรอบที่ error จริงมาดูตัวข้อความ error แบบเจาะจงราย record ก่อนสรุปสาเหตุ |
| 4 | Redirect บัตรเครดิต | รอทดสอบ | รอเทสต์ | `backend-bun/src/services/pymt_gateway.ts`, `backend-bun/src/services/topup_service.ts` (credit_card path) | รอเทสต์ | ทีมจะอัปเดทหลัง test |
| 5 | Swap Parent ทุกเคสไม่เวิร์ค | Parent→Parent, Parent→Staff, Staff→Parent, Student(Old)→Student(New) — **orphan ยังผูก relation ค้างใน family** (ดูรายละเอียดใต้ตาราง) | ต้องแก้ | `backend-bun/src/services/powerschool_sync.ts::reconcileParentLinks` (บรรทัด 507-519), `::upsertLink` (479-497), `::upsertParent`/`::upsertStaffParentRef` (276-376); เรียกจาก `backend-bun/src/services/isb_sync_service.ts::processFamilyBatch` (บรรทัด 258-261) | ไม่เวิร์ค ต้องแก้ | ต้องรัน 6 scenario (s1-s6) ทีละเคสพร้อมเปิด sync_audit_logs ดูว่า `reconcileParentLinks` ลบ link เก่าถูกคนไหม โดยเฉพาะ s4/s5 (Parent↔Staff สลับ entity type ใช้ upsert function คนละตัว) และ s6 (orphan resurrection) — ยังไม่ได้ debug เจาะเคส |
| 6 | Top up บัตรเครดิตไม่ work แต่ตัดเงินแล้ว | เงินลูกค้าหาย ต้อง reconcile ด่วน | วิกฤต 🔴 | `backend-bun/src/services/topup_service.ts::handleBayCallback` บรรทัด 491-516 — ดูจุดเสี่ยง 2 จุด: (a) บรรทัด 508-510 `confirmerId = creatorRows[0]?.createdBy ?? null; if (confirmerId !== null) confirmTopup(...)` — ถ้า `confirmerId` เป็น null (intent ไม่มี `createdBy` หรือ query ไม่เจอ) โค้ด**ข้ามการเครดิตวอลเล็ตไปเงียบๆ** ทั้งที่ `body.status === "COMPLETED"` (เงินถูกตัดจากบัตรแล้วโดย gateway); (b) บรรทัด 512-515 `catch { // swallow — webhook retries }` — ถ้า `confirmTopup()` throw จะถูกกลืน error แบบไม่มี `logger.error` เลย ทีมจะไม่เห็นใน log ด้วยซ้ำ, และไม่มี job/endpoint reconcile อัตโนมัติใดๆ (grep ไม่พบ `reconcile`/cron ใน `topup_service.ts`, `pymt_gateway.ts`) | **✅ Hotfix แล้ว 15 ก.ค.** (รอ commit) — reconciliation กำลังทำ | ดูหัวข้อ "บันทึกการแก้ไข" ด้านล่าง |
| 7 | Family sync ไป UAT โดน 504 Gateway Time-out ที่ batch 2/3 | Retry ครบ 3 ครั้งแล้ว abort, batch size 500, รวม 1211 records, ลำดับ Staff→Families→Department | ต้องแก้ | ดูหัวข้อ "ผลวิเคราะห์ 504 (Task B)" ด้านล่าง — หลักคือ `backend-bun/src/services/isb_sync_service.ts::processFamilyBatch` (195-269) + `backend-bun/src/services/powerschool_sync.ts` (upsert chain) | ต้องแก้ | ดูหัวข้อผลวิเคราะห์ด้านล่าง (ranked fix list) |

---

## บันทึกการแก้ไข (Changelog)

### 2026-07-15 — Phase 1 Hotfix: #6 Top-up ตัดเงินแต่ไม่เข้า ✅ (แก้เสร็จ, ยังไม่ commit)

**ไฟล์:** `backend-bun/src/services/topup_service.ts` (+99/-18) + เทสต์ใหม่ `backend-bun/tests/bay_callback_topup.test.ts`

**แก้อย่างไร (4 จุด):**
1. **เลิกข้ามการเครดิตเมื่อ `createdBy` เป็น null** — จากเดิม `if (confirmerId !== null)` ทำให้ skip เงียบๆ → ตอนนี้ fallback เป็น system user `payment_gateway_service` ผ่าน `getOrCreatePaymentGatewayServiceUser()` (ตาม convention `getOrCreateVendorApiServiceUser` ที่มีอยู่แล้วใน `wallet_service.ts`; user เป็น inactive + random password, login ไม่ได้; ไม่ต้องแก้ schema เพราะ `wallet_transactions.created_by` เป็น NOT NULL FK) — แก้ทั้ง webhook (`handleBayCallback`) และปุ่ม "Check again" (`inquireTopupFromGateway`) ที่มีบั๊กเดียวกัน
2. **เลิกกลืน error** — ทุก catch ใส่ `logger.error` (refCode/txnNo/amount/confirmerId) แล้ว rethrow → global handler ตอบ 500 → gateway retry webhook อัตโนมัติ
3. **Idempotency ชัดเจน** — ของเดิมมี `SELECT ... FOR UPDATE` + เช็ค `status='pending'` กัน double-credit อยู่แล้ว แต่แยก "duplicate" กับ "error จริง" ไม่ได้ → ติด `err.code = "ALREADY_PROCESSED"` ให้เคส duplicate → ตอบ 200 ไม่ retry วนไม่รู้จบ
4. **Happy-path log** — `logger.info` ทุกครั้งที่เครดิตสำเร็จ (refCode, walletId, amount, confirmerId)

**ผลเทสต์:** เทสต์ใหม่ 4/4 ผ่าน (null createdBy → เครดิตจริง / callback ซ้ำ → เครดิตครั้งเดียว / ยิง concurrent → ครั้งเดียว / confirmTopup throw → log + rollback ถูกต้อง) — ทั้ง suite 39 ผ่าน, 3 fail เป็นของเดิมก่อนแก้ (wallet_concurrency, shop_products) ไม่เกี่ยวรอบนี้

### 2026-07-15 — Phase 1b: Reconciliation + Damage Assessment ✅ (แก้เสร็จ, ยังไม่ commit)

**สิ่งที่สร้าง:**
1. **`reconcilePendingTopups()`** (`topup_service.ts` +~150 บรรทัด) — สแกน top-up intent ที่ pending เกิน 15 นาที (แยก POS ด้วย `intent_type`) → inquire BAY ทีละรายการ (delay 300ms) → COMPLETED เครดิตผ่าน `confirmTopup` เดิม (idempotent) / FAILED→cancelled (transition เดิม) / ยัง pending ไม่แตะ → คืนสรุป scanned/credited/failed/skipped พร้อมชื่อเจ้าของ wallet
2. **`POST /api/v1/admin/topups/reconcile`** (admin only) — `{older_than_minutes?, limit?, dry_run?}` โดย **dry_run default = true** → การเรียกครั้งแรกคือ damage assessment ไม่แตะเงิน
3. **Scheduler** `topup_reconcile_scheduler.ts` — ตาม pattern `low_balance_scheduler` เดิม รันทุก 10 นาที (dryRun=false) wire เข้า `app.ts` แล้ว

**วิธีใช้ประเมินความเสียหายบน UAT/prod:**
```bash
# ดูก่อน ไม่แตะเงิน
curl -X POST <api>/api/v1/admin/topups/reconcile -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" -d '{"dry_run": true, "limit": 100}'
# กู้เงินจริง
... -d '{"dry_run": false, "limit": 100}'
```

**ผลเทสต์:** เทสต์ใหม่ 5 เคส + hotfix 4 เคส = **9/9 ผ่าน** (ยืนยันซ้ำโดยตัวคุม) — ระหว่างเทสต์ sweep เจอ intent ค้างจริงใน local DB (`TOP-20260715-001-a8d0` ฿100) และกู้ให้อัตโนมัติ = พิสูจน์ว่าทำงานจริง

**ไฟล์ (รวม Phase 1 ทั้งหมด, ยังไม่ commit):** `topup_service.ts` (+306/-19), `TopupController.ts`, `topup.schema.ts`, `routes.ts`, `app.ts`, ใหม่: `topup_reconcile_scheduler.ts`, `tests/bay_callback_topup.test.ts`, `tests/topup_reconcile.test.ts`

### 2026-07-15 — Phase 2: #5 Swap Parent (orphan ยังผูกค้าง) ✅ (แก้เสร็จ, ยังไม่ commit)

**Root cause จริง (ไม่ตรงกับสมมติฐานทุกข้อ):** `reconcileParentLinks()` ลบแถวใน `parent_child_links` **ถูกต้องอยู่แล้ว** — บั๊กจริงอยู่คนละชั้น:
1. คอลัมน์ `users.family_code` **ไม่เคยถูกเคลียร์**ตอนหลุดจาก family — แต่ `myCoparents` (`family_service.ts:130-143`), `userCanAccessWallet` (`wallet_service.ts:218-220`) และ family check ของ transfer (`wallet_service.ts:865-877`) เช็คจาก `family_code` ไม่ใช่จาก link table → orphan เลย "ยังอยู่ใน family" ในทุกจุดที่ผู้ใช้มองเห็น
2. เคส s3 (student swap): ไม่มีโค้ดจัดการนักเรียนที่หลุดจาก roster เลย (reconcile มีแต่ฝั่ง parent)

**การแก้:** (`powerschool_sync.ts` +78/-3, `isb_sync_service.ts` +7)
- หลังลบ link → เช็คว่า parent เหลือ link อื่นทั้งระบบไหม ถ้าไม่เหลือ → เคลียร์ `users.family_code = null` (ใช้ logic เดียวกับ `family_service::deleteLink` ที่มีอยู่แล้ว)
- เพิ่ม `reconcileFamilyStudents()` จัดการนักเรียนที่ถูกสลับออก (s3) ด้วยหลักการเดียวกัน

**ผลเทสต์:** `tests/family_swap_reconcile.test.ts` ยิงผ่าน `POST /api/v1/sync/families` จริง — ก่อนแก้ fail ตรงกับรายงาน UAT เป๊ะ (s1,s2,s4,s6 ติดที่ family_code / s3 ติดที่ link / s5 control ผ่าน) → หลังแก้ **6/6 ผ่าน** และ suite เดิมไม่พัง (50 pass / 3 fail เดิมที่ไม่เกี่ยว)

**Admin transfer (เรื่องที่ทีมบอกว่าโอนให้คนใหม่ไม่ได้):** ตรวจแล้ว **backend ไม่ block admin ข้าม family อยู่แล้ว** (`transferWithinFamily` ข้าม family check เมื่อเป็น admin โดยตั้งใจ + หน้า WalletTransfer มีช่องค้นหา recipient อิสระ) — ที่ทีมโอนไม่ได้เพราะบั๊ก family_code ข้อ 1 ทำให้ระบบมอง orphan ผิดตัว พอแก้แล้ว flow admin โอน orphan→คนใหม่ควรใช้ได้เลย ให้ทีม retest ยืนยัน

### 2026-07-15 — Phase 3: #7 Sync 504 ✅ (แก้เสร็จ, ยังไม่ commit)

**ผล Benchmark จริง (localhost, synthetic 500 families):**

| | ก่อนแก้ (ประมาณ) | หลังแก้ (วัดจริง) |
|---|---|---|
| Cold (ใหม่ทั้งหมด 500) | ~45-65s (ชน 504) | **8.15s** ✅ |
| Warm (resync 500) | — | **0.88s** ✅ |

**เทคนิคที่ใช้:** (`isb_sync_service.ts` +149, `powerschool_sync.ts` +233)
1. **Bulk prefetch** (`buildFamilyBatchCtx`) — รวบ id/email/studentCode ทั้ง batch ยิง `WHERE IN (...)` ~7 queries แล้วให้ทุก upsert อ่านจาก Map แทน SELECT ต่อ record (ctx เป็น optional param — เส้นทางเดิมที่ไม่ส่ง ctx ทำงานเหมือนเดิม backward-compatible)
2. **bcrypt ออกจาก hot path** — precompute hash ทั้งหมดด้วย `Promise.all` ก่อนเข้า loop
3. **ลด bcrypt cost 12→10 เฉพาะ placeholder account ที่ sync สร้าง** (รหัสคงที่ "parent" ไม่ใช่รหัสผู้ใช้ตั้งเอง; cost 10 = ค่าเดียวกับ AuthUtils ใช้อยู่แล้ว; ยัง random salt ต่อบัญชี) — รหัสผ่านจริงของ user ไม่แตะ ยัง cost เดิม / ตัวแปร `PLACEHOLDER_ACCOUNT_BCRYPT_COST` ปรับได้จุดเดียว
4. `syncLoginEmails` เปลี่ยน loop → `Promise.all`
5. **Timing log ถาวรต่อ batch** (families, success, failed, totalMs, prefetchMs, upsertMs) — ใช้มอนิเตอร์บน production
- **ไม่แตะ** แกน Phase 2 (`reconcileParentLinks` / `reconcileFamilyStudents` / family_code clearing) เรียกจุดเดิมลำดับเดิมทุกประการ

**เทสต์:** s1-s6 (6/6) + topup (9/9) ผ่านครบ, full suite 50 pass / 3 fail เดิม (ไม่มี fail ใหม่), `tsc --noEmit` สะอาด

**คำแนะนำทีม:**
- **คง stopgap ไว้ก่อน** (batch 100-150 + nginx timeout 120s) — 8.15s บน localhost ยังไม่รวม network latency ของ DB จริง ให้ดู timing log บน UAT 2-3 รอบก่อนถอด stopgap
- `processStaffBatch`/`processDepartmentBatch` ยังเป็น pattern เก่า (per-record SELECT + bcrypt cost 12) — ควรทำแบบเดียวกันเป็นรอบถัดไป
- #3 (retry error เดิม) ยังต้องดึง sync error log จริงจาก UAT มาจำแนกก่อน — รอข้อมูลจากทีม

### 2026-07-15 — Phase 4: #1 QR callback ช้า ✅ (instrument เสร็จ — รอ log จริงจาก UAT เพื่อฟันธง)

**สิ่งที่พบจากโค้ด:**
- Frontend poll ทุก **2 วินาที** อยู่แล้ว (+ inquiry sync กับ BAY ทุก ~6 วิ เผื่อ webhook หลุด) — **ไม่ใช่ตัวการ** "ช้ามาก" (worst-case จาก poll แค่ ~2s) จึงไม่แก้
- Index ที่จำเป็น (`ref_code`, `txn_no`) มีครบแล้ว — ไม่ต้องเพิ่ม migration
- **ผู้ต้องสงสัยหลัก: `checkout()` (phase B ของ confirm)** — ทำ DB round-trip ต่อรายการสินค้าในตะกร้าแบบ sequential ใน transaction เดียว (ตะกร้าใหญ่ = ช้าเป็นเส้นตรง) — เป็น core financial logic ใช้ร่วมทุกช่องทางขาย จึง**ไม่แตะจนกว่า log จะยืนยัน**
- Webhook payload ของ BAY **ไม่มี timestamp ฝั่ง gateway** — delay ฝั่งธนาคารวัดตรงๆ ไม่ได้ (ตรวจจาก contract doc แล้ว)

**Instrument ที่ใส่ (3 ไฟล์, +107 บรรทัด):** timing log ใน `BayCallbackController` (totalHandlerMs), `confirmPosQrSale` (phaseA/B/C ms แยกกัน), status-poll endpoint (durationMs)

**วิธีฟันธงหลัง deploy:** ถ้า `phaseBMs` > 80% ของ `totalHandlerMs` → คอขวดคือ checkout() → ค่อยวางแผน optimize (แนว bulk เดียวกับ Phase 3); ถ้า handler เร็วแต่ผู้ใช้ยังรู้สึกช้า → delay อยู่ฝั่ง BAY ก่อน webhook มาถึง (แก้ฝั่งเราไม่ได้ ต้องคุยกับ gateway)

**เทสต์:** `tsc --noEmit` ผ่าน, เทสต์ callback เดิมผ่าน, ไม่แตะไฟล์ Phase 1-3

---

## แผนการแก้ไข (จัดลำดับแล้ว — 2026-07-15)

ลำดับความสำคัญ: **Phase 1 (#6 เงินหาย) → Phase 2 (#5 swap parent) → Phase 3 (#7 sync 504 + #3 retry error) → Phase 4 (#1 QR ช้า)** — ทำทีละ phase, commit แยกเรื่อง, ทดสอบบน UAT ก่อนขยับ phase ถัดไป

### Phase 1 — 🔴 #6 Top-up ตัดเงินแต่ไม่เข้า wallet (ด่วนสุด — เริ่มทันที)

เป้าหมาย: หยุดเงินหายเพิ่ม → กู้เงินที่หายไปแล้ว → กันเกิดซ้ำ

1. **Hotfix `handleBayCallback`** (`topup_service.ts:491-516`):
   - เคส `confirmerId === null`: ห้ามข้ามการเครดิต — ถ้า gateway แจ้ง COMPLETED ต้องเครดิต wallet เสมอ (fallback เป็น system-actor id สำหรับ audit trail แทนการ skip)
   - ใส่ `logger.error` ในทุก catch (เลิกกลืน error เงียบ) + ตอบ 5xx กลับ gateway เมื่อเครดิตไม่สำเร็จ เพื่อให้ webhook ฝั่ง BAY retry (ตรวจ semantics ของ PYMT ก่อนว่า retry เมื่อไหร่)
   - ทำ `confirmTopup()` ให้ idempotent (กัน webhook ยิงซ้ำแล้วเครดิตซ้ำ)
2. **ประเมินความเสียหาย**: query `payment_intents` ที่ `status='pending'` ค้าง แล้ว inquire gateway ทีละตัวผ่าน `inquireTopupFromGateway` (`topup_service.ts:305`) — ได้ลิสต์รายการที่ตัดเงินแล้วแต่ไม่เข้า
3. **Reconciliation job**: endpoint admin + cron กวาด intent ค้าง >N นาที → inquire → เครดิตย้อนหลัง (idempotent) — รัน manual บน UAT ก่อน ค่อยตั้ง schedule
4. **Test**: unit test เคส createdBy=null, เคส callback ซ้ำ 2 ครั้ง, เคส confirmTopup throw

### Phase 2 — #5 Swap Parent: orphan ยังผูก relation

1. **Reproduce s1 ก่อน** (เคสเรียบง่ายสุด: 86012→85012) บน local ด้วย payload จริงจากทีม sync
2. **Debug `reconcileParentLinks()`** (`powerschool_sync.ts:507-519`) — สมมติฐานเรียงตามความน่าจะเป็น:
   (a) เงื่อนไข DELETE เทียบ id คนละชนิด (externalId vs internal customer id) ทำให้ไม่ match อะไรเลย
   (b) keepIds สร้างจาก parent ชุดใหม่ไม่ครบ/ผิดตำแหน่ง หรือถูกเรียกก่อน `upsertLink` ของคนใหม่
   (c) เคสข้าม entity type (s4/s5 Parent↔Staff) ใช้ upsert คนละฟังก์ชัน (`upsertParent` vs `upsertStaffParentRef`) — reconcile อาจกวาดไม่ครอบทั้งสองชนิด
3. **เช็คฝั่ง admin transfer** ด้วย: หลัง unlink ถูกต้องแล้ว admin ต้อง transfer wallet parent เก่า (orphan) → parent/staff ใหม่ได้ — ตรวจ validation ของ transfer endpoint ว่า block ข้าม family หรือไม่ ถ้า block ต้องเปิดทางให้ role admin
4. **Test ครบ s1-s6** + บันทึกผลลง sheet ของทีม

### Phase 3 — #7 Sync 504 (+ #3 retry error เดิม)

1. **Stopgap ทันที (ไม่แตะโค้ด)**: แจ้งทีมยิง sync ลด batch size 500 → **100-150** + ประสาน infra ขยับ nginx `proxy_read_timeout` UAT เป็น 120s ชั่วคราว → ปลด block การ retest รอบถัดไป
2. **แก้จริงใน `processFamilyBatch` + upsert chain**: bulk prefetch (SELECT ... IN (...) ครั้งเดียวต่อตารางต่อ batch) → diff ในหน่วยความจำ → bulk `INSERT ... ON CONFLICT DO UPDATE` ด้วย drizzle → ครอบ transaction ต่อ chunk — เป้าหมาย: batch 500 จบใน <10s (จาก ~45-65s)
3. **ย้าย bcrypt ออกจาก hot path**: hash เฉพาะ user ใหม่จริง และพิจารณาลด cost / ทำ lazy (ตั้ง placeholder แล้วให้ระบบ reset password ตอน first login)
4. **#3 (retry แล้ว error เดิม)**: ดึง `errorLog` + `sync_audit_logs` ของรอบที่พัง (ผ่าน `GET /admin/sync-logs/:id`) มาจำแนก error ราย record — คาดว่าเป็น unique collision (`email`/`username`/`cardUid`) ซึ่ง retry ยังไงก็ชนซ้ำ → แก้ logic collision fallback ใน `powerschool_sync.ts:203-220, 279-288, 392-398`
5. เพิ่ม timing log ต่อ phase ใน sync service เพื่อวัดผลก่อน/หลัง

### Phase 4 — #1 QR callback ช้า

1. **วัดก่อนแก้**: ใส่ timestamp log 3 จุด — webhook เข้าที่ `BayCallbackController`, จบ phase A/B/C ใน `pos_qr_service.ts`, และเทียบ timestamp ฝั่ง gateway — หา segment ที่กินเวลา
2. เช็ค polling interval ฝั่ง frontend (ถ้า UI รอ poll ไม่ใช่ push อาจช้าที่นี่ ไม่ใช่ backend)
3. แก้ตามผลวัด (ปรับ interval / index query / ย้ายเป็น push ผ่าน WS ในระยะยาว)

### รอข้อมูลทีม (ไม่มี action ตอนนี้)
- #4 redirect บัตรเครดิต — รอทีม test แล้วอัพเดท
- #2 Spending Limit Clean Data — เสร็จแล้ว ✅

---

## รายละเอียดเพิ่มเติม Issue #5 — Swap Parent (จากทีมทดสอบ 15 ก.ค.)

**อาการจริงที่พบ:** หลัง sync swap แล้ว parent เก่าที่**ควรหลุดเป็น orphan** ยังถูกผูก relation อยู่ใน family เดิม

**Expected:** หลัง sync relation ใหม่ → admin ต้อง transfer เงินหลังบ้านได้ จาก wallet ของ parent/staff **คนเก่า** (ที่ถูกเปลี่ยนออก) → ไป wallet ของ parent/staff **คนใหม่** — ตอนนี้**ทำไม่ได้**

**Actual (BUG):** ใน family นั้นๆ ระบบยังมองเห็น parent ที่ควรเป็น orphan ผูกอยู่กับ family → ทำให้ transfer "กันเองภายใน family" ได้ (ผิดทิศ: เงินวิ่งระหว่างสมาชิกที่ไม่ควรอยู่ใน family แล้ว แทนที่จะ transfer ข้ามไปหาคนใหม่ได้)

**ชี้เป้าโค้ด:** `reconcileParentLinks()` (`powerschool_sync.ts:507-519`) มีหน้าที่ DELETE link เก่าที่ไม่อยู่ในชุด parent ปัจจุบัน — จาก scenario ที่ fail ทุกเคสที่มี orphan (s1-s4, s6) แต่ s5 (control ไม่มี orphan) ผ่าน แปลว่าจุด unlink นี้ไม่ทำงานตามคาด (เงื่อนไข WHERE ไม่ครอบ / ถูกเรียกก่อน upsertLink ของคนใหม่ / id ที่ใช้เทียบเป็นคนละชนิด externalId vs internal id) — ต้อง debug ด้วย s1 เป็นเคสแรกเพราะเรียบง่ายสุด

---

## ผลวิเคราะห์ 504 (Task B)

### สรุปสั้น (TL;DR)

**Root cause ไม่ใช่เครื่องแรงไม่พอ (ไม่ใช่ CPU/scale ล้วนๆ) แต่เป็น N+1 query pattern + งาน CPU-bound (bcrypt cost=12) ที่ทำแบบ per-record บวกกับ concurrency ที่ถูก cap ไว้ที่ 10 โดย DB pool** — endpoint `/api/v1/sync/families` เดิน query ~25-35 round-trip ต่อ 1 family record (ไม่มี bulk insert, ไม่มี transaction เดียวครอบทั้ง batch) แล้วรันแบบ concurrency 10 เท่านั้น (`SYNC_CONCURRENCY = 10` ผูกกับ postgres pool `max: 10`) ทำให้ 500 records ต้องรันเป็น ~50 รอบสลับกัน ตัวเลขนี้ชนขอบ nginx `proxy_read_timeout` (60s default) พอดี — **ขยายเครื่อง (CPU/RAM) เพียงอย่างเดียวช่วยได้จำกัดมาก เพราะคอขวดหลักคือจำนวน round-trip ต่อ record (I/O-bound) ไม่ใช่ CPU ไม่พอ** ยกเว้นส่วน bcrypt ที่เป็น CPU-bound จริง แต่แก้ด้วยการลด cost/ย้ายออกจาก per-record loop คุ้มกว่าขยายเครื่องมาก

### Route → Service mapping

- `POST /api/v1/sync/staffs` → `IsbSyncController.staffs` (`backend-bun/src/controllers/IsbSyncController.ts:27-49`) → `processStaffBatch()` (`backend-bun/src/services/isb_sync_service.ts:113-152`)
- `POST /api/v1/sync/families` → `IsbSyncController.families` (`IsbSyncController.ts:51-73`) → `processFamilyBatch()` (`isb_sync_service.ts:186-273`)
- `POST /api/v1/sync/departments` → `IsbSyncController.departments` (`IsbSyncController.ts:75-97`) → `processDepartmentBatch()` (`isb_sync_service.ts:285-326`)

ทั้ง 3 endpoint ประกาศไว้ใน `backend-bun/src/routes.ts:79-82` เป็น public plugin (`x-api-key` เท่านั้น ไม่มี JWT) และไม่มีการ enqueue เป็น background job — ทำงาน synchronous ภายใน request/response cycle เดียวกับที่ nginx proxy เฝ้าอยู่ ดังนั้น request จะค้างจนกว่า batch ทั้งหมดจะเสร็จ (หรือ nginx ตัดที่ 60s)

### หลักฐาน: นับ query ต่อ 1 family record

โค้ด per-family อยู่ที่ `isb_sync_service.ts:195-269` (`processInChunks(families, ...)`) เดินตามลำดับนี้ **แบบ sequential await ภายใน record เดียว** (ไม่มี parallel ภายใน record — parallel มีแค่ข้าม record ผ่าน `processInChunks`):

1. `upsertFamilyProfile()` (`powerschool_sync.ts:464-477`): 1 SELECT + 1 INSERT/UPDATE = **2 queries**
2. ต่อ parent 1 คน (main + secondary ได้สูงสุด 2 คน):
   - `upsertParent()` (`powerschool_sync.ts:276-334`): สูงสุด 2 SELECT (externalId แล้ว email) + 1 INSERT/UPDATE + 1 INSERT audit (`emitAudit`, บรรทัด 143-151) + ≥1 INSERT `syncLoginEmails` (บรรทัด 190-198, loop ทีละ email) ≈ **5 queries**
     หรือ `upsertStaffParentRef()` (`powerschool_sync.ts:336-376`) กรณี parent เป็น Staff: 1 SELECT + 1 INSERT/UPDATE + 1 INSERT audit + syncLoginEmails ≈ **3-4 queries**
   - photo override ที่ `isb_sync_service.ts:232-235`: +1 UPDATE ถ้ารูปเปลี่ยน
   - รวม 2 parents ≈ **8-12 queries**
3. ต่อ student 1 คน (`isb_sync_service.ts:241-261`):
   - `upsertStudent()` (`powerschool_sync.ts:387-462`): สูงสุด 2 SELECT (externalId, studentCode) + 1 INSERT customer (+1 INSERT wallet ถ้าใหม่) หรือ 1 UPDATE + 1 INSERT audit + 1 SELECT `studentUser` (บรรทัด 445) + (ถ้ายังไม่มี) 1 INSERT user ≈ **5-7 queries**
   - photo override: +1 UPDATE ถ้าเปลี่ยน
   - ต่อ parent ที่ผูก (สูงสุด 2): `upsertLink()` (`powerschool_sync.ts:479-497`) = 1 SELECT + 1 INSERT/UPDATE = 2 queries × 2 parents = **4 queries**
   - `reconcileParentLinks()` (`powerschool_sync.ts:507-519`): 1 DELETE = **1 query**
   - รวมต่อ student ≈ **10-12 queries**; ถ้าครอบครัวมี 2 students ≈ **20-24 queries**

**รวมต่อ 1 family record ≈ 30-38 database round-trips** ไม่มี query ไหนถูก batch เป็น bulk insert (`onConflictDoUpdate` มีใช้แค่จุดเดียวคือ `userLoginEmails` ที่ `powerschool_sync.ts:196` และเป็น per-email ไม่ใช่ per-batch) และ**ไม่มี `db.transaction()`/`pgClient.begin()` ครอบ per-record หรือ per-batch เลย** (grep ทั้ง `isb_sync_service.ts` และ `powerschool_sync.ts` ไม่เจอ) — แปลว่าทุก query เป็น autocommit statement แยกกัน ยิ่งเพิ่ม round-trip overhead

**คำนวณเวลา:** concurrency ถูกจำกัดที่ `SYNC_CONCURRENCY = 10` (`isb_sync_service.ts:101`, คอมเมนต์บอกตรงๆ ว่าตั้งให้เท่ากับ DB pool `max: 10` ใน `backend-bun/src/db/client.ts:9`) ผ่าน `processInChunks()` (`isb_sync_service.ts:103-111) ซึ่ง**รอทั้ง chunk เสร็จก่อนเริ่ม chunk ถัดไป** (`Promise.all` ต่อ chunk ของ 10, chunk ถัดไปเริ่มหลัง chunk ก่อนหน้าเสร็จหมด — ตัวช้าสุดใน chunk ถ่วงทั้ง chunk)

500 records ÷ 10 concurrency = **50 รอบ** ถ้า 1 record ใช้เวลาเฉลี่ย 30-38 queries × (latency query จริงบน UAT, สมมติ 15-25ms รวม network+lock+bcrypt ที่ผสมอยู่) ≈ 0.6-1.3s/record ⇒ 50 รอบ × ~0.9s ≈ **~45-65s** ซึ่ง**พอดีคาบเกี่ยวเส้น 60s ของ nginx `proxy_read_timeout`** — สอดคล้องกับ log ที่เห็นว่า batch 1 (500 records) ผ่าน แต่ batch 2 (500 records ถัดมา) timeout ซ้ำ 2 ครั้งติด (attempt คาดเว้น ~70s ต่อครั้ง = 60s timeout + 10s retry delay ตาม `Retrying batch 2 in 10s`) — ตัวเลขนี้อยู่ "คาบเส้น" พอดี ทำให้ batch ไหนโดนตัดขึ้นกับ jitter เล็กน้อย (DB load สะสม, autovacuum, GC ของ Bun, ปริมาณ email/รูปที่ต้องเขียนต่างกันในแต่ละ record) มากกว่าจะเป็นเพราะ batch 2 พิเศษจริง — ดูหัวข้อถัดไป

### ทำไมเจาะจง batch 2 (สมมติฐาน ยังไม่ยืนยัน 100%)

จุดที่ทำให้เวลาต่อ record **แปรผันสูง** ในโค้ดคือ path "สร้างใหม่" (created) vs "อัปเดต" (existing):

- ทุกครั้งที่สร้าง user ใหม่ (parent/staff ใหม่ หรือ student user ใหม่) โค้ดเรียก `Bun.password.hash(PARENT_DEFAULT_PASSWORD, { algorithm: "bcrypt", cost: 12 })` **CPU-bound** ที่ 4 จุด: `upsertStaff` (`powerschool_sync.ts:228`), `upsertParent` (บรรทัด 295), `upsertStaffParentRef` (บรรทัด 346), `upsertStudent` (บรรทัด 447) — bcrypt cost=12 ใช้เวลาระดับ ~200-300ms ต่อครั้งบนเครื่องทั่วไป (ตัวเลขระดับ order-of-magnitude ยังไม่ได้ profile จริงบน UAT) ถ้า 1 family มี parent ใหม่ 2 คน + student ใหม่ 2 คน = สูงสุด 4 ครั้ง/family × ~250ms ≈ **1s เพิ่มขึ้นเฉพาะ hashing** ต่อ record ที่เป็นข้อมูลใหม่ล้วน
- ถ้า batch 1 เป็น record ที่เคย sync ไปแล้ว (update path, ไม่ hash) แต่ batch 2 เป็น cohort ใหม่ (create path, hash ทุกคน) เวลาเฉลี่ยต่อ record ของ batch 2 จะสูงกว่า batch 1 อย่างมีนัยสำคัญ — เข้ากับพฤติกรรม "batch ไหนก็ได้ที่บังเอิญมีสัดส่วน 'ข้อมูลใหม่' เยอะกว่าจะช้ากว่า" ซึ่งพอดีกับ batch 2 ในรอบทดสอบนี้
- ยืนยันแน่ชัดต้อง sample payload จริงของ batch 1 vs batch 2 ว่าสัดส่วน new/existing ต่างกันแค่ไหน — ยังไม่มีข้อมูลนี้ในมือตอนวิเคราะห์

### Ranked fix list (เรียงตาม effort/impact)

1. **[Effort ต่ำ, impact สูง — ทำได้ก่อน retest พรุ่งนี้]** ลด batch size ฝั่ง client จาก 500 → 100-150 records/batch ชั่วคราว (stopgap) + เพิ่ม nginx `proxy_read_timeout` เป็น 180-300s ที่ UAT — ซื้อเวลาระหว่างแก้โค้ดจริง ไม่ต้องแตะ backend
2. **[Effort ต่ำ-กลาง, impact สูง]** Prefetch แบบ bulk แทน per-record SELECT: ก่อน loop ใน `processFamilyBatch` ยิง SELECT เดียวด้วย `inArray(users.externalId, [...allCustomerIds])` และ `inArray(customers.externalId, [...allStudentIds])` มา diff ในหน่วยความจำ (new vs existing) ตัดจำนวน SELECT ต่อ record จาก ~8-10 เหลือ 0 (query ทั้ง batch แค่ 2-4 ครั้งรวม)
3. **[Effort กลาง, impact สูง]** เปลี่ยน per-record INSERT/UPDATE เป็น bulk `INSERT ... ON CONFLICT DO UPDATE` (drizzle `.onConflictDoUpdate`) เป็นชุด (chunk ของ 100-500 แถวต่อ statement) แทนการ insert/update ทีละแถว — ใช้แพทเทิร์นเดียวกับที่มีอยู่แล้วใน `userLoginEmails` (`powerschool_sync.ts:194-197`) ขยายไปใช้กับ `users`/`customers`/`parentChildLinks`
4. **[Effort กลาง]** ย้าย `Bun.password.hash(..., cost: 12)` ออกจาก per-record hot path — ใช้ password คงที่/hash ล่วงหน้าครั้งเดียวสำหรับ default password (`PARENT_DEFAULT_PASSWORD` เหมือนกันทุกคนอยู่แล้ว ไม่จำเป็นต้อง hash ใหม่ทุก record) หรือลด cost factor สำหรับบัญชี auto-provision เหล่านี้
5. **[Effort กลาง]** ห่อ per-record work ด้วย `pgClient.begin()` เป็นก้อนต่อ chunk (ไม่ใช่ต่อ record) ลด autocommit overhead และทำให้ partial-failure ภายใน chunk rollback ได้สะอาดขึ้น (ตอนนี้ error กลางบันทึกจะทิ้ง state ครึ่งๆ กลางๆ ไว้ เพราะไม่มี transaction เลย)
6. **[Effort สูงสุด, impact สูงสุดระยะยาว]** เปลี่ยน endpoint เป็น async: `POST /sync/families` รับ batch แล้วตอบ `202 Accepted` ทันที (enqueue เข้า background job/queue) พร้อม endpoint แยกให้ vendor_sync poll สถานะ (`GET /sync/logs`/`GET /admin/sync-logs/:id` มีโครงอยู่แล้วที่ `routes.ts:320,323-324`) — ตัดปัญหา nginx timeout ออกจากสมการทั้งหมด เพราะ HTTP request ไม่ต้องรอ processing เสร็จอีกต่อไป

### ตอบคำถาม: "ต้องขยายเครื่องไหม?"

**ไม่ต้อง (อย่างน้อยไม่ใช่คำตอบหลัก)** หลักฐานชี้ว่าคอขวดเป็น **I/O-bound N+1 query pattern** (30-38 round-trip ต่อ record, ไม่มี bulk insert, ไม่มี transaction) ผสมกับ concurrency ที่ถูก cap ไว้ที่ 10 โดย DB connection pool (`max: 10` ที่ `db/client.ts:9`) — ขยาย CPU/RAM ของเครื่อง backend จะช่วยเฉพาะส่วน bcrypt hashing (CPU-bound จริง) แต่ไม่ช่วยลดจำนวน network round-trip ไปยัง DB เลย ถ้าจะ "ขยาย" ให้ขยายที่ **DB connection pool (`max`) และปรับ `SYNC_CONCURRENCY` ให้สอดคล้อง** พร้อมลดจำนวน query/record ก่อน (ข้อ 2-3 ด้านบน) — ขยายเครื่องเปล่าๆ โดยไม่แก้โค้ดจะช่วยได้แค่เศษเสี้ยว (เผื่อ CPU ไม่พอสำหรับ bcrypt concurrency 10 ขนาน) ไม่คุ้มกับ effort เทียบกับ fix ข้อ 1-3

---

## Raw log (ต้นฉบับ)

```
2026-07-14 22:09:47 | WARNING | vendor_sync | Batch rejected. HTTP=504 raw=<html>504 Gateway Time-out ... nginx/1.30.2
2026-07-14 22:09:47 | INFO | vendor_sync | Batch 2/3 | attempt 2 | HTTP=504 | vendor_status=None | msg=None
2026-07-14 22:09:47 | INFO | vendor_sync | Retrying batch 2 in 10s (attempt 3/3)
2026-07-14 22:10:57 | WARNING | vendor_sync | Vendor response was not valid JSON (HTTP 504)
2026-07-14 22:10:57 | ERROR | vendor_sync | Family [UAT] batch 2 failed after retries; aborting (continue_on_batch_failed=false)
Family [UAT] Sync Summary: SP dbo.get_family_campus_system_information_v2 | Total 1211 | Batch 500 | Batches 3 | Success 1 | Failed [2] | ABORTED
ENV OUTCOME | aborted: UAT | elapsed 319.1s
```
