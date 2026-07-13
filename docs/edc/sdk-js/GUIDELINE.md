# @paywire/sdk-js — Integration Guide

Paywire bridges a cloud Web POS to a local EDC payment terminal. The SDK talks to
the bridge on the same machine; the bridge talks to the terminal. The SDK surface is
**device-neutral** — the same calls work whether the till is paired with a **Verifone
VTI** or a **Newland LinkPOS** terminal. The bridge driver maps each call to the
device's wire protocol.

## TL;DR — six lines to a working sale

```typescript
import { EdcClient } from "@paywire/sdk-js";

const edc = new EdcClient({ domain: "bridge.schooney.tech" });
await edc.ready();                                   // /whoami OK, status stream open

for await (const ev of edc.sale({ amount: 1000, idempotencyKey: crypto.randomUUID() })) {
  if (ev.kind === "result") console.log(ev.responseCode, ev.approvalCode);
}
```

For **local development** against the mock bridge, point at loopback over plain HTTP —
no TLS, no certissuer:

```typescript
const edc = new EdcClient({ domain: "127.0.0.1" });   // page served over http:// → SDK uses http/ws
```

---

## 1. Setup & discovery — feature-detect, don't assume the brand

```typescript
const edc = new EdcClient({
  domain: "bridge.schooney.tech",         // or "127.0.0.1" for local mock testing
  acceptedDevices: [                       // omit to accept any device
    { brand: "newland",  protocol: "linkpos-bay-v1.05" },
    { brand: "verifone", protocol: "vti-bay-aycap-v10.4.14" },
  ],
});

try {
  await edc.ready();                       // throws UnsupportedDeviceError if device not accepted
} catch (e) {
  if (e instanceof UnsupportedDeviceError) { /* fatal: payment not possible on this device */ }
}

edc.bridgeId;            // "POS-N910" — identifies this till; never shown to cashier
edc.device;              // { brand, model, protocol, firmware, connected, capabilities }
edc.terminalConnected;   // live boolean, updated by the /status stream
edc.capabilities;        // e.g. ["sale","qrSale.thaiqr","walletSale.alipay","query","settle",…]
```

**Capability reflection is the integration contract.** Different devices — and even
different firmware — support different operations. Drive your UI off `edc.capabilities`,
not off the brand. Methods whose capability is absent throw `UnsupportedCapabilityError`
**synchronously**, before touching the EDC:

```typescript
// Render only the payment buttons this terminal actually supports:
for (const cap of edc.capabilities) {
  if (cap.startsWith("qrSale."))     addQrButton(cap.slice("qrSale.".length));
  if (cap.startsWith("walletSale.")) addWalletButton(cap.slice("walletSale.".length));
}

// React to EDC connect/disconnect:
const unsub = edc.onTerminalStatus(s => { payButton.disabled = s.state !== "connected"; });
```

---

## 2. Sale

```typescript
for await (const ev of edc.sale({
  amount: 10000,                         // satang (0.01 THB). 10000 = THB 100.00
  idempotencyKey: crypto.randomUUID(),   // unique per attempt; safe to retry same key
  posRef: myPosRef,                      // LinkPOS POS reference (optional; defaults to idempotencyKey)
})) {
  switch (ev.kind) {
    // VTI streams these; LinkPOS does NOT (the terminal handles the prompts itself):
    case "chip-inserted":  showStatus("Reading card…");           break;
    case "pin-required":   showStatus("Customer entering PIN…");  break;
    case "sign-required":  showSignaturePrompt();                  break;
    case "processing":     showStatus("Follow the prompts on the terminal…"); break;
    case "result":
      if (ev.responseCode === "00") showReceipt(ev);
      else showDecline(ev.responseCode, ev.responseMessage);
      break;
  }
}
```

> **Event-model caveat.** LinkPOS (Newland) returns a single final response with no
> mid-transaction events — the cardholder taps/inserts/scans on the terminal's own
> screen. Drive the UI off a "Follow the prompts on the terminal…" status and the final
> `result`; **never *require* `chip-inserted`/`pin-required`** to arrive. VTI does stream
> them. Writing to the final `result` works for both.

### `result` event fields (safe to display)

| Field | Meaning |
|---|---|
| `ev.responseCode` | `"00"` = approved; see the tables in §5 |
| `ev.responseMessage` | Human message (LinkPOS `response_msg`), e.g. "SUCCESS" |
| `ev.approvalCode` | Approval / auth code |
| `ev.maskedPan` | VTI: `"453201******1234"` (first6+last4) |
| `ev.payerId` | LinkPOS: card/payer ref, already masked by the EDC |
| `ev.rrn` | Retrieval reference number |
| `ev.fields["invoice_no"]` / `ev.fields["50"]` | Invoice — save it for void/refund |
| `ev.fields["batch_no"]`, `ev.fields["entry_mode"]` | LinkPOS receipt extras |

