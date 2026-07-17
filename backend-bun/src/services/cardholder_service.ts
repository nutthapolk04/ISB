import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { users, customers, departments, wallets, syncLogs, syncAuditLogs, customerTypes, shops } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import { createDepartment } from "@/services/department_service";

export type CardholderKind = "student" | "parent" | "staff" | "department" | "other";

export interface CardholderDTO {
    key: string;
    kind: CardholderKind;
    entity_type: "user" | "customer" | "department";
    entity_id: number;
    name: string;
    identifier: string;
    photo_url: string | null;
    family_code: string | null;
    external_id: string | null;
    card_uid: string | null;
    wallet_id: number | null;
    wallet_balance: number | null;
    is_active: boolean;
    is_graduated: boolean;
    role: string | null;
    shop_id: string | null;
    grade: string | null;
    school_type: string | null;
    allergies: string | null;
    department_code: string | null;
    synced_at: string | null;
}

export interface CardholderListResponseDTO {
    items: CardholderDTO[];
    total: number;
    /**
     * Count per kind across the FULL matching set (before pagination) — the
     * frontend's kind badges/stats read this instead of tallying `items`,
     * since `items` is only one page. Rows are sorted alphabetically by kind
     * before slicing, so on a school with hundreds of parents, a page_size
     * of 500 can fill up entirely with "parent" rows (which sort before
     * "staff"/"student") and never even reach the later kinds — undercounting
     * them to 0 if counted from `items` alone.
     */
    counts: Record<CardholderKind, number>;
    /** Always the FULL student roster (customer_kind='student'), independent
     * of the active kind/search/shop filters — mirrors the pre-rewrite
     * behaviour where these KPIs came from the whole fetched set, not
     * whatever page happened to be showing. */
    studentStats: { total: number; withCard: number; noFamilyCode: number };
    /** Distinct grades across the full student roster — populates the grade
     * filter dropdown; would be incomplete if derived from one page only. */
    grades: string[];
}

const STAFF_ROLES = new Set(["cashier", "manager", "kitchen", "staff"]);

function blank(): Omit<CardholderDTO, "key" | "kind" | "entity_type" | "entity_id" | "name" | "identifier"> {
    return {
        photo_url: null,
        family_code: null,
        external_id: null,
        card_uid: null,
        wallet_id: null,
        wallet_balance: null,
        is_active: true,
        is_graduated: false,
        role: null,
        shop_id: null,
        grade: null,
        school_type: null,
        allergies: null,
        department_code: null,
        synced_at: null,
    };
}

// ── Per-source query builders ────────────────────────────────────────────
// Each kind is backed by SQL-level WHERE + ORDER BY + LIMIT/OFFSET so a page
// never requires fetching (or even counting-in-memory) the full table — this
// matters once a school's combined cardholder count runs into the thousands.

type UserKind = "staff" | "parent";
type CustomerKind = "student" | "other";

function userRoleSetFor(kind: UserKind): string[] {
    return kind === "parent" ? ["parent"] : [...STAFF_ROLES, "admin"];
}

function userSearchCond(pattern: string | null) {
    if (!pattern) return undefined;
    return or(
        ilike(users.username, pattern),
        ilike(users.fullName, pattern),
        ilike(users.email, pattern),
        ilike(users.externalId, pattern),
        ilike(users.familyCode, pattern),
    );
}

function userWhere(kind: UserKind, pattern: string | null, shopId?: string | null) {
    const conds = [inArray(users.role, userRoleSetFor(kind))];
    if (shopId) conds.push(eq(users.shopId, shopId));
    const s = userSearchCond(pattern);
    if (s) conds.push(s);
    return and(...conds)!;
}

async function countUsers(kind: UserKind, pattern: string | null, shopId?: string | null): Promise<number> {
    const rows = await db.select({ n: sql<string>`COUNT(*)` }).from(users).where(userWhere(kind, pattern, shopId));
    return Number(rows[0]?.n ?? 0);
}

