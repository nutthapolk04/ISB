import { and, eq, gte, lte, inArray, asc, desc, sql, ilike, or, not, isNotNull } from "drizzle-orm";
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
import { compareDateTime, parseSortOrder } from "@/lib/sort_order";
import { bangkokDateRange } from "@/lib/dates";
import { formatAggregatedPaymentMethodLabel, formatPaymentMethodLabel } from "@/lib/payment_method_labels";
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
    return bangkokDateRange(dateFrom, dateTo);
}

export async function moduleShopIds(module: string): Promise<string[]> {
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
    edc_card_fee: number;
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

    // "Sale leg + void leg" — same convention as salesSummaryReport's
    // buildLegRow (Daily Sales Report), which the ACTIVE/VOIDED grouping this
    // used to do here got wrong. `receipts.status` is a single field that
    // flips ACTIVE→VOIDED in place, so grouping raw receipts by their CURRENT
    // status double-removes a voided receipt's amount: once by omission (it
    // no longer groups into "ACTIVE" since its status isn't ACTIVE anymore),
    // and again via the explicit negative VOIDED row meant to reverse it.
    // The sale leg below counts every receipt's ORIGINAL amount regardless of
    // current status (so a later void never shrinks it), and the void leg is
    // a separate, additional reversal — exactly mirroring how the sale
    // actually happened, so the two legs net to the correct total together.
    const scopeConds: SQL[] = [];
    if (effectiveShopId) {
        scopeConds.push(eq(receipts.shopId, effectiveShopId));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) scopeConds.push(inArray(receipts.shopId, ids));
    }

    const aggregateBy = (dateConds: SQL[], extraConds: SQL[]) => db
        .select({
            payment_method: receipts.paymentMethod,
            receipt_count: sql<string>`COUNT(${receipts.id})`,
            total: sql<string>`SUM(${receipts.total})`,
            edc_card_fee: sql<string>`SUM(COALESCE(${receipts.edcCardFee}, 0))`,
            shop_id: receipts.shopId,
            shop_name: shops.name,
        })
        .from(receipts)
        .innerJoin(shops, eq(shops.id, receipts.shopId))
        .where(and(...scopeConds, ...dateConds, ...extraConds))
        .groupBy(receipts.shopId, shops.name, receipts.paymentMethod)
        .orderBy(sql`MAX(${receipts.transactionDate}) DESC`, asc(shops.name), sql`SUM(${receipts.total}) DESC`);

    // Sale leg: every receipt sold in range, regardless of whether it was
    // later voided — this is the "as it originally happened" amount, dated
    // by when the sale itself happened.
    const saleAgg = await aggregateBy(
        [gte(receipts.transactionDate, start), lte(receipts.transactionDate, end)],
        [],
    );
    // Void leg: only the ones that were in fact voided — the reversal, dated
    // by when the VOID happened (not the original sale). A void from a
    // different day than its sale must land on ITS OWN day's report, same
    // as salesSummaryReport's voidedAtInRange/voidOnlyRows split — otherwise
    // a same-day report for the sale would already show the pair netting to
    // zero while the void's own day shows nothing at all.
    const voidAgg = await aggregateBy(
        [gte(receipts.voidedAt, start), lte(receipts.voidedAt, end)],
        [eq(receipts.status, "VOIDED")],
    );

    let grand = 0;
    let totalRec = 0;
    let retail = 0;
    let dept = 0;
    let deptRec = 0;

    const addTotals = (paymentMethod: string, count: number, signedTotal: number) => {
        grand += signedTotal;
        totalRec += count;
        if (paymentMethod === "DEPARTMENT") {
            dept += signedTotal;
            deptRec += count;
        } else {
            retail += signedTotal;
        }
    };

    const rows: SalesByPaymentRow[] = [];
    for (const r of saleAgg) {
        const total = pgNumber(r.total) ?? 0;
        const count = Number(r.receipt_count) || 0;
        const edcFee = pgNumber(r.edc_card_fee) ?? 0;
        addTotals(r.payment_method, count, total);
        rows.push({
            payment_method: r.payment_method,
            receipt_count: count,
            total,
            edc_card_fee: edcFee,
            shop_id: r.shop_id ?? "",
            shop_name: r.shop_name,
            status: "ACTIVE",
        });
    }
    for (const r of voidAgg) {
        const total = pgNumber(r.total) ?? 0;
        const count = Number(r.receipt_count) || 0;
        const edcFee = pgNumber(r.edc_card_fee) ?? 0;
        // Reversal — negative, and counted toward totals a second time (on
        // top of the sale leg's already-counted original amount) so the two
        // legs net together, same as a real void does to the actual balance.
        addTotals(r.payment_method, 0, -total);
        rows.push({
            payment_method: r.payment_method,
            receipt_count: count,
            total: -total,
            edc_card_fee: -edcFee,
            shop_id: r.shop_id ?? "",
            shop_name: r.shop_name,
            status: "VOIDED",
        });
    }

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

