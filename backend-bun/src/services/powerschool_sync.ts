/**
 * ISB sync upsert primitives — shared by the real /sync/families,
 * /sync/staffs, /sync/departments intake path (isb_sync_service.ts) and by
 * Manual Sync replays of a captured round (sync_capture_service.ts).
 *
 * Upserts users/customers/family_profiles/parent_child_links idempotently.
 * Writes sync_logs + sync_audit_logs.
 *
 * The Cloudinary photo upload chain is NOT ported — Bun uses the realistic
 * portrait fallback URL (same as FastAPI does on photo-upload failure).
 */
import { and, eq, inArray, isNotNull, notInArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
    users, customers, wallets, syncLogs, syncAuditLogs, parentChildLinks,
    familyProfiles, customerTypes, userLoginEmails,
} from "@/db/schema";
import { createHash } from "node:crypto";

const PARENT_DEFAULT_PASSWORD = "parent";

/**
 * bcrypt cost for sync-created placeholder accounts (this file only — real,
 * user-chosen passwords elsewhere in the app keep cost 12, see
 * AuthUtils.hashPassword / user_service.ts / user_admin_service.ts).
 *
 * Every account this file creates gets the SAME well-known constant
 * password (PARENT_DEFAULT_PASSWORD = "parent") — never a user-chosen or
 * per-user-random one — so there is no secret entropy for a higher cost to
 * protect here; each hash still gets its own random bcrypt salt (no hash
 * reuse across accounts, so no loss of per-account uniqueness). Cost 10 is
 * not a novel choice for this codebase — it's the same cost AuthUtils.ts
 * already uses for real cashier/admin login passwords — it's simply ~4x
 * cheaper than cost 12 (bcrypt cost is exponential: each +1 doubles work).
 * Benchmarked: 500 cost-12 hashes ≈ 12s vs 500 cost-10 hashes ≈ 3s on this
 * machine — bcrypt was CPU-bound (confirmed via UV_THREADPOOL_SIZE having
 * no effect), so this was the only real lever short of removing salting.
 */
const PLACEHOLDER_ACCOUNT_BCRYPT_COST = 10;

/**
 * Placeholder-account password hashes, precomputed in parallel BEFORE the
 * per-record DB-write loop (see isb_sync_service.ts::processFamilyBatch).
 * Computing N hashes via Promise.all ahead of time lets Bun's native bcrypt
 * spread across all CPU cores instead of one blocking each sequential
 * per-record DB round-trip (this was the single largest contributor to ISB
 * family-sync latency — see docs/uat-issues-2026-07-15.md follow-up).
 */
export async function precomputeParentPasswordHashes(count: number): Promise<string[]> {
    if (count <= 0) return [];
    return Promise.all(
        Array.from({ length: count }, () => Bun.password.hash(PARENT_DEFAULT_PASSWORD, { algorithm: "bcrypt", cost: PLACEHOLDER_ACCOUNT_BCRYPT_COST })),
    );
}

function takeHash(pool: string[] | undefined): Promise<string> | string {
    if (pool && pool.length > 0) return pool.pop()!;
    return Bun.password.hash(PARENT_DEFAULT_PASSWORD, { algorithm: "bcrypt", cost: PLACEHOLDER_ACCOUNT_BCRYPT_COST });
}

/**
 * Bulk-prefetched lookup maps for a whole family batch, built once up front
 * (a handful of `WHERE x IN (...)` queries) instead of 2-3 SELECTs per
 * record. Passing `ctx` into the upsert functions below makes them read
 * from these maps instead of hitting the DB — falling back to the original
 * per-record SELECT whenever a given map isn't supplied, so every existing
 * call site that doesn't pass a ctx keeps its exact original behavior.
 */
export interface FamilyBatchCtx {
    familyProfiles?: Map<string, typeof familyProfiles.$inferSelect>;
    usersByExtId?: Map<string, typeof users.$inferSelect>;
    usersByEmail?: Map<string, typeof users.$inferSelect>;
    /** Keyed by user_login_emails.email — catches a match whose users.email
     * column is a synthetic placeholder (see upsertParent/upsertStaffParentRef). */
    usersByLoginEmail?: Map<string, typeof users.$inferSelect>;
    customersByExtId?: Map<string, typeof customers.$inferSelect>;
    customersByStudentCode?: Map<string, typeof customers.$inferSelect>;
    studentLoginUsersByUsername?: Map<string, { id: number }>;
    links?: Map<string, typeof parentChildLinks.$inferSelect>;
    hashPool?: string[];
}

// ── Portraits (deterministic by seed) ─────────────────────────────────────

const STAFF_PORTRAITS = [
    "https://randomuser.me/api/portraits/men/32.jpg",
    "https://randomuser.me/api/portraits/women/44.jpg",
    "https://randomuser.me/api/portraits/men/45.jpg",
    "https://randomuser.me/api/portraits/women/65.jpg",
    "https://randomuser.me/api/portraits/men/78.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/men/91.jpg",
    "https://randomuser.me/api/portraits/women/29.jpg",
];
const PARENT_PORTRAITS = [
    "https://randomuser.me/api/portraits/men/11.jpg",
    "https://randomuser.me/api/portraits/women/27.jpg",
    "https://randomuser.me/api/portraits/men/59.jpg",
    "https://randomuser.me/api/portraits/women/38.jpg",
    "https://randomuser.me/api/portraits/men/83.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/men/14.jpg",
    "https://randomuser.me/api/portraits/women/5.jpg",
];
const STUDENT_PORTRAITS = [
    "https://randomuser.me/api/portraits/women/1.jpg",
    "https://randomuser.me/api/portraits/women/2.jpg",
    "https://randomuser.me/api/portraits/men/3.jpg",
    "https://randomuser.me/api/portraits/women/4.jpg",
    "https://randomuser.me/api/portraits/men/6.jpg",
    "https://randomuser.me/api/portraits/women/8.jpg",
    "https://randomuser.me/api/portraits/men/9.jpg",
    "https://randomuser.me/api/portraits/women/10.jpg",
];