async function toUserDTOs(uRows: Array<typeof users.$inferSelect>): Promise<CardholderDTO[]> {
    const userIds = uRows.map((u) => u.id);
    const userWalletRows = userIds.length > 0
        ? await db.select().from(wallets).where(inArray(wallets.userId, userIds))
        : [];
    const walletByUser = new Map<number, typeof wallets.$inferSelect>();
    for (const w of userWalletRows) if (w.userId !== null) walletByUser.set(w.userId, w);
    return uRows.map((u) => {
        const w = walletByUser.get(u.id) ?? null;
        const role = u.role ?? "";
        const kind: CardholderKind = role === "parent" ? "parent" : "staff";
        return {
            ...blank(),
            key: `u-${u.id}`,
            kind,
            entity_type: "user" as const,
            entity_id: u.id,
            name: u.fullName,
            identifier: u.username,
            photo_url: u.photoUrl ?? null,
            family_code: u.familyCode ?? null,
            external_id: u.externalId ?? null,
            card_uid: u.cardUid ?? null,
            wallet_id: w?.id ?? null,
            wallet_balance: w ? pgNumber(w.balance) : null,
            is_active: u.isActive,
            role: role || null,
            shop_id: u.shopId ?? null,
            synced_at: u.lastSyncedAt ? pgToIso(u.lastSyncedAt) : null,
        };
    });
}

async function fetchUsersPage(kind: UserKind, pattern: string | null, offset: number, limit: number, shopId?: string | null): Promise<CardholderDTO[]> {
    if (limit <= 0) return [];
    const uRows = await db.select().from(users).where(userWhere(kind, pattern, shopId))
        .orderBy(asc(users.fullName)).limit(limit).offset(offset);
    return toUserDTOs(uRows);
}

function customerSearchCond(pattern: string | null) {
    if (!pattern) return undefined;
    return or(
        ilike(customers.name, pattern),
        ilike(customers.customerCode, pattern),
        ilike(customers.studentCode, pattern),
        ilike(customers.externalId, pattern),
        ilike(customers.familyCode, pattern),
    );
}

function customerWhere(kind: CustomerKind, pattern: string | null, schoolType?: string | null, grade?: string | null) {
    const conds = [kind === "student" ? eq(customers.customerKind, "student") : notInArray(customers.customerKind, ["student"])];
    if (kind === "student") {
        if (schoolType) conds.push(eq(customers.schoolType, schoolType));
        if (grade) conds.push(eq(customers.grade, grade));
    }
    const s = customerSearchCond(pattern);
    if (s) conds.push(s);
    return and(...conds)!;
}

async function countCustomers(kind: CustomerKind, pattern: string | null, schoolType?: string | null, grade?: string | null): Promise<number> {
    const rows = await db.select({ n: sql<string>`COUNT(*)` }).from(customers).where(customerWhere(kind, pattern, schoolType, grade));
    return Number(rows[0]?.n ?? 0);
}

async function toCustomerDTOs(cRows: Array<typeof customers.$inferSelect>): Promise<CardholderDTO[]> {
    const customerIds = cRows.map((c) => c.id);
    const custWalletRows = customerIds.length > 0
        ? await db.select().from(wallets).where(inArray(wallets.customerId, customerIds))
        : [];
    const walletByCust = new Map<number, typeof wallets.$inferSelect>();
    for (const w of custWalletRows) if (w.customerId !== null) walletByCust.set(w.customerId, w);
    return cRows.map((c) => {
        const w = walletByCust.get(c.id) ?? null;
        const rawKind = (c.customerKind ?? "other").toLowerCase();
        const kind: CardholderKind = (rawKind === "student" || rawKind === "department" || rawKind === "other")
            ? (rawKind as CardholderKind) : "other";
        return {
            ...blank(),
            key: `c-${c.id}`,
            kind,
            entity_type: "customer" as const,
            entity_id: c.id,
            name: c.name,
            identifier: c.studentCode ?? c.customerCode,
            photo_url: c.photoUrl ?? null,
            family_code: c.familyCode ?? null,
            external_id: c.externalId ?? null,
            card_uid: c.cardUid ?? null,
            wallet_id: w?.id ?? null,
            wallet_balance: w ? pgNumber(w.balance) : null,
            is_active: c.isActive,
            is_graduated: !!(c as { isGraduated?: boolean }).isGraduated,
            grade: c.grade ?? null,
            school_type: c.schoolType ?? null,
            allergies: c.allergies ?? null,
            synced_at: c.powerschoolSyncAt ? pgToIso(c.powerschoolSyncAt) : null,
        };
    });
}

