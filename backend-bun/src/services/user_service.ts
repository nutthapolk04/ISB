import { and, eq, ilike, isNull, or, sql, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { users, shops, customers, wallets, departments } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/auth";

export interface UserResponseDTO {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  role: string | null;
  is_active: boolean;
  is_superuser: boolean;
  shop_id: string | null;
  shop_name: string | null;
  shop_module: string | null;
  external_id: string | null;
  family_code: string | null;
  status: string | null;
  created_at: string | null;
}

export interface UserListResponseDTO {
  items: UserResponseDTO[];
  total: number;
}

export interface UserPayerLookupDTO {
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  photo_url: string | null;
  wallet_id: number;
  wallet_balance: number;
  is_active: boolean;
  department_id: number | null;
  department_code: string | null;
  department_name: string | null;
}

export interface FamilyMemberLookupDTO {
  entity_type: "user" | "customer";
  id: number;
  name: string;
  role: string | null;
  grade: string | null;
  photo_url: string | null;
  allergies: string | null;
  card_frozen: boolean;
  wallet_id: number | null;
  wallet_balance: number | null;
  customer_code: string | null;
  student_code: string | null;
  username: string | null;
}

export interface FamilyLookupResponseDTO {
  family_code: string | null;
  members: FamilyMemberLookupDTO[];
}

function userRow(
  u: typeof users.$inferSelect,
  shop: { name: string | null } | null,
): UserResponseDTO {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    full_name: u.fullName,
    role: u.role ?? null,
    is_active: u.isActive,
    is_superuser: u.isSuperuser,
    shop_id: u.shopId ?? null,
    shop_name: shop?.name ?? null,
    shop_module: u.shopModule ?? null,
    external_id: u.externalId ?? null,
    family_code: u.familyCode ?? null,
    status: u.status ?? null,
    created_at: pgToIso(u.createdAt),
  };
}

/**
 * Permission gate matching FastAPI users.py — admin / manager only; manager
 * is clamped to their own shop, and "unassigned" is admin-only.
 */
function userIsAdmin(u: AccessTokenPayload): boolean {
  return u.is_superuser || u.roles.includes("admin");
}

function userIsManager(u: AccessTokenPayload): boolean {
  return u.roles.includes("manager") && !userIsAdmin(u);
}

export interface ListUsersParams {
  caller: AccessTokenPayload & { shop_id?: string | null };
  q?: string;
  shopId?: string;
  role?: string;
  unassigned?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listUsers(p: ListUsersParams): Promise<UserListResponseDTO> {
  if (!userIsAdmin(p.caller) && !userIsManager(p.caller)) {
    const err = new Error("Only admins or shop managers may manage users");
    (err as { status?: number }).status = 403;
    throw err;
  }
  let shopId = p.shopId;
  let unassigned = p.unassigned ?? false;
  if (userIsManager(p.caller)) {
    if (!p.caller.shop_id) {
      const err = new Error("Manager has no shop assignment");
      (err as { status?: number }).status = 403;
      throw err;
    }
    shopId = p.caller.shop_id;
    unassigned = false;
  }

  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(p.pageSize ?? 50, 500);

  const conds = [];
  if (p.q?.trim()) {
    const pat = `%${p.q.trim()}%`;
    conds.push(or(ilike(users.username, pat), ilike(users.fullName, pat), ilike(users.email, pat))!);
  }
  if (p.role) conds.push(eq(users.role, p.role));
  if (unassigned) conds.push(isNull(users.shopId));
  else if (shopId) conds.push(eq(users.shopId, shopId));

  const whereExpr = conds.length > 0 ? and(...conds) : undefined;

  const totalRow = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(users)
    .where(whereExpr);
  const total = Number(totalRow[0]?.count ?? 0);

  const rows = await db
    .select({ user: users, shop: shops })
    .from(users)
    .leftJoin(shops, eq(shops.id, users.shopId))
    .where(whereExpr)
    .orderBy(asc(users.username))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((r) => userRow(r.user, r.shop)),
    total,
  };
}

