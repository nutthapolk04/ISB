import { and, asc, desc, eq, inArray, ilike, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
    users,
    customers,
    shops,
    familyProfiles,
    identityMappings,
    parentChildLinks,
    wallets,
} from "@/db/schema";
import { pgToIso } from "@/lib/dates";

type UserRow = typeof users.$inferSelect;
type FamilyProfileRow = typeof familyProfiles.$inferSelect;

function statusErr(status: number, message: string): Error {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    return err;
}

function requireAdmin(callerRoles: string[]): void {
    if (!callerRoles.map((r) => r.toLowerCase()).includes("admin")) {
        throw statusErr(403, "Admin only");
    }
}

export interface UserListItemDTO {
    id: number;
    username: string;
    email: string | null;
    full_name: string;
    role: string | null;
    external_id: string | null;
    family_code: string | null;
    photo_url: string | null;
    status: string;
    is_active: boolean;
    last_synced_at: string | null;
    allergies: string | null;
    customer_type: string | null;
    staff_type: string | null;
    ps_department: string | null;
    card_uid: string | null;
    has_children: boolean;
    shop_id: string | null;
    shop_name: string | null;
}

export interface StaffPickerItemDTO {
    id: number;
    username: string;
    full_name: string;
    role: string | null;
    external_id: string | null;
    photo_url: string | null;
}

export interface StudentPickerItemDTO {
    id: number;
    name: string;
    student_code: string | null;
    customer_code: string;
    grade: string | null;
    family_code: string | null;
    external_id: string | null;
    school_type: string | null;
    card_uid: string | null;
}

async function familiesWithChildren(family_codes: Set<string>): Promise<Set<string>> {
    if (family_codes.size === 0) return new Set();
    const rows = await db
        .select({ fc: customers.familyCode })
        .from(customers)
        .where(and(inArray(customers.familyCode, [...family_codes]), isNotNull(customers.studentCode)));
    const out = new Set<string>();
    for (const r of rows) if (r.fc) out.add(r.fc);
    return out;
}

async function shopNameMap(): Promise<Map<string, string>> {
    const rows = await db.select({ id: shops.id, name: shops.name }).from(shops);
    return new Map(rows.map((r) => [r.id, r.name]));
}

export interface ListAdminUsersParams {
    role?: string | null;
    q?: string | null;
    status?: string | null;
}

export async function listAdminUsers(p: ListAdminUsersParams = {}): Promise<UserListItemDTO[]> {
    const conds = [];
    if (p.role) conds.push(eq(users.role, p.role));
    if (p.status) conds.push(eq(users.status, p.status));
    if (p.q?.trim()) {
        const pat = `%${p.q.trim().toLowerCase()}%`;
        conds.push(
            or(
                ilike(users.fullName, pat),
                ilike(users.username, pat),
                ilike(users.email, pat),
                ilike(users.externalId, pat),
                ilike(users.cardUid, pat),
            )!,
        );
    }

    const rows = await db
        .select()
        .from(users)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(asc(users.id));

    const familyCodes = new Set<string>();
    for (const u of rows) if (u.familyCode) familyCodes.add(u.familyCode);
    const [withKids, shopNames] = await Promise.all([
        familiesWithChildren(familyCodes),
        shopNameMap(),
    ]);

    return rows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email ?? null,
        full_name: u.fullName,
        role: u.role ?? null,
        external_id: u.externalId ?? null,
        family_code: u.familyCode ?? null,
        photo_url: u.photoUrl ?? null,
        status: u.status || (u.isActive ? "active" : "inactive"),
        is_active: u.isActive,
        last_synced_at: pgToIso(u.lastSyncedAt),
        allergies: u.allergies ?? null,
        customer_type: u.customerType ?? null,
        staff_type: u.staffType ?? null,
        ps_department: u.psDepartment ?? null,
        card_uid: u.cardUid ?? null,
        has_children: !!(u.familyCode && withKids.has(u.familyCode)),
        shop_id: u.shopId ?? null,
        shop_name: u.shopId ? shopNames.get(u.shopId) ?? null : null,
    }));
}