const PORTRAIT_POOLS: Record<string, string[]> = {
    staff: STAFF_PORTRAITS,
    parent: PARENT_PORTRAITS,
    student: STUDENT_PORTRAITS,
};

function realisticPhoto(role: string, seed: string): string {
    const pool = PORTRAIT_POOLS[role] ?? STAFF_PORTRAITS;
    const h = parseInt(createHash("md5").update(seed).digest("hex").slice(0, 12), 16);
    return pool[h % pool.length];
}

// ── Audit snapshot helpers ────────────────────────────────────────────────

const USER_AUDIT_FIELDS = ["fullName", "email", "role", "customerType", "familyCode", "cardUid", "status", "shopId"] as const;
const CUSTOMER_AUDIT_FIELDS = ["name", "email", "familyCode", "customerType", "customerKind", "cardUid", "grade", "schoolType", "externalId", "enrollDate", "withdrawDate"] as const;

function snapshot<T extends Record<string, unknown>>(entity: T | null, fields: readonly string[]): Record<string, unknown> {
    if (!entity) return {};
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f] = (entity as Record<string, unknown>)[f] ?? null;
    return out;
}

async function emitAudit(args: {
    syncLogId: number;
    entityType: "user" | "customer";
    entityId: number;
    entityName: string | null;
    externalId: string | null;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    fields: readonly string[];
    created: boolean;
}): Promise<void> {
    let action: "create" | "update" | "noop";
    let changes: Record<string, { old: unknown; new: unknown }> | null;
    if (args.created) {
        action = "create";
        changes = {};
        for (const k of args.fields) {
            if (args.after[k] !== null && args.after[k] !== undefined) {
                changes[k] = { old: null, new: args.after[k] };
            }
        }
        if (Object.keys(changes).length === 0) changes = null;
    } else {
        const diff: Record<string, { old: unknown; new: unknown }> = {};
        for (const k of args.fields) {
            if (args.before[k] !== args.after[k]) {
                diff[k] = { old: args.before[k] ?? null, new: args.after[k] ?? null };
            }
        }
        if (Object.keys(diff).length > 0) {
            action = "update";
            changes = diff;
        } else {
            action = "noop";
            changes = null;
        }
    }
    await db.insert(syncAuditLogs).values({
        syncLogId: args.syncLogId,
        entityType: args.entityType,
        entityId: args.entityId,
        entityName: args.entityName,
        externalId: args.externalId,
        action,
        changes,
    });
}

// ── Internal CustomerType ─────────────────────────────────────────────────

export async function getInternalTypeId(): Promise<number> {
    // pg enum value is UPPERCASE — "Internal" would fail the enum check.
    const rows = await db.select().from(customerTypes).where(eq(customerTypes.typeName, "INTERNAL")).limit(1);
    if (rows[0]) return rows[0].id;
    const [created] = await db.insert(customerTypes).values({
        typeName: "INTERNAL",
        description: "Student/staff internal customer",
        defaultPriceLevel: "internal",
    }).returning();
    return created.id;
}

// ── Upserts ───────────────────────────────────────────────────────────────

export interface StaffPayload {
    customerId: number | string;
    customerType?: string;
    familyCode: number | string;
    firstName: string;
    lastName: string;
    staffType?: string;
    department?: string;
    smartCard?: { cardNumber?: string };
    /** SSO login emails, e.g. ["chrism@isb.ac.th", "202231@parents.isb.ac.th"] — first is primary. */
    login?: string[];
    hasChildren?: boolean;
}

/**
 * Records every email in `emails` as a valid SSO login for `userId`, so
 * auth_service's SSO lookup can resolve any of them to this same user/wallet.
 * "Last write wins" on conflict — matches the ISB vendor sync's own
 * documented upsert semantics (an email can move to a different person).
 *
 * `source` identifies which sync channel is calling — "staff" for
 * upsertStaff (/sync/staffs), "family" for upsertParent/upsertStaffParentRef
 * (/sync/families). A staff+parent person is synced through BOTH channels
 * independently, each only ever reporting its own half of that person's
 * logins, so this round's list is authoritative *only within its own
 * source* — anything previously registered under the SAME source that isn't
 * in this round's list gets dropped (per 2026-07 review: an empty list is
 * also authoritative — "no logins this round" from that channel means wipe
 * that channel's emails, not "no update"). Rows from the OTHER source, or
 * legacy rows with source=NULL (pre-dates this column), are left untouched
 * — otherwise the two channels would alternately wipe each other's emails
 * out every time only one of them runs.
 */
async function syncLoginEmails(
    userId: number,
    emails: (string | undefined | null)[],
    source: "staff" | "family",
): Promise<void> {
    const cleaned = [...new Set(emails.map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean))];
    await db.delete(userLoginEmails).where(
        cleaned.length > 0
            ? and(eq(userLoginEmails.userId, userId), eq(userLoginEmails.source, source), notInArray(userLoginEmails.email, cleaned))
            : and(eq(userLoginEmails.userId, userId), eq(userLoginEmails.source, source)),
    );
    if (cleaned.length === 0) return;
    // Each email is a distinct conflict target (unique index on email) so
    // these upserts never contend with each other — safe to fire together
    // instead of paying N sequential round-trips.
    await Promise.all(
        cleaned.map((email) =>
            db.insert(userLoginEmails)
                .values({ userId, email, source })
                .onConflictDoUpdate({ target: userLoginEmails.email, set: { userId, source } }),
        ),
    );
}