async function fetchCustomersPage(
    kind: CustomerKind, pattern: string | null, offset: number, limit: number,
    schoolType?: string | null, grade?: string | null,
): Promise<CardholderDTO[]> {
    if (limit <= 0) return [];
    const cRows = await db.select().from(customers).where(customerWhere(kind, pattern, schoolType, grade))
        .orderBy(asc(customers.name)).limit(limit).offset(offset);
    return toCustomerDTOs(cRows);
}

function departmentSearchCond(pattern: string | null) {
    if (!pattern) return undefined;
    return or(ilike(departments.departmentCode, pattern), ilike(departments.departmentName, pattern));
}

async function countDepartments(pattern: string | null): Promise<number> {
    const cond = departmentSearchCond(pattern);
    const rows = cond
        ? await db.select({ n: sql<string>`COUNT(*)` }).from(departments).where(cond)
        : await db.select({ n: sql<string>`COUNT(*)` }).from(departments);
    return Number(rows[0]?.n ?? 0);
}

async function toDepartmentDTOs(dRows: Array<typeof departments.$inferSelect>): Promise<CardholderDTO[]> {
    const deptIds = dRows.map((d) => d.id);
    const deptWalletRows = deptIds.length > 0
        ? await db.select().from(wallets).where(inArray(wallets.departmentId, deptIds))
        : [];
    const walletByDept = new Map<number, typeof wallets.$inferSelect>();
    for (const w of deptWalletRows) if (w.departmentId !== null) walletByDept.set(w.departmentId, w);
    return dRows.map((d) => {
        const w = walletByDept.get(d.id) ?? null;
        return {
            ...blank(),
            key: `d-${d.id}`,
            kind: "department" as const,
            entity_type: "department" as const,
            entity_id: d.id,
            name: d.departmentName,
            identifier: d.departmentCode,
            wallet_id: w?.id ?? null,
            wallet_balance: w ? pgNumber(w.balance) : null,
            is_active: d.isActive,
            department_code: d.departmentCode,
        };
    });
}

async function fetchDepartmentsPage(pattern: string | null, offset: number, limit: number): Promise<CardholderDTO[]> {
    if (limit <= 0) return [];
    const cond = departmentSearchCond(pattern);
    const base = db.select().from(departments);
    const dRows = cond
        ? await base.where(cond).orderBy(asc(departments.departmentName)).limit(limit).offset(offset)
        : await base.orderBy(asc(departments.departmentName)).limit(limit).offset(offset);
    return toDepartmentDTOs(dRows);
}

/** Count per kind across the FULL matching set — respects search, NOT the
 * kind filter itself (badges must show every kind's true count regardless of
 * which tab is active), and NOT the student-only school/grade sub-filters
 * (those never affected the other kinds' badges even before this rewrite). */
async function getCounts(pattern: string | null): Promise<Record<CardholderKind, number>> {
    const [staffN, parentN, studentN, otherN, deptN] = await Promise.all([
        countUsers("staff", pattern),
        countUsers("parent", pattern),
        countCustomers("student", pattern),
        countCustomers("other", pattern),
        countDepartments(pattern),
    ]);
    return { staff: staffN, parent: parentN, student: studentN, other: otherN, department: deptN };
}

/** Full-roster KPIs for the student tab — never scoped to search/kind/page,
 * matching the pre-rewrite behaviour of computing these from the whole
 * fetched set rather than whatever page happened to be loaded. */
