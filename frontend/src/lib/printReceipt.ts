// Shared print helper — used by Store, Canteen, Receipts, and ReceiptDetailDialog.
// Single source of truth for receipt HTML and the print trigger.

import type { SchoolInfo } from "@/contexts/SchoolInfoContext";

// ── Types (match backend ReceiptResponse) ────────────────────────────────────

export interface ReceiptOptionsSnapshotApi {
  options_total: number;
  groups: Array<{
    group_id: number;
    name: string;
    selection_type: "single" | "multi" | "quantity";
    options: Array<{
      option_id: number;
      name: string;
      price_delta: number;
      quantity: number;
    }>;
  }>;
}

export interface ReceiptBundleSnapshotApi {
  is_bundle: true;
  bundle_id: number;
  bundle_name: string;
  bundle_code: string;
}

export interface ReceiptItemApi {
  id: number;
  receipt_id: number;
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  // Backend reuses `options` to stash bundle metadata for bundle line items.
  options?: ReceiptOptionsSnapshotApi | ReceiptBundleSnapshotApi | null;
  created_at: string;
  product_variant?: {
    sku: string | null;
    variant_name: string | null;
    barcode: string | null;
  } | null;
}

export interface PayerDetail {
  name: string;
  code: string | null;
  grade: string | null;
  photo_url: string | null;
  role: string;
  wallet_balance: number | null;
}

export interface ReceiptApi {
  id: number;
  receipt_number: string;
  transaction_date: string;
  transaction_mode: string;
  customer_id: number | null;
  payer_user_id?: number | null;
  payer_department_id?: number | null;
  payer_kind?: string | null;
  payer_label?: string | null;
  payer_detail?: PayerDetail | null;
  created_by_name?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: string;
  status: string;
  notes: string | null;
  cash_received?: number | null;
  created_at: string;
  created_by: number;
  voided_at: string | null;
  voided_by: number | null;
  voided_reason: string | null;
  items: ReceiptItemApi[];
}

// ── Constants ────────────────────────────────────────────────────────────────

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  credit_card: "บัตรเครดิต",
  debit_card: "บัตรเดบิต",
  wallet: "Wallet",
  bank_transfer: "โอนเงิน",
  qr: "QR PromptPay",
  qr_promptpay: "QR PromptPay",
  edc: "EDC (บัตรเครดิต/เดบิต)",
  department: "ตัดงบหน่วยงาน",
  other: "อื่นๆ",
};

const PAYMENT_LABELS_EN: Record<string, string> = {
  cash: "Cash",
  wallet: "Wallet",
  card_tap: "Tap Card",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  edc: "EDC",
  bank_transfer: "Bank Transfer",
  qr: "QR PromptPay",
  qr_promptpay: "QR PromptPay",
  department: "Budget Deduction",
  other: "Other",
};

const RECEIPT_LABELS = {
  th: {
    subtitle: "ใบเสร็จรับเงิน / Receipt",
    receiptNo: "เลขที่",
    date: "วันที่",
    payer: "ผู้ชำระ",
    payment: "ชำระด้วย",
    itemDiscount: "ส่วนลด",
    billDiscount: "ส่วนลดท้ายบิล",
    tax: "ภาษี",
    subtotal: "ยอดรวม",
    grandTotal: "รวมสุทธิ",
    balanceBefore: "ยอดก่อนชำระ",
    balanceAfter: "ยอดคงเหลือ",
    voided: "*** ใบเสร็จนี้ถูกยกเลิกแล้ว ***",
    thanks: "ขอบคุณที่ใช้บริการ / Thank you",
    taxId: "เลขภาษี",
    tel: "โทร",
    locale: "th-TH",
  },
  en: {
    subtitle: "Receipt",
    receiptNo: "Receipt No.",
    date: "Date",
    payer: "Payer",
    payment: "Payment",
    itemDiscount: "Discount",
    billDiscount: "Bill Discount",
    tax: "Tax",
    subtotal: "Subtotal",
    grandTotal: "Grand Total",
    balanceBefore: "Balance Before",
    balanceAfter: "Balance After",
    voided: "*** THIS RECEIPT HAS BEEN VOIDED ***",
    thanks: "Thank you for your purchase",
    taxId: "Tax ID",
    tel: "Tel",
    locale: "en-GB",
  },
};