export async function upsertStaff(payload: StaffPayload, syncLogId: number): Promise<typeof users.$inferSelect> {
    const extId = String(payload.customerId);
    const logins = payload.login ?? [];
    // Staff with no SSO login on file yet (e.g. new hires) would otherwise get
    // email="" — every such record collides on the unique email/username index,
    // failing the whole batch after the first one. Fall back to a synthetic,
    // externalId-scoped address (same pattern as upsertStaffParentRef) so it's
    // always unique per person.
    const email = (logins[0] ?? `${(payload.firstName || "staff").toLowerCase()}${extId}@isb.ac.th`).trim().toLowerCase();
    const username = email.split("@")[0].trim().toLowerCase();
    const fullName = `${payload.firstName} ${payload.lastName}`.trim();
    const familyCode = String(payload.familyCode);
    // "" (no card on file) must become null, not stored as-is — card_uid has a
    // unique index, so multiple cardless records would collide on "" the same
    // way blank logins collided on email (see upsertStaff's email fallback).
    const cardUid = payload.smartCard?.cardNumber || null;

    // Match priority: external_id → email → username
    let existing = (await db.select().from(users).where(eq(users.externalId, extId)).limit(1))[0];
    if (!existing && email) existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!existing && username) existing = (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];

    const created = !existing;
    const before = snapshot(existing as unknown as Record<string, unknown> | null, USER_AUDIT_FIELDS);

    const photoUrl = realisticPhoto("staff", extId);
    let userRow: typeof users.$inferSelect;
    if (created) {
        const hash = await Bun.password.hash(PARENT_DEFAULT_PASSWORD, { algorithm: "bcrypt", cost: 12 });
        // Race-safety net: two concurrent syncs (e.g. /sync/staffs and
        // /sync/families both reporting this external_id for the first
        // time) can each pass the "does this exist" check above before
        // either commits — external_id has a unique index (see
        // ix_users_external_id) specifically so Postgres resolves this
        // atomically here instead of one side erroring or a duplicate row
        // silently existing. The losing insert becomes this DO UPDATE.
        // Identity fields (username/email/hashedPassword) are deliberately
        // left untouched — whichever insert actually won keeps its own; a
        // later normal sequential sync reconciles everything else via the
        // plain UPDATE branch below.
        const [u] = await db.insert(users).values({
            username, email, fullName,
            hashedPassword: hash,
            isActive: true, isSuperuser: false,
            role: "staff", status: "active",
            externalId: extId, familyCode,
            customerType: "Staff",
            staffType: payload.staffType ?? null,
            psDepartment: payload.department ?? null,
            cardUid,
            photoUrl,
            lastSyncedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
            target: users.externalId,
            set: {
                familyCode, fullName,
                customerType: "Staff",
                staffType: payload.staffType ?? null,
                psDepartment: payload.department ?? null,
                isActive: true, status: "active",
                lastSyncedAt: new Date().toISOString(),
            },
        }).returning();
        userRow = u;
    } else {
        const updates: Record<string, unknown> = {
            externalId: extId,
            familyCode,
            fullName,
            customerType: "Staff",
            staffType: payload.staffType ?? existing!.staffType ?? null,
            psDepartment: payload.department ?? existing!.psDepartment ?? null,
            photoUrl: existing!.photoUrl ?? photoUrl,
            lastSyncedAt: new Date().toISOString(),
            // Reactivate — appearing in a current /sync/staffs batch is proof
            // of life for staff_sweep_service.ts's purposes (its own comment
            // already claimed this path does this; it didn't, until now — a
            // staff-sweep deactivation would otherwise never be reversed for
            // anyone who only ever appears via the plain staff channel, never
            // as a family's Staff-type parent). Set `status` alongside
            // `is_active` for the same reason as upsertStaffParentRef: two
            // separate columns that must never drift apart.
            isActive: true,
            status: "active",
        };
        // Only overwrite email/username once ISB actually reports a real
        // login this round — a still-blank round must never clobber a real
        // address (or a prior synthetic one) back to a fresh placeholder.
        if (logins.length > 0) {
            updates.email = email;
            updates.username = username;
        }
        if (cardUid) updates.cardUid = cardUid;
        await db.update(users).set(updates).where(eq(users.id, existing!.id));
        userRow = { ...existing!, ...(updates as Partial<typeof existing>) } as typeof users.$inferSelect;
    }

    const after = snapshot(userRow as unknown as Record<string, unknown>, USER_AUDIT_FIELDS);
    await emitAudit({
        syncLogId, entityType: "user", entityId: userRow.id,
        entityName: userRow.fullName, externalId: extId,
        before, after, fields: USER_AUDIT_FIELDS, created,
    });
    await syncLoginEmails(userRow.id, logins, "staff");
    return userRow;
}

