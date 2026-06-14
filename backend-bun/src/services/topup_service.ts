/**
 * Wallet top-up flow — mirrors WalletService.create_topup_intent +
 * confirm_topup in app/services/wallet_service.py.
 *
 * Bun port limitation: real PYMT gateway HTTP integration is intentionally
 * not implemented. `payment_method=qr_promptpay` (mock QR) works fully;
 * `bay_qr` / `bay_easypay` return 501 — callers route those through FastAPI.
 */
import { and, desc, eq, like } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { paymentIntents, wallets, walletTransactions, customers, users, parentChildLinks } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/auth";

const MAX_WALLET_BALANCE = 50_000;

const TOPUP_LABEL_BY_METHOD: Record<string, string> = {
  qr_promptpay: "Top-up via PromptPay",
  bay_qr: "Top-up via PromptPay (BAY)",
  credit_card: "Top-up via Credit/Debit Card",
  bay_easypay: "Top-up via Credit/Debit Card (BAY)",
  cash: "Top-up via Cash",
};

const PYMT_METHODS = new Set(["bay_qr", "bay_easypay"]);

export interface TopupIntentDTO {
  ref_code: string;
  wallet_id: number;
  amount: number;
  qr_payload: string;
  status: string;
  payment_method: string;
  confirmed_via: string | null;
  created_at: string;
  txn_no: string | null;
  payment_page_url: string | null;
  payment_form_params: Record<string, unknown> | null;
}

export interface TopupStatusDTO {
  ref_code: string;
  status: string;
  amount: number;
  payment_method: string;
}

export interface TopupConfirmDTO {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: number | null;
  description: string | null;
  created_at: string;
}

// ── Access control ────────────────────────────────────────────────────────

export async function userCanAccessWallet(
  caller: AccessTokenPayload,
  walletId: number,
): Promise<boolean> {
  if (caller.is_superuser || caller.roles.includes("admin") || caller.roles.includes("kiosk")) return true;
  const wRows = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  const w = wRows[0];
  if (!w) return false;
  if (w.departmentId !== null) return false; // dept = admin-only
  const callerId = Number(caller.sub);
  if (w.userId !== null && w.userId === callerId) return true;

  // Co-parents: same family_code on user wallets
  if (w.userId !== null) {
    const meRows = await db.select({ familyCode: users.familyCode }).from(users).where(eq(users.id, callerId)).limit(1);
    const ownerRows = await db.select({ familyCode: users.familyCode }).from(users).where(eq(users.id, w.userId)).limit(1);
    if (meRows[0]?.familyCode && ownerRows[0]?.familyCode && meRows[0].familyCode === ownerRows[0].familyCode) {
      return true;
    }
  }

  if (w.customerId !== null) {
    // Student → own wallet only (match customer.student_code = caller.username)
    if (caller.roles.includes("student")) {
      const cRows = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.studentCode, caller.username))
        .limit(1);
      return cRows[0] ? cRows[0].id === w.customerId : false;
    }
    // Parent / staff → must have parent_child_links row
    const lRows = await db
      .select({ id: parentChildLinks.id })
      .from(parentChildLinks)
      .where(and(
        eq(parentChildLinks.parentUserId, callerId),
        eq(parentChildLinks.childCustomerId, w.customerId),
      ))
      .limit(1);
    return !!lRows[0];
  }
  return false;
}

// ── Ref code generator ────────────────────────────────────────────────────

async function generateRefCode(): Promise<string> {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `TOP-${todayStr}-`;
  const lastRows = await db
    .select({ refCode: paymentIntents.refCode })
    .from(paymentIntents)
    .where(like(paymentIntents.refCode, `${prefix}%`))
    .orderBy(desc(paymentIntents.id))
    .limit(1);
  let seq = 1;
  if (lastRows[0]) {
    const parts = lastRows[0].refCode.split("-");
    const n = Number(parts[2]);
    if (Number.isFinite(n)) seq = n + 1;
  }
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(2)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${String(seq).padStart(3, "0")}-${suffix}`;
}

function buildMockQrPayload(refCode: string, amount: number): string {
  return `promptpay://isb-schooney/${refCode}/${amount.toFixed(2)}`;
}

// ── Create intent ─────────────────────────────────────────────────────────

export interface CreateTopupInput {
  walletId: number;
  amount: number;
  userId: number;
  notes?: string | null;
  paymentMethod?: string;
}

