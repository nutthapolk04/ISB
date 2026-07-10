#!/usr/bin/env node

/**
 * RFID Reader Server for ACR1252
 * Listens to ACR1252 USB reader and broadcasts card UID via WebSocket
 */

const WebSocket = require('ws');
const http = require('http');

// For actual ACR1252 reading, we'd use:
// const pcsclite = require('pcsclite');
// For now, simulate keyboard input listener on the server

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const PORT = 9001;

console.log('🚀 RFID Reader Server starting on port', PORT);
console.log('📡 Listening for ACR1252 card taps...\n');

// Track connected clients
let clientCount = 0;

wss.on('connection', (ws) => {
  clientCount++;
  console.log(`✅ Client connected (${clientCount} total)`);

  ws.on('message', (message) => {
    console.log('📨 Received:', message);
  });

  ws.on('close', () => {
    clientCount--;
    console.log(`❌ Client disconnected (${clientCount} remaining)`);
  });

  ws.send(JSON.stringify({ type: 'ready', message: 'Connected to RFID server' }));
});

// Simulate receiving card UID from ACR1252
// In production, this would read from actual ACR1252 device via PC-SC or libusb
function broadcastCardUID(cardUID) {
  const message = JSON.stringify({
    type: 'card_detected',
    uid: cardUID,
    timestamp: new Date().toISOString(),
  });

  console.log('📢 Broadcasting card UID:', cardUID);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Example: simulate card tap every 30 seconds (for testing)
// Comment this out when using actual ACR1252
setInterval(() => {
  const testUIDs = ['D183880F', '0F8883D1', '04D1E23F'];
  const randomUID = testUIDs[Math.floor(Math.random() * testUIDs.length)];
  // Uncomment to test:
  // broadcastCardUID(randomUID);
}, 30000);

server.listen(PORT, () => {
  console.log(`🎯 WebSocket server listening on ws://localhost:${PORT}`);
  console.log('\nTo test:');
  console.log('  node -e "const WebSocket = require(\'ws\'); const ws = new WebSocket(\'ws://localhost:9001\'); ws.on(\'message\', m => console.log(m));"');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