export async function listStaffForPicker(args: {
    q?: string | null;
    roles?: string | null;
}): Promise<StaffPickerItemDTO[]> {
    const roleList = (
        args.roles?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
            "staff",
            "manager",
            "cashier",
            "kitchen",
            "admin",
        ]
    );

    const conds = [inArray(users.role, roleList), eq(users.isActive, true)];
    if (args.q?.trim()) {
        const pat = `%${args.q.trim().toLowerCase()}%`;
        conds.push(
            or(ilike(users.fullName, pat), ilike(users.username, pat), ilike(users.externalId, pat))!,
        );
    }

    const rows = await db
        .select()
        .from(users)
        .where(and(...conds))
        .orderBy(asc(users.fullName))
        .limit(200);

    return rows.map((u) => ({
        id: u.id,
        username: u.username,
        full_name: u.fullName,
        role: u.role ?? null,
        external_id: u.externalId ?? null,
        photo_url: u.photoUrl ?? null,
    }));
}

export async function listStudentsForLink(q?: string | null): Promise<StudentPickerItemDTO[]> {
    const conds = [isNotNull(customers.studentCode)];
    if (q?.trim()) {
        const pat = `%${q.trim().toLowerCase()}%`;
        conds.push(
            or(
                ilike(customers.name, pat),
                ilike(customers.studentCode, pat),
                ilike(customers.customerCode, pat),
                ilike(customers.externalId, pat),
            )!,
        );
    }

    const rows = await db
        .select()
        .from(customers)
        .where(and(...conds))
        .orderBy(asc(customers.id))
        .limit(200);

    return rows.map((c) => ({
        id: c.id,
        name: c.name,
        student_code: c.studentCode ?? null,
        customer_code: c.customerCode,
        grade: c.grade ?? null,
        family_code: c.familyCode ?? null,
        external_id: c.externalId ?? null,
        school_type: c.schoolType ?? null,
        card_uid: c.cardUid ?? null,
    }));
}

// ── Detail helpers ──────────────────────────────────────────────────────────

export interface FamilyMemberDTO {
    entity_type: "user" | "customer";
    id: number;
    name: string;
    role: string | null;
    external_id: string | null;
    grade?: string | null;
    photo_url: string | null;
    student_code?: string | null;
    customer_code?: string | null;
    customer_type: string | null;
    school_type?: string | null;
    card_uid: string | null;
    parent_rank?: string | null;
}

export interface FamilyProfileDTO {
    family_code: string;
    notification_emails: string[];
    login_ids: string[];
    last_synced_at: string | null;
}

export interface IdentityHistoryDTO {
    id: number;
    entity_type: string;
    old_external_id: string | null;
    new_external_id: string | null;
    reason: string | null;
    changed_by_name: string | null;
    changed_at: string | null;
}

export interface UserDetailDTO {
    id: number;
    username: string;
    email: string | null;
    full_name: string;
    role: string | null;
    external_id: string | null;
    family_code: string | null;
    photo_url: string | null;
    status: string;
    is_active: boolean;
    last_synced_at: string | null;
    allergies: string | null;
    customer_type: string | null;
    staff_type: string | null;
    ps_department: string | null;
    card_uid: string | null;
    has_children: boolean;
    family_profile: FamilyProfileDTO | null;
    family_members: FamilyMemberDTO[];
    identity_history: IdentityHistoryDTO[];
    shop_id: string | null;
    shop_name: string | null;
    wallet_balance: number | null;
}

async function parentRankMap(family_code: string | null): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (!family_code) return out;
    const rows = await db
        .select({ parentUserId: parentChildLinks.parentUserId, parentRank: parentChildLinks.parentRank })
        .from(parentChildLinks)
        .innerJoin(customers, eq(customers.id, parentChildLinks.childCustomerId))
        .where(eq(customers.familyCode, family_code));
    for (const r of rows) {
        if (r.parentRank && !out.has(r.parentUserId)) out.set(r.parentUserId, r.parentRank);
    }
    return out;
}

