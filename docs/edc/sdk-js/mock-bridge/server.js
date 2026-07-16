// ─────────────────────────────────────────────────────────────────────────────
// Paywire MOCK bridge — โมdก bridge จำลอง (Node.js)
// ─────────────────────────────────────────────────────────────────────────────
// นี่คือ "ของปลอม" ที่พูดภาษา HTTP/WS แบบเดียวกับ Paywire bridge ตัวจริง (.NET)
// เพียงพอให้ @paywire/sdk-js ทำงานครบ flow โดยไม่ต้องมีเครื่อง EDC จริง.
// This is a FAKE bridge that speaks exactly the HTTP/WS API the SDK calls.
//
// สัญญา (contracts) ที่ยืนยันจาก src/client.ts + src/types.ts:
//   • Base URL: หน้าเว็บเสิร์ฟผ่าน http:// + domain "127.0.0.1"  → SDK คุยแบบ
//     http://127.0.0.1:7331 (REST) และ ws://127.0.0.1:7331 (WebSocket).
//   • GET  /whoami                → { bridgeId, device{...}, version }
//   • WS   /status                → ส่ง { kind:"edc", edc:{ state:"connected", ... } }
//   • WS   /events?reqId=<id>      → mid-txn events (SDK อ่าน field "kind")
//   • POST /txn/<cmd>              → ผลลัพธ์สุดท้ายมาจาก "body ของ HTTP" ไม่ใช่ WS
//                                    body = { responseCode, approvalCode?, fields? }
//
// เปิดพอร์ต 127.0.0.1:7331 เท่านั้น (loopback) — โหมด mock ใช้ plain http/ws ไม่มี TLS.
// ─────────────────────────────────────────────────────────────────────────────

import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const HOST = "127.0.0.1";
const PORT = 7331;

// ── ดีเลย์จำลอง (ms) — ปรับได้ผ่าน env เพื่อทดสอบเร็ว/ช้า ────────────────────
// Simulated delays (ms), configurable via env for fast/slow testing:
//   MOCK_QR_DELAY_MS   — qrsale: เวลารวมตั้งแต่รับ request จน "ธนาคารตอบ"
//                        (QR โชว์บนจอ ~1.5s แรก แล้วรอลูกค้าสแกน + host ตอบ)
//   MOCK_SALE_DELAY_MS — sale: เวลารวม insert/tap บัตร + host อนุมัติ
const QR_DELAY_MS = Number(process.env.MOCK_QR_DELAY_MS ?? 10000);
const SALE_DELAY_MS = Number(process.env.MOCK_SALE_DELAY_MS ?? 5000);
const QR_SHOWN_AFTER_MS = 1500; // QR ปรากฏบนจอ terminal หลังส่ง amount ~1.5s

// ── อุปกรณ์จำลอง — เลือก LinkPOS (Newland) เพราะได้ QR + wallet + query ครบสุด ──
// SDK อ่านเฉพาะ: device.brand, device.protocol, device.connected, device.capabilities,
// และ bridgeId. field อื่น (model/firmware/version) มีไว้โชว์เฉยๆ.
const WHOAMI = {
  bridgeId: "POS-MOCK-01",
  device: {
    brand: "newland",
    model: "N910",
    protocol: "linkpos-bay-v1.05",
    firmware: "1.05-mock",
    connected: true,
    // capability strings ขับ UI ของ example ทั้งหมด (feature-detect).
    capabilities: [
      "sale",
      "qrSale.thaiqr",
      "walletSale.alipay",
      "walletSale.wechat",
      "walletSale.linepay",
      "void",
      "refund",
      "query",
      "verify",
      "settle",
    ],
  },
  version: "mock-0.0.1",
};

