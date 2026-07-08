# สรุปงาน: ใบเสร็จ Kiosk + จำกัดวงเงินสูงสุด

อัปเดตล่าสุด: 2026-07-01 · Branch: `charp`

เอกสารนี้สรุปงาน 2 ก้อนที่เพิ่มเข้าระบบ Kiosk (Android): (1) การออก/พิมพ์ใบเสร็จผ่านเครื่องพิมพ์ความร้อน USB และ (2) การจำกัดวงเงินสูงสุดของบัตร 50,000 บาท

---

## 1. ใบเสร็จ (Receipt Printing)

### 1.1 ภาพรวม
- เครื่อง Kiosk เป็น **Android** (FM-3568D)
- เครื่องพิมพ์เป็น **USB thermal printer 80mm** (ไม่ใช่ serial): `ID 0519:2013`, USB printer class 7, ต่ออยู่ที่ `/dev/bus/usb/001/004`
- พิมพ์ผ่าน **Android USB Host API** (`UsbManager` + `bulkTransfer`) — ไม่ใช่ `window.print()` ของเบราว์เซอร์
- ภาษาไทยบนใบเสร็จใช้วิธี **render เป็นรูป (bitmap) แล้วส่งเป็น ESC/POS raster** เพื่อเลี่ยงปัญหา code page/ฟอนต์ของเครื่องพิมพ์

### 1.2 สถาปัตยกรรม (ไหลจากบนลงล่าง)
```
TopUpView / ReceiptPreview (Vue)
   └─ usePrinter() ── buildReceipt(data) ──> escpos.ts
                                              (วาด canvas 576px → 1-bit → GS v 0 raster → base64)
   └─ Hardware.printRaw({ data: base64 })  (Capacitor plugin bridge)
        └─ HardwarePlugin.kt (Kotlin)
             └─ PrinterManager.kt  (USB: auto-detect class-7, ขอ permission, bulkTransfer แบบ chunk)
```
หลักการ: **ESC/POS logic อยู่ฝั่ง JS ทั้งหมด**, ฝั่ง native แค่รับ base64 แล้วเขียนลง endpoint bulk-OUT ของเครื่องพิมพ์

### 1.3 ไฟล์ที่เพิ่ม/แก้
| ไฟล์ | หน้าที่ |
|---|---|
| `plugins/capacitor-hardware/android/.../printer/PrinterManager.kt` | (ใหม่) จัดการ USB printer: ค้นหาอุปกรณ์ printer class 7, ขอ USB permission, `bulkTransfer` แบ่ง chunk 8KB, มี `describeDevices()` ไว้ดีบัก |
| `plugins/capacitor-hardware/android/.../HardwarePlugin.kt` | เพิ่มเมธอด `connectPrinter` / `printRaw` / `disconnectPrinter` |
| `plugins/capacitor-hardware/src/definitions.ts`, `web.ts` | เพิ่ม signature + web stub |
| `kiosk/src/lib/escpos.ts` | (ใหม่) renderer ใบเสร็จ → ESC/POS raster (รองรับโลโก้, รายการสินค้า+ตัวเลือกเสริม, ยอดก่อน/หลัง) |
| `kiosk/src/hooks/usePrinter.ts` | (ใหม่) composable: connect ตอน boot, lazy-reconnect, `printReceipt()` |
| `kiosk/src/App.vue` | เรียก `connectPrinter()` ตอนเปิดแอป |
| `kiosk/src/hooks/useBillAcceptor.ts` | `finalizeTopUp` คืน `{ transaction_id, balance_after }` (เดิมทิ้ง) เพื่อออกใบเสร็จให้ถูกต้อง |
| `kiosk/src/views/TopUpView.vue` | หน้า success: พิมพ์อัตโนมัติ 1 ครั้ง + ปุ่มพิมพ์ + สถานะพิมพ์ |
| `kiosk/src/components/ReceiptPreview.vue` | หน้าประวัติ: ปุ่มพิมพ์เปลี่ยนจาก `window.print()` เป็นพิมพ์ผ่าน USB (รองรับทั้ง topup และ purchase ที่มีรายการสินค้า) |
| `kiosk/android/app/src/main/AndroidManifest.xml` | เพิ่ม `<uses-feature android:name="android.hardware.usb.host" />` |

### 1.4 จุดพิมพ์ใบเสร็จ
1. **หลังเติมเงินสำเร็จ** (TopUpView) — พิมพ์อัตโนมัติ + มีปุ่ม "พิมพ์ใบเสร็จ / พิมพ์อีกครั้ง"
2. **หน้าประวัติรายการ** (ReceiptPreview) — แตะรายการ → กด "พิมพ์ใบเสร็จ"

ทั้งคู่แสดงสถานะ: กำลังพิมพ์ / พิมพ์แล้ว / ล้มเหลว (พร้อมข้อความ error)

