/**
 * ISB → Vendor Sync API
 *
 * Accepts Staff / Family / Department batches pushed by ISB.
 * Reuses upsert primitives from powerschool_sync.ts (no fault simulation,
 * no fixture loading — data comes from the HTTP request body).
 *
 * Photo URL: ISB sends a filename only ("202468_SF.jpg"). We store it as-is
 * until ISB confirms the base URL. Set ISB_PHOTO_BASE_URL env var to prepend
 * automatically once known.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, departments, familyProfiles, parentChildLinks, syncLogs, users } from "@/db/schema";
import { logger } from "@/logger";
import {
    getInternalTypeId,
    reconcileFamilyMembership,
    precomputeParentPasswordHashes,
    reconcileFamilyStudents,
    reconcileParentLinks,
    upsertFamilyProfile,
    upsertLink,
    upsertParent,
    upsertStaff,
    upsertStaffParentRef,
    upsertStudent,
    type FamilyBatchCtx,
    type StaffPayload,
    type StudentPayload,
} from "@/services/powerschool_sync";

// ── Photo URL helper ──────────────────────────────────────────────────────

function resolvePhotoUrl(filename: string | undefined | null): string | null {
    if (!filename) return null;
    const base = process.env.ISB_PHOTO_BASE_URL;
    if (base) return `${base.replace(/\/$/, "")}/${filename}`;
    return filename; // store raw filename until base URL is confirmed
}

// ── Sync log ──────────────────────────────────────────────────────────────

async function createSyncLog(syncType: string): Promise<number> {
    const [log] = await db.insert(syncLogs).values({
        syncType,
        targetRoles: [],
        triggeredBy: null,
        status: "running",
        recordsTotal: 0,
        recordsSuccess: 0,
        recordsFailed: 0,
    }).returning();
    return log.id;
}

async function finishSyncLog(
    logId: number,
    total: number,
    success: number,
    failed: number,
    errors: string[],
): Promise<void> {
    const status = failed === 0 ? "success" : success === 0 ? "failed" : "partial";
    await db.update(syncLogs).set({
        recordsTotal: total,
        recordsSuccess: success,
        recordsFailed: failed,
        status,
        finishedAt: new Date().toISOString(),
        errorLog: errors.length > 0 ? errors.slice(0, 100).join("\n") : null,
    }).where(eq(syncLogs.id, logId));
}

// ── Result shape ─────────────────────────────────────────────────────────

export interface BatchResult {
    success: number;
    failed: number;
    errors: Array<{ index: number; id: string | number; error: string }>;
}

// ── Staff batch ───────────────────────────────────────────────────────────

interface IsbStaff {
    customerId: number;
    customerType: "Staff";
    staffType: string;
    department: string;
    familyCode: number;
    firstName: string;
    lastName: string;
    hasChildren: boolean;
    profileImage: string;
    smartCard: { cardNumber: string };
    /** SSO login emails (string array). A staff member who's also a parent carries both. */
    login: string[];
}

// Bounded concurrency for per-record upserts — matches the DB pool size
// (db/client.ts: max 10) so batches of hundreds of records don't run fully
// sequentially (which was slow enough to trip nginx's proxy_read_timeout on
// large ISB syncs) while still capping how many connections a single sync
// request can hold at once.
const SYNC_CONCURRENCY = 10;

async function processInChunks<T>(
    items: T[],
    worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
    for (let start = 0; start < items.length; start += SYNC_CONCURRENCY) {
        const chunk = items.slice(start, start + SYNC_CONCURRENCY);
        await Promise.all(chunk.map((item, i) => worker(item, start + i)));
    }
}