async function getStudentStats(): Promise<{ total: number; withCard: number; noFamilyCode: number }> {
    const rows = await db.select({
        total: sql<string>`COUNT(*)`,
        withCard: sql<string>`COUNT(*) FILTER (WHERE ${customers.cardUid} IS NOT NULL AND ${customers.cardUid} != '')`,
        noFamilyCode: sql<string>`COUNT(*) FILTER (WHERE ${customers.familyCode} IS NULL)`,
    }).from(customers).where(eq(customers.customerKind, "student"));
    const r = rows[0];
    return {
        total: Number(r?.total ?? 0),
        withCard: Number(r?.withCard ?? 0),
        noFamilyCode: Number(r?.noFamilyCode ?? 0),
    };
}

async function getGrades(): Promise<string[]> {
    const rows = await db.selectDistinct({ grade: customers.grade }).from(customers)
        .where(and(eq(customers.customerKind, "student"), sql`${customers.grade} IS NOT NULL`));
    return rows.map((r) => r.grade).filter((g): g is string => !!g).sort();
}

const KIND_ORDER: CardholderKind[] = ["department", "other", "parent", "staff", "student"];

export async function listCardholders(args: {
    kind?: string | null;
    /** Drops one kind from the "all" merge (e.g. Wallet Adjustment's picker
     * excludes department — that's adjusted via the dedicated Dept Wallet
     * Adjust page). Ignored when `kind` selects a single kind directly. */
    excludeKind?: string | null;
    q?: string | null;
    schoolType?: string | null;
    grade?: string | null;
    shopId?: string | null;
    page: number;
    pageSize: number;
}): Promise<CardholderListResponseDTO> {
    const pattern = args.q && args.q.trim() ? `%${args.q.trim()}%` : null;
    const kindFilter = (args.kind && args.kind !== "all" ? args.kind : null) as CardholderKind | null;

    // shopId (from ShopDetail's "Manage shop staff" link) only ever scoped the
    // staff *table* before this rewrite — the kind badges always showed
    // school-wide counts regardless, so `counts` stays unscoped here too.
    const [counts, studentStats, grades] = await Promise.all([
        getCounts(pattern),
        getStudentStats(),
        getGrades(),
    ]);
    const offset = (args.page - 1) * args.pageSize;

    if (kindFilter !== null) {
        // Single kind selected — one real SQL query, paginated at the DB level.
        // `total` reflects this kind's own filtered count (school/grade included
        // for students), which is why it's fetched separately from `counts`.
        let items: CardholderDTO[];
        let total: number;
        if (kindFilter === "staff" || kindFilter === "parent") {
            [items, total] = await Promise.all([
                fetchUsersPage(kindFilter, pattern, offset, args.pageSize, args.shopId),
                countUsers(kindFilter, pattern, args.shopId),
            ]);
        } else if (kindFilter === "department") {
            [items, total] = await Promise.all([
                fetchDepartmentsPage(pattern, offset, args.pageSize),
                countDepartments(pattern),
            ]);
        } else {
            [items, total] = await Promise.all([
                fetchCustomersPage(kindFilter, pattern, offset, args.pageSize, args.schoolType, args.grade),
                countCustomers(kindFilter, pattern, args.schoolType, args.grade),
            ]);
        }
        return { items, total, counts, studentStats, grades };
    }

    // "All" tab: merge across kinds in the same alphabetical-by-kind order the
    // UI has always used, but resolve it via each kind's own count instead of
    // fetching every row — never pulls more than one page's worth (plus the
    // cheap COUNT queries above) regardless of total dataset size.
    const activeKinds = args.excludeKind
        ? KIND_ORDER.filter((k) => k !== args.excludeKind)
        : KIND_ORDER;
    const globalStart = offset;
    const globalEnd = globalStart + args.pageSize;
    let cursor = 0;
    const items: CardholderDTO[] = [];
    for (const k of activeKinds) {
        const kStart = cursor;
        const kEnd = cursor + counts[k];
        cursor = kEnd;
        const overlapStart = Math.max(kStart, globalStart);
        const overlapEnd = Math.min(kEnd, globalEnd);
        if (overlapStart >= overlapEnd) continue;
        const localOffset = overlapStart - kStart;
        const localLimit = overlapEnd - overlapStart;
        if (k === "staff" || k === "parent") {
            items.push(...await fetchUsersPage(k, pattern, localOffset, localLimit, args.shopId));
        } else if (k === "department") {
            items.push(...await fetchDepartmentsPage(pattern, localOffset, localLimit));
        } else {
            items.push(...await fetchCustomersPage(k, pattern, localOffset, localLimit));
        }
        if (cursor >= globalEnd) break;
    }
    const total = activeKinds.reduce((s, k) => s + counts[k], 0);
    return { items, total, counts, studentStats, grades };
}

