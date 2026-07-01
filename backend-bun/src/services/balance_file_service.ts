import { pgClient } from "@/db/client";
import * as XLSX from "xlsx";

// ── Types ────────────────────────────────────────────────────────────────

export interface LedgerRow {
    date: string | null;          // "dd/MM/yyyy" พ.ศ.; null for Opening/Summary rows
    description: string;
    doc_no: string | null;
    in_qty: number | null;
    in_unit_cost: number | null;
    in_amount: number | null;
    out_qty: number | null;
    out_avg_cost: number | null;
    out_amount: number | null;
    bal_qty: number;
    bal_avg_cost: number;
    bal_total_value: number;
    note: string | null;
}

export interface BalanceFileBlock {
    product_id: number;
    product_code: string | null;
    product_name: string;
    rows: LedgerRow[];
    summary: {
        in_qty: number;
        in_amount: number;
        out_qty: number;
        out_amount: number;
        final_qty: number;
        final_avg_cost: number;
        final_value: number;
    };
}

export interface BalanceFileReport {
    shop_id: string;
    shop_name: string | null;
    year: number;
    month: number | null;
    blocks: BalanceFileBlock[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface RawMovement {
    id: number;
    date: string;
    type: string;
    quantity: number;
    cost_per_unit: string | null;
    stock_before: number;
    stock_after: number;
    reference: string | null;
    note: string | null;
    created_at: string;
}

interface State {
    qty: number;
    avg: number;
}

function applyMovement(state: State, m: RawMovement): State {
    const cost = m.cost_per_unit !== null ? Number(m.cost_per_unit) : 0;
    if (m.type === "receive") {
        const newQty = state.qty + m.quantity;
        const newAvg = newQty > 0
            ? (state.qty * state.avg + m.quantity * cost) / newQty
            : cost;
        return { qty: newQty, avg: newAvg };
    }
    // sale / internal_use / exchange / adjustment / void — avg unchanged per user rule
    // Use stock_after directly to handle adjustments cleanly.
    return { qty: m.stock_after, avg: state.avg };
}

function formatBE(isoDate: string): string {
    // isoDate is "YYYY-MM-DD"
    const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
    const be = y + 543;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${be}`;
}

function descriptionFor(m: RawMovement, productName: string): string {
    switch (m.type) {
        case "receive": return `รับสินค้า - ${productName}`;
        case "sale": return "ขายนักเรียน";
        case "internal_use": return "ใช้ภายใน";
        case "exchange": return "แลกเปลี่ยน";
        case "adjustment": return m.quantity >= 0 && m.stock_after > m.stock_before ? "ปรับเพิ่ม" : "ปรับลด";
        case "void": return "ยกเลิก";
        default: return m.type;
    }
}

function lastDayOfMonth(year: number, month: number): string {
    // month is 1-12
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const d = new Date(next);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// ── Main calculation ─────────────────────────────────────────────────────

export async function getBalanceFile(
    shopId: string,
    year: number,
    month: number | null,
    productId?: number | null,
): Promise<BalanceFileReport> {
    if (month !== null && (month < 1 || month > 12)) {
        const err = new Error("month must be 1-12");
        (err as { status?: number }).status = 400;
        throw err;
    }

    const monthStart = month !== null
        ? `${year}-${String(month).padStart(2, "0")}-01`
        : `${year}-01-01`;
    const monthEnd = month !== null
        ? lastDayOfMonth(year, month)
        : `${year}-12-31`;

    // Shop info (for header / sheet title)
    const shopRows = await pgClient<Array<{ name: string }>>`
    SELECT name FROM shops WHERE id = ${shopId} LIMIT 1
  `;
    const shopName = shopRows[0]?.name ?? null;

    // Products to include
    const productRows = productId
        ? await pgClient<Array<{ id: number; name: string; product_code: string | null }>>`
        SELECT id, name, product_code FROM shop_products
        WHERE shop_id = ${shopId} AND id = ${productId}
      `
        : await pgClient<Array<{ id: number; name: string; product_code: string | null }>>`
        SELECT id, name, product_code FROM shop_products
        WHERE shop_id = ${shopId} AND is_active = true
        ORDER BY name
      `;

    const blocks: BalanceFileBlock[] = [];

    for (const p of productRows) {
        // 1. Replay history BEFORE monthStart to compute opening qty/avg
        const history = await pgClient<RawMovement[]>`
      SELECT id, date::text AS date, type::text, quantity, cost_per_unit::text AS cost_per_unit,
             stock_before, stock_after, reference, note, created_at::text AS created_at
      FROM shop_movements
      WHERE shop_id = ${shopId} AND product_id = ${p.id} AND date < ${monthStart}::date
      ORDER BY date ASC, created_at ASC, id ASC
    `;
        let state: State = { qty: 0, avg: 0 };
        for (const m of history) state = applyMovement(state, m);
        const opening = { ...state };

        // 2. Iterate movements WITHIN the month
        const monthMoves = await pgClient<RawMovement[]>`
      SELECT id, date::text AS date, type::text, quantity, cost_per_unit::text AS cost_per_unit,
             stock_before, stock_after, reference, note, created_at::text AS created_at
      FROM shop_movements
      WHERE shop_id = ${shopId} AND product_id = ${p.id}
        AND date >= ${monthStart}::date AND date <= ${monthEnd}::date
      ORDER BY date ASC, created_at ASC, id ASC
    `;

        const openingValue = Math.round(opening.qty * opening.avg * 100) / 100;
        const rows: LedgerRow[] = [
            {
                date: null,
                description: "ยอดยกมา",
                doc_no: null,
                in_qty: null, in_unit_cost: null, in_amount: null,
                out_qty: null, out_avg_cost: null, out_amount: null,
                bal_qty: opening.qty,
                bal_avg_cost: opening.avg,
                bal_total_value: openingValue,
                note: "ยอดยกมา",
            },
        ];

        let totals = { in_qty: 0, in_amount: 0, out_qty: 0, out_amount: 0 };

        for (const m of monthMoves) {
            const cost = m.cost_per_unit !== null ? Number(m.cost_per_unit) : 0;
            const before = { ...state };
            state = applyMovement(state, m);

            const balValue = Math.round(state.qty * state.avg * 100) / 100;

            if (m.type === "receive") {
                const inAmount = Math.round(m.quantity * cost * 100) / 100;
                rows.push({
                    date: formatBE(m.date),
                    description: descriptionFor(m, p.name),
                    doc_no: m.reference ?? null,
                    in_qty: m.quantity,
                    in_unit_cost: cost,
                    in_amount: inAmount,
                    out_qty: null, out_avg_cost: null, out_amount: null,
                    bal_qty: state.qty,
                    bal_avg_cost: state.avg,
                    bal_total_value: balValue,
                    note: m.note ?? null,
                });
                totals.in_qty += m.quantity;
                totals.in_amount += inAmount;
            } else if (m.type === "sale" || m.type === "internal_use" || m.type === "exchange") {
                // Out at prevailing avg (state BEFORE was the relevant avg; applyMovement doesn't change avg here)
                const outAvg = before.avg;
                const outAmount = Math.round(m.quantity * outAvg * 100) / 100;
                rows.push({
                    date: formatBE(m.date),
                    description: descriptionFor(m, p.name),
                    doc_no: m.reference ?? null,
                    in_qty: null, in_unit_cost: null, in_amount: null,
                    out_qty: m.quantity,
                    out_avg_cost: outAvg,
                    out_amount: outAmount,
                    bal_qty: state.qty,
                    bal_avg_cost: state.avg,
                    bal_total_value: balValue,
                    note: m.note ?? null,
                });
                totals.out_qty += m.quantity;
                totals.out_amount += outAmount;
            } else if (m.type === "adjustment") {
                const delta = m.stock_after - m.stock_before;
                if (delta >= 0) {
                    rows.push({
                        date: formatBE(m.date),
                        description: descriptionFor(m, p.name),
                        doc_no: m.reference ?? null,
                        in_qty: delta, in_unit_cost: 0, in_amount: 0,
                        out_qty: null, out_avg_cost: null, out_amount: null,
                        bal_qty: state.qty, bal_avg_cost: state.avg, bal_total_value: balValue,
                        note: m.note ?? null,
                    });
                } else {
                    rows.push({
                        date: formatBE(m.date),
                        description: descriptionFor(m, p.name),
                        doc_no: m.reference ?? null,
                        in_qty: null, in_unit_cost: null, in_amount: null,
                        out_qty: -delta, out_avg_cost: before.avg, out_amount: 0,
                        bal_qty: state.qty, bal_avg_cost: state.avg, bal_total_value: balValue,
                        note: m.note ?? null,
                    });
                }
            }
            // void → skip
        }

        const finalValue = Math.round(state.qty * state.avg * 100) / 100;
        rows.push({
            date: null,
            description: "สรุปรวม (Summary)",
            doc_no: null,
            in_qty: totals.in_qty,
            in_unit_cost: null,
            in_amount: Math.round(totals.in_amount * 100) / 100,
            out_qty: totals.out_qty,
            out_avg_cost: null,
            out_amount: Math.round(totals.out_amount * 100) / 100,
            bal_qty: state.qty,
            bal_avg_cost: state.avg,
            bal_total_value: finalValue,
            note: "ยอดคงเหลือสุดท้าย",
        });

        blocks.push({
            product_id: p.id,
            product_code: p.product_code,
            product_name: p.name,
            rows,
            summary: {
                in_qty: totals.in_qty,
                in_amount: Math.round(totals.in_amount * 100) / 100,
                out_qty: totals.out_qty,
                out_amount: Math.round(totals.out_amount * 100) / 100,
                final_qty: state.qty,
                final_avg_cost: state.avg,
                final_value: finalValue,
            },
        });
    }

    return { shop_id: shopId, shop_name: shopName, year, month: month ?? null, blocks };
}

// ── Excel Export ─────────────────────────────────────────────────────────

const DASH = "-";

function cell(v: number | null): number | string {
    return v === null ? DASH : v;
}

export async function exportBalanceFile(
    shopId: string,
    year: number,
    month: number | null,
    productId?: number | null,
): Promise<Buffer> {
    const report = await getBalanceFile(shopId, year, month, productId);
    const wb = XLSX.utils.book_new();
    const periodLabel = month !== null
        ? `${String(month).padStart(2, "0")}/${year + 543}`
        : String(year + 543);

    for (const block of report.blocks) {
        const aoa: (string | number | null)[][] = [
            ["BALANCE FILE - AVERAGE COST METHOD"],
            [`${report.shop_name ?? "Store"} | Period: ${periodLabel}`],
            [`Product: ${block.product_name}${block.product_code ? ` (${block.product_code})` : ""}`],
            [],
            [
                "วันที่\nDate",
                "รายการ\nDescription",
                "เลขที่เอกสาร\nDoc No.",
                "รับเข้า (Stock In)", null, null,
                "จ่ายออก (Stock Out)", null, null,
                "คงเหลือ (Balance)", null, null,
                "หมายเหตุ\nNote",
            ],
            [
                null, null, null,
                "จำนวน\n(Qty)", "ราคา/หน่วย\n(Unit Cost)", "มูลค่า\n(Amount)",
                "จำนวน\n(Qty)", "ราคา Avg\n(Avg Cost)", "มูลค่า\n(Amount)",
                "จำนวน\n(Qty)", "Avg Cost\n(ต่อหน่วย)", "มูลค่ารวม\n(Total Value)",
                null,
            ],
        ];

        for (const r of block.rows) {
            aoa.push([
                r.date ?? r.description,
                r.description,
                r.doc_no ?? DASH,
                cell(r.in_qty), cell(r.in_unit_cost), cell(r.in_amount),
                cell(r.out_qty), cell(r.out_avg_cost), cell(r.out_amount),
                r.bal_qty, r.bal_avg_cost, r.bal_total_value,
                r.note ?? DASH,
            ]);
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);

        // Merge header cells (title rows + group headers)
        ws["!merges"] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },                     // Title
            { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },                     // Subtitle
            { s: { r: 2, c: 0 }, e: { r: 2, c: 12 } },                     // Product
            { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } },                      // Date (2-row vertical)
            { s: { r: 4, c: 1 }, e: { r: 5, c: 1 } },                      // Description
            { s: { r: 4, c: 2 }, e: { r: 5, c: 2 } },                      // Doc No.
            { s: { r: 4, c: 3 }, e: { r: 4, c: 5 } },                      // Stock In group
            { s: { r: 4, c: 6 }, e: { r: 4, c: 8 } },                      // Stock Out group
            { s: { r: 4, c: 9 }, e: { r: 4, c: 11 } },                     // Balance group
            { s: { r: 4, c: 12 }, e: { r: 5, c: 12 } },                    // Note
        ];

        // Column widths
        ws["!cols"] = [
            { wch: 12 }, { wch: 26 }, { wch: 13 },
            { wch: 8 }, { wch: 10 }, { wch: 11 },
            { wch: 8 }, { wch: 10 }, { wch: 11 },
            { wch: 8 }, { wch: 10 }, { wch: 12 },
            { wch: 16 },
        ];

        // Sheet name: product code (or short name), Excel limits to 31 chars, no special chars
        const rawName = block.product_code ?? block.product_name;
        const safeName = rawName.replace(/[\\/?*[\]]/g, "_").slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, safeName || `Product ${block.product_id}`);
    }

    if (report.blocks.length === 0) {
        // Empty workbook fallback
        const ws = XLSX.utils.aoa_to_sheet([["No data for the selected period."]]);
        XLSX.utils.book_append_sheet(wb, ws, "Balance File");
    }

    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
