import { pgClient } from "@/db/client";
import { pgNumber } from "@/lib/dates";
import { hasRole } from "@/middleware/AuthMiddleware";
import type { UserRole } from "@/enumerate/UserRole";

export interface CashierBreakdownDTO {
    cashier_id: number;
    cashier_name: string;
    total_orders: number;
    total_revenue: number;
}

export interface CloseDaySummaryDTO {
    shop_id: string;
    date: string;
    total_orders: number;
    total_revenue: number;
    item_count: number;
    payment_breakdown: Record<string, number>;
    cashier_breakdown: CashierBreakdownDTO[];
}

/**
 * End-of-day summary for one shop, scoped to "today" in Asia/Bangkok.
 * Mirrors FastAPI app/api/v1/canteen.py:close_day.
 *
 * `caller` gates the per-cashier breakdown: admin/manager see every cashier
 * in the shop, a plain cashier only ever sees their own row (real permission
 * boundary — enforced here, not trusted to the frontend).
 */
export async function closeDay(shopId: string, caller: { id: number; roles: UserRole[] }): Promise<CloseDaySummaryDTO> {
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

    // LEFT JOIN a per-receipt sum of approved returns/exchanges so a partial
    // return is subtracted from the sale it belongs to (dated by the original
    // sale, since we still filter on receipts.transaction_date) — the receipt
    // row itself is never mutated, only netted out at query time.
    const headerRows = await pgClient<Array<{ total_orders: string; total_revenue: string | null }>>`
    SELECT COUNT(*)::text AS total_orders,
           COALESCE(SUM(receipts.total - COALESCE(refunded.refunded, 0)), 0)::text AS total_revenue
    FROM receipts
    LEFT JOIN (
      SELECT receipt_id, SUM(refund_amount) AS refunded
      FROM return_requests
      WHERE status = 'approved'
      GROUP BY receipt_id
    ) refunded ON refunded.receipt_id = receipts.receipt_number
    WHERE receipts.shop_id = ${shopId}
      AND receipts.status = 'ACTIVE'
      AND receipts.transaction_date BETWEEN ${startIso} AND ${endIso}
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
            cashier_breakdown: [],
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
    SELECT receipts.payment_method,
           COALESCE(SUM(receipts.total - COALESCE(refunded.refunded, 0)), 0)::text AS method_total
    FROM receipts
    LEFT JOIN (
      SELECT receipt_id, SUM(refund_amount) AS refunded
      FROM return_requests
      WHERE status = 'approved'
      GROUP BY receipt_id
    ) refunded ON refunded.receipt_id = receipts.receipt_number
    WHERE receipts.shop_id = ${shopId}
      AND receipts.status = 'ACTIVE'
      AND receipts.transaction_date BETWEEN ${startIso} AND ${endIso}
    GROUP BY receipts.payment_method
  `;
    const paymentBreakdown: Record<string, number> = {};
    for (const r of pmRows) {
        paymentBreakdown[r.payment_method] = pgNumber(r.method_total) ?? 0;
    }

    const cashierRows = await pgClient<Array<{
        cashier_id: number;
        cashier_name: string | null;
        total_orders: string;
        total_revenue: string | null;
    }>>`
    SELECT receipts.created_by AS cashier_id,
           COALESCE(users.full_name, users.username) AS cashier_name,
           COUNT(*)::text AS total_orders,
           COALESCE(SUM(receipts.total - COALESCE(refunded.refunded, 0)), 0)::text AS total_revenue
    FROM receipts
    JOIN users ON users.id = receipts.created_by
    LEFT JOIN (
      SELECT receipt_id, SUM(refund_amount) AS refunded
      FROM return_requests
      WHERE status = 'approved'
      GROUP BY receipt_id
    ) refunded ON refunded.receipt_id = receipts.receipt_number
    WHERE receipts.shop_id = ${shopId}
      AND receipts.status = 'ACTIVE'
      AND receipts.transaction_date BETWEEN ${startIso} AND ${endIso}
    GROUP BY receipts.created_by, users.full_name, users.username
    ORDER BY total_revenue DESC
  `;
    let cashierBreakdown: CashierBreakdownDTO[] = cashierRows.map((r) => ({
        cashier_id: r.cashier_id,
        cashier_name: r.cashier_name ?? String(r.cashier_id),
        total_orders: Number(r.total_orders ?? 0),
        total_revenue: pgNumber(r.total_revenue ?? null) ?? 0,
    }));
    // Permission boundary: a plain cashier (no admin/manager role) only ever
    // sees their own row, never anyone else's in the same shop.
    if (!hasRole(caller.roles, "admin", "manager")) {
        cashierBreakdown = cashierBreakdown.filter((row) => row.cashier_id === caller.id);
    }

    return {
        shop_id: shopId,
        date: isoDate,
        total_orders: totalOrders,
        total_revenue: totalRevenue,
        item_count: itemCount,
        payment_breakdown: paymentBreakdown,
        cashier_breakdown: cashierBreakdown,
    };
}
