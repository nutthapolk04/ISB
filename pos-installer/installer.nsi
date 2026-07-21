; ISB POS Setup — Windows installer
; Built with NSIS 3 (Unicode). Build on macOS via build.sh + makensis.
;
; Components:
;   a. EDC card terminal USB driver (whql_Driver2020)
;   b. Paywire EDC bridge (paywire.exe, autostart)
;   c. RFID bridge service (ACR1252 + NSSM, Windows Service on port 9001)

Unicode true

!include "MUI2.nsh"

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
; entry. MUST come first in script order — SecRfid's ExecWait runs
; $INSTDIR\install-rfid-service.ps1, which this section installs.
; (Hidden sections execute in script order; the visible components page
; ordering is unaffected.)
; ---------------------------------------------------------------------------
Section "-Common" SecCommon
  SetOutPath "$INSTDIR"
  File "install-rfid-service.ps1"
  File "README.txt"

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
; Section: RFID bridge service (ACR1252 + NSSM)
; ---------------------------------------------------------------------------
Section "RFID bridge service (ACR1252 + NSSM)" SecRfid
  ; Reinstall case: stop the existing rfid-bridge service so its node.exe
  ; releases file locks on $INSTDIR\node and $INSTDIR\rfid-bridge before we
  ; overwrite them. The PowerShell script later does its own idempotent
  ; remove + reinstall of the service.
  IfFileExists "$INSTDIR\nssm.exe" 0 rfid_no_old_svc
    ExecWait '"$INSTDIR\nssm.exe" stop rfid-bridge'
  rfid_no_old_svc:

  SetOutPath "$INSTDIR\rfid-bridge"
  File /r "payload\rfid-bridge\*.*"

  SetOutPath "$INSTDIR\node"
  File /r "payload\node\*.*"

  SetOutPath "$INSTDIR"
  File "payload\nssm.exe"

  DetailPrint "Registering rfid-bridge Windows Service (this may take a minute)..."
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install-rfid-service.ps1"'
SectionEnd

; ---------------------------------------------------------------------------
; Component descriptions
; ---------------------------------------------------------------------------
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDriver} "Installs the EDC card terminal USB driver (whql_Driver2020). Unattended, ~30s — no wizard clicks needed."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPaywire} "Installs the Paywire EDC bridge and sets it to run automatically at every login."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecRfid} "Installs the ACR1252 RFID bridge as a Windows Service (NSSM) listening on ws://localhost:9001."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------------------------------------------------------------------------
; Uninstaller
; ---------------------------------------------------------------------------
Section "Uninstall"
  ; Stop and remove the rfid-bridge Windows Service
  IfFileExists "$INSTDIR\nssm.exe" 0 un_no_svc
    ExecWait '"$INSTDIR\nssm.exe" stop rfid-bridge'
    ExecWait '"$INSTDIR\nssm.exe" remove rfid-bridge confirm'
  un_no_svc:

  ; Remove shortcuts
  SetShellVarContext all
  Delete "$SMSTARTUP\Paywire Bridge.lnk"
  Delete "$DESKTOP\Paywire Bridge.lnk"
  SetShellVarContext current

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