export async function processStaffBatch(staffs: IsbStaff[]): Promise<BatchResult> {
    if (staffs.length === 0) {
        return { success: 0, failed: 0, errors: [] };
    }
    const logId = await createSyncLog("isb_staff");
    let success = 0, failed = 0;
    const errors: BatchResult["errors"] = [];

    await processInChunks(staffs, async (s, i) => {
        try {
            const payload: StaffPayload = {
                customerId: s.customerId,
                customerType: s.customerType,
                familyCode: s.familyCode,
                firstName: s.firstName,
                lastName: s.lastName,
                staffType: s.staffType,
                department: s.department,
                smartCard: { cardNumber: s.smartCard.cardNumber || "" },
                login: s.login,
                hasChildren: s.hasChildren,
            };
            const user = await upsertStaff(payload, logId);

            // Override photoUrl with ISB filename (upsertStaff sets randomuser portrait)
            const photoUrl = resolvePhotoUrl(s.profileImage);
            if (photoUrl && user.photoUrl !== photoUrl) {
                await db.update(users).set({ photoUrl }).where(eq(users.id, user.id));
            }

            success++;
        } catch (e) {
            failed++;
            errors.push({ index: i, id: s.customerId, error: (e as Error).message });
        }
    });

    await finishSyncLog(logId, staffs.length, success, failed, errors.map((e) => `staff[${e.index}] ${e.id}: ${e.error}`));
    return { success, failed, errors };
}

// ── Family batch ──────────────────────────────────────────────────────────

interface IsbParent {
    customerId: number;
    customerType: "Parent" | "Staff";
    firstName: string;
    lastName: string;
    profileImage: string;
    /** SSO login emails (string array). A non-staff parent usually carries one. */
    login: string[];
    smartCard: { cardNumber: string };
}

interface IsbStudent {
    customerId: number;
    customerType: "Student";
    firstName: string;
    lastName: string;
    grade: string;
    schoolType: string;
    profileImage: string;
    smartCard: { cardNumber: string };
}

interface IsbFamily {
    familyCode: number;
    notificationEmails: string[];
    mainParent: IsbParent;
    secondaryParent: IsbParent | null;
    students: IsbStudent[];
}

/**
 * Bulk-prefetch every row this batch could possibly need in a handful of
 * `WHERE x IN (...)` queries, instead of the 2-3 sequential SELECTs per
 * parent/student that upsertParent/upsertStaffParentRef/upsertStudent/
 * upsertLink/upsertFamilyProfile otherwise each run individually. Also
 * counts exactly how many NEW placeholder-password accounts this batch will
 * create, so their bcrypt hashes can be computed in parallel up front (see
 * precomputeParentPasswordHashes) instead of one at a time, serially, inside
 * the per-record write path — bcrypt cost=12 was the single largest
 * contributor to family-sync latency (~150-300ms per new account).
 */