// ── /sales-by-cashier ───────────────────────────────────────────────────────

export interface SalesByCashierRow {
    cashier_id: number;
    cashier_name: string;
    payment_method: string;
    receipt_count: number;
    total: number;
    edc_card_fee: number;
    shop_id: string;
    shop_name: string | null;
    status: string;
}

export interface SalesByCashierReport {
    date_from: string;
    date_to: string;
    shop_id: string | null;
    rows: SalesByCashierRow[];
    grand_total: number;
    total_receipts: number;
    /** True when the caller is cashier-only (not manager/admin/finance) — the
     *  rows above are already filtered to their own sales; the frontend must
     *  not offer a "view other cashiers" breakdown in that case. */
    own_sales_only: boolean;
}

export async function salesByCashierReport(args: {
    user: AccessTokenPayload;
    dateFrom: string;
    dateTo: string;
    shopId?: string;
    module?: string;
}): Promise<SalesByCashierReport> {
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
    const { start, end } = dateRange(args.dateFrom, args.dateTo);

    // Managers/admins/finance see every cashier's sales in the scoped shop(s);
    // a plain cashier only ever sees their own — clamped server-side (not
    // just hidden in the UI), same principle scopeShop() applies to shop_id.
    const isPrivileged = args.user.is_superuser ||
        args.user.roles.includes("admin") ||
        args.user.roles.includes("finance") ||
        args.user.roles.includes("manager");
    const ownSalesOnly = !isPrivileged;

    const cashierUsers = alias(users, "cashier_users_by_cashier");

    // Same sale-leg/void-leg convention as salesByPaymentReport just above —
    // see its comment for why grouping raw receipts by CURRENT status would
    // double-remove a voided receipt's amount.
    const scopeConds: SQL[] = [];
    if (effectiveShopId) {
        scopeConds.push(eq(receipts.shopId, effectiveShopId));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) scopeConds.push(inArray(receipts.shopId, ids));
    }
    if (ownSalesOnly) {
        scopeConds.push(eq(receipts.createdBy, Number(args.user.sub)));
    }

    const aggregateBy = (dateConds: SQL[], extraConds: SQL[]) => db
        .select({
            cashier_id: receipts.createdBy,
            cashier_username: cashierUsers.username,
            cashier_full_name: cashierUsers.fullName,
            payment_method: receipts.paymentMethod,
            receipt_count: sql<string>`COUNT(${receipts.id})`,
            total: sql<string>`SUM(${receipts.total})`,
            edc_card_fee: sql<string>`SUM(COALESCE(${receipts.edcCardFee}, 0))`,
            shop_id: receipts.shopId,
            shop_name: shops.name,
        })
        .from(receipts)
        .innerJoin(shops, eq(shops.id, receipts.shopId))
        .leftJoin(cashierUsers, eq(cashierUsers.id, receipts.createdBy))
        .where(and(...scopeConds, ...dateConds, ...extraConds))
        .groupBy(receipts.createdBy, cashierUsers.username, cashierUsers.fullName, receipts.shopId, shops.name, receipts.paymentMethod)
        .orderBy(asc(cashierUsers.fullName), sql`SUM(${receipts.total}) DESC`);

    const saleAgg = await aggregateBy(
        [gte(receipts.transactionDate, start), lte(receipts.transactionDate, end)],
        [],
    );
    const voidAgg = await aggregateBy(
        [gte(receipts.voidedAt, start), lte(receipts.voidedAt, end)],
        [eq(receipts.status, "VOIDED")],
    );

    let grand = 0;
    let totalRec = 0;

    const rows: SalesByCashierRow[] = [];
    const cashierName = (r: { cashier_id: number; cashier_full_name: string | null; cashier_username: string | null }) =>
        r.cashier_full_name ?? r.cashier_username ?? `User #${r.cashier_id}`;

    for (const r of saleAgg) {
        const total = pgNumber(r.total) ?? 0;
        const count = Number(r.receipt_count) || 0;
        grand += total;
        totalRec += count;
        rows.push({
            cashier_id: r.cashier_id,
            cashier_name: cashierName(r),
            payment_method: r.payment_method,
            receipt_count: count,
            total,
            edc_card_fee: pgNumber(r.edc_card_fee) ?? 0,
            shop_id: r.shop_id ?? "",
            shop_name: r.shop_name,
            status: "ACTIVE",
        });
    }
    // Void leg — reversal, dated by when the VOID happened (not the sale).
    for (const r of voidAgg) {
        const total = pgNumber(r.total) ?? 0;
        const count = Number(r.receipt_count) || 0;
        const edcFee = pgNumber(r.edc_card_fee) ?? 0;
        grand -= total;
        rows.push({
            cashier_id: r.cashier_id,
            cashier_name: cashierName(r),
            payment_method: r.payment_method,
            receipt_count: count,
            total: -total,
            edc_card_fee: -edcFee,
            shop_id: r.shop_id ?? "",
            shop_name: r.shop_name,
            status: "VOIDED",
        });
    }

    return {
        date_from: args.dateFrom,
        date_to: args.dateTo,
        shop_id: effectiveShopId,
        rows,
        grand_total: grand,
        total_receipts: totalRec,
        own_sales_only: ownSalesOnly,
    };
}

