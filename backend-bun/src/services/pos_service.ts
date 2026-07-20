import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import {
    receipts,
    receiptItems,
    shopProducts,
    shops,
    customers,
    users,
    departments,
    wallets,
    walletTransactions,
    bundleItems,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { fifoRefundLot } from "@/services/inventory_fifo";
import { dateRange } from "@/services/report_service";

export interface ReceiptItemDTO {
    id: number;
    receipt_id: number;
    product_variant_id: number;
    quantity: number;
    unit_price: number;
    price_override: number | null;
    discount: number;
    line_total: number;
    options: unknown | null;
    created_at: string;
    product_variant: {
        sku: string | null;
        variant_name: string | null;
        barcode: string | null;
    } | null;
}

export interface PayerDetailDTO {
    name: string;
    code: string | null;
    grade: string | null;
    photo_url: string | null;
    role: string;
    wallet_balance: number | null;
}

export interface ReceiptDTO {
    id: number;
    receipt_number: string;
    transaction_date: string;
    transaction_mode: string;
    customer_type_id: number | null;
    customer_id: number | null;
    payer_user_id: number | null;
    payer_department_id: number | null;
    payer_label: string | null;
    payer_kind: "customer" | "user" | "department" | null;
    payer_detail: PayerDetailDTO | null;
    requester_user_id: number | null;
    requester_name: string | null;
    shop_id: string | null;
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    payment_method: string;
    status: string;
    terminal_id: string | null;
    notes: string | null;
    edc_terminal_ref: string | null;
    edc_approval_code: string | null;
    edc_masked_card: string | null;
    cash_received: number | null;
    created_at: string;
    created_by: number;
    created_by_name: string | null;
    shop_name: string | null;
    voided_at: string | null;
    voided_by: number | null;
    voided_reason: string | null;
    items: ReceiptItemDTO[];
}

function userCanAccessShop(caller: AccessTokenPayload & { shop_id?: string | null }, shopId: string): boolean {
    // Mirrors `user_can_access_shop` in FastAPI deps.py:
    // - admin / superuser: all shops
    // - unscoped manager (shop_id null) AND has manager role: all shops
    //   (multi-shop / regional managers don't carry a single shop_id)
    // - everyone else: only their own shop
    if (caller.is_superuser || caller.roles.includes("admin")) return true;
    const callerShop = caller.shop_id ?? null;
    if (callerShop === null && caller.roles.includes("manager")) return true;
    return callerShop === shopId;
}

async function loadItems(receiptId: number): Promise<ReceiptItemDTO[]> {
    const itemRows = await db
        .select({ item: receiptItems, product: shopProducts })
        .from(receiptItems)
        .leftJoin(shopProducts, eq(shopProducts.id, receiptItems.productVariantId))
        .where(eq(receiptItems.receiptId, receiptId))
        .orderBy(asc(receiptItems.id));

    return itemRows.map(({ item, product }) => ({
        id: item.id,
        receipt_id: item.receiptId,
        product_variant_id: item.productVariantId,
        quantity: item.quantity,
        unit_price: pgNumber(item.unitPrice) ?? 0,
        price_override: pgNumber(item.priceOverride),
        discount: pgNumber(item.discount) ?? 0,
        line_total: pgNumber(item.lineTotal) ?? 0,
        options: item.options ?? null,
        created_at: pgToIso(item.createdAt)!,
        product_variant: product
            ? {
                sku: product.productCode ?? null,
                variant_name: product.name ?? null,
                barcode: product.barcode ?? null,
            }
            : null,
    }));
}

/** Resolve wallet balance at the moment of this receipt — falls back to the
 *  current wallet balance if no matching wallet_transactions row is found. */
async function balanceAtReceipt(walletId: number | null, receiptId: number): Promise<number | null> {
    if (walletId === null) return null;
    const tx = await db
        .select({ balanceAfter: walletTransactions.balanceAfter })
        .from(walletTransactions)
        .where(
            and(
                eq(walletTransactions.walletId, walletId),
                eq(walletTransactions.referenceType, "receipt"),
                eq(walletTransactions.referenceId, receiptId),
            ),
        )
        .limit(1);
    if (tx[0]) return pgNumber(tx[0].balanceAfter);
    const w = await db.select({ b: wallets.balance }).from(wallets).where(eq(wallets.id, walletId)).limit(1);
    return w[0] ? pgNumber(w[0].b) : null;
}

async function receiptToDTO(receipt: typeof receipts.$inferSelect): Promise<ReceiptDTO> {
    const [items, shopRow, creator, customer, payerUser, payerDept, requester] = await Promise.all([
        loadItems(receipt.id),
        receipt.shopId
            ? db.select({ name: shops.name }).from(shops).where(eq(shops.id, receipt.shopId)).limit(1)
            : Promise.resolve([] as Array<{ name: string }>),
        db
            .select({ fullName: users.fullName, username: users.username })
            .from(users)
            .where(eq(users.id, receipt.createdBy))
            .limit(1),
        receipt.customerId !== null
            ? db.select().from(customers).where(eq(customers.id, receipt.customerId)).limit(1)
            : Promise.resolve([] as Array<typeof customers.$inferSelect>),
        receipt.payerUserId !== null
            ? db.select().from(users).where(eq(users.id, receipt.payerUserId)).limit(1)
            : Promise.resolve([] as Array<typeof users.$inferSelect>),
        receipt.payerDepartmentId !== null
            ? db.select().from(departments).where(eq(departments.id, receipt.payerDepartmentId)).limit(1)
            : Promise.resolve([] as Array<typeof departments.$inferSelect>),
        receipt.requesterUserId !== null
            ? db
                .select({ fullName: users.fullName })
                .from(users)
                .where(eq(users.id, receipt.requesterUserId))
                .limit(1)
            : Promise.resolve([] as Array<{ fullName: string }>),
    ]);

    const payer_kind: "customer" | "user" | "department" | null = receipt.payerDepartmentId
        ? "department"
        : receipt.payerUserId
            ? "user"
            : receipt.customerId
                ? "customer"
                : null;

    let payer_label: string | null = null;
    let payer_detail: PayerDetailDTO | null = null;

    if (payer_kind === "customer" && customer[0]) {
        payer_label = customer[0].name;
        const w = await db
            .select({ id: wallets.id })
            .from(wallets)
            .where(eq(wallets.customerId, customer[0].id))
            .limit(1);
        payer_detail = {
            name: customer[0].name,
            code: customer[0].studentCode ?? customer[0].customerCode,
            grade: customer[0].grade ?? null,
            photo_url: customer[0].photoUrl ?? null,
            role: "student",
            wallet_balance: w[0] ? await balanceAtReceipt(w[0].id, receipt.id) : null,
        };
    } else if (payer_kind === "user" && payerUser[0]) {
        payer_label = payerUser[0].fullName;
        const w = await db
            .select({ id: wallets.id })
            .from(wallets)
            .where(eq(wallets.userId, payerUser[0].id))
            .limit(1);
        payer_detail = {
            name: payerUser[0].fullName,
            code: payerUser[0].externalId ?? payerUser[0].username,
            grade: null,
            photo_url: payerUser[0].photoUrl ?? null,
            role: payerUser[0].role ?? "user",
            wallet_balance: w[0] ? await balanceAtReceipt(w[0].id, receipt.id) : null,
        };
    } else if (payer_kind === "department" && payerDept[0]) {
        payer_label = payerDept[0].departmentName;
        const w = await db
            .select({ id: wallets.id })
            .from(wallets)
            .where(eq(wallets.departmentId, payerDept[0].id))
            .limit(1);
        payer_detail = {
            name: payerDept[0].departmentName,
            code: payerDept[0].departmentCode,
            grade: null,
            photo_url: null,
            role: "department",
            wallet_balance: w[0] ? await balanceAtReceipt(w[0].id, receipt.id) : null,
        };
    }

    return {
        id: receipt.id,
        receipt_number: receipt.receiptNumber,
        transaction_date: pgToIso(receipt.transactionDate)!,
        transaction_mode: receipt.transactionMode,
        customer_type_id: receipt.customerTypeId ?? null,
        customer_id: receipt.customerId ?? null,
        payer_user_id: receipt.payerUserId ?? null,
        payer_department_id: receipt.payerDepartmentId ?? null,
        payer_label,
        payer_kind,
        payer_detail,
        requester_user_id: receipt.requesterUserId ?? null,
        requester_name: requester[0]?.fullName ?? null,
        shop_id: receipt.shopId ?? null,
        subtotal: pgNumber(receipt.subtotal) ?? 0,
        discount: pgNumber(receipt.discount) ?? 0,
        tax: pgNumber(receipt.tax) ?? 0,
        total: pgNumber(receipt.total) ?? 0,
        payment_method: receipt.paymentMethod,
        // Lowercase to match frontend expectation ('active' / 'voided').
        // Drizzle returns the raw enum value ('ACTIVE' / 'VOIDED').
        status: receipt.status.toLowerCase() as "active" | "voided",
        terminal_id: receipt.terminalId ?? null,
        notes: receipt.notes ?? null,
        edc_terminal_ref: receipt.edcTerminalRef ?? null,
        edc_approval_code: receipt.edcApprovalCode ?? null,
        edc_masked_card: receipt.edcMaskedCard ?? null,
        cash_received: pgNumber(receipt.cashReceived),
        created_at: pgToIso(receipt.createdAt)!,
        created_by: receipt.createdBy,
        created_by_name: creator[0]?.fullName ?? creator[0]?.username ?? null,
        shop_name: shopRow[0]?.name ?? null,
        voided_at: pgToIso(receipt.voidedAt),
        voided_by: receipt.voidedBy ?? null,
        voided_reason: receipt.voidedReason ?? null,
        items,
    };
}

export interface ListReceiptsParams {
    caller: AccessTokenPayload & { shop_id?: string | null };
    q?: string;
    shopId?: string;
    shopIds?: string;
    transactionMode?: string;
    requesterUserId?: number;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
}

export async function listReceipts(p: ListReceiptsParams): Promise<ReceiptDTO[]> {
    // Auto-scope: if caller specifies a shop they can't see → 403.
    let effectiveShopId = p.shopId;
    const callerShop = p.caller.shop_id ?? null;
    if (p.shopId && !userCanAccessShop(p.caller, p.shopId)) {
        const err = new Error(`Not authorized to view receipts of shop '${p.shopId}'`);
        (err as { status?: number }).status = 403;
        throw err;
    }
    if (!p.caller.is_superuser && callerShop && !p.shopId && !p.shopIds) {
        effectiveShopId = callerShop;
    }

    const page = Math.max(1, p.page ?? 1);
    const pageSize = Math.min(p.pageSize ?? 50, 500);
    const offset = (page - 1) * pageSize;

    const conds = [];
    if (p.q?.trim()) conds.push(ilike(receipts.receiptNumber, `%${p.q.trim()}%`));
    if (effectiveShopId) {
        conds.push(eq(receipts.shopId, effectiveShopId));
    } else if (p.shopIds) {
        const ids = p.shopIds.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length > 0) {
            conds.push(or(inArray(receipts.shopId, ids), isNull(receipts.shopId))!);
        }
    }
    if (p.transactionMode) {
        conds.push(eq(receipts.transactionMode, p.transactionMode as typeof receipts.$inferSelect.transactionMode));
    }
    if (p.requesterUserId !== undefined) conds.push(eq(receipts.requesterUserId, p.requesterUserId));
    // receipts.transaction_date is timestamptz — a bare YYYY-MM-DD compares
    // against UTC midnight, not end-of-day Bangkok time, silently excluding
    // most of the business day (Bangkok is UTC+7). Anchor both bounds to
    // Asia/Bangkok like report_service.ts's dateRange() does.
    if (p.dateFrom) conds.push(gte(receipts.transactionDate, dateRange(p.dateFrom, p.dateFrom).start));
    if (p.dateTo) conds.push(lte(receipts.transactionDate, dateRange(p.dateTo, p.dateTo).end));

    const rows = await db
        .select()
        .from(receipts)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(receipts.createdAt))
        .limit(pageSize)
        .offset(offset);

    return Promise.all(rows.map(receiptToDTO));
}

