import { eq, and, or, ilike, asc, inArray, sql, ne, isNotNull } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { customers, users, wallets, parentChildLinks, customerTypes, receipts, spendingGroups, shops, shopSpendingGroups } from "@/db/schema";
import { expandCardUidCandidates } from "@/lib/card_uid";
import { pgNumber } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { transferWithinFamily, ensureWalletForCustomer } from "@/services/wallet_service";
import { todayDeductedByModule, DEFAULT_DAILY_LIMIT_CANTEEN, DEFAULT_DAILY_LIMIT_STORE } from "@/services/pos_checkout_service";

/**
 * StudentProfileResponse parity — fields can come from either the customers
 * table (students/departments) or the users table (parents/staff/teachers).
 * Frontend uses presence of `user_id` to switch payer flow.
 */
export interface StudentProfileDTO {
    id: number;
    customer_code: string;
    student_code: string | null;
    name: string;
    grade: string | null;
    school_type: string | null;
    customer_kind: string | null;
    enroll_date: string | null;
    withdraw_date: string | null;
    photo_url: string | null;
    email: string | null;
    phone: string | null;
    allergies: string | null;
    dietary_notes: string | null;
    allergy_override_note: string | null;
    card_uid: string | null;
    card_frozen: boolean;
    is_active: boolean;
    daily_limit: number | null;
    daily_limit_canteen: number | null;
    daily_limit_store: number | null;
    spent_today_canteen: number | null;
    spent_today_store: number | null;
    negative_credit_limit: number | null;
    external_id: string | null;
    family_code: string | null;
    wallet_id: number | null;
    wallet_balance: number | null;
    user_id: number | null;
}

async function walletByCustomerIds(ids: number[]): Promise<Map<number, { id: number; balance: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await db
        .select({ id: wallets.id, customerId: wallets.customerId, balance: wallets.balance })
        .from(wallets)
        .where(inArray(wallets.customerId, ids));
    const out = new Map<number, { id: number; balance: number }>();
    rows.forEach((r) => {
        if (r.customerId !== null) {
            out.set(r.customerId, { id: r.id, balance: pgNumber(r.balance) ?? 0 });
        }
    });
    return out;
}

async function walletByUserIds(ids: number[]): Promise<Map<number, { id: number; balance: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await db
        .select({ id: wallets.id, userId: wallets.userId, balance: wallets.balance })
        .from(wallets)
        .where(inArray(wallets.userId, ids));
    const out = new Map<number, { id: number; balance: number }>();
    rows.forEach((r) => {
        if (r.userId !== null) {
            out.set(r.userId, { id: r.id, balance: pgNumber(r.balance) ?? 0 });
        }
    });
    return out;
}

function customerToProfile(
    c: typeof customers.$inferSelect,
    wallet: { id: number; balance: number } | undefined,
    spentToday?: { canteen: number; store: number },
): StudentProfileDTO {
    return {
        id: c.id,
        customer_code: c.customerCode,
        student_code: c.studentCode ?? null,
        name: c.name,
        grade: c.grade ?? null,
        school_type: c.schoolType ?? null,
        customer_kind: c.customerKind ?? null,
        enroll_date: c.enrollDate ?? null,
        withdraw_date: c.withdrawDate ?? null,
        photo_url: c.photoUrl ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        allergies: c.allergies ?? null,
        dietary_notes: c.dietaryNotes ?? null,
        allergy_override_note: c.allergyOverrideNote ?? null,
        card_uid: c.cardUid ?? null,
        card_frozen: c.cardFrozen,
        is_active: c.isActive,
        daily_limit: pgNumber(c.dailyLimit),
        daily_limit_canteen: pgNumber(c.dailyLimitCanteen) ?? DEFAULT_DAILY_LIMIT_CANTEEN,
        daily_limit_store: pgNumber(c.dailyLimitStore) ?? DEFAULT_DAILY_LIMIT_STORE,
        spent_today_canteen: spentToday?.canteen ?? null,
        spent_today_store: spentToday?.store ?? null,
        negative_credit_limit: pgNumber(c.negativeCreditLimit),
        external_id: c.externalId ?? null,
        family_code: c.familyCode ?? null,
        wallet_id: wallet?.id ?? null,
        wallet_balance: wallet?.balance ?? null,
        user_id: null,
    };
}

