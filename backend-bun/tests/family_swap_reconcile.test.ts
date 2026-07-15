/**
 * UAT issue #5 — "Swap Parent: orphan still linked" (docs/uat-issues-2026-07-15.md).
 *
 * Root cause: parent_child_links reconciliation (reconcileParentLinks) was
 * always correct — the row it's supposed to delete does get deleted. The
 * bug was one level up: users.family_code / customers.family_code (a
 * denormalized column read by family_service.ts::myCoparents,
 * wallet_service.ts::userCanAccessWallet, and transferWithinFamily's
 * non-admin same-family check) was never cleared for the parent/student
 * that just lost their last link, so they kept passing every "same family"
 * check forever even though the join table no longer connected them to
 * anyone.
 *
 * Each scenario below posts to the real POST /api/v1/sync/families entry
 * point (IsbSyncController.families -> processFamilyBatch), matching
 * tests/isb_sync.test.ts's conventions, then asserts against the DB
 * directly (parent_child_links + family_code), matching
 * tests/bay_callback_topup.test.ts's DB-integration style.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { users, customers, parentChildLinks, familyProfiles, wallets } from "@/db/schema";

const TEST_API_KEY = process.env.ISB_SYNC_API_KEY ?? "test-api-key";
const HAS_DB = !!process.env.DATABASE_URL;
let dbOk = false;

beforeAll(async () => {
  process.env.ISB_SYNC_API_KEY = TEST_API_KEY;
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_isb";
  }
  if (HAS_DB) {
    dbOk = await pingDb();
  }
});

async function getApp() {
  const { createTestApp } = await import("./helpers");
  return createTestApp();
}

async function postFamilies(
  app: { handle: (req: Request) => Response | Promise<Response> },
  families: unknown[],
): Promise<Response> {
  return app.handle(
    new Request("http://localhost/api/v1/sync/families", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": TEST_API_KEY },
      body: JSON.stringify({ families }),
    }),
  );
}

// ── Payload builders (real vendor shape — see docs/api/isb-payload-sample/parents.json) ──

function mkParent(customerId: number, first: string, customerType: "Parent" | "Staff" = "Parent") {
  return {
    customerId,
    customerType,
    firstName: first,
    lastName: "SwapTest",
    profileImage: `${customerId}_OT.jpg`,
    login: [`${customerId}@parents.isb.ac.th`],
    smartCard: { cardNumber: "" },
  };
}

function mkStudent(customerId: number, first = "Kid") {
  return {
    customerId,
    customerType: "Student" as const,
    firstName: first,
    lastName: "SwapTest",
    grade: "05",
    schoolType: "ES Student",
    profileImage: `${customerId}_ST.jpg`,
    smartCard: { cardNumber: "" },
  };
}

function mkFamily(args: {
  familyCode: number;
  mainParent: ReturnType<typeof mkParent>;
  secondaryParent?: ReturnType<typeof mkParent> | null;
  students: ReturnType<typeof mkStudent>[];
}) {
  return {
    familyCode: args.familyCode,
    notificationEmails: [],
    mainParent: args.mainParent,
    secondaryParent: args.secondaryParent ?? null,
    students: args.students,
  };
}

// ── DB assertion helpers ────────────────────────────────────────────────────

async function userByExtId(extId: number) {
  return (await db.select().from(users).where(eq(users.externalId, String(extId))).limit(1))[0];
}

async function customerByExtId(extId: number) {
  return (await db.select().from(customers).where(eq(customers.externalId, String(extId))).limit(1))[0];
}

async function linksForChild(childCustomerId: number) {
  return db.select().from(parentChildLinks).where(eq(parentChildLinks.childCustomerId, childCustomerId));
}

async function isParentLinkedToChild(parentUserId: number, childCustomerId: number): Promise<boolean> {
  const rows = await linksForChild(childCustomerId);
  return rows.some((r) => r.parentUserId === parentUserId);
}

// ── Test id namespace — unique per test run, scenario-labelled offsets so
// failures are easy to map back to the UAT scenario numbers (s1-s6). ────────

const RUN = Date.now() % 1_000_000;
const ns = (scenario: number, role: number) => 900_000_000 + RUN * 100 + scenario * 10 + role;

const allExtIds: number[] = [];
const allFamilyCodes: number[] = [];
function track(...ids: number[]) {
  allExtIds.push(...ids);
}
function trackFamily(...codes: number[]) {
  allFamilyCodes.push(...codes);
}

async function cleanup(): Promise<void> {
  if (allExtIds.length === 0 && allFamilyCodes.length === 0) return;
  const extIdStrs = allExtIds.map(String);
  if (extIdStrs.length > 0) {
    const userRows = await db.select({ id: users.id }).from(users).where(inArray(users.externalId, extIdStrs));
    const custRows = await db.select({ id: customers.id }).from(customers).where(inArray(customers.externalId, extIdStrs));
    // wallets.user_id / wallets.customer_id cascade parent_child_links but
    // NOT wallets themselves for user_id (onDelete "set null") — delete
    // explicitly so no orphaned wallet rows leak between test runs.
    if (userRows.length > 0) {
      await db.delete(wallets).where(inArray(wallets.userId, userRows.map((r) => r.id)));
    }
    if (custRows.length > 0) {
      await db.delete(wallets).where(inArray(wallets.customerId, custRows.map((r) => r.id)));
    }
    await db.delete(customers).where(inArray(customers.externalId, extIdStrs));
    await db.delete(users).where(inArray(users.externalId, extIdStrs));
  }
  if (allFamilyCodes.length > 0) {
    await db.delete(familyProfiles).where(inArray(familyProfiles.familyCode, allFamilyCodes.map(String)));
  }
}

describe("Family swap reconciliation (UAT #5)", () => {
  it.if(HAS_DB)(
    "s1: parent -> parent swap orphans the old parent (unlinked + family_code cleared)",
    async () => {
      if (!dbOk) return;
      const app = await getApp();
      const familyCode = ns(1, 0);
      const parentA = ns(1, 1);
      const parentB = ns(1, 2);
      const student = ns(1, 3);
      track(parentA, parentB, student);
      trackFamily(familyCode);

      const r1 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parentA, "Alice"), students: [mkStudent(student)] }),
      ]);
      expect(r1.status).toBe(200);

      const studentRow1 = await customerByExtId(student);
      const userA = await userByExtId(parentA);
      expect(await isParentLinkedToChild(userA.id, studentRow1.id)).toBe(true);

      // Swap: family now lists parent B instead of A.
      const r2 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parentB, "Bob"), students: [mkStudent(student)] }),
      ]);
      expect(r2.status).toBe(200);

      const studentRow2 = await customerByExtId(student);
      const userAAfter = await userByExtId(parentA);
      const userBAfter = await userByExtId(parentB);

      expect(await isParentLinkedToChild(userAAfter.id, studentRow2.id)).toBe(false);
      expect(await isParentLinkedToChild(userBAfter.id, studentRow2.id)).toBe(true);
      // The orphaned parent must stop matching family-scoped lookups
      // (myCoparents / userCanAccessWallet / transferWithinFamily).
      expect(userAAfter.familyCode).toBeNull();
      expect(userBAfter.familyCode).toBe(String(familyCode));

      await cleanup();
    },
    30_000,
  );

  it.if(HAS_DB)(
    "s2: main-parent swap + familyCode change orphans the old parent under the OLD code",
    async () => {
      if (!dbOk) return;
      const app = await getApp();
      const familyCodeOld = ns(2, 0);
      const familyCodeNew = ns(2, 4);
      const parentOld = ns(2, 1);
      const parentNew = ns(2, 2);
      const student = ns(2, 3);
      track(parentOld, parentNew, student);
      trackFamily(familyCodeOld, familyCodeNew);

      const r1 = await postFamilies(app, [
        mkFamily({ familyCode: familyCodeOld, mainParent: mkParent(parentOld, "Old"), students: [mkStudent(student)] }),
      ]);
      expect(r1.status).toBe(200);

      // Same student, family_code AND main parent both change in one sync.
      const r2 = await postFamilies(app, [
        mkFamily({ familyCode: familyCodeNew, mainParent: mkParent(parentNew, "New"), students: [mkStudent(student)] }),
      ]);
      expect(r2.status).toBe(200);

      const studentRow = await customerByExtId(student);
      const userOldAfter = await userByExtId(parentOld);
      const userNewAfter = await userByExtId(parentNew);

      expect(await isParentLinkedToChild(userOldAfter.id, studentRow.id)).toBe(false);
      expect(await isParentLinkedToChild(userNewAfter.id, studentRow.id)).toBe(true);
      expect(userOldAfter.familyCode).toBeNull();
      expect(userNewAfter.familyCode).toBe(String(familyCodeNew));
      expect(studentRow.familyCode).toBe(String(familyCodeNew));

      await cleanup();
    },
    30_000,
  );

  it.if(HAS_DB)(
    "s3: student swap orphans the old student (unlinked + family_code cleared), new student linked",
    async () => {
      if (!dbOk) return;
      const app = await getApp();
      const familyCode = ns(3, 0);
      const parent = ns(3, 1);
      const studentOld = ns(3, 2);
      const studentNew = ns(3, 3);
      track(parent, studentOld, studentNew);
      trackFamily(familyCode);

      const r1 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parent, "Parent"), students: [mkStudent(studentOld, "OldKid")] }),
      ]);
      expect(r1.status).toBe(200);

      // Family now lists a different student (customerId correction) — old
      // student externalId is no longer present in the payload at all.
      const r2 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parent, "Parent"), students: [mkStudent(studentNew, "NewKid")] }),
      ]);
      expect(r2.status).toBe(200);

      const oldStudentRow = await customerByExtId(studentOld);
      const newStudentRow = await customerByExtId(studentNew);
      const parentRow = await userByExtId(parent);

      expect(await isParentLinkedToChild(parentRow.id, oldStudentRow.id)).toBe(false);
      expect(await isParentLinkedToChild(parentRow.id, newStudentRow.id)).toBe(true);
      expect(oldStudentRow.familyCode).toBeNull();
      expect(newStudentRow.familyCode).toBe(String(familyCode));
      // Parent themselves wasn't swapped out — still an active family member.
      expect(parentRow.familyCode).toBe(String(familyCode));

      await cleanup();
    },
    30_000,
  );

  it.if(HAS_DB)(
    "s4: parent -> staff swap orphans the old parent (cross entity-type upsert path)",
    async () => {
      if (!dbOk) return;
      const app = await getApp();
      const familyCode = ns(4, 0);
      const parentOld = ns(4, 1);
      const staffNew = ns(4, 2);
      const student = ns(4, 3);
      track(parentOld, staffNew, student);
      trackFamily(familyCode);

      const r1 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parentOld, "OldParent"), students: [mkStudent(student)] }),
      ]);
      expect(r1.status).toBe(200);

      // Swap: family's main "parent" slot is now filled by a Staff record
      // (upsertStaffParentRef instead of upsertParent).
      const r2 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(staffNew, "NewStaff", "Staff"), students: [mkStudent(student)] }),
      ]);
      expect(r2.status).toBe(200);

      const studentRow = await customerByExtId(student);
      const userOldAfter = await userByExtId(parentOld);
      const userStaffAfter = await userByExtId(staffNew);

      expect(await isParentLinkedToChild(userOldAfter.id, studentRow.id)).toBe(false);
      expect(await isParentLinkedToChild(userStaffAfter.id, studentRow.id)).toBe(true);
      expect(userOldAfter.familyCode).toBeNull();
      expect(userStaffAfter.familyCode).toBe(String(familyCode));

      await cleanup();
    },
    30_000,
  );

  it.if(HAS_DB)(
    "s5 (control): re-syncing the SAME family/parent/student is a no-op — nothing orphaned",
    async () => {
      if (!dbOk) return;
      const app = await getApp();
      const familyCode = ns(5, 0);
      const parent = ns(5, 1);
      const student = ns(5, 3);
      track(parent, student);
      trackFamily(familyCode);

      const family = mkFamily({ familyCode, mainParent: mkParent(parent, "Same"), students: [mkStudent(student)] });
      const r1 = await postFamilies(app, [family]);
      expect(r1.status).toBe(200);
      const r2 = await postFamilies(app, [family]);
      expect(r2.status).toBe(200);

      const studentRow = await customerByExtId(student);
      const parentRow = await userByExtId(parent);

      expect(await isParentLinkedToChild(parentRow.id, studentRow.id)).toBe(true);
      expect(parentRow.familyCode).toBe(String(familyCode));
      expect(studentRow.familyCode).toBe(String(familyCode));
      const links = await linksForChild(studentRow.id);
      expect(links.length).toBe(1);

      await cleanup();
    },
    30_000,
  );

  it.if(HAS_DB)(
    "s6: orphan resurrection — A -> B -> A relinks cleanly with no unique-constraint explosion",
    async () => {
      if (!dbOk) return;
      const app = await getApp();
      const familyCode = ns(6, 0);
      const parentA = ns(6, 1);
      const parentB = ns(6, 2);
      const student = ns(6, 3);
      track(parentA, parentB, student);
      trackFamily(familyCode);

      const r1 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parentA, "A"), students: [mkStudent(student)] }),
      ]);
      expect(r1.status).toBe(200);

      // A -> B (A orphaned)
      const r2 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parentB, "B"), students: [mkStudent(student)] }),
      ]);
      expect(r2.status).toBe(200);

      const studentRowMid = await customerByExtId(student);
      const userAMid = await userByExtId(parentA);
      expect(await isParentLinkedToChild(userAMid.id, studentRowMid.id)).toBe(false);
      expect(userAMid.familyCode).toBeNull();

      // B -> A again (resurrection) — must not throw on the unique
      // (child_customer_id, parent_user_id) constraint and must relink cleanly.
      const r3 = await postFamilies(app, [
        mkFamily({ familyCode, mainParent: mkParent(parentA, "A-again"), students: [mkStudent(student)] }),
      ]);
      expect(r3.status).toBe(200);
      const body3 = (await r3.json()) as Record<string, unknown>;
      expect(body3.status).toBe("SUCCESS");

      const studentRowFinal = await customerByExtId(student);
      const userAFinal = await userByExtId(parentA);
      const userBFinal = await userByExtId(parentB);

      expect(await isParentLinkedToChild(userAFinal.id, studentRowFinal.id)).toBe(true);
      expect(await isParentLinkedToChild(userBFinal.id, studentRowFinal.id)).toBe(false);
      expect(userAFinal.familyCode).toBe(String(familyCode));
      expect(userBFinal.familyCode).toBeNull();

      const links = await linksForChild(studentRowFinal.id);
      expect(links.length).toBe(1);

      await cleanup();
    },
    30_000,
  );
});
