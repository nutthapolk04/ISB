# RFID PC/SC Bridge

Local WebSocket bridge that reads ACR1252U NFC/RFID card UIDs via PC/SC and broadcasts them to the Canteen frontend.

## Prerequisites

- **ACS PC/SC Driver**: Download and install the ACS driver for ACR1252U from [ACS website](https://www.acs.com.hk/en/products/342/acr1252u-usb-nfc-reader-iii-nfc-forum-certified-reader/)
  - **Windows**: `acr1252u-setup.exe` from the driver page
  - **macOS**: PC/SC is built-in; just install the ACS reader driver if provided
  - **Linux**: Install `pcsclite` and `libusb` via package manager

- **Bun**: v1.3.0 or later (same as main project)

## Installation

```bash
cd rfid-bridge
bun install
```

## Running

```bash
bun start
```

Or directly:

```bash
bun run rfid-server.ts
```

This will:
1. Connect to the ACR1252U via PC/SC
2. Listen for card taps
3. Broadcast each card UID as a WebSocket message to `ws://localhost:9001`

## Message Format

When a card is detected:

```json
{
  "type": "card_detected",
  "uid": "0F8883D1",
  "timestamp": "2026-07-13T10:30:45.123Z"
}
```

The UID is in uppercase hex format (byte-reversed from the physical card UID in most cases). The frontend `useRfidListener` hook will capture this and pass it to the backend lookup endpoints, which handle all uid-format normalization via `card_uid.ts`.

## Troubleshooting

**"Error: Cannot find module 'nfc-pcsc'"**
- Run `bun install` again or check that modules are installed in `node_modules/`

**"PC/SC error" or no readers found**
- Ensure ACS driver is installed
- Check that ACR1252U is plugged in
- On Windows, check Device Manager → Smart card readers
- On macOS, run `system_profiler SPUSBDataType | grep -A10 ACR`

**WebSocket connection refused**
- Bridge is not running, or listening on a different port
- Check `PORT` env var if you customized it

## Auto-Start (Optional)

To auto-start on system boot:

**Windows**: 
1. Create a `.bat` file in `C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`:
   ```batch
   @echo off
   cd /d "C:\path\to\project\ISB\rfid-bridge"
   bun start
   ```

**macOS**:
Create a LaunchAgent plist in `~/Library/LaunchAgents/com.isb.rfid-bridge.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.isb.rfid-bridge</string>
  <key>Program</key>
  <string>/usr/local/bin/bun</string>
  <key>ProgramArguments</key>
  <array>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/project/ISB/rfid-bridge</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>/tmp/isb-rfid-bridge.err</string>
  <key>StandardOutPath</key>
  <string>/tmp/isb-rfid-bridge.log</string>
</dict>
</plist>
```

Then load it:
```bash
launchctl load ~/Library/LaunchAgents/com.isb.rfid-bridge.plist
```

**Linux**:
Create a systemd service in `/etc/systemd/system/isb-rfid-bridge.service`:
```ini
[Unit]
Description=ISB RFID PC/SC Bridge
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/bun start
WorkingDirectory=/path/to/project/ISB/rfid-bridge
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable it:
```bash
sudo systemctl enable isb-rfid-bridge
sudo systemctl start isb-rfid-bridge
```
