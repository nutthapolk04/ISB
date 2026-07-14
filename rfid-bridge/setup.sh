#!/bin/bash

# ISB RFID Bridge — POS Machine Setup Script
# รันบนเครื่อง POS ที่เสียบ ACR1252U เพื่อติดตั้งและลงทะเบียน rfid-bridge กับ PM2
# ใช้: ./setup.sh

set -e
cd "$(dirname "$0")"

OS="$(uname -s)"

echo "🚀 ISB RFID Bridge Setup (POS machine)"
echo "======================================"
echo ""

# 1. ตรวจสอบ Node.js
echo "1️⃣  ตรวจสอบ Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ ไม่พบ Node.js — ติดตั้งก่อน:"
    if [ "$OS" = "Darwin" ]; then
        echo "   brew install node"
    else
        echo "   https://nodejs.org หรือ apt install nodejs"
    fi
    exit 1
fi
echo "✅ Node.js $(node -v)"

# 2. ตรวจสอบ PC/SC
echo ""
echo "2️⃣  ตรวจสอบ PC/SC..."
if [ "$OS" = "Darwin" ]; then
    echo "✅ macOS มี PC/SC ในตัว (CryptoTokenKit)"
elif [ "$OS" = "Linux" ]; then
    if ! command -v pcscd &> /dev/null; then
        echo "❌ ไม่พบ pcscd — ติดตั้งก่อน:"
        echo "   sudo apt install pcscd libpcsclite-dev && sudo systemctl enable --now pcscd"
        exit 1
    fi
    echo "✅ pcscd พร้อมใช้งาน"
fi

# 3. ตรวจสอบเครื่องอ่าน ACR1252U (vendor ACS = 072f)
echo ""
echo "3️⃣  ตรวจสอบเครื่องอ่าน ACR1252U..."
READER_FOUND=false
if [ "$OS" = "Darwin" ]; then
    if system_profiler SPUSBDataType 2>/dev/null | grep -qi "ACR1252\|0x072f"; then
        READER_FOUND=true
    fi
elif [ "$OS" = "Linux" ]; then
    if lsusb 2>/dev/null | grep -qi "072f\|ACR1252"; then
        READER_FOUND=true
    fi
fi
if [ "$READER_FOUND" = true ]; then
    echo "✅ พบเครื่องอ่าน ACR1252U"
else
    echo "⚠️  ไม่พบเครื่องอ่าน — เสียบ USB แล้วรัน setup ซ้ำ หรือเสียบทีหลังก็ได้ (bridge จะ detect เอง)"
fi

# 4. ติดตั้ง dependencies
echo ""
echo "4️⃣  ติดตั้ง dependencies..."
npm install
echo "✅ Dependencies ติดตั้งเสร็จ"

# 5. ติดตั้ง PM2 (ถ้ายังไม่มี)
echo ""
echo "5️⃣  ตรวจสอบ PM2..."
if ! command -v pm2 &> /dev/null; then
    echo "   ติดตั้ง PM2..."
    npm install -g pm2
fi
echo "✅ PM2 $(pm2 -v)"

# 6. ลงทะเบียน rfid-bridge กับ PM2
echo ""
echo "6️⃣  เริ่ม rfid-bridge ด้วย PM2..."
pm2 delete rfid-bridge 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
echo "✅ rfid-bridge รันแล้ว"

# 7. ตรวจสอบ port 9001
echo ""
echo "7️⃣  ตรวจสอบ WebSocket server..."
sleep 2
if lsof -i :9001 -sTCP:LISTEN &> /dev/null; then
    echo "✅ ws://localhost:9001 พร้อมใช้งาน"
else
    echo "❌ port 9001 ไม่ตอบสนอง — ดู log ด้วย: pm2 logs rfid-bridge"
    exit 1
fi

echo ""
echo "======================================"
echo "✨ Setup สำเร็จ!"
echo ""
echo "ขั้นตอนสุดท้าย — ให้ PM2 เริ่มเองตอนเปิดเครื่อง:"
echo "  pm2 startup   (แล้วรันคำสั่งที่มันแสดง)"
echo ""
echo "คำสั่งที่ใช้บ่อย:"
echo "  pm2 logs rfid-bridge    # ดู log"
echo "  pm2 restart rfid-bridge # restart"
echo "  pm2 stop rfid-bridge    # หยุด"
