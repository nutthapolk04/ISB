<#
  ISB RFID Bridge — POS Machine Setup Script (Windows)
  รันบนเครื่อง POS (Windows) ที่เสียบ ACR1252U เพื่อติดตั้งและลงทะเบียน rfid-bridge
  ให้รันอัตโนมัติตอนเปิดเครื่องด้วย PM2 + pm2-installer

  ใช้:
    เปิด PowerShell แบบ "Run as Administrator" แล้วรัน:
      .\setup-windows.ps1

  หมายเหตุ: สคริปต์นี้ต้องรันด้วยสิทธิ์ Administrator เพราะ pm2-installer
  ต้องลงทะเบียน PM2 เป็น Windows Service (Local System)
#>

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Write-Step {
    param([string]$Text)
    Write-Host ""
    Write-Host $Text -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Text)
    Write-Host "✅ $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host "⚠️  $Text" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Text)
    Write-Host "❌ $Text" -ForegroundColor Red
}

Write-Host "🚀 ISB RFID Bridge Setup (POS machine — Windows)" -ForegroundColor Magenta
Write-Host "======================================" -ForegroundColor Magenta

# ── 0. ตรวจสอบสิทธิ์ Administrator ─────────────────────────────
Write-Step "0️⃣  ตรวจสอบสิทธิ์ Administrator..."
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "สคริปต์นี้ต้องรันด้วยสิทธิ์ Administrator (pm2-installer ต้องลงทะเบียน Windows Service)"
    Write-Host ""
    Write-Host "วิธีแก้:" -ForegroundColor Yellow
    Write-Host "  1. เปิด Start Menu -> พิมพ์ 'PowerShell'"
    Write-Host "  2. คลิกขวาที่ 'Windows PowerShell' -> 'Run as administrator'"
    Write-Host "  3. cd ไปที่โฟลเดอร์นี้ แล้วรัน .\setup-windows.ps1 อีกครั้ง"
    Write-Host ""
    Write-Host "หรือรันคำสั่งนี้จาก PowerShell ปัจจุบันเพื่อเปิดหน้าต่างใหม่แบบ elevated:" -ForegroundColor Yellow
    Write-Host "  Start-Process powershell -Verb RunAs -ArgumentList '-NoExit','-File',`"$PSCommandPath`""
    exit 1
}
Write-Ok "รันด้วยสิทธิ์ Administrator แล้ว"

# ── 1. ตรวจสอบ Node.js ─────────────────────────────────────────
Write-Step "1️⃣  ตรวจสอบ Node.js..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Err "ไม่พบ Node.js — ติดตั้งก่อน:"
    Write-Host "   ดาวน์โหลด Node.js LTS (.msi) จาก https://nodejs.org/"
    Write-Host "   หรือ: winget install OpenJS.NodeJS.LTS"
    exit 1
}
$nodeVersion = node -v
Write-Ok "Node.js $nodeVersion"

# ── 2. ตรวจสอบ Visual Studio Build Tools / C++ toolchain ───────
# nfc-pcsc พึ่งพา @pokusew/pcsclite ซึ่งเป็น native module ต้อง compile
# ด้วย node-gyp บน Windows -> ต้องมี "Desktop development with C++" workload
# นี่คือจุดที่ npm install ล้มเหลวบ่อยที่สุดบน Windows
Write-Step "2️⃣  ตรวจสอบ Visual Studio Build Tools (C++ toolchain สำหรับ node-gyp)..."
$buildToolsFound = $false

# วิธีที่ 1: cl.exe อยู่ใน PATH (เช่น รันจาก "Developer PowerShell for VS")
if (Get-Command cl -ErrorAction SilentlyContinue) {
    $buildToolsFound = $true
}

# วิธีที่ 2: ใช้ vswhere ตรวจสอบว่ามี VC++ workload ติดตั้งอยู่หรือไม่
if (-not $buildToolsFound) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vcInstall = & $vswhere -latest -products * `
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -property installationPath 2>$null
        if ($vcInstall) {
            $buildToolsFound = $true
        }
    }
}

