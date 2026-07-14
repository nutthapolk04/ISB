<#
  ISB RFID Bridge — POS Machine Setup Script (Windows, NSSM edition)
  รันบนเครื่อง POS (Windows) ที่เสียบ ACR1252U เพื่อติดตั้งและลงทะเบียน rfid-bridge
  ให้รันอัตโนมัติตอนเปิดเครื่องด้วย NSSM (Non-Sucking Service Manager)
  — ทางเลือกแทน setup-windows.ps1 (ตัวนั้นใช้ PM2 + pm2-installer)

  สคริปต์นี้จะลงทะเบียน rfid-bridge เป็น "Windows Service" ตัวจริง (native
  Windows Service ผ่าน NSSM) โดยไม่ใช้ PM2 เลย — เมื่อรันเสร็จ 1 ครั้ง
  service จะ auto-start ตอนเปิดเครื่อง และ auto-restart เองถ้า crash
  ไม่ต้องทำอะไรเพิ่ม ("run once, done")

  ใช้:
    เปิด PowerShell แบบ "Run as Administrator" แล้วรัน:
      .\setup-windows-nssm.ps1

  หมายเหตุ: สคริปต์นี้ต้องรันด้วยสิทธิ์ Administrator เพราะ NSSM
  ต้องลงทะเบียน Windows Service (Local System)
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

Write-Host "🚀 ISB RFID Bridge Setup (POS machine — Windows, NSSM edition)" -ForegroundColor Magenta
Write-Host "======================================" -ForegroundColor Magenta

# ── 0. ตรวจสอบสิทธิ์ Administrator ─────────────────────────────
Write-Step "0️⃣  ตรวจสอบสิทธิ์ Administrator..."
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "สคริปต์นี้ต้องรันด้วยสิทธิ์ Administrator (NSSM ต้องลงทะเบียน Windows Service)"
    Write-Host ""
    Write-Host "วิธีแก้:" -ForegroundColor Yellow
    Write-Host "  1. เปิด Start Menu -> พิมพ์ 'PowerShell'"
    Write-Host "  2. คลิกขวาที่ 'Windows PowerShell' -> 'Run as administrator'"
    Write-Host "  3. cd ไปที่โฟลเดอร์นี้ แล้วรัน .\setup-windows-nssm.ps1 อีกครั้ง"
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
    Write-Host "    3. รอติดตั้งเสร็จ (ใช้เวลาสักครู่) แล้วรัน setup-windows-nssm.ps1 นี้ใหม่"
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

# ── 6. เตรียม nssm.exe (ดาวน์โหลดอัตโนมัติถ้ายังไม่มี) ──────────
Write-Step "6️⃣  ตรวจสอบ NSSM (Non-Sucking Service Manager)..."

$localNssm = Join-Path $PSScriptRoot "nssm.exe"
$nssm = $null

if (Test-Path $localNssm) {
    $nssm = $localNssm
    Write-Ok "พบ nssm.exe อยู่แล้วที่ $localNssm"
} elseif (Get-Command nssm -ErrorAction SilentlyContinue) {
    $nssm = (Get-Command nssm).Source
    Write-Ok "พบ nssm บน PATH อยู่แล้ว ($nssm)"
} else {
    Write-Host "   ไม่พบ nssm.exe — จะลองดาวน์โหลดจาก https://nssm.cc/ อัตโนมัติ..."
    $nssmVersion = "2.24"
    $nssmUrl = "https://nssm.cc/release/nssm-$nssmVersion.zip"
    $tempZip = Join-Path $env:TEMP "nssm-$nssmVersion.zip"
    $tempExtract = Join-Path $env:TEMP "nssm-$nssmVersion-extract"

    try {
        # บาง Windows (โดยเฉพาะรุ่นเก่า) ปิด TLS 1.2 ไว้เป็นค่า default -> เปิดไว้กันดาวน์โหลดล้มเหลว
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

        if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
        Invoke-WebRequest -Uri $nssmUrl -OutFile $tempZip -UseBasicParsing
        Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

        $win64Nssm = Join-Path $tempExtract "nssm-$nssmVersion\win64\nssm.exe"
        if (-not (Test-Path $win64Nssm)) {
            throw "ไม่พบ win64\nssm.exe ในไฟล์ zip ที่ดาวน์โหลดมา (โครงสร้าง zip อาจเปลี่ยน)"
        }
        Copy-Item -Path $win64Nssm -Destination $localNssm -Force
        $nssm = $localNssm
        Write-Ok "ดาวน์โหลด nssm.exe สำเร็จ -> $localNssm"
    } catch {
        Write-Err "ดาวน์โหลด nssm.exe อัตโนมัติล้มเหลว: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "  *** ต้องทำด้วยตัวเอง (manual step) — เช่น เครื่อง POS นี้ไม่มีอินเทอร์เน็ต ***" -ForegroundColor Yellow
        Write-Host "  1. ที่เครื่องอื่นที่ต่อเน็ตได้ ดาวน์โหลด: https://nssm.cc/release/nssm-2.24.zip"
        Write-Host "  2. แตกไฟล์ zip แล้วคัดลอกไฟล์ 'win64\nssm.exe' มาไว้ที่:"
        Write-Host "       $localNssm"
        Write-Host "  3. รัน setup-windows-nssm.ps1 นี้ใหม่อีกครั้ง"
        Write-Host ""
        exit 1
    }
}

