/**
 * Admin reports — mirrors /admin/adjustment-report + /admin/transfer-report
 * in FastAPI app/api/v1/wallets.py.
 */
import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
    walletTransactions,
    wallets,
    customers,
    users,
    departments,
    paymentIntents,
    receipts,
    shops,
    kioskLogs,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

export interface AdjustmentReportRow {
    id: number;
    created_at: string;
    entity_type: string;
    entity_name: string;
    entity_code: string;
    direction: "credit" | "debit";
    amount: number;
    balance_before: number;
    balance_after: number;
    reason: string | null;
    reference_ticket: string | null;
    adjusted_by: string;
}

export interface AdjustmentReportResponseDTO {
    items: AdjustmentReportRow[];
    total: number;
    credit_total: number;
    debit_total: number;
    page: number;
    pages: number;
}

function parseAdjDescription(desc: string | null): { reason: string; ticket: string | null } {
    if (!desc) return { reason: "", ticket: null };
    let ticket: string | null = null;
    const m = /\[ref:([^\]]+)\]/.exec(desc);
    if (m) ticket = m[1].trim();
    let idx = desc.indexOf(" — ");
    if (idx === -1) idx = desc.indexOf(" - ");
    const reason = idx === -1 ? desc : desc.slice(idx + 3).trim();
    return { reason, ticket };
}

