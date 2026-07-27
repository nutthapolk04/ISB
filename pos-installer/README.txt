ISB POS Components
===================

This machine has the following ISB POS components installed under
C:\ISB (or the folder you chose during setup):

1. EDC card terminal USB driver (whql_Driver2020)
   - Installed silently via the vendor's own DriverInstall.exe (no
     wizard/clicks needed -- it's a ~30s unattended console install).
   - Files kept at: driver\

2. Paywire EDC bridge (paywire.exe)
   - Runs automatically at every Windows login (Startup shortcut,
     all users) and has a Desktop shortcut "Paywire Bridge".
   - Files kept at: paywire\paywire.exe

3. Chrome kiosk auto-start
   - Startup shortcut (all users) named "ISB POS Kiosk" launches Chrome
     with --kiosk against https://isb.schooney.tech/login on every login.
   - Also sets Chrome's LocalNetworkAccessAllowedForUrls enterprise
     policy to isb.schooney.tech, so the page can reach the Paywire
     bridge on 127.0.0.1:7331 without a permission prompt blocking it.
     Fully restart Chrome once after install for this to take effect.

Note: the RFID bridge (ACR1252 + NSSM) that used to be component 3 has
been removed from this installer -- this build targets EDC-only POS
terminals. rfid-bridge\ still exists at the repo root for other
deployments; only this installer's packaging of it was dropped.

Verifying the install -- check each component in order
-------------------------------------------------------
Shortcut: run check-pos.ps1 (installed alongside this file at C:\ISB) to
check all 4 items below AND automatically fix whatever it safely can
(EDC driver patch, restart Paywire, recreate the kiosk shortcut, set the
Chrome policy), with a pass/fail summary at the end. Must run as
Administrator (it installs a Windows patch and writes HKLM). Safe to
re-run as many times as you like:

  cd C:\ISB
  powershell -ExecutionPolicy Bypass -File check-pos.ps1

Details for each check below (for debugging why a specific one failed) --
do these in order; later checks depend on earlier ones passing.

1) EDC driver
   Run: devmgmt.msc
   Under "Ports (COM & LPT)" or "Universal Serial Bus controllers",
   the Newland device should show with NO yellow warning icon.

   If it shows yellow, check-pos.ps1 (run above) already calls
   fix-edc-driver.ps1 automatically -- nothing else to do. To run just
   the driver fix on its own (needs administrator):
     cd C:\ISB
     powershell -ExecutionPolicy Bypass -File fix-edc-driver.ps1
   This automates DriverInstall_Guide.pdf section 4.3: checks Windows
   Service Pack 1 (Win7 only), installs the bundled
   Windows6.1-KB3033929-x64.msu patch, then rescans hardware. If it's
   still yellow afterward, see section 4.5 (manual driver update) in
   the same PDF, or INSTALL-GUIDE.html's troubleshooting section.

2) Paywire bridge
   Get-Process paywire -ErrorAction SilentlyContinue
   Should show a running process and a tray icon. If not running,
   launch it from the "Paywire Bridge" Desktop/Startup shortcut.

   Test it responds (run this ON the POS machine only -- this
   hostname always resolves to localhost):
   curl.exe -sk https://pos.local.bridge.schooney.tech:7331/whoami
   Should return JSON, not "connection refused".

3) Chrome kiosk auto-start + Local Network Access policy
   Test-Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\ISB POS Kiosk.lnk"
   Should be True.

   Verify at chrome://policy -- search "LocalNetworkAccessAllowedForUrls",
   should show status OK with value isb.schooney.tech.

   If it's missing or shows Ignored:
   - Not fully restarted: Get-Process chrome must show NO process
     before you reopen Chrome (closing the last tab is not enough).
   - Registry not written: check with
     Get-ItemProperty "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls"
   - Wrong policy name for this Chrome version: this feature has been
     renamed more than once while it rolled out. Check the installed
     version at chrome://version and cross-reference the policy name
     at chromeenterprise.google/policies before editing installer.nsi.

   Fallback to set it by hand:
     New-Item -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Force
     Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Name "1" -Value "isb.schooney.tech"

4) End-to-end test on the actual web app
   - Open the POS payment screen in Chrome (hard refresh: Ctrl+Shift+R,
     or if it's already open via the kiosk shortcut, close Chrome
     completely and let it relaunch instead)
   - EDC: status pill should show green "connected"
   - Open DevTools (F12) -> Console -- must show NO red errors mentioning
     ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS or Content-Security-Policy
     (if present, step 3 above hasn't actually taken effect yet)

Uninstalling
------------
Use "Add or Remove Programs" -> "ISB POS Components" -> Uninstall,
or run C:\ISB\uninstall.exe directly. This removes the Paywire and
Kiosk Startup/Desktop shortcuts, removes the LocalNetworkAccessAllowedForUrls
registry policy this installer added, and deletes the C:\ISB folder.
The EDC USB driver and Chrome itself are left installed on the system
(not uninstalled).
