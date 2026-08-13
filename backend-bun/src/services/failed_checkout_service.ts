/**
 * Checkouts that never became receipts.
 *
 * `edc_txn_events` only sees the card terminal. This covers every payment
 * method and every reason a sale failed to record, with the cart attached so
 * a row is still readable months later — the original complaint was that a
 * lost sale left an amount and nothing else.
 *
 * Two writers:
 *   - the server, from PosController.checkout()'s catch, when the request
 *     arrived and was rejected or blew up;
 *   - the browser, when the request itself never completed. That report
 *     carries the idempotency key, which is resolved against `receipts` before
 *     anything is stored — a timeout whose sale actually landed is dropped
 *     rather than recorded as a phantom failure. Reporting a succeeded sale as
 *     failed is the one outcome that could make someone sell it twice.
 *
 * Every write is best-effort and swallows its own errors: a logging failure
 * must never mask the real error the cashier needs to see, nor turn a
 * rejected sale into a 500.
 */
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { posFailedCheckouts, receipts, shopProducts } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import { logger } from "@/logger";

/** 'rejected' 4xx · 'error' 5xx · 'not_recorded' request never completed. */
export type FailedCheckoutStatus = "rejected" | "error" | "not_recorded";

export interface FailedCartItem {
    product_variant_id: number | null;
    product_code: string;
    name: string;
    quantity: number;
    unit_price: number;
    discount: number;
    line_total: number;
    is_bundle?: boolean;
}

export interface FailedCartSnapshot {
    items: FailedCartItem[];
    discount: number;
    total: number;
    payer: {
        customer_id: number | null;
        user_id: number | null;
        department_id: number | null;
    } | null;
}

/** Shape of the checkout body we care about. Everything optional — this runs
 *  on the error path, where the payload may be exactly what was malformed. */
interface CheckoutBodyLike {
    payment_method?: unknown;
    transaction_mode?: unknown;
    shop_id?: unknown;
    discount?: unknown;
    customer_id?: unknown;
    payer_user_id?: unknown;
    payer_department_id?: unknown;
    idempotency_key?: unknown;
    edc_approval_code?: unknown;
    edc_terminal_ref?: unknown;
    items?: unknown;
}

const MAX_ITEMS = 200;

function num(v: unknown): number {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function optInt(v: unknown): number | null {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function short(v: unknown, maxLen: number): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, maxLen) : null;
}

/**
 * Turn the checkout payload into a readable cart.
 *
 * The payload carries product ids only, so names are resolved here — at write
 * time, not read time. A snapshot that needs a live join to be legible stops
 * being a snapshot the moment a product is renamed or deleted, which is
 * exactly the window this table exists to survive.
 *
 * Only runs on the failure path (~1% of checkouts in production), so the extra
 * query costs nothing that matters.
 */
export async function buildFailedCartSnapshot(body: CheckoutBodyLike): Promise<FailedCartSnapshot> {
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];

    const ids = rawItems
        .map((it) => optInt((it as Record<string, unknown>)?.product_variant_id))
        .filter((n): n is number => n !== null);

    const nameById = new Map<number, { code: string; name: string }>();
    if (ids.length > 0) {
        try {
            const rows = await db
                .select({ id: shopProducts.id, code: shopProducts.productCode, name: shopProducts.name })
                .from(shopProducts)
                .where(inArray(shopProducts.id, ids));
            for (const r of rows) nameById.set(r.id, { code: r.code ?? "", name: r.name });
        } catch (e) {
            // Names are a nicety; the quantities and prices are the record.
            logger.warn("[failed-checkout] product name lookup failed", e);
        }
    }

    let total = 0;
    const items: FailedCartItem[] = rawItems.map((raw) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        const pid = optInt(it.product_variant_id);
        const meta = pid !== null ? nameById.get(pid) : undefined;
        const qty = num(it.quantity);
        const unit = it.price_override != null ? num(it.price_override) : num(it.unit_price);
        const discount = num(it.discount);
        const lineTotal = Math.round((qty * unit - discount) * 100) / 100;
        total += lineTotal;
        return {
            product_variant_id: pid,
            product_code: meta?.code ?? "",
            // A bundle's sentinel id (0) and a deleted product both land here.
            name: meta?.name ?? (it.is_bundle === true ? "(bundle)" : "(unknown product)"),
            quantity: qty,
            unit_price: unit,
            discount,
            line_total: lineTotal,
            ...(it.is_bundle === true ? { is_bundle: true } : {}),
        };
    });

    const billDiscount = num(body.discount);
    return {
        items,
        discount: billDiscount,
        total: Math.round((total - billDiscount) * 100) / 100,
        payer:
            optInt(body.customer_id) || optInt(body.payer_user_id) || optInt(body.payer_department_id)
                ? {
                    customer_id: optInt(body.customer_id),
                    user_id: optInt(body.payer_user_id),
                    department_id: optInt(body.payer_department_id),
                }
                : null,
    };
}

export interface RecordFailedCheckoutInput {
    status: FailedCheckoutStatus;
    body: CheckoutBodyLike;
    cashierUserId: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    requestId?: string | null;
}

/**
 * Store one failed checkout. Never throws.
 *
 * For `not_recorded` the idempotency key is checked first: if a receipt exists
 * for it the sale did land and there is nothing to record, so the report is
 * dropped. That check is the reason a timeout can be reported at all without
 * risking a phantom "failed" row for a sale that succeeded.
 */
