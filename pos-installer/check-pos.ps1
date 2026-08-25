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
$paywireExe = Join-Path $PSScriptRoot "paywire\paywire.exe"

# Duplicate autostart entries (leftover from an older/different install, or
# an install that ran twice at two different shortcut scopes) race with each
# other at every login and each launch their own copy of paywire.exe -- the
# two then fight over port 7331 and the EDC USB device (only one process can
# hold either at a time), so whichever one loses just sits there useless
# until next reboot's coin flip. This installer only ever creates ONE
# autostart path (the all-users Startup shortcut below) -- anything else
# pointing at paywire.exe is a duplicate and gets removed here.
$canonicalStartup = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\Paywire Bridge.lnk"
$staleCurrentUserStartup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Paywire Bridge.lnk"
if (Test-Path $staleCurrentUserStartup) {
    Write-Warn "พบ Startup shortcut ซ้ำที่ current-user scope -- ลบออก (ตัวที่ถูกต้องอยู่ที่ all-users scope)"
    Remove-Item $staleCurrentUserStartup -Force -ErrorAction SilentlyContinue
}
foreach ($runKeyRoot in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Run", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run")) {
    $runProps = Get-ItemProperty -Path $runKeyRoot -ErrorAction SilentlyContinue
    if ($runProps) {
        foreach ($prop in $runProps.PSObject.Properties) {
            if ($prop.Name -notmatch '^PS' -and $prop.Value -match "paywire") {
                Write-Warn "พบ Run key ซ้ำที่ $runKeyRoot ($($prop.Name)) -- ลบออก (ไม่ใช่กลไก autostart ของ installer นี้)"
                Remove-ItemProperty -Path $runKeyRoot -Name $prop.Name -ErrorAction SilentlyContinue
            }
        }
    }
}
# $watchdogTaskName is the ONE legitimate scheduled task allowed to touch
# paywire -- everything else matching is a duplicate-autostart leftover from
# before this script existed (paywire originally only ever autostarted via
# the Startup shortcut, never Task Scheduler).
$watchdogTaskName = "ISB EDC Bridge Watchdog"
$staleTasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.TaskName -ne $watchdogTaskName -and
    ($_.TaskName -match "paywire" -or ($_.Actions | ForEach-Object { $_.Execute } | Where-Object { $_ -match "paywire" }))
}
foreach ($task in $staleTasks) {
    Write-Warn "พบ scheduled task ซ้ำ ($($task.TaskName)) -- ลบออก"
    Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false -ErrorAction SilentlyContinue
}
if (-not (Test-Path $canonicalStartup) -and (Test-Path $paywireExe)) {
    Write-Warn "ไม่พบ Startup shortcut มาตรฐาน -- กำลังสร้างใหม่..."
    $wshellPaywire = New-Object -ComObject WScript.Shell
    $paywireShortcut = $wshellPaywire.CreateShortcut($canonicalStartup)
    $paywireShortcut.TargetPath = $paywireExe
    $paywireShortcut.Save()
}

# Duplicate RUNNING instances -- e.g. leftover from before this script's
# autostart cleanup above ran for the first time. Kill all of them and start
# exactly one clean copy rather than trying to guess which one currently
# holds the port/USB device.
$paywireProcs = @(Get-Process paywire -ErrorAction SilentlyContinue)
if ($paywireProcs.Count -gt 1) {
    Write-Warn "พบ paywire.exe รันซ้อนกัน $($paywireProcs.Count) instance -- กำลังปิดทั้งหมดแล้วเปิดใหม่ให้เหลือตัวเดียว..."
    Stop-Process -Name paywire -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    $paywireProcs = @()
}

