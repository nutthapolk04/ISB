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
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import {
  createQrPayment,
  createEasyPay,
  isPymtConfigured,
  PymtGatewayError,
  qrInquiry,
  easyPayInquiry,
  type InquiryResult,
} from "@/services/pymt_gateway";

const MAX_WALLET_BALANCE = 50_000;

const TOPUP_LABEL_BY_METHOD: Record<string, string> = {
  qr_promptpay: "Top-up via PromptPay",
  bay_qr: "Top-up via PromptPay (BAY)",
  credit_card: "Top-up via Credit/Debit Card",
  bay_easypay: "Top-up via Credit/Debit Card (BAY)",
  cash: "Top-up via Cash",
};

const PYMT_METHODS = new Set(["bay_qr", "bay_easypay"]);

function requireIntentWalletId(walletId: number | null, refCode: string): number {
  if (walletId == null) {
    const err = new Error(`Top-up intent ${refCode} has no wallet_id`);
    (err as { status?: number }).status = 500;
    throw err;
  }
  return walletId;
}

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
    // POS terminal (cashier/manager) can facilitate top-up for any customer
    // wallet — no shop scope. Audit trail lives on the resulting payment
    // intent via created_by.
    if (caller.roles.includes("cashier") || caller.roles.includes("manager")) {
      return true;
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
  /** Optional remark forwarded to BAY (visible in BAY merchant dashboard). */
  remark?: string | null;
  /** EASYPay only — "N" (sale, default) or "H" (hold/authorize). */
  payType?: "N" | "H" | null;
  /** EASYPay only — "T" Thai (default) or "E" English. */
  lang?: "T" | "E" | null;
}

