# Schooney POS — How-To Guide

> คู่มือการใช้งานระบบ ISB Schooney POS
> Last updated: 2026-06-22

---

## What's New (2026-06-22)

| การเปลี่ยนแปลง | ผลต่อผู้ใช้ | section ที่เกี่ยวข้อง |
|---|---|---|
| Cashier ออก QR PromptPay เติมเงินให้ลูกค้าได้ | เดิม cashier กด "เติมเงิน → QR" แล้วขึ้น "Failed to create QR" (403). แก้แล้ว — cashier ของทุกร้านสร้าง QR ให้นักเรียน/พนักงานคนใดก็ได้ | §5 "Cashier เติมเงินที่ POS" |
| ยกเลิกปุ่ม "Mark as Paid" ใน Cashier Top-Up | Cashier **ห้าม** กดยืนยันการเติมเงินเอง — ระบบจะยืนยันอัตโนมัติเมื่อ BAY callback กลับมา (หลังลูกค้าโอนจริง) | §5 "Cashier เติมเงินที่ POS" |
| Manager สร้าง shortcut เหตุผล Void เองได้ | Manager ของแต่ละร้านเพิ่ม/ลบ chip เหตุผลยกเลิกใบเสร็จได้เอง (เฉพาะร้านตัวเอง). Cashier เห็น chip ใช้งานได้แต่แก้ไม่ได้. Admin แก้ได้ทุกร้าน | §7 "Void Receipt" |
| BAY QR / EASYPay พร้อมใช้งานบน production | ลูกค้าเติมเงินผ่าน QR PromptPay หรือ EASYPay (รูดบัตรบนหน้าเว็บธนาคาร) ได้จริง | §5 |
| EDC BAY (Newland N950S) ยัง manual | คนคิดเงินต้องรูดบัตรที่เครื่อง EDC ของ Bay แล้วพิมพ์ approval code กลับเข้าระบบเอง — ยังไม่ auto-fetch | §3 "EDC" |

---

## 1. เพิ่มนักเรียน / สมาชิก (Add Student / Member)

### เพิ่มนักเรียน (Student)
1. Login ด้วย Admin → ไปที่ **Admin → Cardholders**
2. กด **+ Add Cardholder**
3. เลือก Kind = **Student**
4. กรอก: ชื่อ, Student Code (เช่น S12345), ชั้น, อีเมล (optional)
5. กด **Create** → ระบบสร้าง wallet ให้อัตโนมัติ

### เพิ่ม Staff / Parent
1. Admin → Cardholders → **+ Add Cardholder**
2. เลือก Kind = **Staff** หรือ **Parent**
3. กรอก: ชื่อ, Username, Password (จะ login ด้วย username นี้)
4. กด **Create**

### เพิ่ม Department
1. Admin → Cardholders → **+ Add Cardholder**
2. เลือก Kind = **Department**
3. กรอก: Department Code (เช่น D0001), Department Name
4. กด **Create** → ระบบสร้าง department wallet ให้อัตโนมัติ

### ผูกบัตร RFID กับนักเรียน
1. Admin → Cardholders → คลิกที่นักเรียน → **Edit Card**
2. สแกน/พิมพ์ Card UID (เช่น A1B2C3D4) → บันทึก
3. ใช้บัตรสแกนที่ Canteen POS ได้ทันที

### ผูก Parent กับ Student
1. Admin → **Families** → **+ Link Parent**
2. เลือก Parent user + เลือก Student
3. กด **Link** — parent จะเห็นยอดเงินลูกใน Parent Portal

---

## 2. สร้างเมนูอาหาร (Create Canteen Menu Item)

1. Login ด้วย Manager หรือ Admin → **Canteen → Products** (หรือ `/canteen/products`)
2. กด **+ Add Product**
3. กรอก:
   - **Name**: ชื่อเมนู (เช่น Pad Thai)
   - **Category**: เลือก category (เช่น Main Course)
   - **Price**: ราคาขาย (External Price)
   - **Internal Price**: ราคาภายใน/พนักงาน (ถ้าแตกต่าง)
4. อัปโหลด **รูปภาพ** (optional แต่แนะนำ — จะแสดงใน POS grid)
5. กด **Save**

### เพิ่ม Category
- Canteen → Products → **Manage Categories** → **+ Add Category**
- ใส่ชื่อ category → Save

### เพิ่ม Menu Options (Add-ons)
- แก้ไข product → แถบ **Options** → เพิ่ม option group (เช่น "ความเผ็ด") + choices

---

## 3. ชำระเงินที่ Canteen POS (Process Payment)

### ขั้นตอนหลัก
1. Login ด้วย Cashier/Manager ที่ assigned กับ shop → ไปที่ `/canteen`
2. กดเมนูอาหารที่ต้องการ → เพิ่มลงตะกร้า
3. กด **Charge** (ปุ่มสีเหลืองขวา)