export async function getReceipt(receiptId: number): Promise<ReceiptDTO> {
    const rows = await db.select().from(receipts).where(eq(receipts.id, receiptId)).limit(1);
    if (!rows[0]) {
        const err = new Error("Receipt not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return receiptToDTO(rows[0]);
}

// ── Void receipt — atomic stock restore + wallet refund + audit ────────────

export async function voidReceipt(args: {
    caller: AccessTokenPayload & { shop_id?: string | null };
    receiptId: number;
    reason: string | null;
}): Promise<ReceiptDTO> {
    const { caller, receiptId } = args;
    // Defensive: coerce reason to string|null so we never accidentally
    // pass a parsed JSON object (e.g. when frontend sends `{}` or `[]`)
    // into a string column; postgres-js then throws the unhelpful
    // 'Received an instance of Object' message.
    const reason: string | null =
        args.reason === null || args.reason === undefined
            ? null
            : typeof args.reason === "string"
                ? args.reason
                : String(args.reason);
    if (!reason || !reason.trim()) {
        const err = new Error("Void reason is required");
        (err as { status?: number }).status = 400;
        throw err;
    }
    const callerId = Number(caller.sub);

    const rRows = await db.select().from(receipts).where(eq(receipts.id, receiptId)).limit(1);
    if (!rRows[0]) {
        const err = new Error("Receipt not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const receipt = rRows[0];
    if (receipt.shopId && !userCanAccessShop(caller, receipt.shopId)) {
        const err = new Error(`Receipt belongs to shop '${receipt.shopId}' which is outside your scope`);
        (err as { status?: number }).status = 403;
        throw err;
    }
    if (receipt.status === "VOIDED") {
        const err = new Error("Receipt already voided");
        (err as { status?: number }).status = 400;
        throw err;
    }

    // Load items + product info upfront (read-only, no lock needed).
    const items = await db
        .select({ item: receiptItems, product: shopProducts })
        .from(receiptItems)
        .leftJoin(shopProducts, eq(shopProducts.id, receiptItems.productVariantId))
        .where(eq(receiptItems.receiptId, receiptId));

    // Resolve payer label for void audit.
    let voidPayerLabel: string | null = null;
    let voidPayerKind: string | null = null;
    if (receipt.customerId) {
        voidPayerKind = "customer";
        const cRows = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, receipt.customerId)).limit(1);
        voidPayerLabel = cRows[0]?.name ?? null;
    } else if (receipt.payerUserId) {
        voidPayerKind = "user";
        const uRows = await db.select({ fullName: users.fullName, username: users.username }).from(users).where(eq(users.id, receipt.payerUserId)).limit(1);
        voidPayerLabel = uRows[0]?.fullName ?? uRows[0]?.username ?? null;
    } else if (receipt.payerDepartmentId) {
        voidPayerKind = "department";
        const dRows = await db.select({ name: departments.departmentName }).from(departments).where(eq(departments.id, receipt.payerDepartmentId)).limit(1);
        voidPayerLabel = dRows[0]?.name ?? null;
    }

    // Pre-load bundle item rows for any bundle line.
    const bundleIds = items
        .map(({ item }) => {
            const opts = (item.options ?? {}) as { is_bundle?: boolean; bundle_id?: number };
            return opts.is_bundle && opts.bundle_id ? opts.bundle_id : null;
        })
        .filter((id): id is number => id !== null);

    const bundleItemsMap = new Map<number, Array<typeof bundleItems.$inferSelect>>();
    if (bundleIds.length > 0) {
        const bRows = await db.select().from(bundleItems).where(inArray(bundleItems.bundleId, bundleIds));
        bRows.forEach((b) => {
            const arr = bundleItemsMap.get(b.bundleId) ?? [];
            arr.push(b);
            bundleItemsMap.set(b.bundleId, arr);
        });
    }

    const voidLines: Array<{ name: string; qty: number; price: number }> = [];
    const today = new Date().toISOString().slice(0, 10);

    // Mark receipt voided OUTSIDE the inner transaction so we can identify
    // whether the postgres-js 'Object' bind error originates from the
    // UPDATE itself or from one of the loop SQL statements below.
    await db
        .update(receipts)
        .set({
            status: "VOIDED",
            voidedAt: sql`NOW()`,
            voidedBy: callerId,
            voidedReason: reason,
        })
        .where(eq(receipts.id, receiptId));

    await pgClient.begin(async (sqlTx) => {

        // Restore stock per item
        for (const { item, product } of items) {
            const opts = (item.options ?? {}) as { is_bundle?: boolean; bundle_id?: number; bundle_name?: string };
            if (opts.is_bundle && opts.bundle_id) {
                const subItems = bundleItemsMap.get(opts.bundle_id) ?? [];
                for (const bi of subItems) {
                    const subRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; avg_cost: string; shop_type: string }>>`
            SELECT sp.id, sp.name, sp.shop_id, sp.stock, sp.avg_cost::text AS avg_cost, s.shop_type
            FROM shop_products sp JOIN shops s ON s.id = sp.shop_id
            WHERE sp.id = ${bi.productId} FOR UPDATE OF sp
          `;
                    const sub = subRows[0];
                    if (!sub) continue;
                    const restoreQty = bi.quantity * item.quantity;
                    const stockBefore = sub.stock;
                    const stockAfter = stockBefore + restoreQty;
                    await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${sub.id}`;
                    if (sub.shop_type === "fifo") {
                        await fifoRefundLot(sqlTx, sub.id, sub.shop_id, restoreQty, receipt.receiptNumber, pgNumber(sub.avg_cost) ?? 0);
                    }
                    await sqlTx`
            INSERT INTO shop_movements
              (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
               cost_per_unit, reference, note, created_by)
            VALUES (${today}, ${sub.id}, ${sub.name}, ${sub.shop_id}, 'void',
                    ${restoreQty}, ${stockBefore}, ${stockAfter},
                    ${pgNumber(sub.avg_cost) ?? 0}, ${receipt.receiptNumber},
                    ${reason ?? "Voided receipt (bundle)"}, ${callerId})
          `;
                }
                voidLines.push({
                    name: opts.bundle_name ?? `#bundle ${opts.bundle_id}`,
                    qty: item.quantity,
                    price: pgNumber(item.lineTotal) ?? 0,
                });
                continue;
            }

            if (!product) {
                voidLines.push({ name: `#${item.productVariantId}`, qty: item.quantity, price: pgNumber(item.lineTotal) ?? 0 });
                continue;
            }
            const lockedRows = await sqlTx<Array<{ stock: number; avg_cost: string; shop_type: string }>>`
        SELECT sp.stock, sp.avg_cost::text AS avg_cost, s.shop_type
        FROM shop_products sp JOIN shops s ON s.id = sp.shop_id
        WHERE sp.id = ${product.id} FOR UPDATE OF sp
      `;
            const locked = lockedRows[0];
            const stockBefore = locked?.stock ?? product.stock;
            const stockAfter = stockBefore + item.quantity;
            await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${product.id}`;
            if (locked?.shop_type === "fifo") {
                await fifoRefundLot(sqlTx, product.id, product.shopId, item.quantity, receipt.receiptNumber, pgNumber(locked.avg_cost) ?? 0);
            }
            await sqlTx`
        INSERT INTO shop_movements
          (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
           cost_per_unit, sale_amount, reference, note, created_by)
        VALUES (${today}, ${product.id}, ${product.name}, ${product.shopId}, 'void',
                ${item.quantity}, ${stockBefore}, ${stockAfter},
                ${pgNumber(locked?.avg_cost ?? null) ?? 0}, ${pgNumber(item.lineTotal) ?? 0}, ${receipt.receiptNumber},
                ${reason ?? "Voided receipt"}, ${callerId})
      `;
            voidLines.push({ name: product.name, qty: item.quantity, price: pgNumber(item.lineTotal) ?? 0 });
        }

        // Refund wallet for wallet/card_tap payments
        if (receipt.paymentMethod === "WALLET" || receipt.paymentMethod === "CARD_TAP") {
            let walletId: number | null = null;
            if (receipt.customerId !== null) {
                const w = await sqlTx<Array<{ id: number; balance: string }>>`
          SELECT id, balance FROM wallets WHERE customer_id = ${receipt.customerId} FOR UPDATE
        `;
                if (w[0]) walletId = w[0].id;
            } else if (receipt.payerUserId !== null) {
                const w = await sqlTx<Array<{ id: number; balance: string }>>`
          SELECT id, balance FROM wallets WHERE user_id = ${receipt.payerUserId} FOR UPDATE
        `;
                if (w[0]) walletId = w[0].id;
            } else if (receipt.payerDepartmentId !== null) {
                const w = await sqlTx<Array<{ id: number; balance: string }>>`
          SELECT id, balance FROM wallets WHERE department_id = ${receipt.payerDepartmentId} FOR UPDATE
        `;
                if (w[0]) walletId = w[0].id;
            }
            if (walletId !== null) {
                const bRows = await sqlTx<Array<{ balance: string }>>`
          SELECT balance FROM wallets WHERE id = ${walletId}
        `;
                const balanceBefore = Number(bRows[0].balance);
                const refundAmt = pgNumber(receipt.total) ?? 0;
                const balanceAfter = balanceBefore + refundAmt;
                await sqlTx`UPDATE wallets SET balance = ${balanceAfter}, updated_at = NOW() WHERE id = ${walletId}`;
                await sqlTx`
          INSERT INTO wallet_transactions
            (wallet_id, transaction_type, amount, balance_before, balance_after,
             reference_type, reference_id, description, created_by)
          VALUES (${walletId}, 'REFUND', ${refundAmt}, ${balanceBefore}, ${balanceAfter},
                  'receipt_void', ${receiptId},
                  ${"Void refund for receipt " + receipt.receiptNumber}, ${callerId})
        `;

                // Record void transaction to cancel daily spend limit
                // so spent_today calculation excludes this voided receipt
                await sqlTx`
          INSERT INTO wallet_transactions
            (wallet_id, transaction_type, amount, balance_before, balance_after,
             reference_type, reference_id, description, created_by)
          VALUES (${walletId}, 'VOID', ${refundAmt}, ${balanceBefore}, ${balanceAfter},
                  'receipt_void', ${receiptId},
                  ${"Spending limit adjustment for voided receipt " + receipt.receiptNumber}, ${callerId})
        `;
            }
        }

        // Audit log
        await sqlTx`
      INSERT INTO audit_logs (entity_type, entity_id, entity_name, shop_id, action, user_id, changes_json)
      VALUES ('receipt', ${receiptId}, ${receipt.receiptNumber}, ${receipt.shopId}, 'VOID',
              ${callerId},
              ${JSON.stringify({
            reason,
            total: pgNumber(receipt.total) ?? 0,
            products: voidLines,
            payer_kind: voidPayerKind,
            payer_label: voidPayerLabel,
            payer_id: receipt.customerId ?? receipt.payerUserId ?? receipt.payerDepartmentId ?? null,
        })}::jsonb)
    `;
    });

    return getReceipt(receiptId);
}
