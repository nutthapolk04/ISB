#!/usr/bin/env node

// test-reader.js — ทดสอบเครื่องอ่าน ACR1252U แบบ standalone
// ไม่มี WebSocket / ไม่แตะระบบ — แค่แตะบัตรแล้วพิมพ์ UID ออก console
// ใช้: node test-reader.js

import { NFC } from "nfc-pcsc";

const nfc = new NFC();
let readerCount = 0;

console.log("🔍 กำลังหาเครื่องอ่าน... (Ctrl+C เพื่อออก)\n");

nfc.on("reader", (reader) => {
  readerCount++;
  console.log(`📖 พบเครื่องอ่าน: ${reader.reader.name}`);

  reader.on("card", (card) => {
    console.log(`\n✅ อ่านบัตรได้!`);
    console.log(`   UID : ${card.uid}`);
    console.log(`   ATR : ${card.atr ? card.atr.toString("hex") : "-"}`);
    console.log(`   Type: ${card.type || "-"}\n`);
  });

  reader.on("card.off", () => {
    console.log("↩️  ยกบัตรออกแล้ว — แตะใบต่อไปได้เลย");
  });

  reader.on("error", (err) => {
    console.error(`❌ Reader error: ${err.message}`);
  });

  reader.on("end", () => {
    readerCount--;
    console.log(`🔌 เครื่องอ่านถูกถอด: ${reader.reader.name}`);
  });
});

nfc.on("error", (err) => {
  console.error(`❌ PC/SC error: ${err.message}`);
});

setTimeout(() => {
  if (readerCount === 0) {
    console.log("⚠️  ยังไม่พบเครื่องอ่านใน 3 วินาที — ตรวจสอบสาย USB / driver / SCardSvr service");
  }
}, 3000);
