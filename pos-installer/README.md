# ISB POS Setup — Windows Installer

ตัวติดตั้ง (`.exe`) สำหรับ provision เครื่อง POS ของ ISB บน Windows —
รวม 3 component: driver เครื่องรูดบัตร EDC, Paywire bridge, และ RFID
bridge service (ACR1252)

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
4. คัดลอกไฟล์ที่จำเป็นจาก `rfid-bridge/` ในนี้ (เฉพาะ `rfid-server.js`,
   `package.json`, `package-lock.json`, `test-reader.js`, `README.md` —
   ไม่รวม `node_modules`, `logs`, สคริปต์ `setup-*.ps1`)
5. ดาวน์โหลด Node.js portable (win-x64) จาก nodejs.org แล้วแตกไฟล์ไปที่
   `payload/node/` (cache ไว้ที่ `cache/` กัน re-download ตอน rebuild)
6. ดาวน์โหลด NSSM 2.24 จาก nssm.cc แล้วแตก `win64/nssm.exe` ไปที่
   `payload/nssm.exe` (cache ไว้เหมือนกัน)
7. ถ้ามี `pos-installer/prebuilt-node_modules.zip` จะ bundle
   `node_modules` เข้าไปด้วย (ดูหัวข้อ OFFLINE ด้านล่าง) — ไม่งั้นจะปล่อยให้
   ตัวติดตั้งรัน `npm install` บนเครื่อง POS แทน (ต้องมีอินเทอร์เน็ต)
8. รัน `makensis installer.nsi` ได้ output ที่
   `pos-installer/dist/ISB-POS-Setup-1.0.0.exe`

Rebuild ครั้งถัดไปจะเร็วขึ้นเพราะไฟล์ที่ดาวน์โหลดถูก cache ไว้ใน
`pos-installer/cache/` แล้ว (ลบโฟลเดอร์นี้ทิ้งได้ถ้าอยากบังคับ
ดาวน์โหลดใหม่)

## โหมด OFFLINE (บังคับ) vs ONLINE (opt-in เท่านั้น)

RFID bridge ต้อง compile native module (`@pokusew/pcsclite`) ตอน
`npm install` ซึ่งต้องมี Visual Studio Build Tools (C++ workload) บน
เครื่อง POS — เครื่อง POS ที่เพิ่ง provision ใหม่แทบไม่มีทางมีสิ่งนี้ครบ
`build.sh` เลย **บังคับ OFFLINE mode โดย default** (จะ error ทันทีถ้าไม่มี
`pos-installer/prebuilt-node_modules.zip`) เพื่อไม่ให้ build ที่พึ่ง
`npm install` บนเครื่อง POS หลุดออกไปโดยไม่ตั้งใจ

วิธีสร้าง `prebuilt-node_modules.zip`:

