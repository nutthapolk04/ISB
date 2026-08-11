# ISB POS Setup — Windows Installer

ตัวติดตั้ง (`.exe`) สำหรับ provision เครื่อง POS ของ ISB บน Windows —
รวม 3 component: driver เครื่องรูดบัตร EDC, Paywire bridge, และ Chrome
kiosk auto-start (เปิด `https://campuscard.isb.ac.th/login` อัตโนมัติทุกครั้งที่ล็อกอิน)

> **RFID bridge (ACR1252) ถูกตัดออกจาก installer ตัวนี้แล้ว** — build นี้
> สำหรับเครื่อง POS ที่ใช้ EDC อย่างเดียว ถ้าเครื่องไหนยังต้องการ RFID ให้ใช้
> `rfid-bridge/` ที่ root ของ repo แยกต่างหาก (ยังอยู่ครบ ไม่ได้ถูกลบ)

## Build บน Mac

Build machine ที่ใช้คือ macOS พร้อม NSIS 3 (Unicode) ติดตั้งไว้ที่
`/opt/homebrew/bin/makensis`

```bash
cd pos-installer
./build.sh
```

Script จะ:

1. ล้าง `payload/` แล้วสร้างใหม่
2. คัดลอก `paywire.exe` จาก `~/Downloads/Paywire_1.0.0/paywire.exe`
   (ไม่รวม `sdk-js` — ไม่จำเป็นบนเครื่อง POS)
3. แตกไฟล์ `~/Downloads/whql_Driver2020.zip` ไปที่ `payload/driver/`
4. รัน `makensis installer.nsi` ได้ output ที่
   `pos-installer/dist/ISB-POS-Setup-1.0.0.exe`

ไม่มีการดาวน์โหลดอะไรจากอินเทอร์เน็ตอีกแล้ว (ตัด Node.js portable + NSSM +
prebuilt node_modules ที่เคยใช้สำหรับ RFID ออกทั้งหมด) — build เร็วขึ้นมาก
และ output เล็กลงจาก ~157MB เหลือ ~128MB

## ตัวติดตั้งทำอะไรบนเครื่อง POS

`ISB-POS-Setup-1.0.0.exe` ต้องรันแบบ **Run as administrator** และมี
3 component ให้เลือก (ติ๊กไว้ทั้งหมดโดย default):

1. **EDC card terminal USB driver (whql_Driver2020)** — copy ไฟล์ไปที่
   `C:\ISB\driver\` แล้วรัน `DriverInstall.exe` ของ vendor แบบ unattended
   (ตัว exe เองไม่มี wizard/popup ให้กด ติดตั้ง usb/adb/qcusber/modem
   driver ให้ทั้งหมดอัตโนมัติภายใน ~30 วิ ตาม `DriverInstall_Guide.pdf`
   — installer ของเราแค่ป้อน keypress ว่างๆ เข้า stdin ให้ เพราะ exe ตัวนี้
   จบด้วย "Press any key to exit" ซึ่งจะค้างรอถ้าไม่มีคนกดจริง)
2. **Paywire EDC bridge** — copy `paywire.exe` ไปที่ `C:\ISB\paywire\`,
   สร้าง shortcut ใน Startup (all users) + Desktop ชื่อ "Paywire Bridge"
   แล้วเปิดโปรแกรมทันทีหลังติดตั้งเสร็จ
3. **Chrome kiosk auto-start** — ตั้ง Chrome enterprise policy
   `LocalNetworkAccessAllowedForUrls = campuscard.isb.ac.th` (ให้หน้าเว็บต่อ
   Paywire bridge ที่ `127.0.0.1:7331` ได้โดยไม่โดน permission prompt บล็อก)
   แล้วสร้าง shortcut ใน Startup (all users) ชื่อ "ISB POS Kiosk" ที่เปิด
   Chrome แบบ `--kiosk https://campuscard.isb.ac.th/login` ทุกครั้งที่ล็อกอิน
   และเปิดให้ทันทีหลังติดตั้งเสร็จเพื่อให้ operator เช็คได้เลย

