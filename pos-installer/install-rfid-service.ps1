<#
  ISB RFID Bridge — POS Installer Service Registration (Windows, NSSM edition)
  รันโดย ISB-POS-Setup-1.0.0.exe ตอนติดตั้ง component "RFID bridge service"
  ดัดแปลงจาก rfid-bridge\setup-windows-nssm.ps1 ให้ใช้กับ payload ที่ bundle
  มากับ installer แทน — ไม่ดาวน์โหลด nssm, ไม่ใช้ node จาก PATH

  โครงสร้างที่ installer วางไว้ (C:\ISB โดย default):
    C:\ISB\rfid-bridge\   (rfid-server.js, package.json, ... )
    C:\ISB\node\node.exe  (Node.js portable)
    C:\ISB\nssm.exe

  ใช้:
    รันจาก installer โดยอัตโนมัติ (ExecWait ผ่าน installer.nsi)
    หรือรันเองด้วย PowerShell แบบ "Run as Administrator":
      .\install-rfid-service.ps1
#>

$ErrorActionPreference = "Stop"

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

Write-Host "🚀 ISB RFID Bridge — POS Installer Service Registration" -ForegroundColor Magenta
Write-Host "======================================" -ForegroundColor Magenta

$Root = Split-Path -Parent $PSCommandPath
$RfidDir = Join-Path $Root "rfid-bridge"
$NodeExe = Join-Path $Root "node\node.exe"
$NpmCmd = Join-Path $Root "node\npm.cmd"
$Nssm = Join-Path $Root "nssm.exe"
$ServiceName = "rfid-bridge"

# ── 0. ตรวจสอบสิทธิ์ Administrator ─────────────────────────────
Write-Step "0️⃣  ตรวจสอบสิทธิ์ Administrator..."
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "สคริปต์นี้ต้องรันด้วยสิทธิ์ Administrator (NSSM ต้องลงทะเบียน Windows Service)"
    Write-Host "  ปกติ installer จะขอสิทธิ์ Administrator ให้อยู่แล้ว (RequestExecutionLevel admin)"
    exit 1
}
Write-Ok "รันด้วยสิทธิ์ Administrator แล้ว"

# ── 1. ตรวจสอบไฟล์ที่จำเป็น (bundled node / nssm / rfid-bridge) ─
Write-Step "1️⃣  ตรวจสอบไฟล์ที่ bundle มากับ installer..."
if (-not (Test-Path $NodeExe)) {
    Write-Err "ไม่พบ $NodeExe — installer อาจ copy ไฟล์ไม่ครบ"
    exit 1
}
if (-not (Test-Path $Nssm)) {
    Write-Err "ไม่พบ $Nssm — installer อาจ copy ไฟล์ไม่ครบ"
    exit 1
}
if (-not (Test-Path $RfidDir)) {
    Write-Err "ไม่พบโฟลเดอร์ $RfidDir — installer อาจ copy ไฟล์ไม่ครบ"
    exit 1
}
Write-Ok "พบ node.exe, nssm.exe, rfid-bridge\ ครบ (ใช้ Node.js portable ที่ bundle มา — ไม่ใช้ PATH)"
$nodeVersion = & $NodeExe -v
Write-Ok "Node.js $nodeVersion (portable, $NodeExe)"

# ── 2. ตรวจสอบ Windows Smart Card service (SCardSvr) ────────────
Write-Step "2️⃣  ตรวจสอบ Windows Smart Card service (SCardSvr)..."
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

# ── 3. ตรวจสอบเครื่องอ่าน ACR1252U (warn-only) ───────────────────
Write-Step "3️⃣  ตรวจสอบเครื่องอ่าน ACR1252U..."
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
    Write-Warn "ไม่พบเครื่องอ่าน ACR1252U — เสียบ USB แล้ว restart service ทีหลังก็ได้ (bridge จะ detect เอง เมื่อเสียบเข้ามา)"
}

# ── 4. ติดตั้ง dependencies (npm install) — เฉพาะถ้ายังไม่มี node_modules ─
Write-Step "4️⃣  ตรวจสอบ dependencies (node_modules)..."
$nodeModulesDir = Join-Path $RfidDir "node_modules"

