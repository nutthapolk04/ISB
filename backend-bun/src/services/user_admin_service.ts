import { and, asc, eq, inArray, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, customers, shops } from "@/db/schema";
import { pgToIso } from "@/lib/dates";

export interface UserListItemDTO {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  role: string | null;
  external_id: string | null;
  family_code: string | null;
  photo_url: string | null;
  status: string;
  is_active: boolean;
  last_synced_at: string | null;
  allergies: string | null;
  customer_type: string | null;
  staff_type: string | null;
  ps_department: string | null;
  card_uid: string | null;
  has_children: boolean;
  shop_id: string | null;
  shop_name: string | null;
}

export interface StaffPickerItemDTO {
  id: number;
  username: string;
  full_name: string;
  role: string | null;
  external_id: string | null;
  photo_url: string | null;
}

export interface StudentPickerItemDTO {
  id: number;
  name: string;
  student_code: string | null;
  customer_code: string;
  grade: string | null;
  family_code: string | null;
  external_id: string | null;
  school_type: string | null;
  card_uid: string | null;
}

async function familiesWithChildren(family_codes: Set<string>): Promise<Set<string>> {
  if (family_codes.size === 0) return new Set();
  const rows = await db
    .select({ fc: customers.familyCode })
    .from(customers)
    .where(and(inArray(customers.familyCode, [...family_codes]), isNotNull(customers.studentCode)));
  const out = new Set<string>();
  for (const r of rows) if (r.fc) out.add(r.fc);
  return out;
}

async function shopNameMap(): Promise<Map<string, string>> {
  const rows = await db.select({ id: shops.id, name: shops.name }).from(shops);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface ListAdminUsersParams {
  role?: string;
  q?: string;
  status?: string;
}

export async function listAdminUsers(p: ListAdminUsersParams = {}): Promise<UserListItemDTO[]> {
  const conds = [];
  if (p.role) conds.push(eq(users.role, p.role));
  if (p.status) conds.push(eq(users.status, p.status));
  if (p.q?.trim()) {
    const pat = `%${p.q.trim().toLowerCase()}%`;
    conds.push(
      or(
        ilike(users.fullName, pat),
        ilike(users.username, pat),
        ilike(users.email, pat),
        ilike(users.externalId, pat),
        ilike(users.cardUid, pat),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(users)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(users.id));

  const familyCodes = new Set<string>();
  for (const u of rows) if (u.familyCode) familyCodes.add(u.familyCode);
  const [withKids, shopNames] = await Promise.all([
    familiesWithChildren(familyCodes),
    shopNameMap(),
  ]);

  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    full_name: u.fullName,
    role: u.role ?? null,
    external_id: u.externalId ?? null,
    family_code: u.familyCode ?? null,
    photo_url: u.photoUrl ?? null,
    status: u.status || (u.isActive ? "active" : "inactive"),
    is_active: u.isActive,
    last_synced_at: pgToIso(u.lastSyncedAt),
    allergies: u.allergies ?? null,
    customer_type: u.customerType ?? null,
    staff_type: u.staffType ?? null,
    ps_department: u.psDepartment ?? null,
    card_uid: u.cardUid ?? null,
    has_children: !!(u.familyCode && withKids.has(u.familyCode)),
    shop_id: u.shopId ?? null,
    shop_name: u.shopId ? shopNames.get(u.shopId) ?? null : null,
  }));
}

export async function listStaffForPicker(args: {
  q?: string;
  roles?: string;
}): Promise<StaffPickerItemDTO[]> {
  const roleList = (
    args.roles?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
      "staff",
      "manager",
      "cashier",
      "kitchen",
      "admin",
    ]
  );

  const conds = [inArray(users.role, roleList), eq(users.isActive, true)];
  if (args.q?.trim()) {
    const pat = `%${args.q.trim().toLowerCase()}%`;
    conds.push(
      or(ilike(users.fullName, pat), ilike(users.username, pat), ilike(users.externalId, pat))!,
    );
  }

  const rows = await db
    .select()
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.fullName))
    .limit(200);

  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    full_name: u.fullName,
    role: u.role ?? null,
    external_id: u.externalId ?? null,
    photo_url: u.photoUrl ?? null,
  }));
}

export async function listStudentsForLink(q?: string): Promise<StudentPickerItemDTO[]> {
  const conds = [isNotNull(customers.studentCode)];
  if (q?.trim()) {
    const pat = `%${q.trim().toLowerCase()}%`;
    conds.push(
      or(
        ilike(customers.name, pat),
        ilike(customers.studentCode, pat),
        ilike(customers.customerCode, pat),
        ilike(customers.externalId, pat),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(customers)
    .where(and(...conds))
    .orderBy(asc(customers.id))
    .limit(200);

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    student_code: c.studentCode ?? null,
    customer_code: c.customerCode,
    grade: c.grade ?? null,
    family_code: c.familyCode ?? null,
    external_id: c.externalId ?? null,
    school_type: c.schoolType ?? null,
    card_uid: c.cardUid ?? null,
  }));
}