**Hard rule: never log or display full PAN, track2, CVV, PIN, or cardholder name.**
LinkPOS never carries them; `payerId` is already masked. On VTI, fields `33`/`75`/`D5`
are dropped by the bridge — do not try to reconstruct them.

---

## 3. QR & wallet sales — canonical payment selectors

The SDK takes a **canonical** selector; the bridge maps it to the device's wire value.

```typescript
for await (const ev of edc.qrSale({ amount: 5000, idempotencyKey: key, payment: "thaiqr" })) {
  if (ev.kind === "qr-shown") displayQRCode(ev.payload);   // VTI only; LinkPOS shows it on-device
  if (ev.kind === "result")   handleResult(ev);
}

await edc.walletSale({ amount: 5000, idempotencyKey: key, payment: "alipay" });
```

### Payment selectors (use the names your `capabilities` advertise)

| Selector | Scheme | LinkPOS | VTI |
|---|---|---|---|
| `promptpay` | PromptPay | → Thai QR | ✓ `qrSale.promptpay` |
| `thaiqr` | Thai QR (TAG30) | ✓ `qrSale.thaiqr` | — |
| `qrvisa` / `qrmc` | QR Visa / QR Mastercard | ✓ | — |
| `alipay` | Alipay | ✓ `walletSale.alipay` | ✓ |
| `wechat` | WeChat Pay | ✓ | ✓ |
| `truemoney` / `linepay` / `airpay` / `dolfin` | Thai wallets | ✓ | `linepay` only |

> Legacy VTI single-letter selectors (`"P"`/`"A"`/`"W"`/`"L"`) are still accepted but
> deprecated — prefer the canonical names. Check `edc.capabilities` first: the cap string
> is `qrSale.<selector>` / `walletSale.<selector>`.

---

## 4. Void, refund, settle

```typescript
// Void: by LinkPOS posRef, or by VTI invoice number (field 50).
await edc.void({ posRef: lastPosRef, idempotencyKey: key });
await edc.void({ invoice: "000001", idempotencyKey: key });

// Refund (transactionId required for Alipay/WeChat wallet refunds on LinkPOS):
await edc.refund({ amount: 5000, posRef: ref, idempotencyKey: key });
await edc.walletRefund({ amount: 5000, transactionId: "57047…", idempotencyKey: key });

// Settlement:
await edc.settle();        // close batch
await edc.settleAll();     // VTI: settle all acquirers

await edc.commsTest();     // liveness check (VTI D0 / LinkPOS TEST)
```

> **LinkPOS VOID/REFUND are cardholder-present flows — confirmed on real N910 hardware.**
> The terminal makes the cardholder **tap/confirm on the device itself** before a void or
> refund is authorized (a contactless void re-reads the card to authorize the reversal).
> Until that happens, the terminal simply holds the line — the bridge gets **no response**.
> Treat `void`/`refund` exactly like `sale` for UX and timing:
>
> - Use a **generous timeout** (~90 s), not the short deadline you might expect for a
>   "just look this transaction up" call.
> - Show **"Follow the prompts on the terminal…"**, not a blocking spinner with no
>   explanation. This is normal EDC behavior, not a bridge bug or a dropped connection.
>
> **A real LinkPOS void needs the original sale's fields (but NOT the TID).** Verified on a
> physical N910: the VOID request carries `pos_ref_no` + the original sale's `invoice_no` +
> `card_approval_code` (+ `payment_type`). The **terminal TID is *not* required** — a void
> succeeds with no `transaction_id` (the terminal supplies its own in the response). So:
>
> - **Retain `invoice_no` and `approvalCode` from the SALE `result` event** and pass them to
>   `void`/`refund` (the SDK maps them to the wire fields). No TID needed. If your bridge has
>   a `device.tid` configured it's injected as an optional escape hatch, but it isn't required.
>
> **⚠️ Not every payment type can be voided by command.** Confirmed on the N910:
>
> | Last sale payment type | Voidable by command? |
> |---|---|
> | Card · Alipay · WeChat · TrueMoney · LINE Pay · AirPay · Dolfin (local e-wallets) | ✅ yes |
> | **Thai QR · QR Visa · QR Mastercard** | ❌ **no — void on the terminal only** |
>
> A void command against a Thai QR / QR-card sale does **not** work (the terminal hangs or
> returns not-found — repeated attempts can even freeze it). **Gate your Void UI by the last
> sale's payment type** — offer Void only for card + local e-wallets; for Thai QR / QR-card,
> the cashier voids on the terminal itself. (See `examples/web-pos`: the Void button disables
> after a Thai QR sale.)
>
> **REFUND (card) returned `NS` "Transaction is Not Support" on our test terminal** — card
> refund needs acquirer/merchant-profile enablement and isn't universally available. Treat
> `NS` as "not supported / not enabled," not a transient error to retry.

---

## 5. Response codes

### LinkPOS (Newland) — Appendix B