# ── 7. ลงทะเบียน rfid-bridge เป็น Windows Service ด้วย NSSM ─────
Write-Step "7️⃣  ลงทะเบียน rfid-bridge เป็น Windows Service (NSSM)..."

$serviceName = "rfid-bridge"
$nodePath = (Get-Command node).Source
$scriptPath = Join-Path $PSScriptRoot "rfid-server.js"
$logsDir = Join-Path $PSScriptRoot "logs"

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
    Write-Host "   สร้างโฟลเดอร์ logs\"
}

# idempotent: ถ้ามี service เดิมอยู่แล้ว ให้ stop + remove ก่อน แล้วติดตั้งใหม่สะอาด ๆ
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "   พบ service '$serviceName' เดิมอยู่แล้ว — จะหยุดและลบก่อนติดตั้งใหม่ (rerun แบบ idempotent)"
    try { & $nssm stop $serviceName | Out-Null } catch { }
    Start-Sleep -Seconds 1
    & $nssm remove $serviceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

Write-Host "   ติดตั้ง service: node = $nodePath"
Write-Host "                    script = $scriptPath"
& $nssm install $serviceName $nodePath $scriptPath

& $nssm set $serviceName AppDirectory $PSScriptRoot
& $nssm set $serviceName DisplayName "ISB RFID Bridge"
& $nssm set $serviceName Description "PC/SC RFID bridge for ACR1252U -- WebSocket server on port 9001 (ws://localhost:9001)"
& $nssm set $serviceName Start SERVICE_AUTO_START

# stdout / stderr log ไปที่ logs\out.log และ logs\err.log (เหมือน ecosystem.config.cjs เดิม)
& $nssm set $serviceName AppStdout (Join-Path $logsDir "out.log")
& $nssm set $serviceName AppStderr (Join-Path $logsDir "err.log")
& $nssm set $serviceName AppRotateFiles 1
& $nssm set $serviceName AppRotateOnline 1
& $nssm set $serviceName AppRotateBytes 10485760   # หมุน log ทุก ~10MB

# auto-restart เมื่อ crash: ถ้า process ตายเร็วกว่า 5 วิ (throttle) NSSM จะหน่วงก่อน restart
# ค่า default ของ AppExit คือ Restart อยู่แล้ว แต่กำหนดชัดเจนไว้กันพลาด
& $nssm set $serviceName AppThrottle 5000
& $nssm set $serviceName AppExit Default Restart
& $nssm set $serviceName AppRestartDelay 3000

# environment variables (เทียบเท่า ecosystem.config.cjs เดิม)
& $nssm set $serviceName AppEnvironmentExtra "NODE_ENV=production`nPORT=9001"

# เริ่ม service
& $nssm start $serviceName | Out-Null

# NSSM ไม่รับประกันว่า $LASTEXITCODE จะสะท้อนผลลัพธ์ที่แท้จริงเสมอไป
# -> ตรวจสอบสถานะ service จริง ๆ แทนการเชื่อ exit code
Start-Sleep -Seconds 2
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Ok "Windows Service '$serviceName' ลงทะเบียนและ Running แล้ว"
} else {
    Write-Err "Windows Service '$serviceName' ไม่ได้อยู่ในสถานะ Running (สถานะปัจจุบัน: $($svc.Status))"
    Write-Host "   ตรวจสอบ log ได้ที่: $logsDir\err.log"
    exit 1
}

# ── 8. ตรวจสอบ port 9001 ─────────────────────────────────────────
Write-Step "8️⃣  ตรวจสอบ WebSocket server (port 9001)..."
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
    Write-Err "port 9001 ไม่ตอบสนอง — ดู log ด้วย: Get-Content `"$logsDir\err.log`" -Tail 50"
    Write-Host "   หรือดูสถานะ service: Get-Service $serviceName | Format-List *"
    exit 1
}

# ── 9. สรุปผล ───────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Magenta
Write-Host "✨ Setup สำเร็จ! (NSSM edition — ไม่มี PM2)" -ForegroundColor Green
Write-Host ""
Write-Host "rfid-bridge ถูกลงทะเบียนเป็น Windows Service ('$serviceName') แล้ว" -ForegroundColor Green
Write-Host "  -> จะ auto-start ทุกครั้งที่เปิดเครื่อง และ auto-restart เองถ้า crash" -ForegroundColor Green
Write-Host "  -> ไม่ต้องทำอะไรเพิ่มอีก (run once, done)" -ForegroundColor Green
Write-Host ""

Write-Host "คำสั่งที่ใช้บ่อย:" -ForegroundColor Cyan
Write-Host "  Get-Service $serviceName                # ดูสถานะ service"
Write-Host "  .\nssm.exe restart $serviceName          # restart"
Write-Host "  .\nssm.exe stop $serviceName             # หยุด"
Write-Host "  .\nssm.exe remove $serviceName confirm   # ถอนการติดตั้ง service"
Write-Host ""
Write-Host "ดู log:" -ForegroundColor Cyan
Write-Host "  Get-Content .\logs\out.log -Tail 50 -Wait   # stdout"
Write-Host "  Get-Content .\logs\err.log -Tail 50 -Wait   # stderr"
Write-Host ""
Write-Host "ทดสอบเครื่องอ่านแบบ standalone (ไม่ผ่าน WebSocket):" -ForegroundColor Cyan
Write-Host "  node test-reader.js       # แตะบัตรแล้วดู UID ที่ print ออกมา"
Write-Host ""
