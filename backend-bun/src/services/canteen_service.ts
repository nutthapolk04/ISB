import { pgClient } from "@/db/client";
import { pgNumber } from "@/lib/dates";

export interface CloseDaySummaryDTO {
    shop_id: string;
    date: string;
    total_orders: number;
    total_revenue: number;
    item_count: number;
    payment_breakdown: Record<string, number>;
}

/**
 * End-of-day summary for one shop, scoped to "today" in Asia/Bangkok.
 * Mirrors FastAPI app/api/v1/canteen.py:close_day.
 */
export async function closeDay(shopId: string): Promise<CloseDaySummaryDTO> {
    // Compute Bangkok-local "today" → its UTC bounds.
    const now = new Date();
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const bkk = new Date(now.getTime() + bkkOffsetMs);
    const yyyy = bkk.getUTCFullYear();
    const mm = String(bkk.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(bkk.getUTCDate()).padStart(2, "0");
    const isoDate = `${yyyy}-${mm}-${dd}`;
    const startUtc = new Date(Date.UTC(yyyy, bkk.getUTCMonth(), bkk.getUTCDate()) - bkkOffsetMs);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

    const startIso = startUtc.toISOString();
    const endIso = endUtc.toISOString();

    const headerRows = await pgClient<Array<{ total_orders: string; total_revenue: string | null }>>`
    SELECT COUNT(*)::text AS total_orders, COALESCE(SUM(total), 0)::text AS total_revenue
    FROM receipts
    WHERE shop_id = ${shopId}
      AND status = 'ACTIVE'
      AND transaction_date BETWEEN ${startIso} AND ${endIso}
  `;
    const totalOrders = Number(headerRows[0]?.total_orders ?? 0);
    if (totalOrders === 0) {
        return {
            shop_id: shopId,
            date: isoDate,
            total_orders: 0,
            total_revenue: 0,
            item_count: 0,
            payment_breakdown: {},
        };
    }
    const totalRevenue = pgNumber(headerRows[0]?.total_revenue ?? null) ?? 0;

    const itemRows = await pgClient<Array<{ item_count: string }>>`
    SELECT COALESCE(SUM(ri.quantity), 0)::text AS item_count
    FROM receipt_items ri
    JOIN receipts r ON r.id = ri.receipt_id
    WHERE r.shop_id = ${shopId}
      AND r.status = 'ACTIVE'
      AND r.transaction_date BETWEEN ${startIso} AND ${endIso}
  `;
    const itemCount = Number(itemRows[0]?.item_count ?? 0);

    const pmRows = await pgClient<Array<{ payment_method: string; method_total: string }>>`
    SELECT payment_method, COALESCE(SUM(total), 0)::text AS method_total
    FROM receipts
    WHERE shop_id = ${shopId}
      AND status = 'ACTIVE'
      AND transaction_date BETWEEN ${startIso} AND ${endIso}
    GROUP BY payment_method
  `;
    const paymentBreakdown: Record<string, number> = {};
    for (const r of pmRows) {
        paymentBreakdown[r.payment_method] = pgNumber(r.method_total) ?? 0;
    }

    return {
        shop_id: shopId,
        date: isoDate,
        total_orders: totalOrders,
        total_revenue: totalRevenue,
        item_count: itemCount,
        payment_breakdown: paymentBreakdown,
    };
}