หลังติดตั้งเสร็จจะมี `C:\ISB\uninstall.exe` และรายการใน
"Add or Remove Programs" ชื่อ **ISB POS Components**

## ขั้นตอนติดตั้งสำหรับ operator

1. Copy `ISB-POS-Setup-1.0.0.exe` ไปที่เครื่อง POS
2. คลิกขวา → **Run as administrator**
3. ผ่านหน้า Welcome → เลือก component (ปล่อย default ติ๊กไว้ทั้งหมด) →
   เลือกโฟลเดอร์ติดตั้ง (default `C:\ISB`) → Install
4. รอจนจบ — ทุกอย่างเป็น unattended ทั้งหมด (ไม่มี popup ให้กด, ไม่ต้องมี
   เน็ตบนเครื่อง POS): driver ติดตั้งเงียบๆ ~30 วิ, Paywire bridge +
   Chrome kiosk เปิดขึ้นมาให้เห็นตอนท้าย
5. กด Finish
6. **ปิด Chrome ทุกหน้าต่างแล้วเปิดใหม่ 1 ครั้ง** เพื่อให้ Local Network
   Access policy มีผล (ดูหัวข้อถัดไป) — ไม่ทำขั้นตอนนี้ = EDC bridge
   connect ไม่ติดตอนใช้งานจริง

## ตรวจสอบหลังติดตั้ง — เช็คทีละ component ว่าทำงานจริงไหม

**ทางลัด**: รันสคริปต์ `check-pos.ps1` ที่ติดตั้งมาให้แล้วที่ `C:\ISB\` —
เช็คทั้ง 4 อย่างด้านล่าง **และแก้ให้อัตโนมัติเท่าที่ทำได้** ในครั้งเดียว
(ลง patch driver, เปิด Paywire ที่ค้าง, สร้าง kiosk shortcut ใหม่, ตั้งค่า
Chrome policy) พร้อมสรุปผล OK/FAIL แยกรายการท้ายสุด — **ต้อง Run as
administrator** (ลง Windows patch/เขียน registry ให้), รันซ้ำได้ไม่จำกัด:

```powershell
cd C:\ISB
powershell -ExecutionPolicy Bypass -File check-pos.ps1
```

รายละเอียดแต่ละข้อที่สคริปต์เช็ค (เผื่อต้องดีบักเองว่าทำไมข้อไหนไม่ผ่าน) —
ทำตามลำดับนี้ทีละข้อ ถ้าข้อไหนไม่ผ่านให้แก้ก่อนไปข้อถัดไป (ข้อหลังๆ มักพึ่งข้อก่อนหน้า)

### 1. EDC card terminal USB driver

```powershell
# เปิด Device Manager แล้วเช็คด้วยตา (มีเครื่องหมาย ! สีเหลืองไหม)
devmgmt.msc
```
ไปที่ **Ports (COM & LPT)** หรือ **Universal Serial Bus controllers** — ต้องเห็นอุปกรณ์ Newland (เช่น "FuJian Newland Payment USB2UART") **ไม่มีเครื่องหมาย ⚠️ สีเหลือง**

**ถ้ามีเครื่องหมายเหลือง** — `check-pos.ps1` ที่รันไปแล้วด้านบนจะเรียก
`fix-edc-driver.ps1` ให้อัตโนมัติอยู่แล้ว ไม่ต้องทำอะไรเพิ่ม แต่ถ้าอยากรัน
ตัวแก้ driver อย่างเดียวก็ทำได้เช่นกัน (ต้อง Run as administrator):
```powershell
cd C:\ISB
powershell -ExecutionPolicy Bypass -File fix-edc-driver.ps1
```
สคริปต์นี้ทำตาม `DriverInstall_Guide.pdf` หัวข้อ 4.3 ให้อัตโนมัติ: เช็ค Windows Service Pack 1 (เฉพาะ Win7) → ลง patch `Windows6.1-KB3033929-x64.msu` ที่ bundle มาให้แล้ว → สั่ง rescan hardware — ถ้ายังไม่หายให้ทำ manual update driver เอง (ดู `DriverInstall_Guide.pdf` หัวข้อ 4.5 หรือ INSTALL-GUIDE.html หัวข้อแก้ปัญหา)

### 2. Paywire EDC bridge

```powershell
# เช็คว่า process กำลังรันอยู่
Get-Process paywire -ErrorAction SilentlyContinue
```
ถ้าไม่เจอ ให้เปิดเองจาก shortcut "Paywire Bridge" บน Desktop หรือ Startup — ควรเห็นไอคอนขึ้นใน system tray มุมขวาล่าง

**เช็คว่า bridge ตอบสนองจริง** (รันบนเครื่อง POS เท่านั้น — โดเมนนี้ resolve เป็น localhost เสมอ):
```powershell
curl.exe -sk https://pos.local.bridge.schooney.tech:7331/whoami
```
ต้องได้ JSON ตอบกลับ (ไม่ใช่ connection refused/timeout)

### 3. Chrome kiosk auto-start + Local Network Access policy

```powershell
# shortcut ต้องมีอยู่
Test-Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\ISB POS Kiosk.lnk"
```

ตรวจว่า policy ถูกอ่านจริงได้ที่:
```
chrome://policy
```
ค้นหา `LocalNetworkAccessAllowedForUrls` — ต้องขึ้นสถานะ **OK** พร้อมค่า `campuscard.isb.ac.th` ถ้าไม่เจอในลิสต์ หรือขึ้น error/ignored ให้เช็คตามนี้:

- **ไม่เจอเลย / ค่าไม่ขึ้น**: restart Chrome ไม่สุด (ต้องปิดทุกหน้าต่างจริงๆ ไม่ใช่แค่ปิด tab สุดท้าย — เช็คด้วย `Get-Process chrome` ต้องไม่มี process เหลือก่อนเปิดใหม่) หรือ registry ยังไม่ถูกเขียน (เช็ค `Get-ItemProperty "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls"`)
- **ขึ้นเป็น "Ignored" หรือชื่อ policy ไม่ตรง**: Chrome เวอร์ชันนั้นอาจเปลี่ยนชื่อ/รูปแบบ policy นี้ไปแล้ว (ฟีเจอร์นี้เพิ่งเปิดตัวและเปลี่ยนชื่อมาหลายรอบ) — เช็คเวอร์ชัน Chrome จริงบนเครื่อง (`chrome://version`) แล้วค้นหาชื่อ policy ที่ตรงกับเวอร์ชันนั้นจาก [chromeenterprise.google/policies](https://chromeenterprise.google/policies/) ก่อนแก้ registry key ใน `installer.nsi`