if (Test-Path $nodeModulesDir) {
    Write-Ok "พบ node_modules อยู่แล้วใน rfid-bridge\ (OFFLINE mode — bundled) — ข้าม npm install"
} else {
    Write-Host "   ไม่พบ node_modules — จะรัน npm install (ONLINE mode — ต้องใช้อินเทอร์เน็ต)"

    # ตรวจสอบ Visual Studio Build Tools / C++ toolchain ก่อน
    # nfc-pcsc พึ่งพา @pokusew/pcsclite ซึ่งเป็น native module ต้อง compile
    # ด้วย node-gyp บน Windows -> ต้องมี "Desktop development with C++" workload
    # นี่คือจุดที่ npm install ล้มเหลวบ่อยที่สุดบน Windows
    Write-Step "4️⃣ (a)  ตรวจสอบ Visual Studio Build Tools (C++ toolchain สำหรับ node-gyp)..."
    $buildToolsFound = $false

    if (Get-Command cl -ErrorAction SilentlyContinue) {
        $buildToolsFound = $true
    }

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
        Write-Host "    3. รอติดตั้งเสร็จ (ใช้เวลาสักครู่) แล้วรัน installer นี้ใหม่ (หรือรัน install-rfid-service.ps1 เองใน $Root)"
        Write-Host ""
        Write-Host "  หรือติดตั้งผ่าน winget (เร็วกว่า ไม่ต้องเปิด installer UI):"
        Write-Host "       winget install Microsoft.VisualStudio.2022.BuildTools --override `"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet`""
        Write-Host ""
        Write-Warn "ดำเนินการต่อ — npm install อาจล้มเหลว ถ้าล้มเหลวให้ติดตั้ง Build Tools แล้วรัน install-rfid-service.ps1 นี้ใหม่"
    }

    Write-Step "4️⃣ (b)  รัน npm install (ใช้ npm ที่ bundle มากับ Node.js portable)..."
    Push-Location $RfidDir
    try {
        & $NpmCmd install
        if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
        Write-Ok "Dependencies ติดตั้งเสร็จ"
    } catch {
        Write-Err "npm install ล้มเหลว: $($_.Exception.Message)"
        Write-Host "   ตรวจสอบว่าติดตั้ง Visual Studio Build Tools (Desktop development with C++) แล้ว"
        Write-Host "   หรือใช้ OFFLINE mode แทน: rebuild installer นี้พร้อม pos-installer\prebuilt-node_modules.zip"
        Pop-Location
        exit 1
    }
    Pop-Location
}

# ── 5. ลงทะเบียน rfid-bridge เป็น Windows Service ด้วย NSSM (bundled) ─
Write-Step "5️⃣  ลงทะเบียน rfid-bridge เป็น Windows Service (NSSM, bundled)..."

$logsDir = Join-Path $RfidDir "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
    Write-Host "   สร้างโฟลเดอร์ logs\"
}

# idempotent: ถ้ามี service เดิมอยู่แล้ว ให้ stop + remove ก่อน แล้วติดตั้งใหม่สะอาด ๆ
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "   พบ service '$ServiceName' เดิมอยู่แล้ว — จะหยุดและลบก่อนติดตั้งใหม่ (rerun แบบ idempotent)"
    try { & $Nssm stop $ServiceName | Out-Null } catch { }
    Start-Sleep -Seconds 1
    & $Nssm remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

Write-Host "   ติดตั้ง service: node = $NodeExe"
Write-Host "                    script = rfid-server.js"
Write-Host "                    AppDirectory = $RfidDir"
& $Nssm install $ServiceName $NodeExe "rfid-server.js"

& $Nssm set $ServiceName AppDirectory $RfidDir
& $Nssm set $ServiceName DisplayName "ISB RFID Bridge"
& $Nssm set $ServiceName Description "PC/SC RFID bridge for ACR1252U -- WebSocket server on port 9001 (ws://localhost:9001)"
& $Nssm set $ServiceName Start SERVICE_AUTO_START

# stdout / stderr log ไปที่ rfid-bridge\logs\out.log และ err.log
& $Nssm set $ServiceName AppStdout (Join-Path $logsDir "out.log")
& $Nssm set $ServiceName AppStderr (Join-Path $logsDir "err.log")
& $Nssm set $ServiceName AppRotateFiles 1
& $Nssm set $ServiceName AppRotateOnline 1
& $Nssm set $ServiceName AppRotateBytes 10485760   # หมุน log ทุก ~10MB

# auto-restart เมื่อ crash: ถ้า process ตายเร็วกว่า 5 วิ (throttle) NSSM จะหน่วงก่อน restart
& $Nssm set $ServiceName AppThrottle 5000
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName AppRestartDelay 3000

# environment variables (เทียบเท่า ecosystem.config.cjs เดิม)
# NSSM รับ environment variable ทีละตัวเป็นคนละ argument (ไม่ใช่ string เดียว
# คั่นด้วย newline — แบบนั้นจะกลายเป็น variable เดียวชื่อ NODE_ENV ค่าเพี้ยน)
& $Nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "PORT=9001"

# เริ่ม service
& $Nssm start $ServiceName | Out-Null

# NSSM ไม่รับประกันว่า $LASTEXITCODE จะสะท้อนผลลัพธ์ที่แท้จริงเสมอไป
# -> ตรวจสอบสถานะ service จริง ๆ แทนการเชื่อ exit code
Start-Sleep -Seconds 2
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Ok "Windows Service '$ServiceName' ลงทะเบียนและ Running แล้ว"
} else {
    Write-Err "Windows Service '$ServiceName' ไม่ได้อยู่ในสถานะ Running (สถานะปัจจุบัน: $($svc.Status))"
    Write-Host "   ตรวจสอบ log ได้ที่: $logsDir\err.log"
    exit 1
}

# ── 6. ตั้งค่า Chrome Local Network Access policy ────────────────
# Chrome เวอร์ชันใหม่บล็อกเว็บสาธารณะ (isb.schooney.tech) ไม่ให้ต่อ
# ws://localhost:9001 เอง (Private Network Access check) แยกจาก CSP คนละชั้น
# ต้อง whitelist โดเมนผ่าน Enterprise Policy — เดิมเป็นขั้นตอน manual
# (ดู pos-installer/README.md) ย้ายมาทำอัตโนมัติที่นี่แทน
Write-Step "6️⃣  ตั้งค่า Chrome Local Network Access policy..."
$ChromePolicyPath = "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls"
$AllowedUrl = "isb.schooney.tech"
$chromePolicyOk = $false
try {
    New-Item -Path $ChromePolicyPath -Force | Out-Null
    Set-ItemProperty -Path $ChromePolicyPath -Name "1" -Value $AllowedUrl
    $chromePolicyOk = $true
    Write-Ok "ตั้งค่า LocalNetworkAccessAllowedForUrls = $AllowedUrl แล้ว"
    Write-Warn "ต้องปิด Chrome ทุกหน้าต่างแล้วเปิดใหม่ policy ถึงจะมีผล (เช็คได้ที่ chrome://policy)"
} catch {
    Write-Err "ตั้งค่า Chrome policy ไม่สำเร็จ: $($_.Exception.Message)"
    Write-Host "   ตั้งเองได้ภายหลังด้วย: New-Item -Path `"$ChromePolicyPath`" -Force; Set-ItemProperty -Path `"$ChromePolicyPath`" -Name '1' -Value '$AllowedUrl'"
}

