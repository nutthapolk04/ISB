# งานแก้ไข: เพิ่ม ws://localhost:9001 ใน CSP ของแอป ISB Campus Card

> **วิธีใช้ไฟล์นี้:** เปิดบนเครื่องที่มีโค้ดแอป ISB Campus Card (Canteen app)
> ถ้าใช้ Claude Code ให้สั่งว่า: `อ่านไฟล์ FIX-CSP-ISB-APP.md แล้วแก้ตามนั้น`
> หรือให้นักพัฒนาอ่านทำตามทีละขั้นก็ได้

---

## 1. ปัญหาคืออะไร (บริบท)

เครื่อง POS มีเครื่องอ่านบัตร RFID (ACR1252U) ต่ออยู่ และมี service ชื่อ `rfid-bridge`
รันเป็น Windows Service — อ่าน UID บัตรแล้ว broadcast ทาง WebSocket ที่:

```
ws://localhost:9001
```

ฝั่ง bridge **ทำงานปกติ 100%** (ตรวจสอบแล้ว: service Running, อ่านบัตรได้, port เปิดฟัง)

แต่หน้าเว็บแอป ISB Campus Card **ต่อเข้า bridge ไม่ได้** เพราะ CSP ของแอปบล็อก
ข้อความ error จริงจาก Chrome DevTools Console บนเครื่อง POS (14 ก.ค. 2026):

```
Connecting to 'ws://localhost:9001/' violates the following Content Security
Policy directive: "connect-src 'self' https://accounts.google.com".
The action has been blocked.
```

ผลคือ: แตะบัตรแล้วแอปเงียบ ไม่ค้นหาสมาชิก เพราะแอปไม่เคยได้รับข้อมูลจาก bridge เลย

## 2. สิ่งที่ต้องแก้ (งานหลัก)

หา directive `connect-src` ในการตั้งค่า CSP ของแอป แล้วเพิ่ม `ws://localhost:9001` ต่อท้าย

**จาก:**
```
connect-src 'self' https://accounts.google.com
```

**เป็น:**
```
connect-src 'self' https://accounts.google.com ws://localhost:9001
```

### ข้อกำหนดสำคัญ — ห้ามพลาด

- เพิ่ม **เฉพาะ** `ws://localhost:9001` — **ห้าม**ใช้ `ws://*` หรือ `*` (เปิดกว้างเกินไป ไม่ปลอดภัย)
- **ไม่ต้อง**ใช้ `wss://` — bridge รันบน localhost ไม่มี TLS และ Chrome อนุญาต
  `ws://localhost` จากหน้า HTTPS ได้ (localhost เป็น secure context ยกเว้นให้)
- directive อื่นใน CSP **ห้ามแตะ** — แก้เฉพาะ `connect-src`
- ถ้าแอปมีหลาย environment (dev/staging/prod) ให้แก้ตัวที่ deploy ไปเครื่อง POS จริง
  (ตัวที่ผู้ใช้เปิดผ่าน Chrome หน้างาน)

## 3. หาจุดแก้ยังไง

