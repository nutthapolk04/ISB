import { EdcClient, UnsupportedCapabilityError } from "@paywire/sdk-js";
import type { TxnEvent, ResultEvent, EDCStatusEvent, PaymentSelector } from "@paywire/sdk-js";

// ── Setup ──────────────────────────────────────────────────────────────────
// Local dev/test points at the bridge on 127.0.0.1 over plain HTTP — no cert,
// no certissuer. In production you'd use `domain: "bridge.schooney.tech"` and the
// SDK would switch to https/wss automatically (it reads window.location.protocol).
const edc = new EdcClient({
  domain: "127.0.0.1",
  acceptedDevices: [
    { brand: "newland",  protocol: "linkpos-bay-v1.05" },
    { brand: "verifone", protocol: "vti-bay-aycap-v10.4.14" },
  ],
});

// ── DOM refs ───────────────────────────────────────────────────────────────
const banner      = document.getElementById("banner")!;
const bannerText  = document.getElementById("banner-text")!;
const amountDisp  = document.getElementById("amount-display")!;
const payButtons  = document.getElementById("pay-buttons")!;
const mgmtButtons = document.getElementById("mgmt-buttons")!;
const eventList   = document.getElementById("event-list")!;
const eventReqId  = document.getElementById("event-reqid")!;
const receiptSec  = document.getElementById("receipt-section") as HTMLElement;
const receiptEl   = document.getElementById("receipt")!;

// ── Amount keypad ──────────────────────────────────────────────────────────
let rawCents = 0; // satang (0.01 THB)
function refreshAmount(): void { amountDisp.textContent = (rawCents / 100).toFixed(2); }

document.querySelectorAll<HTMLButtonElement>(".key").forEach(btn => {
  btn.addEventListener("click", () => {
    const k = btn.dataset["key"] ?? "";
    if (k === "C") rawCents = 0;
    else if (k === "⌫") rawCents = Math.floor(rawCents / 10);
    else if (rawCents < 99999999) rawCents = rawCents * 10 + parseInt(k, 10);
    refreshAmount();
  });
});

// ── Banner / button state ────────────────────────────────────────────────────
function updateBanner(text: string, state: "ok" | "warn" | "disconnected"): void {
  bannerText.textContent = text;
  banner.className = `banner banner-${state}`;
}
function allButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("#pay-buttons button, #mgmt-buttons button")];
}

// ── Last-transaction state (drives Void gating) ──────────────────────────────
let lastPosRef = "";
let lastInvoice = "";
let lastApproval = "";
let lastVoidable = false;
let posRefSeq = 0;
let voidBtn: HTMLButtonElement | null = null;
// Payment types that can be VOIDed by command (doc §8): CARD + local e-wallets.
// Thai QR / QR Visa / QR Mastercard CANNOT be voided via the API — only on the terminal.
const VOIDABLE = new Set(["card", "alipay", "wechat", "truemoney", "linepay", "airpay", "dolfin"]);
const isVoidable = (sel: string): boolean => VOIDABLE.has(sel.toLowerCase());

function setButtonsEnabled(enabled: boolean): void {
  for (const b of allButtons()) b.disabled = !enabled;
  // Void Last is enabled only when the last successful sale exists AND is a voidable type.
  if (voidBtn) {
    voidBtn.disabled = !enabled || !lastPosRef || !lastVoidable;
    voidBtn.title = (lastPosRef && !lastVoidable)
      ? "The last payment type can't be voided by command (e.g. Thai QR) — void it on the terminal."
      : "";
  }
}