export async function upsertParent(payload: StaffPayload, familyCode: string, logins: string[], syncLogId: number, ctx?: FamilyBatchCtx): Promise<typeof users.$inferSelect> {
    const extId = String(payload.customerId);
    const fullName = `${payload.firstName} ${payload.lastName}`.trim();
    // "" (no card on file) must become null, not stored as-is — card_uid has a
    // unique index, so multiple cardless records would collide on "" the same
    // way blank logins collided on email (see upsertStaff's email fallback).
    const cardUid = payload.smartCard?.cardNumber || null;
    const email = (logins[0] ?? `${extId}@parents.isb.ac.th`).trim().toLowerCase();
    const username = email.split("@")[0].trim().toLowerCase();

    let existing: typeof users.$inferSelect | undefined;
    if (ctx?.usersByExtId || ctx?.usersByEmail || ctx?.usersByLoginEmail) {
        existing = ctx.usersByExtId?.get(extId) ?? ctx.usersByEmail?.get(email) ?? ctx.usersByLoginEmail?.get(email);
    } else {
        existing = (await db.select().from(users).where(eq(users.externalId, extId)).limit(1))[0];
        if (!existing) existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
        // Falls back to user_login_emails — matches even when the row's own
        // `users.email` is a synthetic placeholder (e.g. this same person was
        // previously created via upsertStaffParentRef, whose email column is
        // never the real one) but this address was already on file as a
        // known SSO login from an earlier round.
        if (!existing) {
            const viaLogin = await db
                .select({ user: users })
                .from(userLoginEmails)
                .innerJoin(users, eq(users.id, userLoginEmails.userId))
                .where(eq(userLoginEmails.email, email))
                .limit(1);
            existing = viaLogin[0]?.user;
        }
    }

    const created = !existing;
    const before = snapshot(existing as unknown as Record<string, unknown> | null, USER_AUDIT_FIELDS);

    const photoUrl = realisticPhoto("parent", extId);
    let userRow: typeof users.$inferSelect;
    if (created) {
        const hash = await takeHash(ctx?.hashPool);
        // Race-safety net — see the matching comment in upsertStaff. This
        // channel and /sync/staffs (via upsertStaffParentRef) both key off
        // the same external_id and can race on a brand-new person's first
        // appearance in either.
        const [u] = await db.insert(users).values({
            username, email, fullName,
            hashedPassword: hash,
            isActive: true, isSuperuser: false,
            role: "parent", status: "active",
            externalId: extId, familyCode,
            customerType: "Parent",
            cardUid, photoUrl,
            lastSyncedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
            target: users.externalId,
            set: {
                familyCode, fullName,
                customerType: "Parent", role: "parent",
                lastSyncedAt: new Date().toISOString(),
            },
        }).returning();
        userRow = u;
    } else {
        // Staff→Parent transition detected (existing row WAS staff, is now
        // becoming plain parent this round).
        const wasStaff = existing!.role === "staff";
        const updates: Record<string, unknown> = {
            externalId: extId, familyCode, fullName,
            customerType: "Parent", role: "parent",
            photoUrl: existing!.photoUrl ?? photoUrl,
            lastSyncedAt: new Date().toISOString(),
            // Staff-only metadata must not linger once this row is no longer
            // staff — a stale staffType/psDepartment would misrepresent this
            // person as still employed in some department to any admin
            // screen that displays it.
            ...(wasStaff ? { staffType: null, psDepartment: null } : {}),
        };
        // Only overwrite email/username once ISB actually reports a real
        // login this round — a still-blank round must never clobber a real
        // address (or a prior synthetic one) back to a fresh placeholder.
        if (logins.length > 0) {
            updates.email = email;
            updates.username = username;
        }
        if (cardUid) updates.cardUid = cardUid;
        await db.update(users).set(updates).where(eq(users.id, existing!.id));
        userRow = { ...existing!, ...(updates as Partial<typeof existing>) } as typeof users.$inferSelect;

        // Purge any source="staff" login emails for this user_id immediately
        // — this can't wait for a future /sync/staffs touch, because the
        // whole point of this transition is that /sync/staffs will never
        // mention this person again. Confirmed 2026-07: the old staff email
        // (e.g. name@isb.ac.th) stayed valid for SSO indefinitely without
        // this, even after being fully absent from the staff batch, because
        // a shared email between the two channels (both send it during the
        // overlap round) can end up tagged source="staff" (unique index on
        // email — whichever channel wrote it last wins the tag), and
        // family's own reconcile only ever touches rows tagged
        // source="family", so nothing else would ever clear it.
        if (wasStaff) {
            await db.delete(userLoginEmails).where(
                and(eq(userLoginEmails.userId, existing!.id), eq(userLoginEmails.source, "staff")),
            );
        }
    }

    const after = snapshot(userRow as unknown as Record<string, unknown>, USER_AUDIT_FIELDS);
    await emitAudit({
        syncLogId, entityType: "user", entityId: userRow.id,
        entityName: userRow.fullName, externalId: extId,
        before, after, fields: USER_AUDIT_FIELDS, created,
    });
    await syncLoginEmails(userRow.id, logins.length > 0 ? logins : [email], "family");
    ctx?.usersByExtId?.set(extId, userRow);
    ctx?.usersByEmail?.set(email, userRow);
    return userRow;
}