/** Get user by id, with FastAPI-equivalent permission gating. */
export async function getUser(
  caller: AccessTokenPayload & { shop_id?: string | null },
  userId: number,
): Promise<UserResponseDTO> {
  const rows = await db
    .select({ user: users, shop: shops })
    .from(users)
    .leftJoin(shops, eq(shops.id, users.shopId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) {
    const err = new Error("User not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const target = rows[0].user;
  if (userIsAdmin(caller)) {
    // OK
  } else if (Number(caller.sub) === target.id) {
    // self
  } else if (userIsManager(caller)) {
    if (!caller.shop_id || target.shopId !== caller.shop_id) {
      const err = new Error("Not authorized");
      (err as { status?: number }).status = 403;
      throw err;
    }
  } else {
    const err = new Error("Not authorized");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return userRow(target, rows[0].shop);
}

async function payerView(target: typeof users.$inferSelect): Promise<UserPayerLookupDTO> {
  const walletRows = await db.select().from(wallets).where(eq(wallets.userId, target.id)).limit(1);
  const wallet = walletRows[0];
  let deptCode: string | null = null;
  let deptName: string | null = null;
  if (target.departmentId !== null) {
    const dept = await db
      .select({ code: departments.departmentCode, name: departments.departmentName })
      .from(departments)
      .where(eq(departments.id, target.departmentId))
      .limit(1);
    if (dept[0]) {
      deptCode = dept[0].code;
      deptName = dept[0].name;
    }
  }
  if (!wallet) {
    const err = new Error("Wallet not provisioned for this user yet");
    (err as { status?: number }).status = 409;
    throw err;
  }
  return {
    user_id: target.id,
    username: target.username,
    full_name: target.fullName,
    role: target.role ?? "",
    photo_url: target.photoUrl ?? null,
    wallet_id: wallet.id,
    wallet_balance: pgNumber(wallet.balance) ?? 0,
    is_active: target.isActive,
    department_id: target.departmentId ?? null,
    department_code: deptCode,
    department_name: deptName,
  };
}

export async function getUserPayerByUsername(username: string): Promise<UserPayerLookupDTO> {
  const rows = await db.select().from(users).where(ilike(users.username, username)).limit(1);
  if (!rows[0]) {
    const err = new Error("User not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!rows[0].isActive) {
    const err = new Error("User is inactive");
    (err as { status?: number }).status = 400;
    throw err;
  }
  return payerView(rows[0]);
}

export async function getUserPayerByCard(uid: string): Promise<UserPayerLookupDTO> {
  const rows = await db.select().from(users).where(ilike(users.cardUid, uid)).limit(1);
  if (!rows[0]) {
    const err = new Error("Card not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!rows[0].isActive) {
    const err = new Error("User is inactive");
    (err as { status?: number }).status = 400;
    throw err;
  }
  return payerView(rows[0]);
}

async function userToFamilyMember(u: typeof users.$inferSelect): Promise<FamilyMemberLookupDTO> {
  const w = await db.select().from(wallets).where(eq(wallets.userId, u.id)).limit(1);
  return {
    entity_type: "user",
    id: u.id,
    name: u.fullName || u.username,
    role: u.role ?? null,
    grade: null,
    photo_url: u.photoUrl ?? null,
    allergies: u.allergies ?? null,
    card_frozen: false,
    wallet_id: w[0]?.id ?? null,
    wallet_balance: w[0] ? pgNumber(w[0].balance) : null,
    customer_code: null,
    student_code: null,
    username: u.username,
  };
}

async function customerToFamilyMember(c: typeof customers.$inferSelect): Promise<FamilyMemberLookupDTO> {
  const w = await db.select().from(wallets).where(eq(wallets.customerId, c.id)).limit(1);
  return {
    entity_type: "customer",
    id: c.id,
    name: c.name,
    role: "student",
    grade: c.grade ?? null,
    photo_url: c.photoUrl ?? null,
    allergies: c.allergies ?? null,
    card_frozen: c.cardFrozen,
    wallet_id: w[0]?.id ?? null,
    wallet_balance: w[0] ? pgNumber(w[0].balance) : null,
    customer_code: c.customerCode,
    student_code: c.studentCode ?? null,
    username: null,
  };
}

export async function familyLookup(q: string): Promise<FamilyLookupResponseDTO> {
  const trimmed = q.trim();
  const userRows = await db.select().from(users).where(eq(users.username, trimmed)).limit(1);
  const members: FamilyMemberLookupDTO[] = [];

  if (userRows[0]) {
    const u = userRows[0];
    const familyCode = u.familyCode ?? null;
    members.push(await userToFamilyMember(u));
    if (familyCode) {
      const sameFamily = await db
        .select()
        .from(users)
        .where(and(eq(users.familyCode, familyCode), sql`${users.id} != ${u.id}`));
      for (const x of sameFamily) members.push(await userToFamilyMember(x));
      const familyCustomers = await db
        .select()
        .from(customers)
        .where(and(eq(customers.familyCode, familyCode), eq(customers.isActive, true)));
      for (const c of familyCustomers) members.push(await customerToFamilyMember(c));
    }
    return { family_code: familyCode, members };
  }

  // Try family_code directly
  const familyUsers = await db.select().from(users).where(eq(users.familyCode, trimmed));
  const familyCustomers = await db
    .select()
    .from(customers)
    .where(and(eq(customers.familyCode, trimmed), eq(customers.isActive, true)));
  if (familyUsers.length > 0 || familyCustomers.length > 0) {
    for (const u of familyUsers) members.push(await userToFamilyMember(u));
    for (const c of familyCustomers) members.push(await customerToFamilyMember(c));
    return { family_code: trimmed, members };
  }
  const err = new Error("Not found — try staff code or family code");
  (err as { status?: number }).status = 404;
  throw err;
}