# ── 7. ตรวจสอบ port 9001 (รอสูงสุด 10 วิ) ────────────────────────
Write-Step "7️⃣  ตรวจสอบ WebSocket server (port 9001)..."
$portOk = $false
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline -and -not $portOk) {
    try {
        $conn = Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue
        if ($conn) { $portOk = $true; break }
    } catch {
        $test = Test-NetConnection -ComputerName localhost -Port 9001 -WarningAction SilentlyContinue
        if ($test -and $test.TcpTestSucceeded) { $portOk = $true; break }
    }
    Start-Sleep -Milliseconds 500
}

if ($portOk) {
    Write-Ok "ws://localhost:9001 พร้อมใช้งาน"
} else {
    Write-Err "port 9001 ไม่ตอบสนอง (รอครบ 10 วิแล้ว) — ดู log ด้วย: Get-Content `"$logsDir\err.log`" -Tail 50"
}

# ── 8. สรุปผล ───────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Magenta
Write-Host "✨ ISB RFID Bridge — สรุปผลการติดตั้ง" -ForegroundColor Magenta
Write-Host ""
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "  Service status : ✅ Running ('$ServiceName')" -ForegroundColor Green
} else {
    Write-Host "  Service status : ❌ Not running ('$ServiceName')" -ForegroundColor Red
}
if ($portOk) {
    Write-Host "  Port 9001      : ✅ Listening (ws://localhost:9001)" -ForegroundColor Green
} else {
    Write-Host "  Port 9001      : ❌ Not listening" -ForegroundColor Red
}
if ($chromePolicyOk) {
    Write-Host "  Chrome policy  : ✅ LocalNetworkAccessAllowedForUrls = $AllowedUrl" -ForegroundColor Green
} else {
    Write-Host "  Chrome policy  : ❌ ตั้งไม่สำเร็จ — ดูวิธีตั้งเองด้านบน" -ForegroundColor Red
}
Write-Host ""
Write-Host "  หน้าเว็บ ISB ไม่ต้อง config อะไรเพิ่ม — ws://localhost:9001 ถูก allow ไว้ใน CSP อยู่แล้ว" -ForegroundColor Cyan
Write-Host "  ⚠️  ปิด Chrome ทุกหน้าต่างแล้วเปิดใหม่ 1 ครั้ง เพื่อให้ policy มีผล ก่อนทดสอบแตะบัตร" -ForegroundColor Yellow
Write-Host ""
Write-Host "คำสั่งที่ใช้บ่อย (รันจาก $Root):" -ForegroundColor Cyan
Write-Host "  Get-Service $ServiceName                    # ดูสถานะ service"
Write-Host "  .\nssm.exe restart $ServiceName              # restart"
Write-Host "  .\nssm.exe stop $ServiceName                 # หยุด"
Write-Host "  Get-Content rfid-bridge\logs\out.log -Tail 50 -Wait   # stdout"
Write-Host "  Get-Content rfid-bridge\logs\err.log -Tail 50 -Wait   # stderr"
Write-Host ""