export async function upsertStaffParentRef(payload: StaffPayload, familyCode: string, syncLogId: number, logins: string[] = [], ctx?: FamilyBatchCtx): Promise<typeof users.$inferSelect> {
    const extId = String(payload.customerId);
    const fullName = `${payload.firstName} ${payload.lastName}`.trim();
    const loginEmail = logins[0]?.trim().toLowerCase();
    let existing: typeof users.$inferSelect | undefined;
    if (ctx?.usersByExtId || ctx?.usersByLoginEmail) {
        existing = ctx?.usersByExtId?.get(extId) ?? (loginEmail ? ctx?.usersByLoginEmail?.get(loginEmail) : undefined);
    } else {
        existing = (await db.select().from(users).where(eq(users.externalId, extId)).limit(1))[0];
        // Same fallback as upsertParent — reuses the same row across a
        // Parent→Staff transition (external_id changed) as long as this
        // person's login email was already known from a prior round.
        if (!existing && loginEmail) {
            const viaLogin = await db
                .select({ user: users })
                .from(userLoginEmails)
                .innerJoin(users, eq(users.id, userLoginEmails.userId))
                .where(eq(userLoginEmails.email, loginEmail))
                .limit(1);
            existing = viaLogin[0]?.user;
        }
    }
    const created = !existing;
    const before = snapshot(existing as unknown as Record<string, unknown> | null, USER_AUDIT_FIELDS);

    let userRow: typeof users.$inferSelect;
    if (created) {
        const email = `${(payload.firstName ?? "staff").toLowerCase()}${extId}@isb.ac.th`;
        const hash = await takeHash(ctx?.hashPool);
        // Race-safety net — see the matching comment in upsertStaff. This
        // channel and /sync/staffs (via upsertStaff) both key off the same
        // external_id and can race on a brand-new person's first appearance
        // in either.
        const [u] = await db.insert(users).values({
            username: `staff_${extId}`, email, fullName,
            hashedPassword: hash,
            isActive: true, isSuperuser: false,
            role: "staff", status: "active",
            externalId: extId, customerType: "Staff",
            familyCode,
            cardUid: payload.smartCard?.cardNumber || null,
            lastSyncedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
            target: users.externalId,
            set: {
                familyCode, fullName,
                role: "staff", customerType: "Staff",
                isActive: true, status: "active",
                lastSyncedAt: new Date().toISOString(),
            },
        }).returning();
        userRow = u;
    } else {
        // externalId/role/customerType must be set here too, not just
        // familyCode — the user_login_emails fallback above can match a row
        // that was last upserted as a plain Parent (e.g. a Parent→Staff
        // transition where the customerId also changed), and without this
        // the row would keep its old external_id and role="parent" forever
        // despite ISB now reporting this person as Staff.
        const updates: Record<string, unknown> = {
            externalId: extId, familyCode, fullName,
            role: "staff", customerType: "Staff",
            // Reactivate — being listed as this family's Staff-type parent
            // is itself proof of life for staff_sweep_service.ts's purposes
            // (see that file's shared-lastSyncedAt reasoning), so a prior
            // staff-sweep deactivation must be reversed here too, not just
            // by a plain /sync/staffs touch. `status` is a separate, mostly-
            // redundant string column that only the admin-manual PATCH path
            // used to keep in sync with `is_active` — sync must set both
            // together too, or a staff-sweep-deactivated (status="inactive")
            // account that gets reactivated here would show "Active" on the
            // admin Cardholders list (reads is_active) but still "Inactive"
            // on the User Detail page (reads status) until an admin happens
            // to touch it manually.
            isActive: true,
            status: "active",
            lastSyncedAt: new Date().toISOString(),
        };
        if (payload.smartCard?.cardNumber) updates.cardUid = payload.smartCard.cardNumber;
        await db.update(users).set(updates).where(eq(users.id, existing!.id));
        userRow = { ...existing!, ...(updates as Partial<typeof existing>) } as typeof users.$inferSelect;
    }

    const after = snapshot(userRow as unknown as Record<string, unknown>, USER_AUDIT_FIELDS);
    await emitAudit({
        syncLogId, entityType: "user", entityId: userRow.id,
        entityName: userRow.fullName, externalId: extId,
        before, after, fields: USER_AUDIT_FIELDS, created,
    });
    await syncLoginEmails(userRow.id, logins, "family");
    ctx?.usersByExtId?.set(extId, userRow);
    return userRow;
}

export interface StudentPayload {
    customerId: number | string;
    firstName: string;
    lastName: string;
    grade?: string;
    schoolType?: string;
    // "YYYY-MM-DD", or "" from ISB when not applicable (e.g. no withdraw
    // date yet) — "" must become null, not stored as-is (see cardUid below
    // for the same "" -> null pattern and why).
    enrollmentDate?: string;
    withdrawDate?: string;
    smartCard?: { cardNumber?: string };
}