// ── Sync log + audit reads (mirrors admin_cardholders.py sync-log endpoints) ──

export interface SyncStatusDTO {
    sync_log_id: number;
    sync_type: string;
    status: string;
    target_roles: string[];
    started_at: string;
    finished_at: string | null;
    records_total: number;
    records_success: number;
    records_failed: number;
    error_log: string | null;
}

function toSyncStatus(r: typeof syncLogs.$inferSelect): SyncStatusDTO {
    return {
        sync_log_id: r.id,
        sync_type: r.syncType,
        status: r.status,
        target_roles: Array.isArray(r.targetRoles) ? (r.targetRoles as string[]) : [],
        started_at: pgToIso(r.startedAt)!,
        finished_at: r.finishedAt ? pgToIso(r.finishedAt) : null,
        records_total: r.recordsTotal,
        records_success: r.recordsSuccess,
        records_failed: r.recordsFailed,
        error_log: r.errorLog ?? null,
    };
}

export async function getSyncLog(syncLogId: number): Promise<SyncStatusDTO> {
    const rows = await db.select().from(syncLogs).where(eq(syncLogs.id, syncLogId)).limit(1);
    if (!rows[0]) {
        const err = new Error("Sync log not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return toSyncStatus(rows[0]);
}

export async function listSyncStatuses(limit: number): Promise<SyncStatusDTO[]> {
    const rows = await db.select().from(syncLogs).orderBy(desc(syncLogs.startedAt)).limit(limit);
    return rows.map(toSyncStatus);
}

export interface SyncAuditEntryDTO {
    id: number;
    sync_log_id: number;
    entity_type: string;
    entity_id: number;
    entity_name: string | null;
    external_id: string | null;
    action: string;
    changes: unknown;
    created_at: string;
}

// ── Create cardholder (polymorphic by kind) ────────────────────────────────

const WALLET_USER_ROLES = new Set(["parent", "cashier", "manager", "kitchen", "admin", "staff"]);

export interface CreateCardholderInput {
    kind: CardholderKind;
    name?: string | null;
    family_code?: string | null;
    card_uid?: string | null;
    customer_code?: string | null;
    student_code?: string | null;
    grade?: string | null;
    school_type?: string | null;
    initial_balance?: number | null;
    username?: string | null;
    email?: string | null;
    password?: string | null;
    role?: string | null;
    shop_id?: string | null;
    department_code?: string | null;
    department_name?: string | null;
    initial_credit?: number | null;
    phone?: string | null;
    with_wallet?: boolean | null;
    /** Employee/Student/Visitor ID — stored as external_id on users/customers. Not applicable to parent or department. */
    external_id?: string | null;
}

function badRequest(msg: string): never {
    const err = new Error(msg);
    (err as { status?: number }).status = 400;
    throw err;
}
function conflict(msg: string): never {
    const err = new Error(msg);
    (err as { status?: number }).status = 409;
    throw err;
}

async function ensureCustomerTypeId(typeName: "INTERNAL" | "PUBLIC"): Promise<number> {
    // The customer_types.type_name column is the customertypeenum which only
    // accepts UPPERCASE values (PUBLIC, INTERNAL). The earlier "Internal" /
    // "Public" literals here are a leftover from the SQLAlchemy enum which
    // stored the Python name. Sending Title-case here trips the pg enum
    // check and the error bubbles up as the cryptic "Failed query" toast.
    const rows = await db.select().from(customerTypes).where(eq(customerTypes.typeName, typeName)).limit(1);
    if (rows[0]) return rows[0].id;
    const priceLevel = typeName === "INTERNAL" ? "internal" : "retail";
    const description = typeName === "INTERNAL" ? "Internal" : "Public/visitor";
    const [created] = await db.insert(customerTypes).values({
        typeName,
        description,
        defaultPriceLevel: priceLevel,
    }).returning();
    return created.id;
}

export async function createCardholder(input: CreateCardholderInput): Promise<CardholderDTO> {
    const kind = input.kind;

    if (kind === "student") {
        if (!input.customer_code || !input.name) badRequest("customer_code and name are required for student");
        const dup = await db.select({ id: customers.id }).from(customers).where(eq(customers.customerCode, input.customer_code!)).limit(1);
        if (dup[0]) conflict(`Customer code ${input.customer_code} exists`);
        const ctId = await ensureCustomerTypeId("INTERNAL");
        const initBalance = input.initial_balance ?? 0;

        const studentName = input.name!;

        let custId = 0;
        let walletId = 0;
        await pgClient.begin(async (sqlTx: any) => {
            const cins = await sqlTx<Array<{ id: number }>>`
        INSERT INTO customers
          (customer_code, name, student_code, grade, school_type, family_code,
           card_uid, customer_type_id, customer_kind, customer_type, is_active, card_frozen, external_id)
        VALUES (${input.customer_code}, ${input.name}, ${input.student_code ?? null},
                ${input.grade ?? null}, ${input.school_type ?? null}, ${input.family_code ?? null},
                ${input.card_uid ?? null}, ${ctId}, 'student', 'Student', true, false,
                ${input.external_id ?? null})
        RETURNING id
      `;
            custId = cins[0].id;
            const wins = await sqlTx<Array<{ id: number }>>`
        INSERT INTO wallets (customer_id, balance, is_active) VALUES (${custId}, ${initBalance}, true) RETURNING id
      `;
            walletId = wins[0].id;
            // Optional student user login
            if (input.student_code) {
                const studentCode = input.student_code;
                const exists = await sqlTx<Array<{ id: number }>>`SELECT id FROM users WHERE username = ${studentCode}`;
                if (!exists[0]) {
                    const hash = await Bun.password.hash("parent", { algorithm: "bcrypt", cost: 12 });
                    await sqlTx`
            INSERT INTO users (username, email, full_name, hashed_password, is_active, is_superuser,
                               role, status, customer_type, external_id, family_code)
            VALUES (${studentCode}, ${`${studentCode}@students.isb.ac.th`},
                    ${studentName}, ${hash}, true, false, 'student', 'active', 'Student',
                    ${studentCode}, ${input.family_code ?? null})
          `;
                }
            }
        });
        return {
            ...blank(),
            key: `c-${custId}`,
            kind: "student",
            entity_type: "customer",
            entity_id: custId,
            name: input.name!,
            identifier: input.student_code ?? input.customer_code!,
            family_code: input.family_code ?? null,
            card_uid: input.card_uid ?? null,
            wallet_id: walletId,
            wallet_balance: initBalance,
            grade: input.grade ?? null,
            school_type: input.school_type ?? null,
        };
    }

    if (kind === "parent" || kind === "staff") {
        if (!input.username || !input.name || !input.password) badRequest("username, name, password are required");
        const pw = input.password!;
        if (pw.length < 8) badRequest("Password must be at least 8 characters");
        const hasDigitOrSpecial = [...pw].some((c) => /\d/.test(c) || !/[a-zA-Z0-9]/.test(c));
        if (!hasDigitOrSpecial) badRequest("Password must contain at least one number or special character");
        const dup = await db.select({ id: users.id }).from(users).where(eq(users.username, input.username!)).limit(1);
        if (dup[0]) conflict(`Username ${input.username} exists`);
        const role = kind === "parent" ? "parent" : (input.role || "staff");
        if (!WALLET_USER_ROLES.has(role)) badRequest(`Invalid role ${role}`);
        if (input.shop_id) {
            const sr = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, input.shop_id)).limit(1);
            if (!sr[0]) badRequest(`Shop ${input.shop_id} not found`);
        }
        const hash = await Bun.password.hash(pw, { algorithm: "bcrypt", cost: 12 });

        let uid = 0;
        let walletId = 0;
        let balance = 0;
        await pgClient.begin(async (sqlTx: any) => {
            const uins = await sqlTx<Array<{ id: number }>>`
        INSERT INTO users (username, email, full_name, hashed_password, role, shop_id, family_code,
                           card_uid, is_active, is_superuser, status, external_id)
        VALUES (${input.username}, ${input.email || `${input.username}@isb-coop.local`},
                ${input.name}, ${hash}, ${role}, ${input.shop_id ?? null}, ${input.family_code ?? null},
                ${input.card_uid ?? null}, true, false, 'active', ${input.external_id ?? null})
        RETURNING id
      `;
            uid = uins[0].id;
            const wins = await sqlTx<Array<{ id: number; balance: string }>>`
        INSERT INTO wallets (user_id, balance, is_active) VALUES (${uid}, 0, true) RETURNING id, balance
      `;
            walletId = wins[0].id;
            balance = pgNumber(wins[0].balance) ?? 0;
        });
        return {
            ...blank(),
            key: `u-${uid}`,
            kind,
            entity_type: "user",
            entity_id: uid,
            name: input.name!,
            identifier: input.username!,
            family_code: input.family_code ?? null,
            card_uid: input.card_uid ?? null,
            wallet_id: walletId,
            wallet_balance: balance,
            role,
            shop_id: input.shop_id ?? null,
        };
    }

    if (kind === "department") {
        if (!input.department_code || !input.department_name) badRequest("department_code and department_name required");
        const d = await createDepartment({
            code: input.department_code!,
            name: input.department_name!,
            initialCredit: input.initial_credit ?? 0,
        });
        return {
            ...blank(),
            key: `d-${d.id}`,
            kind: "department",
            entity_type: "department",
            entity_id: d.id,
            name: d.name,
            identifier: d.code,
            wallet_id: d.walletId,
            wallet_balance: d.walletBalance,
            department_code: d.code,
        };
    }

    if (kind === "other") {
        if (!input.name) badRequest("name required for other");
        const ctId = await ensureCustomerTypeId("PUBLIC");
        const code = input.customer_code || `OTH-${Math.floor(Date.now() / 1000)}`;
        let custId = 0;
        let walletId: number | null = null;
        let balance: number | null = null;
        await pgClient.begin(async (sqlTx: any) => {
            const cins = await sqlTx<Array<{ id: number }>>`
        INSERT INTO customers
          (customer_code, name, email, phone, customer_type_id, customer_kind, customer_type, is_active, card_frozen, external_id)
        VALUES (${code}, ${input.name}, ${input.email ?? null}, ${input.phone ?? null},
                ${ctId}, 'other', 'Other', true, false, ${input.external_id ?? null})
        RETURNING id
      `;
            custId = cins[0].id;
            if (input.with_wallet) {
                const wins = await sqlTx<Array<{ id: number }>>`
          INSERT INTO wallets (customer_id, balance, is_active) VALUES (${custId}, 0, true) RETURNING id
        `;
                walletId = wins[0].id;
                balance = 0;
            }
        });
        return {
            ...blank(),
            key: `c-${custId}`,
            kind: "other",
            entity_type: "customer",
            entity_id: custId,
            name: input.name!,
            identifier: code,
            wallet_id: walletId,
            wallet_balance: balance,
        };
    }

    badRequest(`Unknown kind ${kind}`);
}

export async function listSyncAudit(syncLogId: number, action: string | null): Promise<SyncAuditEntryDTO[]> {
    const where = [eq(syncAuditLogs.syncLogId, syncLogId)];
    if (action) where.push(eq(syncAuditLogs.action, action));
    const rows = await db.select().from(syncAuditLogs).where(and(...where)).orderBy(asc(syncAuditLogs.id));
    return rows.map((r) => ({
        id: r.id,
        sync_log_id: r.syncLogId,
        entity_type: r.entityType,
        entity_id: r.entityId,
        entity_name: r.entityName ?? null,
        external_id: r.externalId ?? null,
        action: r.action,
        changes: r.changes ?? null,
        created_at: pgToIso(r.createdAt)!,
    }));
}