const ISB_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="64" height="64" role="img" aria-label="ISB Logo">
  <rect width="512" height="512" fill="#f3f4f6"/>
  <polygon points="256,120 60,300 452,300" fill="#eacb46"/>
  <polygon points="256,158 154,264 358,264" fill="#d4362a"/>
  <polygon points="256,158 358,264 256,264" fill="#b6352a"/>
  <text x="256" y="430" text-anchor="middle" font-family="Times New Roman, serif" font-size="190" fill="#111111">ISB</text>
</svg>`;

// ── HTML builder ─────────────────────────────────────────────────────────────

export function buildReceiptHtml(
  r: ReceiptApi,
  school: SchoolInfo,
  shopName?: string | null,
  lang: string = "th",
): string {
  const isEn = lang.startsWith("en");
  const lbl = isEn ? RECEIPT_LABELS.en : RECEIPT_LABELS.th;
  const paymentLabel = isEn
    ? (PAYMENT_LABELS_EN[r.payment_method] ?? r.payment_method)
    : (PAYMENT_LABELS[r.payment_method] ?? r.payment_method);
  const dateStr = new Date(r.transaction_date).toLocaleString(lbl.locale, {
    dateStyle: "short",
    timeStyle: "short",
  });

  const itemRows = r.items.map((item) => {
    const bundleMeta =
      item.options && (item.options as ReceiptBundleSnapshotApi).is_bundle === true
        ? (item.options as ReceiptBundleSnapshotApi)
        : null;
    const name = bundleMeta
      ? bundleMeta.bundle_name
      : item.product_variant?.variant_name ?? `Product #${item.product_variant_id}`;
    const menuOptions =
      !bundleMeta && item.options && (item.options as ReceiptOptionsSnapshotApi).groups
        ? (item.options as ReceiptOptionsSnapshotApi)
        : null;
    const optionLines = menuOptions?.groups.flatMap((g) =>
      g.options.map((o) => {
        const price = o.price_delta > 0 ? ` +฿${(o.price_delta * o.quantity).toLocaleString()}` : "";
        return `<div class="opt">+ ${o.name}${o.quantity > 1 ? ` ×${o.quantity}` : ""}${price}</div>`;
      }),
    ).join("") ?? "";
    const discountLine = item.discount > 0
      ? `<div class="row disc"><span>${lbl.itemDiscount}</span><span>-฿${item.discount.toLocaleString()}</span></div>`
      : "";
    return `
      <div class="row">
        <span>${name} ×${item.quantity}</span>
        <span>฿${item.line_total.toLocaleString()}</span>
      </div>
      ${optionLines}
      ${discountLine}`;
  }).join("");

  const discountSection = r.discount > 0
    ? `<div class="row small"><span>${lbl.billDiscount}</span><span>-฿${r.discount.toLocaleString()}</span></div>`
    : "";
  const taxSection = r.tax > 0
    ? `<div class="row small"><span>${lbl.tax}</span><span>฿${r.tax.toLocaleString()}</span></div>`
    : "";
  const payerSection = r.payer_label
    ? `<div class="row small"><span>${lbl.payer}</span><span>${r.payer_label}</span></div>`
    : "";
  const voidedSection = r.status !== "active"
    ? `<div class="voided">${lbl.voided}</div>`
    : "";

  const walletBalanceAfter = r.payer_detail?.wallet_balance ?? null;
  const balanceBeforeSection =
    r.payment_method === "wallet" && walletBalanceAfter !== null
      ? `<div class="row small"><span>${lbl.balanceBefore}</span><span>฿${(walletBalanceAfter + r.total).toLocaleString(lbl.locale, { minimumFractionDigits: 2 })}</span></div>`
      : "";
  const balanceAfterSection =
    r.payment_method === "wallet" && walletBalanceAfter !== null
      ? `<div class="row balance-after"><span>${lbl.balanceAfter}</span><span>฿${walletBalanceAfter.toLocaleString(lbl.locale, { minimumFractionDigits: 2 })}</span></div>`
      : "";

  const shopLine = shopName
    ? `<p class="sub" style="font-weight:600;color:#111;">${shopName}</p>`
    : "";
  const logoHtml = school.logoUrl
    ? `<img src="${school.logoUrl}" width="64" height="64" style="object-fit:contain;" />`
    : ISB_LOGO_SVG;
  const addressLine = school.address
    ? `<p class="sub">${school.address}</p>`
    : "";
  const taxPhoneLine = (school.taxId || school.phone)
    ? `<p class="sub">${school.taxId ? `${lbl.taxId}: ${school.taxId}` : ""}${school.taxId && school.phone ? " | " : ""}${school.phone ? `${lbl.tel}: ${school.phone}` : ""}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "th"}">
<head>
<meta charset="UTF-8" />
<title>${isEn ? "Receipt" : "ใบเสร็จ"} ${r.receipt_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', 'Courier New', monospace; font-size: 12px;
         width: 80mm; margin: 0 auto; padding: 8px; color: #111; }
  .logo-wrap { display: flex; justify-content: center; margin-bottom: 4px; }
  h1 { text-align: center; font-size: 15px; margin-bottom: 2px; }
  .center { text-align: center; }
  .sub { font-size: 11px; color: #555; text-align: center; margin-bottom: 3px; }
  hr { border: none; border-top: 1px dashed #888; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .row span:last-child { text-align: right; white-space: nowrap; padding-left: 6px; }
  .opt { padding-left: 12px; font-size: 11px; color: #666; }
  .disc { color: #c00; font-size: 11px; }
  .small { font-size: 11px; color: #555; }
  .total { font-size: 15px; font-weight: bold; margin-top: 4px; }
  .balance-after { font-size: 16px; font-weight: bold; color: #1d4ed8; margin-top: 6px; }
  .voided { text-align: center; color: #c00; font-weight: bold;
             font-size: 13px; margin: 6px 0; border: 1px solid #c00; padding: 3px; }
  @media print { @page { margin: 0; size: 80mm auto; } }
</style>
</head>
<body>
  <div class="logo-wrap">${logoHtml}</div>
  <h1>${school.name}</h1>
  ${addressLine}
  ${taxPhoneLine}
  ${shopLine}
  <p class="sub">${lbl.subtitle}</p>
  ${voidedSection}
  <hr/>
  <div class="row"><span>${lbl.receiptNo}</span><span>${r.receipt_number}</span></div>
  <div class="row small"><span>${lbl.date}</span><span>${dateStr}</span></div>
  ${payerSection}
  <div class="row small"><span>${lbl.payment}</span><span>${paymentLabel}</span></div>
  <hr/>
  ${itemRows}
  <hr/>
  ${balanceBeforeSection}
  <div class="row small"><span>${lbl.subtotal}</span><span>฿${r.subtotal.toLocaleString()}</span></div>
  ${discountSection}
  ${taxSection}
  <div class="row total"><span>${lbl.grandTotal}</span><span>฿${r.total.toLocaleString()}</span></div>
  ${balanceAfterSection}
  <hr/>
  <p class="center sub">${lbl.thanks}</p>
</body>
</html>`;
}

// ── Print trigger ────────────────────────────────────────────────────────────

/**
 * Print a receipt by opening a hidden popup window, writing the receipt HTML,
 * and invoking the browser's print routine.
 *
 * For true "silent" printing (no print dialog), the deployment must launch
 * Chromium with `--kiosk-printing` so the dialog is auto-confirmed against the
 * default printer. Without that flag the standard print dialog appears.
 */
export function printReceipt(
  r: ReceiptApi,
  school: SchoolInfo,
  shopName?: string | null,
  lang: string = "th",
): void {
  const win = window.open("", "_blank", "width=400,height=640");
  if (!win) return;
  win.document.write(buildReceiptHtml(r, school, shopName, lang));
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 300);
}
