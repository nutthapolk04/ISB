ISB POS Components
===================

This machine has the following ISB POS components installed under
C:\ISB (or the folder you chose during setup):

1. EDC card terminal USB driver (whql_Driver2020)
   - Installed via the vendor's own DriverInstall.exe wizard.
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
     further configuration is needed.
   - Files kept at: rfid-bridge\, node\ (portable Node.js), nssm.exe
   - Logs: rfid-bridge\logs\out.log and rfid-bridge\logs\err.log
   - Re-run the service installer manually if needed:
       powershell -NoProfile -ExecutionPolicy Bypass -File install-rfid-service.ps1

Verifying the install
----------------------
- EDC: open the Paywire app / POS payment screen and check for a
  green "connected" status pill.
- RFID: tap a card on the ACR1252 reader; the POS screen should
  register the tap (bridge broadcasts the UID over ws://localhost:9001).
- Service status: Get-Service rfid-bridge

Uninstalling
------------
Use "Add or Remove Programs" -> "ISB POS Components" -> Uninstall,
or run C:\ISB\uninstall.exe directly. This stops and removes the
rfid-bridge Windows Service, removes the Paywire Startup/Desktop
shortcuts, and deletes the C:\ISB folder. The EDC USB driver is left
installed on the system (drivers are not uninstalled).