// ── CORS: ให้หน้าเว็บ (origin ใดก็ได้ที่เสิร์ฟผ่าน http) เรียกได้ + อนุญาต header
//    "Idempotency-Key" ที่ SDK แนบมากับ POST /txn/* ─────────────────────────────
function setCors(req, res) {
  const origin = req.headers.origin ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

// ── สร้างผล "อนุมัติ (00)" ปลอม ตาม shape ที่ client._toResult() อ่าน ──────────
// SDK map fields ดังนี้:  approval_code→approvalCode, "30"→maskedPan (VTI),
// payer_id→payerId (LinkPOS), D3/ref_no→rrn, response_msg/"02"→responseMessage.
// (kind:"result" ถูกเติมโดย SDK เอง — body ไม่ต้องมี.)
function approvedResult(cmd, reqBody) {
  const now = new Date();
  const invoice = String(1000 + Math.floor(Math.random() * 9000));
  const approval = String(100000 + Math.floor(Math.random() * 900000));
  const rrn = now.getTime().toString().slice(-12);

  const fields = {
    response_msg: "SUCCESS",          // → responseMessage
    approval_code: approval,          // → approvalCode (มี top-level ด้วยข้างล่าง)
    ref_no: rrn,                      // → rrn
    payer_id: "xxxx-xxxx-1234",       // → payerId (mask แล้ว, LinkPOS)
    invoice_no: invoice,              // เก็บไว้ทำ void/refund
    batch_no: "000001",
    entry_mode: "CONTACTLESS",
    terminal_id: "12345678",
    merchant_id: "000000000012345",
    pos_ref_no: (reqBody?.fields && reqBody.fields.pos_ref_no) || "",
  };

  // settle/settleall แถม field สรุปยอดให้ receipt ของ example โชว์.
  if (cmd === "settle" || cmd === "settleall") {
    fields.total_sale_count = "3";
    fields.total_sale_amount = "30000";
  }

  return {
    responseCode: "00",        // "00" = approved
    approvalCode: approval,     // top-level (SDK ใช้ตัวนี้ก่อน ถ้าไม่มีค่อยดู fields)
    fields,
  };
}

// ── สร้างผล "ปฏิเสธ (51)" ปลอม — จำลองธนาคารตอบ INSUFFICIENT FUNDS ─────────────
// ไม่มี approvalCode (ธุรกรรมไม่ผ่าน จึงไม่มีรหัสอนุมัติ).
// Fake "declined (51)" result — no approvalCode since nothing was approved.
function declinedResult() {
  return {
    responseCode: "51",
    fields: { response_msg: "INSUFFICIENT FUNDS" },
  };
}

// ── ทริกเกอร์จำลองปฏิเสธ: ยอด satang ที่ลงท้าย 99 (เช่น ฿10.99 → 1099) ─────────
// Decline trigger for sale/qrsale: satang amount modulo 100 === 99.
function shouldDecline(body) {
  const satang = Number(body?.amount ?? 0);
  return Number.isFinite(satang) && satang % 100 === 99;
}

function baht(body) {
  const satang = Number(body?.amount ?? 0);
  return `฿${(satang / 100).toFixed(2)} (${satang} satang)`;
}

// mid-txn events (จำลอง) — LinkPOS จริงไม่ค่อยส่ง แต่ใส่ 1-2 อันให้เห็นว่า /events ทำงาน.
// SDK อ่านเฉพาะ field "kind" ของแต่ละ event ("processing", "qr-shown" ฯลฯ).
const eventsByReqId = new Map();

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  setCors(req, res);

  // preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // GET /whoami
  if (req.method === "GET" && url.pathname === "/whoami") {
    console.log("[mock] GET /whoami");
    sendJson(res, 200, WHOAMI);
    return;
  }

  // POST /txn/<cmd>
  if (req.method === "POST" && url.pathname.startsWith("/txn/")) {
    const cmd = url.pathname.slice("/txn/".length);
    const idem = req.headers["idempotency-key"] ?? "";
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      console.log(`[mock] POST /txn/${cmd}  Idempotency-Key=${idem}  amount=${body.amount ?? "-"}`);

      // ── qrsale: จำลองไทม์ไลน์จริง — amount ถึง terminal → QR โชว์บนจอ (~1.5s)
      //    → ลูกค้าสแกน + host ธนาคารตอบ → ค่อยส่ง HTTP response (รวม ~QR_DELAY_MS).
      //    Real timeline: amount reaches terminal → QR appears → customer scans →
      //    bank host responds → only then the HTTP response goes out.
      if (cmd === "qrsale") {
        const decline = shouldDecline(body);
        console.log(`[mock] QRSALE ${baht(body)} — showing QR on terminal…`);
        pushEvent(idem, { kind: "processing", reqId: idem });
        setTimeout(() => {
          console.log(`[mock] … QR shown, waiting for customer scan + bank host (${QR_DELAY_MS}ms total)`);
          pushEvent(idem, { kind: "qr-shown", reqId: idem, payload: "00020101021129370016A0000006770101110213MOCKQRPAYLOAD5303764540510000" });
        }, QR_SHOWN_AFTER_MS);
        setTimeout(() => {
          if (decline) {
            console.log(`[mock] … bank DECLINED, responding 51 INSUFFICIENT FUNDS`);
            sendJson(res, 200, declinedResult());
          } else {
            const result = approvedResult(cmd, body);
            console.log(`[mock] … bank approved, responding 00 approval=${result.approvalCode}`);
            sendJson(res, 200, result);
          }
        }, QR_DELAY_MS);
        return;
      }

      // ── sale (บัตร): จำลอง insert/tap บัตร + host อนุมัติ (~SALE_DELAY_MS).
      //    Card sale: simulates insert/tap + host approval round-trip.
      if (cmd === "sale") {
        const decline = shouldDecline(body);
        console.log(`[mock] SALE ${baht(body)} — waiting for card insert/tap + host (${SALE_DELAY_MS}ms)…`);
        pushEvent(idem, { kind: "processing", reqId: idem });
        setTimeout(() => {
          if (decline) {
            console.log(`[mock] … host DECLINED, responding 51 INSUFFICIENT FUNDS`);
            sendJson(res, 200, declinedResult());
          } else {
            const result = approvedResult(cmd, body);
            console.log(`[mock] … host approved, responding 00 approval=${result.approvalCode}`);
            sendJson(res, 200, result);
          }
        }, SALE_DELAY_MS);
        return;
      }

      // ── คำสั่งอื่น (void/refund/query/settle/…): อนุมัติทันทีเหมือนเดิม.
      //    Other commands keep the instant-approve behavior.
      pushEvent(idem, { kind: "processing", reqId: idem });

      // ผลลัพธ์สุดท้าย = body ของ HTTP (ไม่ใช่ WS).
      sendJson(res, 200, approvedResult(cmd, body));
    });
    return;
  }

  sendJson(res, 404, { error: "not found", path: url.pathname });
});

