import { and, eq, gte, lte, inArray, asc, desc, sql, ilike, or, not } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
    receipts,
    receiptItems,
    shops,
    shopProducts,
    shopMovements,
    returnRequests,
    customers,
    users,
    departments,
    productBundles,
    bundleItems,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import { nextCostState } from "@/services/balance_file_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

/**
 * Match the FastAPI helper: admins query any shop, others are clamped to
 * their own shop_id and 403 if they try to query someone else's.
 */
export interface CallerScope {
    is_superuser: boolean;
    role?: string;
    shop_id?: string | null;
    shop_module?: string | null;
}

// finance is a read-only, school-wide reporting role (Wallet/Canteen/Store
// reports across every shop) — it has no shop of its own, so it's scoped
// the same as admin here rather than clamped like manager/cashier.
export function scopeShop(user: AccessTokenPayload, shopId: string | null | undefined): string | null {
    if (user.is_superuser || user.roles.includes("admin") || user.roles.includes("finance")) return shopId ?? null;
    const own = (user as unknown as CallerScope).shop_id ?? null;
    if (shopId && shopId !== own) {
        const err = new Error("Not authorized for that shop");
        (err as { status?: number }).status = 403;
        throw err;
    }
    return own;
}

export function effectiveModule(user: AccessTokenPayload, module: string | null | undefined): string | null {
    if (user.is_superuser || user.roles.includes("admin") || user.roles.includes("finance")) return module ?? null;
    const own = user as unknown as CallerScope;
    if (own.shop_id) return null;
    return own.shop_module ?? module ?? null;
}

/** Asia/Bangkok-anchored ISO bounds for inclusive date filtering. */
export function dateRange(dateFrom: string, dateTo: string): { start: string; end: string } {
    return {
        start: `${dateFrom}T00:00:00+07:00`,
        end: `${dateTo}T23:59:59.999999+07:00`,
    };
}

async function moduleShopIds(module: string): Promise<string[]> {
    const rows = await db
        .select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.module, module), eq(shops.isActive, true)));
    return rows.map((r) => r.id);
}

// ── /sales ──────────────────────────────────────────────────────────────────

export interface SalesRow {
    product_name: string;
    quantity: number;
    total: number;
    shop_id: string;
    shop_name: string | null;
    status: string;
}

export interface SalesReport {
    date_from: string;
    date_to: string;
    shop_id: string | null;
    rows: SalesRow[];
    grand_total: number;
    receipt_count: number;
}

export async function salesReport(args: {
    user: AccessTokenPayload;
    dateFrom: string;
    dateTo: string;
    shopId?: string;
    module?: string;
}): Promise<SalesReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
    const { start, end } = dateRange(args.dateFrom, args.dateTo);

    // No status filter here — voided receipts are included as their own rows
    // (tagged via `status`) so they're visible in the report, but excluded
    // from grand_total/receipt_count below.
    const receiptConds = [
        gte(receipts.transactionDate, start),
        lte(receipts.transactionDate, end),
    ];
    if (effectiveShopId) {
        receiptConds.push(eq(receipts.shopId, effectiveShopId));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) receiptConds.push(inArray(receipts.shopId, ids));
    }

    const receiptIdRows = await db
        .select({ id: receipts.id, status: receipts.status })
        .from(receipts)
        .where(and(...receiptConds));
    const receiptIds = receiptIdRows.map((r) => r.id);
    const activeReceiptCount = receiptIdRows.filter((r) => r.status === "ACTIVE").length;

    let rows: SalesRow[] = [];
    let grandTotal = 0;
    if (receiptIds.length > 0) {
        const agg = await db
            .select({
                name: shopProducts.name,
                qty: sql<string>`SUM(${receiptItems.quantity})`,
                total: sql<string>`SUM(${receiptItems.lineTotal})`,
                shop_id: shopProducts.shopId,
                shop_name: shops.name,
                status: receipts.status,
            })
            .from(receiptItems)
            .innerJoin(shopProducts, eq(shopProducts.id, receiptItems.productVariantId))
            .innerJoin(shops, eq(shops.id, shopProducts.shopId))
            .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
            .where(inArray(receiptItems.receiptId, receiptIds))
            .groupBy(shopProducts.shopId, shops.name, shopProducts.name, receipts.status)
            .orderBy(sql`MAX(${receipts.transactionDate}) DESC`, asc(shops.name), sql`SUM(${receiptItems.lineTotal}) DESC`);
        rows = agg.map((r) => {
            const total = pgNumber(r.total) ?? 0;
            if (r.status === "ACTIVE") grandTotal += total;
            return {
                product_name: r.name,
                quantity: Number(r.qty) || 0,
                total,
                shop_id: r.shop_id,
                shop_name: r.shop_name,
                status: r.status,
            };
        });
    }

    return {
        date_from: args.dateFrom,
        date_to: args.dateTo,
        shop_id: effectiveShopId,
        rows,
        grand_total: grandTotal,
        receipt_count: activeReceiptCount,
    };
}

// ── /sales-by-payment ───────────────────────────────────────────────────────

export interface SalesByPaymentRow {
    payment_method: string;
    receipt_count: number;
    total: number;
    shop_id: string;
    shop_name: string | null;
    status: string;
}

export interface SalesByPaymentReport {
    date_from: string;
    date_to: string;
    shop_id: string | null;
    rows: SalesByPaymentRow[];
    grand_total: number;
    total_receipts: number;
    retail_total: number;
    department_total: number;
    department_receipts: number;
}

