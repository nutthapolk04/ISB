import { SECTION_KEY, EMPHASIS_KEY, type ReportColumn } from "@/lib/reportExport";
import { fmtDate } from "@/lib/dateFormat";

export interface ReceiveStockRow {
    seq: number;
    date: string;
    received_date: string | null;
    product_code: string | null;
    product_name: string;
    shop_id: string;
    shop_name: string | null;
    quantity: number;
    cost_per_unit: number;
    total_cost: number;
    po_number: string | null;
    invoice_number: string | null;
    note: string | null;
    created_by_name: string | null;
}

export function buildReceiveStockColumns(withShop: boolean): ReportColumn[] {
    return [
        { header: "Seq.", key: "seq", format: "number", align: "right", width: 32 },
        { header: "Date/Time", key: "date", format: "datetime", width: 95 },
        { header: "Invoice No.", key: "invoice_number", width: 65 },
        { header: "Received Date", key: "received_date", width: 70 },
        { header: "Item NO.", key: "product_code", width: 70 },
        { header: "Item Name", key: "product_name", width: 130 },
        ...(withShop ? [{ header: "Shop", key: "shop_name", width: 70 } as ReportColumn] : []),
        { header: "Qty", key: "quantity", format: "number", align: "right", width: 45 },
        { header: "Cost/Unit", key: "cost_per_unit", format: "currency", align: "right", width: 60 },
        { header: "Total Cost", key: "total_cost", format: "currency", align: "right", width: 70 },
        { header: "PO No.", key: "po_number", width: 65 },
        { header: "Note", key: "note", width: 90 },
        { header: "Received By", key: "created_by_name", width: 75 },
    ];
}

/**
 * Group receiving rows by invoice number for export — one section header +
 * body rows + a per-invoice TOTAL row per group, in first-seen invoice order
 * (a Map, not a sort, so two invoices' rows grouping correctly even if they
 * happen to interleave in the source list). Rows with no invoice number are
 * bucketed together under "No Invoice No." rather than dropped or split
 * across "" keys.
 */
export function buildReceiveStockGroupedRows(rows: ReceiveStockRow[]): Record<string, unknown>[] {
    const groups = new Map<string, ReceiveStockRow[]>();
    for (const r of rows) {
        const key = r.invoice_number ?? "";
        const bucket = groups.get(key);
        if (bucket) bucket.push(r);
        else groups.set(key, [r]);
    }

    const out: Record<string, unknown>[] = [];
    for (const [invoiceNo, groupRows] of groups) {
        out.push({
            [SECTION_KEY]: invoiceNo ? `Invoice No.  ${invoiceNo}` : "No Invoice No.",
        });
        let groupQty = 0;
        let groupCostPerUnit = 0;
        let groupCost = 0;
        for (const r of groupRows) {
            groupQty += r.quantity;
            groupCostPerUnit += r.cost_per_unit;
            groupCost += r.total_cost;
            out.push({
                seq: r.seq,
                date: r.date,
                invoice_number: r.invoice_number ?? "",
                // Pre-formatted as text (not format:"date") so the placeholder for
                // rows with no delivery date matches what the web table shows,
                // instead of a date formatter rendering its own dash.
                received_date: r.received_date ? fmtDate(r.received_date) : "-",
                product_code: r.product_code ?? "",
                product_name: r.product_name,
                shop_name: r.shop_name ?? r.shop_id,
                quantity: r.quantity,
                cost_per_unit: r.cost_per_unit,
                total_cost: r.total_cost,
                po_number: r.po_number ?? "",
                note: r.note ?? "",
                created_by_name: r.created_by_name ?? "",
            });
        }
        out.push({
            [EMPHASIS_KEY]: "total" as const,
            product_name: "TOTAL",
            quantity: groupQty,
            cost_per_unit: groupCostPerUnit,
            total_cost: groupCost,
        });
    }
    return out;
}

/** Grand-total sum of the Cost/Unit column across every row, for the report's
 *  footer — mirrors the per-invoice TOTAL row's own Cost/Unit sum. */
export function sumCostPerUnit(rows: ReceiveStockRow[]): number {
    return rows.reduce((sum, r) => sum + r.cost_per_unit, 0);
}
