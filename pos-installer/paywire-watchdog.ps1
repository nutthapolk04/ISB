# ISB POS -- Paywire bridge watchdog
#
# One check-and-fix pass: is paywire.exe running AND is the EDC terminal
# actually connected (per /whoami's device.connected, not just an HTTP 200)?
# If not, kill + relaunch paywire.exe and poll for recovery.
#
# Meant to be re-run every 1-2 minutes by a Scheduled Task (see check-pos.ps1
# section 2b, which registers it) -- this script itself does not loop. Does
# NOT require Administrator: it only touches its own paywire.exe process, so
# it can run in the logged-in user's own session (needed for the tray icon
# and for Start-Process to land in the interactive desktop, not session 0).
#
# Logs only on anomalies (bridge down, restart attempted) -- silent on a
# healthy check, so the log stays readable instead of one line every 2 min.

$paywireExe = Join-Path $PSScriptRoot "paywire\paywire.exe"
$logDir = Join-Path $PSScriptRoot "logs"
$logFile = Join-Path $logDir "paywire-watchdog.log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line
}

# Keep the log from growing forever -- trim to the last 500 lines once it
# passes ~1000, cheap enough to check every run.
function Trim-Log {
    if (-not (Test-Path $logFile)) { return }
    $lines = Get-Content -Path $logFile
    if ($lines.Count -gt 1000) {
        Set-Content -Path $logFile -Value ($lines | Select-Object -Last 500)
    }
}

function Test-BridgeWhoami {
    $body = & curl.exe -sk --max-time 5 "https://pos.local.bridge.schooney.tech:7331/whoami" 2>$null
    $code = & curl.exe -sk -o NUL -w "%{http_code}" --max-time 5 "https://pos.local.bridge.schooney.tech:7331/whoami" 2>$null
    $connected = $false
    if ($code -match "^2\d\d$" -and $body) {
        try { $connected = [bool]($body | ConvertFrom-Json).device.connected } catch { $connected = $false }
    }
    [pscustomobject]@{ HttpCode = $code; DeviceConnected = $connected }
}

$paywireProc = Get-Process paywire -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $paywireProc) {
    Write-Log "paywire.exe not running -- starting it"
    if (Test-Path $paywireExe) {
        Start-Process -FilePath $paywireExe
    } else {
        Write-Log "ERROR: $paywireExe not found -- cannot start"
        Trim-Log
        exit 1
    }
} else {
    $status = Test-BridgeWhoami
    if ($status.HttpCode -match "^2\d\d$" -and $status.DeviceConnected) {
        # Healthy -- nothing to log, nothing to do.
        Trim-Log
        exit 0
    }

    Write-Log "unhealthy (HTTP=$($status.HttpCode) connected=$($status.DeviceConnected)) -- restarting paywire.exe (was PID $($paywireProc.Id))"
    Stop-Process -Id $paywireProc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Start-Process -FilePath $paywireExe
}

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
    Write-Log "recovered -- bridge responding and device connected"
} else {
    Write-Log "still unhealthy after restart (HTTP=$($status.HttpCode) connected=$($status.DeviceConnected)) -- needs a human (check USB cable / run check-pos.ps1)"
}
Trim-Log
