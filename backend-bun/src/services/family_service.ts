import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { parentChildLinks, customers, users, wallets } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

export interface ChildSummaryDTO {
  link_id: number;
  relation: string;
  customer_id: number;
  customer_code: string;
  student_code: string | null;
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
  wallet_id: number | null;
  wallet_balance: number | null;
  photo_url: string | null;
  username: string | null;
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
  const coUsers = await db
    .select()
    .from(users)
    .where(and(eq(users.familyCode, familyCode), ne(users.id, parentUserId), eq(users.isActive, true)));

  const results: CoParentSummaryDTO[] = [];
  for (const u of coUsers) {
    const linkRows = await db
      .select()
      .from(parentChildLinks)
      .where(eq(parentChildLinks.parentUserId, u.id))
      .limit(1);
    const link = linkRows[0];
    const wallet = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, u.id))
      .limit(1);
    results.push({
      user_id: u.id,
      full_name: u.fullName || u.username || "",
      relation: link?.relation ?? null,
      parent_rank: link?.parentRank ?? null,
      wallet_id: wallet[0]?.id ?? null,
      wallet_balance: wallet[0] ? pgNumber(wallet[0].balance) : null,
      photo_url: u.photoUrl ?? null,
      username: u.username,
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
