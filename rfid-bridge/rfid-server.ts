#!/usr/bin/env bun

import WebSocket from "ws";
import http from "http";
import { NFC } from "nfc-pcsc";

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 9001;

console.log("🚀 RFID PC/SC Bridge starting on port", PORT);
console.log("📡 Connecting to ACR1252U via PC/SC...\n");

let clientCount = 0;

// WebSocket server — broadcasts card UIDs to connected clients
wss.on("connection", (ws) => {
  clientCount++;
  console.log(`✅ Client connected (${clientCount} total)`);
  ws.send(JSON.stringify({ type: "ready", message: "Connected to RFID PC/SC bridge" }));

  ws.on("close", () => {
    clientCount--;
    console.log(`❌ Client disconnected (${clientCount} remaining)`);
  });
});

function broadcastCardUID(uid: string) {
  const message = JSON.stringify({
    type: "card_detected",
    uid,
    timestamp: new Date().toISOString(),
  });

  console.log(`📢 Broadcasting card UID: ${uid}`);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// PC/SC RFID reader via nfc-pcsc
const nfc = new NFC();

nfc.on("reader", (reader) => {
  console.log(`📖 Reader detected: ${reader.name}\n`);

  reader.on("card", (card) => {
    // card.uid is already parsed by nfc-pcsc as hex string (e.g., "0F8883D1")
    const uid = card.uid.toUpperCase();
    broadcastCardUID(uid);
  });

  reader.on("card.off", (card) => {
    console.log(`🔄 Card removed\n`);
  });

  reader.on("error", (err) => {
    console.error(`❌ Reader error (${reader.name}):`, err.message);
  });

  reader.on("end", () => {
    console.log(`🛑 Reader disconnected: ${reader.name}\n`);
  });
});

nfc.on("error", (err) => {
  console.error("❌ PC/SC error:", err.message);
  console.error("   Make sure ACS PC/SC driver is installed and the reader is connected.");
});

server.listen(PORT, () => {
  console.log(`🎯 WebSocket server listening on ws://localhost:${PORT}`);
  console.log("\nReady to broadcast card UIDs from ACR1252U.\n");
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  nfc.close();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});