export async function createTopupIntent(input: CreateTopupInput): Promise<TopupIntentDTO> {
  const paymentMethod = input.paymentMethod ?? "qr_promptpay";

  const wRows = await db.select().from(wallets).where(eq(wallets.id, input.walletId)).limit(1);
  const wallet = wRows[0];
  if (!wallet) {
    const err = new Error(`Wallet ${input.walletId} not found`);
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (input.amount < 100 || input.amount > 50000) {
    const err = new Error("Top-up amount must be between ฿100 and ฿50,000");
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
  const initialQrPayload = buildMockQrPayload(refCode, input.amount);

  const [created] = await db.insert(paymentIntents).values({
    refCode,
    walletId: input.walletId,
    amount: String(input.amount),
    qrPayload: initialQrPayload,
    status: "pending",
    paymentMethod,
    createdBy: input.userId,
    notes: input.notes ?? null,
  }).returning();

  // PYMT gateway call (after row exists so ref_code is claimed in DB —
  // matches FastAPI behaviour: failure cancels the intent, no phantom rows).
  let txnNo: string | null = created.txnNo ?? null;
  let qrPayload: string = initialQrPayload;
  let paymentPageUrl: string | null = null;
  let paymentFormParams: Record<string, string> | null = null;
  const pymtConfigured = isPymtConfigured();

  try {
    if (paymentMethod === "bay_qr" && pymtConfigured) {
      const r = await createQrPayment({
        amount: input.amount,
        refCode,
        walletId: input.walletId,
        remark: input.remark ?? null,
      });
      qrPayload = r.qrcode_content;
      txnNo = r.txn_no;
      await db.update(paymentIntents).set({ qrPayload, txnNo }).where(eq(paymentIntents.id, created.id));
    } else if (paymentMethod === "bay_easypay" && pymtConfigured) {
      const apiBase = process.env.BACKEND_BASE_URL ?? "";
      const r = await createEasyPay({
        amount: input.amount, refCode,
        successUrl: `${apiBase}/api/v1/payment/bay/return/success?ref=${refCode}`,
        failUrl: `${apiBase}/api/v1/payment/bay/return/fail?ref=${refCode}`,
        cancelUrl: `${apiBase}/api/v1/payment/bay/return/cancel?ref=${refCode}`,
        lang: input.lang ?? undefined,
        payType: input.payType ?? undefined,
        remark: input.remark ?? null,
      });
      txnNo = r.txn_no;
      paymentPageUrl = r.payment_page_url;
      paymentFormParams = r.payment_form_params;
      await db.update(paymentIntents).set({ txnNo }).where(eq(paymentIntents.id, created.id));
    } else if (PYMT_METHODS.has(paymentMethod) && !pymtConfigured) {
      await db.update(paymentIntents).set({ status: "cancelled" }).where(eq(paymentIntents.id, created.id));
      throw new PymtGatewayError("PYMT not configured", 503);
    }
  } catch (e) {
    if (e instanceof PymtGatewayError) {
      await db.update(paymentIntents).set({ status: "cancelled" }).where(eq(paymentIntents.id, created.id));
      const err = new Error(`Payment gateway error: ${e.message}`);
      (err as { status?: number }).status = e.status >= 400 && e.status < 600 ? e.status : 502;
      throw err;
    }
    throw e;
  }

  return {
    ref_code: created.refCode,
    wallet_id: created.walletId ?? input.walletId,
    amount: pgNumber(created.amount) ?? 0,
    qr_payload: qrPayload,
    status: created.status,
    payment_method: created.paymentMethod,
    confirmed_via: created.confirmedVia ?? null,
    created_at: pgToIso(created.createdAt)!,
    txn_no: txnNo,
    payment_page_url: paymentPageUrl,
    payment_form_params: paymentFormParams,
  };
}

// ── Inquiry (force-sync from BAY) ────────────────────────────────────────

export interface TopupInquiryDTO {
  ref_code: string;
  wallet_id: number;
  /** Local intent status after sync. */
  status: string;
  /** Raw inquiry result from BAY. */
  gateway: InquiryResult;
}

/**
 * Force a status check against BAY via PYMT inquiry, then sync local
 * payment_intents row + (if confirmed) trigger wallet credit. Used by the
 * EASYPay landing page and as a manual "Check again" button when the
 * webhook is slow.
 */
export async function inquireTopupFromGateway(refCode: string): Promise<TopupInquiryDTO> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.refCode, refCode))
    .limit(1);
  const intent = rows[0];
  if (!intent) {
    const err = new Error("Top-up intent not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!intent.txnNo) {
    // No gateway txnNo yet — nothing to inquire. Return current local state.
    return {
      ref_code: intent.refCode,
      wallet_id: requireIntentWalletId(intent.walletId, refCode),
      status: intent.status,
      gateway: {
        status: "pending",
        raw_status: "NO_TXN",
        txn_no: null,
        card_no: null,
        payment_method: null,
        paid_at: null,
        bay_trx_status: null,
      },
    };
  }

  let result: InquiryResult;
  if (intent.paymentMethod === "bay_easypay") {
    result = await easyPayInquiry({ transactionNo: intent.txnNo });
  } else if (intent.paymentMethod === "bay_qr") {
    result = await qrInquiry({ transactionNo: intent.txnNo });
  } else {
    // Non-BAY method (e.g. mock qr_promptpay) — gateway has nothing to say.
    return {
      ref_code: intent.refCode,
      wallet_id: requireIntentWalletId(intent.walletId, refCode),
      status: intent.status,
      gateway: {
        status: "pending",
        raw_status: "NOT_APPLICABLE",
        txn_no: intent.txnNo,
        card_no: null,
        payment_method: null,
        paid_at: null,
        bay_trx_status: null,
      },
    };
  }

  // Sync local status if gateway says something different
  if (intent.status === "pending") {
    if (result.status === "confirmed") {
      // Reuse the webhook path — same idempotent confirmTopup call
      const confirmerId = intent.createdBy ?? null;
      if (confirmerId !== null) {
        try {
          await confirmTopup({ refCode: intent.refCode, confirmerId, confirmedVia: "gateway_inquiry" });
        } catch {
          // best-effort; client can retry
        }
      }
    } else if (result.status === "cancelled") {
      await db.update(paymentIntents).set({ status: "cancelled" }).where(eq(paymentIntents.id, intent.id));
    }
  }

  // Re-read local status post-sync
  const after = await db.select({ status: paymentIntents.status }).from(paymentIntents).where(eq(paymentIntents.id, intent.id)).limit(1);

  return {
    ref_code: intent.refCode,
    wallet_id: requireIntentWalletId(intent.walletId, refCode),
    status: after[0]?.status ?? intent.status,
    gateway: result,
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
    walletId: requireIntentWalletId(intent.walletId, refCode),
  };
}