export async function upsertStudent(payload: StudentPayload, familyCode: string, internalTypeId: number, syncLogId: number, ctx?: FamilyBatchCtx): Promise<typeof customers.$inferSelect> {
    const extId = String(payload.customerId);
    const fullName = `${payload.firstName} ${payload.lastName}`.trim();
    const grade = payload.grade ?? null;
    const schoolType = payload.schoolType ?? null;
    // "" (no card on file) must become null, not stored as-is — card_uid has a
    // unique index, so multiple cardless records would collide on "" the same
    // way blank logins collided on email (see upsertStaff's email fallback).
    const cardUid = payload.smartCard?.cardNumber || null;
    // ISB sends "" (not omitted) for "not applicable" — e.g. every currently
    // enrolled student has withdrawDate="". Treated as authoritative every
    // round, same as grade/schoolType (not guarded like cardUid — a
    // student's enrollment status should always reflect what ISB reports
    // right now, not linger from a stale prior round).
    const enrollDate = payload.enrollmentDate || null;
    const withdrawDate = payload.withdrawDate || null;

    let existing: typeof customers.$inferSelect | undefined;
    if (ctx?.customersByExtId || ctx?.customersByStudentCode) {
        existing = ctx.customersByExtId?.get(extId) ?? ctx.customersByStudentCode?.get(extId);
    } else {
        existing = (await db.select().from(customers).where(eq(customers.externalId, extId)).limit(1))[0];
        if (!existing) existing = (await db.select().from(customers).where(eq(customers.studentCode, extId)).limit(1))[0];
    }

    const created = !existing;
    const before = snapshot(existing as unknown as Record<string, unknown> | null, CUSTOMER_AUDIT_FIELDS);

    const photoUrl = realisticPhoto("student", extId);
    let custRow: typeof customers.$inferSelect;
    if (created) {
        const insertValues: Record<string, unknown> = {
            customerCode: `PS-${extId}`,
            studentCode: extId,
            name: fullName,
            customerTypeId: internalTypeId,
            isActive: true,
            cardFrozen: false,
            customerKind: "student",
            externalId: extId,
            familyCode,
            grade, schoolType,
            enrollDate, withdrawDate,
            customerType: "Student",
            cardUid,
            photoUrl,
            powerschoolSyncAt: new Date().toISOString(),
        };
        const conflictSet: Record<string, unknown> = {
            familyCode, name: fullName, grade, schoolType,
            enrollDate, withdrawDate,
            customerType: "Student", customerKind: "student",
            isActive: true,
            powerschoolSyncAt: new Date().toISOString(),
        };
        const [c] = await db.insert(customers).values(insertValues as typeof customers.$inferInsert).onConflictDoUpdate({
            target: customers.externalId,
            set: conflictSet,
        }).returning();
        custRow = c;
        // The conflict branch above updates an already-existing customer row,
        // which already has a wallet from its original creation — only a
        // genuine fresh insert needs one. onConflictDoUpdate's RETURNING
        // can't tell us which happened, so check explicitly rather than risk
        // a second wallet row for the same customer.
        const walletExists = (await db.select({ id: wallets.id }).from(wallets).where(eq(wallets.customerId, c.id)).limit(1))[0];
        if (!walletExists) {
            await db.insert(wallets).values({ customerId: c.id, balance: "0", isActive: true });
        }
    } else {
        const updates: Record<string, unknown> = {
            externalId: extId, familyCode, name: fullName, grade, schoolType,
            enrollDate, withdrawDate,
            customerType: "Student", customerKind: "student",
            // Appearing in a current sync means ISB considers them enrolled —
            // reactivate in case a prior sync deactivated them for having
            // dropped out of every family roster (see reconcileFamilyMembership).
            isActive: true,
            photoUrl: existing!.photoUrl ?? photoUrl,
            powerschoolSyncAt: new Date().toISOString(),
        };
        if (cardUid) updates.cardUid = cardUid;
        await db.update(customers).set(updates).where(eq(customers.id, existing!.id));
        custRow = { ...existing!, ...(updates as Partial<typeof existing>) } as typeof customers.$inferSelect;
    }

    const after = snapshot(custRow as unknown as Record<string, unknown>, CUSTOMER_AUDIT_FIELDS);
    await emitAudit({
        syncLogId, entityType: "customer", entityId: custRow.id,
        entityName: custRow.name, externalId: extId,
        before, after, fields: CUSTOMER_AUDIT_FIELDS, created,
    });

    // Ensure student User login row exists
    const studentUser = ctx?.studentLoginUsersByUsername
        ? ctx.studentLoginUsersByUsername.get(extId)
        : (await db.select({ id: users.id }).from(users).where(eq(users.username, extId)).limit(1))[0];
    if (!studentUser) {
        const hash = await takeHash(ctx?.hashPool);
        // Race-safety net — see the matching comment above. username=extId
        // is this row's own unique key; onConflictDoNothing is enough here
        // (unlike the upserts above, this row never needs updating once it
        // exists — it's just a login shell resolved by username elsewhere).
        const [su] = await db.insert(users).values({
            username: extId,
            email: `${extId}@students.isb.ac.th`,
            fullName,
            hashedPassword: hash,
            isActive: true, isSuperuser: false,
            role: "student", status: "active",
            customerType: "Student",
            externalId: extId, familyCode,
            photoUrl: custRow.photoUrl,
            lastSyncedAt: new Date().toISOString(),
        }).onConflictDoNothing({ target: users.username })
          .returning({ id: users.id });
        ctx?.studentLoginUsersByUsername?.set(extId, su);
    }
    ctx?.customersByExtId?.set(extId, custRow);
    ctx?.customersByStudentCode?.set(custRow.studentCode ?? extId, custRow);
    return custRow;
}

export async function upsertFamilyProfile(familyCode: string, notificationEmails: string[], loginIds: string[], ctx?: FamilyBatchCtx): Promise<void> {
    const existing = ctx?.familyProfiles
        ? ctx.familyProfiles.get(familyCode)
        : (await db.select().from(familyProfiles).where(eq(familyProfiles.familyCode, familyCode)).limit(1))[0];
    if (existing) {
        await db.update(familyProfiles).set({
            notificationEmails, loginIds,
            lastSyncedAt: new Date().toISOString(),
            // Reactivate — ISB reporting this family_code again after the
            // staleness sweep (family_sweep_service.ts) deactivated it means
            // it's back, per "รอบหน้ามีก็กลับมา active เหมือนเดิม".
            isActive: true,
        }).where(eq(familyProfiles.familyCode, familyCode));
    } else {
        await db.insert(familyProfiles).values({
            familyCode, notificationEmails, loginIds,
            lastSyncedAt: new Date().toISOString(),
        });
    }
    // Mark present so a second family record in the same batch sharing this
    // family_code (edge case) takes the update path, matching what a real
    // re-SELECT would now find.
    ctx?.familyProfiles?.set(familyCode, { familyCode } as typeof familyProfiles.$inferSelect);
}