// ── WebSocket: /status และ /events ────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === "/status") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log("[mock] WS /status connected");
      // แจ้งทันทีว่า EDC เชื่อมต่อแล้ว — SDK อ่าน raw.kind==="edc" + edc.state==="connected".
      ws.send(JSON.stringify({
        kind: "edc",
        edc: { state: "connected", port: "COM-MOCK", firmware: "1.05-mock", since: new Date().toISOString() },
      }));
    });
    return;
  }

  if (url.pathname === "/events") {
    const reqId = url.searchParams.get("reqId") ?? "";
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log(`[mock] WS /events connected reqId=${reqId}`);
      eventsByReqId.set(reqId, ws);
      ws.on("close", () => { if (eventsByReqId.get(reqId) === ws) eventsByReqId.delete(reqId); });
    });
    return;
  }

  socket.destroy();
});

function pushEvent(reqId, ev) {
  const ws = eventsByReqId.get(reqId);
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(ev)); } catch { /* ignore */ }
  }
}

server.listen(PORT, HOST, () => {
  console.log(`[mock] Paywire MOCK bridge listening on http://${HOST}:${PORT}`);
  console.log(`[mock] device = ${WHOAMI.device.brand}/${WHOAMI.device.protocol}  caps=[${WHOAMI.device.capabilities.join(", ")}]`);
  console.log(`[mock] delays: qrsale=${QR_DELAY_MS}ms sale=${SALE_DELAY_MS}ms (MOCK_QR_DELAY_MS / MOCK_SALE_DELAY_MS) — satang ending 99 declines`);
});