export async function salesByPaymentReport(args: {
    user: AccessTokenPayload;
    dateFrom: string;
    dateTo: string;
    shopId?: string;
    module?: string;
}): Promise<SalesByPaymentReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
    const { start, end } = dateRange(args.dateFrom, args.dateTo);

    // No status filter — voided receipts show as their own rows (tagged via
    // `status`) but are excluded from grand/retail/dept totals below.
    const conds = [
        gte(receipts.transactionDate, start),
        lte(receipts.transactionDate, end),
    ];
    if (effectiveShopId) {
        conds.push(eq(receipts.shopId, effectiveShopId));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) conds.push(inArray(receipts.shopId, ids));
    }

    const agg = await db
        .select({
            payment_method: receipts.paymentMethod,
            receipt_count: sql<string>`COUNT(${receipts.id})`,
            total: sql<string>`SUM(${receipts.total})`,
            shop_id: receipts.shopId,
            shop_name: shops.name,
            status: receipts.status,
        })
        .from(receipts)
        .innerJoin(shops, eq(shops.id, receipts.shopId))
        .where(and(...conds))
        .groupBy(receipts.shopId, shops.name, receipts.paymentMethod, receipts.status)
        .orderBy(sql`MAX(${receipts.transactionDate}) DESC`, asc(shops.name), sql`SUM(${receipts.total}) DESC`);

    let grand = 0;
    let totalRec = 0;
    let retail = 0;
    let dept = 0;
    let deptRec = 0;
    const rows: SalesByPaymentRow[] = agg.map((r) => {
        const total = pgNumber(r.total) ?? 0;
        const count = Number(r.receipt_count) || 0;
        if (r.status === "ACTIVE") {
            grand += total;
            totalRec += count;
            if (r.payment_method === "DEPARTMENT") {
                dept += total;
                deptRec += count;
            } else {
                retail += total;
            }
        }
        return {
            payment_method: r.payment_method,
            receipt_count: count,
            // VOIDED rows show as a negative amount (a reversal of the sale) so a
            // per-method subtotal that sums every row nets to the correct total —
            // receipts.total itself is always stored positive regardless of
            // status, so the sign has to be applied here.
            total: r.status === "VOIDED" ? -total : total,
            shop_id: r.shop_id ?? "",
            shop_name: r.shop_name,
            status: r.status,
        };
    });

    return {
        date_from: args.dateFrom,
        date_to: args.dateTo,
        shop_id: effectiveShopId,
        rows,
        grand_total: grand,
        total_receipts: totalRec,
        retail_total: retail,
        department_total: dept,
        department_receipts: deptRec,
    };
}

// ── /stock ──────────────────────────────────────────────────────────────────

export interface StockRow {
    product_code: string | null;
    product_name: string;
    stock_qty: number;
    shop_id: string;
    shop_name: string | null;
}

export interface StockReport {
    shop_id: string | null;
    rows: StockRow[];
}

export async function stockReport(args: {
    user: AccessTokenPayload;
    shopId?: string;
    module?: string;
}): Promise<StockReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

    const conds = [eq(shopProducts.isActive, true)];
    if (effectiveShopId) {
        conds.push(eq(shopProducts.shopId, effectiveShopId));
    } else if (effMod) {
        conds.push(eq(shops.module, effMod));
    }

    const rows = await db
        .select({
            product_code: shopProducts.productCode,
            product_name: shopProducts.name,
            stock: shopProducts.stock,
            shop_id: shopProducts.shopId,
            shop_name: shops.name,
        })
        .from(shopProducts)
        .innerJoin(shops, eq(shops.id, shopProducts.shopId))
        .where(and(...conds))
        .orderBy(desc(shopProducts.updatedAt), asc(shopProducts.shopId), asc(shopProducts.name));

    return {
        shop_id: effectiveShopId,
        rows: rows.map((r) => ({
            product_code: r.product_code,
            product_name: r.product_name,
            stock_qty: r.stock,
            shop_id: r.shop_id,
            shop_name: r.shop_name,
        })),
    };
}

// ── /bundle-report ──────────────────────────────────────────────────────────

export interface BundleReportComponent {
    product_id: number;
    product_code: string;
    product_name: string;
    qty_per_bundle: number;
    stock: number;
}

export interface BundleReportRow {
    bundle_id: number;
    bundle_code: string;
    bundle_name: string;
    shop_id: string;
    shop_name: string | null;
    external_price: number;
    internal_price: number;
    // How many bundles can be assembled right now — the smallest
    // floor(component.stock / qty_per_bundle) across all components.
    sellable_qty: number;
    components: BundleReportComponent[];
}

export interface BundleReport {
    shop_id: string | null;
    rows: BundleReportRow[];
}

export async function bundleReport(args: {
    user: AccessTokenPayload;
    shopId?: string;
    module?: string;
}): Promise<BundleReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

    const conds = [eq(productBundles.isActive, true)];
    if (effectiveShopId) {
        conds.push(eq(productBundles.shopId, effectiveShopId));
    } else if (effMod) {
        conds.push(eq(shops.module, effMod));
    }

    const bundles = await db
        .select({
            id: productBundles.id,
            bundle_code: productBundles.bundleCode,
            name: productBundles.name,
            shop_id: productBundles.shopId,
            shop_name: shops.name,
            external_price: productBundles.externalPrice,
            internal_price: productBundles.internalPrice,
        })
        .from(productBundles)
        .innerJoin(shops, eq(shops.id, productBundles.shopId))
        .where(and(...conds))
        .orderBy(asc(productBundles.shopId), asc(productBundles.sortOrder), asc(productBundles.name));

    const rows: BundleReportRow[] = [];
    for (const b of bundles) {
        const items = await db
            .select({
                product_id: bundleItems.productId,
                quantity: bundleItems.quantity,
                product_code: shopProducts.productCode,
                product_name: shopProducts.name,
                stock: shopProducts.stock,
            })
            .from(bundleItems)
            .innerJoin(shopProducts, eq(shopProducts.id, bundleItems.productId))
            .where(eq(bundleItems.bundleId, b.id))
            .orderBy(asc(bundleItems.sortOrder));

        const sellableQty = items.length > 0
            ? Math.min(...items.map((i) => Math.floor(i.stock / i.quantity)))
            : 0;

        rows.push({
            bundle_id: b.id,
            bundle_code: b.bundle_code,
            bundle_name: b.name,
            shop_id: b.shop_id,
            shop_name: b.shop_name,
            external_price: pgNumber(b.external_price) ?? 0,
            internal_price: pgNumber(b.internal_price) ?? 0,
            sellable_qty: sellableQty,
            components: items.map((i) => ({
                product_id: i.product_id,
                product_code: i.product_code,
                product_name: i.product_name,
                qty_per_bundle: i.quantity,
                stock: i.stock,
            })),
        });
    }

    return { shop_id: effectiveShopId, rows };
}

// ── /returns ────────────────────────────────────────────────────────────────

export interface ReturnRow {
    id: number;
    return_date: string;
    receipt_number: string;
    product_name: string;
    quantity: number;
    refund_amount: number;
    exchange_amount: number;
    status: string;
}