### วิธีชำระแต่ละแบบ:

#### บัตร / Wallet (นักเรียน, ผู้ปกครอง, พนักงาน)
1. เลือก **Wallet** → modal "Tap Card or Enter Code" เปิดขึ้น
2. สแกนบัตร RFID **หรือ** พิมพ์รหัส:
   - **Student Code** เช่น `S12345`
   - **Card UID** เช่น `A1B2C3D4`
   - **Staff Username** เช่น `somchair`
   - **Department Code** เช่น `D0001`
3. กด **Search** → ระบบหาข้อมูลอัตโนมัติ
4. ตรวจสอบชื่อ + ยอดเงิน → กด **Confirm ฿XX.XX**

#### เงินสด
1. เลือก **Cash** → กรอกจำนวนเงินที่รับมา → กด **Confirm**

#### QR/PromptPay (BAY)
1. เลือก **QR** → QR code จาก BAY gateway จะแสดง
2. ลูกค้าสแกนด้วยแอปธนาคาร → จ่ายเงิน
3. **ระบบยืนยันอัตโนมัติ** เมื่อ BAY callback กลับมา — ไม่ต้องกดอะไรเพิ่ม
4. ปุ่ม "Cancel" ใช้กรณีลูกค้าไม่จ่าย (ยกเลิก QR แล้วเลือกวิธีอื่น)

#### EDC — รูด/แตะบัตรที่เครื่อง EDC ของ Bay
1. เลือก **EDC** ใน Charge dialog
2. รูดบัตร / แตะบัตร contactless / สแกน QR ของลูกค้า **ที่เครื่อง EDC ของ Bay** (ไม่ใช่ใน POS)
3. รอเครื่อง EDC อนุมัติ — slip จะออกจากเครื่อง
4. กลับมาที่ POS → กรอก **Approval Code** จาก slip (จำเป็น)
   - Terminal Reference + Masked Card → optional แต่แนะนำใส่เพื่อ audit
5. กด **Confirm charge**

> **หมายเหตุ EDC:** ตอนนี้ระบบยังไม่เชื่อมกับเครื่อง EDC โดยตรง — cashier ต้องกรอก approval code เองจาก slip กระดาษ. ปุ่ม "Fetch from terminal (mock)" ในเครื่อง dev จะกรอก mock data ให้ — production ห้ามใช้ปุ่มนี้

#### BAY EASYPay (กรอกข้อมูลบัตรบนหน้าเว็บธนาคาร)
1. เลือก **EASYPay** ใน payment picker (ปกติใช้กับ wallet top-up)
2. ระบบ redirect ไปหน้าธนาคารกรุงศรี → ลูกค้ากรอกข้อมูลบัตรเครดิต/เดบิต
3. หลังจ่ายเสร็จ ธนาคาร redirect กลับมาที่ ISB → ระบบ confirm อัตโนมัติ

#### แผนก (Department Charge)
1. เลือก **Department** จาก payment picker → เลือกแผนกจาก dropdown
2. **หรือ**: เลือก Wallet → พิมพ์ **Department Code** (เช่น D0001) → Search

> **หมายเหตุ:** Department charge ต้องเปิด `allow_department_charge` ในการตั้งค่าร้านค้าก่อน (Admin → Shops → แก้ไขร้าน)

---

## 4. ค้นหาสมาชิก (Search Member)

### ในหน้า Canteen POS
- กดปุ่ม **ค้นหาสมาชิก** (🔍 icon บนขวา)
- พิมพ์: ชื่อ / รหัสนักเรียน / username / รหัสแผนก
- เลือกสมาชิก → ชื่อจะแสดงบน Order panel
- กด **Charge** → ระบบชำระผ่าน wallet โดยตรง

### ใน RFID Payment Modal
- พิมพ์ในช่อง "Card UID / Student Code / Staff Username"
- ระบบค้นหาตามลำดับ: card UID → student code → username → department code
- ถ้าพบ → แสดงข้อมูล + ยอดเงินก่อนยืนยัน

### ในหน้า Admin → Cardholders
- มีช่องค้นหาด้านบน — ค้นได้ด้วยชื่อ, รหัส, ประเภท (Student/Staff/Department)

---

## 5. เติมเงิน (Top Up Wallet)

### ผู้ปกครองเติมเงินให้ลูก (Parent Self Top-Up)
1. Login เป็น Parent → **Parent Portal → เลือกลูก → Wallet**
2. กด **เติมเงิน** → กรอกจำนวนเงิน
3. QR PromptPay จะแสดง → สแกนด้วย Mobile Banking → โอนเงิน
4. กด **ยืนยันการโอน** → ยอดเงินเพิ่มทันที (auto-confirm, ไม่ต้องรอ admin)