// ── Event log + receipt ──────────────────────────────────────────────────────
function logEvent(ev: TxnEvent): void {
  const li = document.createElement("li");
  let text = "";
  switch (ev.kind) {
    case "chip-inserted": text = "▶ Card inserted — reading chip…"; break;
    case "card-swiped":   text = "▶ Card swiped"; break;
    case "pin-required":  text = "▶ Customer entering PIN…"; break;
    case "sign-required": text = "▶ Signature required"; break;
    case "processing":    text = "▶ Follow the prompts on the terminal…"; break;
    case "qr-shown":      text = `▶ QR shown — ${ev.payload.slice(0, 32)}…`; break;
    case "result":
      text = `✓ Result: ${ev.responseCode}`
           + (ev.responseMessage ? ` · ${ev.responseMessage}` : "")
           + (ev.approvalCode ? ` · Approval ${ev.approvalCode}` : "");
      li.className = ev.responseCode === "00" ? "event-result-ok" : "event-result-fail";
      break;
  }
  li.textContent = text;
  eventList.prepend(li);
}
function clearLog(reqId: string): void {
  eventList.innerHTML = "";
  eventReqId.textContent = reqId.slice(0, 8) + "…";
  receiptSec.hidden = true;
}
function showReceipt(r: ResultEvent): void {
  receiptEl.innerHTML = "";
  const pairs: Array<[string, string]> = [["Response", r.responseCode]];
  if (r.responseMessage) pairs.push(["Message", r.responseMessage]);
  if (r.approvalCode)    pairs.push(["Approval", r.approvalCode]);
  if (r.maskedPan)       pairs.push(["PAN", r.maskedPan]);
  if (r.payerId)         pairs.push(["Payer", r.payerId]);
  if (r.rrn)             pairs.push(["RRN", r.rrn]);
  // Common LinkPOS receipt fields (all safe to display).
  for (const [k, label] of [
    ["invoice_no", "Invoice"], ["batch_no", "Batch"], ["entry_mode", "Entry"],
    ["terminal_id", "Terminal"], ["merchant_id", "Merchant"],
    ["total_sale_count", "Sale count"], ["total_sale_amount", "Sale total"],
  ] as const) {
    if (r.fields[k]) pairs.push([label, r.fields[k]]);
  }
  for (const [label, value] of pairs) {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    receiptEl.append(dt, dd);
  }
  receiptSec.hidden = false;
}

// ── Transaction runner ───────────────────────────────────────────────────────
// NOTE: the terminal TID that LinkPOS needs for VOID/REFUND is injected by the bridge
// from its `device.tid` config (and isn't even required for VOID) — the browser doesn't
// send it. We only pass the invoice + approval captured from the sale.

function newPosRef(): string {
  posRefSeq += 1;
  return `POS${Date.now()}${posRefSeq.toString().padStart(3, "0")}`;
}

async function runStream(
  gen: AsyncGenerator<TxnEvent>, reqId: string,
  sale?: { posRef: string; paysel: string },   // present only for sale/qr/wallet
): Promise<ResultEvent | null> {
  clearLog(reqId);
  setButtonsEnabled(false);
  // Cardholder-present flows (sale, qr, wallet, VOID, REFUND) prompt on the terminal
  // and stream no events until the customer acts — show a waiting hint.
  const waiting = document.createElement("li");
  waiting.textContent = "⏳ Follow the prompts on the terminal…";
  eventList.appendChild(waiting);
  try {
    for await (const ev of gen) {
      logEvent(ev);
      if (ev.kind === "result") {
        // On a successful sale, capture what's needed to void it later — and whether
        // its payment type is voidable by command (Thai QR is not; see VOIDABLE).
        if (ev.responseCode === "00" && sale) {
          lastPosRef = sale.posRef;
          lastVoidable = isVoidable(sale.paysel);
          lastInvoice = ev.fields["invoice_no"] ?? ev.fields["50"] ?? "";
          lastApproval = ev.approvalCode ?? ev.fields["approval_code"] ?? "";
        }
        showReceipt(ev);
        return ev;
      }
    }
  } catch (err) {
    const li = document.createElement("li");
    li.className = "event-result-fail";
    li.textContent = err instanceof UnsupportedCapabilityError
      ? `✗ Not supported by this device: ${err.capability}`
      : `✗ Error: ${(err as Error).message}`;
    eventList.prepend(li);
  } finally {
    waiting.remove();   // clear the "follow the prompts…" hint once the txn completes
    setButtonsEnabled(edc.terminalConnected);
  }
  return null;
}

function requireAmount(): boolean {
  if (rawCents <= 0) { alert("Enter an amount first"); return false; }
  return true;
}

// ── QR / e-wallet options offered by this POS ────────────────────────────────
// Curated, ordered set (Thai QR recommended, shown first). On LinkPOS these are all a
// SALE with a different payment_type; Thai QR routes via qrSale, the e-wallets via
// walletSale (their capability strings differ). Only options the device advertises show.
const OFFERED_QR: Array<{
  sel: PaymentSelector; label: string; cap: string; kind: "qr" | "wallet"; recommended?: boolean;
}> = [
  { sel: "thaiqr",  label: "Thai QR",    cap: "qrSale.thaiqr",      kind: "qr",     recommended: true },
  { sel: "alipay",  label: "Alipay",     cap: "walletSale.alipay",  kind: "wallet" },
  { sel: "wechat",  label: "WeChat Pay", cap: "walletSale.wechat",  kind: "wallet" },
  { sel: "linepay", label: "LINE Pay",   cap: "walletSale.linepay", kind: "wallet" },
];

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `btn ${cls}`;
  b.textContent = label;
  b.disabled = true;
  b.addEventListener("click", onClick);
  return b;
}