export interface ReturnReport {
    date_from: string;
    date_to: string;
    shop_id: string | null;
    rows: ReturnRow[];
    total_refund: number;
    total_exchange: number;
}

export async function returnsReport(args: {
    user: AccessTokenPayload;
    dateFrom: string;
    dateTo: string;
    shopId?: string;
    module?: string;
}): Promise<ReturnReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
    const { start, end } = dateRange(args.dateFrom, args.dateTo);

    let allowedReceiptNumbers: Set<string> | null = null;
    if (effectiveShopId) {
        const rows = await db
            .select({ rn: receipts.receiptNumber })
            .from(receipts)
            .where(eq(receipts.shopId, effectiveShopId));
        allowedReceiptNumbers = new Set(rows.map((r) => r.rn));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) {
            const rows = await db
                .select({ rn: receipts.receiptNumber })
                .from(receipts)
                .where(inArray(receipts.shopId, ids));
            allowedReceiptNumbers = new Set(rows.map((r) => r.rn));
        } else {
            allowedReceiptNumbers = new Set();
        }
    }

    const rrRows = await db
        .select()
        .from(returnRequests)
        .where(and(gte(returnRequests.createdAt, start), lte(returnRequests.createdAt, end)))
        .orderBy(desc(returnRequests.createdAt));

    const filtered = allowedReceiptNumbers
        ? rrRows.filter((r) => allowedReceiptNumbers!.has(r.receiptId))
        : rrRows;

    let totalRefund = 0;
    let totalExchange = 0;
    const rows: ReturnRow[] = filtered.map((r) => {
        const refund = pgNumber(r.refundAmount) ?? 0;
        const exch = pgNumber(r.exchangeAmount) ?? 0;
        totalRefund += refund;
        totalExchange += exch;
        return {
            id: r.id,
            return_date: pgToIso(r.createdAt)!,
            receipt_number: r.receiptId, // historical mis-naming preserved
            product_name: r.productName,
            quantity: r.returnQuantity,
            refund_amount: refund,
            exchange_amount: exch,
            status: r.status,
        };
    });

    return {
        date_from: args.dateFrom,
        date_to: args.dateTo,
        shop_id: effectiveShopId,
        rows,
        total_refund: totalRefund,
        total_exchange: totalExchange,
    };
}

// ── /voids ──────────────────────────────────────────────────────────────────

export interface VoidRow {
    id: number;
    receipt_number: string;
    voided_at: string;
    total: number;
    voided_by_name: string | null;
    voided_reason: string | null;
}

export interface VoidReportDaily {
    date: string;
    rows: VoidRow[];
    daily_total: number;
}

export interface VoidReport {
    date_from: string;
    date_to: string;
    shop_id: string | null;
    daily: VoidReportDaily[];
    total_voided: number;
}

export async function voidReport(args: {
    user: AccessTokenPayload;
    dateFrom: string;
    dateTo: string;
    shopId?: string;
    module?: string;
}): Promise<VoidReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
    const { start, end } = dateRange(args.dateFrom, args.dateTo);

    let shopFilter = effectiveShopId
        ? eq(receipts.shopId, effectiveShopId)
        : effMod
            ? inArray(receipts.shopId, await moduleShopIds(effMod))
            : undefined;

    const rows = await db
        .select({
            id: receipts.id,
            receipt_number: receipts.receiptNumber,
            voided_at: receipts.voidedAt,
            total: receipts.total,
            voided_by_name: users.fullName,
            voided_reason: receipts.voidedReason,
        })
        .from(receipts)
        .leftJoin(users, eq(receipts.voidedBy, users.id))
        .where(
            and(
                eq(receipts.status, "VOIDED"),
                gte(receipts.voidedAt, start),
                lte(receipts.voidedAt, end),
                shopFilter,
            ),
        )
        .orderBy(desc(receipts.voidedAt));

    let totalVoided = 0;
    const mapped: VoidRow[] = rows.map((r) => {
        // Every row here is a void by definition — shown as a negative amount,
        // same convention as every other report (salesSummaryReport's void leg,
        // salesByPaymentReport, transactionReport, salesByItemReport).
        const total = -(pgNumber(r.total) ?? 0);
        totalVoided += total;
        return {
            id: r.id,
            receipt_number: r.receipt_number,
            voided_at: pgToIso(r.voided_at)!,
            total,
            voided_by_name: r.voided_by_name ?? null,
            voided_reason: r.voided_reason ?? null,
        };
    });

    // Group by date for daily breakdown
    const dailyMap = new Map<string, VoidRow[]>();
    mapped.forEach((row) => {
        const date = row.voided_at.split("T")[0]; // YYYY-MM-DD
        if (!dailyMap.has(date)) {
            dailyMap.set(date, []);
        }
        dailyMap.get(date)!.push(row);
    });

    const daily: VoidReportDaily[] = Array.from(dailyMap.entries())
        .sort(([dateA], [dateB]) => dateB.localeCompare(dateA)) // Newest first
        .map(([date, dayRows]) => ({
            date,
            rows: dayRows,
            daily_total: dayRows.reduce((sum, row) => sum + row.total, 0),
        }));

    return {
        date_from: args.dateFrom,
        date_to: args.dateTo,
        shop_id: effectiveShopId,
        daily,
        total_voided: totalVoided,
    };
}

// ── /stock-card ─────────────────────────────────────────────────────────────

export interface StockCardRowDTO {
    date: string | null;
    description: string;
    invoice_no: string | null;
    qty_in: number;
    qty_out: number;
    qty_balance: number;
    amount_in: number;
    amount_out: number;
    cost_per_unit: number;
    amount_balance: number;
}

export interface StockCardProductBlockDTO {
    product_variant_id: number;
    product_code: string;
    product_name: string;
    rows: StockCardRowDTO[];
    total_qty_in: number;
    total_qty_out: number;
    total_amount_in: number;
    total_amount_out: number;
}

export interface StockCardReportDTO {
    shop_id: string | null;
    shop_name: string | null;
    date_from: string;
    date_to: string;
    products: StockCardProductBlockDTO[];
}

const MOVEMENT_DESCRIPTION: Record<string, string> = {
    receive: "Receive",
    sale: "Sales",
    adjustment: "Adjustment",
    internal_use: "Internal Use",
    void: "Void",
    exchange: "Exchange",
};