async function buildFamilyBatchCtx(families: IsbFamily[]): Promise<FamilyBatchCtx> {
    const familyCodes = new Set<string>();
    const parentExtIds = new Set<string>();
    const parentEmails = new Set<string>();
    const staffParentExtIds = new Set<string>();
    const studentExtIds = new Set<string>();

    for (const fam of families) {
        familyCodes.add(String(fam.familyCode));
        for (const parent of [fam.mainParent, fam.secondaryParent]) {
            if (!parent) continue;
            const extId = String(parent.customerId);
            if (parent.customerType === "Staff") {
                staffParentExtIds.add(extId);
            } else {
                parentExtIds.add(extId);
                parentEmails.add((parent.login[0] ?? `${extId}@parents.isb.ac.th`).trim().toLowerCase());
            }
        }
        for (const st of fam.students) {
            studentExtIds.add(String(st.customerId));
        }
    }

    const [
        familyProfileRows,
        parentUsersByExtId,
        parentUsersByEmail,
        staffParentUsersByExtId,
        studentsByExtId,
        studentsByCode,
    ] = await Promise.all([
        familyCodes.size ? db.select().from(familyProfiles).where(inArray(familyProfiles.familyCode, [...familyCodes])) : Promise.resolve([]),
        parentExtIds.size ? db.select().from(users).where(inArray(users.externalId, [...parentExtIds])) : Promise.resolve([]),
        parentEmails.size ? db.select().from(users).where(inArray(users.email, [...parentEmails])) : Promise.resolve([]),
        staffParentExtIds.size ? db.select().from(users).where(inArray(users.externalId, [...staffParentExtIds])) : Promise.resolve([]),
        studentExtIds.size ? db.select().from(customers).where(inArray(customers.externalId, [...studentExtIds])) : Promise.resolve([]),
        studentExtIds.size ? db.select().from(customers).where(inArray(customers.studentCode, [...studentExtIds])) : Promise.resolve([]),
    ]);
    const studentLoginUsers = studentExtIds.size
        ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.username, [...studentExtIds]))
        : [];

    const usersByExtId = new Map<string, typeof users.$inferSelect>();
    for (const r of parentUsersByExtId) if (r.externalId) usersByExtId.set(r.externalId, r);
    for (const r of staffParentUsersByExtId) if (r.externalId) usersByExtId.set(r.externalId, r);
    const usersByEmail = new Map(parentUsersByEmail.map((r) => [r.email, r] as const));
    const customersByExtId = new Map<string, typeof customers.$inferSelect>();
    for (const r of studentsByExtId) if (r.externalId) customersByExtId.set(r.externalId, r);
    const customersByStudentCode = new Map<string, typeof customers.$inferSelect>();
    for (const r of studentsByCode) if (r.studentCode) customersByStudentCode.set(r.studentCode, r);
    const studentLoginUsersByUsername = new Map(studentLoginUsers.map((r) => [r.username, { id: r.id }] as const));

    // Existing parent_child_links for every student we already know about —
    // covers the upsertLink() existence check for the common "resync" case.
    const knownStudentIds = new Set<number>();
    for (const r of customersByExtId.values()) knownStudentIds.add(r.id);
    for (const r of customersByStudentCode.values()) knownStudentIds.add(r.id);
    const linkRows = knownStudentIds.size
        ? await db.select().from(parentChildLinks).where(inArray(parentChildLinks.childCustomerId, [...knownStudentIds]))
        : [];
    const links = new Map(linkRows.map((r) => [`${r.parentUserId}:${r.childCustomerId}`, r] as const));

    // Exact count of NEW placeholder-password accounts this batch will
    // create — parents/staff-parents not found above, plus students whose
    // login `users` row doesn't exist yet. Any undercount just falls back
    // to an inline hash (see takeHash in powerschool_sync.ts) — never a
    // correctness issue, only a (rare) perf one.
    let neededHashes = 0;
    for (const fam of families) {
        for (const parent of [fam.mainParent, fam.secondaryParent]) {
            if (!parent) continue;
            const extId = String(parent.customerId);
            if (parent.customerType === "Staff") {
                if (!usersByExtId.has(extId)) neededHashes++;
            } else {
                const email = (parent.login[0] ?? `${extId}@parents.isb.ac.th`).trim().toLowerCase();
                if (!usersByExtId.has(extId) && !usersByEmail.has(email)) neededHashes++;
            }
        }
        for (const st of fam.students) {
            const extId = String(st.customerId);
            if (!studentLoginUsersByUsername.has(extId)) neededHashes++;
        }
    }
    const hashPool = await precomputeParentPasswordHashes(neededHashes);

    return {
        familyProfiles: new Map(familyProfileRows.map((r) => [r.familyCode, r] as const)),
        usersByExtId,
        usersByEmail,
        customersByExtId,
        customersByStudentCode,
        studentLoginUsersByUsername,
        links,
        hashPool,
    };
}