async function resolveFamily(family_code: string | null): Promise<FamilyMemberDTO[]> {
    if (!family_code) return [];
    const [userRows, ranks] = await Promise.all([
        // Excludes role="student" — a student's own login user row (for
        // kiosk/parent-portal auth) carries the same family_code as their
        // parents, but is a stale leftover once orphaned (see
        // reconcileFamilyStudents' known-gap comment in powerschool_sync.ts)
        // if it isn't cleared there too. Mirrors family_service.ts's
        // myCoparents(), which already excludes students the same way.
        db.select().from(users).where(and(eq(users.familyCode, family_code), ne(users.role, "student"))),
        parentRankMap(family_code),
    ]);
    const members: FamilyMemberDTO[] = [];
    for (const u of userRows) {
        members.push({
            entity_type: "user",
            id: u.id,
            name: u.fullName,
            role: u.role ?? null,
            external_id: u.externalId ?? null,
            photo_url: u.photoUrl ?? null,
            customer_type: u.customerType ?? null,
            card_uid: u.cardUid ?? null,
            parent_rank: ranks.get(u.id) ?? null,
        });
    }

    // Use parent_child_links as source of truth for customer members — avoids stale
    // family_code on customers that can persist after link deletion or PS sync.
    const parentUserIds = userRows.map((u) => u.id);
    if (parentUserIds.length > 0) {
        const custRows = await db
            .select({
                id: customers.id,
                name: customers.name,
                externalId: customers.externalId,
                grade: customers.grade,
                photoUrl: customers.photoUrl,
                studentCode: customers.studentCode,
                customerCode: customers.customerCode,
                customerType: customers.customerType,
                schoolType: customers.schoolType,
                cardUid: customers.cardUid,
            })
            .from(parentChildLinks)
            .innerJoin(customers, eq(customers.id, parentChildLinks.childCustomerId))
            .where(inArray(parentChildLinks.parentUserId, parentUserIds));

        // Deduplicate by customer id (child may be linked to both parents in the family)
        const seenIds = new Set<number>();
        for (const c of custRows) {
            if (seenIds.has(c.id)) continue;
            seenIds.add(c.id);
            members.push({
                entity_type: "customer",
                id: c.id,
                name: c.name,
                role: "student",
                external_id: c.externalId ?? null,
                grade: c.grade ?? null,
                photo_url: c.photoUrl ?? null,
                student_code: c.studentCode ?? null,
                customer_code: c.customerCode,
                customer_type: c.customerType ?? null,
                school_type: c.schoolType ?? null,
                card_uid: c.cardUid ?? null,
            });
        }
    }

    // Remove user-entity entries whose external_id is already covered by a customer
    // entity — student user accounts (for kiosk/parent-portal login) would otherwise
    // duplicate the customer record that holds the canonical student data.
    const customerExtIds = new Set(
        members.filter((m) => m.entity_type === "customer" && m.external_id).map((m) => m.external_id!),
    );
    return members.filter(
        (m) => m.entity_type !== "user" || !m.external_id || !customerExtIds.has(m.external_id),
    );
}

async function identityHistory(entity_type: string, entity_id: number): Promise<IdentityHistoryDTO[]> {
    const rows = await db
        .select()
        .from(identityMappings)
        .where(and(eq(identityMappings.entityType, entity_type), eq(identityMappings.entityId, entity_id)))
        .orderBy(desc(identityMappings.changedAt));
    const ids = rows.map((r) => r.changedBy).filter((v): v is number => v !== null);
    const nameMap = new Map<number, string>();
    if (ids.length) {
        const ur = await db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .where(inArray(users.id, ids));
        for (const u of ur) nameMap.set(u.id, u.fullName);
    }
    return rows.map((r) => ({
        id: r.id,
        entity_type: r.entityType,
        old_external_id: r.oldExternalId ?? null,
        new_external_id: r.newExternalId ?? null,
        reason: r.reason ?? null,
        changed_by_name: r.changedBy ? nameMap.get(r.changedBy) ?? null : null,
        changed_at: pgToIso(r.changedAt),
    }));
}

async function getFamilyProfile(family_code: string | null): Promise<FamilyProfileDTO | null> {
    if (!family_code) return null;
    const rows = await db
        .select()
        .from(familyProfiles)
        .where(eq(familyProfiles.familyCode, family_code))
        .limit(1);
    const fp = rows[0];
    if (!fp) return null;
    return {
        family_code: fp.familyCode,
        notification_emails: Array.isArray(fp.notificationEmails) ? (fp.notificationEmails as string[]) : [],
        login_ids: Array.isArray(fp.loginIds) ? (fp.loginIds as string[]) : [],
        last_synced_at: pgToIso(fp.lastSyncedAt),
    };
}

