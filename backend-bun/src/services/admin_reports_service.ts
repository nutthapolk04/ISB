/**
 * Admin reports — mirrors /admin/adjustment-report + /admin/transfer-report
 * in FastAPI app/api/v1/wallets.py.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
    emailAlertsLog,
    parentChildLinks,
} from "@/db/schema";
import { pgNumber, pgToIso, bangkokRangeStart, bangkokRangeEndExclusive } from "@/lib/dates";
import { compareDateTime, parseSortOrder } from "@/lib/sort_order";
import { resolvePaymentMethodLabelKey } from "@/lib/payment_method_labels";
import { classifyWalletTxKind, classifyTopupChannel, type TopupChannel } from "@/services/wallet_tx_classify";
import { moduleShopIds } from "@/services/report_service";

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
    sortOrder?: string | null;
    page: number;
    pageSize: number;
}): Promise<AdjustmentReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const conds = [eq(walletTransactions.transactionType, "ADJUSTMENT"), isNull(wallets.departmentId)];
    if (args.dateFrom) {
        try { conds.push(gte(walletTransactions.createdAt, bangkokRangeStart(args.dateFrom))); }
        catch { /* ignore */ }
    }
    if (args.dateTo) {
        try {
            conds.push(lt(walletTransactions.createdAt, bangkokRangeEndExclusive(args.dateTo)));
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
            // entityType for a user-owned wallet is users.role verbatim
            // ("parent", "staff", "teacher", "visitor", ...) — each role gets
            // its own bucket instead of bundling them all under "staff".
            const bucket = entityType === "unknown" ? "other" : entityType;
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
    filtered.sort((a, b) => compareDateTime(a.created_at, b.created_at, sortOrder, a.id, b.id));

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

export async function transferReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    q?: string | null;
    amountMin?: number | null;
    amountMax?: number | null;
    sortOrder?: string | null;
    page: number;
    pageSize: number;
}): Promise<TransferReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
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
    if (args.dateFrom) conds.push(gte(walletTransactions.createdAt, bangkokRangeStart(args.dateFrom)));
    if (args.dateTo) {
        conds.push(lt(walletTransactions.createdAt, bangkokRangeEndExclusive(args.dateTo)));
    }
    if (args.amountMin != null) conds.push(gte(walletTransactions.amount, String(args.amountMin)));
    if (args.amountMax != null) conds.push(lte(walletTransactions.amount, String(args.amountMax)));

    const rows = await db
        .select()
        .from(walletTransactions)
        .where(and(...conds))
        .orderBy(
            sortOrder === "asc" ? asc(walletTransactions.createdAt) : desc(walletTransactions.createdAt),
            sortOrder === "asc" ? asc(walletTransactions.id) : desc(walletTransactions.id),
        );

    // Batch-prefetch every wallet + owner (customer/user/department) this
    // result set could need, same reasoning as adjustmentReport above — one
    // SELECT per row per side (from + to + creator) would be 3N+ queries.
    const walletIds = [...new Set(rows.flatMap((r) => [r.walletId, r.referenceId]).filter((id): id is number => id !== null))];
    const walletRows = walletIds.length > 0 ? await db.select().from(wallets).where(inArray(wallets.id, walletIds)) : [];
    const walletById = new Map(walletRows.map((w) => [w.id, w] as const));

    const customerIds = [...new Set(walletRows.filter((w) => w.customerId !== null).map((w) => w.customerId!))];
    const walletUserIds = [...new Set(walletRows.filter((w) => w.userId !== null).map((w) => w.userId!))];
    const departmentIds = [...new Set(walletRows.filter((w) => w.departmentId !== null).map((w) => w.departmentId!))];
    const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
    const allUserIds = [...new Set([...walletUserIds, ...creatorIds])];

    const [customerRows, userRows, departmentRows] = await Promise.all([
        customerIds.length > 0 ? db.select().from(customers).where(inArray(customers.id, customerIds)) : Promise.resolve([]),
        allUserIds.length > 0 ? db.select().from(users).where(inArray(users.id, allUserIds)) : Promise.resolve([]),
        departmentIds.length > 0 ? db.select().from(departments).where(inArray(departments.id, departmentIds)) : Promise.resolve([]),
    ]);
    const customerById = new Map(customerRows.map((c) => [c.id, c] as const));
    const userById = new Map(userRows.map((u) => [u.id, u] as const));
    const departmentById = new Map(departmentRows.map((d) => [d.id, d] as const));

    function resolveWalletNameCode(walletId: number | null): { name: string; code: string } {
        if (walletId === null) return { name: "—", code: "—" };
        const w = walletById.get(walletId);
        if (!w) return { name: "—", code: "—" };
        if (w.customerId !== null) {
            const c = customerById.get(w.customerId);
            if (c) return { name: c.name, code: c.studentCode ?? c.customerCode };
        }
        if (w.userId !== null) {
            const u = userById.get(w.userId);
            if (u) return { name: u.fullName || u.username, code: u.username };
        }
        if (w.departmentId !== null) {
            const d = departmentById.get(w.departmentId);
            if (d) return { name: d.departmentName, code: d.departmentCode };
        }
        return { name: "—", code: "—" };
    }

    const q = args.q?.trim().toLowerCase() || null;
    const items: TransferReportRow[] = [];
    for (const tx of rows) {
        const from = resolveWalletNameCode(tx.walletId);
        const to = resolveWalletNameCode(tx.referenceId);
        let note: string | null = null;
        if (tx.description && tx.description.includes(" — ")) {
            const parts = tx.description.split(" — ");
            note = parts[1]?.trim() || null;
        }
        const creator = tx.createdBy ? userById.get(tx.createdBy) : undefined;
        const by = creator ? (creator.fullName || creator.username) : "—";

        if (q) {
            const haystack = [from.name, from.code, to.name, to.code, by, note ?? ""].join(" ").toLowerCase();
            if (!haystack.includes(q)) continue;
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

    const total = items.length;
    const offset = (args.page - 1) * args.pageSize;
    const pageItems = items.slice(offset, offset + args.pageSize);

    return {
        items: pageItems,
        total,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
}

// ── Top-up report ──────────────────────────────────────────────────────────

export interface TopupReportRow {
    id: number;
    created_at: string;
    channel: TopupChannel;
    topped_by: string;
    topped_by_external_id: string | null;
    recipient_name: string;
    recipient_code: string;
    recipient_external_id: string | null;
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
    page: number;
    pages: number;
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
    // Restricts to top-ups performed by a cashier/manager assigned to this
    // shop (matched against the creator's own users.shop_id) — used by the
    // Store-side "my shop's top-ups" report so it never leaks other shops'
    // rows. Naturally excludes kiosk/online rows too, since those creators
    // have no shop_id (see topup_service.ts's shop gating comment).
    shopId?: string | null;
    sortOrder?: string | null;
    page: number;
    pageSize: number;
}): Promise<TopupReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const dateFrom = args.dateFrom?.trim() || null;
    let dateToExclusive: string | null = null;
    if (args.dateTo) {
        dateToExclusive = bangkokRangeEndExclusive(args.dateTo.trim());
    }

    const cashConds = [
        eq(walletTransactions.transactionType, "ADJUSTMENT"),
        isNull(wallets.departmentId),
        sql`${walletTransactions.reason} LIKE 'Cash top-up at POS%'`,
    ];
    if (dateFrom) cashConds.push(gte(walletTransactions.createdAt, bangkokRangeStart(dateFrom)));
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
    if (args.shopId) cashConds.push(eq(users.shopId, args.shopId));

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
    if (dateFrom) gatewayConds.push(gte(walletTransactions.createdAt, bangkokRangeStart(dateFrom)));
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
    if (args.shopId) gatewayConds.push(eq(users.shopId, args.shopId));

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

    // Parent/guardian → linked child gateway top-ups (parent portal), keyed
    // as "parentUserId:childCustomerId". Used so staff-parent accounts (role
    // "staff", no shop_id) classify as Online instead of Cashier.
    const linkParentIds = [...new Set(
        combined.filter((r) => r.creator != null).map((r) => r.creator!.id),
    )];
    const linkChildIds = [...new Set(
        combined.filter((r) => r.w.customerId != null).map((r) => r.w.customerId!),
    )];
    const parentChildLinkSet = new Set<string>();
    if (linkParentIds.length > 0 && linkChildIds.length > 0) {
        const linkRows = await db
            .select({
                parentUserId: parentChildLinks.parentUserId,
                childCustomerId: parentChildLinks.childCustomerId,
            })
            .from(parentChildLinks)
            .where(and(
                inArray(parentChildLinks.parentUserId, linkParentIds),
                inArray(parentChildLinks.childCustomerId, linkChildIds),
            ));
        for (const l of linkRows) {
            parentChildLinkSet.add(`${l.parentUserId}:${l.childCustomerId}`);
        }
    }

    const channelFilter = (args.channel ?? "all").toLowerCase();
    const items: TopupReportRow[] = [];
    for (const r of combined) {
        const creatorName = r.creator
            ? (r.creator.fullName || r.creator.username)
            : String(r.tx.createdBy);
        const creatorRole = r.creator?.role ?? null;
        // A staff/manager/cashier topping up their OWN wallet (e.g. via "My
        // Wallet") is self-service online, not a POS/cashier event, even
        // though their role would otherwise land in the cashier bucket.
        const isSelfTopup = r.w.userId != null && r.creator != null && r.creator.id === r.w.userId;
        const isFamilyPortalTopup = r.tx.transactionType === "TOPUP"
            && r.w.customerId != null
            && r.creator != null
            && !r.creator.shopId
            && parentChildLinkSet.has(`${r.creator.id}:${r.w.customerId}`);
        const channel = classifyTopupChannel({
            transactionType: r.tx.transactionType,
            reason: r.tx.reason,
            description: r.tx.description,
            creatorRole,
            isSelfTopup,
            isFamilyPortalTopup,
        });
        if (channelFilter !== "all" && channel !== channelFilter) continue;

        let recipientName = "—";
        let recipientCode = "—";
        let recipientExternalId: string | null = null;
        if (r.w.customerId != null) {
            const c = customerById.get(r.w.customerId);
            if (c) {
                recipientName = c.name;
                recipientCode = c.studentCode ?? c.customerCode;
                recipientExternalId = c.externalId ?? null;
            }
        } else if (r.w.userId != null) {
            const u = ownerById.get(r.w.userId);
            if (u) {
                recipientName = u.fullName || u.username;
                recipientCode = u.username;
                recipientExternalId = u.externalId ?? null;
            }
        }

        // Prefer parent/cashier name as "who topped up". For kiosk machines,
        // acting_user_id/acting_customer_id (the RFID-scanned card owner) is
        // the real answer when present; older rows predating those columns
        // fall back to the kiosk device's own label, or the wallet owner's
        // name for a parent topping up their own wallet.
        let toppedBy = creatorName;
        let toppedByExternalId: string | null = r.creator?.externalId ?? null;
        if (channel === "kiosk") {
            const actingUser = r.tx.actingUserId != null ? actingUserById.get(r.tx.actingUserId) : null;
            const actingCustomer = r.tx.actingCustomerId != null ? customerById.get(r.tx.actingCustomerId) : null;
            if (actingUser) {
                toppedBy = actingUser.fullName || actingUser.username;
                toppedByExternalId = actingUser.externalId ?? null;
            } else if (actingCustomer) {
                toppedBy = actingCustomer.name;
                toppedByExternalId = actingCustomer.externalId ?? null;
            } else {
                toppedBy = kioskDisplayName(r.tx.reason, creatorName);
                toppedByExternalId = null;
                if (r.w.userId != null && recipientName !== "—") {
                    toppedBy = recipientName;
                    toppedByExternalId = recipientExternalId;
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
            topped_by_external_id: toppedByExternalId,
            recipient_name: recipientName,
            recipient_code: recipientCode,
            recipient_external_id: recipientExternalId,
            amount: pgNumber(r.tx.amount) ?? 0,
            cashier_name: sourceName,
            payment_method: r.paymentMethod,
        });
    }

    items.sort((a, b) => compareDateTime(a.created_at, b.created_at, sortOrder, a.id, b.id));

    // amount_total is computed over the FULL filtered set, before pagination
    // slicing — same reasoning as every other paginated report in this file.
    const amountTotal = items.reduce((s, r) => s + r.amount, 0);
    const total = items.length;
    const offset = (args.page - 1) * args.pageSize;
    const pageItems = items.slice(offset, offset + args.pageSize);

    return {
        items: pageItems,
        total,
        amount_total: amountTotal,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
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
    edc_card_fee?: number | null;
    edc_masked_card?: string | null;
    shop_name: string;
    amount: number;
    cashier_name: string;
    receipt_number: string | null;
    status: string;
    /** Populated for top-up rows (kiosk transaction report). */
    topped_by?: string | null;
    topped_by_external_id?: string | null;
    topped_up_to?: string | null;
    topped_up_to_external_id?: string | null;
}

export interface TransactionReportResponseDTO {
    items: TransactionReportRow[];
    total: number;
    /** Sum of Amount column across all filtered rows (top-ups, sales, etc.).
     * When type=sale, only ACTIVE POS-sale receipts are summed. */
    amount_total: number;
    /** Sum of amounts where payment method resolves to cash (kiosk report). */
    cash_total: number;
    /** Sum of amounts where payment method resolves to Thai QR (kiosk report). */
    qr_total: number;
    page: number;
    pages: number;
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
    sortOrder?: string | null;
    page: number;
    pageSize: number;
}): Promise<TransactionReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
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
    if (dateFrom) saleConds.push(gte(receipts.transactionDate, bangkokRangeStart(dateFrom)));
    if (dateTo) saleConds.push(lt(receipts.transactionDate, bangkokRangeEndExclusive(dateTo)));
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
            edcCardFee: receipts.edcCardFee,
            edcMaskedCard: receipts.edcMaskedCard,
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

    // Sale amount_total (ACTIVE sales only) — used when type=sale filter is set.
    const saleAmountTotal = saleRows
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
            created_at: pgToIso(r.transactionDate)!,
            payer_id: payerId,
            payer_name: payerName,
            payment_method: String(r.paymentMethod ?? ""),
            edc_card_fee: pgNumber(r.edcCardFee) ?? 0,
            edc_masked_card: r.edcMaskedCard ?? null,
            shop_name: r.shopName ?? "—",
            // A voided sale shows as a negative amount — same convention as
            // salesSummaryReport()/salesByPaymentReport()'s void leg.
            amount: (pgNumber(r.total) ?? 0) * (r.status === "VOIDED" ? -1 : 1),
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
        if (dateFrom) otherConds.push(gte(walletTransactions.createdAt, bangkokRangeStart(dateFrom)));
        if (dateTo) otherConds.push(lt(walletTransactions.createdAt, bangkokRangeEndExclusive(dateTo)));
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
                actingUserId: walletTransactions.actingUserId,
                actingCustomerId: walletTransactions.actingCustomerId,
                referenceId: walletTransactions.referenceId,
                walletCustomerId: wallets.customerId,
                walletUserId: wallets.userId,
                walletDepartmentId: wallets.departmentId,
                customerName: customers.name,
                studentCode: customers.studentCode,
                customerCode: customers.customerCode,
                customerExternalId: customers.externalId,
                payerFullName: users.fullName,
                payerUsername: users.username,
                walletUserExternalId: users.externalId,
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
            ? await db.select({
                id: users.id,
                shopId: users.shopId,
                fullName: users.fullName,
                username: users.username,
                externalId: users.externalId,
                role: users.role,
            }).from(users).where(inArray(users.id, creatorIds))
            : [];
        const creatorById = new Map(creatorRows.map((u) => [u.id, u] as const));
        const creatorShopIdByUser = new Map(creatorRows.map((u) => [u.id, u.shopId] as const));

        const actingUserIds = [...new Set(otherRows.filter((r) => r.actingUserId != null).map((r) => r.actingUserId!))];
        const actingCustomerIds = [...new Set(otherRows.filter((r) => r.actingCustomerId != null).map((r) => r.actingCustomerId!))];
        const [actingUserRows, actingCustomerRows] = await Promise.all([
            actingUserIds.length
                ? db.select().from(users).where(inArray(users.id, actingUserIds))
                : Promise.resolve([] as Array<typeof users.$inferSelect>),
            actingCustomerIds.length
                ? db.select().from(customers).where(inArray(customers.id, actingCustomerIds))
                : Promise.resolve([] as Array<typeof customers.$inferSelect>),
        ]);
        const actingUserById = new Map(actingUserRows.map((u) => [u.id, u] as const));
        const actingCustomerById = new Map(actingCustomerRows.map((c) => [c.id, c] as const));
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
            const toppedUpToExternalId = r.customerExternalId ?? r.walletUserExternalId ?? null;
            const creator = creatorById.get(r.createdBy);
            const creatorName = creator ? (creator.fullName || creator.username) : String(r.createdBy);
            const creatorShopId = creatorShopIdByUser.get(r.createdBy) ?? null;
            const shopName = kind === "topup" && r.referenceType !== "payment_intent"
                ? (creatorShopId ? shopNameById.get(creatorShopId) ?? "—" : "—")
                : "—";
            const paymentMethod = kind === "topup"
                ? (r.referenceType === "payment_intent" ? (intentMethodById.get(r.referenceId ?? -1) ?? "") : "CASH")
                : "";
            const amount = Math.abs((pgNumber(r.balanceAfter) ?? 0) - (pgNumber(r.balanceBefore) ?? 0));

            let toppedBy: string | null = null;
            let toppedByExternalId: string | null = null;
            if (kind === "topup") {
                const actingUser = r.actingUserId != null ? actingUserById.get(r.actingUserId) : null;
                const actingCustomer = r.actingCustomerId != null ? actingCustomerById.get(r.actingCustomerId) : null;
                if (actingUser) {
                    toppedBy = actingUser.fullName || actingUser.username;
                    toppedByExternalId = actingUser.externalId ?? null;
                } else if (actingCustomer) {
                    toppedBy = actingCustomer.name;
                    toppedByExternalId = actingCustomer.externalId ?? null;
                } else if (creator?.role === "kiosk") {
                    toppedBy = payerName !== "—" ? payerName : kioskDisplayName(r.reason, creatorName);
                    toppedByExternalId = toppedUpToExternalId;
                } else {
                    toppedBy = creatorName;
                    toppedByExternalId = creator?.externalId ?? null;
                }
            }

            return {
                id: r.id,
                kind,
                created_at: pgToIso(r.createdAt)!,
                payer_id: payerId,
                payer_name: payerName,
                payment_method: paymentMethod,
                shop_name: shopName,
                amount,
                cashier_name: "—",
                receipt_number: null,
                status: "ACTIVE",
                topped_by: toppedBy,
                topped_by_external_id: toppedByExternalId,
                topped_up_to: kind === "topup" ? payerName : null,
                topped_up_to_external_id: kind === "topup" ? toppedUpToExternalId : null,
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
    merged.sort((a, b) => compareDateTime(a.created_at, b.created_at, sortOrder, a.id, b.id));

    const total = merged.length;
    // When viewing all kinds (kiosk top-ups, adjustments, …) sum the Amount
    // column across every filtered row. Sale-only view keeps the legacy
    // ACTIVE-sales total so voided receipts don't skew POS spending reports.
    const amountTotal = typeFilter === "sale"
        ? saleAmountTotal
        : merged.reduce((s, r) => s + r.amount, 0);
    const rowsForPaymentTotals = typeFilter === "sale"
        ? merged.filter((r) => r.status === "ACTIVE")
        : merged;
    const sumByPaymentLabel = (label: "cash" | "thai_qr") =>
        rowsForPaymentTotals.reduce((s, r) => {
            const key = resolvePaymentMethodLabelKey(r.payment_method, {
                edcCardFee: r.edc_card_fee,
                edcMaskedCard: r.edc_masked_card,
            });
            return key === label ? s + r.amount : s;
        }, 0);
    const cashTotal = sumByPaymentLabel("cash");
    const qrTotal = sumByPaymentLabel("thai_qr");
    const offset = (args.page - 1) * args.pageSize;
    const items: TransactionReportRow[] = merged
        .slice(offset, offset + args.pageSize)
        .map(({ _createdBy, ...rest }) => rest);

    return {
        items,
        total,
        amount_total: amountTotal,
        cash_total: cashTotal,
        qr_total: qrTotal,
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
    sortOrder?: string | null;
    page: number;
    pageSize: number;
}): Promise<KioskLogReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const dateFrom = args.dateFrom?.trim() || null;
    const dateTo = args.dateTo?.trim() || null;

    const conds = [];
    if (args.kioskUserId != null) conds.push(eq(kioskLogs.kioskUserId, args.kioskUserId));
    if (dateFrom) conds.push(gte(kioskLogs.ts, bangkokRangeStart(dateFrom)));
    if (dateTo) conds.push(lt(kioskLogs.ts, bangkokRangeEndExclusive(dateTo)));
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
        .orderBy(
            sortOrder === "asc" ? asc(kioskLogs.ts) : desc(kioskLogs.ts),
            sortOrder === "asc" ? asc(kioskLogs.id) : desc(kioskLogs.id),
        )
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

// ── Low-balance alert report ─────────────────────────────────────────────
// Reads email_alerts_log (alert_type='low_balance') — every row queued by
// low_balance_notification.ts::checkAndSendLowBalanceAlerts, whether it's
// still pending (queued today, not yet flushed by the scheduler), already
// sent, or failed to send. True SQL-level pagination — every filter here is
// a plain column, no cross-referenced name search needed.

export interface LowBalanceAlertRow {
    id: number;
    sent_at: string;
    student_name: string;
    student_code: string | null;
    parent_name: string;
    parent_username: string;
    recipient_email: string;
    balance_at_alert: number;
    threshold_amount: number;
    status: string;
    error_message: string | null;
}

export interface LowBalanceAlertReportResponseDTO {
    items: LowBalanceAlertRow[];
    total: number;
    page: number;
    pages: number;
}

export async function lowBalanceAlertReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    status?: string | null;
    sortOrder?: string | null;
    page: number;
    pageSize: number;
}): Promise<LowBalanceAlertReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const conds = [eq(emailAlertsLog.alertType, "low_balance")];
    if (args.dateFrom) conds.push(gte(emailAlertsLog.sentAt, bangkokRangeStart(args.dateFrom)));
    if (args.dateTo) conds.push(lt(emailAlertsLog.sentAt, bangkokRangeEndExclusive(args.dateTo)));
    if (args.status && args.status !== "all") conds.push(eq(emailAlertsLog.status, args.status));

    const totalRows = await db.select({ id: emailAlertsLog.id }).from(emailAlertsLog).where(and(...conds));
    const total = totalRows.length;

    const rows = await db
        .select({
            id: emailAlertsLog.id,
            sentAt: emailAlertsLog.sentAt,
            recipientEmail: emailAlertsLog.recipientEmail,
            balanceAtAlert: emailAlertsLog.balanceAtAlert,
            thresholdAmount: emailAlertsLog.thresholdAmount,
            status: emailAlertsLog.status,
            errorMessage: emailAlertsLog.errorMessage,
            studentName: customers.name,
            studentCode: customers.studentCode,
            parentFullName: users.fullName,
            parentUsername: users.username,
        })
        .from(emailAlertsLog)
        .leftJoin(customers, eq(customers.id, emailAlertsLog.childCustomerId))
        .leftJoin(users, eq(users.id, emailAlertsLog.parentUserId))
        .where(and(...conds))
        .orderBy(
            sortOrder === "asc" ? asc(emailAlertsLog.sentAt) : desc(emailAlertsLog.sentAt),
            sortOrder === "asc" ? asc(emailAlertsLog.id) : desc(emailAlertsLog.id),
        )
        .offset((args.page - 1) * args.pageSize)
        .limit(args.pageSize);

    const items: LowBalanceAlertRow[] = rows.map((r) => ({
        id: r.id,
        sent_at: pgToIso(r.sentAt)!,
        student_name: r.studentName ?? "—",
        student_code: r.studentCode ?? null,
        parent_name: r.parentFullName || r.parentUsername || "Family notification email",
        parent_username: r.parentUsername ?? "—",
        recipient_email: r.recipientEmail,
        balance_at_alert: pgNumber(r.balanceAtAlert) ?? 0,
        threshold_amount: pgNumber(r.thresholdAmount) ?? 0,
        status: r.status,
        error_message: r.errorMessage,
    }));

    return {
        items,
        total,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
}