if ($buildToolsFound) {
    Write-Ok "พบ Visual Studio Build Tools / C++ toolchain"
} else {
    Write-Warn "ไม่พบ Visual Studio Build Tools (C++ toolchain)"
    Write-Host ""
    Write-Host "  npm install จะ 'ล้มเหลว' ตอน build native module (@pokusew/pcsclite) ถ้าไม่มีตัวนี้!" -ForegroundColor Yellow
    Write-Host "  วิธีติดตั้ง (ต้องทำ 1 ครั้งต่อเครื่อง):" -ForegroundColor Yellow
    Write-Host "    1. ดาวน์โหลด Visual Studio Build Tools:"
    Write-Host "       https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    Write-Host "    2. ตอนติดตั้ง ให้เลือก workload: 'Desktop development with C++'"
    Write-Host "    3. รอติดตั้งเสร็จ (ใช้เวลาสักครู่) แล้วรัน setup-windows.ps1 นี้ใหม่"
    Write-Host ""
    Write-Host "  หรือติดตั้งผ่าน winget (เร็วกว่า ไม่ต้องเปิด installer UI):"
    Write-Host "       winget install Microsoft.VisualStudio.2022.BuildTools --override `"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet`""
    Write-Host ""
    $continue = Read-Host "ต้องการดำเนินการต่อ (npm install อาจล้มเหลว) หรือไม่? [y/N]"
    if ($continue -ne "y" -and $continue -ne "Y") {
        Write-Err "ยกเลิก — ติดตั้ง Build Tools แล้วรันสคริปต์นี้ใหม่"
        exit 1
    }
}

# ── 3. ตรวจสอบ Windows Smart Card service (SCardSvr) ────────────
Write-Step "3️⃣  ตรวจสอบ Windows Smart Card service (SCardSvr)..."
$scardSvc = Get-Service -Name SCardSvr -ErrorAction SilentlyContinue
if (-not $scardSvc) {
    Write-Err "ไม่พบ service SCardSvr บนเครื่องนี้ (ผิดปกติสำหรับ Windows ทั่วไป)"
    exit 1
}
if ($scardSvc.StartType -ne "Automatic") {
    Set-Service -Name SCardSvr -StartupType Automatic
    Write-Host "   ตั้งค่า SCardSvr เป็น Automatic startup"
}
if ($scardSvc.Status -ne "Running") {
    Start-Service -Name SCardSvr
    Write-Host "   สั่ง Start SCardSvr"
}
Write-Ok "SCardSvr พร้อมใช้งาน (Automatic + Running)"

# ── 4. ตรวจสอบเครื่องอ่าน ACR1252U ───────────────────────────────
Write-Step "4️⃣  ตรวจสอบเครื่องอ่าน ACR1252U..."
$readerFound = $false
try {
    $readers = Get-PnpDevice -Class SmartCardReader -ErrorAction SilentlyContinue
    $match = $readers | Where-Object { $_.FriendlyName -match "ACR1252|ACS" }
    if ($match) {
        $readerFound = $true
        foreach ($r in $match) {
            Write-Host "   พบ: $($r.FriendlyName) [$($r.Status)]"
        }
    }
} catch {
    Write-Warn "ไม่สามารถ query PnP devices ได้ ($($_.Exception.Message))"
}

if ($readerFound) {
    Write-Ok "พบเครื่องอ่าน ACR1252U"
} else {
    Write-Warn "ไม่พบเครื่องอ่าน ACR1252U — เสียบ USB แล้ว rerun setup ก็ได้ หรือเสียบทีหลัง (bridge จะ detect เอง)"
}

# ── 5. ติดตั้ง dependencies (npm install) ────────────────────────
Write-Step "5️⃣  ติดตั้ง dependencies (npm install)..."
Write-Host "   หมายเหตุ: ขั้นตอนนี้จะ compile native module (@pokusew/pcsclite)"
Write-Host "   ถ้าล้มเหลวตรงนี้ ให้กลับไปดูขั้นตอนที่ 2️⃣ (Build Tools) อีกครั้ง"
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
} catch {
    Write-Err "npm install ล้มเหลว: $($_.Exception.Message)"
    Write-Host "   ตรวจสอบว่าติดตั้ง Visual Studio Build Tools (Desktop development with C++) แล้ว"
    exit 1
}
Write-Ok "Dependencies ติดตั้งเสร็จ"

# ── 6. ติดตั้ง PM2 (ถ้ายังไม่มี) ───────────────────────────────
Write-Step "6️⃣  ตรวจสอบ PM2..."
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "   ติดตั้ง PM2 (global)..."
    npm install -g pm2
    if ($LASTEXITCODE -ne 0) {
        Write-Err "ติดตั้ง PM2 ล้มเหลว"
        exit 1
    }
}
$pm2Version = pm2 -v
Write-Ok "PM2 $pm2Version"

# ── 7. ตั้งค่า auto-start ตอนเปิดเครื่องด้วย pm2-installer ─────
# Windows ไม่มี `pm2 startup` เหมือน Linux/macOS — ต้องใช้ pm2-installer
# (https://github.com/jessety/pm2-installer) ซึ่งจะติดตั้ง PM2 เป็น
# Windows Service ที่รันภายใต้ Local System และตั้งค่า resurrect
# process list อัตโนมัติเมื่อเครื่อง boot
Write-Step "7️⃣  ตั้งค่า PM2 auto-start ตอนเปิดเครื่อง (pm2-installer)..."

$pm2ServiceExists = Get-Service -Name "pm2" -ErrorAction SilentlyContinue
if ($pm2ServiceExists) {
    Write-Ok "PM2 ถูกลงทะเบียนเป็น Windows Service อยู่แล้ว (service name: pm2) — ข้ามขั้นตอนนี้"
} else {
    Write-Warn "PM2 ยังไม่ได้ลงทะเบียนเป็น Windows Service — ต้องรัน pm2-installer"
    $pm2InstallerDir = Join-Path $env:ProgramData "pm2-installer"

    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Host "   พบ git — จะลอง clone และรัน pm2-installer อัตโนมัติ"
        try {
            if (-not (Test-Path $pm2InstallerDir)) {
                git clone https://github.com/jessety/pm2-installer.git $pm2InstallerDir
            }
            Push-Location $pm2InstallerDir
            npm install
            # ตั้งค่า PM2_HOME ให้เป็น system-wide location (ตาม README ของ pm2-installer)
            npm run configure
            # ติดตั้ง PM2 เป็น Windows Service + ตั้งค่า resurrect เมื่อ boot
            npm run setup
            Pop-Location
            Write-Ok "pm2-installer ติดตั้งสำเร็จ — PM2 จะรันเป็น Windows Service ตอนเปิดเครื่อง"
        } catch {
            Pop-Location -ErrorAction SilentlyContinue
            Write-Err "pm2-installer setup ล้มเหลว: $($_.Exception.Message)"
            Write-Warn "ต้องทำขั้นตอนนี้ด้วยตัวเอง (manual) — ดูคำแนะนำด้านล่าง"
        }
    } else {
        Write-Warn "ไม่พบ git — ไม่สามารถ clone pm2-installer อัตโนมัติได้"
        Write-Host ""
        Write-Host "  *** ต้องทำด้วยตัวเอง (manual step) ***" -ForegroundColor Yellow
        Write-Host "  1. ดาวน์โหลด pm2-installer (zip) จาก:"
        Write-Host "     https://github.com/jessety/pm2-installer/archive/refs/heads/master.zip"
        Write-Host "  2. แตกไฟล์ไปที่ เช่น C:\pm2-installer แล้วเปิด PowerShell (Admin) เข้าไปที่โฟลเดอร์นั้น"
        Write-Host "  3. รันตามลำดับ:"
        Write-Host "       npm install"
        Write-Host "       npm run configure"
        Write-Host "       npm run setup"
        Write-Host "  4. รัน setup-windows.ps1 นี้ใหม่อีกครั้งเพื่อ start rfid-bridge"
        Write-Host ""
    }
}

# ── 8. เริ่ม rfid-bridge ด้วย PM2 ────────────────────────────────
Write-Step "8️⃣  เริ่ม rfid-bridge ด้วย PM2..."
try {
    pm2 delete rfid-bridge 2>$null | Out-Null
} catch {
    # ไม่มี process เดิมอยู่ — ไม่เป็นไร
}
pm2 start ecosystem.config.cjs
if ($LASTEXITCODE -ne 0) {
    Write-Err "pm2 start ล้มเหลว — ดู log ด้วย: pm2 logs rfid-bridge"
    exit 1
}
pm2 save
Write-Ok "rfid-bridge รันแล้ว และบันทึก process list ไว้ (pm2 save)"

# ── 9. ตรวจสอบ port 9001 ─────────────────────────────────────────
Write-Step "9️⃣  ตรวจสอบ WebSocket server (port 9001)..."
Start-Sleep -Seconds 2
$portOk = $false
try {
    $conn = Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $portOk = $true }
} catch {
    # Get-NetTCPConnection อาจไม่มีในบาง environment — fallback ไปใช้ Test-NetConnection
    $test = Test-NetConnection -ComputerName localhost -Port 9001 -WarningAction SilentlyContinue
    if ($test -and $test.TcpTestSucceeded) { $portOk = $true }
}

if ($portOk) {
    Write-Ok "ws://localhost:9001 พร้อมใช้งาน"
} else {
    Write-Err "port 9001 ไม่ตอบสนอง — ดู log ด้วย: pm2 logs rfid-bridge"
    exit 1
}

# ── 10. สรุปผล ───────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Magenta
Write-Host "✨ Setup สำเร็จ!" -ForegroundColor Green
Write-Host ""

if (-not (Get-Service -Name "pm2" -ErrorAction SilentlyContinue)) {
    Write-Warn "ยังไม่ได้ตั้งค่า auto-start ตอนเปิดเครื่อง — ทำตามขั้นตอนที่ 7️⃣ ด้านบนให้ครบ (pm2-installer) แล้วรันสคริปต์นี้ใหม่"
}

Write-Host "คำสั่งที่ใช้บ่อย:" -ForegroundColor Cyan
Write-Host "  pm2 logs rfid-bridge      # ดู log"
Write-Host "  pm2 restart rfid-bridge   # restart"
Write-Host "  pm2 stop rfid-bridge      # หยุด"
Write-Host "  pm2 status                # ดูสถานะ process ทั้งหมด"
Write-Host ""
Write-Host "ทดสอบเครื่องอ่านแบบ standalone (ไม่ผ่าน WebSocket):" -ForegroundColor Cyan
Write-Host "  node test-reader.js       # แตะบัตรแล้วดู UID ที่ print ออกมา"
Write-Host ""