async function buildDetail(u: UserRow): Promise<UserDetailDTO> {
    const fcode = u.familyCode ?? null;
    const [withKids, familyProfile, familyMembers, linkedChildren, history, shopName, walletRow] = await Promise.all([
        fcode ? familiesWithChildren(new Set([fcode])) : Promise.resolve(new Set<string>()),
        getFamilyProfile(fcode),
        resolveFamily(fcode),
        // Always fetch children via parent_child_links — independent of family_code
        db
            .select({
                id: customers.id,
                name: customers.name,
                studentCode: customers.studentCode,
                customerCode: customers.customerCode,
                grade: customers.grade,
                photoUrl: customers.photoUrl,
                externalId: customers.externalId,
                customerType: customers.customerType,
                schoolType: customers.schoolType,
                cardUid: customers.cardUid,
                relation: parentChildLinks.relation,
            })
            .from(parentChildLinks)
            .innerJoin(customers, eq(customers.id, parentChildLinks.childCustomerId))
            .where(eq(parentChildLinks.parentUserId, u.id)),
        identityHistory("user", u.id),
        u.shopId
            ? db
                .select({ name: shops.name })
                .from(shops)
                .where(eq(shops.id, u.shopId))
                .limit(1)
                .then((rs) => rs[0]?.name ?? null)
            : Promise.resolve(null),
        db
            .select({ balance: wallets.balance })
            .from(wallets)
            .where(eq(wallets.userId, u.id))
            .limit(1)
            .then((rs) => rs[0]?.balance ?? null),
    ]);

    // Merge: add linked children not already in family_members (by id)
    const existingCustomerIds = new Set(
        familyMembers.filter((m) => m.entity_type === "customer").map((m) => m.id),
    );
    for (const c of linkedChildren) {
        if (!existingCustomerIds.has(c.id)) {
            familyMembers.push({
                entity_type: "customer",
                id: c.id,
                name: c.name,
                role: "student",
                external_id: c.externalId ?? null,
                grade: c.grade ?? null,
                photo_url: c.photoUrl ?? null,
                student_code: c.studentCode ?? null,
                customer_code: c.customerCode,
                customer_type: c.customerType ?? null,
                school_type: c.schoolType ?? null,
                card_uid: c.cardUid ?? null,
            });
        }
    }

    const hasChildren = linkedChildren.length > 0 || !!(fcode && withKids.has(fcode));

    return {
        id: u.id,
        username: u.username,
        email: u.email ?? null,
        full_name: u.fullName,
        role: u.role ?? null,
        external_id: u.externalId ?? null,
        family_code: fcode,
        photo_url: u.photoUrl ?? null,
        status: u.status || (u.isActive ? "active" : "inactive"),
        is_active: u.isActive,
        last_synced_at: pgToIso(u.lastSyncedAt),
        allergies: u.allergies ?? null,
        customer_type: u.customerType ?? null,
        staff_type: u.staffType ?? null,
        ps_department: u.psDepartment ?? null,
        card_uid: u.cardUid ?? null,
        has_children: hasChildren,
        family_profile: familyProfile,
        family_members: familyMembers,
        identity_history: history,
        shop_id: u.shopId ?? null,
        shop_name: shopName,
        wallet_balance: walletRow !== null ? parseFloat(walletRow) : null,
    };
}

// ── GET /{user_id} ──────────────────────────────────────────────────────────

export async function getAdminUser(callerRoles: string[], userId: number): Promise<UserDetailDTO> {
    requireAdmin(callerRoles);
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const u = rows[0];
    if (!u) throw statusErr(404, "User not found");
    return buildDetail(u);
}

// ── PATCH /{user_id} ────────────────────────────────────────────────────────

