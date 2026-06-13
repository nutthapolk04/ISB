import { and, asc, desc, eq, gt, sql, sqlNull } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { customers, wallets } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

const VALID_METHODS = new Set(["CASH", "BANK_TRANSFER", "CHEQUE"]);
const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
};

export interface RefundCandidateDTO {
  id: number;
  name: string;
  student_code: string | null;
  family_code: string | null;
  is_graduated: boolean;
  wallet_id: number;
  wallet_balance: number;
  enroll_date: string | null;
  withdraw_date: string | null;
}

export interface RefundResponseDTO {
  transaction_id: number;
  customer_id: number;
  wallet_id: number;
  amount: number;
  refund_method: string;
  balance_before: number;
  balance_after: number;
  reason: "graduation_refund";
  notes: string | null;
  created_at: string;
  created_by_user_id: number;
}

export async function listRefundCandidates(): Promise<RefundCandidateDTO[]> {
  const rows = await db
    .select({ customer: customers, wallet: wallets })
    .from(customers)
    .innerJoin(wallets, eq(wallets.customerId, customers.id))
    .where(
      and(
        sql`${wallets.balance} > 0`,
        eq(wallets.isActive, true),
        eq(customers.isActive, true),
      ),
    )
    .orderBy(
      desc(customers.isGraduated),
      // NULLS LAST for withdraw_date desc
      sql`${customers.withdrawDate} DESC NULLS LAST`,
      asc(customers.name),
    );

  return rows.map(({ customer, wallet }) => ({
    id: customer.id,
    name: customer.name,
    student_code: customer.studentCode ?? null,
    family_code: customer.familyCode ?? null,
    is_graduated: customer.isGraduated,
    wallet_id: wallet.id,
    wallet_balance: pgNumber(wallet.balance) ?? 0,
    enroll_date: customer.enrollDate ?? null,
    withdraw_date: customer.withdrawDate ?? null,
  }));
}

export async function createGraduationRefund(args: {
  customerId: number;
  amount: number;
  method: string;
  notes: string | null;
  userId: number;
}): Promise<RefundResponseDTO> {
  const { customerId, amount, method, notes, userId } = args;
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error("Refund amount must be positive");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!VALID_METHODS.has(method)) {
    const err = new Error(`Invalid refund method '${method}'. Must be one of: CASH, BANK_TRANSFER, CHEQUE`);
    (err as { status?: number }).status = 400;
    throw err;
  }

  return await pgClient.begin(async (sqlTx) => {
    const wRows = await sqlTx<Array<{ id: number; balance: string; is_active: boolean }>>`
      SELECT id, balance, is_active FROM wallets WHERE customer_id = ${customerId} FOR UPDATE
    `;
    if (wRows.length === 0) {
      const err = new Error(`Wallet not found for customer ${customerId}`);
      (err as { status?: number }).status = 404;
      throw err;
    }
    const wallet = wRows[0];
    if (!wallet.is_active) {
      const err = new Error(`Wallet ${wallet.id} is inactive`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    const balanceBefore = Number(wallet.balance);
    if (amount > balanceBefore) {
      const err = new Error(`Refund amount ฿${amount.toFixed(2)} exceeds wallet balance ฿${balanceBefore.toFixed(2)}`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    const balanceAfter = balanceBefore - amount;
    await sqlTx`UPDATE wallets SET balance = ${balanceAfter}, updated_at = NOW() WHERE id = ${wallet.id}`;

    const notePart = notes && notes.trim() ? ` — ${notes.trim()}` : "";
    const description = `Graduation refund (${METHOD_LABEL[method]})${notePart}`;

    const txRows = await sqlTx<Array<{ id: number; created_at: string }>>`
      INSERT INTO wallet_transactions
        (wallet_id, transaction_type, amount, balance_before, balance_after,
         reference_type, reference_id, description, reason, refund_method, created_by)
      VALUES (${wallet.id}, 'REFUND', ${amount}, ${balanceBefore}, ${balanceAfter},
              'graduation_refund', NULL, ${description}, 'graduation_refund',
              ${method}, ${userId})
      RETURNING id, created_at
    `;

    return {
      transaction_id: txRows[0].id,
      customer_id: customerId,
      wallet_id: wallet.id,
      amount,
      refund_method: method,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reason: "graduation_refund",
      notes,
      created_at: pgToIso(txRows[0].created_at)!,
      created_by_user_id: userId,
    };
  });
}
