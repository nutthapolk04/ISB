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

## โหมด ONLINE vs OFFLINE (npm install บน POS)

RFID bridge ต้อง compile native module (`@pokusew/pcsclite`) ตอน
`npm install` ซึ่งต้องมี Visual Studio Build Tools (C++ workload) บน
เครื่อง POS — ถ้าไม่อยากพึ่งอินเทอร์เน็ต/Build Tools บนเครื่อง POS ทุกครั้ง
ให้ทำ **OFFLINE trick** นี้:

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
   จะข้าม `npm install` ไปเลย (เร็วกว่า ไม่ต้องมี Build Tools/อินเทอร์เน็ต)

ถ้าไม่มี `prebuilt-node_modules.zip` จะเป็นโหมด **ONLINE** โดย default —
`install-rfid-service.ps1` จะรัน `npm install` บนเครื่อง POS เอง
(ต้องมีอินเทอร์เน็ต + แนะนำให้มี Build Tools ติดตั้งไว้ก่อน)

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
   `C:\ISB\driver\` แล้วเปิด `DriverInstall.exe` ของ vendor ให้ operator
   กดตามขั้นตอนเอง (ไม่ silent — เป็น installer ของ vendor)
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
4. รอ driver wizard (ถ้ามี popup ให้กดตามขั้นตอน) และรอสคริปต์ RFID
   service ทำงานจนจบ (หน้าต่าง PowerShell จะแสดง log เป็นภาษาไทย)
5. กด Finish

## ตรวจสอบหลังติดตั้ง

- **EDC**: เปิดหน้าจอชำระเงินของ POS แล้วดูสถานะ EDC — ควรขึ้น
  วงกลม/pill สีเขียว (connected) ถ้า driver + Paywire bridge รันอยู่
- **RFID**: แตะบัตรที่เครื่องอ่าน ACR1252 — หน้าจอ POS ควรอ่าน UID ได้
  ทันที (bridge ส่งผ่าน `ws://localhost:9001` ซึ่ง CSP ของเว็บแอปอนุญาต
  ไว้แล้ว ไม่ต้อง config เพิ่ม)
- เช็ค service ได้ด้วย PowerShell: `Get-Service rfid-bridge`
- ดู log ได้ที่ `C:\ISB\rfid-bridge\logs\out.log` และ `err.log`

## ถอนการติดตั้ง

ใช้ "Add or Remove Programs" → "ISB POS Components" → Uninstall หรือรัน
`C:\ISB\uninstall.exe` โดยตรง — จะ stop + remove `rfid-bridge` Windows
Service, ลบ shortcut ของ Paywire (Startup + Desktop), แล้วลบโฟลเดอร์
`C:\ISB` ทั้งหมด **ไม่ถอน driver ของ EDC** ออก (driver ยังอยู่บนเครื่อง
ตามปกติของ Windows driver)