export interface UpdateUserDTO {
    full_name?: string | null;
    email?: string | null;
    role?: string | null;
    external_id?: string | null;
    external_id_change_reason?: string | null;
    family_code?: string | null;
    photo_url?: string | null;
    status?: string | null;
    allergies?: string | null;
    card_uid?: string | null;
    customer_type?: string | null;
    shop_id?: string | null;
}

export async function updateAdminUser(
    callerRoles: string[],
    callerUserId: number,
    userId: number,
    payload: UpdateUserDTO,
): Promise<UserDetailDTO> {
    requireAdmin(callerRoles);

    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const u = rows[0];
    if (!u) throw statusErr(404, "User not found");

    const updates: Partial<typeof users.$inferInsert> = {};
    const has = (k: keyof UpdateUserDTO): boolean => Object.prototype.hasOwnProperty.call(payload, k);

    // external_id change → log identity_mappings
    if (has("external_id")) {
        const newExt = (payload.external_id ?? null) || null;
        const oldExt = u.externalId ?? null;
        if (newExt !== oldExt) {
            const reason = payload.external_id_change_reason?.trim() || "Admin manual update";
            await db.insert(identityMappings).values({
                entityType: "user",
                entityId: u.id,
                oldExternalId: oldExt,
                newExternalId: newExt,
                reason,
                changedBy: callerUserId,
            });
            updates.externalId = newExt;
        }
    }

    // shop_id reassignment (null to unassign)
    if (has("shop_id")) {
        const newShopId = (payload.shop_id ?? null) || null;
        if (newShopId) {
            const shop = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, newShopId)).limit(1);
            if (!shop[0]) throw statusErr(400, `Shop '${newShopId}' not found`);
        }
        updates.shopId = newShopId;
    }

    // card_uid uniqueness across users + customers
    if (has("card_uid") && payload.card_uid) {
        const newUid = payload.card_uid;
        const dupUser = await db
            .select({ id: users.id, fullName: users.fullName, username: users.username })
            .from(users)
            .where(and(eq(users.cardUid, newUid), ne(users.id, u.id)))
            .limit(1);
        if (dupUser[0]) {
            const label = dupUser[0].fullName || dupUser[0].username;
            throw statusErr(409, `Card already assigned to user ${label}`);
        }
        const dupCust = await db
            .select({ name: customers.name, code: customers.customerCode })
            .from(customers)
            .where(eq(customers.cardUid, newUid))
            .limit(1);
        if (dupCust[0]) {
            throw statusErr(409, `Card already assigned to student ${dupCust[0].name} (${dupCust[0].code})`);
        }
    }

    if (has("full_name")) updates.fullName = payload.full_name ?? u.fullName;
    if (has("email") && payload.email) {
        const dupEmail = await db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .where(and(eq(users.email, payload.email), ne(users.id, u.id)))
            .limit(1);
        if (dupEmail[0]) {
            const label = dupEmail[0].fullName || "another user";
            throw statusErr(409, `Email นี้ถูกใช้งานโดย ${label} อยู่แล้ว`);
        }
        updates.email = payload.email;
    }
    if (has("role")) updates.role = payload.role ?? null;
    if (has("family_code")) updates.familyCode = payload.family_code ?? null;
    if (has("photo_url")) updates.photoUrl = payload.photo_url ?? null;
    if (has("allergies")) updates.allergies = payload.allergies ?? null;
    if (has("card_uid")) updates.cardUid = payload.card_uid ?? null;
    if (has("customer_type")) updates.customerType = payload.customer_type ?? null;

    if (has("status") && payload.status) {
        updates.status = payload.status;
        updates.isActive = payload.status === "active";
    }

    if (Object.keys(updates).length > 0) {
        await db.update(users).set(updates).where(eq(users.id, u.id));
    }

    const updated = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    return buildDetail(updated[0]!);
}

// ── PATCH /{user_id}/password ───────────────────────────────────────────────

export async function adminChangePassword(callerRoles: string[], userId: number, newPassword: string): Promise<void> {
  requireAdmin(callerRoles);
  if (!newPassword || newPassword.length < 8) throw statusErr(400, "Password must be at least 8 characters");
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) throw statusErr(404, "User not found");
  const hashed = await Bun.password.hash(newPassword, { algorithm: "bcrypt", cost: 12 });
  await db.update(users).set({ hashedPassword: hashed }).where(eq(users.id, userId));
}

