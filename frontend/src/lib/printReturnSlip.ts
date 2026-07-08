import { fmtDateTime } from "@/lib/dateFormat";
import { toast } from "@/components/ui/sonner";
import type { SchoolInfo } from "@/contexts/SchoolInfoContext";
import type { ReturnResult } from "@/pages/returns/returnsTypes";

interface PrintReturnSlipOptions {
    i18nLanguage: string;
    schoolInfo: SchoolInfo;
    /** Shown via toast when the print window fails to open (already localized). */
    popupBlockedMessage: string;
}

/** Opens a print window with a credit-note slip for a completed return/refund. */
export function printReturnSlip(result: ReturnResult, { i18nLanguage, schoolInfo, popupBlockedMessage }: PrintReturnSlipOptions) {
    const isEn = !i18nLanguage.startsWith("th");
    const locale = isEn ? "en-US" : "th-TH";

    const lbl = isEn ? {
        title: "CREDIT NOTE",
        subtitle: "Return / Credit Note",
        origReceipt: "Original Receipt",
        purchaseDate: "Purchase Date",
        payer: "Payer",
        returnDate: "Return Date",
        reason: "Reason",
        item: "Item",
        qty: "Qty",
        unitPrice: "Unit Price",
        total: "Total",
        refundAmount: "Refund Amount",
        refundMethod: "Refund Method",
        balance: "Balance After",
        footer: "*** This document serves as a credit note ***",
        thanks: "Thank you for your purchase",
    } : {
        title: "CREDIT NOTE",
        subtitle: "ใบคืนสินค้า / ใบแจ้งหนี้ลด",
        origReceipt: "ใบเสร็จเดิม",
        purchaseDate: "วันที่ซื้อ",
        payer: "ผู้ซื้อ",
        returnDate: "วันที่คืน",
        reason: "เหตุผล",
        item: "รายการ",
        qty: "จำนวน",
        unitPrice: "ราคา/ชิ้น",
        total: "รวม",
        refundAmount: "ยอดคืนเงิน",
        refundMethod: "ช่องทางคืน",
        balance: "ยอดคงเหลือ",
        footer: "*** เอกสารนี้ใช้แทนใบลดหนี้ ***",
        thanks: "ขอบคุณที่ใช้บริการ",
    };

    const refundMethodLabel = (() => {
        const dest = result.refundedTo;
        if (!dest) return result.refundMethod;
        if (dest.balanceAfter !== undefined) return `Wallet — ${dest.label}`;
        if (dest.type === "edc_card") return `EDC card ${dest.maskedCard || "****"}`;
        return dest.label || result.refundMethod;
    })();

    const itemRows = result.returnedItems
        .map(
            (item) => `
        <tr>
          <td style="padding:2px 0;">${item.productName}<br><span style="font-size:9px;color:#555">${item.productCode}</span></td>
          <td style="text-align:center;padding:2px 4px;">${item.returnQty}</td>
          <td style="text-align:right;padding:2px 0;">฿${item.unitPrice.toLocaleString()}</td>
          <td style="text-align:right;padding:2px 0;">฿${(item.returnQty * item.unitPrice).toLocaleString()}</td>
        </tr>`,
        )
        .join("");

    const logoHtml = schoolInfo.logoUrl
        ? `<img src="${schoolInfo.logoUrl}" width="48" height="48" style="object-fit:contain;display:block;margin:0 auto 4px"/>`
        : "";

    const html = `<!DOCTYPE html>
<html lang="${isEn ? "en" : "th"}">
<head>
  <meta charset="UTF-8"/>
  <title>Credit Note</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 11px; width: 72mm; margin: 0 auto; color: #000; }
    h1 { font-size: 15px; text-align: center; margin: 4px 0 2px; letter-spacing: 2px; }
    h2 { font-size: 11px; text-align: center; margin: 0 0 6px; font-weight: normal; }
    .center { text-align: center; }
    .divider { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 9px; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .total-row td { font-weight: bold; font-size: 13px; padding-top: 4px; }
    .meta { font-size: 9px; color: #333; }
    .footer { text-align: center; font-size: 9px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="center">
    ${logoHtml}
    <div style="font-size:12px;font-weight:bold">${schoolInfo.name || ""}</div>
    ${schoolInfo.address ? `<div style="font-size:9px;color:#555">${schoolInfo.address}</div>` : ""}
    ${schoolInfo.taxId ? `<div style="font-size:9px;color:#555">Tax ID: ${schoolInfo.taxId}</div>` : ""}
    ${schoolInfo.phone ? `<div style="font-size:9px;color:#555">Tel: ${schoolInfo.phone}</div>` : ""}
  </div>
  <h1>${lbl.title}</h1>
  <h2>${lbl.subtitle}</h2>
  <hr class="divider"/>
  <table>
    <tr><td class="meta">${lbl.origReceipt}</td><td style="text-align:right" class="meta">${result.receiptId}</td></tr>
    <tr><td class="meta">${lbl.purchaseDate}</td><td style="text-align:right" class="meta">${result.receiptDate}</td></tr>
    <tr><td class="meta">${lbl.payer}</td><td style="text-align:right" class="meta">${result.payerLabel || "—"}</td></tr>
    <tr><td class="meta">${lbl.returnDate}</td><td style="text-align:right" class="meta">${fmtDateTime(result.returnedAt)}</td></tr>
    <tr><td class="meta">${lbl.reason}</td><td style="text-align:right" class="meta">${result.reason || "—"}</td></tr>
  </table>
  <hr class="divider"/>
  <table>
    <thead>
      <tr>
        <th style="text-align:left">${lbl.item}</th>
        <th style="text-align:center">${lbl.qty}</th>
        <th style="text-align:right">${lbl.unitPrice}</th>
        <th style="text-align:right">${lbl.total}</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>
  <hr class="divider"/>
  <table>
    <tr class="total-row">
      <td>${lbl.refundAmount}</td>
      <td colspan="3" style="text-align:right">฿${result.refundAmount.toFixed(2)}</td>
    </tr>
    <tr>
      <td class="meta">${lbl.refundMethod}</td>
      <td colspan="3" style="text-align:right" class="meta">${refundMethodLabel}</td>
    </tr>
    ${result.refundedTo?.balanceAfter !== undefined ? `<tr><td class="meta">${lbl.balance}</td><td colspan="3" style="text-align:right" class="meta">฿${result.refundedTo.balanceAfter.toFixed(2)}</td></tr>` : ""}
  </table>
  <hr class="divider"/>
  <div class="footer">
    <p>${lbl.footer}</p>
    <p>${lbl.thanks}</p>
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=320,height=600");
    if (!win) {
        toast.error(popupBlockedMessage);
        return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.close();
}