| Code | Meaning | Recommended UX |
|---|---|---|
| `00` | Approved | Show approval + receipt |
| `01`–`96` | Issuer/host decline family | Show the `responseMessage`; try another card/tender |
| `DR` | **Duplicate POS reference** | The prior result already applies — treat as success |
| `NE` | Transaction does not exist (QUERY) | Issue a fresh transaction |
| `UC` | Cancelled by user at terminal | Let the cashier retry |
| `PT` | Invalid/unsupported payment type | Programming error — check the selector |
| `ER` | Invalid request / missing field | Programming error — check parameters |
| `EA` | Refund exceeds original amount | Reduce the refund amount |
| `CE` / `LE` | Comms / link error | Transient — retry |

### VTI (Verifone)

| Code | Meaning | UX |
|---|---|---|
| `00` | Approved | Receipt |
| `01` | Refer to issuer | Try again / different card |
| `ND` | Declined | Different card |
| `EN`/`TO` | Network / timeout | Retry |
| `DI` | Duplicate invoice | Return prior result as success |
| `Y1`/`Y3` | Offline approved | Settlement will clear it |
| `Z1`/`Z3` | Offline declined | Declined |
| `UC`/`CN`/`XC` | Unacceptable / cancelled | As appropriate |

---

## 6. Idempotency & timeout recovery

1. **Always pass `idempotencyKey`.** It becomes the request id and (on LinkPOS) the
   POS reference if you don't pass `posRef` explicitly. On a network blip, **retry with
   the *same* key** — the EDC returns `DR` (LinkPOS) or `DI` (VTI), and you surface the
   prior result as success. Generate a fresh key for each *new* transaction.

2. **LinkPOS timeout recovery — `query`.** If a `sale` times out (you never got a
   response), don't blindly re-charge. Call `query` with the same `posRef` to learn the
   real outcome first:

   ```typescript
   if (edc.capabilities.includes("query")) {
     for await (const ev of edc.query({ posRef: lastPosRef, idempotencyKey: crypto.randomUUID() })) {
       if (ev.kind === "result") {
         if (ev.responseCode === "00") showReceipt(ev);          // it actually went through
         else if (ev.responseCode === "NE") retryTheSale();      // never happened — safe to retry
       }
     }
   }
   ```

3. **LinkPOS host verification — `verify`.** For Alipay/WeChat/Thai-QR, if the customer
   says they paid but the EDC shows otherwise, `verify({ posRef, payment })` asks the EDC
   to re-check with the acquirer host (it opens its camera to scan the QR/receipt).

---

## 7. Hard rules

1. **Never log/display PAN, track2, CVV, PIN, or cardholder name.** `maskedPan`/`payerId`
   are the only card-ish values exposed, and they are already masked.
2. **Never construct the bridge URL manually.** Use `new EdcClient({ domain })`; the
   scheme/port are managed internally (https/wss in production, http/ws when the page is
   served over http for local testing).
3. **Never hard-code `bridgeId`.** Read it from `/whoami`; each till has its own.
4. **Always pass `idempotencyKey`** and retry with the same key (see §6).
5. **Feature-detect with `edc.capabilities`** before showing buttons or calling methods.

---

## 8. Full annotated example (device-neutral)

```typescript
import { EdcClient, UnsupportedDeviceError } from "@paywire/sdk-js";

const edc = new EdcClient({
  domain: "127.0.0.1",   // local mock; use "bridge.schooney.tech" in production
  acceptedDevices: [
    { brand: "newland",  protocol: "linkpos-bay-v1.05" },
    { brand: "verifone", protocol: "vti-bay-aycap-v10.4.14" },
  ],
});

try {
  await edc.ready();
} catch (e) {
  if (e instanceof UnsupportedDeviceError) { showFatalBanner(e.message); return; }
  throw e;
}

document.title = `POS — ${edc.bridgeId}`;
edc.onTerminalStatus(s => { payButton.disabled = s.state !== "connected"; });

// Build payment buttons from whatever this terminal supports:
for (const cap of edc.capabilities) {
  if (cap === "sale")                addCardButton();
  else if (cap.startsWith("qrSale.")) addQrButton(cap.slice(7));        // e.g. "thaiqr"
  else if (cap.startsWith("walletSale.")) addWalletButton(cap.slice(11)); // e.g. "alipay"
}

// Run a Thai-QR sale:
const key = crypto.randomUUID();
for await (const ev of edc.qrSale({ amount: 10000, idempotencyKey: key, payment: "thaiqr" })) {
  if (ev.kind === "qr-shown") renderQR(ev.payload);   // VTI streams this; LinkPOS shows on-device
  if (ev.kind === "result") {
    if (ev.responseCode === "00") renderReceipt(ev);  // ev.responseMessage, ev.approvalCode, ev.payerId…
    else showError(`${ev.responseCode}: ${ev.responseMessage ?? "declined"}`);
  }
}
```

See [`examples/web-pos`](examples/web-pos) for a runnable, capability-driven Web POS
you can point at the mock bridge (`paywire --mode=mock`) over plain HTTP, and
[`INTEGRATION.html`](INTEGRATION.html) for a human-readable version of this guide.