// ── POST /students ──────────────────────────────────────────────────────────

export interface CreateStudentDTO {
    customer_code?: string | null;
    username?: string | null;
    password?: string | null;
}

export async function createStudent(callerRoles: string[], payload: CreateStudentDTO): Promise<UserDetailDTO> {
    requireAdmin(callerRoles);

    const customerCode = (payload.customer_code ?? "").trim();
    if (!customerCode) throw statusErr(400, "customer_code is required");

    const custRows = await db
        .select()
        .from(customers)
        .where(eq(customers.customerCode, customerCode))
        .limit(1);
    const customer = custRows[0];
    if (!customer) throw statusErr(404, "Student not found");
    if ((customer.customerKind ?? "").toLowerCase() !== "student") {
        throw statusErr(400, "Customer is not a student");
    }
    if (!customer.studentCode) throw statusErr(400, "Student has no student_code");

    const username = (payload.username ?? customer.studentCode).trim();
    const password = (payload.password ?? "parent").trim() || "parent";

    const dup = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (dup[0]) throw statusErr(409, `Username '${username}' already exists`);

    const hashed = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 });
    const email = `${customer.studentCode}@students.isb.ac.th`;

    const [inserted] = await db
        .insert(users)
        .values({
            username,
            email,
            fullName: customer.name,
            hashedPassword: hashed,
            isActive: true,
            isSuperuser: false,
            role: "student",
            status: "active",
            customerType: "Student",
            externalId: customer.externalId,
            familyCode: customer.familyCode,
            photoUrl: customer.photoUrl,
            lastSyncedAt: sql`NOW()` as unknown as string,
        })
        .returning();

    return buildDetail(inserted);
}

// ── GET /{user_id}/family ───────────────────────────────────────────────────

export async function getUserFamily(callerRoles: string[], userId: number): Promise<FamilyMemberDTO[]> {
    requireAdmin(callerRoles);
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const u = rows[0];
    if (!u) throw statusErr(404, "User not found");
    return resolveFamily(u.familyCode ?? null);
}

// ── PATCH /family-profile/{family_code} ─────────────────────────────────────

export interface FamilyProfileUpdateDTO {
    notification_emails?: string[] | null;
    login_ids?: string[] | null;
}

export async function updateFamilyProfile(
    callerRoles: string[],
    familyCode: string,
    payload: FamilyProfileUpdateDTO,
): Promise<FamilyProfileDTO> {
    requireAdmin(callerRoles);

    const existing = await db
        .select()
        .from(familyProfiles)
        .where(eq(familyProfiles.familyCode, familyCode))
        .limit(1);

    let row: FamilyProfileRow;
    if (existing[0]) {
        const updates: Partial<typeof familyProfiles.$inferInsert> = {};
        if (Object.prototype.hasOwnProperty.call(payload, "notification_emails")) {
            updates.notificationEmails = (payload.notification_emails ?? []) as unknown as never;
        }
        if (Object.prototype.hasOwnProperty.call(payload, "login_ids")) {
            updates.loginIds = (payload.login_ids ?? []) as unknown as never;
        }
        if (!existing[0].lastSyncedAt) {
            updates.lastSyncedAt = sql`NOW()` as unknown as string;
        }
        if (Object.keys(updates).length > 0) {
            const [upd] = await db
                .update(familyProfiles)
                .set(updates)
                .where(eq(familyProfiles.familyCode, familyCode))
                .returning();
            row = upd;
        } else {
            row = existing[0];
        }
    } else {
        const [created] = await db
            .insert(familyProfiles)
            .values({
                familyCode,
                notificationEmails: (payload.notification_emails ?? []) as unknown as never,
                loginIds: (payload.login_ids ?? []) as unknown as never,
                lastSyncedAt: sql`NOW()` as unknown as string,
            })
            .returning();
        row = created;
    }

    return {
        family_code: row.familyCode,
        notification_emails: Array.isArray(row.notificationEmails) ? (row.notificationEmails as string[]) : [],
        login_ids: Array.isArray(row.loginIds) ? (row.loginIds as string[]) : [],
        last_synced_at: pgToIso(row.lastSyncedAt),
    };
}