export async function processFamilyBatch(families: IsbFamily[]): Promise<BatchResult> {
    if (families.length === 0) {
        return { success: 0, failed: 0, errors: [] };
    }
    const batchStart = performance.now();
    const logId = await createSyncLog("isb_family");
    const internalTypeId = await getInternalTypeId();
    let success = 0, failed = 0;
    const errors: BatchResult["errors"] = [];

    const prefetchStart = performance.now();
    const ctx = await buildFamilyBatchCtx(families);
    const prefetchMs = performance.now() - prefetchStart;

    const upsertStart = performance.now();
    await processInChunks(families, async (fam, i) => {
        const familyCode = String(fam.familyCode);

        try {
            // Family profile
            await upsertFamilyProfile(
                familyCode,
                fam.notificationEmails,
                [...fam.mainParent.login, ...(fam.secondaryParent?.login ?? [])],
                ctx,
            );

            // Parents
            const parentRows: Array<{ userId: number; rank: string }> = [];

            for (const [rank, parent] of [
                ["main", fam.mainParent],
                ["secondary", fam.secondaryParent],
            ] as Array<[string, IsbParent | null]>) {
                if (!parent) continue;

                const payload: StaffPayload = {
                    customerId: parent.customerId,
                    customerType: parent.customerType,
                    familyCode: fam.familyCode,
                    firstName: parent.firstName,
                    lastName: parent.lastName,
                    smartCard: { cardNumber: parent.smartCard.cardNumber || "" },
                };

                let user;
                if (parent.customerType === "Staff") {
                    user = await upsertStaffParentRef(payload, familyCode, logId, parent.login, ctx);
                } else {
                    user = await upsertParent(payload, familyCode, parent.login, logId, ctx);
                }

                // Override photo with ISB filename
                const photoUrl = resolvePhotoUrl(parent.profileImage);
                if (photoUrl && user.photoUrl !== photoUrl) {
                    await db.update(users).set({ photoUrl }).where(eq(users.id, user.id));
                }

                parentRows.push({ userId: user.id, rank });
            }

            // Students
            const studentCustomerIds: number[] = [];
            for (const st of fam.students) {
                const studentPayload: StudentPayload = {
                    customerId: st.customerId,
                    firstName: st.firstName,
                    lastName: st.lastName,
                    grade: st.grade,
                    schoolType: st.schoolType,
                    smartCard: { cardNumber: st.smartCard.cardNumber || "" },
                };
                const customer = await upsertStudent(studentPayload, familyCode, internalTypeId, logId, ctx);
                studentCustomerIds.push(customer.id);

                // Override photo
                const photoUrl = resolvePhotoUrl(st.profileImage);
                if (photoUrl && customer.photoUrl !== photoUrl) {
                    await db.update(customers).set({ photoUrl }).where(eq(customers.id, customer.id));
                }

                for (const { userId, rank } of parentRows) {
                    await upsertLink(userId, customer.id, rank, "guardian", ctx);
                }
                await reconcileParentLinks(customer.id, parentRows.map((p) => p.userId));
            }
            // A student swapped out of this family's roster (e.g. customerId
            // correction) never appears in the loop above — reconcile against
            // the whole family_code so the old student orphans cleanly too.
            await reconcileFamilyStudents(familyCode, studentCustomerIds);

            // A parent/staff whose identity changed (re-issued external_id),
            // or a student who was superseded by a new customerId, leaves
            // behind an old row that's no longer in this round's roster —
            // clear ITS family_code too, not just its per-child link (see
            // reconcileFamilyMembership's own comment for why this matters).
            await reconcileFamilyMembership(familyCode, parentRows.map((p) => p.userId), studentCustomerIds);

            success++;
        } catch (e) {
            failed++;
            errors.push({ index: i, id: fam.familyCode, error: (e as Error).message });
        }
    });
    const upsertMs = performance.now() - upsertStart;

    await finishSyncLog(logId, families.length, success, failed, errors.map((e) => `family[${e.index}] ${e.id}: ${e.error}`));
    const totalMs = performance.now() - batchStart;
    logger.info("isb family sync batch timing", {
        families: families.length,
        success,
        failed,
        totalMs: Math.round(totalMs),
        prefetchMs: Math.round(prefetchMs),
        upsertMs: Math.round(upsertMs),
    });
    return { success, failed, errors };
}

// ── Department batch ──────────────────────────────────────────────────────

interface IsbDepartment {
    departmentId: string;
    customerType: "Department";
    departmentDescription: string;
    login?: { loginId: string; email: string } | null;
    smartCard?: { cardNumber: string };
}

export async function processDepartmentBatch(depts: IsbDepartment[]): Promise<BatchResult> {
    if (depts.length === 0) {
        return { success: 0, failed: 0, errors: [] };
    }
    const logId = await createSyncLog("isb_department");
    let success = 0, failed = 0;
    const errors: BatchResult["errors"] = [];
    const currentYear = new Date().getFullYear();

    await processInChunks(depts, async (d, i) => {
        try {
            const code = d.departmentId;
            const existing = await db
                .select()
                .from(departments)
                .where(eq(departments.departmentCode, code))
                .limit(1);

            if (existing[0]) {
                await db.update(departments).set({
                    departmentName: d.departmentDescription,
                    updatedAt: new Date().toISOString(),
                }).where(eq(departments.departmentCode, code));
            } else {
                await db.insert(departments).values({
                    departmentCode: code,
                    departmentName: d.departmentDescription,
                    annualBudget: "0",
                    currentYear,
                    isActive: true,
                });
            }
            success++;
        } catch (e) {
            failed++;
            errors.push({ index: i, id: d.departmentId, error: (e as Error).message });
        }
    });

    await finishSyncLog(logId, depts.length, success, failed, errors.map((e) => `dept[${e.index}] ${e.id}: ${e.error}`));
    return { success, failed, errors };
}