**อัปเดต 14 ก.ค. 2026:** ได้ CSP ตัวเต็มจาก response header จริงแล้ว:

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; frame-src https://accounts.google.com
```

ค้นใน repo frontend ด้วยคำว่า "csp" แล้ว**ไม่เจอ** — CSP นี้เป็นของเขียนเอง (custom)
จึงต้องอยู่ที่ไหนสักแห่ง ให้ค้นด้วย**ข้อความในตัวนโยบาย**แทน:

```
frame-ancestors
connect-src
connectSrc          <- แบบ camelCase (helmet ใน Node/Express)
cdn.jsdelivr.net
```

และขยายขอบเขตค้นเกิน repo frontend:

| ที่ซ่อนบ่อย | ดูตรงไหน |
|---|---|
| โค้ด backend ที่เสิร์ฟหน้าเว็บ | ค้น `helmet` / `connectSrc` ใน repo ฝั่ง server |
| nginx บนเซิร์ฟเวอร์ (ไม่อยู่ใน repo) | `/etc/nginx/sites-enabled/`, `/etc/nginx/conf.d/` — ค้น `add_header` |
| Docker / compose | Dockerfile, docker-compose.yml, ไฟล์ conf ที่ mount เข้า container |
| IIS (โฮสต์บน Windows) | `web.config` — ส่วน `<customHeaders>` |
| Cloudflare / hosting panel | ตั้งใน dashboard — เช็ค Response Header / Transform Rules |

> เจอมากกว่า 1 จุด: แก้ทุกจุดที่มีผลกับหน้า production ที่เครื่อง POS ใช้จริง

**บรรทัดที่ต้องได้หลังแก้** (เปลี่ยนเฉพาะท่อน connect-src ที่เหลือคงเดิม):

```
connect-src 'self' https://accounts.google.com ws://localhost:9001
```

## 4. งานแถม (แนะนำให้ทำพร้อมกัน): auto-reconnect

ตรวจพบจากหน้างานจริง: หน้าเว็บเปิดค้างข้ามการ restart เครื่อง แล้ว WebSocket
**ไม่ต่อกลับเอง** ต้องกด F5 ถึงจะกลับมาใช้ได้ — ควรเพิ่ม auto-reconnect
ในโค้ดส่วนที่ต่อ `ws://localhost:9001` แนวทาง:

```javascript
function connectRfidBridge() {
  const ws = new WebSocket("ws://localhost:9001");
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "card_detected") {
      // msg.uid = UID บัตร เช่น "9FAD7ED1", msg.timestamp = ISO string
      handleCardTap(msg.uid);
    }
    // msg.type === "ready" = ต่อสำเร็จ
  };
  ws.onclose = () => setTimeout(connectRfidBridge, 3000); // ต่อใหม่ทุก 3 วิ
  ws.onerror = () => ws.close();
  return ws;
}
```

รูปแบบข้อความที่ bridge ส่ง (อ้างอิง):

```json
{ "type": "ready", "message": "Connected to RFID PC/SC bridge" }
{ "type": "card_detected", "uid": "9FAD7ED1", "timestamp": "2026-07-14T06:15:18.000Z" }
```

## 5. ตรวจรับงาน (ทำบนเครื่อง POS หลัง deploy)

1. Refresh หน้า ISB Campus Card ใน Chrome (Ctrl+Shift+R เพื่อล้าง cache)
2. เปิด DevTools (F12) → Console → **ต้องไม่มี** error CSP เกี่ยวกับ `ws://localhost:9001` อีก
3. บนเครื่อง POS เปิด PowerShell รัน:
   ```powershell
   Get-Content C:\Users\isb\Desktop\rfid-bridge\logs\out.log -Tail 5 -Wait
   ```
   ต้องเห็น `✅ Client connected (1 total)` **และไม่มี disconnected ตามมาทันที**
4. แตะบัตร → log ขึ้น `📢 Broadcasting card UID: ...` **และ** แอปค้นหาสมาชิกอัตโนมัติ
5. (ถ้าทำข้อ 4 แล้ว) ทดสอบ auto-reconnect: `Restart-Service rfid-bridge` แล้วรอ ~5 วิ
   แตะบัตรอีกครั้ง — แอปต้องยังตอบสนองโดย**ไม่ต้อง** F5

## 6. ข้อมูลระบบอ้างอิง

| รายการ | ค่า |
|---|---|
| Bridge endpoint | `ws://localhost:9001` (ตายตัวทุกเครื่อง POS) |
| Service name | `rfid-bridge` (NSSM, auto-start) |
| เครื่องอ่าน | ACS ACR1252U (PC/SC) |
| Log บนเครื่อง POS | `C:\Users\isb\Desktop\rfid-bridge\logs\out.log`, `err.log` |
| เอกสารติดตั้ง bridge | https://claude.ai/code/artifact/bfbd6672-0f85-451b-ba06-abadd22b6b71 |
| ติดต่อ | sayangbarp.kscharp@gmail.com |
