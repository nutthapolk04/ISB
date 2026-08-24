/**
 * POS checkout transaction log — one row per attempt, from the moment a
 * payment method is picked and confirmed through to its final status.
 *
 * Distinct from `receipts` (completed sales only) and the per-method
 * telemetry tables (`edc_txn_events`, `payment_intents`) — this is the single
 * place that shows every attempt across every payment method with a live
 * status, including a QR sale still waiting on BAY's webhook (invisible
 * everywhere else until it resolves one way or the other).
 *
 * Every write here is best-effort: a failure to log must never break a real
 * sale, so every exported writer swallows its own errors after logging them.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { posCheckoutTransactions, receipts, shopProducts, productBundles, shops, users, customers, departments } from "@/db/schema";
import { pgNumber, pgToIso, bangkokDateRange } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { userCanAccessShop } from "@/services/pos_service";
import { logger } from "@/logger";

/** Loose on purpose — kept independent of CheckoutItemInput so this module
 *  never has to import pos_checkout_service (which imports this module). */
export interface TransactionCartItemInput {
    product_variant_id: number;
    quantity: number;
    unit_price: number;
    is_bundle?: boolean;
    bundle_id?: number | null;
}

export interface StartTransactionInput {
    refCode?: string | null;
    transactionMode?: string | null;
    paymentMethod: string;
    shopId?: string | null;
    cashierUserId: number;
    payerKind?: string | null;
    payerId?: number | null;
    itemsCount: number;
    /** Best-effort pre-checkout estimate — overwritten with the exact
     *  receipt total once the sale actually resolves. */
    amount: number | null;
    /** Raw cart as submitted at attempt-start — the only place items are
     *  visible for attempts that never became a receipt. */
    items?: TransactionCartItemInput[] | null;
}

/**
 * Insert a `pending` row and return its id. Never throws — a failure to
 * start the log must never stop a real checkout from proceeding.
 */
export async function startTransaction(input: StartTransactionInput): Promise<number | null> {
    try {
        const [row] = await db
            .insert(posCheckoutTransactions)
            .values({
                refCode: input.refCode ?? null,
                status: "pending",
                transactionMode: input.transactionMode ?? null,
                paymentMethod: input.paymentMethod.toLowerCase(),
                shopId: input.shopId ?? null,
                cashierUserId: input.cashierUserId,
                payerKind: input.payerKind ?? null,
                payerId: input.payerId ?? null,
                itemsCount: input.itemsCount,
                amount: input.amount == null ? null : String(input.amount),
                cartSnapshot: input.items ?? null,
            })
            .returning({ id: posCheckoutTransactions.id });
        return row.id;
    } catch (err) {
        logger.error("[pos_transaction] startTransaction failed", err);
        return null;
    }
}

/**
 * Log a `pending` row the moment EDC is picked as the payment method —
 * before the terminal has replied at all. Mirrors the POS QR intent (pending
 * row created at intent-time, not at confirm-time): an EDC attempt that never
 * gets an approval code back (terminal unreachable, cashier gives up) still
 * shows up in the Transactions tab instead of leaving no trace. That's what
 * happened on 2026-08-10 — edc_txn_events recorded the bridge's "Failed to
 * fetch", but nothing appeared in the Transactions tab because checkout() was
 * never reached. `refCode` is client-supplied (derived from the same
 * idempotency key the EDC telemetry log already keys its own `pos_ref` on —
 * see posRefFromIdempotencyKey on the frontend) so this row and its
 * edc_txn_events counterpart are trivially cross-referenceable. Never throws
 * — same contract as startTransaction.
 */
export async function startEdcAttempt(
    input: Omit<StartTransactionInput, "paymentMethod"> & { refCode: string },
): Promise<{ refCode: string | null }> {
    const id = await startTransaction({ ...input, paymentMethod: "edc" });
    return { refCode: id != null ? input.refCode : null };
}

export async function markTransactionSuccess(id: number | null, receiptId: number, amount?: number): Promise<void> {
    if (id == null) return;
    try {
        await db
            .update(posCheckoutTransactions)
            .set({
                status: "success",
                receiptId,
                resolvedAt: new Date().toISOString(),
                ...(amount !== undefined ? { amount: String(amount) } : {}),
            })
            .where(eq(posCheckoutTransactions.id, id));
    } catch (err) {
        logger.error("[pos_transaction] markTransactionSuccess failed", { id, receiptId, err });
    }
}

