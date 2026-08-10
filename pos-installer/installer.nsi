; ISB POS Setup — Windows installer
; Built with NSIS 3 (Unicode). Build on macOS via build.sh + makensis.
;
; Components:
;   a. EDC card terminal USB driver (whql_Driver2020)
;   b. Paywire EDC bridge (paywire.exe, autostart)
;   c. Chrome kiosk auto-start (https://isb.schooney.tech/login) + the
;      Local Network Access enterprise policy the EDC bridge needs
;
; RFID (ACR1252 bridge/NSSM service) was dropped from this installer —
; this build targets EDC-only POS terminals. rfid-bridge/ itself still
; exists at the repo root for other deployments; only this installer's
; packaging of it was removed.

Unicode true

!include "MUI2.nsh"
!include "LogicLib.nsh"

; ---------------------------------------------------------------------------
; General
; ---------------------------------------------------------------------------
Name "ISB POS Setup"
OutFile "dist\ISB-POS-Setup-1.0.0.exe"
InstallDir "C:\ISB"
InstallDirRegKey HKLM "Software\ISB\POS" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; ---------------------------------------------------------------------------
; MUI2 pages
; ---------------------------------------------------------------------------
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "ISB POS Setup Complete"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Always-run hidden section: common files, uninstaller, Add/Remove Programs
; entry.
; ---------------------------------------------------------------------------
Section "-Common" SecCommon
  SetOutPath "$INSTDIR"
  File "README.txt"
  File "check-pos.ps1"
  File "fix-edc-driver.ps1"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKLM "Software\ISB\POS" "InstallDir" "$INSTDIR"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS" "DisplayName" "ISB POS Components"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS" "Publisher" "ISB"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS" "DisplayVersion" "1.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS" "NoRepair" 1
SectionEnd

; ---------------------------------------------------------------------------
; Section: EDC card terminal USB driver
; ---------------------------------------------------------------------------
Section "EDC card terminal USB driver (whql_Driver2020)" SecDriver
  SetOutPath "$INSTDIR\driver"
  File /r "payload\driver\*.*"

  ; DriverInstall.exe (per vendor's own DriverInstall_Guide.pdf) is fully
  ; unattended — it installs all 4 sub-drivers (usb/adb/qcusber/modem) on its
  ; own and takes ~30s, no wizard/clicks needed. The ONE blocking step is
  ; that it ends with "Press any key to exit" on its console — with nobody
  ; physically present, ExecWait below would hang forever waiting for that
  ; keypress. Piping a blank line into its stdin via `cmd /c echo.|` supplies
  ; that keypress automatically so the install proceeds unattended.
  DetailPrint "Installing EDC USB driver (whql_Driver2020) — unattended, ~30s..."
  ExecWait 'cmd.exe /c echo.| "$INSTDIR\driver\DriverInstall.exe"'
SectionEnd

; ---------------------------------------------------------------------------
; Section: Paywire EDC bridge
; ---------------------------------------------------------------------------
Section "Paywire EDC bridge" SecPaywire
  ; Release the file lock if a previous paywire.exe is still running
  ; (reinstall case); harmless failure if it is not running.
  ExecWait 'taskkill /F /IM paywire.exe'

  SetOutPath "$INSTDIR\paywire"
  File "payload\paywire\paywire.exe"

  ; All-users Startup shortcut so paywire.exe launches on every login
  SetShellVarContext all
  CreateDirectory "$SMSTARTUP"
  CreateShortcut "$SMSTARTUP\Paywire Bridge.lnk" "$INSTDIR\paywire\paywire.exe"

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\Paywire Bridge.lnk" "$INSTDIR\paywire\paywire.exe"
  SetShellVarContext current

  ; Start it now so the operator can verify it immediately after install
  DetailPrint "Starting Paywire EDC bridge..."
  Exec '"$INSTDIR\paywire\paywire.exe"'
SectionEnd

; ---------------------------------------------------------------------------
; Section: Chrome kiosk auto-start + Local Network Access policy
; ---------------------------------------------------------------------------
Section "Chrome kiosk auto-start (isb.schooney.tech/login)" SecKiosk
  ; Recent Chrome versions gate a public HTTPS page (isb.schooney.tech)
  ; reaching a local-network/loopback service (the EDC Paywire bridge on
  ; 127.0.0.1:7331) behind a "Local Network Access" permission prompt —
  ; with nobody there to click "Allow", the bridge connection silently
  ; fails. This enterprise policy auto-grants it for our origin. List-type
  ; Chrome policies are stored as one registry value per list item, named
  ; "1", "2", ... under a subkey named after the policy itself.
  WriteRegStr HKLM "SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" "1" "isb.schooney.tech"

  ; The customer-display popup (second monitor) is watched by a JS watchdog
  ; (frontend/src/lib/customerDisplayWindow.ts) that silently reopens it if it
  ; ever closes — but that reopen fires from a timer, not a click, so Chrome's
  ; popup blocker eats it by default. This policy allow-lists our origin for
  ; popups so the watchdog's window.open() actually goes through.
  WriteRegStr HKLM "SOFTWARE\Policies\Google\Chrome\PopupsAllowedForUrls" "1" "isb.schooney.tech"

  ; Resolve the installed Chrome's real path via its registered App Path
  ; instead of guessing a hardcoded Program Files location (differs between
  ; 32/64-bit and per-machine/per-user installs).
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${If} $0 == ""
    DetailPrint "WARNING: Google Chrome not found — install it, then re-run this installer (or create the kiosk shortcut by hand) to enable kiosk auto-start."
  ${Else}
    SetShellVarContext all
    CreateDirectory "$SMSTARTUP"
    CreateShortcut "$SMSTARTUP\ISB POS Kiosk.lnk" "$0" '--kiosk "https://isb.schooney.tech/login" --kiosk-printing --no-first-run --noerrdialogs --disable-session-crashed-bubble'
    SetShellVarContext current

    DetailPrint "Starting Chrome in kiosk mode..."
    Exec '"$0" --kiosk "https://isb.schooney.tech/login" --kiosk-printing --no-first-run --noerrdialogs --disable-session-crashed-bubble'
  ${EndIf}
SectionEnd

; ---------------------------------------------------------------------------
; Component descriptions
; ---------------------------------------------------------------------------
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDriver} "Installs the EDC card terminal USB driver (whql_Driver2020). Unattended, ~30s — no wizard clicks needed."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPaywire} "Installs the Paywire EDC bridge and sets it to run automatically at every login."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecKiosk} "Sets Chrome to auto-launch https://isb.schooney.tech/login in kiosk mode on every login, and allow-lists the EDC bridge for Chrome's Local Network Access check."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------------------------------------------------------------------------
; Uninstaller
; ---------------------------------------------------------------------------
Section "Uninstall"
  ; Remove shortcuts
  SetShellVarContext all
  Delete "$SMSTARTUP\Paywire Bridge.lnk"
  Delete "$SMSTARTUP\ISB POS Kiosk.lnk"
  Delete "$DESKTOP\Paywire Bridge.lnk"
  SetShellVarContext current

  ; Remove the Local Network Access policy this installer added
  DeleteRegKey HKLM "SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls"

  ; Remove registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ISBPOS"
  DeleteRegKey HKLM "Software\ISB\POS"

  ; Kill a running paywire.exe so it does not lock files and leave the
  ; install directory half-deleted; harmless failure if not running.
  ExecWait 'taskkill /F /IM paywire.exe'

  ; Remove the install directory (driver is left installed on the system —
  ; only the payload files under $INSTDIR are removed)
  RMDir /r "$INSTDIR"
SectionEnd
