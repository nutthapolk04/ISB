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

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, departments, syncLogs, users } from "@/db/schema";
import {
    getInternalTypeId,
    reconcileFamilyMembership,
    reconcileParentLinks,
    upsertFamilyProfile,
    upsertLink,
    upsertParent,
    upsertStaff,
    upsertStaffParentRef,
    upsertStudent,
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

export async function processFamilyBatch(families: IsbFamily[]): Promise<BatchResult> {
    if (families.length === 0) {
        return { success: 0, failed: 0, errors: [] };
    }
    const logId = await createSyncLog("isb_family");
    const internalTypeId = await getInternalTypeId();
    let success = 0, failed = 0;
    const errors: BatchResult["errors"] = [];

    await processInChunks(families, async (fam, i) => {
        const familyCode = String(fam.familyCode);

        try {
            // Family profile
            await upsertFamilyProfile(
                familyCode,
                fam.notificationEmails,
                [...fam.mainParent.login, ...(fam.secondaryParent?.login ?? [])],
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
                    user = await upsertStaffParentRef(payload, familyCode, logId, parent.login);
                } else {
                    user = await upsertParent(payload, familyCode, parent.login, logId);
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
                const customer = await upsertStudent(studentPayload, familyCode, internalTypeId, logId);
                studentCustomerIds.push(customer.id);

                // Override photo
                const photoUrl = resolvePhotoUrl(st.profileImage);
                if (photoUrl && customer.photoUrl !== photoUrl) {
                    await db.update(customers).set({ photoUrl }).where(eq(customers.id, customer.id));
                }

                for (const { userId, rank } of parentRows) {
                    await upsertLink(userId, customer.id, rank);
                }
                await reconcileParentLinks(customer.id, parentRows.map((p) => p.userId));
            }

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

    await finishSyncLog(logId, families.length, success, failed, errors.map((e) => `family[${e.index}] ${e.id}: ${e.error}`));
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
