# ISB POS -- fix EDC driver "yellow warning" (Newland USB2UART)
#
# Automates DriverInstall_Guide.pdf section 4.3 ("win7*64 System"): on
# Windows 7 x64 without Service Pack 1, the Newland USB2UART device shows
# a yellow warning icon in Device Manager after the driver installs. The
# vendor's documented fix is (1) make sure Service Pack 1 is installed,
# then (2) install the Windows6.1-KB3033929-x64.msu dependency patch
# already bundled at C:\ISB\driver\ -- this script does step 2
# automatically and tells you clearly if step 1 (SP1) is still missing.
#
# Must run as Administrator (installs a Windows update).
#
# Usage:
#   cd C:\ISB
#   powershell -ExecutionPolicy Bypass -File fix-edc-driver.ps1

#Requires -RunAsAdministrator

function Write-Step($msg) { Write-Host ""; Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "   XX  $msg" -ForegroundColor Red }

Write-Host "======================================" -ForegroundColor Magenta
Write-Host "  ISB POS -- แก้ปัญหา EDC driver ขึ้นเหลือง" -ForegroundColor Magenta
Write-Host "======================================" -ForegroundColor Magenta

# ── 1. เช็คสถานะ device ปัจจุบัน ────────────────────────────────────
Write-Step "1) เช็คสถานะอุปกรณ์ Newland ตอนนี้..."
$device = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match "Newland" }
if (-not $device) {
    Write-Err "ไม่พบอุปกรณ์ Newland เลย -- เช็คว่าเสียบสาย USB เครื่อง EDC แล้วหรือยัง (devmgmt.msc) แล้วรันสคริปต์นี้ใหม่"
    Write-Host "       (ถ้าเสียบแล้วยังไม่เจอเลย ลองเปลี่ยนสาย USB หรือเปลี่ยนพอร์ต -- ดู DriverInstall_Guide.pdf หัวข้อ 4.4 'Unidentified device')" -ForegroundColor Gray
    exit 1
}
if ($device.Status -eq "OK") {
    Write-Ok "อุปกรณ์ Newland สถานะ OK อยู่แล้ว -- ไม่ต้องแก้อะไร"
    exit 0
}
Write-Warn "อุปกรณ์ Newland สถานะ: $($device.Status) -- ดำเนินการแก้ต่อ"

# ── 2. เช็ค Service Pack (เฉพาะ Windows 7) ──────────────────────────
Write-Step "2) เช็ค Windows Service Pack..."
$os = Get-CimInstance Win32_OperatingSystem
$isWin7 = $os.Caption -match "Windows 7"
if ($isWin7) {
    if ($os.ServicePackMajorVersion -lt 1) {
        Write-Err "เครื่องนี้เป็น Windows 7 แต่ยังไม่ได้ลง Service Pack 1"
        Write-Host "       ต้องลง Service Pack 1 ตัวจริงจาก Microsoft ก่อน (ผ่าน Windows Update)" -ForegroundColor Gray
        Write-Host "       สคริปต์นี้ไม่ลง SP1 ให้อัตโนมัติ เพราะเป็น major update ที่ต้อง reboot และใช้เวลานาน" -ForegroundColor Gray
        Write-Host "       ลง SP1 เสร็จแล้วค่อยรันสคริปต์นี้ใหม่" -ForegroundColor Gray
        exit 1
    }
    Write-Ok "ลง Service Pack 1 แล้ว"
} else {
    Write-Ok "ไม่ใช่ Windows 7 (เป็น $($os.Caption)) -- ข้ามการเช็ค Service Pack"
}

# ── 3. ลง KB3033929 ──────────────────────────────────────────────────
Write-Step "3) เช็ค/ลง Windows patch KB3033929..."
$kbInstalled = Get-HotFix -Id KB3033929 -ErrorAction SilentlyContinue
$patchExitCode = $null
if ($kbInstalled) {
    Write-Ok "KB3033929 ลงไว้แล้ว"
} else {
    $msuPath = Join-Path $PSScriptRoot "driver\Windows6.1-KB3033929-x64.msu"
    if (-not (Test-Path $msuPath)) {
        Write-Err "ไม่พบไฟล์ $msuPath -- เช็คว่ารันสคริปต์นี้จาก C:\ISB (ที่ installer วางไฟล์ driver ไว้) ไม่ใช่จากที่อื่น"
        exit 1
    }
    Write-Host "       กำลังลง $msuPath (ใช้เวลาสักครู่ อาจต้อง restart เครื่องหลังลงเสร็จ)..." -ForegroundColor Gray
    $proc = Start-Process -FilePath "wusa.exe" -ArgumentList "`"$msuPath`" /quiet /norestart" -Wait -PassThru
    $patchExitCode = $proc.ExitCode
    switch ($patchExitCode) {
        0       { Write-Ok "ลง KB3033929 สำเร็จ" }
        3010    { Write-Ok "ลง KB3033929 สำเร็จ -- ต้อง RESTART เครื่องก่อนถึงจะมีผล" }
        2359302 { Write-Ok "KB3033929 ลงไว้อยู่แล้ว (เจอตอนลงซ้ำ)" }
        default {
            Write-Err "ลง KB3033929 ไม่สำเร็จ (exit code $patchExitCode)"
            Write-Host "       ปกติแปลว่าเครื่องขาด dependency ตัวอื่น -- ลองรัน Windows Update ให้ครบก่อนแล้วรันสคริปต์นี้ใหม่" -ForegroundColor Gray
            exit 1
        }
    }
}

# ── 4. สแกนหา hardware ใหม่ ──────────────────────────────────────────
Write-Step "4) สแกนหา hardware ใหม่..."
try {
    $devcon = Get-ChildItem -Path (Join-Path $PSScriptRoot "driver") -Recurse -Filter "devcon.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($devcon) {
        & $devcon.FullName rescan | Out-Null
        Write-Ok "สั่ง rescan ผ่าน devcon.exe แล้ว"
    } else {
        Write-Warn "ไม่พบ devcon.exe -- ข้ามการ rescan อัตโนมัติ (เปิด Device Manager แล้วกด Action > Scan for hardware changes เอง)"
    }
} catch {
    Write-Warn "rescan ไม่สำเร็จ: $($_.Exception.Message)"
}
Start-Sleep -Seconds 3

# ── สรุปผล ────────────────────────────────────────────────────────
Write-Step "5) เช็คสถานะอุปกรณ์อีกครั้ง..."
$deviceAfter = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match "Newland" }
Write-Host ""
Write-Host "======================================" -ForegroundColor Magenta
if ($deviceAfter -and $deviceAfter.Status -eq "OK") {
    Write-Host "แก้สำเร็จ -- อุปกรณ์ Newland สถานะ OK แล้ว" -ForegroundColor Green
} elseif ($patchExitCode -eq 3010) {
    Write-Host "ลง patch สำเร็จแต่ต้อง RESTART เครื่องก่อนถึงจะเห็นผล -- restart แล้วเช็คด้วย check-pos.ps1 อีกที" -ForegroundColor Yellow
} else {
    Write-Host "อุปกรณ์ยังไม่ OK -- ลอง restart เครื่องแล้วเช็คใหม่ ถ้ายังไม่หายให้ลองวิธี manual update driver" -ForegroundColor Red
    Write-Host "(ดู README.md / INSTALL-GUIDE.html หัวข้อแก้ปัญหา หรือ DriverInstall_Guide.pdf หัวข้อ 4.5 'Manually update the driver')" -ForegroundColor Red
}
Write-Host "======================================" -ForegroundColor Magenta
Write-Host ""