async function spentTodayForWallet(walletId: number | undefined): Promise<{ canteen: number; store: number }> {
    if (!walletId) return { canteen: 0, store: 0 };
    const [canteen, store] = await Promise.all([
        todayDeductedByModule(walletId, "canteen"),
        todayDeductedByModule(walletId, "store"),
    ]);
    return { canteen, store };
}

function userToProfile(
    u: typeof users.$inferSelect,
    wallet: { id: number; balance: number } | undefined,
): StudentProfileDTO {
    return {
        id: u.id,
        user_id: u.id,
        customer_code: u.username,
        student_code: null,
        name: u.fullName || u.username,
        grade: null,
        school_type: null,
        customer_kind: u.role || "user",
        enroll_date: null,
        withdraw_date: null,
        photo_url: u.photoUrl ?? null,
        email: u.email ?? null,
        phone: null,
        allergies: u.allergies ?? null,
        dietary_notes: null,
        allergy_override_note: null,
        card_uid: u.cardUid ?? null,
        card_frozen: false,
        is_active: u.isActive,
        daily_limit: null,
        daily_limit_canteen: null,
        daily_limit_store: null,
        spent_today_canteen: null,
        spent_today_store: null,
        negative_credit_limit: null,
        external_id: u.externalId ?? null,
        family_code: u.familyCode ?? null,
        wallet_id: wallet?.id ?? null,
        wallet_balance: wallet?.balance ?? null,
    };
}

export interface SearchCustomersParams {
    q: string;
    limit?: number;
    /** Restrict matching to name + family_code + external_id + card_uid only
     * — the POS member-search box uses this so a query digit-matching an
     * unrelated person's phone/email/student_code/customer_code doesn't
     * surface them as a false hit. */
    narrow?: boolean;
}

export async function searchCustomers(p: SearchCustomersParams): Promise<StudentProfileDTO[]> {
    const q = p.q.trim();
    if (q.length < 2) {
        const err = new Error("Query must be at least 2 characters");
        (err as { status?: number }).status = 400;
        throw err;
    }
    const limit = p.limit ?? 10;
    const pattern = `%${q}%`;
    // A scanned card can reach this search box in whatever format the reader
    // emitted (hex, byte-reversed hex, or decimal) — see card_uid.ts. Expand
    // the raw query to every equivalent form and match card_uid against all
    // of them too, on top of the plain substring match for partial/manual typing.
    const cardUidCandidates = expandCardUidCandidates(q);

    // Students / departments
    const customerRows = await db
        .select()
        .from(customers)
        .where(
            and(
                eq(customers.isActive, true),
                p.narrow
                    ? or(
                        ilike(customers.name, pattern),
                        ilike(customers.familyCode, pattern),
                        ilike(customers.externalId, pattern),
                        ilike(customers.cardUid, pattern),
                        ...cardUidCandidates.map((c) => ilike(customers.cardUid, c)),
                    )
                    : or(
                        ilike(customers.name, pattern),
                        ilike(customers.studentCode, pattern),
                        ilike(customers.customerCode, pattern),
                        ilike(customers.cardUid, pattern),
                        ...cardUidCandidates.map((c) => ilike(customers.cardUid, c)),
                        ilike(customers.familyCode, pattern),
                        ilike(customers.externalId, pattern),
                        ilike(customers.email, pattern),
                        ilike(customers.phone, pattern),
                    ),
            ),
        )
        .orderBy(asc(customers.name))
        .limit(limit);

    // Parents / staff / teachers / visitors
    const userRows = await db
        .select()
        .from(users)
        .where(
            and(
                eq(users.isActive, true),
                inArray(users.role, ["parent", "staff", "teacher", "visitor"]),
                p.narrow
                    ? or(
                        ilike(users.fullName, pattern),
                        ilike(users.familyCode, pattern),
                        ilike(users.externalId, pattern),
                        ilike(users.cardUid, pattern),
                        ...cardUidCandidates.map((c) => ilike(users.cardUid, c)),
                    )
                    : or(
                        ilike(users.fullName, pattern),
                        ilike(users.username, pattern),
                        ilike(users.email, pattern),
                        ilike(users.familyCode, pattern),
                        ilike(users.externalId, pattern),
                        ilike(users.cardUid, pattern),
                        ...cardUidCandidates.map((c) => ilike(users.cardUid, c)),
                    ),
            ),
        )
        .orderBy(asc(users.fullName))
        .limit(limit);

    const [custWallets, userWallets] = await Promise.all([
        walletByCustomerIds(customerRows.map((r) => r.id)),
        walletByUserIds(userRows.map((r) => r.id)),
    ]);

    // Populate spent_today_* for each customer so the search-result detail
    // view can show daily limit usage without an extra round-trip.
    const custSpent = await Promise.all(
        customerRows.map(async (c) => {
            const w = custWallets.get(c.id);
            const s = await spentTodayForWallet(w?.id);
            return [c.id, s] as const;
        }),
    );
    const custSpentMap = new Map(custSpent);

    const combined: StudentProfileDTO[] = [
        ...customerRows.map((c) => customerToProfile(c, custWallets.get(c.id), custSpentMap.get(c.id))),
        ...userRows.map((u) => userToProfile(u, userWallets.get(u.id))),
    ];
    combined.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return combined.slice(0, limit * 2);
}

