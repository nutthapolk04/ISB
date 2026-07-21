ISB POS Components
===================

This machine has the following ISB POS components installed under
C:\ISB (or the folder you chose during setup):

1. EDC card terminal USB driver (whql_Driver2020)
   - Installed silently via the vendor's own DriverInstall.exe (no
     wizard/clicks needed — it's a ~30s unattended console install).
   - Files kept at: driver\

2. Paywire EDC bridge (paywire.exe)
   - Runs automatically at every Windows login (Startup shortcut,
     all users) and has a Desktop shortcut "Paywire Bridge".
   - Files kept at: paywire\paywire.exe

3. RFID bridge service (ACR1252 + NSSM)
   - Registered as a native Windows Service named "rfid-bridge"
     (auto-start, auto-restart on crash).
   - WebSocket server on ws://localhost:9001 — the ISB web app
     already allows this in its Content-Security-Policy, so no
     further configuration is needed there.
   - Files kept at: rfid-bridge\, node\ (portable Node.js), nssm.exe
   - Logs: rfid-bridge\logs\out.log and rfid-bridge\logs\err.log
   - Re-run the service installer manually if needed:
       powershell -NoProfile -ExecutionPolicy Bypass -File install-rfid-service.ps1

Verifying the install — check each component in order
-------------------------------------------------------
Do these in order; later checks depend on earlier ones passing.

1) EDC driver
   Run: devmgmt.msc
   Under "Ports (COM & LPT)" or "Universal Serial Bus controllers",
   the Newland device should show with NO yellow warning icon.

2) Paywire bridge
   Get-Process paywire -ErrorAction SilentlyContinue
   Should show a running process and a tray icon. If not running,
   launch it from the "Paywire Bridge" Desktop/Startup shortcut.

   Test it responds (run this ON the POS machine only — this
   hostname always resolves to localhost):
   curl.exe -sk https://pos.local.bridge.schooney.tech:7331/whoami
   Should return JSON, not "connection refused".

3) RFID bridge service
   Get-Service rfid-bridge                        # must be Running
   Get-NetTCPConnection -LocalPort 9001 -State Listen   # must be listening
   Get-Content C:\ISB\rfid-bridge\logs\out.log -Tail 20 -Wait

   If Get-Service finds nothing, re-run the installer manually to see
   exactly where it fails:
     cd C:\ISB
     powershell -ExecutionPolicy Bypass -File install-rfid-service.ps1

4) Chrome "Local Network Access" policy (needed for the web app to
   reach ws://localhost:9001 at all — separate from the site's CSP)
   Recent Chrome blocks public sites (isb.schooney.tech) from quietly
   connecting to localhost/private-network addresses. Allow it once
   per machine:

     New-Item -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Force
     Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" -Name "1" -Value "isb.schooney.tech"

   Then fully close Chrome (all windows, not just the tab) and reopen.
   Verify at chrome://policy — search "LocalNetworkAccessAllowedForUrls",
   should show status OK with value isb.schooney.tech.

5) End-to-end test on the actual web app
   - Open the POS payment screen in Chrome (hard refresh: Ctrl+Shift+R)
   - EDC: status pill should show green "connected"
   - RFID: tap a card on the ACR1252 reader — the screen should register
     the tap immediately (watch the out.log tail from step 3 at the same
     time; you should see "Broadcasting card UID: ..." the instant the
     app reacts)
   - Open DevTools (F12) -> Console — must show NO red errors mentioning
     ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS or Content-Security-Policy

Uninstalling
------------
Use "Add or Remove Programs" -> "ISB POS Components" -> Uninstall,
or run C:\ISB\uninstall.exe directly. This stops and removes the
rfid-bridge Windows Service, removes the Paywire Startup/Desktop
shortcuts, and deletes the C:\ISB folder. The EDC USB driver is left
installed on the system (drivers are not uninstalled). The Chrome
LocalNetworkAccessAllowedForUrls registry policy (step 4 above) is
also NOT removed by uninstall — remove it by hand if needed.