export async function upsertLink(parentId: number, childId: number, parentRank: string, relation = "guardian", ctx?: FamilyBatchCtx): Promise<void> {
    const key = `${parentId}:${childId}`;
    const existing = ctx?.links
        ? ctx.links.get(key)
        : (await db.select().from(parentChildLinks).where(
            and(
                eq(parentChildLinks.parentUserId, parentId),
                eq(parentChildLinks.childCustomerId, childId),
            ),
        ).limit(1))[0];
    if (existing) {
        const updates: Record<string, unknown> = { parentRank };
        if (relation && existing.relation === "guardian") updates.relation = relation;
        await db.update(parentChildLinks).set(updates).where(eq(parentChildLinks.id, existing.id));
        ctx?.links?.set(key, { ...existing, ...updates } as typeof parentChildLinks.$inferSelect);
    } else {
        const [row] = await db.insert(parentChildLinks).values({
            parentUserId: parentId,
            childCustomerId: childId,
            relation, parentRank,
        }).returning();
        ctx?.links?.set(key, row);
    }
}

/**
 * A family's mainParent/secondaryParent is authoritative per sync — at most
 * one of each. If a parent's FTID changes (same person, new external_id),
 * the old id's row is never in `currentParentUserIds`, so this drops its
 * main/secondary link to the child. The old user/wallet themselves are never
 * touched here — they simply stop being linked to this child (orphaned from
 * the family, not deleted).
 *
 * The join-table row was always the correct thing being deleted here — the
 * bug was one level up: `users.family_code` (a denormalized column read by
 * myCoparents()/userCanAccessWallet()/transferWithinFamily()'s non-admin
 * family check) was never cleared for the parent losing their last link, so
 * they kept passing every "same family" check even though parent_child_links
 * no longer connected them to anyone. Once a removed parent has ZERO
 * remaining links anywhere (not just to this child), clear their
 * family_code too — same clearing rule family_service.ts::deleteLink
 * already applies to the manual link-removal path.
 */
export async function reconcileParentLinks(
    childCustomerId: number,
    currentParentUserIds: number[],
): Promise<void> {
    if (currentParentUserIds.length === 0) return;

    const staleCondition = and(
        eq(parentChildLinks.childCustomerId, childCustomerId),
        inArray(parentChildLinks.parentRank, ["main", "secondary"]),
        notInArray(parentChildLinks.parentUserId, currentParentUserIds),
    );
    const toRemove = await db.select({ parentUserId: parentChildLinks.parentUserId })
        .from(parentChildLinks)
        .where(staleCondition);
    if (toRemove.length === 0) return;
    const removedParentIds = [...new Set(toRemove.map((r) => r.parentUserId))];

    await db.delete(parentChildLinks).where(staleCondition);

    await clearFamilyCodeForOrphanedParents(removedParentIds);
}

/** Shared by reconcileParentLinks and any other link-removal path — clears
 * users.family_code for exactly the ids in `candidateParentIds` that have
 * zero parent_child_links rows left anywhere. */
async function clearFamilyCodeForOrphanedParents(candidateParentIds: number[]): Promise<void> {
    if (candidateParentIds.length === 0) return;
    const stillLinkedRows = await db.selectDistinct({ parentUserId: parentChildLinks.parentUserId })
        .from(parentChildLinks)
        .where(inArray(parentChildLinks.parentUserId, candidateParentIds));
    const stillLinked = new Set(stillLinkedRows.map((r) => r.parentUserId));
    const trulyOrphaned = candidateParentIds.filter((id) => !stillLinked.has(id));
    if (trulyOrphaned.length > 0) {
        await db.update(users).set({ familyCode: null }).where(inArray(users.id, trulyOrphaned));
    }
}

/**
 * Student-side counterpart of reconcileParentLinks: a family's `students`
 * array is the authoritative current roster per sync. If a student's
 * external id is swapped out (e.g. a customerId correction — the new kid
 * replaces the old one in the payload), the old student's row is never in
 * `currentStudentCustomerIds`. Drop ALL its parent links (regardless of
 * parent_rank — a manually-linked row with no rank, or any rank other than
 * main/secondary, must go too, otherwise it survives this cleanup and keeps
 * the old student showing up anywhere that resolves family membership via
 * parent_child_links, e.g. the admin Family Group card) and, once it has
 * zero links left, clear customers.family_code AND deactivate (is_active=
 * false) — per 2026-07 review, a student dropped from every family roster
 * shouldn't keep spending at POS while orphaned. This runs before
 * reconcileFamilyMembership() in processFamilyBatch, so it must set
 * is_active itself — by the time reconcileFamilyMembership looks, the
 * family_code is already cleared and its own (redundant) student branch
 * finds nothing left to act on. upsertStudent() re-activates them
 * automatically if ISB ever brings them back into a family's roster.
 */