// ── Internal Used Report ────────────────────────────────────────────────

export interface InternalUsedRow {
    id: number;
    created_at: string;
    receipt_number: string;
    amount: number;
    isb_id: string;
    staff_name: string;
    remarks: string | null;
    status: string;
    /** username of the cashier who processed the receipt (receipts.created_by),
     *  distinct from `isb_id` (the requester the department budget was drawn
     *  for) — added for the Store/Canteen Internal Used Report's Cashier ID
     *  column. */
    cashier_id: string;
}

export interface InternalUsedDepartmentGroup {
    department_id: number;
    department_code: string;
    department_name: string;
    rows: InternalUsedRow[];
    subtotal: number;
}

export interface InternalUsedReportResponseDTO {
    groups: InternalUsedDepartmentGroup[];
    grand_total: number;
}

/**
 * Staff requisitioning goods/services against a department's budget at a
 * shop — receipts.transaction_mode='INTERNAL_ISSUE' with payer_department_id
 * set (see ShopController.requisition() / pos_checkout_service.ts's
 * INTERNAL_ISSUE handling). Grouped by department server-side, like
 * voidReport()'s grouping by date — the template this mirrors shows a
 * subtotal per department followed by a grand total, and page-based row
 * slicing would risk splitting a department's rows across pages and
 * breaking that subtotal, so this report isn't paginated.
 */