/**
 * Webhook entrypoint — mirrors app/api/v1/bay.py bay_callback.
 * Idempotent: returns received=true even if intent missing or already confirmed.
 */
export async function handleBayCallback(body: {
  transactionNo?: string | null;
  reference1?: string | null;
  reference2?: string | null;
  orderRef?: string | null;
  amount: number;
  status: "COMPLETED" | "FAILED";
}): Promise<{ received: true }> {
  // Locate intent: orderRef → txnNo → reference1
  let refCode: string | null = null;
  let currentStatus: string | null = null;
  let intentType: string | null = null;

  if (body.orderRef) {
    const rows = await db
      .select({ refCode: paymentIntents.refCode, status: paymentIntents.status, intentType: paymentIntents.intentType })
      .from(paymentIntents)
      .where(eq(paymentIntents.refCode, body.orderRef))
      .limit(1);
    if (rows[0]) { refCode = rows[0].refCode; currentStatus = rows[0].status; intentType = rows[0].intentType ?? null; }
  } else if (body.transactionNo) {
    const rows = await db
      .select({ refCode: paymentIntents.refCode, status: paymentIntents.status, intentType: paymentIntents.intentType })
      .from(paymentIntents)
      .where(eq(paymentIntents.txnNo, body.transactionNo))
      .limit(1);
    if (rows[0]) { refCode = rows[0].refCode; currentStatus = rows[0].status; intentType = rows[0].intentType ?? null; }
    else if (body.reference1) {
      const rRows = await db
        .select({ refCode: paymentIntents.refCode, status: paymentIntents.status, intentType: paymentIntents.intentType })
        .from(paymentIntents)
        .where(eq(paymentIntents.refCode, body.reference1))
        .limit(1);
      if (rRows[0]) { refCode = rRows[0].refCode; currentStatus = rRows[0].status; intentType = rRows[0].intentType ?? null; }
    }
  }

  if (!refCode) {
    // Intent missing — log silently (FastAPI matches this behaviour)
    return { received: true };
  }
  if (currentStatus === "confirmed") return { received: true };

  if (body.status === "COMPLETED") {
    // Route by intent_type. Wallet topups credit the wallet; POS-sale
    // intents auto-create a receipt from the stored cart snapshot.
    if (intentType === "pos_sale") {
      try {
        // Lazy-import to avoid a circular dependency between pos_qr_service
        // and topup_service (POS QR calls into pymt_gateway via topup land).
        const { confirmPosQrSale } = await import("@/services/pos_qr_service");
        await confirmPosQrSale(refCode);
      } catch {
        // best-effort; webhook will retry
      }
      return { received: true };
    }

    // wallet_transactions.created_by is NOT NULL with FK → users(id). Use
    // the intent's creator as the confirmer when webhook fires.
    const creatorRows = await db.select({ createdBy: paymentIntents.createdBy }).from(paymentIntents).where(eq(paymentIntents.refCode, refCode)).limit(1);
    const confirmerId = creatorRows[0]?.createdBy ?? null;
    if (confirmerId !== null) {
      try {
        await confirmTopup({ refCode, confirmerId, confirmedVia: "gateway_webhook" });
      } catch {
        // swallow — webhook retries; FastAPI rolls back same way
      }
    }
  } else if (body.status === "FAILED") {
    await db.update(paymentIntents).set({ status: "cancelled" }).where(eq(paymentIntents.refCode, refCode));
  }
  return { received: true };
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