export async function adjustmentReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    direction?: string | null;
    typeFilter?: string | null;
    page: number;
    pageSize: number;
}): Promise<AdjustmentReportResponseDTO> {
    const conds = [eq(walletTransactions.transactionType, "ADJUSTMENT"), isNull(wallets.departmentId)];
    if (args.dateFrom) {
        try { conds.push(gte(walletTransactions.createdAt, args.dateFrom)); }
        catch { /* ignore */ }
    }
    if (args.dateTo) {
        try {
            const end = new Date(`${args.dateTo}T00:00:00Z`);
            end.setUTCDate(end.getUTCDate() + 1);
            conds.push(lt(walletTransactions.createdAt, end.toISOString()));
        } catch { /* ignore */ }
    }

    const rows = await db
        .select({
            tx: walletTransactions,
            w: wallets,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
        .where(and(...conds))
        .orderBy(desc(walletTransactions.createdAt));

    // Batch-prefetch every customer/user row this result set could need —
    // the old code ran one SELECT per row per entity lookup plus another per
    // row for the creator's name (2N+ queries), which is what made this
    // report slow once adjustment history grew into the thousands. Department
    // wallets are excluded by the WHERE clause above, so w.departmentId is
    // never non-null here — that branch was unreachable and is dropped.
    const customerIds = [...new Set(rows.filter((r) => r.w.customerId !== null).map((r) => r.w.customerId!))];
    const userIds = [...new Set(rows.filter((r) => r.w.userId !== null).map((r) => r.w.userId!))];
    const creatorIds = [...new Set(rows.map((r) => r.tx.createdBy))];
    const allUserIds = [...new Set([...userIds, ...creatorIds])];

    const [customerRows, userRows] = await Promise.all([
        customerIds.length > 0 ? db.select().from(customers).where(inArray(customers.id, customerIds)) : Promise.resolve([]),
        allUserIds.length > 0 ? db.select().from(users).where(inArray(users.id, allUserIds)) : Promise.resolve([]),
    ]);
    const customerById = new Map(customerRows.map((c) => [c.id, c] as const));
    const userById = new Map(userRows.map((u) => [u.id, u] as const));

    const filtered: AdjustmentReportRow[] = [];
    for (const r of rows) {
        const tx = r.tx;
        const w = r.w;
        const before = pgNumber(tx.balanceBefore) ?? 0;
        const after = pgNumber(tx.balanceAfter) ?? 0;
        const delta = after - before;
        const dir: "credit" | "debit" = delta >= 0 ? "credit" : "debit";
        if (args.direction === "credit" || args.direction === "debit") {
            if (dir !== args.direction) continue;
        }

        let entityType = "unknown", entityName = "—", entityCode = "—";
        if (w.customerId !== null) {
            const c = customerById.get(w.customerId);
            if (c) { entityType = "student"; entityName = c.name; entityCode = c.studentCode ?? c.customerCode; }
        } else if (w.userId !== null) {
            const u = userById.get(w.userId);
            if (u) { entityType = u.role ?? "staff"; entityName = u.fullName || u.username; entityCode = u.username; }
        }

        const creator = userById.get(tx.createdBy);
        const creatorName = creator ? (creator.fullName || creator.username) : String(tx.createdBy);

        let reason: string | null = tx.reason ?? null;
        let refTicket: string | null = tx.referenceTicket ?? null;
        if (!reason) {
            const parsed = parseAdjDescription(tx.description);
            reason = parsed.reason || null;
            if (!refTicket) refTicket = parsed.ticket;
        }

        if (args.typeFilter) {
            const wanted = args.typeFilter.trim().toLowerCase();
            const bucket = entityType === "student" ? "student"
                : entityType === "unknown" ? "other"
                    : "staff";
            if (wanted !== bucket) continue;
        }

        filtered.push({
            id: tx.id,
            created_at: pgToIso(tx.createdAt)!,
            entity_type: entityType,
            entity_name: entityName,
            entity_code: entityCode,
            direction: dir,
            amount: pgNumber(tx.amount) ?? 0,
            balance_before: before,
            balance_after: after,
            reason,
            reference_ticket: refTicket,
            adjusted_by: creatorName,
        });
    }

    // Aggregates are computed over the FULL filtered set, not just the page
    // being returned — the summary badges (net/credit/debit totals) must
    // reflect everything matching the filters, same reasoning as
    // cardholder_service.ts's counts/studentStats being independent of
    // whichever page happens to be showing.
    const total = filtered.length;
    const creditTotal = filtered.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0);
    const debitTotal = filtered.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0);
    const offset = (args.page - 1) * args.pageSize;
    const items = filtered.slice(offset, offset + args.pageSize);

    return {
        items,
        total,
        credit_total: creditTotal,
        debit_total: debitTotal,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
}

// ── Transfer report ────────────────────────────────────────────────────────

export interface TransferReportRow {
    id: number;
    created_at: string;
    from_name: string;
    from_code: string;
    to_name: string;
    to_code: string;
    amount: number;
    note: string | null;
    transferred_by: string;
}

export interface TransferReportResponseDTO {
    items: TransferReportRow[];
    total: number;
    page: number;
    pages: number;
}

async function resolveWalletNameCode(walletId: number | null): Promise<{ name: string; code: string }> {
    if (!walletId) return { name: "—", code: "—" };
    const wRows = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
    const w = wRows[0];
    if (!w) return { name: "—", code: "—" };
    if (w.customerId !== null) {
        const cr = await db.select().from(customers).where(eq(customers.id, w.customerId)).limit(1);
        if (cr[0]) return { name: cr[0].name, code: cr[0].studentCode ?? cr[0].customerCode };
    }
    if (w.userId !== null) {
        const ur = await db.select().from(users).where(eq(users.id, w.userId)).limit(1);
        if (ur[0]) return { name: ur[0].fullName || ur[0].username, code: ur[0].username };
    }
    if (w.departmentId !== null) {
        const dr = await db.select().from(departments).where(eq(departments.id, w.departmentId)).limit(1);
        if (dr[0]) return { name: dr[0].departmentName, code: dr[0].departmentCode };
    }
    return { name: "—", code: "—" };
}

export async function transferReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    page: number;
    pageSize: number;
}): Promise<TransferReportResponseDTO> {
    // transferWithinFamily() writes two legs per transfer (DEDUCTION on the
    // source wallet, TOPUP on the destination) sharing referenceType
    // 'family_transfer'. Filtering to just the DEDUCTION leg gives exactly
    // one row per transfer with the correct from→to direction — the TOPUP
    // leg's walletId/referenceId are the same pair reversed, so including
    // both would double-count every transfer and show half of them backwards.
    const conds = [
        eq(walletTransactions.referenceType, "family_transfer"),
        eq(walletTransactions.transactionType, "DEDUCTION"),
    ];
    if (args.dateFrom) conds.push(gte(walletTransactions.createdAt, args.dateFrom));
    if (args.dateTo) {
        const end = new Date(`${args.dateTo}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        conds.push(lt(walletTransactions.createdAt, end.toISOString()));
    }
    // total
    const totalRows = await db.select({ id: walletTransactions.id }).from(walletTransactions).where(and(...conds));
    const total = totalRows.length;

    const rows = await db
        .select()
        .from(walletTransactions)
        .where(and(...conds))
        .orderBy(desc(walletTransactions.createdAt))
        .offset((args.page - 1) * args.pageSize)
        .limit(args.pageSize);

    const items: TransferReportRow[] = [];
    for (const tx of rows) {
        const from = await resolveWalletNameCode(tx.walletId);
        const to = await resolveWalletNameCode(tx.referenceId);
        let note: string | null = null;
        if (tx.description && tx.description.includes(" — ")) {
            const parts = tx.description.split(" — ");
            note = parts[1]?.trim() || null;
        }
        let by = "—";
        if (tx.createdBy) {
            const ur = await db.select({ fullName: users.fullName, username: users.username }).from(users).where(eq(users.id, tx.createdBy)).limit(1);
            if (ur[0]) by = ur[0].fullName || ur[0].username;
        }
        items.push({
            id: tx.id,
            created_at: pgToIso(tx.createdAt)!,
            from_name: from.name,
            from_code: from.code,
            to_name: to.name,
            to_code: to.code,
            amount: pgNumber(tx.amount) ?? 0,
            note,
            transferred_by: by,
        });
    }

    return {
        items,
        total,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
}

// ── Top-up report ──────────────────────────────────────────────────────────

export type TopupChannel = "kiosk" | "online" | "cashier";

export interface TopupReportRow {
    id: number;
    created_at: string;
    channel: TopupChannel;
    topped_by: string;
    recipient_name: string;
    recipient_code: string;
    amount: number;
    // Cashier's name for a Store top-up (with the shop name in parens);
    // the kiosk device's own label for a Kiosk top-up; null for Online.
    cashier_name: string | null;
    payment_method: string | null;
}

export interface TopupReportResponseDTO {
    items: TopupReportRow[];
    total: number;
    amount_total: number;
}

function classifyTopupChannel(opts: {
    transactionType: string;
    reason: string | null;
    description: string | null;
    creatorRole: string | null;
}): TopupChannel {
    const text = `${opts.reason ?? ""} ${opts.description ?? ""}`;
    const role = (opts.creatorRole ?? "").toLowerCase();
    if (role === "kiosk" || /kiosk\s*top-?up/i.test(text)) return "kiosk";
    if (role === "parent") return "online";
    if (opts.transactionType === "ADJUSTMENT" && /^Cash top-up at POS/i.test(opts.reason ?? "")) {
        return "cashier";
    }
    if (["cashier", "manager", "admin", "staff", "kitchen"].includes(role)) return "cashier";
    // Gateway TOPUP without a parent role — treat as online (parent portal / card).
    if (opts.transactionType === "TOPUP") return "online";
    return "cashier";
}

function kioskDisplayName(reason: string | null, creatorName: string): string {
    const m = /Kiosk top-up(?: via \w+)? @ ([^(]+)/i.exec(reason ?? "");
    if (m) return `Kiosk (${m[1].trim()})`;
    if (/kiosk/i.test(creatorName)) return creatorName;
    return creatorName || "Kiosk";
}

/**
 * Money-in top-ups only:
 *  - Cash (kiosk / store cashier): ADJUSTMENT with reason "Cash top-up at POS..."
 *  - Online / QR: TOPUP linked to a confirmed wallet_topup payment_intent
 * Excludes transfers, admin balance sync, and POS-sale intents.
 */
export async function topupReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    channel?: string | null;
    // Who actually topped up — matched against acting_user_id/acting_customer_id
    // (the RFID-scanned kiosk identity) and, for a user, also against
    // wallet_transactions.created_by (cash) / payment_intents.created_by
    // (gateway) — the same identities toppedBy itself falls back to below.
    toppedByUserId?: number | null;
    toppedByCustomerId?: number | null;
    // Who received the money — the topped-up wallet's owner.
    recipientUserId?: number | null;
    recipientCustomerId?: number | null;
}): Promise<TopupReportResponseDTO> {
    const dateFrom = args.dateFrom?.trim() || null;
    let dateToExclusive: string | null = null;
    if (args.dateTo) {
        const end = new Date(`${args.dateTo}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        dateToExclusive = end.toISOString();
    }

    const cashConds = [
        eq(walletTransactions.transactionType, "ADJUSTMENT"),
        isNull(wallets.departmentId),
        sql`${walletTransactions.reason} LIKE 'Cash top-up at POS%'`,
    ];
    if (dateFrom) cashConds.push(gte(walletTransactions.createdAt, dateFrom));
    if (dateToExclusive) cashConds.push(lt(walletTransactions.createdAt, dateToExclusive));
    if (args.recipientUserId != null) cashConds.push(eq(wallets.userId, args.recipientUserId));
    if (args.recipientCustomerId != null) cashConds.push(eq(wallets.customerId, args.recipientCustomerId));
    if (args.toppedByCustomerId != null) cashConds.push(eq(walletTransactions.actingCustomerId, args.toppedByCustomerId));
    if (args.toppedByUserId != null) {
        cashConds.push(or(
            eq(walletTransactions.actingUserId, args.toppedByUserId),
            eq(walletTransactions.createdBy, args.toppedByUserId),
        )!);
    }

    const cashRows = await db
        .select({
            tx: walletTransactions,
            w: wallets,
            creator: users,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
        .innerJoin(users, eq(users.id, walletTransactions.createdBy))
        .where(and(...cashConds))
        .orderBy(desc(walletTransactions.createdAt));

    const gatewayConds = [
        eq(walletTransactions.transactionType, "TOPUP"),
        eq(walletTransactions.referenceType, "payment_intent"),
        isNull(wallets.departmentId),
        or(isNull(paymentIntents.intentType), eq(paymentIntents.intentType, "wallet_topup")),
        eq(paymentIntents.status, "confirmed"),
    ];
    if (dateFrom) gatewayConds.push(gte(walletTransactions.createdAt, dateFrom));
    if (dateToExclusive) gatewayConds.push(lt(walletTransactions.createdAt, dateToExclusive));
    if (args.recipientUserId != null) gatewayConds.push(eq(wallets.userId, args.recipientUserId));
    if (args.recipientCustomerId != null) gatewayConds.push(eq(wallets.customerId, args.recipientCustomerId));
    if (args.toppedByCustomerId != null) gatewayConds.push(eq(walletTransactions.actingCustomerId, args.toppedByCustomerId));
    if (args.toppedByUserId != null) {
        gatewayConds.push(or(
            eq(walletTransactions.actingUserId, args.toppedByUserId),
            eq(paymentIntents.createdBy, args.toppedByUserId),
        )!);
    }

    const gatewayRows = await db
        .select({
            tx: walletTransactions,
            w: wallets,
            pi: paymentIntents,
            intentCreator: users,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
        .innerJoin(paymentIntents, eq(paymentIntents.id, walletTransactions.referenceId))
        .leftJoin(users, eq(users.id, paymentIntents.createdBy))
        .where(and(...gatewayConds))
        .orderBy(desc(walletTransactions.createdAt));

    // Fallback creators for intents with null created_by
    const missingCreatorTxIds = gatewayRows
        .filter((r) => !r.intentCreator)
        .map((r) => r.tx.createdBy);
    const fallbackCreators = missingCreatorTxIds.length
        ? await db.select().from(users).where(inArray(users.id, [...new Set(missingCreatorTxIds)]))
        : [];
    const fallbackById = new Map(fallbackCreators.map((u) => [u.id, u] as const));

    type Raw = {
        tx: typeof walletTransactions.$inferSelect;
        w: typeof wallets.$inferSelect;
        creator: typeof users.$inferSelect | null;
        paymentMethod: string | null;
    };
    const combined: Raw[] = [
        ...cashRows.map((r) => ({ tx: r.tx, w: r.w, creator: r.creator, paymentMethod: "cash" as string | null })),
        ...gatewayRows.map((r) => ({
            tx: r.tx,
            w: r.w,
            creator: r.intentCreator ?? fallbackById.get(r.tx.createdBy) ?? null,
            paymentMethod: r.pi.paymentMethod ?? null,
        })),
    ];
    combined.sort((a, b) => String(b.tx.createdAt).localeCompare(String(a.tx.createdAt)));

    // Includes both wallet-recipient customer ids AND acting_customer_id
    // values (a student scanning their own card) so both lookups share one
    // batch fetch / customerById map below.
    const customerIds = [...new Set([
        ...combined.filter((r) => r.w.customerId != null).map((r) => r.w.customerId!),
        ...combined.filter((r) => r.tx.actingCustomerId != null).map((r) => r.tx.actingCustomerId!),
    ])];
    const ownerUserIds = [...new Set(combined.filter((r) => r.w.userId != null).map((r) => r.w.userId!))];
    const [customerRows, ownerUserRows] = await Promise.all([
        customerIds.length
            ? db.select().from(customers).where(inArray(customers.id, customerIds))
            : Promise.resolve([]),
        ownerUserIds.length
            ? db.select().from(users).where(inArray(users.id, ownerUserIds))
            : Promise.resolve([]),
    ]);
    const customerById = new Map(customerRows.map((c) => [c.id, c] as const));
    const ownerById = new Map(ownerUserRows.map((u) => [u.id, u] as const));

    // RFID-scanned parent/staff at a kiosk, if recorded (see cashierTopup()'s
    // actingUserId) — lets a Kiosk top-up show the real person who tapped
    // their card instead of the kiosk device's own label.
    const actingUserIds = [...new Set(combined.filter((r) => r.tx.actingUserId != null).map((r) => r.tx.actingUserId!))];
    const actingUserRows = actingUserIds.length
        ? await db.select().from(users).where(inArray(users.id, actingUserIds))
        : [];
    const actingUserById = new Map(actingUserRows.map((u) => [u.id, u] as const));

    // The Store name for a Cashier-channel top-up, resolved from the
    // creator's own shop_id (cashier accounts are pinned to one shop) —
    // not from the transaction itself, which carries no shop_id column.
    const creatorShopIds = [...new Set(
        combined.filter((r) => r.creator?.shopId != null).map((r) => r.creator!.shopId!),
    )];
    const shopRows = creatorShopIds.length
        ? await db.select({ id: shops.id, name: shops.name }).from(shops).where(inArray(shops.id, creatorShopIds))
        : [];
    const shopNameById = new Map(shopRows.map((s) => [s.id, s.name] as const));

    const channelFilter = (args.channel ?? "all").toLowerCase();
    const items: TopupReportRow[] = [];
    for (const r of combined) {
        const creatorName = r.creator
            ? (r.creator.fullName || r.creator.username)
            : String(r.tx.createdBy);
        const creatorRole = r.creator?.role ?? null;
        const channel = classifyTopupChannel({
            transactionType: r.tx.transactionType,
            reason: r.tx.reason,
            description: r.tx.description,
            creatorRole,
        });
        if (channelFilter !== "all" && channel !== channelFilter) continue;

        let recipientName = "—";
        let recipientCode = "—";
        if (r.w.customerId != null) {
            const c = customerById.get(r.w.customerId);
            if (c) {
                recipientName = c.name;
                recipientCode = c.studentCode ?? c.customerCode;
            }
        } else if (r.w.userId != null) {
            const u = ownerById.get(r.w.userId);
            if (u) {
                recipientName = u.fullName || u.username;
                recipientCode = u.username;
            }
        }

        // Prefer parent/cashier name as "who topped up". For kiosk machines,
        // acting_user_id/acting_customer_id (the RFID-scanned card owner) is
        // the real answer when present; older rows predating those columns
        // fall back to the kiosk device's own label, or the wallet owner's
        // name for a parent topping up their own wallet.
        let toppedBy = creatorName;
        if (channel === "kiosk") {
            const actingUser = r.tx.actingUserId != null ? actingUserById.get(r.tx.actingUserId) : null;
            const actingCustomer = r.tx.actingCustomerId != null ? customerById.get(r.tx.actingCustomerId) : null;
            if (actingUser) {
                toppedBy = actingUser.fullName || actingUser.username;
            } else if (actingCustomer) {
                toppedBy = actingCustomer.name;
            } else {
                toppedBy = kioskDisplayName(r.tx.reason, creatorName);
                if (r.w.userId != null && recipientName !== "—") {
                    toppedBy = recipientName;
                }
            }
        }

        // Cashier channel: cashier's name plus which Store they're at.
        // Kiosk channel: the device's own label (already computed above as
        // the kiosk service account's name when no acting person was found —
        // reusing creatorName here since that's always the physical device).
        let sourceName: string | null = null;
        if (channel === "cashier") {
            const shopName = r.creator?.shopId != null ? shopNameById.get(r.creator.shopId) : null;
            sourceName = shopName ? `${creatorName} (${shopName})` : creatorName;
        } else if (channel === "kiosk") {
            sourceName = creatorName;
        }

        items.push({
            id: r.tx.id,
            created_at: pgToIso(r.tx.createdAt)!,
            channel,
            topped_by: toppedBy,
            recipient_name: recipientName,
            recipient_code: recipientCode,
            amount: pgNumber(r.tx.amount) ?? 0,
            cashier_name: sourceName,
            payment_method: r.paymentMethod,
        });
    }

    const amountTotal = items.reduce((s, r) => s + r.amount, 0);
    return { items, total: items.length, amount_total: amountTotal };
}

// ── Transaction (POS spending) report ──────────────────────────────────────

export interface TransactionReportRow {
    /** Only unique WITHIN a kind — a sale row and a topup row can share the
     * same numeric id (they come from different source tables). The
     * frontend keys rows by `${kind}-${id}`. */
    id: number;
    kind: "sale" | "adjustment" | "topup" | "transfer" | "other";
    created_at: string;
    payer_id: string;
    payer_name: string;
    payment_method: string;
    shop_name: string;
    amount: number;
    cashier_name: string;
    receipt_number: string | null;
    status: string;
}

export interface TransactionReportResponseDTO {
    items: TransactionReportRow[];
    total: number;
    /** Sum of ACTIVE POS-sale amounts only (not a sum across every kind —
     * mixing sale/topup/adjustment/transfer inflows and outflows into one
     * number would have no coherent business meaning). */
    amount_total: number;
    page: number;
    pages: number;
}

const CASH_TOPUP_REASON_RE = /^Cash top-up at POS/i;

/** Every kind of wallet-affecting event this report can show. `sale` covers
 * both a POS sale and its later void/refund (see wallet_service.ts's own
 * 'receipt' / 'receipt_void' distinction). */
function classifyWalletTxKind(tx: {
    transactionType: string;
    referenceType: string | null;
    reason: string | null;
}): "adjustment" | "topup" | "transfer" | "other" {
    if (tx.referenceType === "family_transfer") return "transfer";
    if (tx.referenceType === "payment_intent") return "topup";
    // adjustBalance() always tags reference_type='admin_adjustment' — this
    // covers both a genuine manual balance correction AND a cash top-up at
    // POS (distinguished only by `reason`). A separate revert/undo path
    // reuses the same reference_type but with TOPUP/DEDUCTION transaction
    // types instead of ADJUSTMENT, so check reference_type first, not type.
    if (tx.referenceType === "admin_adjustment" || tx.transactionType === "ADJUSTMENT") {
        return CASH_TOPUP_REASON_RE.test(tx.reason ?? "") ? "topup" : "adjustment";
    }
    return "other";
}

export async function transactionReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    /** Free-text search over the payer's id/username/full name — spans
     * whichever entity actually paid (student customer, parent/staff user,
     * or department). */
    search?: string | null;
    cashierId?: number | null;
    /** Restricts createdBy to users of this role (e.g. "kiosk") — ignored
     * whenever cashierId is set (a specific device always wins over the
     * role-wide view). Powers the Kiosk Report's "All kiosks" option. */
    cashierRole?: string | null;
    /** ACTIVE | VOIDED — omitted keeps the existing "both" default. Only
     * meaningful for `kind: "sale"` rows — every other kind is never voided. */
    status?: string | null;
    /** Only ever matches `kind: "sale"` rows (via receipts.payment_method) or
     * cash top-ups (derived payment_method "CASH") — every other kind has no
     * payment-method concept and is excluded whenever this is set. */
    paymentMethod?: string | null;
    /** Only ever matches `kind: "sale"` rows or cash top-ups (via the
     * cashier's own shop) — every other kind has no shop concept. */
    shopId?: string | null;
    /** all | sale | adjustment | topup | transfer — omitted/"all" shows
     * everything. */
    type?: string | null;
    page: number;
    pageSize: number;
}): Promise<TransactionReportResponseDTO> {
    const dateFrom = args.dateFrom?.trim() || null;
    const dateTo = args.dateTo?.trim() || null;

    // receipts.transaction_date is timestamptz — include full calendar days.
    const typeFilter = (args.type ?? "all").trim().toLowerCase();
    const includeSale = typeFilter === "all" || typeFilter === "sale";
    // None of adjustment/topup/transfer are ever voided — a VOIDED-only
    // filter can only ever match sale rows, so skip the second query outright.
    const includeOther = args.status !== "VOIDED"
        && (typeFilter === "all" || typeFilter === "adjustment" || typeFilter === "topup" || typeFilter === "transfer");

    // ── Sale rows (POS receipts) — unchanged from before this rewrite ──────
    const saleConds = [sql`${receipts.status} IN ('ACTIVE', 'VOIDED')`];
    if (dateFrom) saleConds.push(sql`${receipts.transactionDate} >= ${dateFrom}::date`);
    if (dateTo) saleConds.push(sql`${receipts.transactionDate} < (${dateTo}::date + interval '1 day')`);
    if (args.status) saleConds.push(eq(receipts.status, args.status as "ACTIVE" | "VOIDED"));
    if (args.paymentMethod) saleConds.push(eq(receipts.paymentMethod, args.paymentMethod as typeof receipts.$inferSelect["paymentMethod"]));
    if (args.shopId) saleConds.push(eq(receipts.shopId, args.shopId));
    if (args.cashierId != null) {
        saleConds.push(eq(receipts.createdBy, args.cashierId));
    } else if (args.cashierRole) {
        saleConds.push(inArray(receipts.createdBy, db.select({ id: users.id }).from(users).where(eq(users.role, args.cashierRole))));
    }
    const search = args.search?.trim();
    if (search) {
        const pat = `%${search}%`;
        saleConds.push(or(
            ilike(customers.name, pat),
            ilike(customers.studentCode, pat),
            ilike(customers.customerCode, pat),
            ilike(customers.externalId, pat),
            ilike(users.fullName, pat),
            ilike(users.username, pat),
            ilike(users.externalId, pat),
            ilike(departments.departmentName, pat),
            ilike(departments.departmentCode, pat),
        )!);
    }

    const saleRows = includeSale ? await db
        .select({
            id: receipts.id,
            transactionDate: receipts.transactionDate,
            paymentMethod: receipts.paymentMethod,
            total: receipts.total,
            receiptNumber: receipts.receiptNumber,
            status: receipts.status,
            createdBy: receipts.createdBy,
            shopName: shops.name,
            customerName: customers.name,
            studentCode: customers.studentCode,
            customerCode: customers.customerCode,
            payerFullName: users.fullName,
            payerUsername: users.username,
            departmentName: departments.departmentName,
            departmentCode: departments.departmentCode,
        })
        .from(receipts)
        .leftJoin(shops, eq(shops.id, receipts.shopId))
        .leftJoin(customers, eq(customers.id, receipts.customerId))
        .leftJoin(users, eq(users.id, receipts.payerUserId))
        .leftJoin(departments, eq(departments.id, receipts.payerDepartmentId))
        .where(and(...saleConds))
        .orderBy(desc(receipts.transactionDate), desc(receipts.id)) : [];

    // Sale amount_total keeps its original, narrow meaning (ACTIVE sales
    // only) regardless of the `type`/other filters below — it's computed
    // from this same saleRows fetch, before any pagination slicing.
    const amountTotal = saleRows
        .filter((r) => r.status === "ACTIVE")
        .reduce((s, r) => s + (pgNumber(r.total) ?? 0), 0);

    const saleItems: (TransactionReportRow & { _createdBy: number | null })[] = saleRows.map((r) => {
        const payerName = r.customerName
            ?? r.payerFullName
            ?? r.payerUsername
            ?? r.departmentName
            ?? "—";
        const payerId = r.studentCode
            ?? r.customerCode
            ?? r.payerUsername
            ?? r.departmentCode
            ?? "—";
        return {
            id: r.id,
            kind: "sale" as const,
            created_at: String(r.transactionDate),
            payer_id: payerId,
            payer_name: payerName,
            payment_method: String(r.paymentMethod ?? ""),
            shop_name: r.shopName ?? "—",
            amount: pgNumber(r.total) ?? 0,
            cashier_name: "—", // filled in below once cashier names are batch-resolved
            receipt_number: r.receiptNumber,
            status: String(r.status ?? ""),
            _createdBy: r.createdBy,
        } as TransactionReportRow & { _createdBy: number | null };
    });

    // ── Every other kind (adjustment / cash+gateway top-up / transfer) ──────
    // Sourced directly from wallet_transactions — none of it lives in
    // receipts, so it was invisible to this report before this rewrite.
    let otherItems: (TransactionReportRow & { _createdBy: number | null })[] = [];
    if (includeOther) {
        const otherConds = [sql`(${walletTransactions.referenceType} IS NULL OR ${walletTransactions.referenceType} NOT IN ('receipt', 'receipt_void'))`];
        if (dateFrom) otherConds.push(sql`${walletTransactions.createdAt} >= ${dateFrom}::date`);
        if (dateTo) otherConds.push(sql`${walletTransactions.createdAt} < (${dateTo}::date + interval '1 day')`);
        if (args.cashierId != null) {
            otherConds.push(eq(walletTransactions.createdBy, args.cashierId));
        } else if (args.cashierRole) {
            otherConds.push(inArray(walletTransactions.createdBy, db.select({ id: users.id }).from(users).where(eq(users.role, args.cashierRole))));
        }
        if (search) {
            const pat = `%${search}%`;
            otherConds.push(or(
                ilike(customers.name, pat),
                ilike(customers.studentCode, pat),
                ilike(customers.customerCode, pat),
                ilike(customers.externalId, pat),
                ilike(users.fullName, pat),
                ilike(users.username, pat),
                ilike(users.externalId, pat),
                ilike(departments.departmentName, pat),
                ilike(departments.departmentCode, pat),
            )!);
        }

        const otherRows = await db
            .select({
                id: walletTransactions.id,
                createdAt: walletTransactions.createdAt,
                transactionType: walletTransactions.transactionType,
                referenceType: walletTransactions.referenceType,
                reason: walletTransactions.reason,
                balanceBefore: walletTransactions.balanceBefore,
                balanceAfter: walletTransactions.balanceAfter,
                createdBy: walletTransactions.createdBy,
                referenceId: walletTransactions.referenceId,
                walletCustomerId: wallets.customerId,
                walletUserId: wallets.userId,
                walletDepartmentId: wallets.departmentId,
                customerName: customers.name,
                studentCode: customers.studentCode,
                customerCode: customers.customerCode,
                payerFullName: users.fullName,
                payerUsername: users.username,
                departmentName: departments.departmentName,
                departmentCode: departments.departmentCode,
            })
            .from(walletTransactions)
            .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
            .leftJoin(customers, eq(customers.id, wallets.customerId))
            .leftJoin(users, eq(users.id, wallets.userId))
            .leftJoin(departments, eq(departments.id, wallets.departmentId))
            .where(and(...otherConds))
            .orderBy(desc(walletTransactions.createdAt));

        // Cash top-ups have no shop_id of their own — resolve the creator's
        // own shop, same technique topupReport() uses for its Cashier channel.
        const creatorIds = [...new Set(otherRows.map((r) => r.createdBy))];
        const creatorRows = creatorIds.length
            ? await db.select({ id: users.id, shopId: users.shopId }).from(users).where(inArray(users.id, creatorIds))
            : [];
        const creatorShopIdByUser = new Map(creatorRows.map((u) => [u.id, u.shopId] as const));
        const shopIds = [...new Set(creatorRows.map((u) => u.shopId).filter((s): s is string => !!s))];
        const shopRows = shopIds.length
            ? await db.select({ id: shops.id, name: shops.name }).from(shops).where(inArray(shops.id, shopIds))
            : [];
        const shopNameById = new Map(shopRows.map((s) => [s.id, s.name] as const));

        // Gateway (online/parent) top-ups carry their own payment_method on
        // the payment_intent they're linked to.
        const intentIds = otherRows
            .filter((r) => r.referenceType === "payment_intent" && r.referenceId !== null)
            .map((r) => r.referenceId!) as number[];
        const intentRows = intentIds.length
            ? await db.select({ id: paymentIntents.id, paymentMethod: paymentIntents.paymentMethod }).from(paymentIntents).where(inArray(paymentIntents.id, intentIds))
            : [];
        const intentMethodById = new Map(intentRows.map((p) => [p.id, p.paymentMethod] as const));

        otherItems = otherRows.map((r) => {
            const kind = classifyWalletTxKind({ transactionType: r.transactionType, referenceType: r.referenceType, reason: r.reason });
            const payerName = r.customerName ?? r.payerFullName ?? r.payerUsername ?? r.departmentName ?? "—";
            const payerId = r.studentCode ?? r.customerCode ?? r.payerUsername ?? r.departmentCode ?? "—";
            const creatorShopId = creatorShopIdByUser.get(r.createdBy) ?? null;
            const shopName = kind === "topup" && r.referenceType !== "payment_intent"
                ? (creatorShopId ? shopNameById.get(creatorShopId) ?? "—" : "—")
                : "—";
            const paymentMethod = kind === "topup"
                ? (r.referenceType === "payment_intent" ? (intentMethodById.get(r.referenceId ?? -1) ?? "") : "CASH")
                : "";
            const amount = Math.abs((pgNumber(r.balanceAfter) ?? 0) - (pgNumber(r.balanceBefore) ?? 0));
            return {
                id: r.id,
                kind,
                created_at: String(r.createdAt),
                payer_id: payerId,
                payer_name: payerName,
                payment_method: paymentMethod,
                shop_name: shopName,
                amount,
                cashier_name: "—",
                receipt_number: null,
                status: "ACTIVE",
                _createdBy: r.createdBy,
            };
        });

        // shopId/paymentMethod filters only ever match sale rows or cash
        // top-ups (see the doc comment on transactionReport's args) — every
        // other kind is excluded whenever either filter is active.
        if (args.shopId) {
            otherItems = otherItems.filter((r) => {
                if (r.kind !== "topup" || r._createdBy == null) return false;
                return creatorShopIdByUser.get(r._createdBy) === args.shopId;
            });
        }
        if (args.paymentMethod) {
            otherItems = otherItems.filter((r) => r.payment_method === args.paymentMethod);
        }
        if (typeFilter !== "all") {
            otherItems = otherItems.filter((r) => r.kind === typeFilter);
        }
    }

    // ── Merge, resolve cashier names once for the combined set, sort, paginate ──
    const merged = [...saleItems, ...otherItems];
    const cashierIds = [...new Set(merged.map((r) => r._createdBy).filter((id): id is number => id != null))];
    const cashierRows = cashierIds.length
        ? await db.select({ id: users.id, fullName: users.fullName, username: users.username }).from(users).where(inArray(users.id, cashierIds))
        : [];
    const cashierById = new Map(cashierRows.map((u) => [u.id, u] as const));
    merged.forEach((r) => {
        const cashier = r._createdBy != null ? cashierById.get(r._createdBy) : undefined;
        r.cashier_name = cashier ? (cashier.fullName || cashier.username) : "—";
    });
    merged.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const total = merged.length;
    const offset = (args.page - 1) * args.pageSize;
    const items: TransactionReportRow[] = merged
        .slice(offset, offset + args.pageSize)
        .map(({ _createdBy, ...rest }) => rest);

    return {
        items,
        total,
        amount_total: amountTotal,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
}

// ── Kiosk event-log report ──────────────────────────────────────────────────
// Reads kiosk_logs (uploaded best-effort by the kiosk app — see
// kiosk_service.ts::ingestKioskLogs). Every filter here is a plain column,
// so this uses true SQL-level pagination (unlike transactionReport above).

export interface KioskLogReportRow {
    id: number;
    kiosk_user_id: number;
    kiosk_name: string;
    ts: string;
    level: string;
    category: string;
    message: string;
    data: unknown;
}

export interface KioskLogReportResponseDTO {
    items: KioskLogReportRow[];
    total: number;
    page: number;
    pages: number;
}

export async function kioskLogReport(args: {
    kioskUserId?: number | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    level?: string | null;
    category?: string | null;
    page: number;
    pageSize: number;
}): Promise<KioskLogReportResponseDTO> {
    const dateFrom = args.dateFrom?.trim() || null;
    const dateTo = args.dateTo?.trim() || null;

    const conds = [];
    if (args.kioskUserId != null) conds.push(eq(kioskLogs.kioskUserId, args.kioskUserId));
    if (dateFrom) conds.push(sql`${kioskLogs.ts} >= ${dateFrom}::date`);
    if (dateTo) conds.push(sql`${kioskLogs.ts} < (${dateTo}::date + interval '1 day')`);
    if (args.level) conds.push(eq(kioskLogs.level, args.level));
    if (args.category) conds.push(eq(kioskLogs.category, args.category));

    const where = conds.length > 0 ? and(...conds) : undefined;

    const totalRows = await db.select({ id: kioskLogs.id }).from(kioskLogs).where(where);
    const total = totalRows.length;

    const rows = await db
        .select({
            id: kioskLogs.id,
            kioskUserId: kioskLogs.kioskUserId,
            ts: kioskLogs.ts,
            level: kioskLogs.level,
            category: kioskLogs.category,
            message: kioskLogs.message,
            data: kioskLogs.data,
            kioskFullName: users.fullName,
            kioskUsername: users.username,
        })
        .from(kioskLogs)
        .leftJoin(users, eq(users.id, kioskLogs.kioskUserId))
        .where(where)
        .orderBy(desc(kioskLogs.ts))
        .offset((args.page - 1) * args.pageSize)
        .limit(args.pageSize);

    const items: KioskLogReportRow[] = rows.map((r) => ({
        id: r.id,
        kiosk_user_id: r.kioskUserId,
        kiosk_name: r.kioskFullName || r.kioskUsername || String(r.kioskUserId),
        ts: String(r.ts),
        level: r.level,
        category: r.category,
        message: r.message,
        data: r.data,
    }));

    return {
        items,
        total,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
}

