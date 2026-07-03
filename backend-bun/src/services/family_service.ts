import { and, asc, eq, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { parentChildLinks, customers, users, wallets } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

export interface ChildSummaryDTO {
  link_id: number;
  relation: string;
  customer_id: number;
  customer_code: string;
  student_code: string | null;
  card_uid: string | null;
  name: string;
  grade: string | null;
  photo_url: string | null;
  allergies: string | null;
  card_frozen: boolean;
  wallet_id: number | null;
  wallet_balance: number | null;
}

export interface LowBalanceAlertDTO {
  child_customer_id: number;
  enabled: boolean;
  threshold: number | null;
  last_alert_at: string | null;
}

export interface CoParentSummaryDTO {
  user_id: number;
  full_name: string;
  relation: string | null;
  parent_rank: string | null;
  role: string | null;
  wallet_id: number | null;
  wallet_balance: number | null;
  photo_url: string | null;
  username: string | null;
  card_uid: string | null;
}

export interface ParentSummaryDTO {
  user_id: number;
  username: string;
  full_name: string | null;
  role: string;
  photo_url: string | null;
  wallet_id: number | null;
  wallet_balance: number | null;
  relation: string;
}

export interface StudentFamilyContextDTO {
  student_customer_id: number;
  parents: ParentSummaryDTO[];
  siblings: ChildSummaryDTO[];
}

async function ensureCustomerWallet(customerId: number): Promise<typeof wallets.$inferSelect | null> {
  const rows = await db.select().from(wallets).where(eq(wallets.customerId, customerId)).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db
    .insert(wallets)
    .values({ customerId, balance: "0", isActive: true })
    .returning();
  return created;
}

async function ensureUserWallet(userId: number): Promise<typeof wallets.$inferSelect | null> {
  const rows = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db
    .insert(wallets)
    .values({ userId, balance: "0", isActive: true })
    .returning();
  return created;
}

export async function myChildren(parentUserId: number): Promise<ChildSummaryDTO[]> {
  const links = await db
    .select()
    .from(parentChildLinks)
    .where(eq(parentChildLinks.parentUserId, parentUserId));

  const results: ChildSummaryDTO[] = [];
  for (const link of links) {
    const cr = await db.select().from(customers).where(eq(customers.id, link.childCustomerId)).limit(1);
    const c = cr[0];
    if (!c || !c.isActive) continue;
    const wallet = await ensureCustomerWallet(c.id);
    results.push({
      link_id: link.id,
      relation: link.relation,
      customer_id: c.id,
      customer_code: c.customerCode,
      student_code: c.studentCode ?? null,
      card_uid: c.cardUid ?? null,
      name: c.name,
      grade: c.grade ?? null,
      photo_url: c.photoUrl ?? null,
      allergies: c.allergies ?? null,
      card_frozen: c.cardFrozen,
      wallet_id: wallet?.id ?? null,
      wallet_balance: wallet ? pgNumber(wallet.balance) : null,
    });
  }
  return results;
}

export async function getLowBalanceAlert(parentUserId: number, childId: number): Promise<LowBalanceAlertDTO> {
  const links = await db
    .select()
    .from(parentChildLinks)
    .where(and(eq(parentChildLinks.parentUserId, parentUserId), eq(parentChildLinks.childCustomerId, childId)))
    .limit(1);
  if (!links[0]) {
    const err = new Error("Child not linked to current user");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const link = links[0];
  return {
    child_customer_id: childId,
    enabled: link.lowBalanceAlertEnabled,
    threshold: pgNumber(link.lowBalanceThreshold),
    last_alert_at: pgToIso(link.lastLowBalanceAlertAt),
  };
}

export async function myCoparents(parentUserId: number, familyCode: string | null): Promise<CoParentSummaryDTO[]> {
  if (!familyCode) return [];
  // Co-parents = other guardians in the same family, NOT students.
  // Students may have user accounts (for login) with the same family_code,
  // but they should appear under children (via parent_child_links), not here.
  const coUsers = await db
    .select()
    .from(users)
    .where(and(
      eq(users.familyCode, familyCode),
      ne(users.id, parentUserId),
      eq(users.isActive, true),
      ne(users.role, "student"),
    ));

  const results: CoParentSummaryDTO[] = [];
  for (const u of coUsers) {
    const linkRows = await db
      .select()
      .from(parentChildLinks)
      .where(eq(parentChildLinks.parentUserId, u.id))
      .limit(1);
    const link = linkRows[0];
    const wallet = await ensureUserWallet(u.id);
    results.push({
      user_id: u.id,
      full_name: u.fullName || u.username || "",
      relation: link?.relation ?? null,
      parent_rank: link?.parentRank ?? null,
      role: u.role ?? null,
      wallet_id: wallet?.id ?? null,
      wallet_balance: wallet ? pgNumber(wallet.balance) : null,
      photo_url: u.photoUrl ?? null,
      username: u.username,
      card_uid: u.cardUid ?? null,
    });
  }
  return results;
}

export async function studentFamilyContext(studentCode: string): Promise<StudentFamilyContextDTO> {
  const cr = await db
    .select()
    .from(customers)
    .where(eq(customers.studentCode, studentCode))
    .limit(1);
  let customer = cr[0];
  if (!customer) {
    const altRows = await db
      .select()
      .from(customers)
      .where(eq(customers.customerCode, studentCode))
      .limit(1);
    customer = altRows[0];
  }
  if (!customer) {
    const err = new Error("Student not found");
    (err as { status?: number }).status = 404;
    throw err;
  }

  const parentLinks = await db
    .select()
    .from(parentChildLinks)
    .where(eq(parentChildLinks.childCustomerId, customer.id));

  const parents: ParentSummaryDTO[] = [];
  const seenSiblingIds = new Set<number>();
  const siblings: ChildSummaryDTO[] = [];

  for (const pl of parentLinks) {
    const ur = await db.select().from(users).where(eq(users.id, pl.parentUserId)).limit(1);
    const parent = ur[0];
    if (!parent) continue;
    const pw = await ensureUserWallet(parent.id);
    parents.push({
      user_id: parent.id,
      username: parent.username,
      full_name: parent.fullName,
      role: parent.role ?? "parent",
      photo_url: parent.photoUrl ?? null,
      wallet_id: pw?.id ?? null,
      wallet_balance: pw ? pgNumber(pw.balance) : null,
      relation: pl.relation,
    });

    // Find sibling links (other children of the same parent)
    const siblingLinks = await db
      .select()
      .from(parentChildLinks)
      .where(and(eq(parentChildLinks.parentUserId, parent.id), ne(parentChildLinks.childCustomerId, customer.id)));
    for (const sl of siblingLinks) {
      if (seenSiblingIds.has(sl.childCustomerId)) continue;
      seenSiblingIds.add(sl.childCustomerId);
      const sCr = await db.select().from(customers).where(eq(customers.id, sl.childCustomerId)).limit(1);
      const sib = sCr[0];
      if (!sib || !sib.isActive) continue;
      const sw = await ensureCustomerWallet(sib.id);
      siblings.push({
        link_id: sl.id,
        relation: sl.relation,
        customer_id: sib.id,
        customer_code: sib.customerCode,
        student_code: sib.studentCode ?? null,
        card_uid: sib.cardUid ?? null,
        name: sib.name,
        grade: sib.grade ?? null,
        photo_url: sib.photoUrl ?? null,
        allergies: sib.allergies ?? null,
        card_frozen: sib.cardFrozen,
        wallet_id: sw?.id ?? null,
        wallet_balance: sw ? pgNumber(sw.balance) : null,
      });
    }
  }

  return {
    student_customer_id: customer.id,
    parents,
    siblings,
  };
}

export async function childrenByUserId(parentUserId: number): Promise<ChildSummaryDTO[]> {
  return myChildren(parentUserId);
}

export async function familyByUserId(parentUserId: number): Promise<{
  children: ChildSummaryDTO[];
  coparents: CoParentSummaryDTO[];
}> {
  const userRow = await db.select({ familyCode: users.familyCode })
    .from(users).where(eq(users.id, parentUserId)).limit(1);
  const familyCode = userRow[0]?.familyCode ?? null;
  const [children, coparents] = await Promise.all([
    myChildren(parentUserId),
    myCoparents(parentUserId, familyCode),
  ]);
  return { children, coparents };
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function updateLowBalanceAlert(args: {
  parentUserId: number;
  childId: number;
  enabled: boolean;
  threshold: number | null;
}): Promise<LowBalanceAlertDTO> {
  const links = await db
    .select()
    .from(parentChildLinks)
    .where(and(eq(parentChildLinks.parentUserId, args.parentUserId), eq(parentChildLinks.childCustomerId, args.childId)))
    .limit(1);
  if (!links[0]) {
    const err = new Error("Child not linked to current user");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (args.enabled && (args.threshold === null || args.threshold <= 0)) {
    const err = new Error("Threshold must be a positive number when alerts are enabled");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const updates: Record<string, unknown> = { lowBalanceAlertEnabled: args.enabled };
  if (args.threshold !== null) updates.lowBalanceThreshold = String(args.threshold);
  const [updated] = await db
    .update(parentChildLinks)
    .set(updates)
    .where(eq(parentChildLinks.id, links[0].id))
    .returning();
  return {
    child_customer_id: args.childId,
    enabled: updated.lowBalanceAlertEnabled,
    threshold: pgNumber(updated.lowBalanceThreshold),
    last_alert_at: pgToIso(updated.lastLowBalanceAlertAt),
  };
}

export interface LinkResponseDTO {
  id: number;
  parent_user_id: number;
  parent_username: string | null;
  parent_full_name: string | null;
  child_customer_id: number;
  child_name: string | null;
  child_student_code: string | null;
  child_is_active: boolean | null;
  relation: string;
}

export async function listLinks(): Promise<LinkResponseDTO[]> {
  const rows = await db
    .select({
      id: parentChildLinks.id,
      parentUserId: parentChildLinks.parentUserId,
      childCustomerId: parentChildLinks.childCustomerId,
      relation: parentChildLinks.relation,
      parentUsername: users.username,
      parentFullName: users.fullName,
      childName: customers.name,
      childStudentCode: customers.studentCode,
      childIsActive: customers.isActive,
    })
    .from(parentChildLinks)
    .leftJoin(users, eq(users.id, parentChildLinks.parentUserId))
    .leftJoin(customers, eq(customers.id, parentChildLinks.childCustomerId))
    .orderBy(asc(parentChildLinks.id));

  return rows.map((r) => ({
    id: r.id,
    parent_user_id: r.parentUserId,
    parent_username: r.parentUsername ?? null,
    parent_full_name: r.parentFullName ?? null,
    child_customer_id: r.childCustomerId,
    child_name: r.childName ?? null,
    child_student_code: r.childStudentCode ?? null,
    child_is_active: r.childIsActive ?? null,
    relation: r.relation,
  }));
}

export async function createLink(args: {
  parentUserId: number;
  childCustomerId: number;
  relation?: string;
}): Promise<LinkResponseDTO> {
  const pr = await db.select().from(users).where(eq(users.id, args.parentUserId)).limit(1);
  if (!pr[0]) {
    const err = new Error("Parent user not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const parent = pr[0];
  const role = (parent.role ?? "").toLowerCase();
  if (role !== "parent" && role !== "staff" && !parent.isSuperuser) {
    const err = new Error("User is not a parent or staff");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const cr = await db.select().from(customers).where(eq(customers.id, args.childCustomerId)).limit(1);
  if (!cr[0]) {
    const err = new Error("Child customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const existing = await db
    .select({ id: parentChildLinks.id })
    .from(parentChildLinks)
    .where(and(eq(parentChildLinks.parentUserId, args.parentUserId), eq(parentChildLinks.childCustomerId, args.childCustomerId)))
    .limit(1);
  if (existing[0]) {
    const err = new Error("Link already exists");
    (err as { status?: number }).status = 409;
    throw err;
  }

  const [created] = await db
    .insert(parentChildLinks)
    .values({
      parentUserId: args.parentUserId,
      childCustomerId: args.childCustomerId,
      relation: args.relation || "guardian",
    })
    .returning();
  // Ensure child wallet
  await ensureCustomerWallet(args.childCustomerId);
  const child = cr[0];

  // Propagate family_code between parent and child; generate one if both are null
  const resolvedCode = parent.familyCode ?? child.familyCode ?? `FAM-${created.id}`;
  if (!parent.familyCode) {
    await db.update(users).set({ familyCode: resolvedCode }).where(eq(users.id, parent.id));
  }
  if (!child.familyCode) {
    await db.update(customers).set({ familyCode: resolvedCode }).where(eq(customers.id, child.id));
  }
  return {
    id: created.id,
    parent_user_id: created.parentUserId,
    parent_username: parent.username,
    parent_full_name: parent.fullName,
    child_customer_id: created.childCustomerId,
    child_name: child.name,
    child_student_code: child.studentCode ?? null,
    child_is_active: child.isActive,
    relation: created.relation,
  };
}

export async function deleteLink(linkId: number): Promise<{ success: true }> {
  const rows = await db.select().from(parentChildLinks).where(eq(parentChildLinks.id, linkId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Link not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const { parentUserId, childCustomerId } = rows[0];
  await db.delete(parentChildLinks).where(eq(parentChildLinks.id, linkId));

  // Clear family_code if no remaining links exist for each side
  const remainingForChild = await db
    .select({ id: parentChildLinks.id })
    .from(parentChildLinks)
    .where(eq(parentChildLinks.childCustomerId, childCustomerId))
    .limit(1);
  if (!remainingForChild[0]) {
    await db.update(customers).set({ familyCode: null }).where(eq(customers.id, childCustomerId));
  }

  const remainingForParent = await db
    .select({ id: parentChildLinks.id })
    .from(parentChildLinks)
    .where(eq(parentChildLinks.parentUserId, parentUserId))
    .limit(1);
  if (!remainingForParent[0]) {
    await db.update(users).set({ familyCode: null }).where(eq(users.id, parentUserId));
  }

  return { success: true };
}

export interface FamilyFreezeResponseDTO {
  parent_user_id: number;
  frozen: boolean;
  affected_count: number;
  children: number[];
}

export async function freezeAllChildren(args: {
  caller: { id: number; isAdmin: boolean };
  parentUserId: number;
  frozen: boolean;
}): Promise<FamilyFreezeResponseDTO> {
  const pr = await db.select().from(users).where(eq(users.id, args.parentUserId)).limit(1);
  if (!pr[0]) {
    const err = new Error("Parent user not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!args.caller.isAdmin && args.caller.id !== args.parentUserId) {
    const err = new Error("Parents can only freeze their own family");
    (err as { status?: number }).status = 403;
    throw err;
  }
  const links = await db
    .select()
    .from(parentChildLinks)
    .where(eq(parentChildLinks.parentUserId, args.parentUserId));
  const affected: number[] = [];
  await pgClient.begin(async (sqlTx) => {
    for (const link of links) {
      const cur = await sqlTx<Array<{ id: number; card_frozen: boolean }>>`
        SELECT id, card_frozen FROM customers WHERE id = ${link.childCustomerId} FOR UPDATE
      `;
      if (!cur[0]) continue;
      if (Boolean(cur[0].card_frozen) !== args.frozen) {
        await sqlTx`UPDATE customers SET card_frozen = ${args.frozen} WHERE id = ${cur[0].id}`;
        affected.push(cur[0].id);
      }
    }
  });
  return {
    parent_user_id: args.parentUserId,
    frozen: args.frozen,
    affected_count: affected.length,
    children: affected,
  };
}

export interface OrphanParentDTO {
  user_id: number;
  username: string;
  full_name: string;
  email: string | null;
  family_code: string | null;
  external_id: string | null;
  customer_type: string | null;
}

export interface OrphanStudentDTO {
  customer_id: number;
  customer_code: string;
  student_code: string | null;
  name: string;
  grade: string | null;
  family_code: string | null;
  external_id: string | null;
}

export interface OrphansResponseDTO {
  parents_no_children: OrphanParentDTO[];
  students_no_parents: OrphanStudentDTO[];
}

export async function listOrphans(): Promise<OrphansResponseDTO> {
  const linkedParentRows = await db
    .selectDistinct({ id: parentChildLinks.parentUserId })
    .from(parentChildLinks);
  const linkedChildRows = await db
    .selectDistinct({ id: parentChildLinks.childCustomerId })
    .from(parentChildLinks);
  const linkedParents = new Set(linkedParentRows.map((r) => r.id));
  const linkedChildren = new Set(linkedChildRows.map((r) => r.id));

  const parents = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "parent"), eq(users.isActive, true)));
  const students = await db
    .select()
    .from(customers)
    .where(and(isNotNull(customers.studentCode), eq(customers.isActive, true)));

  return {
    parents_no_children: parents
      .filter((p) => !linkedParents.has(p.id))
      .map((u) => ({
        user_id: u.id,
        username: u.username,
        full_name: u.fullName || u.username,
        email: u.email ?? null,
        family_code: u.familyCode ?? null,
        external_id: u.externalId ?? null,
        customer_type: u.customerType ?? null,
      })),
    students_no_parents: students
      .filter((s) => !linkedChildren.has(s.id))
      .map((c) => ({
        customer_id: c.id,
        customer_code: c.customerCode,
        student_code: c.studentCode ?? null,
        name: c.name,
        grade: c.grade ?? null,
        family_code: c.familyCode ?? null,
        external_id: c.externalId ?? null,
      })),
  };
}