export async function createTopupIntent(input: CreateTopupInput): Promise<TopupIntentDTO> {
  const paymentMethod = input.paymentMethod ?? "qr_promptpay";

  if (PYMT_METHODS.has(paymentMethod)) {
    const err = new Error(
      `Payment method '${paymentMethod}' requires the PYMT gateway HTTP client which is not yet ported to Bun — route this request through FastAPI`,
    );
    (err as { status?: number }).status = 501;
    throw err;
  }

  const wRows = await db.select().from(wallets).where(eq(wallets.id, input.walletId)).limit(1);
  const wallet = wRows[0];
  if (!wallet) {
    const err = new Error(`Wallet ${input.walletId} not found`);
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (input.amount <= 0) {
    const err = new Error("Top-up amount must be positive");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const balance = pgNumber(wallet.balance) ?? 0;
  if (balance + input.amount > MAX_WALLET_BALANCE) {
    const available = Math.max(0, MAX_WALLET_BALANCE - balance);
    const err = new Error(
      `Wallet balance cannot exceed ฿${MAX_WALLET_BALANCE.toLocaleString()}. ` +
      `Current balance: ฿${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. ` +
      `You can top up at most ฿${available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
    (err as { status?: number }).status = 400;
    throw err;
  }

  const refCode = await generateRefCode();
  const qrPayload = buildMockQrPayload(refCode, input.amount);

  const [created] = await db.insert(paymentIntents).values({
    refCode,
    walletId: input.walletId,
    amount: String(input.amount),
    qrPayload,
    status: "pending",
    paymentMethod,
    createdBy: input.userId,
    notes: input.notes ?? null,
  }).returning();

  return {
    ref_code: created.refCode,
    wallet_id: created.walletId,
    amount: pgNumber(created.amount) ?? 0,
    qr_payload: created.qrPayload ?? "",
    status: created.status,
    payment_method: created.paymentMethod,
    confirmed_via: created.confirmedVia ?? null,
    created_at: pgToIso(created.createdAt)!,
    txn_no: created.txnNo ?? null,
    payment_page_url: null,
    payment_form_params: null,
  };
}

// ── Status + parent-confirm ──────────────────────────────────────────────

export async function getTopupStatus(refCode: string): Promise<{ intent: TopupStatusDTO; walletId: number }> {
  const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.refCode, refCode)).limit(1);
  const intent = rows[0];
  if (!intent) {
    const err = new Error("Top-up intent not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return {
    intent: {
      ref_code: intent.refCode,
      status: intent.status,
      amount: pgNumber(intent.amount) ?? 0,
      payment_method: intent.paymentMethod,
    },
    walletId: intent.walletId,
  };
}

export async function confirmTopup(args: {
  refCode: string;
  confirmerId: number;
  confirmedVia?: string;
  notes?: string | null;
}): Promise<TopupConfirmDTO> {
  let result: TopupConfirmDTO | null = null;
  await pgClient.begin(async (sqlTx) => {
    const iRows = await sqlTx<Array<{ id: number; ref_code: string; wallet_id: number; amount: string; status: string; payment_method: string; notes: string | null }>>`
      SELECT id, ref_code, wallet_id, amount, status, payment_method, notes
      FROM payment_intents WHERE ref_code = ${args.refCode} FOR UPDATE
    `;
    const intent = iRows[0];
    if (!intent) {
      const err = new Error(`Payment intent ${args.refCode} not found`);
      (err as { status?: number }).status = 404;
      throw err;
    }
    if (intent.status !== "pending") {
      const err = new Error(`Intent already ${intent.status}`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
      SELECT id, balance FROM wallets WHERE id = ${intent.wallet_id} FOR UPDATE
    `;
    const wallet = wRows[0];
    if (!wallet) {
      const err = new Error("Wallet not found");
      (err as { status?: number }).status = 404;
      throw err;
    }
    const balanceBefore = pgNumber(wallet.balance) ?? 0;
    const amount = pgNumber(intent.amount) ?? 0;
    const balanceAfter = balanceBefore + amount;
    await sqlTx`UPDATE wallets SET balance = ${balanceAfter}, updated_at = NOW() WHERE id = ${wallet.id}`;

    const label = TOPUP_LABEL_BY_METHOD[intent.payment_method] ?? "Top-up";
    const description = `${label} (${args.refCode})`;
    const txRows = await sqlTx<Array<{ id: number; created_at: string }>>`
      INSERT INTO wallet_transactions
        (wallet_id, transaction_type, amount, balance_before, balance_after,
         reference_type, reference_id, description, created_by)
      VALUES (${wallet.id}, 'TOPUP', ${amount}, ${balanceBefore}, ${balanceAfter},
              'payment_intent', ${intent.id}, ${description}, ${args.confirmerId})
      RETURNING id, created_at
    `;

    const noteCombined = args.notes
      ? `${(intent.notes ?? "")}\n${args.notes}`.trim()
      : intent.notes;
    await sqlTx`
      UPDATE payment_intents
      SET status = 'confirmed',
          confirmed_at = NOW(),
          confirmed_by = ${args.confirmerId},
          confirmed_via = ${args.confirmedVia ?? null},
          notes = ${noteCombined}
      WHERE id = ${intent.id}
    `;
    result = {
      id: txRows[0].id,
      wallet_id: wallet.id,
      transaction_type: "TOPUP",
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reference_type: "payment_intent",
      reference_id: intent.id,
      description,
      created_at: pgToIso(txRows[0].created_at)!,
    };
  });
  return result!;
}