1. ที่เครื่อง POS ที่ setup สำเร็จแล้ว (เช่น `C:\Users\isb\Desktop\rfid-bridge`)
   ให้ zip โฟลเดอร์ `node_modules` ทั้งหมด:
   ```powershell
   Compress-Archive -Path "C:\Users\isb\Desktop\rfid-bridge\node_modules" `
     -DestinationPath "node_modules.zip"
   ```
   (zip นี้ต้องมี top-level folder ชื่อ `node_modules/` อยู่ข้างใน)
2. ย้ายไฟล์มาไว้ที่ `pos-installer/prebuilt-node_modules.zip` บน Mac
3. รัน `./build.sh` ใหม่ — script จะ log ว่าเข้าโหมด **OFFLINE** และ bundle
   `node_modules` เข้าไปใน installer เลย ตัวติดตั้งบนเครื่อง POS เครื่องอื่น
   จะข้าม `npm install` ไปเลย (ไม่ต้องมี Build Tools/อินเทอร์เน็ตบนเครื่อง POS)

ถ้าต้องการ build แบบ ONLINE จริงๆ (เช่น ทดสอบบนเครื่อง dev ที่มีเน็ต/Build
Tools อยู่แล้ว) ต้อง opt-in ชัดเจน:
```bash
ALLOW_ONLINE_BUILD=1 ./build.sh
```

> **สำคัญ:** zip ต้องมาจากเครื่อง POS Windows เท่านั้น — ห้ามใช้
> `node_modules` จากเครื่อง Mac/Linux (native module `pcsclite.node`
> จะเป็น binary คนละ platform รันบน Windows ไม่ได้) — `build.sh` มี guard
> ตรวจไฟล์ `pcsclite.node` ให้อัตโนมัติ: ต้องเป็น Windows x64 DLL (`PE32+`)
> ถ้าตรวจพบว่าเป็น Mach-O (Mac) หรือ ELF (Linux) จะ abort พร้อมข้อความแนะนำ
> และลบ `node_modules` ที่แตกไว้ออกจาก payload ให้ด้วย
>
> **Node ABI:** `node_modules` ต้อง build ด้วย Node **v26.x** ให้ตรงกับ
> Node.js portable ที่ bundle มากับ installer (v26.5.0) — native module ที่
> compile กับ Node major version อื่นจะโหลดไม่ได้ (ABI mismatch)

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
3. **RFID bridge service (ACR1252 + NSSM)** — copy `rfid-bridge/`,
   `node/` (Node.js portable), `nssm.exe` ไปที่ `C:\ISB\` แล้วรัน
   `install-rfid-service.ps1` เพื่อลงทะเบียน Windows Service ชื่อ
   `rfid-bridge` (auto-start, auto-restart เมื่อ crash, listen ที่
   `ws://localhost:9001`)

หลังติดตั้งเสร็จจะมี `C:\ISB\uninstall.exe` และรายการใน
"Add or Remove Programs" ชื่อ **ISB POS Components**

## ขั้นตอนติดตั้งสำหรับ operator

1. Copy `ISB-POS-Setup-1.0.0.exe` ไปที่เครื่อง POS
2. คลิกขวา → **Run as administrator**
3. ผ่านหน้า Welcome → เลือก component (ปล่อย default ติ๊กไว้ทั้งหมด) →
   เลือกโฟลเดอร์ติดตั้ง (default `C:\ISB`) → Install
4. รอจนจบ — ทุกอย่างเป็น unattended ทั้งหมด (ไม่มี popup ให้กด, ไม่ต้องมี
   เน็ต/Build Tools บนเครื่อง POS): driver ติดตั้งเงียบๆ ~30 วิ, RFID
   service ลงทะเบียนจาก node_modules ที่ bundle มาให้แล้ว (หน้าต่าง
   PowerShell จะแสดง log เป็นภาษาไทยระหว่างขั้นตอนนี้ แต่ไม่ต้องกดอะไร)
5. กด Finish

## ตรวจสอบหลังติดตั้ง — เช็คทีละ component ว่าทำงานจริงไหม

ทำตามลำดับนี้ทีละข้อ ถ้าข้อไหนไม่ผ่านให้แก้ก่อนไปข้อถัดไป (ข้อหลังๆ มักพึ่งข้อก่อนหน้า)

### 1. EDC card terminal USB driver

```powershell
# เปิด Device Manager แล้วเช็คด้วยตา (มีเครื่องหมาย ! สีเหลืองไหม)
devmgmt.msc
```
ไปที่ **Ports (COM & LPT)** หรือ **Universal Serial Bus controllers** — ต้องเห็นอุปกรณ์ Newland (เช่น "FuJian Newland Payment USB2UART") **ไม่มีเครื่องหมาย ⚠️ สีเหลือง** ถ้ามีเครื่องหมายเตือน = driver ไม่สมบูรณ์ ให้ดู `pos-installer/payload/driver/DriverInstall_Guide.pdf` หัวข้อ "Common exception handling"

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

### 3. RFID bridge service (ACR1252 + NSSM)