// ── /stock ──────────────────────────────────────────────────────────────────

export interface StockRow {
    product_code: string | null;
    product_name: string;
    stock_qty: number;
    shop_id: string;
    shop_name: string | null;
    avg_cost: number;
    selling_price: number;
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
            avg_cost: shopProducts.avgCost,
            selling_price: shopProducts.externalPrice,
        })
        .from(shopProducts)
        .innerJoin(shops, eq(shops.id, shopProducts.shopId))
        .where(and(...conds))
        .orderBy(asc(shopProducts.shopId), asc(shopProducts.productCode));

    return {
        shop_id: effectiveShopId,
        rows: rows.map((r) => ({
            product_code: r.product_code,
            product_name: r.product_name,
            stock_qty: r.stock,
            shop_id: r.shop_id,
            shop_name: r.shop_name,
            avg_cost: parseFloat(r.avg_cost),
            selling_price: parseFloat(r.selling_price),
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
    sortOrder?: string | null;
}): Promise<VoidReport> {
    const sortOrder = parseSortOrder(args.sortOrder);
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
        .orderBy(
            sortOrder === "asc" ? asc(receipts.voidedAt) : desc(receipts.voidedAt),
            sortOrder === "asc" ? asc(receipts.id) : desc(receipts.id),
        );

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
        .sort(([dateA], [dateB]) => (sortOrder === "asc" ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA)))
        .map(([date, dayRows]) => ({
            date,
            rows: [...dayRows].sort((a, b) => compareDateTime(a.voided_at, b.voided_at, sortOrder, a.id, b.id)),
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
    /**
     * When the goods physically arrived, for `receive` rows only — null on
     * every other movement type, which the UI renders as "-".
     *
     * Purely informational: the report still orders, filters and values by
     * `date` (the entry timestamp), so this column cannot move a balance.
     */
    received_date: string | null;
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
    /** Value of this product's stock at the end of the period (the Closing
     *  Balance row's amount). Surfaced so the report-level grand total can add
     *  up inventory value without the caller re-reading the last row. */
    closing_amount_balance: number;
}

/**
 * Report-wide totals, rendered as the single Grand Total line at the very end.
 *
 * Only the additive columns are here. Quantity balance is deliberately absent:
 * summing units across products that have different units of measure produces
 * a number with no meaning. Amount balance IS summable — money is money — and
 * is the useful figure (total inventory value at the end of the period).
 */
export interface StockCardGrandTotalDTO {
    qty_in: number;
    qty_out: number;
    amount_in: number;
    amount_out: number;
    amount_balance: number;
}

export interface StockCardReportDTO {
    shop_id: string | null;
    shop_name: string | null;
    date_from: string;
    date_to: string;
    products: StockCardProductBlockDTO[];
    grand_total: StockCardGrandTotalDTO;
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
            received_date: null,
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
        // balance_file_service.ts's in_unit_cost / out_avg_cost split.
        //
        // Amt In / Amt Out are valued on this same basis. They used to switch
        // to `sale_amount` (the real receipt line_total) for sale legs, added
        // in c451005 for revenue tracking — reverted on request 2026-08-07:
        // this is a stock card, so both amount columns must read as inventory
        // value moving in and out, not as revenue. `sale_amount` is still
        // written to shop_movements and still used by balance_file_service —
        // only this report's interpretation changed, so the two now answer
        // different questions on purpose. Do not "re-align" them.
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
        const amountIn = Math.round(qtyIn * cost * 100) / 100;
        const amountOut = Math.round(qtyOut * cost * 100) / 100;
        const balance = m.stockAfter;
        rows.push({
            date: pgToIso(m.createdAt),
            received_date: m.receivedDate ?? null,
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
        received_date: null,
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
        closing_amount_balance: Math.round(closingQty * closingCost * 100) / 100,
    };
}

/**
 * Add up the per-product totals into the single Grand Total line.
 *
 * Each product's figures are already rounded to satang, so summing them keeps
 * the Grand Total equal to the visible column — rounding the raw sum instead
 * could differ by a satang from what a reader gets adding the rows by hand.
 */
export function sumStockCardGrandTotal(
    products: StockCardProductBlockDTO[],
): StockCardGrandTotalDTO {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
        qty_in: products.reduce((s, p) => s + p.total_qty_in, 0),
        qty_out: products.reduce((s, p) => s + p.total_qty_out, 0),
        amount_in: round2(products.reduce((s, p) => s + p.total_amount_in, 0)),
        amount_out: round2(products.reduce((s, p) => s + p.total_amount_out, 0)),
        amount_balance: round2(products.reduce((s, p) => s + p.closing_amount_balance, 0)),
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
        .orderBy(asc(shopProducts.productCode));

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
        // Computed after filtering so the Grand Total always matches the rows
        // the reader can actually see — a total that includes products the
        // search or include-empty filter removed would never reconcile.
        grand_total: sumStockCardGrandTotal(products),
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

/** Payer identity filters for sales-summary (maps to users.role / customer_kind / department). */
const SALES_SUMMARY_USER_ROLE_TYPES = new Set(["parent", "staff", "finance"]);

function applySalesSummaryCustomerTypeFilter(customerType: string | undefined, conds: SQL[]): void {
    if (!customerType || customerType === "all") return;
    if (customerType === "department") {
        conds.push(isNotNull(receipts.payerDepartmentId));
        return;
    }
    if (SALES_SUMMARY_USER_ROLE_TYPES.has(customerType)) {
        conds.push(eq(users.role, customerType));
        return;
    }
    if (customerType === "student") {
        conds.push(eq(customers.customerKind, "student"));
    }
}

function amountColumnFor(method: string): string {
    if (method === "CASH") return "amt_cash";
    if (method === "WALLET" || method === "CARD_TAP") return "amt_campus_card";
    if (method === "CREDIT_CARD" || method === "DEBIT_CARD" || method === "EDC") return "amt_credit_card";
    if (method === "BANK_TRANSFER" || method === "QR_PROMPTPAY") return "amt_qr_code";
    if (method === "DEPARTMENT") return "amt_department";
    return "amt_other";
}

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

export interface SalesSummaryRow {
    seq: number;
    transaction_date: string;
    receipt_number: string;
    customer_id: string | null;
    customer_name: string | null;
    amt_receive: number;
    amt_change: number;
    amt_billing: number;
    amt_cash: number;
    amt_campus_card: number;
    amt_credit_card: number;
    amt_qr_code: number;
    amt_department: number;
    amt_other: number;
    edc_card_fee: number;
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
    edc_card_fee: number;
}

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
    const edcFee = pgNumber(r.edcCardFee) ?? 0;

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
        edc_card_fee: edcFee * sign,
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
    sortOrder?: string | null;
}): Promise<SalesSummaryReport> {
    const sortOrder = parseSortOrder(args.sortOrder);
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
    // "Customer Type" = payer identity: student (customer wallet), parent/staff/
    // finance (user wallet), or department (budget deduction).
    applySalesSummaryCustomerTypeFilter(args.customerType, commonConds);
    if (args.familyCode) {
        commonConds.push(or(eq(customers.familyCode, args.familyCode), eq(users.familyCode, args.familyCode))!);
    }
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
        const dateA = pgToIso(a.leg === "sale" ? a.entry.receipt.transactionDate : a.entry.receipt.voidedAt!)!;
        const dateB = pgToIso(b.leg === "sale" ? b.entry.receipt.transactionDate : b.entry.receipt.voidedAt!)!;
        const cmp = compareDateTime(dateA, dateB, sortOrder, a.entry.receipt.id, b.entry.receipt.id);
        return cmp;
    });

    const rows: SalesSummaryRow[] = legs.map(({ entry, leg }, idx) => buildLegRow(entry, bundleNamesByReceiptId, leg, idx + 1));

    // Plain sum over every row — a paired sale + void reversal nets to zero
    // on its own, so there's no special status-based exclusion needed here
    // any more (unlike the old single-row-per-receipt model).
    const totals: SalesSummaryTotals = {
        amt_receive: 0, amt_change: 0, amt_billing: 0, amt_cash: 0,
        amt_campus_card: 0, amt_credit_card: 0, amt_qr_code: 0, amt_department: 0, amt_other: 0, edc_card_fee: 0,
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
        totals.edc_card_fee += row.edc_card_fee;
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
    /** Where the sale happened — `receipts.shop_id`, not the product's owning
     *  shop. Present for canteen and store alike, and shown even when the
     *  report is filtered to one shop so a printed copy identifies itself. */
    shop_name: string | null;
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

/** Bucket line-item rows by their receipt, preserving the query's order. */
function groupByReceipt<T extends { receipt: { id: number } }>(entries: T[]): Map<number, T[]> {
    const out = new Map<number, T[]>();
    for (const e of entries) {
        const list = out.get(e.receipt.id);
        if (list) list.push(e);
        else out.set(e.receipt.id, [e]);
    }
    return out;
}

/**
 * Spread a receipt-level amount across its line items.
 *
 * `delta` is `receipts.total - SUM(line_total)`: negative for a bill discount,
 * positive for the EDC card surcharge. Neither belongs to any one line, but the
 * lines still have to add up to what the customer was charged, or the report's
 * own column won't foot to its own total.
 *
 * Works in satang and hands the rounding remainder out largest-fraction-first,
 * so the result sums to `SUM(line_total) + delta` exactly — no satang invented,
 * none lost. Weighting is by |line_total| so a Store refund line (negative
 * quantity) still takes a proportional share instead of an inverted one.
 *
 * Exported for tests: the allocation is pure arithmetic and the rounding is
 * where this would quietly go wrong.
 */
export function allocateReceiptTotalToLines(lineTotals: number[], delta: number): number[] {
    const cents = lineTotals.map((v) => Math.round(v * 100));
    const d = Math.round(delta * 100);
    if (d === 0 || cents.length === 0) return cents.map((c) => c / 100);

    const share = new Array<number>(cents.length).fill(0);
    const weights = cents.map((c) => Math.abs(c));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    if (totalWeight === 0) {
        // A zero-value basket carrying a discount isn't a real sale, but the
        // arithmetic still has to balance rather than silently drop the amount.
        share[0] = d;
    } else {
        const raw = weights.map((w) => (d * w) / totalWeight);
        // Truncate toward zero, then hand out what's left one satang at a time.
        raw.forEach((v, i) => { share[i] = Math.trunc(v); });
        let remainder = d - share.reduce((a, b) => a + b, 0);
        const byFraction = raw
            .map((v, i) => ({ frac: Math.abs(v - Math.trunc(v)), i }))
            .sort((a, b) => b.frac - a.frac);
        const step = remainder > 0 ? 1 : -1;
        for (let k = 0; remainder !== 0; k++) {
            share[byFraction[k % byFraction.length].i] += step;
            remainder -= step;
        }
    }
    return cents.map((c, i) => (c + share[i]) / 100);
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
    sortOrder?: string | null;
    /**
     * Report the same money Daily Sales Report reports, broken out per line
     * item: net amounts (bill discount off, EDC surcharge on), a voided receipt
     * shown as a sale leg plus a reversal leg, and reversals of receipts sold
     * before the window included. Every row counts toward the total, so the
     * column foots to the printed figure AND the figure equals Daily's Amt
     * Billing — the two only hold together as a set.
     *
     * Off by default. Sales by Item Report shares this endpoint and answers a
     * different question ("what did each item ring up at"), so it keeps the raw
     * line amounts and drops voided lines from its total.
     */
    netTotals?: boolean;
}): Promise<SalesByItemReport> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

    // Filters shared by both legs. The date range is deliberately NOT here —
    // the sale leg is dated by when it was sold and the void leg by when it was
    // voided, so each picks its own bound (same split as salesSummaryReport).
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
    if (args.familyCode) {
        commonConds.push(or(eq(customers.familyCode, args.familyCode), eq(users.familyCode, args.familyCode))!);
    }
    if (args.userName) {
        const pat = `%${args.userName}%`;
        commonConds.push(or(ilike(customers.name, pat), ilike(users.fullName, pat))!);
    }

    const saleDateConds: SQL[] = [];
    if (args.dateFrom) saleDateConds.push(gte(receipts.transactionDate, `${args.dateFrom}T00:00:00+07:00`));
    if (args.dateTo) saleDateConds.push(lte(receipts.transactionDate, `${args.dateTo}T23:59:59.999999+07:00`));
    const hasDateFilter = saleDateConds.length > 0;

    const baseQuery = () => db
        .select({
            receipt: receipts,
            item: receiptItems,
            product: shopProducts,
            customer: customers,
            payer: users,
            payerDepartment: departments,
            shop: shops,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
        .leftJoin(shopProducts, eq(shopProducts.id, receiptItems.productVariantId))
        .leftJoin(customers, eq(customers.id, receipts.customerId))
        .leftJoin(users, eq(users.id, receipts.payerUserId))
        .leftJoin(departments, eq(departments.id, receipts.payerDepartmentId))
        // Joined on the RECEIPT's shop, not shopProducts' — the question a sales
        // report answers is where it was sold, which can differ from which shop
        // owns the SKU.
        .leftJoin(shops, eq(shops.id, receipts.shopId));

    const joined = await baseQuery()
        .where(and(...commonConds, ...saleDateConds))
        .orderBy(desc(receipts.transactionDate), desc(receipts.id), desc(receiptItems.id));

    type ItemJoinRow = (typeof joined)[number];

    /** Payer identity, however this receipt was paid for. */
    function payerOf(e: ItemJoinRow): { id: string | null; name: string | null } {
        if (e.customer) return { id: e.customer.customerCode, name: e.customer.name };
        if (e.payer) return { id: e.payer.externalId ?? e.payer.username, name: e.payer.fullName };
        if (e.payerDepartment) return { id: e.payerDepartment.departmentCode, name: e.payerDepartment.departmentName };
        return { id: null, name: null };
    }

    /** Bundle sale lines don't have a product_variant_id pointing at a real
     *  shop_products row (checkout stores the bundle's own name/code in
     *  receipt_items.options instead) — the shopProducts join above misses
     *  them, so resolve the name from options rather than falling back to
     *  "(unknown)". Same pattern as returns_service.ts's receiptToSearchDto. */
    function itemIdentity(e: ItemJoinRow): { no: string | null; name: string; isBundle: boolean } {
        const opts = (e.item.options ?? {}) as Record<string, unknown>;
        const isBundle = Boolean(opts.is_bundle);
        if (isBundle) {
            return {
                no: typeof opts.bundle_code === "string" ? opts.bundle_code : null,
                name: typeof opts.bundle_name === "string" ? opts.bundle_name : "(unknown)",
                isBundle: true,
            };
        }
        return { no: e.product?.productCode ?? null, name: e.product?.name ?? "(unknown)", isBundle: false };
    }

    function buildRow(e: ItemJoinRow, o: { seq: number; date: string; qty: number; amt: number; status: string; remark: string | null }): SalesByItemRow {
        const who = payerOf(e);
        const what = itemIdentity(e);
        return {
            seq: o.seq,
            transaction_date: o.date,
            item_no: what.no,
            item_name: what.name,
            is_bundle: what.isBundle,
            receipt_number: e.receipt.receiptNumber,
            customer_id: who.id,
            customer_name: who.name,
            sales_qty: o.qty,
            sales_amt: o.amt,
            receive_type: formatPaymentMethodLabel(String(e.receipt.paymentMethod), {
                edcCardFee: e.receipt.edcCardFee,
                edcMaskedCard: e.receipt.edcMaskedCard,
            }),
            shop_name: e.shop?.name ?? e.receipt.shopId ?? null,
            remark: o.remark,
            status: o.status,
        };
    }

    const rows: SalesByItemRow[] = [];
    const totals: SalesByItemTotals = { sales_qty: 0, sales_amt: 0 };

    if (!args.netTotals) {
        // Sales by Item Report: one row per line at the price it was rung up,
        // voided lines shown negative and left out of the total. Unchanged.
        joined.forEach((e, idx) => {
            const sign = e.receipt.status === "VOIDED" ? -1 : 1;
            const qty = e.item.quantity;
            const amt = pgNumber(e.item.lineTotal) ?? 0;
            rows.push(buildRow(e, {
                seq: idx + 1,
                date: pgToIso(e.receipt.transactionDate)!,
                qty: qty * sign,
                amt: amt * sign,
                status: e.receipt.status,
                remark: e.receipt.notes ?? null,
            }));
            if (e.receipt.status === "ACTIVE") {
                totals.sales_qty += qty;
                totals.sales_amt += amt;
            }
        });
    } else {
        // Sales Report: the line-level mirror of Daily Sales Report. Three
        // things follow from that and none of them work on their own:
        //
        //  1. amounts are NET — checkout stores
        //     `receipts.total = SUM(line_total) - discount + edc_card_fee`, and
        //     neither the discount nor the surcharge belongs to any single
        //     line, so the difference is spread across the lines. Without this
        //     the printed total can tie to Daily or foot to the rows, never
        //     both.
        //  2. a voided receipt shows BOTH legs — the sale as it happened, then
        //     the reversal dated when it was actually voided — and both count.
        //     They net to zero, which is the same answer as dropping them, but
        //     now the reader can add the column up and land on the total.
        //  3. a receipt sold before the window but voided inside it contributes
        //     its reversal leg only. Daily counts that reversal; leaving it out
        //     here is what left Sales Report ฿72.00 high on 2026-08-10.
        const voidLegOf = (r: typeof receipts.$inferSelect): string | null => {
            if (r.status !== "VOIDED" || !r.voidedAt) return null;
            const iso = pgToIso(r.voidedAt)!;
            if (!hasDateFilter) return iso;
            const t = new Date(iso).getTime();
            if (args.dateFrom && t < new Date(`${args.dateFrom}T00:00:00+07:00`).getTime()) return null;
            if (args.dateTo && t > new Date(`${args.dateTo}T23:59:59.999999+07:00`).getTime()) return null;
            return iso;
        };

        // Receipts voided inside the window whose sale falls outside it. The
        // ones already in `joined` decide their own void leg above, so this
        // only needs the complement.
        let voidOnly: ItemJoinRow[] = [];
        if (hasDateFilter) {
            const voidDateConds: SQL[] = [];
            if (args.dateFrom) voidDateConds.push(gte(receipts.voidedAt, `${args.dateFrom}T00:00:00+07:00`));
            if (args.dateTo) voidDateConds.push(lte(receipts.voidedAt, `${args.dateTo}T23:59:59.999999+07:00`));
            voidOnly = await baseQuery()
                .where(and(
                    ...commonConds,
                    eq(receipts.status, "VOIDED"),
                    ...voidDateConds,
                    not(and(...saleDateConds)!),
                ))
                .orderBy(desc(receipts.voidedAt), desc(receipts.id), desc(receiptItems.id));
        }

        // Net line amounts, per receipt. Grouping first is what keeps the
        // receipt-level figures from being applied once per line.
        const netAmountByItemId = new Map<number, number>();
        for (const group of groupByReceipt([...joined, ...voidOnly]).values()) {
            const grossLines = group.map((e) => pgNumber(e.item.lineTotal) ?? 0);
            const gross = grossLines.reduce((a, b) => a + b, 0);
            const target = pgNumber(group[0].receipt.total) ?? 0;
            const net = allocateReceiptTotalToLines(grossLines, Math.round((target - gross) * 100) / 100);
            group.forEach((e, i) => netAmountByItemId.set(e.item.id, net[i]));
        }

        const push = (e: ItemJoinRow, leg: "sale" | "void") => {
            const sign = leg === "sale" ? 1 : -1;
            rows.push(buildRow(e, {
                seq: rows.length + 1,
                date: pgToIso(leg === "sale" ? e.receipt.transactionDate : e.receipt.voidedAt!)!,
                qty: e.item.quantity * sign,
                amt: (netAmountByItemId.get(e.item.id) ?? 0) * sign,
                status: leg === "sale" ? "ACTIVE" : "VOIDED",
                // The void leg carries the admin's void reason; reusing
                // r.notes there would show the original sale's checkout note.
                remark: leg === "sale" ? (e.receipt.notes ?? null) : (e.receipt.voidedReason ?? null),
            }));
        };

        for (const e of joined) {
            push(e, "sale");
            if (voidLegOf(e.receipt)) push(e, "void");
        }
        for (const e of voidOnly) push(e, "void");

        // Every leg counts. A sale and its reversal cancel out on their own, so
        // there is no status-based exclusion left to make.
        for (const r of rows) {
            totals.sales_qty += r.sales_qty;
            totals.sales_amt += r.sales_amt;
        }
        totals.sales_amt = Math.round(totals.sales_amt * 100) / 100;
    }

    rows.sort((a, b) => compareDateTime(a.transaction_date, b.transaction_date, sortOrder, a.seq, b.seq));
    rows.forEach((r, idx) => { r.seq = idx + 1; });

    return {
        date_from: args.dateFrom ?? null,
        date_to: args.dateTo ?? null,
        shop_id: effectiveShopId,
        rows,
        totals,
        line_count: rows.filter((r) => r.status === "ACTIVE").length,
    };
}

// ── /receive-stock ───────────────────────────────────────────────────────────

export interface ReceiveStockRow {
    seq: number;
    /** Entry timestamp (when the intake was recorded) — always present. */
    date: string;
    /** Real delivery date, receive-specific and optional — "-" on the UI when absent. */
    received_date: string | null;
    product_code: string | null;
    product_name: string;
    shop_id: string;
    shop_name: string | null;
    quantity: number;
    cost_per_unit: number;
    total_cost: number;
    /**
     * Null for rows recorded before po_number/invoice_number existed as their
     * own columns (2026-08-11) — those old rows only ever wrote the legacy
     * combined `reference` field. Falls back to it as the PO value (receiveStock()
     * used to prefer PO over invoice when merging the two), so old rows still
     * show *something* rather than a blank PO with no explanation.
     */
    po_number: string | null;
    invoice_number: string | null;
    note: string | null;
    created_by_name: string | null;
}

export interface ReceiveStockTotals {
    quantity: number;
    total_cost: number;
}

export interface ReceiveStockReport {
    date_from: string | null;
    date_to: string | null;
    shop_id: string | null;
    rows: ReceiveStockRow[];
    totals: ReceiveStockTotals;
    line_count: number;
}

export async function receiveStockReport(args: {
    user: AccessTokenPayload;
    dateFrom?: string | null;
    dateTo?: string | null;
    shopId?: string;
    module?: string;
    productSearch?: string;
    category?: string;
    poNumber?: string;
    invoiceNumber?: string;
    sortOrder?: string | null;
}): Promise<ReceiveStockReport> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
    const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

    const conds: SQL[] = [eq(shopMovements.type, "receive")];
    if (args.dateFrom) conds.push(gte(shopMovements.createdAt, `${args.dateFrom}T00:00:00+07:00`));
    if (args.dateTo) conds.push(lte(shopMovements.createdAt, `${args.dateTo}T23:59:59.999999+07:00`));
    if (effectiveShopId) {
        conds.push(eq(shopMovements.shopId, effectiveShopId));
    } else if (effMod) {
        const ids = await moduleShopIds(effMod);
        if (ids.length > 0) conds.push(inArray(shopMovements.shopId, ids));
    }
    if (args.productSearch) {
        const pat = `%${args.productSearch}%`;
        conds.push(or(ilike(shopMovements.productName, pat), ilike(shopProducts.productCode, pat))!);
    }
    if (args.category) conds.push(eq(shopProducts.category, args.category));
    // Matches against the legacy `reference` column too, so a search for a PO
    // typed before po_number/invoice_number existed still finds that row.
    if (args.poNumber) {
        const pat = `%${args.poNumber}%`;
        conds.push(or(ilike(shopMovements.poNumber, pat), ilike(shopMovements.reference, pat))!);
    }
    if (args.invoiceNumber) {
        const pat = `%${args.invoiceNumber}%`;
        conds.push(or(ilike(shopMovements.invoiceNumber, pat), ilike(shopMovements.reference, pat))!);
    }

    const joined = await db
        .select({
            movement: shopMovements,
            product: shopProducts,
            shop: shops,
            creator: users,
        })
        .from(shopMovements)
        // LEFT — a receive row's product can have since been deleted
        // (productId is SET NULL on delete); productName is denormalized on
        // the movement row itself, so the row still displays fine either way.
        .leftJoin(shopProducts, eq(shopProducts.id, shopMovements.productId))
        .leftJoin(shops, eq(shops.id, shopMovements.shopId))
        .leftJoin(users, eq(users.id, shopMovements.createdBy))
        .where(and(...conds))
        // Fixed fetch order — the user-facing sort_order (default oldest-first)
        // is applied to `rows` below via compareDateTime, same as
        // salesByItemReport(), so the sortable Date/Time column can flip
        // direction without a second query.
        .orderBy(asc(shopMovements.createdAt), asc(shopMovements.id));

    const rows: ReceiveStockRow[] = [];
    const totals: ReceiveStockTotals = { quantity: 0, total_cost: 0 };

    joined.forEach(({ movement: m, product, shop, creator }, idx) => {
        const cost = m.costPerUnit !== null ? pgNumber(m.costPerUnit) ?? 0 : 0;
        const totalCost = Math.round(m.quantity * cost * 100) / 100;
        rows.push({
            seq: idx + 1,
            date: pgToIso(m.createdAt)!,
            received_date: m.receivedDate ?? null,
            product_code: product?.productCode ?? null,
            product_name: m.productName,
            shop_id: m.shopId,
            shop_name: shop?.name ?? null,
            quantity: m.quantity,
            cost_per_unit: cost,
            total_cost: totalCost,
            // Old rows (before po_number/invoice_number existed) only have the
            // legacy combined `reference` — show it as PO, matching the
            // priority receiveStock() used when it wrote that single column.
            po_number: m.poNumber ?? (m.invoiceNumber ? null : m.reference ?? null),
            invoice_number: m.invoiceNumber ?? null,
            note: m.note ?? null,
            created_by_name: creator?.fullName ?? null,
        });
        totals.quantity += m.quantity;
        totals.total_cost += totalCost;
    });
    totals.total_cost = Math.round(totals.total_cost * 100) / 100;

    rows.sort((a, b) => compareDateTime(a.date, b.date, sortOrder, a.seq, b.seq));
    rows.forEach((r, idx) => { r.seq = idx + 1; });

    return {
        date_from: args.dateFrom ?? null,
        date_to: args.dateTo ?? null,
        shop_id: effectiveShopId,
        rows,
        totals,
        line_count: rows.length,
    };
}
