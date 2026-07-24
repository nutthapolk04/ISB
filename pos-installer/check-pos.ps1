# ISB POS — post-install check + auto-fix script
#
# Run any time after installing ISB-POS-Setup-*.exe. Checks all 4
# components and automatically fixes whatever it safely can (EDC driver
# patch, restarting Paywire, recreating the kiosk shortcut, setting the
# Chrome policy) instead of just telling you what command to run by hand.
# Safe to re-run as many times as you like.
#
# Must run as Administrator (it installs a Windows patch and writes HKLM
# if the EDC driver or Chrome policy need fixing).
#
# Usage:
#   cd C:\ISB
#   powershell -ExecutionPolicy Bypass -File check-pos.ps1

#Requires -RunAsAdministrator

$ErrorActionPreference = "Continue"

function Write-Step($msg) { Write-Host ""; Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "   XX  $msg" -ForegroundColor Red }

$results = [ordered]@{}

Write-Host "======================================" -ForegroundColor Magenta
Write-Host "  ISB POS -- ตรวจสอบ + แก้ไขอัตโนมัติ" -ForegroundColor Magenta
Write-Host "======================================" -ForegroundColor Magenta

# ── 1. EDC USB driver ────────────────────────────────────────────────
Write-Step "1) ตรวจสอบ EDC USB driver (whql_Driver2020)..."
function Get-NewlandDevice { Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match "Newland" } }

$edcDevices = Get-NewlandDevice
if (-not $edcDevices) {
    Write-Err "ไม่พบอุปกรณ์ Newland เลย -- เช็คว่าเสียบสาย USB เครื่อง EDC แล้วหรือยัง (devmgmt.msc) แล้วรันสคริปต์นี้ใหม่"
    $results["EDC Driver"] = $false
} else {
    $bad = $edcDevices | Where-Object { $_.Status -ne "OK" }
    if ($bad) {
        Write-Warn "พบอุปกรณ์ Newland แต่สถานะไม่ปกติ: $($bad.Status -join ', ') -- กำลังแก้อัตโนมัติ..."
        $fixScript = Join-Path $PSScriptRoot "fix-edc-driver.ps1"
        if (Test-Path $fixScript) {
            & $fixScript
        } else {
            Write-Err "ไม่พบ fix-edc-driver.ps1 ที่ $PSScriptRoot"
        }
        # เช็คซ้ำหลังแก้
        $bad = (Get-NewlandDevice) | Where-Object { $_.Status -ne "OK" }
        if ($bad) {
            Write-Err "แก้อัตโนมัติแล้วแต่ยังไม่ OK ($($bad.Status -join ', ')) -- ลอง restart เครื่องแล้วรันสคริปต์นี้ซ้ำ, หรือทำ manual update driver (ดู driver\DriverInstall_Guide.pdf หัวข้อ 4.5)"
            $results["EDC Driver"] = $false
        } else {
            Write-Ok "แก้สำเร็จ -- อุปกรณ์ Newland สถานะ OK แล้ว"
            $results["EDC Driver"] = $true
        }
    } else {
        Write-Ok "พบอุปกรณ์ Newland ($($edcDevices.Count) รายการ) สถานะ OK ทั้งหมด"
        $results["EDC Driver"] = $true
    }
}

# ── 2. Paywire EDC bridge ─────────────────────────────────────────────
Write-Step "2) ตรวจสอบ Paywire EDC bridge..."
$paywireProc = Get-Process paywire -ErrorAction SilentlyContinue
if (-not $paywireProc) {
    Write-Warn "ไม่พบ process paywire.exe -- กำลังเปิดให้อัตโนมัติ..."
    $paywireExe = Join-Path $PSScriptRoot "paywire\paywire.exe"
    if (Test-Path $paywireExe) {
        Start-Process -FilePath $paywireExe
        Start-Sleep -Seconds 3
        $paywireProc = Get-Process paywire -ErrorAction SilentlyContinue
    } else {
        Write-Err "ไม่พบ $paywireExe -- ติดตั้ง ISB-POS-Setup ใหม่อีกรอบ"
    }
}
if ($paywireProc) {
    Write-Ok "process paywire.exe กำลังรันอยู่ (PID $(($paywireProc | ForEach-Object { $_.Id }) -join ', '))"
    $curlOut = & curl.exe -sk -o NUL -w "%{http_code}" --max-time 5 "https://pos.local.bridge.schooney.tech:7331/whoami" 2>$null
    if ($curlOut -match "^2\d\d$") {
        Write-Ok "bridge ตอบสนอง (HTTP $curlOut)"
        $results["Paywire Bridge"] = $true
    } else {
        Write-Err "bridge ไม่ตอบสนอง (HTTP status: '$curlOut') -- ลอง restart เครื่อง EDC แล้วรันสคริปต์นี้ซ้ำ"
        $results["Paywire Bridge"] = $false
    }
} else {
    Write-Err "เปิด paywire.exe ไม่สำเร็จ"
    $results["Paywire Bridge"] = $false
}

