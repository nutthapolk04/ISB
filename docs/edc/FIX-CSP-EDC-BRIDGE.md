# งานแก้ไข: เพิ่ม EDC bridge (pos.local.bridge.schooney.tech:7331) ใน CSP ของแอป ISB Campus Card

> **วิธีใช้ไฟล์นี้:** เปิดบนเครื่องที่มีการตั้งค่า CSP ของแอป ISB Campus Card
> (จุดเดียวกับที่แก้ RFID เมื่อ 14 ก.ค. 2026 — ดูข้อ 3)
> ถ้าใช้ Claude Code ให้สั่งว่า: `อ่านไฟล์ FIX-CSP-EDC-BRIDGE.md แล้วแก้ตามนั้น`
> หรือให้นักพัฒนาอ่านทำตามทีละขั้นก็ได้

---

## 1. ปัญหาคืออะไร (บริบท)

พบเมื่อ **16 ก.ค. 2026** บนเครื่อง POS จริง ระหว่างทดสอบการชำระเงินผ่าน EDC
ในแอป ISB Campus Card (หน้า canteen)

แอปที่เครื่อง POS เปิดใช้ เสิร์ฟอยู่ที่ **https://isb.schooney.tech**
— ตรวจ CSP ตัวจริงจาก response header สด ๆ แล้ว (16 ก.ค. 2026, `curl -sI`):

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https://accounts.google.com ws://localhost:9001; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; frame-src https://accounts.google.com
```

เครื่อง POS มี Paywire bridge (`paywire.exe`) รันอยู่และต่อกับเครื่อง EDC สำเร็จ
โดย bridge เสิร์ฟ HTTPS + WSS ที่:

```
https://pos.local.bridge.schooney.tech:7331
wss://pos.local.bridge.schooney.tech:7331
```

ฝั่ง bridge **ทำงานปกติ** แต่หน้าเว็บแอป **ต่อเข้า bridge ไม่ได้** เพราะ CSP ของแอปบล็อก
ข้อความ error จริงจาก Chrome DevTools Console บนเครื่อง POS (16 ก.ค. 2026):

```
Connecting to 'https://pos.local.bridge.schooney.tech:7331/whoami' violates the
following Content Security Policy directive: "connect-src 'self'
https://accounts.google.com ws://localhost:9001". The action has been blocked.
```

ผลคือ: modal ชำระเงิน EDC ขึ้น pill สีแดง **"EDC not connected"**
ทั้งที่ paywire.exe รันอยู่และต่อกับเครื่อง EDC เรียบร้อยแล้ว —
แอปแค่ถูกเบราว์เซอร์ห้ามไม่ให้คุยกับ bridge

## 2. สิ่งที่ต้องแก้ (งานหลัก)

หา directive `connect-src` ในการตั้งค่า CSP ของแอป แล้วเพิ่ม endpoint ของ EDC bridge
ต่อท้าย **2 รายการ** (ทั้ง `https://` และ `wss://`)

**จาก (ค่าปัจจุบันบน POS):**
```
connect-src 'self' https://accounts.google.com ws://localhost:9001
```

**เป็น (ต้องได้ตรงนี้เป๊ะ):**
```
connect-src 'self' https://accounts.google.com ws://localhost:9001 https://pos.local.bridge.schooney.tech:7331 wss://pos.local.bridge.schooney.tech:7331
```

**header ตัวเต็มหลังแก้ต้องเป็นแบบนี้** (เปลี่ยนเฉพาะท่อน `connect-src` ที่เหลือคงเดิมทุกตัวอักษร):

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https://accounts.google.com ws://localhost:9001 https://pos.local.bridge.schooney.tech:7331 wss://pos.local.bridge.schooney.tech:7331; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; frame-src https://accounts.google.com
```

### ทำไมต้องเพิ่ม 2 รายการ

| รายการ | ใช้กับอะไร |
|---|---|
| `https://pos.local.bridge.schooney.tech:7331` | REST — `GET /whoami`, `POST /txn/*` (sale, qrsale, ...) |
| `wss://pos.local.bridge.schooney.tech:7331` | WebSocket — `/status` (สถานะเครื่อง EDC แบบ live), `/events` (mid-transaction events) |

### ข้อกำหนดสำคัญ — ห้ามพลาด

- ต้องเขียน port `:7331` ต่อท้าย**ชัดเจนทั้งสองรายการ** — ไม่ใส่ port แล้วจะไม่ผ่าน
- **ห้าม**ใช้ wildcard (`https://*`, `wss://*`, `*.schooney.tech` ฯลฯ) — เปิดกว้างเกินไป ไม่ปลอดภัย
- directive อื่นใน CSP **ห้ามแตะ** — แก้เฉพาะ `connect-src`
- `ws://localhost:9001` ของ RFID ที่เพิ่มไว้แล้ว **ต้องคงอยู่** — งานนี้คือเพิ่มต่อท้าย ไม่ใช่แทนที่
- ถ้าแอปมีหลาย environment (dev/staging/prod) ให้แก้ตัวที่ deploy ไปเครื่อง POS จริง
  (ตัวที่ผู้ใช้เปิดผ่าน Chrome หน้างาน)

## 3. หาจุดแก้ยังไง

