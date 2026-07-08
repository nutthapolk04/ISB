import { and, eq, ilike, or, asc } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
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
    q?: string | null;
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

/**
 * Atomic department create + wallet seed. Used by cardholder create.
 * Mirrors DepartmentService.create_department (FastAPI).
 */
export async function createDepartment(args: {
    code: string;
    name: string;
    initialCredit?: number;
}): Promise<{ id: number; code: string; name: string; walletId: number; walletBalance: number }> {
    const dup = await db.select({ id: departments.id }).from(departments).where(eq(departments.departmentCode, args.code)).limit(1);
    if (dup[0]) {
        const err = new Error(`Department code ${args.code} already exists`);
        (err as { status?: number }).status = 409;
        throw err;
    }
    const credit = args.initialCredit ?? 0;
    let deptId = 0;
    let walletId = 0;
    await pgClient.begin(async (sqlTx) => {
        const ins = await sqlTx<Array<{ id: number }>>`
      INSERT INTO departments (department_code, department_name, is_active)
      VALUES (${args.code}, ${args.name}, true) RETURNING id
    `;
        deptId = ins[0].id;
        const wins = await sqlTx<Array<{ id: number }>>`
      INSERT INTO wallets (department_id, balance, is_active)
      VALUES (${deptId}, ${credit}, true) RETURNING id
    `;
        walletId = wins[0].id;
    });
    return { id: deptId, code: args.code, name: args.name, walletId, walletBalance: credit };
}

export async function updateDepartment(
  deptId: number,
  patch: { department_name?: string; is_active?: boolean },
): Promise<DepartmentSummaryDTO> {
  const existing = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, deptId))
    .limit(1);

  if (!existing[0]) {
    const err = new Error("Department not found");
    (err as { status?: number }).status = 404;
    throw err;
  }

  const set: Record<string, unknown> = {};
  if (patch.department_name !== undefined) set.departmentName = patch.department_name;
  if (patch.is_active !== undefined) set.isActive = patch.is_active;

  if (Object.keys(set).length > 0) {
    await db.update(departments).set(set).where(eq(departments.id, deptId));
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
    .where(eq(departments.id, deptId))
    .limit(1);

  const r = rows[0];
  return {
    id: r.id,
    department_code: r.department_code,
    department_name: r.department_name,
    is_active: r.is_active,
    wallet_id: r.wallet_id,
    wallet_balance: r.wallet_balance !== null ? pgNumber(r.wallet_balance) : null,
  };
}

export async function deleteDepartment(deptId: number): Promise<void> {
    const rows = await db
        .select({ id: departments.id, walletId: wallets.id, balance: wallets.balance })
        .from(departments)
        .leftJoin(wallets, eq(wallets.departmentId, departments.id))
        .where(eq(departments.id, deptId))
        .limit(1);

    if (!rows[0]) {
        const err = new Error("Department not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    const { walletId, balance } = rows[0];
    const bal = balance !== null ? Number(balance) : 0;
    if (bal !== 0) {
        const err = new Error(`Cannot delete department with non-zero balance (${bal}). Please zero the balance first.`);
        (err as { status?: number }).status = 400;
        throw err;
    }

    await pgClient.begin(async (sql) => {
        if (walletId !== null) {
            await sql`DELETE FROM wallet_transactions WHERE wallet_id = ${walletId}`;
            await sql`DELETE FROM wallets WHERE id = ${walletId}`;
        }
        await sql`DELETE FROM departments WHERE id = ${deptId}`;
    });
}