function renderButtons(): void {
  payButtons.innerHTML = "";
  mgmtButtons.innerHTML = "";
  const caps = edc.capabilities;

  if (caps.includes("sale")) {
    payButtons.append(button("Card Sale", "btn-primary", () => {
      if (!requireAmount()) return;
      const ref = newPosRef();
      runStream(edc.sale({ amount: rawCents, idempotencyKey: ref, posRef: ref }), ref,
                { posRef: ref, paysel: "card" });
    }));
  }

  // Curated QR / e-wallet buttons (Thai QR first + recommended). Only those the device
  // advertises are shown; each is a SALE with its own payment_type on LinkPOS.
  for (const m of OFFERED_QR) {
    if (!caps.includes(m.cap)) continue;
    payButtons.append(button(
      m.recommended ? `${m.label} ★` : m.label,
      m.recommended ? "btn-primary" : "btn-secondary",
      () => {
        if (!requireAmount()) return;
        const ref = newPosRef();
        const gen = m.kind === "qr"
          ? edc.qrSale({ amount: rawCents, idempotencyKey: ref, posRef: ref, payment: m.sel })
          : edc.walletSale({ amount: rawCents, idempotencyKey: ref, posRef: ref, payment: m.sel });
        runStream(gen, ref, { posRef: ref, paysel: m.sel });
      }));
  }

  if (caps.includes("void")) {
    // Enabled only after a voidable sale (see VOIDABLE / setButtonsEnabled). Thai QR and
    // the other QR-card schemes can't be voided by command — only on the terminal.
    voidBtn = button("Void Last", "btn-warn", async () => {
      if (!lastPosRef || !lastVoidable) {
        alert("Nothing voidable. (Thai QR / QR-card payments can only be voided on the terminal.)");
        return;
      }
      const ref = newPosRef();
      // LinkPOS void needs the original sale's invoice + approval; the terminal TID is
      // injected by the bridge from config, so the browser doesn't pass it.
      const res = await runStream(edc.void({
        posRef: lastPosRef, invoice: lastInvoice,
        cardApprovalCode: lastApproval, idempotencyKey: ref,
      }), ref);
      // After a successful void, there's nothing left to void.
      if (res?.responseCode === "00") { lastVoidable = false; setButtonsEnabled(edc.terminalConnected); }
    });
    mgmtButtons.append(voidBtn);
  }
  if (caps.includes("refund")) {
    mgmtButtons.append(button("Refund", "btn-warn", () => {
      if (!requireAmount()) return;
      const ref = newPosRef();
      runStream(edc.refund({
        amount: rawCents, posRef: ref, idempotencyKey: ref,
      }), ref);
    }));
  }
  if (caps.includes("query")) {
    mgmtButtons.append(button("Query Last (recover)", "btn-info", () => {
      if (!lastPosRef) { alert("No previous transaction to query"); return; }
      const ref = newPosRef();
      runStream(edc.query({ posRef: lastPosRef, idempotencyKey: ref }), ref);
    }));
  }
  if (caps.includes("verify")) {
    mgmtButtons.append(button("Verify Last", "btn-info", () => {
      if (!lastPosRef) { alert("No previous transaction to verify"); return; }
      const ref = newPosRef();
      runStream(edc.verify({ posRef: lastPosRef, idempotencyKey: ref }), ref);
    }));
  }
  if (caps.includes("settle")) {
    mgmtButtons.append(button("Settle", "btn-danger", () => {
      if (!confirm("Run settlement now?")) return;
      runStream(edc.settle(), newPosRef());
    }));
  }
  mgmtButtons.append(button("Comms Test", "btn-info", () => runStream(edc.commsTest(), newPosRef())));

  setButtonsEnabled(edc.terminalConnected);
}

// ── Boot ───────────────────────────────────────────────────────────────────
(async () => {
  updateBanner("Connecting to Paywire…", "warn");
  try {
    await edc.ready();
    const dev = edc.device!;
    renderButtons();
    updateBanner(
      `${edc.terminalConnected ? "✓" : "✗ EDC not connected ·"} ` +
      `Paywire ${edc.bridgeId} · ${dev.brand} ${dev.model} (${dev.protocol})`,
      edc.terminalConnected ? "ok" : "disconnected");
  } catch (err) {
    updateBanner(`Cannot reach Paywire: ${(err as Error).message}`, "disconnected");
    setButtonsEnabled(false);
  }

  edc.onTerminalStatus((s: EDCStatusEvent) => {
    const connected = s.state === "connected";
    updateBanner(
      connected
        ? `✓ Paywire ${edc.bridgeId} · EDC connected on ${s.port ?? "?"}`
        : `✗ EDC ${s.state}${s.reason ? " — " + s.reason : ""}`,
      connected ? "ok" : "disconnected");
    setButtonsEnabled(connected);
  });
})();