export async function reconcileFamilyStudents(
    familyCode: string,
    currentStudentCustomerIds: number[],
): Promise<void> {
    if (!familyCode) return;
    const conds = [eq(customers.familyCode, familyCode), isNotNull(customers.studentCode)];
    if (currentStudentCustomerIds.length > 0) {
        conds.push(notInArray(customers.id, currentStudentCustomerIds));
    }
    const staleStudents = await db.select({ id: customers.id, externalId: customers.externalId }).from(customers).where(and(...conds));
    if (staleStudents.length === 0) return;
    const staleIds = staleStudents.map((s) => s.id);

    await db.delete(parentChildLinks).where(inArray(parentChildLinks.childCustomerId, staleIds));

    const stillLinkedRows = await db.selectDistinct({ childCustomerId: parentChildLinks.childCustomerId })
        .from(parentChildLinks)
        .where(inArray(parentChildLinks.childCustomerId, staleIds));
    const stillLinked = new Set(stillLinkedRows.map((r) => r.childCustomerId));
    const trulyOrphaned = staleStudents.filter((s) => !stillLinked.has(s.id));
    if (trulyOrphaned.length > 0) {
        await db.update(customers).set({ familyCode: null, isActive: false }).where(inArray(customers.id, trulyOrphaned.map((s) => s.id)));
        // Also clear the student's own login user row (role="student",
        // created by upsertStudent's companion-user block, matched by
        // external_id since it's a different id-space than customers.id) —
        // it carries the same family_code and would otherwise leak into
        // anything that queries users by family_code without an explicit
        // role!="student" filter (see resolveFamily() in
        // user_admin_service.ts, which used to have exactly this bug).
        const orphanedExtIds = trulyOrphaned.map((s) => s.externalId).filter((id): id is string => !!id);
        if (orphanedExtIds.length > 0) {
            await db.update(users).set({ familyCode: null }).where(
                and(inArray(users.externalId, orphanedExtIds), eq(users.role, "student")),
            );
        }
    }
}

/**
 * reconcileParentLinks() above only runs per child, inside the students
 * loop — so if a sync round for a family doesn't happen to include a
 * student in the very same request as a parent's ID swap (a "just retest
 * the parent" payload, no student attached), it never fires at all, and the
 * stale link survives untouched. It also never clears the abandoned old
 * row's own `family_code` column, which is what actually matters to
 * anything that checks family membership by column match instead of by
 * relation — myCoparents() and the wallet peer-to-peer transfer's co-parent
 * check (wallet_service.ts) both trust `users.family_code` directly, so an
 * "orphaned" parent kept showing up as a live family member and stayed
 * transfer-eligible even once their link was gone.
 *
 * Call this once per family (not per child), after all of this round's
 * parents/staff and students have been upserted, with the CURRENT full
 * roster of each — independent of whether reconcileParentLinks happened to
 * run this round. For anyone still tagged with this family_code but absent
 * from the current roster: drop every parent_child_links row referencing
 * them (as parent or as child), and:
 *   - a parent/staff: clear their family_code (orphaned, not deleted — they
 *     keep logging in and using their own wallet, just detached from this
 *     family). Admin can still move money out of an orphan's wallet via the
 *     admin Wallet Transfer page (search by username — admin bypasses the
 *     family-scope check entirely).
 *   - a student: clear family_code AND deactivate (is_active=false) — per
 *     2026-07 review, a student dropped from every family roster shouldn't
 *     keep spending at POS. upsertStudent() re-activates them automatically
 *     if ISB ever brings them back into a family's roster.
 *
 * Skips a side entirely when its roster is empty, mirroring
 * reconcileParentLinks' own guard — an empty roster more likely means an
 * incomplete payload than "nobody is in this family now", and detaching
 * everyone on that basis would be worse than doing nothing.
 *
 * A student's own login user row (role="student", created by upsertStudent's
 * companion-user block) is cleared here too — myCoparents()/family_service.ts
 * already ignores student-role users by design, but the admin User Detail
 * page's resolveFamily() (user_admin_service.ts) did not, and leaked the
 * orphaned student back in via its stale family_code until both were fixed
 * together (2026-07).
 */
export async function reconcileFamilyMembership(
    familyCode: string,
    currentParentUserIds: number[],
    currentStudentCustomerIds: number[],
): Promise<void> {
    if (currentParentUserIds.length > 0) {
        const staleParents = await db
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.familyCode, familyCode),
                    ne(users.role, "student"),
                    notInArray(users.id, currentParentUserIds),
                ),
            );
        if (staleParents.length > 0) {
            const staleIds = staleParents.map((p) => p.id);
            await db.delete(parentChildLinks).where(inArray(parentChildLinks.parentUserId, staleIds));
            await db.update(users).set({ familyCode: null }).where(inArray(users.id, staleIds));
        }
    }
    if (currentStudentCustomerIds.length > 0) {
        const staleStudents = await db
            .select({ id: customers.id, externalId: customers.externalId })
            .from(customers)
            .where(
                and(
                    eq(customers.familyCode, familyCode),
                    eq(customers.customerKind, "student"),
                    notInArray(customers.id, currentStudentCustomerIds),
                ),
            );
        if (staleStudents.length > 0) {
            const staleIds = staleStudents.map((s) => s.id);
            await db.delete(parentChildLinks).where(inArray(parentChildLinks.childCustomerId, staleIds));
            // Deactivate rather than just orphan (per 2026-07 review) — a
            // student dropped from every family roster shouldn't keep
            // spending at POS. upsertStudent() re-activates them if ISB ever
            // brings them back into a family's roster.
            await db.update(customers).set({ familyCode: null, isActive: false }).where(inArray(customers.id, staleIds));
            // Also clear the student's own login user row — see the matching
            // comment in reconcileFamilyStudents() above (closes the "known
            // gap" this function's own docstring used to document).
            const staleExtIds = staleStudents.map((s) => s.externalId).filter((id): id is string => !!id);
            if (staleExtIds.length > 0) {
                await db.update(users).set({ familyCode: null }).where(
                    and(inArray(users.externalId, staleExtIds), eq(users.role, "student")),
                );
            }
        }
    }
}

