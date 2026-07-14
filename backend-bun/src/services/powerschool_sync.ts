/**
 * Mock PowerSchool sync — fixture-based port of FastAPI
 * app/services/powerschool_sync.py.
 *
 * Reads bundled JSON fixtures and upserts users/customers/family_profiles/
 * parent_child_links idempotently. Writes sync_logs + sync_audit_logs.
 *
 * The Cloudinary photo upload chain is NOT ported — Bun uses the realistic
 * portrait fallback URL (same as FastAPI does on photo-upload failure).
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
    users, customers, wallets, syncLogs, syncAuditLogs, parentChildLinks,
    familyProfiles, customerTypes, userLoginEmails,
} from "@/db/schema";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const PARENT_DEFAULT_PASSWORD = "parent";
const FAILURE_RATE = 0.08;

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

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

// ── Seeded RNG (mirrors Python random.Random(seed).random()) ──────────────
// Uses a 32-bit Mulberry32 PRNG seeded by SHA-1 of input — same input string
// always produces the same sequence, satisfying "deterministic per sync run".

function makeRng(seed: string): () => number {
    const hex = createHash("sha1").update(seed).digest("hex");
    let s = parseInt(hex.slice(0, 8), 16) >>> 0;
    return function () {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Fixture loading ───────────────────────────────────────────────────────

function loadFixture(name: string): Record<string, unknown> {
    const path = join(FIXTURE_DIR, name);
    return JSON.parse(readFileSync(path, "utf-8"));
}

// ── Audit snapshot helpers ────────────────────────────────────────────────

const USER_AUDIT_FIELDS = ["fullName", "email", "role", "customerType", "familyCode", "cardUid", "status", "shopId"] as const;
const CUSTOMER_AUDIT_FIELDS = ["name", "email", "familyCode", "customerType", "customerKind", "cardUid", "grade", "schoolType", "externalId"] as const;

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
 */
async function syncLoginEmails(userId: number, emails: (string | undefined | null)[]): Promise<void> {
    const cleaned = [...new Set(emails.map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean))];
    if (cleaned.length === 0) return;
    for (const email of cleaned) {
        await db.insert(userLoginEmails)
            .values({ userId, email })
            .onConflictDoUpdate({ target: userLoginEmails.email, set: { userId } });
    }
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
    await syncLoginEmails(userRow.id, logins);
    return userRow;
}