```powershell
# 1) service ต้องขึ้น Running
Get-Service rfid-bridge

# 2) port 9001 ต้องเปิดฟัง
Get-NetTCPConnection -LocalPort 9001 -State Listen

# 3) ดู log สด (เปิดค้างไว้แล้วลองแตะบัตรดูคู่กับข้อ 5)
Get-Content C:\ISB\rfid-bridge\logs\out.log -Tail 20 -Wait
```
ถ้า `Get-Service` ไม่เจอ service เลย ให้ดูหัวข้อ "แก้ปัญหา RFID service ไม่ขึ้น" ด้านล่าง

### 4. Chrome Local Network Access policy (จำเป็นสำหรับหน้าเว็บต่อ RFID ได้)

Chrome เวอร์ชันใหม่บล็อกเว็บสาธารณะ (เช่น `isb.schooney.tech`) ไม่ให้ต่อ
`ws://localhost:9001` เอง ต้อง whitelist ผ่าน Enterprise Policy ก่อน:

```powershell
# ตั้งค่า (ทำครั้งเดียวต่อเครื่อง)
New-Item -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Name "1" -Value "isb.schooney.tech"
```
แล้ว **ปิด Chrome ทั้งหมด** (ทุกหน้าต่าง ไม่ใช่แค่ปิด tab) เปิดใหม่ แล้วเช็คว่า policy ถูกอ่านจริง:
```
chrome://policy
```
ค้นหา `LocalNetworkAccessAllowedForUrls` — ต้องขึ้นสถานะ **OK** พร้อมค่า `isb.schooney.tech` ถ้าไม่เจอในลิสต์ = restart Chrome ไม่สุด หรือ registry path/ค่าผิด

### 5. ทดสอบจริงจากหน้าเว็บ (end-to-end)

1. เปิดหน้าชำระเงินของ POS ใน Chrome (hard refresh `Ctrl+Shift+R` ก่อน)
2. **EDC**: ดูสถานะ — ควรขึ้นวงกลม/pill สีเขียว "connected"
3. **RFID**: แตะบัตรที่เครื่องอ่าน ACR1252 — หน้าจอควรอ่าน UID ได้ทันที
   (ดู log จากข้อ 3.3 คู่กันได้ ควรเห็น `📢 Broadcasting card UID: ...`
   ขึ้นพร้อมกับที่แอปตอบสนอง)
4. เปิด DevTools (F12) → Console — **ต้องไม่มี** error สีแดงเกี่ยวกับ
   `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` หรือ Content Security Policy

### แก้ปัญหา RFID service ไม่ขึ้น (`Get-Service rfid-bridge` ไม่เจอ)

รันสคริปต์ตัวเดิมด้วยมือเพื่อดู error สดๆ ว่าค้าง/พังตรงไหน:
```powershell
cd C:\ISB
powershell -ExecutionPolicy Bypass -File install-rfid-service.ps1
```
ดู error ที่ขั้นตอนไหน (0️⃣-7️⃣) แล้วอ้างอิงตามนั้น — สาเหตุที่เจอมาแล้ว:
สคริปต์เป็น UTF-8 ไม่มี BOM ทำให้ PowerShell อ่านคอมเมนต์ภาษาไทยผิดจน parse
ทั้งไฟล์พัง (แก้แล้วใน build ปัจจุบัน — ถ้าเจออีกแปลว่าไฟล์ถูกแก้ทับด้วย
encoding ผิดอีกครั้ง)

## ถอนการติดตั้ง

ใช้ "Add or Remove Programs" → "ISB POS Components" → Uninstall หรือรัน
`C:\ISB\uninstall.exe` โดยตรง — จะ stop + remove `rfid-bridge` Windows
Service, ลบ shortcut ของ Paywire (Startup + Desktop), แล้วลบโฟลเดอร์
`C:\ISB` ทั้งหมด **ไม่ถอน driver ของ EDC** ออก (driver ยังอยู่บนเครื่อง
ตามปกติของ Windows driver)