export async function internalUsedReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    departmentId?: number | null;
    requesterUserId?: number | null;
    shopId?: string | null;
    module?: string | null;
    sortOrder?: string | null;
    /** Direction for the department-group ordering (defaults to "asc" by
     *  department_code) — independent of `sortOrder`, which only controls
     *  the date/time order of rows within each group. */
    departmentSortOrder?: string | null;
}): Promise<InternalUsedReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const departmentSortOrder = parseSortOrder(args.departmentSortOrder);
    const dateFrom = args.dateFrom?.trim() || null;
    const dateTo = args.dateTo?.trim() || null;

    const conds = [eq(receipts.transactionMode, "INTERNAL_ISSUE")];
    if (dateFrom) conds.push(gte(receipts.transactionDate, bangkokRangeStart(dateFrom)));
    if (dateTo) conds.push(lt(receipts.transactionDate, bangkokRangeEndExclusive(dateTo)));
    if (args.departmentId != null) conds.push(eq(receipts.payerDepartmentId, args.departmentId));
    if (args.requesterUserId != null) conds.push(eq(receipts.requesterUserId, args.requesterUserId));
    if (args.shopId) {
        conds.push(eq(receipts.shopId, args.shopId));
    } else if (args.module) {
        const ids = await moduleShopIds(args.module);
        if (ids.length > 0) conds.push(inArray(receipts.shopId, ids));
        else conds.push(sql`false`);
    }

    const cashiers = alias(users, "cashier");
    const rows = await db
        .select({
            id: receipts.id,
            transactionDate: receipts.transactionDate,
            receiptNumber: receipts.receiptNumber,
            total: receipts.total,
            status: receipts.status,
            notes: receipts.notes,
            departmentId: departments.id,
            departmentCode: departments.departmentCode,
            departmentName: departments.departmentName,
            requesterUsername: users.username,
            requesterFullName: users.fullName,
            requesterExternalId: users.externalId,
            cashierUsername: cashiers.username,
        })
        .from(receipts)
        // Inner join — a department-charged requisition always has a real
        // department row (FK-enforced), so this never drops a valid receipt.
        .innerJoin(departments, eq(departments.id, receipts.payerDepartmentId))
        .leftJoin(users, eq(users.id, receipts.requesterUserId))
        // Second, separately-aliased join to the same table — the cashier who
        // actually rang up the receipt (created_by), distinct from the
        // requester above (who the department budget was drawn for).
        .leftJoin(cashiers, eq(cashiers.id, receipts.createdBy))
        .where(and(...conds))
        .orderBy(
            departmentSortOrder === "asc" ? asc(departments.departmentCode) : desc(departments.departmentCode),
            sortOrder === "asc" ? asc(receipts.transactionDate) : desc(receipts.transactionDate),
            sortOrder === "asc" ? asc(receipts.id) : desc(receipts.id),
        );

    const groupMap = new Map<number, InternalUsedDepartmentGroup>();
    let grandTotal = 0;
    for (const r of rows) {
        // A voided requisition shows as a negative amount — same convention
        // as every other report (transactionReport, salesByItemReport, ...).
        const amount = (pgNumber(r.total) ?? 0) * (r.status === "VOIDED" ? -1 : 1);
        let group = groupMap.get(r.departmentId!);
        if (!group) {
            group = {
                department_id: r.departmentId!,
                department_code: r.departmentCode!,
                department_name: r.departmentName!,
                rows: [],
                subtotal: 0,
            };
            groupMap.set(r.departmentId!, group);
        }
        group.rows.push({
            id: r.id,
            created_at: pgToIso(r.transactionDate)!,
            receipt_number: r.receiptNumber,
            amount,
            isb_id: r.requesterExternalId ?? "—",
            staff_name: r.requesterFullName || r.requesterUsername || "—",
            remarks: r.notes ?? null,
            status: String(r.status ?? ""),
            cashier_id: r.cashierUsername ?? "—",
        });
        group.subtotal += amount;
        grandTotal += amount;
    }

    const groups = [...groupMap.values()];
    for (const g of groups) {
        g.rows.sort((a, b) => compareDateTime(a.created_at, b.created_at, sortOrder, a.id, b.id));
    }

    return {
        groups,
        grand_total: grandTotal,
    };
}

