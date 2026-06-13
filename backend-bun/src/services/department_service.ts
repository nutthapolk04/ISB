import { and, eq, ilike, or, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, wallets } from "@/db/schema";
import { pgNumber } from "@/lib/dates";

export interface DepartmentSummaryDTO {
  id: number;
  department_code: string;
  department_name: string;
  is_active: boolean;
  wallet_id: number | null;
  wallet_balance: number | null;
}

export async function listDepartments(args: {
  q?: string;
  activeOnly?: boolean;
} = {}): Promise<DepartmentSummaryDTO[]> {
  const conds = [];
  if (args.activeOnly !== false) conds.push(eq(departments.isActive, true));
  if (args.q?.trim()) {
    const pat = `%${args.q.trim()}%`;
    conds.push(
      or(ilike(departments.departmentCode, pat), ilike(departments.departmentName, pat))!,
    );
  }

  const rows = await db
    .select({
      id: departments.id,
      department_code: departments.departmentCode,
      department_name: departments.departmentName,
      is_active: departments.isActive,
      wallet_id: wallets.id,
      wallet_balance: wallets.balance,
    })
    .from(departments)
    .leftJoin(wallets, eq(wallets.departmentId, departments.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(departments.departmentCode));

  return rows.map((r) => ({
    id: r.id,
    department_code: r.department_code,
    department_name: r.department_name,
    is_active: r.is_active,
    wallet_id: r.wallet_id ?? null,
    wallet_balance: r.wallet_balance !== null ? pgNumber(r.wallet_balance) : null,
  }));
}