CSP ตัวนี้ตั้งอยู่ที่ **server/infrastructure ที่เสิร์ฟ https://isb.schooney.tech**
และเป็น**จุดเดียวกับงาน RFID เมื่อ 14 ก.ค. 2026** — คนที่เพิ่ม
`ws://localhost:9001` เข้า `connect-src` ตามไฟล์ `rfid-bridge/FIX-CSP-ISB-APP.md`
รู้อยู่แล้วว่าอยู่ที่ไหน ให้แก้ที่จุดเดิมนั้นเลย

**หลักฐานชี้เป้าสำคัญ:** infra ชุดเดียวกันเสิร์ฟหน้าเทสของทีมที่
**https://isb-pos.schooney.tech** ซึ่งใส่ entry ของ bridge **ถูกต้องอยู่แล้ว**
— CSP สดของ isb-pos (ตรวจ 16 ก.ค. 2026):

```
default-src 'self'; connect-src 'self' https://pos.local.bridge.schooney.tech:7331 wss://pos.local.bridge.schooney.tech:7331; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
```

ดังนั้น**คนที่ตั้งค่า isb-pos.schooney.tech สามารถ copy entry 2 รายการเดียวกันนี้**
(`https://pos.local.bridge.schooney.tech:7331` และ
`wss://pos.local.bridge.schooney.tech:7331`) ไปใส่ใน `connect-src` ของ
isb.schooney.tech ได้เลย — งานนี้จบใน 1 บรรทัด config

ยืนยันอีกครั้ง (ค้นทั้ง repo ใหม่วันนี้ 16 ก.ค. 2026): CSP นี้**ไม่อยู่ใน repo ISB**
— ไม่พบใน frontend, backend-bun, docker, deploy scripts ใด ๆ
จึงเป็นการตั้งค่าฝั่ง infrastructure (เช่น reverse proxy / hosting) เหมือนที่สรุปไว้ในงาน RFID

ถ้าตามหาไม่เจอ ให้ใช้วิธีเดียวกับไฟล์ `rfid-bridge/FIX-CSP-ISB-APP.md` ข้อ 3:
ค้นด้วยข้อความในตัวนโยบายเอง เช่น `connect-src`, `connectSrc`, `frame-ancestors`,
`cdn.jsdelivr.net` ในที่ที่ CSP ชอบซ่อน (nginx conf, web.config, helmet ใน backend,
Cloudflare/hosting panel)

## 4. ตรวจรับงาน (ทำบนเครื่อง POS หลัง deploy)

0. **ตรวจจากเครื่องไหนก็ได้ (ก่อนไปแตะเครื่อง POS):**
   ```
   curl -sI https://isb.schooney.tech | grep -i content-security-policy
   ```
   ต้องเห็น `https://pos.local.bridge.schooney.tech:7331` **และ**
   `wss://pos.local.bridge.schooney.tech:7331` อยู่ใน `connect-src`
1. เปิดหน้าแอป ISB Campus Card ใน Chrome แล้ว hard-refresh (Ctrl+Shift+R เพื่อล้าง cache)
2. เปิด DevTools (F12) → Console → **ต้องไม่มี** error CSP เกี่ยวกับ
   `pos.local.bridge.schooney.tech` อีก
3. เปิดหน้า canteen → กดชำระเงิน → เลือก EDC →
   pill ต้องขึ้นสีเขียว **"EDC connected"**
4. กดปุ่ม **QR CODE** → ยอดต้องไปโผล่ที่เครื่อง EDC และเครื่องแสดง QR บนจอ
5. หลังธนาคารอนุมัติ → modal ต้องขึ้น **APPROVED** และบันทึกใบเสร็จอัตโนมัติ
   (ไม่ต้องกรอกข้อมูล ไม่ต้องกดยืนยันเพิ่ม)

### หมายเหตุ: เสียงรบกวนใน Console ที่ไม่เกี่ยวกับงานนี้

ตอนเก็บ error ครั้งนี้เห็น error อื่นปนอยู่ด้วย — **ไม่ใช่ส่วนหนึ่งของงานนี้ อย่าเพิ่งไปแก้:**

- `401` หลายรายการที่ `api/v1` — เป็นปัญหา auth/login แยกต่างหาก
- `fonts.googleapis.com` ถูกบล็อกโดย `style-src` — ปัญหาความสวยงามที่มีมาก่อนแล้ว (pre-existing)

## 5. ข้อมูลระบบอ้างอิง

| รายการ | ค่า |
|---|---|
| แอปที่เครื่อง POS ใช้ (จุดที่ต้องแก้ CSP) | `https://isb.schooney.tech` |
| หน้าเทสอ้างอิง (CSP ถูกต้องอยู่แล้ว) | `https://isb-pos.schooney.tech` |
| Bridge | `paywire.exe` บนเครื่อง POS (tray app) |
| Bridge endpoint | `https://pos.local.bridge.schooney.tech:7331` + `wss://...:7331` (wildcard cert) |
| REST ที่ใช้ | `GET /whoami`, `POST /txn/sale`, `POST /txn/qrsale` |
| WebSocket ที่ใช้ | `/status` (สถานะเครื่อง), `/events` (mid-transaction events) |
| งาน CSP ก่อนหน้า (RFID) | `rfid-bridge/FIX-CSP-ISB-APP.md` — จุดแก้เดียวกัน |
| คู่มือ integration ฉบับเต็ม | `docs/edc/EDC-CONNECT-GUIDE.html` |
| ติดต่อ | sayangbarp.kscharp@gmail.com |