export async function getCustomerByCode(code: string): Promise<StudentProfileDTO | null> {
    // external_id must be searchable in every case, not just for staff — a
    // manually-created "other"/visitor customer can carry an external_id
    // (ISB ID number) with no student_code/customer_code match at all.
    const rows = await db
        .select()
        .from(customers)
        .where(or(
            ilike(customers.studentCode, code),
            ilike(customers.customerCode, code),
            ilike(customers.externalId, code),
        ))
        .limit(1);
    if (!rows[0]) return null;
    const ws = await walletByCustomerIds([rows[0].id]);
    const wallet = ws.get(rows[0].id);
    const spent = await spentTodayForWallet(wallet?.id);
    return customerToProfile(rows[0], wallet, spent);
}

export async function getCustomerByCard(uid: string): Promise<StudentProfileDTO | null> {
    const candidates = expandCardUidCandidates(uid);
    if (candidates.length === 0) return null;

    const rows = await db
        .select()
        .from(customers)
        .where(or(...candidates.map((c) => ilike(customers.cardUid, c))))
        .limit(1);
    if (!rows[0]) return null;
    const ws = await walletByCustomerIds([rows[0].id]);
    const wallet = ws.get(rows[0].id);
    const spent = await spentTodayForWallet(wallet?.id);
    return customerToProfile(rows[0], wallet, spent);
}

export async function getCustomer(id: number): Promise<StudentProfileDTO | null> {
    const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!rows[0]) return null;
    const ws = await walletByCustomerIds([id]);
    const wallet = ws.get(id);
    const spent = await spentTodayForWallet(wallet?.id);
    return customerToProfile(rows[0], wallet, spent);
}

export interface ListCustomersParams {
    skip?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
}

async function profileForCustomerId(id: number): Promise<StudentProfileDTO> {
    const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!rows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const ws = await walletByCustomerIds([id]);
    const wallet = ws.get(id);
    const spent = await spentTodayForWallet(wallet?.id);
    return customerToProfile(rows[0], wallet, spent);
}

/** Permission gate for customer mutations: admin/manager/cashier bypass; otherwise must own a parent_child_link. */
async function assertCustomerAccess(caller: AccessTokenPayload, customerId: number): Promise<void> {
    if (caller.is_superuser || caller.roles.some((r) => ["admin", "manager", "cashier"].includes(r))) return;
    const link = await db
        .select()
        .from(parentChildLinks)
        .where(and(eq(parentChildLinks.parentUserId, Number(caller.sub)), eq(parentChildLinks.childCustomerId, customerId)))
        .limit(1);
    if (!link[0]) {
        const err = new Error("Not authorized");
        (err as { status?: number }).status = 403;
        throw err;
    }
}

