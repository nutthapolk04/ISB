# Incident Response Playbook (backend-bun + kiosk)

คู่มือสั้นสำหรับตรวจสอบเหตุการณ์หลัง deploy จริง — เน้น **หา user**, **ช่วงเวลา**, และ **ธุรกรรมที่เกี่ยวข้อง**

## 1. แหล่งข้อมูลหลัก

| แหล่ง | ใช้เมื่อ | ที่อยู่ / วิธีเข้า |
|-------|---------|-------------------|
| **Application logs** | Error 500, stack trace, request ช้า | `LOG_DIR` (default `./logs`) — ไฟล์รายวัน `YYYY-MM-DD.log` เก็บ 30 วัน |
| **Request ID** | จับคู่ log หลายบรรทัดของ request เดียวกัน | ใน log: `[requestID]` จาก middleware `logging` ใน `logger.ts` |
| **Audit logs (API)** | ใครทำอะไรกับ entity ไหน (receipt, void, settings) | `GET /api/v1/admin/audit-logs` |
| **Wallet transactions (API)** | ยอดก่อน/หลัง เติม/หัก/โอน | `GET /api/v1/wallets/:id/transactions?date_from=&date_to=` |
| **PostgreSQL** | ตรวจลึก / reconcile | ตารางด้านล่าง |

### ตาราง DB ที่ใช้บ่อย

| ตาราง | เก็บอะไร |
|-------|---------|
| `wallet_transactions` | ยอดก่อน/หลัง ทุก movement (`TOPUP`, `ADJUSTMENT`, `DEDUCTION`, …) |
| `payment_intents` | QR top-up / POS intent (`ref_code`, `status`, `confirmed_at`) |
| `receipts` + `receipt_items` | การขาย POS |
| `audit_logs` | การกระทำของ staff (CREATE receipt, void, …) |
| `customers` | `card_uid`, `student_code` — ค้นหาจากบัตร |

## 2. API สำหรับสืบค้น

### Audit logs

```
GET /api/v1/admin/audit-logs
  ?entity_type=receipt
  &action=CREATE
  &user_id=123
  &shop_id=S0001
  &date_from=2026-07-01
  &date_to=2026-07-06
  &page=1
  &page_size=50
```

- **Auth:** admin เห็นทุกร้าน; manager/cashier ถูก pin ตาม `shop_id` ของ user
- **Timezone filter:** `date_from` / `date_to` ใช้ +07:00

### Wallet transactions

```
GET /api/v1/wallets/{walletId}/transactions?date_from=2026-07-01&date_to=2026-07-06
```

- แต่ละแถวมี `balance_before`, `balance_after`, `transaction_type`, `reference_type`, `reference_id`
- Cash kiosk top-up → `ADJUSTMENT` (ผ่าน `cashierTopup`)
- QR top-up → `TOPUP` (ผ่าน `confirmTopup`)
- POS หักเงิน → `DEDUCTION` + `reference_type=receipt`

### ค้นหานักเรียนจากบัตร

```
GET /api/v1/customers/by-card/{uid}
GET /api/v1/customers/search?q={uid_or_code}
```

- `by-card` รองรับหลายรูปแบบ UID (hex, reversed bytes, decimal) ผ่าน `expandCardUidCandidates`

## 3. สถานการณ์ที่พบบ่อย

### A. ยอด wallet ไม่ตรงที่คาด

1. หา `wallet_id` จาก `customers` หรือ kiosk/POS session
2. ดึง `wallet_transactions` ช่วงวันที่ — เรียง `created_at`
3. ตรวจว่า `balance_after` ของแถวก่อนหน้า = `balance_before` ของแถวถัดไป
4. ถ้าเป็น QR → ดู `payment_intents` ด้วย `ref_code` / `wallet_id`
5. ถ้าเป็น POS → จับคู่ `reference_id` กับ `receipts.id`

### B. Kiosk เติมเงินสดแล้วยอดไม่ขึ้น / ขึ้นซ้ำ

- Kiosk เก็บ pending ใน `localStorage` key `kiosk-pending-cash-topup` และ retry ตอน boot (`useBillAcceptor.ts`)
- ตรวจ log backend ช่วงเวลานั้น: `POST /wallets/:id/cashier-topup`
- ตรวจ `wallet_transactions` ว่ามี `ADJUSTMENT` ซ้ำจำนวนเดียวกันหรือไม่
- **หมายเหตุ:** ยังไม่มี server-side idempotency key สำหรับ cashier top-up — ถ้า retry สำเร็จ 2 ครั้งอาจ credit ซ้ำ (ต้อง reconcile ด้วยมือ)

### C. บัตรสแกนแล้วไม่เจอ (POS)

- เปรียบเทียบค่าที่ reader ส่ง (hex / decimal / reversed) กับ `customers.card_uid`
- ลอง `GET /customers/search?q=` บน kiosk (fuzzy) vs `by-card` บน POS (normalized candidates)
- อัปเดต `card_uid` ใน DB ให้ตรงรูปแบบที่ reader หลักใช้

### D. Checkout ล้มเหลวแต่หักเงินแล้ว

- ควรไม่เกิดถ้า transaction rollback สมบูรณ์ — ตรวจ log `logError` + request ID
- ถ้ามี `receipt` + `DEDUCTION` แปลว่าขายสำเร็จ
- ถ้ามี `DEDUCTION` แต่ไม่มี receipt → รายงาน dev ทันที (data inconsistency)

### E. Error 500 จาก API

1. หา request ID จาก response header / log client
2. ค้นใน `logs/YYYY-MM-DD.log` ด้วย request ID
3. บรรทัด error มี `stack` จาก `logError()` (global `onError` + `ResponseUtil`)

## 4. Log format (อ่านอย่างไร)

```
[timestamp] [level]: Res:<--[worker:pid] [requestID] [ip] METHOD /path [status] in X ms
```

Error เพิ่ม metadata: `error`, `stack`

Env ที่เกี่ยวข้อง:

| Variable | ความหมาย |
|----------|----------|
| `LOG_DIR` | โฟลเดอร์ log (default `./logs`) |
| `NODE_ENV=development` หรือ `DEBUG_MODE=true` | level `debug` |
| `WORKER_ID` | แยก worker ใน log |

## 5. Escalation checklist

- [ ] บันทึกเวลา (ICT +07), terminal/kiosk, user/student ที่เกี่ยวข้อง
- [ ] เก็บ request ID / ref_code / receipt_number ถ้ามี
- [ ] Export `wallet_transactions` + `payment_intents` / `receipts` ช่วงเวลา
- [ ] เก็บ screenshot จาก kiosk/POS
- [ ] ถ้าเป็นยอดผิดพลาด → **หยุดใช้ terminal นั้นชั่วคราว** จนกว่าจะ reconcile

## 6. สิ่งที่ยังไม่มี (อย่าคาดหวังจาก playbook นี้)

- Metrics endpoint (CPU/memory)
- Centralized log aggregation (ELK/Datadog)
- Automated alert
- Deploy/runbook แบบ multi-instance (ดูหมวด Resilience — ยัง defer)
