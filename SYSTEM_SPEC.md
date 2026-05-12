# Schooney Payment System — Sitemap & Functional Specification

> Last updated: 2026-04-23  
> Purpose: ใช้ recheck ความถูกต้องของโครงสร้างระบบและ user role

---

## 1. User Roles

### 1.1 Primary Roles

| Role | ภาษาไทย | คำอธิบาย | Module ที่เข้าถึง |
|------|---------|---------|-----------------|
| `admin` | ผู้ดูแลระบบ | เข้าถึงได้ทุกหน้า ทุก shop ทุก module | canteen + store + admin + parent |
| `manager` | ผู้จัดการร้าน | จัดการร้านของตนเอง (scoped ตาม shop_id) | canteen หรือ store (แล้วแต่ shop) |
| `cashier` | แคชเชียร์ | ใช้ POS + ดูใบเสร็จ เท่านั้น | canteen หรือ store (แล้วแต่ shop) |
| `parent` | ผู้ปกครอง | ดูกระเป๋าเงิน/ประวัติ ของบุตรหลาน | parent portal เท่านั้น |
| `staff` | เจ้าหน้าที่ | เหมือน parent (เข้า /parent/*) | parent portal เท่านั้น |
| `student` | นักเรียน | ไม่มี frontend login ปัจจุบัน | — |
| `teacher` | ครู | ไม่มี frontend login ปัจจุบัน | — |
| `canteen_owner` | เจ้าของโรงอาหาร | ไม่มี frontend login ปัจจุบัน | — |
| `visitor` | ผู้เยี่ยมชม | ไม่มี frontend login ปัจจุบัน | — |

### 1.2 Module System

ระบบแบ่ง shop ออกเป็น 2 module:

| Module | คำอธิบาย | shop_id ตัวอย่าง |
|--------|---------|----------------|
| `canteen` | โรงอาหาร — RFID-first, ไม่มี stock management | `canteen`, `canteen_thai`, `canteen_drinks` |
| `store` | สหกรณ์/ร้านค้า — มี stock/inventory | `coop`, `sports`, `bookstore` |

**Module Inference Logic:**
- `shop_id` ขึ้นต้นด้วย `"canteen"` → module = `"canteen"`
- อื่นๆ → module = `"store"`
- Admin ผ่านได้ทุก module

### 1.3 Role × Module Matrix (ระดับ Frontend Access)

| Role | `/admin/*` | `/canteen/*` | `/store/*` | `/parent/*` |
|------|-----------|-------------|-----------|------------|
| `admin` | ✅ ทั้งหมด | ✅ ทั้งหมด | ✅ ทั้งหมด | ✅ ทั้งหมด |
| `manager` (canteen) | ❌ | ✅ POS+สินค้า+ผู้ใช้+ใบเสร็จ | ❌ | ❌ |
| `cashier` (canteen) | ❌ | ✅ POS+ใบเสร็จ เท่านั้น | ❌ | ❌ |
| `manager` (store) | ❌ | ❌ | ✅ POS+สินค้า+ผู้ใช้+ใบเสร็จ+คืนสินค้า | ❌ |
| `cashier` (store) | ❌ | ❌ | ✅ POS+ใบเสร็จ เท่านั้น | ❌ |
| `parent` | ❌ | ❌ | ❌ | ✅ ทั้งหมด |
| `staff` | ❌ | ❌ | ❌ | ✅ ทั้งหมด |

---

## 2. Sitemap

### 2.1 Default Landing URL (หลัง Login)

```
/ (root)
  ├─ ไม่ได้ login → /login
  ├─ role = admin → /admin
  ├─ role = parent หรือ staff → /parent/dashboard
  └─ role = manager หรือ cashier
      ├─ module = canteen → /canteen
      └─ module = store → /store
```

### 2.2 แผนผังทุก Route

```
PUBLIC
  /login                          ทุกคน (redirect ถ้า login แล้ว)

PROTECTED (ต้อง login)
  /                               Landing dispatcher (ดู 2.1)

  ─── CANTEEN MODULE (/canteen/*) ───────────────────────────────
  Guard: RequireModule("canteen")
    admin → ผ่านเสมอ
    parent/staff → redirect /parent/dashboard
    manager/cashier → ต้องมี module = "canteen"

  /canteen                        Canteen POS
  /canteen/receipts               ใบเสร็จ (canteen)
  /canteen/products               จัดการเมนู (manager เท่านั้น)
  /canteen/users                  จัดการผู้ใช้ร้านอาหาร (manager, admin)
  /canteen/management/:shopId     รายละเอียด canteen shop (admin เท่านั้น)
  /canteen/reports                รายงาน canteen (admin เท่านั้น)

  ─── STORE MODULE (/store/*) ────────────────────────────────────
  Guard: RequireModule("store")
    admin → ผ่านเสมอ
    parent/staff → redirect /parent/dashboard
    manager/cashier → ต้องมี module = "store"

  /store                          Store POS
  /store/receipts                 ใบเสร็จ (store)
  /store/void                     ยกเลิกใบเสร็จ (manager, admin)
  /store/returns                  รับคืนสินค้า (manager, admin)
  /store/return-history           ประวัติรับคืน (manager, admin)
  /store/management               จัดการร้านค้าทั้งหมด (manager, admin)
  /store/management/:shopId       รายละเอียดร้านค้า (manager, admin)
  /store/users                    จัดการผู้ใช้ร้านค้า (manager, admin)
  /store/reports                  รายงานร้านค้า (admin เท่านั้น)

  ─── ADMIN SECTION (/admin/*) ──────────────────────────────────
  Guard: RequireRole(["admin"])

  /admin                          Admin Dashboard (KPI overview)
  /admin/users                    จัดการผู้ใช้ระบบ (admin users list)
  /admin/users/:userId            รายละเอียดผู้ใช้ระบบ
  /admin/families                 จัดการ family links (parent ↔ student)
  /admin/wallet-adjust            ปรับยอดกระเป๋าเงินด้วยตนเอง
  /admin/customer/:customerId     รายละเอียดนักเรียน
  /admin/reports                  รายงานระบบ (admin)

  ─── PARENT PORTAL (/parent/*) ─────────────────────────────────
  Guard: RequireRole(["parent", "staff", "admin"])

  /parent/dashboard               Family Dashboard (ลิสต์บุตรหลาน)
  /parent/wallet/:customerId      กระเป๋าเงินของนักเรียนคนนั้น
  /parent/transactions/:customerId ประวัติธุรกรรมของนักเรียนคนนั้น
  /parent/profile/:customerId     โปรไฟล์นักเรียน
  /parent/transfer                โอนเงินระหว่างกระเป๋าบุตรหลาน

  ─── ไม่มี route ────────────────────────────────────────────────
  *                               404 NotFound
```

---

## 3. Sidebar Navigation Structure

Sidebar ปรากฏเมื่อ login แล้ว กรองตาม role + module ของ user:

### Group 1 — โรงอาหาร (module: canteen)
แสดงเมื่อ: admin หรือ user ที่มี shopModule = "canteen"

| รายการ | Path | Roles ที่เห็น |
|-------|------|-------------|
| POS โรงอาหาร | /canteen | manager, cashier |
| ใบเสร็จ | /canteen/receipts | manager, cashier, admin |
| จัดการเมนู | /canteen/products | manager |
| จัดการผู้ใช้ | /canteen/users | manager, admin |
| รายงาน | /canteen/reports | admin |

### Group 2 — ร้านค้า (module: store)
แสดงเมื่อ: admin หรือ user ที่มี shopModule = "store"

| รายการ | Path | Roles ที่เห็น |
|-------|------|-------------|
| POS ร้านค้า | /store | manager, cashier |
| ใบเสร็จ | /store/receipts | manager, cashier, admin |
| ยกเลิกใบเสร็จ | /store/void | manager, admin |
| รับคืนสินค้า | /store/returns | manager, admin |
| ประวัติรับคืน | /store/return-history | manager, admin |
| รายงาน | /store/reports | admin |

### Group 3 — จัดการร้านค้า (ไม่ผูก module)
แสดงเสมอ แต่กรองตาม role

| รายการ | Path | Roles ที่เห็น |
|-------|------|-------------|
| จัดการร้านค้า | /store/management | manager, admin |
| จัดการผู้ใช้ | /store/users | manager, admin |

> **หมายเหตุ:** Group 3 ชี้ไป /store/* แต่ admin ที่อยู่ใน canteen context ก็ยังเห็น เพราะ admin ผ่าน RequireModule เสมอ

### Group 4 — Admin (ไม่ผูก module)
แสดงเมื่อ role = admin

| รายการ | Path |
|-------|------|
| Dashboard | /admin |
| จัดการผู้ใช้ระบบ | /admin/users |
| ครอบครัว | /admin/families |
| ปรับยอดกระเป๋า | /admin/wallet-adjust |

### Group 5 — ผู้ปกครอง (ไม่ผูก module)
แสดงเมื่อ role = parent

| รายการ | Path |
|-------|------|
| หน้าหลัก | /parent/dashboard |

---

## 4. Functional Specification by Page

### 4.1 Login (`/login`)
- **ใครใช้:** ทุกคน
- **ฟีเจอร์:** username/password login → JWT → redirect ตาม role
- **Backend:** `POST /api/v1/auth/login`
- **หมายเหตุ:** ถ้า login แล้วจะ redirect ออกทันที

---

### 4.2 Canteen POS (`/canteen`)
- **ใครใช้:** manager, cashier (canteen module)
- **ฟีเจอร์:**
  - แสดงเมนูอาหาร grid แบ่งตาม category (tab)
  - เพิ่ม/ลดสินค้าในตะกร้า
  - เลือก menu options (single/multi/quantity)
  - ค้นหาเมนูได้
  - เลือกวิธีชำระ: RFID card tap, QR payment, เงินสด
  - ค้นหานักเรียนด้วย RFID UID → แสดงชื่อ + ยอดกระเป๋า
  - ยืนยัน checkout → ตัดยอดกระเป๋าเงิน
  - แสดง receipt modal หลัง checkout สำเร็จ
  - **Desktop (≥lg):** cart panel อยู่ด้านขวา (pinned full-height)
  - **Mobile (<lg):** ปุ่มลอยเปิด cart drawer (Sheet)
- **Backend:** `GET /api/v1/products/`, `POST /api/v1/pos/checkout`, `GET /api/v1/customers/by-card/{uid}`

---

### 4.3 Store POS (`/store`)
- **ใครใช้:** manager, cashier (store module)
- **ฟีเจอร์:**
  - ค้นหาสินค้าด้วยชื่อ/บาร์โค้ด
  - เพิ่ม/ลดสินค้าในตะกร้า
  - เลือกประเภทลูกค้า (internal/external → ราคาต่างกัน)
  - เลือกวิธีชำระ: เงินสด, กระเป๋าเงิน (RFID), บัตรเครดิต, EDC
  - ส่วนลด (Discount)
  - checkout → ตัด stock + ออกใบเสร็จ
  - **Desktop (≥lg):** cart panel ด้านขวา (sticky)
  - **Mobile (<lg):** cart อยู่ด้านล่าง (stacked layout)
- **Backend:** `GET /api/v1/products/search`, `POST /api/v1/pos/checkout`

---

### 4.4 ใบเสร็จ (`/canteen/receipts` และ `/store/receipts`)
- **ใครใช้:** manager, cashier, admin
- **ฟีเจอร์:**
  - ลิสต์ใบเสร็จ (วันที่, เลขที่, ยอด, วิธีชำระ, สถานะ)
  - กรองตาม scope: canteen หรือ store
  - Admin เลือก shop ได้ (coop/sports/bookstore หรือ canteen shop)
  - สถานะ: `active` (ปกติ) | `voided` (ยกเลิกแล้ว)
  - ดูรายละเอียดใบเสร็จ
- **Backend:** `GET /api/v1/pos/receipt`

---

### 4.5 ยกเลิกใบเสร็จ (`/store/void`)
- **ใครใช้:** manager, admin (store)
- **ฟีเจอร์:**
  - ค้นหาใบเสร็จด้วยเลขที่
  - ดูรายละเอียด → ยืนยันยกเลิก
  - ระบุเหตุผลยกเลิก
  - void แล้ว: คืน stock + คืนยอดกระเป๋า (ถ้า wallet payment)
- **Backend:** `POST /api/v1/pos/void/{receipt_id}`

---

### 4.6 รับคืนสินค้า (`/store/returns`)
- **ใครใช้:** manager, admin (store)
- **ฟีเจอร์:**
  - ค้นหาใบเสร็จ
  - เลือกสินค้าที่จะรับคืน + จำนวน
  - ระบุเหตุผล
  - เลือก: refund (คืนเงิน) หรือ exchange (เปลี่ยนสินค้า)
  - ประมวลผล return → อัพเดท stock
- **Backend:** `POST /api/v1/returns/create`, `POST /api/v1/returns/{id}/refund`, `POST /api/v1/returns/{id}/exchange`

---

### 4.7 ประวัติรับคืน (`/store/return-history`)
- **ใครใช้:** manager, admin (store)
- **ฟีเจอร์:** ลิสต์ return requests ที่ประมวลผลแล้ว (approved/rejected/refunded)
- **Backend:** `GET /api/v1/return-history`

---

### 4.8 จัดการเมนู (`/canteen/products`)
- **ใครใช้:** manager (canteen)
- **ฟีเจอร์:**
  - ลิสต์เมนูอาหาร (แสดงรูป, ชื่อ, ราคา, หมวดหมู่)
  - เพิ่ม/แก้ไข/ลบเมนู
  - อัพโหลดรูปภาพ (Cloudinary)
  - จัดการ Menu Option Groups:
    - `single` — เลือกได้ 1 (เช่น ระดับความเผ็ด)
    - `multi` — เลือกได้หลาย (เช่น topping)
    - `quantity` — ระบุจำนวนต่อ option
  - จัดการ Category (tab) ในโรงอาหาร
- **Backend:** `GET/POST/PATCH/DELETE /api/v1/shops/{shopId}/products`, `GET/POST/PATCH/DELETE /api/v1/shops/{shopId}/products/{id}/option-groups`

---

### 4.9 จัดการผู้ใช้โรงอาหาร (`/canteen/users`)
- **ใครใช้:** manager, admin
- **ฟีเจอร์:**
  - ลิสต์ user ที่ผูกกับ canteen shop
  - เพิ่ม/แก้ไข/ลบ cashier
  - Manager สร้างได้เฉพาะ cashier ในร้านของตน
- **Backend:** `GET/POST/PATCH/DELETE /api/v1/users/`

---

### 4.10 จัดการร้านค้า (`/store/management`)
- **ใครใช้:** manager, admin
- **ฟีเจอร์:**
  - ลิสต์ร้านค้าทั้งหมด (coop, sports, bookstore)
  - เลือกร้านค้า → `/store/management/:shopId`
- **Backend:** `GET /api/v1/shops/`

---

### 4.11 รายละเอียดร้านค้า (`/store/management/:shopId`)
- **ใครใช้:** manager, admin
- **ฟีเจอร์:**
  - ข้อมูล shop (ชื่อ, ประเภท, KPI)
  - จัดการสินค้า: เพิ่ม/แก้ไข/ลบ, อัพโหลดรูป
  - Category management
  - รับสินค้า (stock receive) + ปรับ stock (adjustment)
  - ดูประวัติ stock movement
  - FIFO lots (ถ้า shop type = fifo)
  - Batch import สินค้า (CSV)
- **Backend:** `GET /api/v1/shops/{shopId}`, `GET/POST/PATCH/DELETE /api/v1/shops/{shopId}/products`, `POST /api/v1/shops/{shopId}/receive`, `POST /api/v1/shops/{shopId}/adjust`, `GET /api/v1/shops/{shopId}/movements`

---

### 4.12 จัดการผู้ใช้ร้านค้า (`/store/users`)
- **ใครใช้:** manager, admin
- **ฟีเจอร์:** เหมือน `/canteen/users` แต่ scope ที่ store shop
- **Backend:** `GET/POST/PATCH/DELETE /api/v1/users/`

---

### 4.13 รายงาน (`/canteen/reports`, `/store/reports`, `/admin/reports`)
- **ใครใช้:** admin เท่านั้น
- **ฟีเจอร์:** (ปัจจุบัน: placeholder/basic — ขึ้นอยู่กับ implementation)
  - ยอดขายรายวัน/รายเดือน
  - กราฟ/chart
- **Backend:** (ขึ้นอยู่กับ implementation ปัจจุบัน)

---

### 4.14 Admin Dashboard (`/admin`)
- **ใครใช้:** admin
- **ฟีเจอร์:**
  - KPI overview (ยอดขาย, จำนวน user, etc.)
  - Quick links ไปส่วนต่างๆ
- **Backend:** หลาย endpoint (aggregate stats)

---

### 4.15 จัดการผู้ใช้ระบบ (`/admin/users`)
- **ใครใช้:** admin
- **ฟีเจอร์:**
  - ลิสต์ user ทั้งหมดในระบบ (search, filter)
  - เพิ่ม/แก้ไข/ลบ user
  - Sync จาก PowerSchool (mock)
  - ดู sync logs
  - ผูก/ถอด NFC card (card_uid)
- **Backend:** `GET/POST/PATCH/DELETE /api/v1/users-admin/`, `/api/v1/sync/powerschool`

---

### 4.16 รายละเอียดผู้ใช้ (`/admin/users/:userId`)
- **ใครใช้:** admin
- **ฟีเจอร์:**
  - ข้อมูล user ครบถ้วน
  - ประวัติ external_id (PowerSchool ID) เมื่อมีการเปลี่ยน
  - ครอบครัว (ถ้าเป็น parent)
  - Secondary roles
- **Backend:** `GET /api/v1/users-admin/{userId}`, `GET /api/v1/users-admin/{userId}/family`

---

### 4.17 ครอบครัว (`/admin/families`)
- **ใครใช้:** admin
- **ฟีเจอร์:**
  - ลิสต์ parent-child links ทั้งหมด
  - ผูก parent ↔ student (ด้วย family_code)
  - ถอด link
  - ค้นหา student สำหรับ link ใหม่
- **Backend:** `GET/POST/DELETE /api/v1/family/links`, `GET /api/v1/users-admin/students`

---

### 4.18 Top-up Flow — Auto-Confirm (semi-automatic)

- **ใครใช้:** parent (ไม่มี admin gate)
- **ที่มา:** หน้า `/admin/topups` ถูกลบออก เนื่องจากไม่มีจุดไหนที่ต้องรอ admin ยืนยัน — parent เติมเข้า → API auto-credit ทันที
- **Flow:**
  1. Parent กรอกจำนวน → `POST /wallets/{wallet_id}/topup` → ได้ QR PromptPay + ref_code (intent status = pending)
  2. Parent โอนเงินผ่าน bank app
  3. Parent กด "ยืนยันการโอน" → `POST /wallets/topup/{ref_code}/parent-confirm` → wallet credited, audit `confirmed_via=parent_self`
- **Backend:** `POST /api/v1/wallets/{wallet_id}/topup`, `POST /api/v1/wallets/topup/{ref_code}/parent-confirm`
- **Audit:** `payment_intents` table ยังคงเก็บ status/confirmed_via/confirmed_at สำหรับ audit trail

---

### 4.19 ปรับยอดกระเป๋า (`/admin/wallet-adjust`)
- **ใครใช้:** admin
- **ฟีเจอร์:**
  - ค้นหา student
  - ระบุจำนวนที่จะปรับ (บวก/ลบ) + เหตุผล
  - บันทึก audit log อัตโนมัติ
- **Backend:** `POST /api/v1/wallets/{walletId}/adjust`

---

### 4.20 รายละเอียดนักเรียน (`/admin/customer/:customerId`)
- **ใครใช้:** admin
- **ฟีเจอร์:**
  - ข้อมูลนักเรียนครบถ้วน
  - ยอดกระเป๋า + ประวัติธุรกรรม
  - จัดการ card (bind/unbind, freeze)
  - ตั้ง daily limit, overdraft limit
  - แก้ไข allergies
  - Graduate (ย้าย/จบการศึกษา)
- **Backend:** `GET /api/v1/customers/{id}`, `POST /api/v1/customers/{id}/freeze`, `PATCH /api/v1/customers/{id}/limit`, etc.

---

### 4.21 Family Dashboard (`/parent/dashboard`)
- **ใครใช้:** parent, staff, admin
- **ฟีเจอร์:**
  - แสดงรายชื่อบุตรหลานที่ผูกไว้
  - ยอดกระเป๋าเงินของแต่ละคน
  - Link ไป WalletDetail, TransactionHistory, StudentProfile
  - Quick top-up (สร้าง PaymentIntent)
- **Backend:** `GET /api/v1/family/me`, `GET /api/v1/wallets/family`

---

### 4.22 กระเป๋าเงิน (`/parent/wallet/:customerId`)
- **ใครใช้:** parent, staff, admin
- **ฟีเจอร์:**
  - แสดงยอดปัจจุบัน + รายการล่าสุด
  - สร้าง top-up intent → QR PromptPay
  - Freeze/unfreeze card
  - ตั้ง daily limit
- **Backend:** `GET /api/v1/wallets/{id}`, `POST /api/v1/wallets/{id}/topup`

---

### 4.23 ประวัติธุรกรรม (`/parent/transactions/:customerId`)
- **ใครใช้:** parent, staff, admin
- **ฟีเจอร์:**
  - ลิสต์ทุก transaction (topup, deduction, refund, adjustment)
  - กรองตามช่วงวันที่
  - **Desktop (≥md):** ตาราง
  - **Mobile (<md):** card list
- **Backend:** `GET /api/v1/wallets/{id}/transactions`

---

### 4.24 โปรไฟล์นักเรียน (`/parent/profile/:customerId`)
- **ใครใช้:** parent, staff, admin
- **ฟีเจอร์:**
  - ข้อมูลนักเรียน (ชื่อ, รูป, ระดับชั้น, แผนก)
  - Allergies
  - สถานะบัตร (active/frozen)
- **Backend:** `GET /api/v1/customers/{id}`

---

### 4.25 โอนเงิน (`/parent/transfer`)
- **ใครใช้:** parent, staff, admin
- **ฟีเจอร์:**
  - โอนเงินระหว่างกระเป๋าบุตรหลานในครอบครัวเดียวกัน
  - ระบุจำนวน + เหตุผล
- **Backend:** `POST /api/v1/wallets/transfer`

---

## 5. Payment Methods

| Method | ค่าใน DB | ใช้ใน |
|--------|---------|------|
| เงินสด | `cash` | store, canteen |
| กระเป๋าเงิน (RFID tap) | `wallet` + `card_tap` | store, canteen |
| QR Payment | `wallet` (via payment intent) | canteen |
| บัตรเครดิต | `credit_card` | store |
| บัตรเดบิต | `debit_card` | store |
| EDC terminal | `edc` | store |
| โอนเงิน | `bank_transfer` | store |
| ตัดแผนก | `department` | store (coop เท่านั้น) |
| อื่นๆ | `other` | store |

---

## 6. Key Data Models (สรุป)

### User
- role: `admin` | `manager` | `cashier` | `parent` | `staff` | `student` | `teacher` | `canteen_owner` | `visitor`
- shop_id: FK → shops (null สำหรับ admin, parent)
- card_uid: RFID UID (hex)
- family_code: string (ผูก parent ↔ students)
- status: `active` | `inactive`

### Customer (นักเรียน)
- card_uid: NFC card UID (unique)
- card_frozen: boolean
- daily_limit: decimal (null = ไม่จำกัด)
- negative_credit_limit: decimal (อนุญาตยอดติดลบได้ถึงเท่าไร)
- allergies, dietary_notes
- school_type: `ES Student` | `MS Student` | `HS Student`
- family_code: ผูกกับ users.family_code

### Shop
- id: string (coop, sports, bookstore, canteen, ...)
- module: `store` | `canteen`
- shop_type: `avg_cost` | `fifo`
- allow_department_charge: boolean (coop เท่านั้น)

### Receipt
- status: `active` | `voided`
- payment_method: ดู section 5
- transaction_mode: `sale` | `internal_issue`

### WalletTransaction
- transaction_type: `topup` | `deduction` | `refund` | `adjustment`

### ReturnRequest
- status: `pending` | `approved` | `rejected`
- return_status: `no-return` | `partial-return` | `full-return`

---

## 7. Backend API Base URL

```
Base: /api/v1/

auth/          → login, me, register, user roles
users/         → shop-scoped user management
users-admin/   → admin user management + family links
shops/         → shop CRUD + stats
products/      → product search (POS optimized)
wallets/       → wallet, topup, transfer, adjust
customers/     → student profiles, card management
returns/       → return/exchange processing
pos/           → checkout, receipts, void
family/        → parent-child links
sync/          → PowerSchool sync + logs
shops/{id}/    → inventory: products, categories, stock movements, option groups
```

---

## 8. Items to Verify / Known Gaps

| หัวข้อ | สถานะ | หมายเหตุ |
|-------|-------|---------|
| `/canteen/reports` | ⚠️ admin only — ตรวจสอบว่า UI implement แล้วหรือ placeholder | — |
| `/store/reports` | ⚠️ admin only — ตรวจสอบว่า UI implement แล้วหรือ placeholder | — |
| `/admin/reports` | ⚠️ ตรวจสอบ | — |
| `staff` role sidebar | ⚠️ sidebar group 5 แสดงแค่ parent role — staff ไม่มี nav item ของตัวเอง | ต้องยืนยัน |
| `canteen_owner` role | ❓ มีใน DB enum แต่ไม่มี route ใน frontend | อาจเป็น future role |
| Shop Management (/store/management) | ⚠️ sidebar group 3 ชี้ไป /store/* — admin ที่ context canteen ก็ยัง access ได้ | verify UX |
| `/canteen/management/:shopId` | Admin เท่านั้น — ไม่มีใน sidebar canteen group | ต้องยืนยัน access path |
| Negative balance | ✅ supported — `negative_credit_limit` per student | — |
| Top-up flow | Parent สร้าง intent → Admin confirm | Parent self-confirm endpoint มีด้วย (`/topup/{ref}/parent-confirm`) |
| Sync (PowerSchool) | Mock implementation เท่านั้น | — |
