@echo off
chcp 65001 >nul
title ISB Customer Display - Setup

REM ============================================================
REM  Edit these two lines if needed, then save & double-click:
REM ============================================================
set "URL=https://isb-beta.vercel.app/customer-display"
set "POSITION=1920,0"
REM   URL       - production / localhost URL of the customer display
REM   POSITION  - top-left of the SECOND monitor, in pixels
REM               1920,0  = second monitor on the RIGHT of 1920px primary
REM              -1920,0  = second monitor on the LEFT
REM ============================================================

echo.
echo ============================================
echo   ISB Customer Display Setup
echo ============================================
echo.
echo This will:
echo   - Create a Chrome kiosk-mode shortcut
echo   - Place it in Windows Startup folder
echo   - Customer Display will auto-launch fullscreen every boot
echo.
pause

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined CHROME (
  echo.
  echo ERROR: Google Chrome not found in standard locations.
  echo Please install Chrome first, then run this again.
  echo.
  pause
  exit /b 1
)

echo Chrome found: %CHROME%
echo Target URL:   %URL%
echo Position:     %POSITION%
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\ISB Customer Display.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$s = $ws.CreateShortcut('%SHORTCUT%');" ^
  "$s.TargetPath = '%CHROME%';" ^
  "$s.Arguments = '--kiosk --window-position=%POSITION% --no-first-run --noerrdialogs --disable-translate --autoplay-policy=no-user-gesture-required %URL%';" ^
  "$s.IconLocation = '%CHROME%,0';" ^
  "$s.WorkingDirectory = (Split-Path '%CHROME%');" ^
  "$s.Save()"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo ERROR: Failed to create shortcut.
  pause
  exit /b 1
)

if not exist "%SHORTCUT%" (
  echo.
  echo ERROR: Shortcut was not created.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Setup complete!
echo ============================================
echo.
echo Shortcut created at:
echo   %SHORTCUT%
echo.
echo Next: Restart Windows. Customer Display will open
echo       fullscreen on the second monitor automatically.
echo.
echo To uninstall, just delete that shortcut.
echo.
pause