$paywireProc = if ($paywireProcs.Count -gt 0) { $paywireProcs[0] } else { $null }
if (-not $paywireProc) {
    Write-Warn "ไม่พบ process paywire.exe -- กำลังเปิดให้อัตโนมัติ..."
    if (Test-Path $paywireExe) {
        Start-Process -FilePath $paywireExe
        Start-Sleep -Seconds 3
        $paywireProc = Get-Process paywire -ErrorAction SilentlyContinue | Select-Object -First 1
    } else {
        Write-Err "ไม่พบ $paywireExe -- ติดตั้ง ISB-POS-Setup ใหม่อีกรอบ"
    }
}
# HTTP 200 alone isn't "healthy" -- the bridge answers /whoami just fine even
# while the EDC terminal itself is disconnected (device.connected: false,
# capabilities: []), e.g. after the COM port gets stuck "resource in use" and
# paywire's own reconnect loop never recovers on its own. A cashier only finds
# out at charge time otherwise, so this has to look inside the body, not just
# the status code.
function Test-BridgeWhoami {
    $body = & curl.exe -sk --max-time 5 "https://pos.local.bridge.schooney.tech:7331/whoami" 2>$null
    $code = & curl.exe -sk -o NUL -w "%{http_code}" --max-time 5 "https://pos.local.bridge.schooney.tech:7331/whoami" 2>$null
    $connected = $false
    if ($code -match "^2\d\d$" -and $body) {
        try { $connected = [bool]($body | ConvertFrom-Json).device.connected } catch { $connected = $false }
    }
    [pscustomobject]@{ HttpCode = $code; DeviceConnected = $connected }
}

if ($paywireProc) {
    Write-Ok "process paywire.exe กำลังรันอยู่ (PID $(($paywireProc | ForEach-Object { $_.Id }) -join ', '))"
    $status = Test-BridgeWhoami
    if ($status.HttpCode -match "^2\d\d$" -and $status.DeviceConnected) {
        Write-Ok "bridge ตอบสนอง (HTTP $($status.HttpCode)) และเครื่อง EDC เชื่อมต่ออยู่ (device.connected = true)"
        $results["Paywire Bridge"] = $true
    } else {
        # Covers two cases the same way: bridge unreachable, or bridge up but
        # the terminal itself stuck disconnected -- a plain process restart
        # fixed this reliably when it came up on 2026-08-25, so do that
        # automatically instead of just telling the operator to.
        if ($status.HttpCode -match "^2\d\d$") {
            Write-Warn "bridge ตอบ HTTP $($status.HttpCode) แต่เครื่อง EDC ไม่เชื่อมต่อ (device.connected = false) -- กำลัง restart paywire.exe เพื่อเคลียร์ค้าง..."
        } else {
            Write-Warn "bridge ไม่ตอบสนอง (HTTP status: '$($status.HttpCode)') -- กำลัง restart paywire.exe..."
        }
        Stop-Process -Name paywire -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Start-Process -FilePath $paywireExe

        # The terminal reconnect after a fresh start has taken anywhere from
        # ~1.5s to ~15s in practice (paywire probes COM ports on its own
        # ~5-12s cycle) -- poll instead of one fixed sleep so a fast
        # reconnect doesn't sit waiting, and a slow one still gets caught.
        $recovered = $false
        for ($i = 0; $i -lt 5; $i++) {
            Start-Sleep -Seconds 3
            $status = Test-BridgeWhoami
            if ($status.HttpCode -match "^2\d\d$" -and $status.DeviceConnected) {
                $recovered = $true
                break
            }
        }
        if ($recovered) {
            Write-Ok "restart สำเร็จ -- bridge ตอบสนองและเครื่อง EDC เชื่อมต่อแล้ว (HTTP $($status.HttpCode))"
            $results["Paywire Bridge"] = $true
        } else {
            Write-Err "restart แล้วแต่ยังไม่เชื่อมต่อ (HTTP: '$($status.HttpCode)') -- เช็คสาย USB เครื่อง EDC จริง หรือดู log ที่ $env:LOCALAPPDATA\Paywire\logs\ แล้วรันสคริปต์นี้ซ้ำ"
            $results["Paywire Bridge"] = $false
        }
    }
} else {
    Write-Err "เปิด paywire.exe ไม่สำเร็จ"
    $results["Paywire Bridge"] = $false
}