### Admin เติมเงินให้ (Manual Top-Up)
1. Admin → **Cardholders** → เลือกนักเรียน/ผู้ปกครอง/พนักงาน
2. กด **Adjust Wallet** → ใส่จำนวน (บวก = เติม, ลบ = หัก) → ใส่เหตุผล
3. กด **Confirm**

### Cashier เติมเงินที่ POS (Cashier Top-Up)

**Cashier ของทุกร้าน** เติมเงินให้นักเรียน/ผู้ปกครอง/พนักงานคนไหนก็ได้ (ไม่จำกัด shop scope)

#### A. เติมเงินสด (Cash Top-Up)
1. Canteen/Store POS → กดปุ่ม **เติมเงิน** (Wallet icon บนขวา)
2. ค้นหาสมาชิก (ชื่อ/รหัส) → เลือก
3. เลือก **Cash** → กรอกจำนวน → กด **Confirm**
4. ยอดเงินเพิ่มทันที (cashier เก็บเงินสดเข้ามือ — ไม่ผ่าน gateway)

#### B. เติมเงินผ่าน QR PromptPay (BAY)
1. Canteen/Store POS → กดปุ่ม **เติมเงิน** → ค้นหาสมาชิก → เลือก
2. เลือก **QR** → กรอกจำนวน → ระบบสร้าง QR PromptPay จาก BAY
3. โชว์ QR ให้ลูกค้าสแกนด้วยแอปธนาคาร
4. **รอ** — เมื่อลูกค้าโอนเงินเสร็จ BAY จะยิง callback มาที่ระบบและ confirm อัตโนมัติ ยอดเงิน wallet จะเพิ่มเอง
5. ถ้าลูกค้าไม่จ่าย → กด **Cancel** เพื่อยกเลิก QR แล้วลองวิธีอื่น

> ⚠️ **ห้าม cashier กดยืนยันการจ่าย QR เอง** — ระบบไม่มีปุ่ม "Mark as Paid" แล้ว เพื่อป้องกันการเติมเงินโดยไม่มีการชำระจริง. ถ้า callback ไม่มา (BAY ล่ม) ให้ Admin manual adjust แทน

#### C. เติมเงินผ่าน EDC ของ Bay
1. เลือก **EDC** ตอนเติมเงิน → กรอกจำนวน
2. รูด/แตะบัตรที่เครื่อง EDC → ได้ slip
3. พิมพ์ Approval Code กลับเข้าระบบ → Confirm

### เติมเงิน Department Wallet
1. Admin → **Department Adjust** (เมนู Cardholders)
2. เลือกแผนก → เลือก Credit (+) หรือ Debit (-)
3. กรอกจำนวน + เหตุผล → กด Submit

---

## 6. ดูประวัติการทำรายการ (View Transaction History)

### ผู้ปกครอง/นักเรียน
- Parent Portal → **Transaction History** (เลือกลูก)
- กรองได้ด้วย date range
- กดแถวเพื่อดู **Receipt Detail** (ชื่อร้าน, รายการ, ยอดเงินหลังชำระ)

### Cashier/Manager
- Canteen → **Receipts** → ดูรายการขายของร้าน
- กดใบเสร็จเพื่อดูรายละเอียด

### Admin
- Admin → Dashboard → **Recent Activity** (auto-refresh ทุก 30 วินาที)
- Admin → Cardholders → เลือกคน → ดู wallet transactions

---

## 7. แก้ไขใบเสร็จ / Void (Cancel / Void Receipt)

### ขั้นตอนการ Void
1. Store/Canteen → **Receipts** → ค้นหาใบเสร็จ
2. กดที่ใบเสร็จ → **Void Receipt**
3. เลือกเหตุผลจาก chip preset (เช่น "Incorrect Transaction", "Customer Changed Mind") **หรือ** chip ที่ manager สร้างเอง **หรือ** พิมพ์เองในช่อง textarea
4. กด **Confirm Void**
5. สต็อกจะกลับคืน + ยอดเงิน wallet จะ refund อัตโนมัติ (ถ้าจ่ายผ่าน wallet)

### Chip เหตุผล (Preset 6 อันมาตรฐาน)
ทุกร้านจะเห็น chip ครบทั้ง 6:
- Incorrect Transaction / ทำรายการผิด
- Customer Changed Mind / ลูกค้าเปลี่ยนใจ
- Out of Stock / สินค้าหมด
- Incorrect Price / ราคาไม่ถูกต้อง
- Duplicate Payment / ชำระเงินซ้ำ
- Test Transaction / ทดสอบระบบ

