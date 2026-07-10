/**
 * Electron app for reading ACR1252 RFID card UID
 * Runs in main process and communicates with renderer
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const HID = require('node-hid');

let mainWindow;
let hidDevice;

// ACR1252 USB IDs
const ACR1252_VENDOR_ID = 0x0419;   // ACS
const ACR1252_PRODUCT_ID = 0x5100;  // ACR1252

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`data:text/html,
    <!DOCTYPE html>
    <html>
    <head>
      <title>ACR1252 RFID Reader Test</title>
      <style>
        body { font-family: system-ui; padding: 20px; max-width: 600px; margin: 0 auto; }
        .box { border: 1px solid #ccc; padding: 20px; border-radius: 8px; margin: 10px 0; }
        button { padding: 10px 20px; font-size: 16px; background: #007AFF; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .status { padding: 10px; border-radius: 4px; margin: 10px 0; }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
        .info { background: #d1ecf1; color: #0c5460; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
      </style>
    </head>
    <body>
      <h1>🔍 ACR1252 RFID Reader</h1>
      <div class="box">
        <h3>Instructions:</h3>
        <ol>
          <li>Click "Start Listening" button below</li>
          <li>Tap your RFID card on the ACR1252 reader</li>
          <li>The card UID will appear below</li>
        </ol>
      </div>

      <div class="box">
        <button id="startBtn" onclick="startListening()">🎯 Start Listening</button>
        <button id="stopBtn" onclick="stopListening()" disabled>⏹️ Stop</button>
      </div>

      <div id="status"></div>
      <div id="result"></div>

      <script>
        function updateStatus(message, type = 'info') {
          const el = document.getElementById('status');
          el.className = 'status ' + type;
          el.textContent = message;
        }

        function startListening() {
          document.getElementById('startBtn').disabled = true;
          document.getElementById('stopBtn').disabled = false;
          updateStatus('⏳ Starting listener...', 'info');
          window.electronAPI.startListener();
        }

        function stopListening() {
          document.getElementById('startBtn').disabled = false;
          document.getElementById('stopBtn').disabled = true;
          updateStatus('Stopped listening', 'info');
          window.electronAPI.stopListener();
        }

        // Listen for messages from main process
        window.electronAPI.onCardDetected((uid) => {
          updateStatus('✅ Card detected!', 'success');
          const el = document.getElementById('result');
          el.innerHTML = \`<div class="box"><strong>Card UID:</strong> <code>\${uid}</code></div>\`;
        });

        window.electronAPI.onError((error) => {
          updateStatus('❌ ' + error, 'error');
        });

        // Check device on load
        window.electronAPI.checkDevice();
      </script>
    </body>
    </html>
  `);
}

// Preload script
const fs = require('fs');
const preloadPath = path.join(__dirname, 'preload.js');
const preloadContent = `
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startListener: () => ipcRenderer.send('start-listener'),
  stopListener: () => ipcRenderer.send('stop-listener'),
  checkDevice: () => ipcRenderer.send('check-device'),
  onCardDetected: (callback) => ipcRenderer.on('card-detected', (event, uid) => callback(uid)),
  onError: (callback) => ipcRenderer.on('error', (event, msg) => callback(msg)),
});
`;
fs.writeFileSync(preloadPath, preloadContent);

// IPC handlers
ipcMain.on('check-device', (event) => {
  try {
    const devices = HID.devices();
    const acr = devices.find(d => d.vendorId === ACR1252_VENDOR_ID && d.productId === ACR1252_PRODUCT_ID);

    if (acr) {
      event.reply('error', `✅ ACR1252 found! Path: ${acr.path}`);
    } else {
      event.reply('error', '❌ ACR1252 not found. Check connection.');
    }
  } catch (e) {
    event.reply('error', `Error: ${e.message}`);
  }
});

ipcMain.on('start-listener', (event) => {
  try {
    const devices = HID.devices();
    const acr = devices.find(d => d.vendorId === ACR1252_VENDOR_ID && d.productId === ACR1252_PRODUCT_ID);

    if (!acr) {
      event.reply('error', '❌ ACR1252 not found');
      return;
    }

    hidDevice = new HID.HID(acr.path);
    event.reply('error', '✅ Listening for cards...');

    hidDevice.on('data', (data) => {
      // Parse card UID from HID data
      // ACR1252 sends card UID in specific format
      const uid = Buffer.from(data).toString('hex').toUpperCase();
      console.log('Card data:', uid);
      event.reply('card-detected', uid);
    });

    hidDevice.on('error', (err) => {
      event.reply('error', `Device error: ${err.message}`);
    });
  } catch (e) {
    event.reply('error', `Error: ${e.message}`);
  }
});

ipcMain.on('stop-listener', (event) => {
  if (hidDevice) {
    hidDevice.close();
    hidDevice = null;
    event.reply('error', '⏹️ Listener stopped');
  }
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (hidDevice) hidDevice.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
