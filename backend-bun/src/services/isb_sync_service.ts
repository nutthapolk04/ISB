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
import { departments, syncLogs } from "@/db/schema";
import {
  getInternalTypeId,
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
  login: { loginId: string; email: string };
}

export async function processStaffBatch(staffs: IsbStaff[]): Promise<BatchResult> {
  const logId = await createSyncLog("isb_staff");
  let success = 0, failed = 0;
  const errors: BatchResult["errors"] = [];

  for (let i = 0; i < staffs.length; i++) {
    const s = staffs[i];
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
        const { users } = await import("@/db/schema");
        await db.update(users).set({ photoUrl }).where(eq(users.id, user.id));
      }

      success++;
    } catch (e) {
      failed++;
      errors.push({ index: i, id: s.customerId, error: (e as Error).message });
    }
  }

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
  login: string;
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
  const logId = await createSyncLog("isb_family");
  const internalTypeId = await getInternalTypeId();
  let success = 0, failed = 0;
  const errors: BatchResult["errors"] = [];

  for (let i = 0; i < families.length; i++) {
    const fam = families[i];
    const familyCode = String(fam.familyCode);

    try {
      // Family profile
      await upsertFamilyProfile(
        familyCode,
        fam.notificationEmails,
        [fam.mainParent.login, fam.secondaryParent?.login].filter(Boolean) as string[],
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
          user = await upsertStaffParentRef(payload, familyCode, logId);
        } else {
          user = await upsertParent(payload, familyCode, parent.login, logId);
        }

        // Override photo with ISB filename
        const photoUrl = resolvePhotoUrl(parent.profileImage);
        if (photoUrl && user.photoUrl !== photoUrl) {
          const { users } = await import("@/db/schema");
          await db.update(users).set({ photoUrl }).where(eq(users.id, user.id));
        }

        parentRows.push({ userId: user.id, rank });
        success++;
      }

      // Students
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

        // Override photo
        const photoUrl = resolvePhotoUrl(st.profileImage);
        if (photoUrl && customer.photoUrl !== photoUrl) {
          const { customers } = await import("@/db/schema");
          await db.update(customers).set({ photoUrl }).where(eq(customers.id, customer.id));
        }

        for (const { userId, rank } of parentRows) {
          await upsertLink(userId, customer.id, rank);
        }
        success++;
      }
    } catch (e) {
      failed++;
      errors.push({ index: i, id: fam.familyCode, error: (e as Error).message });
    }
  }

  await finishSyncLog(logId, families.length, success, failed, errors.map((e) => `family[${e.index}] ${e.id}: ${e.error}`));
  return { success, failed, errors };
}

// ── Department batch ──────────────────────────────────────────────────────

interface IsbDepartment {
  departmentId: number;
  customerType: "Department";
  departmentDescription: string;
  login?: { loginId: string; email: string } | null;
}

export async function processDepartmentBatch(depts: IsbDepartment[]): Promise<BatchResult> {
  const logId = await createSyncLog("isb_department");
  let success = 0, failed = 0;
  const errors: BatchResult["errors"] = [];
  const currentYear = new Date().getFullYear();

  for (let i = 0; i < depts.length; i++) {
    const d = depts[i];
    try {
      const code = String(d.departmentId);
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
  }

  await finishSyncLog(logId, depts.length, success, failed, errors.map((e) => `dept[${e.index}] ${e.id}: ${e.error}`));
  return { success, failed, errors };
}