async function buildProductBlock(
    product: typeof shopProducts.$inferSelect,
    dateFrom: string,
    dateTo: string,
): Promise<StockCardProductBlockDTO> {
    const startBkk = `${dateFrom}T00:00:00+07:00`;
    const { end } = dateRange(dateFrom, dateTo);

    // Replay the FULL movement history before the period (not just peek at the
    // last row) to get an opening avg cost — same approach as
    // balance_file_service.ts's ledger, sharing its nextCostState formula so
    // the two reports can never quietly disagree again. Neither trusts a
    // single historical row's stored cost_per_unit at face value for a
    // non-receive movement (a sale/internal_use row may never have been
    // backed by a real cost there — see the pos_checkout_service.ts fix that
    // used to store the selling price instead of avg_cost).
    const historyBefore = await db
        .select()
        .from(shopMovements)
        .where(and(eq(shopMovements.productId, product.id), sql`${shopMovements.createdAt} < ${startBkk}`))
        .orderBy(asc(shopMovements.createdAt));

    let state = { qty: 0, avg: 0 };
    for (const m of historyBefore) {
        state = nextCostState(state, {
            type: m.type,
            quantity: m.quantity,
            costPerUnit: m.costPerUnit !== null ? pgNumber(m.costPerUnit) : null,
            stockAfter: m.stockAfter,
        });
    }

    const movements = await db
        .select()
        .from(shopMovements)
        .where(
            and(
                eq(shopMovements.productId, product.id),
                gte(shopMovements.createdAt, startBkk),
                lte(shopMovements.createdAt, end),
            ),
        )
        .orderBy(asc(shopMovements.createdAt));

    // When no movement exists before the period at all (brand new product,
    // first-ever movement lands inside the period), derive opening qty from
    // the first in-period movement's stock_before and fall back to the
    // product's current avg_cost — matches the old behavior for that edge
    // case. Falling back to product.stock was wrong: it used the *current*
    // live stock, not the stock as of the period start.
    const openingQty = historyBefore.length > 0
        ? state.qty
        : (movements.length > 0 ? movements[0].stockBefore : 0);
    const openingCost = historyBefore.length > 0 ? state.avg : (pgNumber(product.avgCost) ?? 0);
    state = { qty: openingQty, avg: openingCost };

    const rows: StockCardRowDTO[] = [
        {
            date: null,
            description: "Beginning Balance",
            invoice_no: null,
            qty_in: 0,
            qty_out: 0,
            qty_balance: openingQty,
            amount_in: 0,
            amount_out: 0,
            cost_per_unit: openingCost,
            amount_balance: Math.round(openingQty * openingCost * 100) / 100,
        },
    ];

    let totalQtyIn = 0;
    let totalQtyOut = 0;
    let totalAmountIn = 0;
    let totalAmountOut = 0;

    for (const m of movements) {
        const typeStr = m.type;
        const receivedCost = m.costPerUnit !== null ? pgNumber(m.costPerUnit) ?? 0 : 0;
        const avgBefore = state.avg;
        state = nextCostState(state, {
            type: typeStr,
            quantity: m.quantity,
            costPerUnit: m.costPerUnit !== null ? pgNumber(m.costPerUnit) : null,
            stockAfter: m.stockAfter,
        });
        // A "receive" row shows what was actually paid for that specific
        // delivery; every other movement type shows the avg cost basis in
        // effect at that moment (the value COGS is valued at) — never the
        // selling price or any other per-row value. Matches
        // balance_file_service.ts's in_unit_cost / out_avg_cost split. This is
        // still the Cost/Unit column's value, deliberately unchanged below —
        // only Amt Out / Amt In switch to real sale revenue when available.
        const cost = typeStr === "receive" ? receivedCost : avgBefore;
        // Bucket by the actual stock change (stock_after - stock_before), not by
        // the sign of `quantity` — `quantity`'s sign convention isn't consistent
        // across movement types (e.g. a 'sale'/'internal_use' row always stores
        // the positive qty sold/issued, which is an outflow, not an inflow; a
        // negative qty there — refund-via-POS or a stock-return requisition —
        // is an inflow). The stock delta is unambiguous regardless of type.
        const delta = m.stockAfter - m.stockBefore;
        const qtyIn = delta > 0 ? delta : 0;
        const qtyOut = delta < 0 ? -delta : 0;
        // sale_amount is the real amount charged/refunded for this row (a
        // receipt line_total, or the original sale's line_total for its void) —
        // null for receive/adjustment and for bundle sub-item rows (no clean
        // per-component allocation), which keep the cost-basis fallback.
        const saleAmt = m.saleAmount !== null ? pgNumber(m.saleAmount) : null;
        const isSaleOut = qtyOut > 0 && (typeStr === "sale" || typeStr === "internal_use" || typeStr === "exchange") && saleAmt !== null;
        const isVoidIn = qtyIn > 0 && typeStr === "void" && saleAmt !== null;
        const amountIn = isVoidIn ? saleAmt! : Math.round(qtyIn * cost * 100) / 100;
        const amountOut = isSaleOut ? saleAmt! : Math.round(qtyOut * cost * 100) / 100;
        const balance = m.stockAfter;
        rows.push({
            date: pgToIso(m.createdAt),
            description: MOVEMENT_DESCRIPTION[typeStr] ?? typeStr,
            invoice_no: m.reference ?? null,
            qty_in: qtyIn,
            qty_out: qtyOut,
            qty_balance: balance,
            amount_in: amountIn,
            amount_out: amountOut,
            cost_per_unit: cost,
            // Running balance is always valued at the CURRENT weighted-average
            // cost (state.avg after this movement) — for a receive row that's the
            // blended average across old + new stock, not just this delivery's
            // own cost, since the remaining balance also includes stock bought at
            // other prices.
            amount_balance: Math.round(balance * state.avg * 100) / 100,
        });
        totalQtyIn += qtyIn;
        totalQtyOut += qtyOut;
        totalAmountIn += amountIn;
        totalAmountOut += amountOut;
    }

    const closingQty = movements.length > 0 ? movements[movements.length - 1].stockAfter : openingQty;
    const closingCost = state.avg;
    rows.push({
        date: null,
        description: "Closing Balance",
        invoice_no: null,
        qty_in: 0,
        qty_out: 0,
        qty_balance: closingQty,
        amount_in: 0,
        amount_out: 0,
        cost_per_unit: closingCost,
        amount_balance: Math.round(closingQty * closingCost * 100) / 100,
    });

    return {
        product_variant_id: product.id,
        product_code: product.productCode ?? "",
        product_name: product.name,
        rows,
        total_qty_in: totalQtyIn,
        total_qty_out: totalQtyOut,
        total_amount_in: Math.round(totalAmountIn * 100) / 100,
        total_amount_out: Math.round(totalAmountOut * 100) / 100,
    };
}