# ── 2b. Paywire bridge watchdog (scheduled task) ───────────────────────
# The check above only catches a stuck bridge at the moment someone happens
# to run this script. Register a Scheduled Task that re-runs the same
# whoami-then-restart-if-needed check every 2 minutes on its own, so a
# COM-port lockup (2026-08-25: device.connected stuck false, HTTP 200
# throughout, needed a manual process restart) self-heals in ~2 minutes
# instead of waiting for a cashier to notice a failed sale.
Write-Step "2b) ตรวจสอบ Paywire watchdog (scheduled task)..."
$watchdogScript = Join-Path $PSScriptRoot "paywire-watchdog.ps1"
if (-not (Test-Path $watchdogScript)) {
    Write-Err "ไม่พบ paywire-watchdog.ps1 ที่ $PSScriptRoot -- ติดตั้ง ISB-POS-Setup ใหม่อีกรอบ"
    $results["Paywire Watchdog"] = $false
} else {
    # Task Scheduler, not a Startup shortcut: paywire.exe already autostarts
    # once at login via the Startup shortcut above -- this needs to keep
    # firing every 2 minutes for the rest of the session, which only a
    # repeating trigger does. Registered for the *current interactive user*
    # (not SYSTEM) so Start-Process lands back in this desktop session --
    # SYSTEM would launch a copy with no tray icon, fighting the real one
    # for port 7331 and the USB device.
    $existingTask = Get-ScheduledTask -TaskName $watchdogTaskName -ErrorAction SilentlyContinue
    $expectedArg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdogScript`""
    $taskIsCorrect = $false
    if ($existingTask) {
        $currentArg = ($existingTask.Actions | Select-Object -First 1).Arguments
        if ($currentArg -eq $expectedArg) { $taskIsCorrect = $true }
    }
    if (-not $taskIsCorrect) {
        if ($existingTask) {
            Write-Warn "พบ watchdog task แต่ path ไม่ตรง (อาจติดตั้งจากคนละที่) -- กำลังลงทะเบียนใหม่..."
            Unregister-ScheduledTask -TaskName $watchdogTaskName -Confirm:$false -ErrorAction SilentlyContinue
        } else {
            Write-Warn "ไม่พบ watchdog task -- กำลังตั้งค่าให้รันทุก 2 นาที..."
        }
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $expectedArg
        # [TimeSpan]::MaxValue looks like the obvious "forever" but Task
        # Scheduler's XML duration field rejects it (out of range) -- 10
        # years is effectively forever for a POS machine and round-trips fine.
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        # No -Password: registers as "run only when user is logged on" against
        # the current session, which needs no stored credentials.
        Register-ScheduledTask -TaskName $watchdogTaskName -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -RunLevel Limited -Force | Out-Null
    }
    if (Get-ScheduledTask -TaskName $watchdogTaskName -ErrorAction SilentlyContinue) {
        Write-Ok "watchdog task '$watchdogTaskName' พร้อมทำงาน (เช็คทุก 2 นาที, log ที่ $(Join-Path $PSScriptRoot 'logs\paywire-watchdog.log'))"
        $results["Paywire Watchdog"] = $true
    } else {
        Write-Err "ลงทะเบียน watchdog task ไม่สำเร็จ"
        $results["Paywire Watchdog"] = $false
    }
}

# ── 3. Chrome kiosk auto-start shortcut ───────────────────────────────
Write-Step "3) ตรวจสอบ Chrome kiosk auto-start shortcut..."
$kioskShortcut = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\ISB POS Kiosk.lnk"
$kioskArgs = '--kiosk "https://campuscard.isb.ac.th/login" --window-position=0,0 --kiosk-printing --no-first-run --noerrdialogs --disable-session-crashed-bubble'

# Shortcuts created by an older installer/repair run can be missing either
# flag below, so check both and repair in place if either is absent:
#   --kiosk-printing  : without it, window.print() (used for every receipt —
#     see frontend/src/lib/printReceipt.ts) shows an interactive print dialog
#     instead of silently printing to the default printer. In full-screen
#     --kiosk mode that dialog is easy to miss, so the receipt never comes
#     out even though the cash drawer (wired into the printer, fires
#     independently of dialog confirmation) still kicks.
#   --window-position=0,0 : pins the kiosk window's origin to the primary
#     monitor before Chrome goes fullscreen there. Without it Chrome reuses
#     whatever window bounds it last persisted to its profile, which can
#     drift to the second monitor after a crash or an odd sleep/resume.
# Just checking Test-Path isn't enough — a shortcut can exist AND be missing
# a flag — so check its actual Arguments and repair in place if it doesn't match.
$needsShortcut = $true
if (Test-Path $kioskShortcut) {
    $wshellCheck = New-Object -ComObject WScript.Shell
    $existing = $wshellCheck.CreateShortcut($kioskShortcut)
    if ($existing.Arguments -like "*--kiosk-printing*" -and $existing.Arguments -like "*--window-position=0,0*") {
        Write-Ok "shortcut พบที่ $kioskShortcut (มีครบทั้ง --kiosk-printing และ --window-position=0,0)"
        $needsShortcut = $false
    } else {
        Write-Warn "shortcut มีอยู่แต่ขาด flag ที่จำเป็น -- กำลังแก้ไขให้..."
    }
}
if ($needsShortcut) {
    $chromeKey = Get-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    $chromePath = if ($chromeKey) { $chromeKey.GetValue("") } else { $null }
    if ($chromePath -and (Test-Path $chromePath)) {
        $wshell = New-Object -ComObject WScript.Shell
        $shortcut = $wshell.CreateShortcut($kioskShortcut)
        $shortcut.TargetPath = $chromePath
        $shortcut.Arguments = $kioskArgs
        $shortcut.Save()
        Write-Ok "สร้าง/แก้ไข shortcut สำเร็จ ($chromePath) -- ต้อง log off/on หรือรีสตาร์ท Chrome kiosk เพื่อให้มีผล"
    } else {
        Write-Err "ไม่พบ Chrome ติดตั้งอยู่บนเครื่องนี้ -- ติดตั้ง Chrome ก่อนแล้วรันสคริปต์นี้ซ้ำ"
    }
}
if (Test-Path $kioskShortcut) {
    $results["Kiosk Shortcut"] = $true
} else {
    $results["Kiosk Shortcut"] = $false
}

# ── 4. Chrome Local Network Access policy ─────────────────────────────
Write-Step "4) ตรวจสอบ Chrome Local Network Access policy..."
$policyPath = "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls"
$allowedUrl = "campuscard.isb.ac.th"
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

# ── 5. Chrome popup-allowlist policy (customer-display watchdog) ──────
# The customer-display popup (screen 2) is watched by a JS watchdog that
# silently reopens it if it ever closes — but that reopen fires from a timer,
# not a click, so Chrome's popup blocker eats it without this policy.
Write-Step "5) ตรวจสอบ Chrome popup-allowlist policy (สำหรับจอลูกค้า/จอ 2)..."
$popupPolicyPath = "HKLM:\SOFTWARE\Policies\Google\Chrome\PopupsAllowedForUrls"
function Test-PopupPolicyValue {
    if (-not (Test-Path $popupPolicyPath)) { return $false }
    $vals = Get-ItemProperty -Path $popupPolicyPath -ErrorAction SilentlyContinue
    return [bool]($vals.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and $_.Value -eq $allowedUrl })
}
$popupPolicyWasMissing = -not (Test-PopupPolicyValue)
if ($popupPolicyWasMissing) {
    Write-Warn "ไม่พบค่า '$allowedUrl' ใน popup allowlist -- กำลังตั้งค่าให้อัตโนมัติ..."
    New-Item -Path $popupPolicyPath -Force | Out-Null
    Set-ItemProperty -Path $popupPolicyPath -Name "1" -Value $allowedUrl
}
if (Test-PopupPolicyValue) {
    Write-Ok "registry มีค่า '$allowedUrl' อยู่แล้ว"
    if ($popupPolicyWasMissing) {
        Write-Warn "เพิ่งตั้งใหม่ -- ต้องปิด Chrome ทุกหน้าต่างแล้วเปิดใหม่ 1 ครั้งถึงจะมีผลจริง"
    }
    $results["Chrome Popup Policy"] = $true
} else {
    Write-Err "ตั้งค่า registry ไม่สำเร็จ"
    $results["Chrome Popup Policy"] = $false
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