// ── POST /{user_id}/link-student ────────────────────────────────────────────

export interface LinkStudentDTO {
    child_customer_id: number;
    relation?: string | null;
    parent_rank?: string | null;
}

export interface LinkStudentResponseDTO {
    link_id: number;
    parent_user_id: number;
    child_customer_id: number;
    relation: string;
    parent_rank: string | null;
}

export async function linkStudentToUser(
    callerRoles: string[],
    userId: number,
    payload: LinkStudentDTO,
): Promise<LinkStudentResponseDTO> {
    requireAdmin(callerRoles);

    const parentRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const parent = parentRows[0];
    if (!parent) throw statusErr(404, "Parent user not found");
    const role = (parent.role ?? "").toLowerCase();
    if (role !== "parent" && role !== "staff" && !parent.isSuperuser) {
        throw statusErr(400, "User is not a parent or staff");
    }

    const childRows = await db
        .select()
        .from(customers)
        .where(eq(customers.id, payload.child_customer_id))
        .limit(1);
    const child = childRows[0];
    if (!child) throw statusErr(404, "Child student not found");

    const existing = await db
        .select({ id: parentChildLinks.id })
        .from(parentChildLinks)
        .where(
            and(
                eq(parentChildLinks.parentUserId, userId),
                eq(parentChildLinks.childCustomerId, payload.child_customer_id),
            ),
        )
        .limit(1);
    if (existing[0]) throw statusErr(409, "Link already exists");

    const relation = (payload.relation ?? "guardian") || "guardian";
    const [link] = await db
        .insert(parentChildLinks)
        .values({
            parentUserId: userId,
            childCustomerId: payload.child_customer_id,
            relation,
            parentRank: payload.parent_rank ?? null,
            lowBalanceAlertEnabled: false,
        })
        .returning();

    // Ensure a wallet exists for the child (inline equivalent of WalletService.ensure_wallet_for_customer)
    const w = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.customerId, child.id))
        .limit(1);
    if (!w[0]) {
        await db.insert(wallets).values({ customerId: child.id, balance: "0", isActive: true });
    }

    // Propagate family_code between parent and child; generate one if both are null
    const resolvedCode = parent.familyCode ?? child.familyCode ?? `FAM-${link.id}`;
    if (!parent.familyCode) {
        await db.update(users).set({ familyCode: resolvedCode }).where(eq(users.id, parent.id));
    }
    if (!child.familyCode) {
        await db.update(customers).set({ familyCode: resolvedCode }).where(eq(customers.id, child.id));
    }

    return {
        link_id: link.id,
        parent_user_id: link.parentUserId,
        child_customer_id: link.childCustomerId,
        relation: link.relation,
        parent_rank: link.parentRank ?? null,
    };
}

// ── DELETE /{user_id}/link-student/{customer_id} ────────────────────────────

export async function unlinkStudent(
    callerRoles: string[],
    userId: number,
    customerId: number,
): Promise<{ success: boolean }> {
    requireAdmin(callerRoles);

    const rows = await db
        .select({ id: parentChildLinks.id })
        .from(parentChildLinks)
        .where(
            and(
                eq(parentChildLinks.parentUserId, userId),
                eq(parentChildLinks.childCustomerId, customerId),
            ),
        )
        .limit(1);
    if (!rows[0]) throw statusErr(404, "Link not found");

    await db.delete(parentChildLinks).where(eq(parentChildLinks.id, rows[0].id));

    // Clear family_code if no remaining links exist for each side
    const remainingForChild = await db
        .select({ id: parentChildLinks.id })
        .from(parentChildLinks)
        .where(eq(parentChildLinks.childCustomerId, customerId))
        .limit(1);
    if (!remainingForChild[0]) {
        await db.update(customers).set({ familyCode: null }).where(eq(customers.id, customerId));
    }

    const remainingForParent = await db
        .select({ id: parentChildLinks.id })
        .from(parentChildLinks)
        .where(eq(parentChildLinks.parentUserId, userId))
        .limit(1);
    if (!remainingForParent[0]) {
        await db.update(users).set({ familyCode: null }).where(eq(users.id, userId));
    }

    return { success: true };
}