### 1.5 สถานะการทดสอบ
- ✅ Kotlin/Java compile ผ่าน, typecheck ผ่าน, build+install APK ผ่าน
- ✅ log ยืนยัน `connectPrinter → {"connected":true}` (ต่อเครื่องพิมพ์ 0519:2013 ได้)
- ⏳ **ยังต้องยืนยันผลพิมพ์กระดาษจริง** ว่า raster ออกถูกต้อง (หมายเหตุ: VID 0x0519 มักเป็น Star Micronics — ถ้าต่อได้แต่พิมพ์ไม่ออก/เป็นขยะ ให้สงสัยว่าเครื่องอยู่ Star mode ไม่ใช่ ESC/POS)

---

## 2. จำกัดวงเงินสูงสุด 50,000 บาท

### 2.1 พฤติกรรม
- **บัตรที่ยอดเต็ม 50,000 แล้ว** → กดปุ่ม "เติมเงิน" ที่หน้า Balance จะเด้ง modal แจ้งเตือน ไม่เข้าหน้าเติมเงิน
  - TH: "ไม่สามารถทำรายการได้ — บัตรนี้มีวงเงินสูงสุด 50,000 บาทแล้ว จึงไม่สามารถเติมเงินเพิ่มได้"
  - EN: "Unable to Process Transaction — This card has already reached the maximum limit of 50,000 Baht…"
- **ยอดใกล้เต็มแล้วเติมจนเกิน** (เช่นมี 48,000 เติม 5,000) → จำกัดในหน้าเติมเงินตาม `headroom = 50,000 − ยอดปัจจุบัน`:
  - numpad พิมพ์เกิน headroom ไม่ได้
  - ปุ่มลัดที่เกิน headroom ถูก disable
  - ข้อความใต้ช่องจำนวนแสดง "เติมได้สูงสุด {headroom} บาท" แบบไดนามิก
  - เงินสด: ถ้ารับแบงค์แล้วจะเกินวงเงิน → ปุ่ม "รับเกินยอด" ถูก disable + เตือนสีแดง (เหลือแค่ "คืนแบงค์")
- **เคสขอบ:** ถ้า headroom < 100 (ต่ำกว่าขั้นต่ำ) หน้าเติมเงินขึ้นเตือนและกดยืนยันไม่ได้

### 2.2 ไฟล์ที่แก้
| ไฟล์ | หน้าที่ |
|---|---|
| `kiosk/src/views/BalanceView.vue` | `MAX_BALANCE=50000`, บล็อกปุ่มเติมเงิน + modal แจ้งเตือนเมื่อยอด ≥ 50,000 |
| `kiosk/src/views/TopUpView.vue` | `headroom`/`effectiveMax`, จำกัด numpad/ปุ่มลัด/QR/รับเกินยอด + ข้อความไดนามิก |

---

## 3. ข้อมูลฮาร์ดแวร์ที่ค้นเจอ (อ้างอิง)
- Bill acceptor NK77: serial `/dev/ttyS2` @9600 8E1
- Printer: USB `0519:2013`, printer class 7, interface `1-1.2:1.0`, endpoints ep_03 (bulk OUT) + ep_81 (IN)
- อุปกรณ์อื่นบน USB: `1eab:1d22` (scanner), `222a:0001` (touch), `1a40:0201` (hub)

## 4. วิธี Build / Deploy
```bash
# เครื่องนี้ไม่มี Java ใน PATH — ใช้ JBR ของ Android Studio
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# 1) ถ้าแก้ปลั๊กอิน capacitor-hardware
cd plugins/capacitor-hardware && npm run build

# 2) frontend + sync + APK
cd kiosk
bun install                 # ให้ types ปลั๊กอินอัปเดต
npx vue-tsc -b              # typecheck
npm run build              # build web
npx cap sync android       # หรือ bunx cap sync android
cd android && ./gradlew :app:assembleDebug

# 3) ติดตั้งลงเครื่อง (ต่อผ่าน adb-tls)
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
APK output: `kiosk/android/app/build/outputs/apk/debug/app-debug.apk`

## 5. งานที่ยังเหลือ / ข้อเสนอ
- [ ] ทดสอบพิมพ์กระดาษจริง — ยืนยัน raster/คำสั่ง cut (`GS V 66 0`) ตรงกับเครื่อง 0519:2013 (ถ้าไม่ออก สงสัย Star mode)
- [ ] (เสนอ) เพิ่มบรรทัด "ประเภทรายการ" ในใบเสร็จ (ตอนนี้รู้จากเครื่องหมาย +/− เท่านั้น)
- [ ] (เสนอ) เพิ่มหมายเหตุ "เอกสารนี้มิใช่ใบกำกับภาษี / This is not a tax invoice"
- [ ] (เสนอ) ให้ BalanceView บล็อกตั้งแต่แรกเมื่อ headroom < 100 (เลี่ยงทางตันในหน้าเติมเงิน)