export async function upsertParent(payload: StaffPayload, familyCode: string, logins: string[], syncLogId: number): Promise<typeof users.$inferSelect> {
    const extId = String(payload.customerId);
    const fullName = `${payload.firstName} ${payload.lastName}`.trim();
    // "" (no card on file) must become null, not stored as-is — card_uid has a
    // unique index, so multiple cardless records would collide on "" the same
    // way blank logins collided on email (see upsertStaff's email fallback).
    const cardUid = payload.smartCard?.cardNumber || null;
    const email = (logins[0] ?? `${extId}@parents.isb.ac.th`).trim().toLowerCase();
    const username = email.split("@")[0].trim().toLowerCase();

    let existing = (await db.select().from(users).where(eq(users.externalId, extId)).limit(1))[0];
    if (!existing) existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];

    const created = !existing;
    const before = snapshot(existing as unknown as Record<string, unknown> | null, USER_AUDIT_FIELDS);

    const photoUrl = realisticPhoto("parent", extId);
    let userRow: typeof users.$inferSelect;
    if (created) {
        const hash = await Bun.password.hash(PARENT_DEFAULT_PASSWORD, { algorithm: "bcrypt", cost: 12 });
        const [u] = await db.insert(users).values({
            username, email, fullName,
            hashedPassword: hash,
            isActive: true, isSuperuser: false,
            role: "parent", status: "active",
            externalId: extId, familyCode,
            customerType: "Parent",
            cardUid, photoUrl,
            lastSyncedAt: new Date().toISOString(),
        }).returning();
        userRow = u;
    } else {
        const updates: Record<string, unknown> = {
            externalId: extId, familyCode, fullName,
            customerType: "Parent", role: "parent",
            photoUrl: existing!.photoUrl ?? photoUrl,
            lastSyncedAt: new Date().toISOString(),
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
    await syncLoginEmails(userRow.id, logins.length > 0 ? logins : [email]);
    return userRow;
}

export async function upsertStaffParentRef(payload: StaffPayload, familyCode: string, syncLogId: number, logins: string[] = []): Promise<typeof users.$inferSelect> {
    const extId = String(payload.customerId);
    let existing = (await db.select().from(users).where(eq(users.externalId, extId)).limit(1))[0];
    const created = !existing;
    const before = snapshot(existing as unknown as Record<string, unknown> | null, USER_AUDIT_FIELDS);

    let userRow: typeof users.$inferSelect;
    if (created) {
        const fullName = `${payload.firstName} ${payload.lastName}`.trim();
        const email = `${(payload.firstName ?? "staff").toLowerCase()}${extId}@isb.ac.th`;
        const hash = await Bun.password.hash(PARENT_DEFAULT_PASSWORD, { algorithm: "bcrypt", cost: 12 });
        const [u] = await db.insert(users).values({
            username: `staff_${extId}`, email, fullName,
            hashedPassword: hash,
            isActive: true, isSuperuser: false,
            role: "staff", status: "active",
            externalId: extId, customerType: "Staff",
            familyCode,
            cardUid: payload.smartCard?.cardNumber || null,
            lastSyncedAt: new Date().toISOString(),
        }).returning();
        userRow = u;
    } else {
        const updates: Record<string, unknown> = {
            familyCode,
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
    await syncLoginEmails(userRow.id, logins);
    return userRow;
}

export interface StudentPayload {
    customerId: number | string;
    firstName: string;
    lastName: string;
    grade?: string;
    schoolType?: string;
    smartCard?: { cardNumber?: string };
}

export async function upsertStudent(payload: StudentPayload, familyCode: string, internalTypeId: number, syncLogId: number): Promise<typeof customers.$inferSelect> {
    const extId = String(payload.customerId);
    const fullName = `${payload.firstName} ${payload.lastName}`.trim();
    const grade = payload.grade ?? null;
    const schoolType = payload.schoolType ?? null;
    // "" (no card on file) must become null, not stored as-is — card_uid has a
    // unique index, so multiple cardless records would collide on "" the same
    // way blank logins collided on email (see upsertStaff's email fallback).
    const cardUid = payload.smartCard?.cardNumber || null;

    let existing = (await db.select().from(customers).where(eq(customers.externalId, extId)).limit(1))[0];
    if (!existing) existing = (await db.select().from(customers).where(eq(customers.studentCode, extId)).limit(1))[0];

    const created = !existing;
    const before = snapshot(existing as unknown as Record<string, unknown> | null, CUSTOMER_AUDIT_FIELDS);

    const photoUrl = realisticPhoto("student", extId);
    let custRow: typeof customers.$inferSelect;
    if (created) {
        const [c] = await db.insert(customers).values({
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
            customerType: "Student",
            cardUid,
            photoUrl,
            powerschoolSyncAt: new Date().toISOString(),
        }).returning();
        custRow = c;
        // Wallet (demo balance 500)
        await db.insert(wallets).values({ customerId: c.id, balance: "500", isActive: true });
    } else {
        const updates: Record<string, unknown> = {
            externalId: extId, familyCode, name: fullName, grade, schoolType,
            customerType: "Student", customerKind: "student",
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
    const studentUser = (await db.select({ id: users.id }).from(users).where(eq(users.username, extId)).limit(1))[0];
    if (!studentUser) {
        const hash = await Bun.password.hash(PARENT_DEFAULT_PASSWORD, { algorithm: "bcrypt", cost: 12 });
        await db.insert(users).values({
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
        });
    }
    return custRow;
}

export async function upsertFamilyProfile(familyCode: string, notificationEmails: string[], loginIds: string[]): Promise<void> {
    const existing = (await db.select().from(familyProfiles).where(eq(familyProfiles.familyCode, familyCode)).limit(1))[0];
    if (existing) {
        await db.update(familyProfiles).set({
            notificationEmails, loginIds,
            lastSyncedAt: new Date().toISOString(),
        }).where(eq(familyProfiles.familyCode, familyCode));
    } else {
        await db.insert(familyProfiles).values({
            familyCode, notificationEmails, loginIds,
            lastSyncedAt: new Date().toISOString(),
        });
    }
}

export async function upsertLink(parentId: number, childId: number, parentRank: string, relation = "guardian"): Promise<void> {
    const existing = (await db.select().from(parentChildLinks).where(
        and(
            eq(parentChildLinks.parentUserId, parentId),
            eq(parentChildLinks.childCustomerId, childId),
        ),
    ).limit(1))[0];
    if (existing) {
        const updates: Record<string, unknown> = { parentRank };
        if (relation && existing.relation === "guardian") updates.relation = relation;
        await db.update(parentChildLinks).set(updates).where(eq(parentChildLinks.id, existing.id));
    } else {
        await db.insert(parentChildLinks).values({
            parentUserId: parentId,
            childCustomerId: childId,
            relation, parentRank,
        });
    }
}

/**
 * A family's mainParent/secondaryParent is authoritative per sync — at most
 * one of each. If a parent's FTID changes (same person, new external_id),
 * the old id's row is never in `currentParentUserIds`, so this drops its
 * main/secondary link to the child. The old user/wallet themselves are never
 * touched here — they simply stop being linked to this child (orphaned from
 * the family, not deleted).
 */
export async function reconcileParentLinks(
    childCustomerId: number,
    currentParentUserIds: number[],
): Promise<void> {
    if (currentParentUserIds.length === 0) return;
    await db.delete(parentChildLinks).where(
        and(
            eq(parentChildLinks.childCustomerId, childCustomerId),
            inArray(parentChildLinks.parentRank, ["main", "secondary"]),
            notInArray(parentChildLinks.parentUserId, currentParentUserIds),
        ),
    );
}

// ── Family orchestration ──────────────────────────────────────────────────

interface FamilyPayload {
    familyCode: number | string;
    login?: string[];
    notificationEmails?: string[];
    mainParent?: StaffPayload;
    secondaryParent?: StaffPayload;
    students?: StudentPayload[];
}

async function processFamily(args: {
    family: FamilyPayload;
    targetRoles: string[];
    rng: () => number;
    internalTypeId: number;
    faultRate: number;
    syncLogId: number;
}): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0, failed = 0;
    const errors: string[] = [];
    const familyCode = String(args.family.familyCode);

    try {
        await upsertFamilyProfile(
            familyCode,
            args.family.notificationEmails ?? [],
            args.family.login ?? [],
        );
        success += 1;
    } catch (e) {
        failed += 1;
        errors.push(`family_profile ${familyCode}: ${(e as Error).message}`);
    }

    const loginArray = args.family.login ?? [];
    const parentsWithRank: Array<{ rank: string; payload: StaffPayload }> = [];
    if (args.family.mainParent) parentsWithRank.push({ rank: "main", payload: args.family.mainParent });
    if (args.family.secondaryParent) parentsWithRank.push({ rank: "secondary", payload: args.family.secondaryParent });

    const parentUserRows: Array<{ user: typeof users.$inferSelect; rank: string }> = [];
    for (let idx = 0; idx < parentsWithRank.length; idx++) {
        const { rank, payload } = parentsWithRank[idx];
        const ctype = payload.customerType ?? "Parent";
        const roleKey = ctype === "Staff" ? "staff" : "parent";
        if (!args.targetRoles.includes(roleKey)) continue;

        if (args.rng() < args.faultRate) {
            failed += 1;
            errors.push(`Validation error: ${roleKey} #${payload.customerId} (${familyCode})`);
            continue;
        }
        try {
            let user: typeof users.$inferSelect;
            if (ctype === "Staff") {
                user = await upsertStaffParentRef(payload, familyCode, args.syncLogId);
            } else {
                const logins = idx < loginArray.length ? [loginArray[idx]] : [];
                user = await upsertParent(payload, familyCode, logins, args.syncLogId);
            }
            parentUserRows.push({ user, rank });
            success += 1;
        } catch (e) {
            failed += 1;
            errors.push(`parent ${payload.customerId}: ${(e as Error).message}`);
        }
    }

    if (args.targetRoles.includes("student")) {
        for (const sp of args.family.students ?? []) {
            if (args.rng() < args.faultRate) {
                failed += 1;
                errors.push(`Invalid grade for student #${sp.customerId}`);
                continue;
            }
            try {
                const student = await upsertStudent(sp, familyCode, args.internalTypeId, args.syncLogId);
                for (const { user, rank } of parentUserRows) {
                    await upsertLink(user.id, student.id, rank);
                }
                await reconcileParentLinks(student.id, parentUserRows.map((p) => p.user.id));
                success += 1;
            } catch (e) {
                failed += 1;
                errors.push(`student ${sp.customerId}: ${(e as Error).message}`);
            }
        }
    }

    return { success, failed, errors };
}

function selectSubset<T>(items: T[], syncType: string, rng: () => number): T[] {
    if (syncType === "full") return items;
    return items.filter(() => rng() < 0.6);
}

// ── Entry point ───────────────────────────────────────────────────────────

export interface RunSyncInput {
    triggeredById: number | null;
    syncType: "full" | "delta";
    targetRoles: string[];
    faultRate?: number;
}

export interface RunSyncResult {
    sync_log_id: number;
    status: string;
    sync_type: string;
    target_roles: string[];
    records_total: number;
    records_success: number;
    records_failed: number;
    started_at: string;
    finished_at: string | null;
    error_log: string | null;
}

export async function runSync(input: RunSyncInput): Promise<RunSyncResult> {
    const targetRoles = input.targetRoles.length > 0 ? input.targetRoles : ["student", "parent", "staff"];
    const faultRate = input.faultRate ?? FAILURE_RATE;

    // Create running sync_log first
    const [log] = await db.insert(syncLogs).values({
        syncType: input.syncType,
        targetRoles,
        triggeredBy: input.triggeredById,
        status: "running",
        recordsTotal: 0,
        recordsSuccess: 0,
        recordsFailed: 0,
    }).returning();

    const rng = makeRng(`${log.id}-${input.syncType}`);
    const internalTypeId = await getInternalTypeId();
    const errors: string[] = [];
    let total = 0, success = 0, failed = 0;

    try {
        if (targetRoles.includes("staff")) {
            const staffs = (loadFixture("ps_staffs.json").staffs as StaffPayload[]) ?? [];
            const subset = selectSubset(staffs, input.syncType, rng);
            for (const s of subset) {
                total += 1;
                if (rng() < faultRate) {
                    failed += 1;
                    errors.push(`Validation error: staff #${s.customerId} missing email`);
                    continue;
                }
                try {
                    await upsertStaff(s, log.id);
                    success += 1;
                } catch (e) {
                    failed += 1;
                    errors.push(`staff ${s.customerId}: ${(e as Error).message}`);
                }
            }
        }

        const families = (loadFixture("ps_families.json").families as FamilyPayload[]) ?? [];
        const famSubset = selectSubset(families, input.syncType, rng);
        for (const fam of famSubset) {
            const r = await processFamily({
                family: fam, targetRoles, rng, internalTypeId, faultRate, syncLogId: log.id,
            });
            total += r.success + r.failed;
            success += r.success;
            failed += r.failed;
            errors.push(...r.errors);
        }
    } catch (e) {
        errors.push(`Engine crash: ${(e as Error).message}`);
        failed += 1;
    }

    const status = failed === 0 ? "success" : success === 0 ? "failed" : "partial";
    const finishedAt = new Date().toISOString();
    await db.update(syncLogs).set({
        recordsTotal: total,
        recordsSuccess: success,
        recordsFailed: failed,
        status,
        finishedAt,
        errorLog: errors.length > 0 ? errors.slice(0, 50).join("\n") : null,
    }).where(eq(syncLogs.id, log.id));

    return {
        sync_log_id: log.id,
        status,
        sync_type: input.syncType,
        target_roles: targetRoles,
        records_total: total,
        records_success: success,
        records_failed: failed,
        started_at: typeof log.startedAt === "string" ? log.startedAt : new Date().toISOString(),
        finished_at: finishedAt,
        error_log: errors.length > 0 ? errors.slice(0, 50).join("\n") : null,
    };
}