export async function stockCardReport(args: {
    user: AccessTokenPayload;
    dateFrom: string;
    dateTo: string;
    shopId?: string;
    productVariantId?: number;
    productSearch?: string;
    category?: string;
    includeEmpty?: boolean;
}): Promise<StockCardReportDTO> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    if (!effectiveShopId) {
        const err = new Error("shop_id is required for stock card report");
        (err as { status?: number }).status = 400;
        throw err;
    }

    const shopRows = await db
        .select({ id: shops.id, name: shops.name })
        .from(shops)
        .where(eq(shops.id, effectiveShopId))
        .limit(1);
    if (!shopRows[0]) {
        const err = new Error("Shop not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    const productConds = [eq(shopProducts.shopId, effectiveShopId)];
    if (args.productVariantId !== undefined) productConds.push(eq(shopProducts.id, args.productVariantId));
    if (args.productSearch) {
        const like = `%${args.productSearch}%`;
        productConds.push(or(ilike(shopProducts.name, like), ilike(shopProducts.productCode, like))!);
    }
    if (args.category) productConds.push(eq(shopProducts.category, args.category));

    process.stdout.write(`[SC] productSearch=${JSON.stringify(args.productSearch)} conds=${productConds.length}\n`);

    const productsRows = await db
        .select()
        .from(shopProducts)
        .where(and(...productConds))
        .orderBy(asc(shopProducts.category), asc(shopProducts.productCode));

    process.stdout.write(`[SC] db returned ${productsRows.length} rows\n`);

    let products = await Promise.all(productsRows.map((p) => buildProductBlock(p, args.dateFrom, args.dateTo)));
    // In-memory fallback filter (in case DB ILIKE didn't apply)
    if (args.productSearch) {
        const term = args.productSearch.toLowerCase();
        products = products.filter((b) =>
            b.product_code.toLowerCase().includes(term) || b.product_name.toLowerCase().includes(term),
        );
        process.stdout.write(`[SC] after in-memory filter: ${products.length} products (term=${JSON.stringify(term)})\n`);
    }
    if (!args.includeEmpty) {
        products = products.filter((b) => b.rows.length > 2);
    }

    return {
        shop_id: effectiveShopId,
        shop_name: shopRows[0].name,
        date_from: args.dateFrom,
        date_to: args.dateTo,
        products,
    };
}

// ── /sales-summary + /sales-by-item ────────────────────────────────────────

const RECEIVE_TYPE_GROUPS = {
    cash: ["CASH"],
    wallet: ["WALLET", "CARD_TAP"],
    credit: ["CREDIT_CARD", "DEBIT_CARD", "EDC"],
    // BANK_TRANSFER = manually-entered bank transfer; QR_PROMPTPAY = the BAY
    // QR intent flow (pos_qr_service.ts) — both settle as "QR Code" here.
    qr: ["BANK_TRANSFER", "QR_PROMPTPAY"],
    department: ["DEPARTMENT"],
    other: ["OTHER"],
} as const satisfies Record<string, readonly (typeof receipts.$inferSelect.paymentMethod)[]>;

type ReceiveTypeKey = keyof typeof RECEIVE_TYPE_GROUPS;

function amountColumnFor(method: string): string {
    if (method === "CASH") return "amt_cash";
    if (method === "WALLET" || method === "CARD_TAP") return "amt_campus_card";
    if (method === "CREDIT_CARD" || method === "DEBIT_CARD" || method === "EDC") return "amt_credit_card";
    if (method === "BANK_TRANSFER" || method === "QR_PROMPTPAY") return "amt_qr_code";
    if (method === "DEPARTMENT") return "amt_department";
    return "amt_other";
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
    CASH: "Cash",
    WALLET: "Campus Card",
    CARD_TAP: "Campus Card",
    CREDIT_CARD: "Credit Card",
    DEBIT_CARD: "Credit Card",
    EDC: "Credit Card",
    BANK_TRANSFER: "QR Code",
    QR_PROMPTPAY: "QR Code",
    DEPARTMENT: "Department",
    OTHER: "Other",
};

export interface SalesSummaryRow {
    seq: number;
    transaction_date: string;
    receipt_number: string;
    customer_id: string | null;
    customer_name: string | null;
    amt_receive: number;
    amt_change: number;
    /** General bill/revenue amount for this row — always equals
     * amt_receive - amt_change (= receipts.total), regardless of payment
     * method. Not a payment-method bucket. */
    amt_billing: number;
    amt_cash: number;
    amt_campus_card: number;
    amt_credit_card: number;
    amt_qr_code: number;
    amt_department: number;
    amt_other: number;
    remark: string | null;
    shop_id: string;
    shop_name: string | null;
    bundle_names: string | null;
    status: string;
    cashier_id: string | null;
}

export interface SalesSummaryTotals {
    amt_receive: number;
    amt_change: number;
    amt_billing: number;
    amt_cash: number;
    amt_campus_card: number;
    amt_credit_card: number;
    amt_qr_code: number;
    amt_department: number;
    amt_other: number;
}

export interface SalesSummaryReport {
    date_from: string | null;
    date_to: string | null;
    shop_id: string | null;
    rows: SalesSummaryRow[];
    totals: SalesSummaryTotals;
    receipt_count: number;
}

type ReceiptJoinRow = {
    receipt: typeof receipts.$inferSelect;
    customer: typeof customers.$inferSelect | null;
    payer: typeof users.$inferSelect | null;
    payerDepartment: typeof departments.$inferSelect | null;
    shop: typeof shops.$inferSelect | null;
    seller: typeof users.$inferSelect | null;
};

/** Per-receipt amount breakdown shared by both the "sale" and "void
 * reversal" legs below — only the sign and displayed date differ. */
function computeReceiptAmounts(r: typeof receipts.$inferSelect) {
    // billAmount is the actual sale/revenue amount (receipts.total) — this is
    // what gets recognized as revenue regardless of payment method, and is
    // what populates the per-method bucket below.
    const billAmount = pgNumber(r.total) ?? 0;
    // amtReceive is the gross amount the customer physically handed over.
    // For CASH that's the tendered cash (can exceed billAmount — the excess
    // comes back as change); for every other method the customer is charged
    // exactly billAmount, so there's no separate "tendered" concept.
    let amtReceive = billAmount;
    let amtChange = 0;
    if (r.paymentMethod === "CASH" && r.cashReceived !== null) {
        const cashReceived = pgNumber(r.cashReceived) ?? 0;
        amtReceive = cashReceived;
        amtChange = Math.max(cashReceived - billAmount, 0);
    }
    const col = amountColumnFor(r.paymentMethod) as keyof SalesSummaryTotals;
    const buckets: Record<string, number> = {
        amt_cash: 0, amt_campus_card: 0, amt_credit_card: 0, amt_qr_code: 0, amt_department: 0, amt_other: 0,
    };
    buckets[col] = billAmount;
    return { amtReceive, amtChange, billAmount, buckets };
}

/**
 * A voided receipt is shown as TWO rows — its original "sale" leg (dated by
 * when it was sold, always Active — that sale genuinely happened) and a
 * "void" reversal leg (dated by when it was actually voided, all amounts
 * negated) — rather than one row with a flipped sign. Reading the two
 * together nets to zero, and each row's own date/status is honest about
 * what happened and when, instead of one row awkwardly claiming both.
 */
function buildLegRow(entry: ReceiptJoinRow, bundleNamesByReceiptId: Map<number, string[]>, leg: "sale" | "void", seq: number): SalesSummaryRow {
    const { receipt: r, customer, payer, payerDepartment, shop, seller } = entry;
    const { amtReceive, amtChange, billAmount, buckets } = computeReceiptAmounts(r);
    const sign = leg === "sale" ? 1 : -1;

    let custId: string | null = null;
    let custName: string | null = null;
    if (customer) {
        custId = customer.customerCode;
        custName = customer.name;
    } else if (payer) {
        custId = payer.externalId ?? payer.username;
        custName = payer.fullName;
    } else if (payerDepartment) {
        custId = payerDepartment.departmentCode;
        custName = payerDepartment.departmentName;
    }

    const bundleNames = bundleNamesByReceiptId.get(r.id);
    const dateSource = leg === "sale" ? r.transactionDate : r.voidedAt!;

    return {
        seq,
        transaction_date: pgToIso(dateSource)!,
        receipt_number: r.receiptNumber,
        customer_id: custId,
        customer_name: custName,
        amt_receive: amtReceive * sign,
        amt_change: amtChange * sign,
        amt_billing: billAmount * sign,
        amt_cash: buckets.amt_cash * sign,
        amt_campus_card: buckets.amt_campus_card * sign,
        amt_credit_card: buckets.amt_credit_card * sign,
        amt_qr_code: buckets.amt_qr_code * sign,
        amt_department: buckets.amt_department * sign,
        amt_other: buckets.amt_other * sign,
        // The void leg has its own remark (the admin-entered void reason) —
        // reusing r.notes (the ORIGINAL sale's checkout note) here would make
        // the void row show the sale's remark instead of its own.
        remark: leg === "sale" ? (r.notes ?? null) : (r.voidedReason ?? null),
        shop_id: r.shopId ?? "",
        shop_name: shop?.name ?? null,
        bundle_names: bundleNames && bundleNames.length > 0 ? bundleNames.join(", ") : null,
        status: leg === "sale" ? "ACTIVE" : "VOIDED",
        cashier_id: seller?.username ?? null,
    };
}

export async function salesSummaryReport(args: {
    user: AccessTokenPayload;
    dateFrom?: string | null;
    dateTo?: string | null;
    customerType?: string;
    userName?: string;
    familyCode?: string;
    receiptNoFrom?: string;
    receiptNoTo?: string;
    receiveType?: string;
    cashierId?: string;
    shopId?: string;
    module?: string;
}): Promise<SalesSummaryReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
    // Separate alias from `users` (already joined as the wallet `payer` below)
    // since receipts.created_by is the cashier who rang up the sale, not
    // necessarily the person paying for it.
    const cashierUsers = alias(users, "cashier_users");

    // Filters shared by both legs (sale + void reversal) below — the date
    // range itself is intentionally NOT here since each leg is dated
    // differently (sale date vs void date).
    const commonConds: SQL[] = [];
    if (effectiveShopId) {
        commonConds.push(eq(receipts.shopId, effectiveShopId));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) commonConds.push(inArray(receipts.shopId, ids));
    }
    if (args.receiptNoFrom) commonConds.push(gte(receipts.receiptNumber, args.receiptNoFrom));
    if (args.receiptNoTo) commonConds.push(lte(receipts.receiptNumber, args.receiptNoTo));
    if (args.receiveType && args.receiveType !== "all") {
        const methods = RECEIVE_TYPE_GROUPS[args.receiveType as ReceiveTypeKey];
        if (methods) commonConds.push(inArray(receipts.paymentMethod, [...methods]));
    }
    // "Customer Type" here means who the payer IS (parent/student/staff/
    // guest) — unrelated to customer_types.type_name, which is a billing
    // price-level enum (PUBLIC/INTERNAL only) and throws a Postgres enum
    // cast error for any of these values. Parents/staff pay from their own
    // user wallet (receipts.payer_user_id → users.role); students/guests
    // pay from a customer wallet (receipts.customer_id → customers.customer_kind,
    // where "guest" is stored as customer_kind 'other').
    if (args.customerType && args.customerType !== "all") {
        if (args.customerType === "parent" || args.customerType === "staff") {
            commonConds.push(eq(users.role, args.customerType));
        } else {
            commonConds.push(eq(customers.customerKind, args.customerType === "guest" ? "other" : args.customerType));
        }
    }
    if (args.familyCode) commonConds.push(eq(customers.familyCode, args.familyCode));
    if (args.userName) {
        const pat = `%${args.userName}%`;
        commonConds.push(or(ilike(customers.name, pat), ilike(users.fullName, pat))!);
    }
    if (args.cashierId) {
        commonConds.push(ilike(cashierUsers.username, `%${args.cashierId}%`));
    }

    // Use a single query shape with left-joins so optional customer filters
    // work without dropping guest sales when not filtered.
    const baseQuery = () => db
        .select({
            receipt: receipts,
            customer: customers,
            payer: users,
            payerDepartment: departments,
            shop: shops,
            seller: cashierUsers,
        })
        .from(receipts)
        .leftJoin(customers, eq(customers.id, receipts.customerId))
        .leftJoin(users, eq(users.id, receipts.payerUserId))
        .leftJoin(departments, eq(departments.id, receipts.payerDepartmentId))
        .leftJoin(shops, eq(shops.id, receipts.shopId))
        .leftJoin(cashierUsers, eq(cashierUsers.id, receipts.createdBy));

    const saleDateConds: SQL[] = [];
    if (args.dateFrom) saleDateConds.push(gte(receipts.transactionDate, `${args.dateFrom}T00:00:00+07:00`));
    if (args.dateTo) saleDateConds.push(lte(receipts.transactionDate, `${args.dateTo}T23:59:59.999999+07:00`));
    const hasDateFilter = saleDateConds.length > 0;

    // "Sale" leg — every receipt sold within the window, regardless of
    // whether it was later voided (that reversal is its own leg, dated by
    // when the void actually happened — handled per-row below).
    const saleRows = await baseQuery()
        .where(and(...commonConds, ...saleDateConds))
        .orderBy(asc(shops.name), desc(receipts.transactionDate), desc(receipts.id));

    // Void-reversal-only rows: receipts voided WITHIN this window whose sale
    // falls OUTSIDE it (e.g. sold Jul 10, voided Jul 15, report filtered to
    // Jul 12–20 → shows only the reversal). Receipts already in `saleRows`
    // decide their own possible void leg per-row below, so this only needs
    // the complement (sale date NOT in range).
    let voidOnlyRows: typeof saleRows = [];
    if (hasDateFilter) {
        const voidDateConds: SQL[] = [];
        if (args.dateFrom) voidDateConds.push(gte(receipts.voidedAt, `${args.dateFrom}T00:00:00+07:00`));
        if (args.dateTo) voidDateConds.push(lte(receipts.voidedAt, `${args.dateTo}T23:59:59.999999+07:00`));
        voidOnlyRows = await baseQuery()
            .where(and(
                ...commonConds,
                eq(receipts.status, "VOIDED"),
                ...voidDateConds,
                not(and(...saleDateConds)!),
            ))
            .orderBy(asc(shops.name), desc(receipts.voidedAt), desc(receipts.id));
    }

    // Bundle sale lines don't have their own row in this receipt-level report,
    // so collect the bundle name(s) per receipt from receiptItems.options
    // (same is_bundle/bundle_name shape used by salesByItemReport) to surface
    // as a "Bundle" column instead of leaving bundle sales invisible here.
    const allEntries = [...saleRows, ...voidOnlyRows];
    const receiptIds = allEntries.map(({ receipt: r }) => r.id);
    const bundleNamesByReceiptId = new Map<number, string[]>();
    if (receiptIds.length > 0) {
        const bundleItemRows = await db
            .select({ receiptId: receiptItems.receiptId, options: receiptItems.options })
            .from(receiptItems)
            .where(inArray(receiptItems.receiptId, receiptIds));
        for (const item of bundleItemRows) {
            const opts = (item.options ?? {}) as Record<string, unknown>;
            if (!opts.is_bundle) continue;
            const bundleName = typeof opts.bundle_name === "string" ? opts.bundle_name : null;
            if (!bundleName) continue;
            const list = bundleNamesByReceiptId.get(item.receiptId) ?? [];
            list.push(bundleName);
            bundleNamesByReceiptId.set(item.receiptId, list);
        }
    }

    function voidedAtInRange(r: typeof receipts.$inferSelect): boolean {
        if (!r.voidedAt) return false;
        if (!hasDateFilter) return true;
        const t = new Date(pgToIso(r.voidedAt)!).getTime();
        if (args.dateFrom && t < new Date(`${args.dateFrom}T00:00:00+07:00`).getTime()) return false;
        if (args.dateTo && t > new Date(`${args.dateTo}T23:59:59.999999+07:00`).getTime()) return false;
        return true;
    }

    const legs: Array<{ entry: ReceiptJoinRow; leg: "sale" | "void" }> = [];
    for (const entry of saleRows) {
        legs.push({ entry, leg: "sale" });
        if (entry.receipt.status === "VOIDED" && voidedAtInRange(entry.receipt)) {
            legs.push({ entry, leg: "void" });
        }
    }
    for (const entry of voidOnlyRows) {
        legs.push({ entry, leg: "void" });
    }

    // Re-sort the combined legs by each leg's OWN effective date (sale legs by
    // sale time, void legs by void time) so a same-day reversal still lands
    // right after its sale, but a reversal from a different day sorts on its
    // own — matches the "show it as it truly happened" ordering.
    legs.sort((a, b) => {
        const shopCmp = (a.entry.shop?.name ?? "").localeCompare(b.entry.shop?.name ?? "");
        if (shopCmp !== 0) return shopCmp;
        const dateA = new Date(pgToIso(a.leg === "sale" ? a.entry.receipt.transactionDate : a.entry.receipt.voidedAt!)!).getTime();
        const dateB = new Date(pgToIso(b.leg === "sale" ? b.entry.receipt.transactionDate : b.entry.receipt.voidedAt!)!).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return b.entry.receipt.id - a.entry.receipt.id;
    });

    const rows: SalesSummaryRow[] = legs.map(({ entry, leg }, idx) => buildLegRow(entry, bundleNamesByReceiptId, leg, idx + 1));

    // Plain sum over every row — a paired sale + void reversal nets to zero
    // on its own, so there's no special status-based exclusion needed here
    // any more (unlike the old single-row-per-receipt model).
    const totals: SalesSummaryTotals = {
        amt_receive: 0, amt_change: 0, amt_billing: 0, amt_cash: 0,
        amt_campus_card: 0, amt_credit_card: 0, amt_qr_code: 0, amt_department: 0, amt_other: 0,
    };
    for (const row of rows) {
        totals.amt_receive += row.amt_receive;
        totals.amt_change += row.amt_change;
        totals.amt_billing += row.amt_billing;
        totals.amt_cash += row.amt_cash;
        totals.amt_campus_card += row.amt_campus_card;
        totals.amt_credit_card += row.amt_credit_card;
        totals.amt_qr_code += row.amt_qr_code;
        totals.amt_department += row.amt_department;
        totals.amt_other += row.amt_other;
    }

    // Count distinct receipts, not rows — a voided receipt showing both legs
    // still counts once.
    const distinctReceiptIds = new Set(legs.map(({ entry }) => entry.receipt.id));

    return {
        date_from: args.dateFrom ?? null,
        date_to: args.dateTo ?? null,
        shop_id: effectiveShopId,
        rows,
        totals,
        receipt_count: distinctReceiptIds.size,
    };
}

