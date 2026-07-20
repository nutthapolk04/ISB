/**
 * Admin reports — mirrors /admin/adjustment-report + /admin/transfer-report
 * in FastAPI app/api/v1/wallets.py.
 */
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
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

    const customerIds = [...new Set(combined.filter((r) => r.w.customerId != null).map((r) => r.w.customerId!))];
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

        // Prefer parent/cashier name as "who topped up". For kiosk machines the
        // RFID parent is not stored on the transaction — show kiosk label and
        // keep recipient separate so admins can still see who was credited.
        let toppedBy = creatorName;
        if (channel === "kiosk") {
            toppedBy = kioskDisplayName(r.tx.reason, creatorName);
            // When the wallet belongs to a parent/staff user, that person is the
            // practical "who topped up" at the kiosk (own wallet). Child wallets
            // stay as kiosk label until acting_user_id is recorded.
            if (r.w.userId != null && recipientName !== "—") {
                toppedBy = recipientName;
            }
        }

        items.push({
            id: r.tx.id,
            created_at: pgToIso(r.tx.createdAt)!,
            channel,
            topped_by: toppedBy,
            recipient_name: recipientName,
            recipient_code: recipientCode,
            amount: pgNumber(r.tx.amount) ?? 0,
            cashier_name: channel === "cashier" ? creatorName : null,
            payment_method: r.paymentMethod,
        });
    }

    const amountTotal = items.reduce((s, r) => s + r.amount, 0);
    return { items, total: items.length, amount_total: amountTotal };
}

// ── Transaction (POS spending) report ──────────────────────────────────────

export interface TransactionReportRow {
    id: number;
    created_at: string;
    payer_id: string;
    payer_name: string;
    payment_method: string;
    shop_name: string;
    amount: number;
    cashier_name: string;
    receipt_number: string;
    status: string;
}

export interface TransactionReportResponseDTO {
    items: TransactionReportRow[];
    total: number;
    amount_total: number;
}

export async function transactionReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
}): Promise<TransactionReportResponseDTO> {
    const dateFrom = args.dateFrom?.trim() || null;
    const dateTo = args.dateTo?.trim() || null;

    // receipts.transaction_date is timestamptz — include full calendar days.
    const conds = [sql`${receipts.status} IN ('ACTIVE', 'VOIDED')`];
    if (dateFrom) conds.push(sql`${receipts.transactionDate} >= ${dateFrom}::date`);
    if (dateTo) conds.push(sql`${receipts.transactionDate} < (${dateTo}::date + interval '1 day')`);

    const rows = await db
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
        })
        .from(receipts)
        .leftJoin(shops, eq(shops.id, receipts.shopId))
        .leftJoin(customers, eq(customers.id, receipts.customerId))
        .leftJoin(users, eq(users.id, receipts.payerUserId))
        .where(and(...conds))
        .orderBy(desc(receipts.transactionDate), desc(receipts.id));

    const cashierIds = [...new Set(rows.map((r) => r.createdBy).filter((id): id is number => id != null))];
    const cashierRows = cashierIds.length
        ? await db.select({ id: users.id, fullName: users.fullName, username: users.username }).from(users).where(inArray(users.id, cashierIds))
        : [];
    const cashierById = new Map(cashierRows.map((u) => [u.id, u] as const));

    const items: TransactionReportRow[] = rows.map((r) => {
        const payerName = r.customerName
            ?? r.payerFullName
            ?? r.payerUsername
            ?? "—";
        const payerId = r.studentCode
            ?? r.customerCode
            ?? r.payerUsername
            ?? "—";
        const cashier = r.createdBy != null ? cashierById.get(r.createdBy) : undefined;
        return {
            id: r.id,
            created_at: String(r.transactionDate),
            payer_id: payerId,
            payer_name: payerName,
            payment_method: String(r.paymentMethod ?? ""),
            shop_name: r.shopName ?? "—",
            amount: pgNumber(r.total) ?? 0,
            cashier_name: cashier ? (cashier.fullName || cashier.username) : "—",
            receipt_number: r.receiptNumber,
            status: String(r.status ?? ""),
        };
    });

    const amountTotal = items
        .filter((r) => r.status === "ACTIVE")
        .reduce((s, r) => s + r.amount, 0);

    return { items, total: items.length, amount_total: amountTotal };
}