export async function markTransactionFailed(id: number | null, message: string): Promise<void> {
    if (id == null) return;
    try {
        await db
            .update(posCheckoutTransactions)
            .set({
                status: "failed",
                errorMessage: message.slice(0, 2000),
                resolvedAt: new Date().toISOString(),
            })
            .where(eq(posCheckoutTransactions.id, id));
    } catch (err) {
        logger.error("[pos_transaction] markTransactionFailed failed", { id, err });
    }
}

export async function markTransactionCancelledByRefCode(refCode: string): Promise<void> {
    try {
        await db
            .update(posCheckoutTransactions)
            .set({ status: "cancelled", resolvedAt: new Date().toISOString() })
            .where(and(eq(posCheckoutTransactions.refCode, refCode), eq(posCheckoutTransactions.status, "pending")));
    } catch (err) {
        logger.error("[pos_transaction] markTransactionCancelledByRefCode failed", { refCode, err });
    }
}

export interface TransactionItemDTO {
    product_variant_id: number | null;
    quantity: number;
    unit_price: number | null;
    is_bundle: boolean;
    bundle_id: number | null;
    name: string;
}

export interface TransactionDetailDTO extends TransactionDTO {
    items: TransactionItemDTO[];
}

/**
 * Single-transaction fetch for the Transactions-tab detail dialog — resolves
 * `cart_snapshot` into display-ready item rows (product/bundle name looked up
 * at read time, not write time, so it never slows down a real checkout).
 * Names fall back to "Product #<id>" / "Bundle #<id>" when the id doesn't
 * resolve — e.g. a failed attempt that referenced a bad id in the first
 * place, which is exactly the kind of thing this view exists to show.
 */