// ── Balance Report ────────────────────────────────────────────────────────

export interface BalanceReportRow {
    id: number;
    created_at: string;
    shop_name: string | null;
    type: "purchase" | "void_refund" | "refund" | "topup" | "adjustment" | "transfer" | "other";
    in_amount: number;
    out_amount: number;
    balance_before: number;
    balance_after: number;
    owner_role: string;
    owner_name: string;
    owner_external_id: string | null;
}

export interface BalanceReportResponseDTO {
    items: BalanceReportRow[];
    total: number;
    in_total: number;
    out_total: number;
    page: number;
    pages: number;
}

export async function balanceReport(args: {
    dateFrom?: string | null;
    dateTo?: string | null;
    type?: string | null;
    role?: string | null;
    externalId?: string | null;
    sortOrder?: string | null;
    page: number;
    pageSize: number;
}): Promise<BalanceReportResponseDTO> {
    const sortOrder = parseSortOrder(args.sortOrder);
    const conds = [];
    if (args.dateFrom) {
        try { conds.push(gte(walletTransactions.createdAt, bangkokRangeStart(args.dateFrom))); }
        catch { /* ignore */ }
    }
    if (args.dateTo) {
        try {
            conds.push(lt(walletTransactions.createdAt, bangkokRangeEndExclusive(args.dateTo)));
        } catch { /* ignore */ }
    }

    const rows = await db
        .select({
            tx: walletTransactions,
            w: wallets,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(walletTransactions.createdAt));

    // Batch-prefetch wallet owners and receipt/shop data for shop name resolution
    const customerIds = [...new Set(rows.filter((r) => r.w.customerId !== null).map((r) => r.w.customerId!))];
    const userIds = [...new Set(rows.filter((r) => r.w.userId !== null).map((r) => r.w.userId!))];
    const departmentIds = [...new Set(rows.filter((r) => r.w.departmentId !== null).map((r) => r.w.departmentId!))];
    const creatorIds = [...new Set(rows.map((r) => r.tx.createdBy))];
    const allUserIds = [...new Set([...userIds, ...creatorIds])];

    // For receipt/receipt_void rows, prefetch receipts → shops
    const receiptIds = rows
        .filter((r) => (r.tx.referenceType === "receipt" || r.tx.referenceType === "receipt_void") && r.tx.referenceId !== null)
        .map((r) => r.tx.referenceId!) as number[];

    const [customerRows, userRows, departmentRows, receiptRows] = await Promise.all([
        customerIds.length > 0 ? db.select().from(customers).where(inArray(customers.id, customerIds)) : Promise.resolve([]),
        allUserIds.length > 0 ? db.select().from(users).where(inArray(users.id, allUserIds)) : Promise.resolve([]),
        departmentIds.length > 0 ? db.select().from(departments).where(inArray(departments.id, departmentIds)) : Promise.resolve([]),
        receiptIds.length > 0
            ? db
                .select({ rid: receipts.id, shopId: receipts.shopId, shopName: shops.name })
                .from(receipts)
                .leftJoin(shops, eq(shops.id, receipts.shopId))
                .where(inArray(receipts.id, receiptIds))
            : Promise.resolve([]),
    ]);

    const customerById = new Map(customerRows.map((c) => [c.id, c] as const));
    const userById = new Map(userRows.map((u) => [u.id, u] as const));
    const departmentById = new Map(departmentRows.map((d) => [d.id, d] as const));
    const receiptShopMap = new Map<number, { shopId: string | null; shopName: string | null }>(
        receiptRows.map((r) => [r.rid, { shopId: r.shopId, shopName: r.shopName }] as const),
    );

    // For non-receipt transactions: resolve creator user's shop
    const creatorShopMap = new Map<number, string | null>();
    const nonReceiptCreatorIds = [
        ...new Set(
            rows
                .filter((r) => r.tx.referenceType !== "receipt" && r.tx.referenceType !== "receipt_void")
                .map((r) => r.tx.createdBy),
        ),
    ];
    if (nonReceiptCreatorIds.length > 0) {
        const userShopRows = await db
            .select({ userId: users.id, shopId: users.shopId })
            .from(users)
            .where(inArray(users.id, nonReceiptCreatorIds));
        const creatorShopIds = [...new Set(userShopRows.map((u) => u.shopId).filter((s): s is string => !!s))];
        const shopNameMap = new Map<string, string>();
        if (creatorShopIds.length > 0) {
            const shopRows = await db
                .select({ id: shops.id, name: shops.name })
                .from(shops)
                .where(inArray(shops.id, creatorShopIds));
            shopRows.forEach((s) => shopNameMap.set(s.id, s.name ?? ""));
        }
        userShopRows.forEach((u) => {
            creatorShopMap.set(u.userId, u.shopId ? (shopNameMap.get(u.shopId) ?? null) : null);
        });
    }

    const filtered: BalanceReportRow[] = [];
    for (const r of rows) {
        const tx = r.tx;
        const w = r.w;
        const before = pgNumber(tx.balanceBefore) ?? 0;
        const after = pgNumber(tx.balanceAfter) ?? 0;
        const delta = after - before;
        const inAmount = delta > 0 ? Math.abs(delta) : 0;
        const outAmount = delta < 0 ? Math.abs(delta) : 0;

        // Classify transaction type
        let txType: "purchase" | "void_refund" | "refund" | "topup" | "adjustment" | "transfer" | "other" = "other";
        if (tx.referenceType === "receipt") {
            txType = "purchase";
        } else if (tx.referenceType === "receipt_void") {
            txType = "void_refund";
        } else if (tx.transactionType === "REFUND") {
            txType = "refund";
        } else {
            const kind = classifyWalletTxKind({
                transactionType: tx.transactionType,
                referenceType: tx.referenceType ?? null,
                reason: tx.reason ?? null,
            });
            if (kind === "topup") txType = "topup";
            else if (kind === "adjustment") txType = "adjustment";
            else if (kind === "transfer") txType = "transfer";
            else txType = "other";
        }

        // Resolve owner and owner metadata
        let ownerRole = "unknown",
            ownerName = "—",
            ownerExternalId: string | null = null;

        if (w.customerId !== null) {
            const c = customerById.get(w.customerId);
            if (c) {
                ownerRole = "student";
                ownerName = c.name;
                ownerExternalId = c.externalId ?? null;
            }
        } else if (w.userId !== null) {
            const u = userById.get(w.userId);
            if (u) {
                ownerRole = u.role ?? "staff";
                ownerName = u.fullName || u.username;
                ownerExternalId = u.externalId ?? null;
            }
        } else if (w.departmentId !== null) {
            const d = departmentById.get(w.departmentId);
            if (d) {
                ownerRole = "department";
                ownerName = d.departmentName ?? "—";
                ownerExternalId = null;
            }
        }

        // Apply filters
        if (args.role && args.role.trim()) {
            const allowedRoles = args.role.split(",").map((r) => r.trim());
            if (!allowedRoles.includes(ownerRole)) continue;
        }
        if (args.externalId && args.externalId.trim()) {
            if (ownerExternalId !== args.externalId) continue;
        }
        if (args.type && args.type !== "all") {
            if (args.type !== txType) continue;
        }

        // Resolve shop name
        let shopName: string | null = null;
        if (tx.referenceType === "receipt" || tx.referenceType === "receipt_void") {
            if (tx.referenceId !== null) {
                const receiptShop = receiptShopMap.get(tx.referenceId);
                shopName = receiptShop?.shopName ?? null;
            }
        } else {
            shopName = creatorShopMap.get(tx.createdBy) ?? null;
        }

        filtered.push({
            id: tx.id,
            created_at: pgToIso(tx.createdAt)!,
            shop_name: shopName,
            type: txType,
            in_amount: inAmount,
            out_amount: outAmount,
            balance_before: before,
            balance_after: after,
            owner_role: ownerRole,
            owner_name: ownerName,
            owner_external_id: ownerExternalId,
        });
    }

    // Sort and paginate
    filtered.sort((a, b) => compareDateTime(a.created_at, b.created_at, sortOrder, a.id, b.id));

    const total = filtered.length;
    const inTotal = filtered.reduce((s, r) => s + r.in_amount, 0);
    const outTotal = filtered.reduce((s, r) => s + r.out_amount, 0);
    const offset = (args.page - 1) * args.pageSize;
    const items = filtered.slice(offset, offset + args.pageSize);

    return {
        items,
        total,
        in_total: inTotal,
        out_total: outTotal,
        page: args.page,
        pages: Math.max(1, Math.ceil(total / args.pageSize)),
    };
}

