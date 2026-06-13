import { eq, and, or, ilike, asc, inArray, sql, ne } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { customers, users, wallets, parentChildLinks, customerTypes, receipts } from "@/db/schema";
import { pgNumber } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/auth";

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

async function profileForCustomerId(id: number): Promise<StudentProfileDTO> {
  const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!rows[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const ws = await walletByCustomerIds([id]);
  return customerToProfile(rows[0], ws.get(id));
}

/** Permission gate for customer mutations: admin/manager/cashier bypass; otherwise must own a parent_child_link. */
async function assertCustomerAccess(caller: AccessTokenPayload, customerId: number): Promise<void> {
  if (caller.is_superuser || caller.roles.some((r) => ["admin", "manager", "cashier"].includes(r))) return;
  const link = await db
    .select()
    .from(parentChildLinks)
    .where(and(eq(parentChildLinks.parentUserId, Number(caller.sub)), eq(parentChildLinks.childCustomerId, customerId)))
    .limit(1);
  if (!link[0]) {
    const err = new Error("Not authorized");
    (err as { status?: number }).status = 403;
    throw err;
  }
}

export async function freezeCard(caller: AccessTokenPayload, customerId: number, frozen: boolean): Promise<StudentProfileDTO> {
  await assertCustomerAccess(caller, customerId);
  const rows = await db.update(customers).set({ cardFrozen: frozen }).where(eq(customers.id, customerId)).returning();
  if (!rows[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return profileForCustomerId(customerId);
}

export async function setDailyLimit(caller: AccessTokenPayload, customerId: number, limit: number | null): Promise<StudentProfileDTO> {
  await assertCustomerAccess(caller, customerId);
  const rows = await db
    .update(customers)
    .set({ dailyLimit: limit !== null ? String(limit) : null })
    .where(eq(customers.id, customerId))
    .returning();
  if (!rows[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return profileForCustomerId(customerId);
}

export async function updateAllergies(customerId: number, args: {
  allergies?: string | null;
  dietary_notes?: string | null;
  allergy_override_note?: string | null;
}): Promise<StudentProfileDTO> {
  const updates: Record<string, unknown> = {};
  if (args.allergies !== undefined) updates.allergies = args.allergies;
  if (args.dietary_notes !== undefined) updates.dietaryNotes = args.dietary_notes;
  if (args.allergy_override_note !== undefined) updates.allergyOverrideNote = args.allergy_override_note || null;

  const rows = await db.update(customers).set(updates).where(eq(customers.id, customerId)).returning();
  if (!rows[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return profileForCustomerId(customerId);
}

export async function setNegativeCreditLimit(customerId: number, limit: number | null): Promise<StudentProfileDTO> {
  const rows = await db
    .update(customers)
    .set({ negativeCreditLimit: limit !== null ? String(limit) : null })
    .where(eq(customers.id, customerId))
    .returning();
  if (!rows[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return profileForCustomerId(customerId);
}

export async function bindCard(customerId: number, cardUid: string | null): Promise<StudentProfileDTO> {
  // Existence check
  const cur = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!cur[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }

  if (cardUid) {
    const dupCust = await db
      .select({ id: customers.id, name: customers.name, customerCode: customers.customerCode })
      .from(customers)
      .where(and(eq(customers.cardUid, cardUid), ne(customers.id, customerId)))
      .limit(1);
    if (dupCust[0]) {
      const err = new Error(`Card already assigned to student ${dupCust[0].name} (${dupCust[0].customerCode})`);
      (err as { status?: number }).status = 409;
      throw err;
    }
    const dupUser = await db
      .select({ fullName: users.fullName, username: users.username })
      .from(users)
      .where(eq(users.cardUid, cardUid))
      .limit(1);
    if (dupUser[0]) {
      const err = new Error(`Card already assigned to user ${dupUser[0].fullName || dupUser[0].username}`);
      (err as { status?: number }).status = 409;
      throw err;
    }
  }

  await db.update(customers).set({ cardUid: cardUid || null }).where(eq(customers.id, customerId));
  return profileForCustomerId(customerId);
}

export interface CreateStudentInput {
  customer_code: string;
  name: string;
  student_code?: string | null;
  grade?: string | null;
  email?: string | null;
  phone?: string | null;
  allergies?: string | null;
  dietary_notes?: string | null;
  card_uid?: string | null;
  photo_url?: string | null;
  customer_type_id?: number | null;
  initial_balance?: number;
}

export async function createStudent(input: CreateStudentInput): Promise<StudentProfileDTO> {
  // Uniqueness checks
  const dupCode = await db.select({ id: customers.id }).from(customers).where(eq(customers.customerCode, input.customer_code)).limit(1);
  if (dupCode[0]) {
    const err = new Error("customer_code already exists");
    (err as { status?: number }).status = 409;
    throw err;
  }
  if (input.student_code) {
    const dupStudent = await db.select({ id: customers.id }).from(customers).where(eq(customers.studentCode, input.student_code)).limit(1);
    if (dupStudent[0]) {
      const err = new Error("student_code already exists");
      (err as { status?: number }).status = 409;
      throw err;
    }
  }
  if (input.card_uid) {
    const dupCard = await db.select({ id: customers.id }).from(customers).where(eq(customers.cardUid, input.card_uid)).limit(1);
    if (dupCard[0]) {
      const err = new Error("card_uid already exists");
      (err as { status?: number }).status = 409;
      throw err;
    }
  }

  // Resolve customer_type_id (default to INTERNAL if missing)
  let typeId = input.customer_type_id ?? null;
  if (!typeId) {
    const ct = await db.select({ id: customerTypes.id }).from(customerTypes).where(eq(customerTypes.typeName, "INTERNAL")).limit(1);
    if (ct[0]) {
      typeId = ct[0].id;
    } else {
      const [created] = await db
        .insert(customerTypes)
        .values({ typeName: "INTERNAL", description: "Student/staff", defaultPriceLevel: "internal" })
        .returning({ id: customerTypes.id });
      typeId = created.id;
    }
  }

  const customerId = await pgClient.begin(async (sqlTx) => {
    const cRows = await sqlTx<Array<{ id: number }>>`
      INSERT INTO customers
        (customer_code, name, student_code, grade, email, phone, allergies, dietary_notes,
         card_uid, photo_url, customer_type_id, is_active, card_frozen)
      VALUES (${input.customer_code}, ${input.name}, ${input.student_code ?? null},
              ${input.grade ?? null}, ${input.email ?? null}, ${input.phone ?? null},
              ${input.allergies ?? null}, ${input.dietary_notes ?? null},
              ${input.card_uid ?? null}, ${input.photo_url ?? null}, ${typeId}, true, false)
      RETURNING id
    `;
    const newId = cRows[0].id;
    await sqlTx`
      INSERT INTO wallets (customer_id, balance, is_active)
      VALUES (${newId}, ${input.initial_balance ?? 0}, true)
    `;
    return newId;
  });

  return profileForCustomerId(customerId);
}

export interface UpdateCustomerBasicInput {
  name?: string | null;
  grade?: string | null;
  school_type?: string | null;
  email?: string | null;
  phone?: string | null;
  family_code?: string | null;
}

export async function updateCustomerBasic(
  caller: AccessTokenPayload,
  customerId: number,
  input: UpdateCustomerBasicInput,
): Promise<StudentProfileDTO> {
  // Admin role check (caller assertion done at route)
  const cur = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!cur[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  await assertCustomerAccess(caller, customerId);

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== null) updates.name = input.name;
  if (input.grade !== undefined) updates.grade = input.grade;
  if (input.school_type !== undefined) updates.schoolType = input.school_type;
  if (input.email !== undefined) updates.email = input.email;
  if (input.phone !== undefined) updates.phone = input.phone;
  if (input.family_code !== undefined) updates.familyCode = (input.family_code ?? "").trim() || null;

  if (Object.keys(updates).length > 0) {
    await db.update(customers).set(updates).where(eq(customers.id, customerId));
  }
  return profileForCustomerId(customerId);
}

export async function deleteCustomer(customerId: number): Promise<void> {
  const cur = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!cur[0]) {
    const err = new Error("Customer not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  // Orphan receipts (preserve audit trail)
  await db.update(receipts).set({ customerId: null }).where(eq(receipts.customerId, customerId));
  await db.delete(customers).where(eq(customers.id, customerId));
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