export async function getTransactionDetail(
    id: number,
    caller: AccessTokenPayload & { shop_id?: string | null },
): Promise<TransactionDetailDTO> {
    const rows = await db
        .select({
            id: posCheckoutTransactions.id,
            refCode: posCheckoutTransactions.refCode,
            status: posCheckoutTransactions.status,
            transactionMode: posCheckoutTransactions.transactionMode,
            paymentMethod: posCheckoutTransactions.paymentMethod,
            shopId: posCheckoutTransactions.shopId,
            shopName: shops.name,
            cashierUserId: posCheckoutTransactions.cashierUserId,
            cashierName: users.fullName,
            payerKind: posCheckoutTransactions.payerKind,
            payerId: posCheckoutTransactions.payerId,
            itemsCount: posCheckoutTransactions.itemsCount,
            amount: posCheckoutTransactions.amount,
            cartSnapshot: posCheckoutTransactions.cartSnapshot,
            receiptId: posCheckoutTransactions.receiptId,
            receiptNumber: receipts.receiptNumber,
            errorMessage: posCheckoutTransactions.errorMessage,
            createdAt: posCheckoutTransactions.createdAt,
            resolvedAt: posCheckoutTransactions.resolvedAt,
        })
        .from(posCheckoutTransactions)
        .leftJoin(shops, eq(shops.id, posCheckoutTransactions.shopId))
        .leftJoin(users, eq(users.id, posCheckoutTransactions.cashierUserId))
        .leftJoin(receipts, eq(receipts.id, posCheckoutTransactions.receiptId))
        .where(eq(posCheckoutTransactions.id, id))
        .limit(1);

    const row = rows[0];
    if (!row) {
        const err = new Error(`Transaction id=${id} not found`);
        (err as { status?: number }).status = 404;
        throw err;
    }
    if (row.shopId && !userCanAccessShop(caller, row.shopId)) {
        const err = new Error(`Not authorized to view transactions of shop '${row.shopId}'`);
        (err as { status?: number }).status = 403;
        throw err;
    }

    const cart = Array.isArray(row.cartSnapshot) ? (row.cartSnapshot as TransactionCartItemInput[]) : [];
    const productIds = [...new Set(cart.filter((i) => !i.is_bundle).map((i) => i.product_variant_id))];
    const bundleIds = [...new Set(cart.filter((i) => i.is_bundle && i.bundle_id).map((i) => i.bundle_id as number))];

    const [productRows, bundleRows] = await Promise.all([
        productIds.length > 0
            ? db.select({ id: shopProducts.id, name: shopProducts.name }).from(shopProducts).where(inArray(shopProducts.id, productIds))
            : Promise.resolve([]),
        bundleIds.length > 0
            ? db.select({ id: productBundles.id, name: productBundles.name }).from(productBundles).where(inArray(productBundles.id, bundleIds))
            : Promise.resolve([]),
    ]);
    const productNameById = new Map(productRows.map((p) => [p.id, p.name]));
    const bundleNameById = new Map(bundleRows.map((b) => [b.id, b.name]));

    const items: TransactionItemDTO[] = cart.map((item) => {
        const isBundle = item.is_bundle === true;
        const name = isBundle
            ? (item.bundle_id != null ? bundleNameById.get(item.bundle_id) : undefined) ?? `Bundle #${item.bundle_id ?? "?"}`
            : productNameById.get(item.product_variant_id) ?? `Product #${item.product_variant_id}`;
        return {
            product_variant_id: item.product_variant_id ?? null,
            quantity: item.quantity,
            unit_price: item.unit_price ?? null,
            is_bundle: isBundle,
            bundle_id: item.bundle_id ?? null,
            name,
        };
    });

    // Resolve payer label and code
    let payer_label: string | null = null;
    let payer_code: string | null = null;
    if (row.payerKind === "customer" && row.payerId) {
        const cust = await db.select({ name: customers.name, studentCode: customers.studentCode, customerCode: customers.customerCode, externalId: customers.externalId }).from(customers).where(eq(customers.id, row.payerId)).limit(1);
        payer_label = cust[0]?.name ?? null;
        payer_code = cust[0] ? (cust[0].studentCode ?? cust[0].customerCode ?? cust[0].externalId ?? null) : null;
    } else if (row.payerKind === "user" && row.payerId) {
        const usr = await db.select({ fullName: users.fullName, username: users.username, externalId: users.externalId }).from(users).where(eq(users.id, row.payerId)).limit(1);
        payer_label = usr[0]?.fullName ?? null;
        payer_code = usr[0] ? (usr[0].externalId ?? usr[0].username ?? null) : null;
    } else if (row.payerKind === "department" && row.payerId) {
        const dept = await db.select({ departmentName: departments.departmentName, departmentCode: departments.departmentCode }).from(departments).where(eq(departments.id, row.payerId)).limit(1);
        payer_label = dept[0]?.departmentName ?? null;
        payer_code = dept[0]?.departmentCode ?? null;
    }

    return {
        id: row.id,
        ref_code: row.refCode,
        status: row.status,
        transaction_mode: row.transactionMode,
        payment_method: row.paymentMethod,
        shop_id: row.shopId,
        shop_name: row.shopName,
        cashier_user_id: row.cashierUserId,
        cashier_name: row.cashierName,
        payer_kind: row.payerKind,
        payer_id: row.payerId,
        payer_label,
        payer_code,
        items_count: row.itemsCount,
        amount: pgNumber(row.amount),
        receipt_id: row.receiptId,
        receipt_number: row.receiptNumber,
        error_message: row.errorMessage,
        created_at: pgToIso(row.createdAt)!,
        resolved_at: pgToIso(row.resolvedAt),
        items,
    };
}

export async function getTransactionIdByRefCode(refCode: string): Promise<number | null> {
    try {
        const rows = await db
            .select({ id: posCheckoutTransactions.id })
            .from(posCheckoutTransactions)
            .where(eq(posCheckoutTransactions.refCode, refCode))
            .orderBy(desc(posCheckoutTransactions.id))
            .limit(1);
        return rows[0]?.id ?? null;
    } catch (err) {
        logger.error("[pos_transaction] getTransactionIdByRefCode failed", { refCode, err });
        return null;
    }
}

// ── List (Transactions tab) ─────────────────────────────────────────────

export interface ListTransactionsParams {
    caller: AccessTokenPayload & { shop_id?: string | null };
    shopId?: string;
    shopIds?: string;
    status?: string;
    paymentMethod?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
    sortBy?: "created_at" | "resolved_at";
    sortOrder?: "asc" | "desc";
    createdBy?: number;
}