export interface SalesByItemRow {
    seq: number;
    transaction_date: string;
    item_no: string | null;
    item_name: string;
    is_bundle: boolean;
    receipt_number: string;
    customer_id: string | null;
    customer_name: string | null;
    sales_qty: number;
    sales_amt: number;
    receive_type: string;
    remark: string | null;
    status: string;
}

export interface SalesByItemTotals {
    sales_qty: number;
    sales_amt: number;
}

export interface SalesByItemReport {
    date_from: string | null;
    date_to: string | null;
    shop_id: string | null;
    rows: SalesByItemRow[];
    totals: SalesByItemTotals;
    line_count: number;
}

export async function salesByItemReport(args: {
    user: AccessTokenPayload;
    dateFrom?: string | null;
    dateTo?: string | null;
    customerType?: string;
    userName?: string;
    familyCode?: string;
    receiptNoFrom?: string;
    receiptNoTo?: string;
    receiveType?: string;
    shopId?: string;
    module?: string;
}): Promise<SalesByItemReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

    // No status filter — voided receipts are included as their own rows
    // (tagged via `status`) and excluded from totals below.
    const conds: SQL[] = [];
    if (args.dateFrom) conds.push(gte(receipts.transactionDate, `${args.dateFrom}T00:00:00+07:00`));
    if (args.dateTo) conds.push(lte(receipts.transactionDate, `${args.dateTo}T23:59:59.999999+07:00`));
    if (effectiveShopId) {
        conds.push(eq(receipts.shopId, effectiveShopId));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) conds.push(inArray(receipts.shopId, ids));
    }
    if (args.receiptNoFrom) conds.push(gte(receipts.receiptNumber, args.receiptNoFrom));
    if (args.receiptNoTo) conds.push(lte(receipts.receiptNumber, args.receiptNoTo));
    if (args.receiveType && args.receiveType !== "all") {
        const methods = RECEIVE_TYPE_GROUPS[args.receiveType as ReceiveTypeKey];
        if (methods) conds.push(inArray(receipts.paymentMethod, [...methods]));
    }
    if (args.familyCode) conds.push(eq(customers.familyCode, args.familyCode));
    if (args.userName) {
        const pat = `%${args.userName}%`;
        conds.push(or(ilike(customers.name, pat), ilike(users.fullName, pat))!);
    }

    const joined = await db
        .select({
            receipt: receipts,
            item: receiptItems,
            product: shopProducts,
            customer: customers,
            payer: users,
            payerDepartment: departments,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
        .leftJoin(shopProducts, eq(shopProducts.id, receiptItems.productVariantId))
        .leftJoin(customers, eq(customers.id, receipts.customerId))
        .leftJoin(users, eq(users.id, receipts.payerUserId))
        .leftJoin(departments, eq(departments.id, receipts.payerDepartmentId))
        .where(and(...conds))
        .orderBy(desc(receipts.transactionDate), desc(receipts.id), desc(receiptItems.id));

    const rows: SalesByItemRow[] = [];
    const totals: SalesByItemTotals = { sales_qty: 0, sales_amt: 0 };

    joined.forEach(({ receipt: r, item, product, customer, payer, payerDepartment }, idx) => {
        const qty = item.quantity;
        const amt = pgNumber(item.lineTotal) ?? 0;
        let custId: string | null = null;
        let custName: string | null = null;
        if (customer) {
            custId = customer.customerCode;
            custName = customer.name;
        } else if (payer) {
            custId = payer.externalId ?? payer.username;
            custName = payer.fullName;
        } else if (payerDepartment) {
            custId = payerDepartment.departmentCode;
            custName = payerDepartment.departmentName;
        }
        // Bundle sale lines don't have a product_variant_id pointing at a real
        // shop_products row (checkout stores the bundle's own name/code in
        // receipt_items.options instead) — the shopProducts join above misses
        // them, so resolve the name from options rather than falling back to
        // "(unknown)". Same pattern as returns_service.ts's receiptToSearchDto.
        const opts = (item.options ?? {}) as Record<string, unknown>;
        const isBundle = Boolean(opts.is_bundle);
        const bundleCode = isBundle && typeof opts.bundle_code === "string" ? opts.bundle_code : null;
        const bundleName = isBundle && typeof opts.bundle_name === "string" ? opts.bundle_name : null;

        // A voided line shows as a negative qty/amount — same convention as
        // salesSummaryReport()'s void leg and salesByPaymentReport().
        const sign = r.status === "VOIDED" ? -1 : 1;

        rows.push({
            seq: idx + 1,
            transaction_date: pgToIso(r.transactionDate)!,
            item_no: isBundle ? bundleCode : (product?.productCode ?? null),
            item_name: isBundle ? (bundleName ?? "(unknown)") : (product?.name ?? "(unknown)"),
            is_bundle: isBundle,
            receipt_number: r.receiptNumber,
            customer_id: custId,
            customer_name: custName,
            sales_qty: qty * sign,
            sales_amt: amt * sign,
            receive_type: PAYMENT_METHOD_LABEL[r.paymentMethod] ?? "Other",
            remark: r.notes ?? null,
            status: r.status,
        });
        if (r.status === "ACTIVE") {
            totals.sales_qty += qty;
            totals.sales_amt += amt;
        }
    });

    return {
        date_from: args.dateFrom ?? null,
        date_to: args.dateTo ?? null,
        shop_id: effectiveShopId,
        rows,
        totals,
        line_count: rows.filter((r) => r.status === "ACTIVE").length,
    };
}
