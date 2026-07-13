#!/bin/bash

# ISB RFID Bridge Setup Script
# ใช้สำหรับเตรียม rfid-bridge บน server

set -e

echo "🚀 ISB RFID Bridge Setup"
echo "========================\n"

# 1. ตรวจสอบ Node.js
echo "1️⃣  ตรวจสอบ Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js ไม่ติดตั้ง"
    exit 1
fi
NODE_VERSION=$(node -v)
echo "✅ Node.js $NODE_VERSION"

# 2. ติดตั้ง dependencies
echo "\n2️⃣  ติดตั้ง dependencies..."
npm install
echo "✅ Dependencies ติดตั้งเสร็จ"

# 3. ตรวจสอบเครื่องอ่าน
echo "\n3️⃣  ตรวจสอบเครื่องอ่าน ACR1252U..."
if lsusb | grep -q "0419:5100\|0419:2101"; then
    echo "✅ เครื่องอ่าน ACR1252U พบแล้ว"
else
    echo "⚠️  เครื่องอ่าน ACR1252U ไม่พบ (อาจยังไม่เสียบ)"
fi

# 4. ทำให้ script executable
chmod +x ./setup.sh

echo "\n========================"
echo "✨ Setup สำเร็จ!"
echo "\nรันด้วย:"
echo "  npm start"
echo "\nหรือใช้ PM2 (recommended):"
echo "  npm install -g pm2"
echo "  pm2 start npm --name rfid-bridge -- --prefix . start"
echo "  pm2 save && pm2 startup"