export interface TransactionDTO {
    id: number;
    ref_code: string | null;
    status: string;
    transaction_mode: string | null;
    payment_method: string;
    shop_id: string | null;
    shop_name: string | null;
    cashier_user_id: number | null;
    cashier_name: string | null;
    payer_kind: string | null;
    payer_id: number | null;
    payer_label: string | null;
    payer_code: string | null;
    items_count: number | null;
    amount: number | null;
    receipt_id: number | null;
    receipt_number: string | null;
    error_message: string | null;
    created_at: string;
    resolved_at: string | null;
}

export interface ListTransactionsResponse {
    items: TransactionDTO[];
    total: number;
    page: number;
    pages: number;
    page_size: number;
}

function buildTransactionScope(p: ListTransactionsParams): { effectiveShopId?: string; shopIds?: string } {
    let effectiveShopId = p.shopId;
    const callerShop = p.caller.shop_id ?? null;
    if (p.shopId && !userCanAccessShop(p.caller, p.shopId)) {
        const err = new Error(`Not authorized to view transactions of shop '${p.shopId}'`);
        (err as { status?: number }).status = 403;
        throw err;
    }
    if (!p.caller.is_superuser && callerShop && !p.shopId && !p.shopIds) {
        effectiveShopId = callerShop;
    }
    return { effectiveShopId, shopIds: p.shopIds };
}

function buildTransactionFilters(
    p: ListTransactionsParams,
    scope: { effectiveShopId?: string; shopIds?: string },
): SQL[] {
    const conds: SQL[] = [];
    if (p.status?.trim() && p.status !== "all") {
        conds.push(eq(posCheckoutTransactions.status, p.status as "pending" | "success" | "failed" | "cancelled"));
    }
    if (p.paymentMethod?.trim() && p.paymentMethod !== "all") {
        conds.push(eq(posCheckoutTransactions.paymentMethod, p.paymentMethod.toLowerCase()));
    }
    if (scope.effectiveShopId) {
        conds.push(eq(posCheckoutTransactions.shopId, scope.effectiveShopId));
    } else if (scope.shopIds) {
        const ids = scope.shopIds.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length > 0) {
            conds.push(or(inArray(posCheckoutTransactions.shopId, ids), isNull(posCheckoutTransactions.shopId))!);
        }
    }
    if (p.dateFrom) conds.push(gte(posCheckoutTransactions.createdAt, bangkokDateRange(p.dateFrom, p.dateFrom).start));
    if (p.dateTo) conds.push(lte(posCheckoutTransactions.createdAt, bangkokDateRange(p.dateTo, p.dateTo).end));
    if (p.createdBy) conds.push(eq(posCheckoutTransactions.cashierUserId, p.createdBy));
    return conds;
}