export async function recordFailedCheckout(input: RecordFailedCheckoutInput): Promise<{ id: number | null }> {
    try {
        const key = short(input.body.idempotency_key, 64);

        if (input.status === "not_recorded" && key) {
            const existing = await db
                .select({ id: receipts.id })
                .from(receipts)
                .where(eq(receipts.idempotencyKey, key))
                .limit(1);
            if (existing.length > 0) {
                logger.info("[failed-checkout] report dropped — key already has a receipt", {
                    idempotencyKey: key,
                    receiptId: existing[0].id,
                });
                return { id: null };
            }
        }

        const snapshot = await buildFailedCartSnapshot(input.body);

        const [row] = await db
            .insert(posFailedCheckouts)
            .values({
                status: input.status,
                shopId: short(input.body.shop_id, 50),
                cashierUserId: input.cashierUserId,
                paymentMethod: short(input.body.payment_method, 30),
                transactionMode: short(input.body.transaction_mode, 30),
                amount: String(snapshot.total),
                cartSnapshot: snapshot,
                errorCode: short(input.errorCode, 64),
                errorMessage: input.errorMessage ? String(input.errorMessage).slice(0, 2000) : null,
                idempotencyKey: key,
                edcApprovalCode: short(input.body.edc_approval_code, 32),
                edcTerminalRef: short(input.body.edc_terminal_ref, 50),
                requestId: short(input.requestId, 64),
            })
            .returning({ id: posFailedCheckouts.id });

        logger.info("[failed-checkout] recorded", {
            id: row.id,
            status: input.status,
            shopId: short(input.body.shop_id, 50),
            paymentMethod: short(input.body.payment_method, 30),
            amount: snapshot.total,
            itemCount: snapshot.items.length,
            errorCode: input.errorCode ?? null,
        });
        return { id: row.id };
    } catch (e) {
        // Deliberately swallowed — see the file header.
        logger.error("[failed-checkout] could not record", e);
        return { id: null };
    }
}

// ── Read ──────────────────────────────────────────────────────────────────

export interface FailedCheckoutDTO {
    id: number;
    status: string;
    shop_id: string | null;
    cashier_user_id: number | null;
    payment_method: string | null;
    transaction_mode: string | null;
    amount: number | null;
    cart_snapshot: FailedCartSnapshot | null;
    error_code: string | null;
    error_message: string | null;
    idempotency_key: string | null;
    edc_approval_code: string | null;
    edc_terminal_ref: string | null;
    created_at: string;
}

export interface ListFailedCheckoutsArgs {
    shopId?: string | null;
    dateFrom?: string | null;
    dateToExclusive?: string | null;
    limit?: number;
}

export async function listFailedCheckouts(args: ListFailedCheckoutsArgs = {}): Promise<FailedCheckoutDTO[]> {
    const conds = [];
    if (args.shopId) conds.push(eq(posFailedCheckouts.shopId, args.shopId));
    if (args.dateFrom) conds.push(gte(posFailedCheckouts.createdAt, args.dateFrom));
    if (args.dateToExclusive) conds.push(lt(posFailedCheckouts.createdAt, args.dateToExclusive));

    const rows = await db
        .select()
        .from(posFailedCheckouts)
        .where(conds.length > 0 ? and(...conds) : sql`true`)
        .orderBy(desc(posFailedCheckouts.createdAt), desc(posFailedCheckouts.id))
        .limit(Math.min(Math.max(args.limit ?? 300, 1), 1000));

    return rows.map((r) => ({
        id: r.id,
        status: r.status,
        shop_id: r.shopId ?? null,
        cashier_user_id: r.cashierUserId ?? null,
        payment_method: r.paymentMethod ?? null,
        transaction_mode: r.transactionMode ?? null,
        amount: pgNumber(r.amount),
        cart_snapshot: (r.cartSnapshot as FailedCartSnapshot | null) ?? null,
        error_code: r.errorCode ?? null,
        error_message: r.errorMessage ?? null,
        idempotency_key: r.idempotencyKey ?? null,
        edc_approval_code: r.edcApprovalCode ?? null,
        edc_terminal_ref: r.edcTerminalRef ?? null,
        created_at: pgToIso(r.createdAt)!,
    }));
}

// ── Retention ─────────────────────────────────────────────────────────────

/** Matches the EDC telemetry window — see edc_telemetry_service. */
export const FAILED_CHECKOUT_SNAPSHOT_RETENTION_DAYS = 90;
export const FAILED_CHECKOUT_ROW_RETENTION_DAYS = 365;

export async function pruneFailedCheckouts(
    now: Date = new Date(),
): Promise<{ snapshotsCleared: number; rowsDeleted: number }> {
    const snapshotCutoff = new Date(
        now.getTime() - FAILED_CHECKOUT_SNAPSHOT_RETENTION_DAYS * 86_400_000,
    ).toISOString();
    const rowCutoff = new Date(
        now.getTime() - FAILED_CHECKOUT_ROW_RETENTION_DAYS * 86_400_000,
    ).toISOString();

    const cleared = await db
        .update(posFailedCheckouts)
        .set({ cartSnapshot: null })
        .where(and(
            lt(posFailedCheckouts.createdAt, snapshotCutoff),
            sql`${posFailedCheckouts.cartSnapshot} IS NOT NULL`,
        ))
        .returning({ id: posFailedCheckouts.id });

    const deleted = await db
        .delete(posFailedCheckouts)
        .where(lt(posFailedCheckouts.createdAt, rowCutoff))
        .returning({ id: posFailedCheckouts.id });

    return { snapshotsCleared: cleared.length, rowsDeleted: deleted.length };
}
