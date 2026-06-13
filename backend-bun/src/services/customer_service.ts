import { eq, and, or, ilike, asc, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, users, wallets } from "@/db/schema";
import { pgNumber } from "@/lib/dates";

/**
 * StudentProfileResponse parity — fields can come from either the customers
 * table (students/departments) or the users table (parents/staff/teachers).
 * Frontend uses presence of `user_id` to switch payer flow.
 */
export interface StudentProfileDTO {
  id: number;
  customer_code: string;
  student_code: string | null;
  name: string;
  grade: string | null;
  school_type: string | null;
  customer_kind: string | null;
  photo_url: string | null;
  email: string | null;
  phone: string | null;
  allergies: string | null;
  dietary_notes: string | null;
  allergy_override_note: string | null;
  card_uid: string | null;
  card_frozen: boolean;
  daily_limit: number | null;
  negative_credit_limit: number | null;
  external_id: string | null;
  family_code: string | null;
  wallet_id: number | null;
  wallet_balance: number | null;
  user_id: number | null;
}

async function walletByCustomerIds(ids: number[]): Promise<Map<number, { id: number; balance: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: wallets.id, customerId: wallets.customerId, balance: wallets.balance })
    .from(wallets)
    .where(inArray(wallets.customerId, ids));
  const out = new Map<number, { id: number; balance: number }>();
  rows.forEach((r) => {
    if (r.customerId !== null) {
      out.set(r.customerId, { id: r.id, balance: pgNumber(r.balance) ?? 0 });
    }
  });
  return out;
}

async function walletByUserIds(ids: number[]): Promise<Map<number, { id: number; balance: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: wallets.id, userId: wallets.userId, balance: wallets.balance })
    .from(wallets)
    .where(inArray(wallets.userId, ids));
  const out = new Map<number, { id: number; balance: number }>();
  rows.forEach((r) => {
    if (r.userId !== null) {
      out.set(r.userId, { id: r.id, balance: pgNumber(r.balance) ?? 0 });
    }
  });
  return out;
}

function customerToProfile(
  c: typeof customers.$inferSelect,
  wallet: { id: number; balance: number } | undefined,
): StudentProfileDTO {
  return {
    id: c.id,
    customer_code: c.customerCode,
    student_code: c.studentCode ?? null,
    name: c.name,
    grade: c.grade ?? null,
    school_type: c.schoolType ?? null,
    customer_kind: c.customerKind ?? null,
    photo_url: c.photoUrl ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    allergies: c.allergies ?? null,
    dietary_notes: c.dietaryNotes ?? null,
    allergy_override_note: c.allergyOverrideNote ?? null,
    card_uid: c.cardUid ?? null,
    card_frozen: c.cardFrozen,
    daily_limit: pgNumber(c.dailyLimit),
    negative_credit_limit: pgNumber(c.negativeCreditLimit),
    external_id: c.externalId ?? null,
    family_code: c.familyCode ?? null,
    wallet_id: wallet?.id ?? null,
    wallet_balance: wallet?.balance ?? null,
    user_id: null,
  };
}

function userToProfile(
  u: typeof users.$inferSelect,
  wallet: { id: number; balance: number } | undefined,
): StudentProfileDTO {
  return {
    id: u.id,
    user_id: u.id,
    customer_code: u.username,
    student_code: null,
    name: u.fullName || u.username,
    grade: null,
    school_type: null,
    customer_kind: u.role || "user",
    photo_url: u.photoUrl ?? null,
    email: u.email ?? null,
    phone: null,
    allergies: u.allergies ?? null,
    dietary_notes: null,
    allergy_override_note: null,
    card_uid: u.cardUid ?? null,
    card_frozen: false,
    daily_limit: null,
    negative_credit_limit: null,
    external_id: u.externalId ?? null,
    family_code: u.familyCode ?? null,
    wallet_id: wallet?.id ?? null,
    wallet_balance: wallet?.balance ?? null,
  };
}

export interface SearchCustomersParams {
  q: string;
  limit?: number;
}

export async function searchCustomers(p: SearchCustomersParams): Promise<StudentProfileDTO[]> {
  const q = p.q.trim();
  if (q.length < 2) {
    const err = new Error("Query must be at least 2 characters");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const limit = p.limit ?? 10;
  const pattern = `%${q}%`;

  // Students / departments
  const customerRows = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.isActive, true),
        or(
          ilike(customers.name, pattern),
          ilike(customers.studentCode, pattern),
          ilike(customers.customerCode, pattern),
          ilike(customers.cardUid, pattern),
          ilike(customers.familyCode, pattern),
          ilike(customers.externalId, pattern),
          ilike(customers.email, pattern),
          ilike(customers.phone, pattern),
        ),
      ),
    )
    .orderBy(asc(customers.name))
    .limit(limit);

  // Parents / staff / teachers / visitors
  const userRows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        inArray(users.role, ["parent", "staff", "teacher", "visitor"]),
        or(
          ilike(users.fullName, pattern),
          ilike(users.username, pattern),
          ilike(users.email, pattern),
          ilike(users.familyCode, pattern),
          ilike(users.externalId, pattern),
          ilike(users.cardUid, pattern),
        ),
      ),
    )
    .orderBy(asc(users.fullName))
    .limit(limit);

  const [custWallets, userWallets] = await Promise.all([
    walletByCustomerIds(customerRows.map((r) => r.id)),
    walletByUserIds(userRows.map((r) => r.id)),
  ]);

  const combined: StudentProfileDTO[] = [
    ...customerRows.map((c) => customerToProfile(c, custWallets.get(c.id))),
    ...userRows.map((u) => userToProfile(u, userWallets.get(u.id))),
  ];
  combined.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return combined.slice(0, limit * 2);
}

export async function getCustomerByCode(code: string): Promise<StudentProfileDTO | null> {
  const rows = await db
    .select()
    .from(customers)
    .where(or(ilike(customers.studentCode, code), ilike(customers.customerCode, code)))
    .limit(1);
  if (!rows[0]) return null;
  const wallets = await walletByCustomerIds([rows[0].id]);
  return customerToProfile(rows[0], wallets.get(rows[0].id));
}

export async function getCustomerByCard(uid: string): Promise<StudentProfileDTO | null> {
  const rows = await db.select().from(customers).where(eq(customers.cardUid, uid)).limit(1);
  if (!rows[0]) return null;
  const wallets = await walletByCustomerIds([rows[0].id]);
  return customerToProfile(rows[0], wallets.get(rows[0].id));
}

export async function getCustomer(id: number): Promise<StudentProfileDTO | null> {
  const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!rows[0]) return null;
  const wallets = await walletByCustomerIds([id]);
  return customerToProfile(rows[0], wallets.get(id));
}

export interface ListCustomersParams {
  skip?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

export async function listCustomers(p: ListCustomersParams = {}): Promise<StudentProfileDTO[]> {
  const skip = p.skip ?? 0;
  const limit = Math.min(p.limit ?? 20, 100);
  const conds = [];
  if (p.isActive !== undefined) conds.push(eq(customers.isActive, p.isActive));
  if (p.search) {
    const pat = `%${p.search}%`;
    conds.push(
      or(
        ilike(customers.name, pat),
        ilike(customers.customerCode, pat),
        ilike(customers.studentCode, pat),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(customers)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(customers.name))
    .limit(limit)
    .offset(skip);
  const ws = await walletByCustomerIds(rows.map((r) => r.id));
  return rows.map((c) => customerToProfile(c, ws.get(c.id)));
}
