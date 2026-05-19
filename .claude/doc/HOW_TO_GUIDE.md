# Schooney POS — How-To Guide

> คู่มือการใช้งานระบบ ISB Schooney POS
> Last updated: 2026-05-19

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

#### QR/PromptPay
1. เลือก **QR** → QR code จะแสดง → ลูกค้าสแกน → กด **Confirm**

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
1. Canteen POS → กดปุ่ม **เติมเงิน** (Wallet icon บนขวา)
2. ค้นหาสมาชิก → กรอกจำนวน → Confirm

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

1. Store/Canteen → **Receipts** → ค้นหาใบเสร็จ
2. กดที่ใบเสร็จ → **Void Receipt**
3. ใส่เหตุผล → ยืนยัน
4. สต็อกจะกลับคืน + ยอดเงิน wallet จะ refund อัตโนมัติ

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
