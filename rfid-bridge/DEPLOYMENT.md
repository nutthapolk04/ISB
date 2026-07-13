# RFID Bridge Deployment Guide

## Prerequisites

- **Node.js**: v26.4.0 หรือสูงกว่า
- **ACS PC/SC Driver**: ติดตั้งบนเครื่องแต่ละเครื่องที่มี ACR1252U
  - **Windows**: ดาวน์โหลดจาก [ACS website](https://www.acs.com.hk/en/products/342/)
  - **macOS**: ติดตั้งผ่าน Homebrew หรือ direct download
  - **Linux**: `sudo apt install libpcsclite-dev pcscd`

## Installation

```bash
# 1. ย้ายไปที่โปรเจกต์
cd /path/to/isb-project

# 2. ติดตั้ง dependencies
cd rfid-bridge
npm install

# 3. ตรวจสอบว่าเครื่องอ่านเชื่อมต่อ
npm start
# ควรเห็น: "📖 Reader detected: ACS ACR1252..."
```

## Running on Server

### ตัวเลือก 1: Manual Start
```bash
cd /path/to/isb-project/rfid-bridge
npm start
```

### ตัวเลือก 2: Background Service (PM2)

```bash
# ติดตั้ง PM2 (ทำครั้งแรกเท่านั้น)
npm install -g pm2

# เริ่ม bridge service
pm2 start npm --name rfid-bridge -- --prefix rfid-bridge start

# บันทึก PM2 config
pm2 save

# Auto-start on reboot
pm2 startup
```

### ตัวเลือก 3: Linux Systemd Service

สร้างไฟล์ `/etc/systemd/system/rfid-bridge.service`:

```ini
[Unit]
Description=ISB RFID PC/SC Bridge
After=network.target

[Service]
Type=simple
User=rfid-user
WorkingDirectory=/path/to/isb-project/rfid-bridge
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

แล้วรัน:
```bash
sudo systemctl enable rfid-bridge
sudo systemctl start rfid-bridge
sudo systemctl status rfid-bridge
```

### ตัวเลือก 4: Docker

สร้าง `Dockerfile`:

```dockerfile
FROM node:26-alpine

WORKDIR /app
COPY rfid-bridge .
RUN npm install

EXPOSE 9001
CMD ["npm", "start"]
```

Build & run:
```bash
docker build -t isb-rfid-bridge:latest .
docker run -d \
  --name rfid-bridge \
  --device /dev/bus/usb \
  -p 9001:9001 \
  isb-rfid-bridge:latest
```

## Verification

### 1. ตรวจสอบ Service กำลังรัน
```bash
# ดู process
ps aux | grep rfid

# ดู port 9001 ฟัง
lsof -i :9001
```

### 2. ทดสอบ WebSocket Connection
```bash
curl -i -N -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  http://localhost:9001/
```

### 3. ทดสอบจาก Frontend
- เปิด Canteen app
- เปิด RFID Payment Modal
- แตะบัตร → ควรค้นหาสมาชิกอัตโนมัติ

## Logs & Monitoring

### ดู log
```bash
# PM2
pm2 logs rfid-bridge

# Systemd
sudo journalctl -u rfid-bridge -f

# Direct output
npm start 2>&1 | tee rfid-bridge.log
```

## Troubleshooting

| ปัญหา | วิธีแก้ |
|-------|--------|
| `Cannot find package 'nfc-pcsc'` | `npm install` ใหม่ |
| `No readers found` | ตรวจสอบ ACS driver, USB connection |
| `ERR_CONNECTION_REFUSED` on port 9001 | Bridge ไม่ได้รัน, restart service |
| `PCSC error: Can't allocate memory` | Restart pcscd: `sudo systemctl restart pcscd` |

## Security

- Firewall: เปิด port 9001 สำหรับ frontend network เท่านั้น
- ไม่ต้อง SSL/TLS (localhost connection internal)
- สำหรับ public network: wrap ด้วย nginx proxy + SSL

## Maintenance

- ตรวจสอบ log ทุกวันเพื่อหา error
- Restart service ทุกสัปดาห์ (cache cleanup)
- Update Node.js ประจำปี

---

**ติดต่อ**: sayangbarp.kscharp@gmail.com