export async function listTransactions(p: ListTransactionsParams): Promise<ListTransactionsResponse> {
    const scope = buildTransactionScope(p);
    const page = Math.max(1, p.page ?? 1);
    const pageSize = Math.min(p.pageSize ?? 50, 500);
    const offset = (page - 1) * pageSize;
    const conds = buildTransactionFilters(p, scope);
    const where = conds.length > 0 ? and(...conds) : undefined;

    // Determine sort order
    const sortFn = p.sortOrder === "asc" ? asc : desc;
    const orderByCols = p.sortBy === "resolved_at"
        ? [sortFn(posCheckoutTransactions.resolvedAt), desc(posCheckoutTransactions.id)]
        : [sortFn(posCheckoutTransactions.createdAt), desc(posCheckoutTransactions.id)];

    const [countRow, rows] = await Promise.all([
        db.select({ total: sql<string>`count(*)` }).from(posCheckoutTransactions).where(where),
        db
            .select({
                id: posCheckoutTransactions.id,
                refCode: posCheckoutTransactions.refCode,
                status: posCheckoutTransactions.status,
                transactionMode: posCheckoutTransactions.transactionMode,
                paymentMethod: posCheckoutTransactions.paymentMethod,
                shopId: posCheckoutTransactions.shopId,
                shopName: shops.name,
                cashierUserId: posCheckoutTransactions.cashierUserId,
                cashierName: users.fullName,
                payerKind: posCheckoutTransactions.payerKind,
                payerId: posCheckoutTransactions.payerId,
                itemsCount: posCheckoutTransactions.itemsCount,
                amount: posCheckoutTransactions.amount,
                receiptId: posCheckoutTransactions.receiptId,
                receiptNumber: receipts.receiptNumber,
                errorMessage: posCheckoutTransactions.errorMessage,
                createdAt: posCheckoutTransactions.createdAt,
                resolvedAt: posCheckoutTransactions.resolvedAt,
            })
            .from(posCheckoutTransactions)
            .leftJoin(shops, eq(shops.id, posCheckoutTransactions.shopId))
            .leftJoin(users, eq(users.id, posCheckoutTransactions.cashierUserId))
            .leftJoin(receipts, eq(receipts.id, posCheckoutTransactions.receiptId))
            .where(where)
            .orderBy(...orderByCols)
            .limit(pageSize)
            .offset(offset),
    ]);

    const total = Number(countRow[0]?.total ?? 0);

    // Resolve payer labels: collect customer, user, and department IDs then fetch names
    const customerIds = [...new Set(rows.filter((r) => r.payerKind === "customer" && r.payerId).map((r) => r.payerId as number))];
    const userIds = [...new Set(rows.filter((r) => r.payerKind === "user" && r.payerId).map((r) => r.payerId as number))];
    const deptIds = [...new Set(rows.filter((r) => r.payerKind === "department" && r.payerId).map((r) => r.payerId as number))];

    const [customerRows, userRows, deptRows] = await Promise.all([
        customerIds.length > 0 ? db.select({ id: customers.id, name: customers.name, studentCode: customers.studentCode, customerCode: customers.customerCode, externalId: customers.externalId }).from(customers).where(inArray(customers.id, customerIds)) : Promise.resolve([]),
        userIds.length > 0 ? db.select({ id: users.id, fullName: users.fullName, username: users.username, externalId: users.externalId }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
        deptIds.length > 0 ? db.select({ id: departments.id, departmentName: departments.departmentName, departmentCode: departments.departmentCode }).from(departments).where(inArray(departments.id, deptIds)) : Promise.resolve([]),
    ]);

    const customerNameById = new Map(customerRows.map((c) => [c.id, { name: c.name, code: c.studentCode ?? c.customerCode ?? c.externalId ?? null }]));
    const userNameById = new Map(userRows.map((u) => [u.id, { name: u.fullName, code: u.externalId ?? u.username ?? null }]));
    const deptNameById = new Map(deptRows.map((d) => [d.id, { name: d.departmentName, code: d.departmentCode ?? null }]));

    const items: TransactionDTO[] = rows.map((r, index) => {
        let payer_label: string | null = null;
        let payer_code: string | null = null;
        if (r.payerKind === "customer" && r.payerId) {
            const info = customerNameById.get(r.payerId);
            payer_label = info?.name ?? null;
            payer_code = info?.code ?? null;
        } else if (r.payerKind === "user" && r.payerId) {
            const info = userNameById.get(r.payerId);
            payer_label = info?.name ?? null;
            payer_code = info?.code ?? null;
        } else if (r.payerKind === "department" && r.payerId) {
            const info = deptNameById.get(r.payerId);
            payer_label = info?.name ?? null;
            payer_code = info?.code ?? null;
        }

        return {
            seq: (page - 1) * pageSize + index + 1,
            id: r.id,
            ref_code: r.refCode,
            status: r.status,
            transaction_mode: r.transactionMode,
            payment_method: r.paymentMethod,
            shop_id: r.shopId,
            shop_name: r.shopName,
            cashier_user_id: r.cashierUserId,
            cashier_name: r.cashierName,
            payer_kind: r.payerKind,
            payer_id: r.payerId,
            payer_label,
            payer_code,
            items_count: r.itemsCount,
            amount: pgNumber(r.amount),
            receipt_id: r.receiptId,
            receipt_number: r.receiptNumber,
            error_message: r.errorMessage,
            created_at: pgToIso(r.createdAt)!,
            resolved_at: pgToIso(r.resolvedAt),
        };
    });

    return {
        items,
        total,
        page,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        page_size: pageSize,
    };
}