export async function setActive(customerId: number, active: boolean): Promise<StudentProfileDTO> {
    const rows = await db.update(customers).set({ isActive: active }).where(eq(customers.id, customerId)).returning();
    if (!rows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return profileForCustomerId(customerId);
}

export async function freezeCard(caller: AccessTokenPayload, customerId: number, frozen: boolean): Promise<StudentProfileDTO> {
    await assertCustomerAccess(caller, customerId);
    const rows = await db.update(customers).set({ cardFrozen: frozen }).where(eq(customers.id, customerId)).returning();
    if (!rows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return profileForCustomerId(customerId);
}

export async function setDailyLimit(caller: AccessTokenPayload, customerId: number, limit: number | null): Promise<StudentProfileDTO> {
    await assertCustomerAccess(caller, customerId);
    const rows = await db
        .update(customers)
        .set({ dailyLimit: limit !== null ? String(limit) : null })
        .where(eq(customers.id, customerId))
        .returning();
    if (!rows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return profileForCustomerId(customerId);
}

export async function setDailyLimits(
    caller: AccessTokenPayload,
    customerId: number,
    limits: { daily_limit_canteen?: number | null; daily_limit_store?: number | null },
): Promise<StudentProfileDTO> {
    await assertCustomerAccess(caller, customerId);
    const rows = await db.update(customers).set({
        ...("daily_limit_canteen" in limits && {
            dailyLimitCanteen: limits.daily_limit_canteen != null ? String(limits.daily_limit_canteen) : null,
        }),
        ...("daily_limit_store" in limits && {
            dailyLimitStore: limits.daily_limit_store != null ? String(limits.daily_limit_store) : null,
        }),
    }).where(eq(customers.id, customerId)).returning();
    if (!rows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return profileForCustomerId(customerId);
}

export async function updateAllergies(customerId: number, args: {
    allergies?: string | null;
    dietary_notes?: string | null;
    allergy_override_note?: string | null;
}): Promise<StudentProfileDTO> {
    const updates: Record<string, unknown> = {};
    if (args.allergies !== undefined) updates.allergies = args.allergies;
    if (args.dietary_notes !== undefined) updates.dietaryNotes = args.dietary_notes;
    if (args.allergy_override_note !== undefined) updates.allergyOverrideNote = args.allergy_override_note || null;

    const rows = await db.update(customers).set(updates).where(eq(customers.id, customerId)).returning();
    if (!rows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return profileForCustomerId(customerId);
}

export async function setNegativeCreditLimit(customerId: number, limit: number | null): Promise<StudentProfileDTO> {
    const rows = await db
        .update(customers)
        .set({ negativeCreditLimit: limit !== null ? String(limit) : null })
        .where(eq(customers.id, customerId))
        .returning();
    if (!rows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return profileForCustomerId(customerId);
}

export async function bindCard(customerId: number, cardUid: string | null): Promise<StudentProfileDTO> {
    // Existence check
    const cur = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!cur[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    if (cardUid) {
        const dupCust = await db
            .select({ id: customers.id, name: customers.name, customerCode: customers.customerCode })
            .from(customers)
            .where(and(eq(customers.cardUid, cardUid), ne(customers.id, customerId)))
            .limit(1);
        if (dupCust[0]) {
            const err = new Error(`Card already assigned to student ${dupCust[0].name} (${dupCust[0].customerCode})`);
            (err as { status?: number }).status = 409;
            throw err;
        }
        const dupUser = await db
            .select({ fullName: users.fullName, username: users.username })
            .from(users)
            .where(eq(users.cardUid, cardUid))
            .limit(1);
        if (dupUser[0]) {
            const err = new Error(`Card already assigned to user ${dupUser[0].fullName || dupUser[0].username}`);
            (err as { status?: number }).status = 409;
            throw err;
        }
    }

    await db.update(customers).set({ cardUid: cardUid || null }).where(eq(customers.id, customerId));
    return profileForCustomerId(customerId);
}

export interface CreateStudentInput {
    customer_code: string;
    name: string;
    student_code?: string | null;
    grade?: string | null;
    email?: string | null;
    phone?: string | null;
    allergies?: string | null;
    dietary_notes?: string | null;
    card_uid?: string | null;
    photo_url?: string | null;
    customer_type_id?: number | null;
    initial_balance?: number;
}

export async function createStudent(input: CreateStudentInput, createdByUserId: number): Promise<StudentProfileDTO> {
    // Uniqueness checks
    const dupCode = await db.select({ id: customers.id }).from(customers).where(eq(customers.customerCode, input.customer_code)).limit(1);
    if (dupCode[0]) {
        const err = new Error("customer_code already exists");
        (err as { status?: number }).status = 409;
        throw err;
    }
    if (input.student_code) {
        const dupStudent = await db.select({ id: customers.id }).from(customers).where(eq(customers.studentCode, input.student_code)).limit(1);
        if (dupStudent[0]) {
            const err = new Error("student_code already exists");
            (err as { status?: number }).status = 409;
            throw err;
        }
    }
    if (input.card_uid) {
        const dupCard = await db.select({ id: customers.id }).from(customers).where(eq(customers.cardUid, input.card_uid)).limit(1);
        if (dupCard[0]) {
            const err = new Error("card_uid already exists");
            (err as { status?: number }).status = 409;
            throw err;
        }
    }

    // Resolve customer_type_id (default to INTERNAL if missing)
    let typeId = input.customer_type_id ?? null;
    if (!typeId) {
        const ct = await db.select({ id: customerTypes.id }).from(customerTypes).where(eq(customerTypes.typeName, "INTERNAL")).limit(1);
        if (ct[0]) {
            typeId = ct[0].id;
        } else {
            const [created] = await db
                .insert(customerTypes)
                .values({ typeName: "INTERNAL", description: "Student/staff", defaultPriceLevel: "internal" })
                .returning({ id: customerTypes.id });
            typeId = created.id;
        }
    }

    const customerId = await pgClient.begin(async (sqlTx) => {
        const cRows = await sqlTx<Array<{ id: number }>>`
      INSERT INTO customers
        (customer_code, name, student_code, grade, email, phone, allergies, dietary_notes,
         card_uid, photo_url, customer_type_id, is_active, card_frozen)
      VALUES (${input.customer_code}, ${input.name}, ${input.student_code ?? null},
              ${input.grade ?? null}, ${input.email ?? null}, ${input.phone ?? null},
              ${input.allergies ?? null}, ${input.dietary_notes ?? null},
              ${input.card_uid ?? null}, ${input.photo_url ?? null}, ${typeId}, true, false)
      RETURNING id
    `;
        const newId = cRows[0].id;
        const initBalance = input.initial_balance ?? 0;
        const wRows = await sqlTx<Array<{ id: number }>>`
      INSERT INTO wallets (customer_id, balance, is_active)
      VALUES (${newId}, ${initBalance}, true)
      RETURNING id
    `;
        // See department_service.ts::createDepartment's matching comment —
        // a non-zero starting balance needs a ledger row or it's invisible
        // to reconciliation/reporting, which treat wallet_transactions as
        // the full source of truth for a wallet's history.
        if (initBalance !== 0) {
            await sqlTx`
        INSERT INTO wallet_transactions
          (wallet_id, transaction_type, amount, balance_before, balance_after,
           reference_type, description, created_by)
        VALUES (${wRows[0].id}, 'ADJUSTMENT', ${initBalance}, 0, ${initBalance},
                'initial_balance', ${"Initial balance on student creation"}, ${createdByUserId})
      `;
        }
        return newId;
    });

    return profileForCustomerId(customerId);
}

export interface UpdateCustomerBasicInput {
    name?: string | null;
    grade?: string | null;
    school_type?: string | null;
    email?: string | null;
    phone?: string | null;
    family_code?: string | null;
}

export async function updateCustomerBasic(
    caller: AccessTokenPayload,
    customerId: number,
    input: UpdateCustomerBasicInput,
): Promise<StudentProfileDTO> {
    // Admin role check (caller assertion done at route)
    const cur = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!cur[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    await assertCustomerAccess(caller, customerId);

    const updates: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== null) updates.name = input.name;
    if (input.grade !== undefined) updates.grade = input.grade;
    if (input.school_type !== undefined) updates.schoolType = input.school_type;
    if (input.email !== undefined) updates.email = input.email;
    if (input.phone !== undefined) updates.phone = input.phone;
    if (input.family_code !== undefined) updates.familyCode = (input.family_code ?? "").trim() || null;

    if (Object.keys(updates).length > 0) {
        await db.update(customers).set(updates).where(eq(customers.id, customerId));
    }
    return profileForCustomerId(customerId);
}

export async function deleteCustomer(customerId: number): Promise<void> {
    const cur = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!cur[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    // Orphan receipts (preserve audit trail)
    await db.update(receipts).set({ customerId: null }).where(eq(receipts.customerId, customerId));
    await db.delete(customers).where(eq(customers.id, customerId));
}

export interface GraduateResponseDTO {
    customer_id: number;
    deactivated: boolean;
    transferred_to_customer_id: number | null;
    transferred_amount: number;
    siblings_available: number[];
    message: string;
}

export async function graduateStudent(
    caller: AccessTokenPayload,
    customerId: number,
    payload: { transfer_to_customer_id: number | null },
): Promise<GraduateResponseDTO> {
    const cRows = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    const customer = cRows[0];
    if (!customer) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    const wRows = await db
        .select({ id: wallets.id, balance: wallets.balance })
        .from(wallets)
        .where(eq(wallets.customerId, customerId))
        .limit(1);
    const wallet = wRows[0] ?? null;
    const balance = wallet ? pgNumber(wallet.balance) ?? 0 : 0;

    const parentRows = await db
        .select({ parentUserId: parentChildLinks.parentUserId })
        .from(parentChildLinks)
        .where(eq(parentChildLinks.childCustomerId, customerId));
    const parentIds = parentRows.map((r) => r.parentUserId);

    let siblings: Array<{ id: number; name: string }> = [];
    if (parentIds.length > 0) {
        siblings = await db
            .selectDistinct({ id: customers.id, name: customers.name })
            .from(customers)
            .innerJoin(parentChildLinks, eq(parentChildLinks.childCustomerId, customers.id))
            .where(
                and(
                    inArray(parentChildLinks.parentUserId, parentIds),
                    ne(customers.id, customerId),
                    eq(customers.isActive, true),
                ),
            );
    }
    const siblingsAvailable = siblings.map((s) => s.id);

    let transferredTo: number | null = null;
    let transferredAmount = 0;
    let message = "";

    if (balance > 0 && wallet) {
        let targetId: number | null = payload.transfer_to_customer_id;

        if (targetId === null || targetId === undefined) {
            if (siblings.length === 1) {
                targetId = siblings[0].id;
            } else if (siblings.length > 1) {
                return {
                    customer_id: customerId,
                    deactivated: false,
                    transferred_to_customer_id: null,
                    transferred_amount: 0,
                    siblings_available: siblingsAvailable,
                    message: "Multiple siblings found — specify transfer_to_customer_id",
                };
            }
        }

        if (targetId !== null) {
            const target = siblings.find((s) => s.id === targetId);
            if (!target) {
                const err = new Error(`Customer ${targetId} is not a sibling of ${customerId}`);
                (err as { status?: number }).status = 400;
                throw err;
            }
            const targetWallet = await ensureWalletForCustomer(target.id);
            await transferWithinFamily({
                fromWalletId: wallet.id,
                toWalletId: targetWallet.id,
                amount: balance,
                initiatorUserId: Number(caller.sub),
                initiatorIsAdmin: true,
                initiatorRoles: caller.roles,
                note: `Graduation transfer from ${customer.name}`,
            });
            transferredTo = target.id;
            transferredAmount = balance;
            message = `Transferred ฿${balance.toFixed(2)} to sibling ${target.name}`;
        } else {
            message = `No siblings found — balance ฿${balance.toFixed(2)} left in wallet, needs admin action`;
        }
    }

    await db
        .update(customers)
        .set({
            isActive: false,
            isGraduated: true,
            cardFrozen: true,
            powerschoolSyncAt: new Date().toISOString(),
        })
        .where(eq(customers.id, customerId));

    return {
        customer_id: customerId,
        deactivated: true,
        transferred_to_customer_id: transferredTo,
        transferred_amount: transferredAmount,
        siblings_available: siblingsAvailable,
        message: message || "Student deactivated",
    };
}

export async function listCustomers(p: ListCustomersParams = {}): Promise<StudentProfileDTO[]> {
    const skip = p.skip ?? 0;
    const limit = Math.min(p.limit ?? 20, 100);
    const conds = [];
    if (p.isActive !== undefined) conds.push(eq(customers.isActive, p.isActive));
    if (p.search) {
        const pat = `%${p.search}%`;
        conds.push(
            or(
                ilike(customers.name, pat),
                ilike(customers.customerCode, pat),
                ilike(customers.studentCode, pat),
            )!,
        );
    }
    const rows = await db
        .select()
        .from(customers)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(asc(customers.name))
        .limit(limit)
        .offset(skip);
    const ws = await walletByCustomerIds(rows.map((r) => r.id));
    return rows.map((c) => customerToProfile(c, ws.get(c.id)));
}

export interface SpendingGroupUsage {
    spending_group_id: number;
    code: string;
    name_en: string;
    name_th: string;
    daily_limit: number | null;   // null = unlimited
    spent_today: number;
    remaining: number | null;
}

export async function getSpendingGroupsUsageToday(customerId: number): Promise<SpendingGroupUsage[]> {
    const cRows = await db
        .select({
            id: customers.id,
            grade: customers.grade,
            dailyLimitCanteen: customers.dailyLimitCanteen,
            dailyLimitStore: customers.dailyLimitStore,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
    if (!cRows[0]) {
        const err = new Error("Customer not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const { grade, dailyLimitCanteen, dailyLimitStore } = cRows[0];

    // Only groups whose `grades` list covers this student's grade apply to
    // them — a group with no grade match is irrelevant to this customer.
    if (!grade) return [];

    // Get every active group covering this grade, with its module (derived
    // from its linked shops). GROUP BY instead of selectDistinct so a group
    // linked to shops of mixed modules collapses to one row (MIN picks
    // "canteen" over "store").
    const groups = await db
        .select({
            id: spendingGroups.id,
            code: spendingGroups.code,
            nameEn: spendingGroups.nameEn,
            nameTh: spendingGroups.nameTh,
            dailyLimit: spendingGroups.dailyLimit,
            module: sql<string>`MIN(${shops.module})`,
        })
        .from(spendingGroups)
        .innerJoin(shopSpendingGroups, eq(shopSpendingGroups.spendingGroupId, spendingGroups.id))
        .innerJoin(shops, eq(shops.id, shopSpendingGroups.shopId))
        .where(and(eq(spendingGroups.isActive, true), sql`${spendingGroups.grades} @> ${JSON.stringify([grade])}::jsonb`))
        .groupBy(spendingGroups.id, spendingGroups.code, spendingGroups.nameEn, spendingGroups.nameTh, spendingGroups.dailyLimit);

    if (groups.length === 0) return [];

    // Sum today's receipts per spending group for this customer
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const spentRows = await db
        .select({
            groupId: receipts.spendingGroupId,
            spent: sql<string>`COALESCE(SUM(${receipts.total}), '0')`,
        })
        .from(receipts)
        .where(
            and(
                eq(receipts.customerId, customerId),
                eq(receipts.transactionDate, today),
                isNotNull(receipts.spendingGroupId),
                sql`${receipts.status} = 'ACTIVE'`,
            )
        )
        .groupBy(receipts.spendingGroupId);

    const spentMap = new Map(spentRows.map((r) => [r.groupId, Number(r.spent)]));

    return groups.map((g) => {
        const isCanteen = g.module === "canteen";
        const rawLimit = isCanteen ? dailyLimitCanteen : dailyLimitStore;
        // Parent-set override takes priority; otherwise fall back to this
        // group's own configured daily_limit (never null — the column is
        // NOT NULL — so every grade-matched group always has a real limit).
        const effectiveLimit = rawLimit != null ? Number(rawLimit) : (pgNumber(g.dailyLimit) ?? 0);
        const spent = spentMap.get(g.id) ?? 0;
        return {
            spending_group_id: g.id,
            code: g.code,
            name_en: g.nameEn,
            name_th: g.nameTh,
            daily_limit: effectiveLimit,
            spent_today: spent,
            remaining: Math.max(0, effectiveLimit - spent),
        };
    });
}

export async function getSpendingGroupUsageToday(
    groupId: number,
    customerId: number | null,
    userId: number | null,
): Promise<SpendingGroupUsage> {
    const groupRows = await db.select().from(spendingGroups).where(eq(spendingGroups.id, groupId)).limit(1);
    if (!groupRows[0]) {
        const err = new Error("Spending group not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const group = groupRows[0];
    const groupDefault = pgNumber(group.dailyLimit) ?? 0;

    // Module derived from this group's linked shops (MIN picks "canteen"
    // over "store" if a group is ever linked across mixed modules). A group
    // with no linked shops yet has no derivable module — falls through to
    // the group's own default without a canteen/store override lookup.
    const moduleRows = await db
        .select({ module: sql<string>`MIN(${shops.module})` })
        .from(shopSpendingGroups)
        .innerJoin(shops, eq(shops.id, shopSpendingGroups.shopId))
        .where(eq(shopSpendingGroups.spendingGroupId, groupId));
    const groupModule: string | null = moduleRows[0]?.module ?? null;

    let effectiveLimit: number;
    if (customerId) {
        const cRows = await db
            .select({ dailyLimitCanteen: customers.dailyLimitCanteen, dailyLimitStore: customers.dailyLimitStore })
            .from(customers)
            .where(eq(customers.id, customerId))
            .limit(1);
        if (!cRows[0]) {
            const err = new Error("Customer not found");
            (err as { status?: number }).status = 404;
            throw err;
        }
        const raw = groupModule === "canteen" ? cRows[0].dailyLimitCanteen : cRows[0].dailyLimitStore;
        // Customer's personal limit takes priority. Fall back to the group's default
        // when the customer has no override configured (null) — keeps the chip useful
        // even when limits aren't tuned per student.
        effectiveLimit = raw != null ? Number(raw) : groupDefault;
    } else {
        effectiveLimit = groupDefault;
    }

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const cond = customerId
        ? and(
            eq(receipts.customerId, customerId),
            eq(receipts.spendingGroupId, groupId),
            eq(receipts.transactionDate, today),
            sql`${receipts.status} = 'ACTIVE'`,
        )
        : and(
            eq(receipts.payerUserId, userId!),
            eq(receipts.spendingGroupId, groupId),
            eq(receipts.transactionDate, today),
            sql`${receipts.status} = 'ACTIVE'`,
        );

    const spentRows = await db
        .select({ spent: sql<string>`COALESCE(SUM(${receipts.total}), '0')` })
        .from(receipts)
        .where(cond);
    const spent = Number(spentRows[0]?.spent ?? 0);

    return {
        spending_group_id: group.id,
        code: group.code,
        name_en: group.nameEn,
        name_th: group.nameTh,
        daily_limit: effectiveLimit,
        spent_today: spent,
        remaining: Math.max(0, effectiveLimit - spent),
    };
}