# ── 3. Chrome kiosk auto-start shortcut ───────────────────────────────
Write-Step "3) ตรวจสอบ Chrome kiosk auto-start shortcut..."
$kioskShortcut = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\ISB POS Kiosk.lnk"
if (-not (Test-Path $kioskShortcut)) {
    Write-Warn "ไม่พบ shortcut -- กำลังสร้างให้อัตโนมัติ..."
    $chromeKey = Get-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    $chromePath = if ($chromeKey) { $chromeKey.GetValue("") } else { $null }
    if ($chromePath -and (Test-Path $chromePath)) {
        $wshell = New-Object -ComObject WScript.Shell
        $shortcut = $wshell.CreateShortcut($kioskShortcut)
        $shortcut.TargetPath = $chromePath
        $shortcut.Arguments = '--kiosk "https://isb.schooney.tech/login" --no-first-run --noerrdialogs --disable-session-crashed-bubble'
        $shortcut.Save()
        Write-Ok "สร้าง shortcut สำเร็จ ($chromePath)"
    } else {
        Write-Err "ไม่พบ Chrome ติดตั้งอยู่บนเครื่องนี้ -- ติดตั้ง Chrome ก่อนแล้วรันสคริปต์นี้ซ้ำ"
    }
}
if (Test-Path $kioskShortcut) {
    Write-Ok "shortcut พบที่ $kioskShortcut"
    $results["Kiosk Shortcut"] = $true
} else {
    $results["Kiosk Shortcut"] = $false
}

# ── 4. Chrome Local Network Access policy ─────────────────────────────
Write-Step "4) ตรวจสอบ Chrome Local Network Access policy..."
$policyPath = "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls"
$allowedUrl = "isb.schooney.tech"
function Test-PolicyValue {
    if (-not (Test-Path $policyPath)) { return $false }
    $vals = Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue
    return [bool]($vals.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and $_.Value -eq $allowedUrl })
}
$policyWasMissing = -not (Test-PolicyValue)
if ($policyWasMissing) {
    Write-Warn "ไม่พบค่า '$allowedUrl' ใน registry -- กำลังตั้งค่าให้อัตโนมัติ..."
    New-Item -Path $policyPath -Force | Out-Null
    Set-ItemProperty -Path $policyPath -Name "1" -Value $allowedUrl
}
if (Test-PolicyValue) {
    Write-Ok "registry มีค่า '$allowedUrl' อยู่แล้ว"
    if ($policyWasMissing) {
        Write-Warn "เพิ่งตั้งใหม่ -- ต้องปิด Chrome ทุกหน้าต่างแล้วเปิดใหม่ 1 ครั้งถึงจะมีผลจริง"
    }
    Write-Host "       ยืนยันเพิ่มเติมได้ที่ chrome://policy -- ถ้าตั้งไว้ถูกแล้วแต่ยังไม่ขึ้น OK อาจเป็นเพราะยังไม่ได้ปิด-เปิด Chrome ใหม่, หรือ Chrome เวอร์ชันนี้เปลี่ยนชื่อ policy ไปแล้ว (เช็คที่ chrome://version)" -ForegroundColor Gray
    $results["Chrome Policy"] = $true
} else {
    Write-Err "ตั้งค่า registry ไม่สำเร็จ"
    $results["Chrome Policy"] = $false
}

# ── สรุปผล ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Magenta
Write-Host "  สรุปผลการตรวจสอบ" -ForegroundColor Magenta
Write-Host "======================================" -ForegroundColor Magenta
$allOk = $true
foreach ($key in $results.Keys) {
    if ($results[$key]) {
        Write-Host ("  {0,-16} : OK" -f $key) -ForegroundColor Green
    } else {
        $allOk = $false
        Write-Host ("  {0,-16} : FAIL" -f $key) -ForegroundColor Red
    }
}
Write-Host ""
if ($allOk) {
    Write-Host "ทุก component พร้อมใช้งาน -- เหลือแค่ทดสอบจริงจากหน้าเว็บ (ดู INSTALL-GUIDE.html หัวข้อ 4 'ตรวจรับหลังติดตั้ง')" -ForegroundColor Green
    if ($policyWasMissing) {
        Write-Host "อย่าลืม: ปิด Chrome ทุกหน้าต่างแล้วเปิดใหม่ก่อนทดสอบ (ตั้ง policy ใหม่เพิ่งเสร็จเมื่อกี้)" -ForegroundColor Yellow
    }
} else {
    Write-Host "มีบาง component ยังแก้อัตโนมัติไม่ได้ -- ดู error ด้านบนแล้วแก้ตามนั้น แล้วรันสคริปต์นี้ซ้ำได้เลย (รันซ้ำได้ไม่จำกัด)" -ForegroundColor Yellow
}
Write-Host ""