ถ้าต้องตั้งเอง (fallback):
```powershell
New-Item -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Name "1" -Value "campuscard.isb.ac.th"
```

### 4. ทดสอบจริงจากหน้าเว็บ (end-to-end)

1. เปิดหน้าชำระเงินของ POS ใน Chrome (hard refresh `Ctrl+Shift+R` ก่อน — ถ้าเปิดผ่าน kiosk shortcut อยู่แล้วให้ปิด Chrome ทั้งหมดแล้วเปิดใหม่แทน)
2. **EDC**: ดูสถานะ — ควรขึ้นวงกลม/pill สีเขียว "connected"
3. เปิด DevTools (F12) → Console — **ต้องไม่มี** error สีแดงเกี่ยวกับ
   `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` หรือ Content Security Policy
   (ถ้ามี = ข้อ 3 ด้านบนยังไม่ผ่าน ย้อนกลับไปเช็ค `chrome://policy` อีกที)

## ถอนการติดตั้ง

ใช้ "Add or Remove Programs" → "ISB POS Components" → Uninstall หรือรัน
`C:\ISB\uninstall.exe` โดยตรง — จะลบ shortcut ของ Paywire และ Kiosk
(Startup + Desktop), ลบ Local Network Access policy ที่ installer เพิ่มไว้,
แล้วลบโฟลเดอร์ `C:\ISB` ทั้งหมด **ไม่ถอน driver ของ EDC หรือ Chrome เอง**
ออก (driver/Chrome ยังอยู่บนเครื่องตามปกติ)