### Custom Shortcut (Manager แต่ละร้านสร้างเองได้)

**Manager** ของร้านจะเห็นปุ่ม **+ Add** สีส้มที่ท้ายแถว chip

**เพิ่ม shortcut:**
1. ใน Void Receipt dialog → กดปุ่ม **+ Add**
2. พิมพ์เหตุผล (เช่น "ผิดแผนก", "Wrong dept", "ลูกค้าให้ผัดไทยใส่ไข่ทอด") — ยาวไม่เกิน 60 ตัวอักษร
3. กด **Save** → chip ใหม่จะขึ้นมาที่ท้ายแถวพร้อมปุ่ม × สำหรับลบ
4. **Cashier และ Manager ทุกคนของร้านนี้** จะเห็น chip นี้ทันที (shared)

**ลบ shortcut:** Manager กดปุ่ม **×** ข้าง chip → ลบทันที (ไม่มี undo)

**ข้อจำกัด:**
- Cashier: เห็น chip แต่กดเพิ่ม/ลบไม่ได้ (ปุ่ม + Add / × ไม่แสดง)
- Manager: แก้ได้เฉพาะร้านตัวเอง (Manager Coop แก้ chip ของ Sports ไม่ได้)
- Admin: แก้ได้ทุกร้าน
- Max 24 chips ต่อร้าน, ยาวไม่เกิน 60 char/chip
- Chip ของแต่ละร้านแยกขาดกัน ไม่ shared ข้ามร้าน

---

## 8. ตั้งค่าร้านค้าให้รองรับ Department Charge

1. Login Admin → **Admin → Shops** → กดร้านที่ต้องการ
2. เปิดสวิตช์ **Allow Department Charge**
3. บันทึก — ร้านนี้จะรับชำระด้วย department code ได้แล้ว

---

## 9. ดูใบเสร็จ (View Receipt Detail)

Receipt dialog แสดง:
- **Receipt ID** + วันที่/เวลา
- **วิธีชำระ** (wallet / cash / department / QR)
- **ผู้ชำระ**: ชื่อ + รหัส + **ยอดคงเหลือหลังชำระ** (ณ เวลานั้น ไม่ใช่ยอดปัจจุบัน)
- **ร้านค้า** + ชื่อพนักงาน (cashier)
- รายการสินค้า + ส่วนลด + Grand Total
- ปุ่ม **Download Receipt** (PDF — coming soon)

---

## 10. Troubleshooting

| ปัญหา | วิธีแก้ |
|-------|--------|
| "ไม่พบข้อมูลในระบบ" ใน RFID modal | ตรวจสอบว่า student code / card UID ถูกต้อง และผูกไว้แล้ว |
| Department code ค้นหาไม่เจอ | ตรวจสอบว่า department ถูกสร้างแล้วใน Admin → Cardholders |
| Department charge ไม่ได้ | เปิด `allow_department_charge` ในการตั้งค่าร้านค้า |
| ยอดเงิน wallet ไม่อัปเดต | Refresh หน้า หรือรอ auto-refresh |
| Login ไม่ได้ | ตรวจสอบ username/password — Admin ใช้ `admin` / `admin1234` |
| Canteen POS ค้นหาสมาชิกแล้วหน้าช้า | ระบบ search debounce 300ms — รอสักครู่ |
| Cashier เปิดเติมเงิน QR แล้ว "Failed to create QR" | ฟ้องว่า 403 = bug เก่า ก่อน 2026-06-21. **แก้แล้ว** — ถ้ายังเจอ ให้ clear cache + reload, หรือเช็คว่า role ของ user เป็น cashier/manager จริง |
| QR เติมเงินผ่านแล้วยอดไม่เข้า | รอ BAY callback (อาจ 30-60 วินาที). ถ้านานกว่านี้ → Admin ดู Railway log ของ `/api/v1/bay/callback` หรือกด **Inquiry** ที่ POS เพื่อบังคับเช็คกับ BAY |
| Cashier หาปุ่ม "Mark as Paid" ใน QR top-up modal ไม่เจอ | ปุ่มถูกลบในวันที่ 2026-06-22 เพื่อป้องกันการเติมเงินโดยไม่จ่ายจริง — รอ BAY callback อัตโนมัติแทน. ถ้า BAY ล่ม → Admin manual adjust |
| Manager กด + Add chip แล้วบันทึกไม่ติด | เช็คว่า manager นี้ assigned ให้ shop ที่กำลังดูจริงๆ (manager ของร้านอื่นไม่มีสิทธิ์), และเช็คว่าไม่เกิน 24 chips/ร้าน |
| Manager Coop ไม่เห็น chip ของ Manager Sports | ตามดีไซน์ — chip แยกขาดต่อร้าน ไม่ shared ข้ามร้าน |
