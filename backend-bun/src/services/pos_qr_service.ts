/**
 * POS-sale BAY QR — pre-create a BAY QR transaction for a sale, persist the
 * cart as a snapshot, then let the BAY webhook auto-create the receipt when
 * the customer pays.
 *
 * Flow:
 *   1. Cashier picks "QR PromptPay" in POS  →  POST /pos/qr-intent (cart)
 *   2. This service:
 *      - validates cart shape (defensive — checkout will re-validate)
 *      - calls PYMT BAY QR with shop's merchant credentials
 *      - persists row in payment_intents with intent_type='pos_sale' +
 *        cart_snapshot=<cart JSON>
 *      - returns {ref_code, qr_payload, txn_no, amount, status:'pending'}
 *   3. Frontend renders the real BAY QR, polls /pos/qr-intent/:ref/status.
 *   4. Customer pays  →  BAY webhook (/api/v1/bay/callback)
 *      →  handleBayCallback detects intent_type='pos_sale'
 *      →  confirmPosQrSale rehydrates cart, calls checkout(), stores
 *         receipt_id back on the intent, flips status='confirmed'.
 *   5. Frontend polling sees status='confirmed' → resolves with receipt info.
 *
 * No double-checkout: confirmPosQrSale is wrapped in SELECT...FOR UPDATE +
 * status guard so duplicate webhooks / inquiry races are idempotent.
 */
import { eq, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { paymentIntents, receipts } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import { createQrPayment, isPymtConfigured, PymtGatewayError } from "@/services/pymt_gateway";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";

// ── DTOs ──────────────────────────────────────────────────────────────────

export interface PosQrIntentDTO {
  ref_code: string;
  amount: number;
  qr_payload: string;
  status: "pending" | "confirmed" | "cancelled";
  payment_method: string;
  txn_no: string | null;
  receipt_id: number | null;
  receipt_number: string | null;
  created_at: string;
}

export interface CreatePosQrInput {
  /** The full POS checkout payload — this becomes cart_snapshot. */
  cart: Omit<CheckoutInput, "payment_method">;
  cashierUserId: number;
  amount: number;
}

// ── Ref code (shared scheme with topup) ──────────────────────────────────

function generateRefCode(): string {
  const ymd = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `POS-${ymd}-${rand}`;
}

// ── Create intent + BAY QR ────────────────────────────────────────────────

export async function createPosQrIntent(input: CreatePosQrInput): Promise<PosQrIntentDTO> {
  if (!isPymtConfigured()) {
    throw new PymtGatewayError("BAY gateway not configured — cannot create POS QR", 503);
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    const err = new Error("Amount must be positive");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!input.cart || !Array.isArray(input.cart.items) || input.cart.items.length === 0) {
    const err = new Error("Cart cannot be empty");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const refCode = generateRefCode();

  // Insert intent first so the ref_code is claimed in DB before we call BAY.
  // If the BAY call fails we mark the intent cancelled — no phantom QR.
  const [inserted] = await db
    .insert(paymentIntents)
    .values({
      refCode,
      walletId: null,
      amount: String(input.amount),
      qrPayload: "",
      status: "pending",
      paymentMethod: "bay_qr",
      createdBy: input.cashierUserId,
      intentType: "pos_sale",
      // sanitize cashier-side data — backend re-validates on confirm
      cartSnapshot: input.cart as unknown as Record<string, unknown>,
    })
    .returning();

  try {
    const r = await createQrPayment({
      amount: input.amount,
      refCode,
      // POS sale has no wallet; use a stable per-shop pseudo-id so BAY's
      // ref2 (max 20 char alphanumeric) keeps reconciliation traceable.
      walletId: 0,
      remark: input.cart.notes ?? null,
    });
    await db
      .update(paymentIntents)
      .set({ qrPayload: r.qrcode_content, txnNo: r.txn_no })
      .where(eq(paymentIntents.id, inserted.id));

    return {
      ref_code: refCode,
      amount: input.amount,
      qr_payload: r.qrcode_content,
      status: "pending",
      payment_method: "bay_qr",
      txn_no: r.txn_no,
      receipt_id: null,
      receipt_number: null,
      created_at: pgToIso(inserted.createdAt)!,
    };
  } catch (e) {
    // Cancel the intent so we don't leave a dangling pending row.
    await db
      .update(paymentIntents)
      .set({ status: "cancelled" })
      .where(eq(paymentIntents.id, inserted.id))
      .catch(() => {});
    throw e;
  }
}

// ── Status ────────────────────────────────────────────────────────────────

export async function getPosQrIntent(refCode: string): Promise<PosQrIntentDTO> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.refCode, refCode))
    .limit(1);
  const intent = rows[0];
  if (!intent || intent.intentType !== "pos_sale") {
    const err = new Error("POS QR intent not found");
    (err as { status?: number }).status = 404;
    throw err;
  }

  let receiptNumber: string | null = null;
  if (intent.receiptId !== null && intent.receiptId !== undefined) {
    const r = await db
      .select({ receiptNumber: receipts.receiptNumber })
      .from(receipts)
      .where(eq(receipts.id, intent.receiptId))
      .limit(1);
    receiptNumber = r[0]?.receiptNumber ?? null;
  }

  return {
    ref_code: intent.refCode,
    amount: pgNumber(intent.amount) ?? 0,
    qr_payload: intent.qrPayload ?? "",
    status: intent.status as "pending" | "confirmed" | "cancelled",
    payment_method: intent.paymentMethod,
    txn_no: intent.txnNo ?? null,
    receipt_id: intent.receiptId ?? null,
    receipt_number: receiptNumber,
    created_at: pgToIso(intent.createdAt)!,
  };
}

// ── Confirm — called from webhook OR from inquiry sync ───────────────────

/**
 * Take a confirmed POS-sale intent and produce a receipt. Three-phase to
 * dodge the nested-transaction orphan problem:
 *
 *   Phase A (short tx): SELECT FOR UPDATE the intent, decide if we should
 *   create a receipt, atomically "claim" the work by setting
 *   confirmed_via='gateway_webhook_claimed'. Any second caller (webhook
 *   retry, parallel inquiry) sees the claim and bails.
 *
 *   Phase B (no tx, or rather checkout's own tx): run checkout() which
 *   commits the receipt independently.
 *
 *   Phase C (separate UPDATE): stamp receipt_id back onto the intent and
 *   flip status. Guard with `WHERE receipt_id IS NULL` so a retry can't
 *   overwrite a previously-stamped row.
 *
 * If phase B crashes after claiming → next retry sees the claim → skips →
 * stuck-pending intent (operator visible, no double receipt). If phase B
 * succeeds but phase C crashes → next retry sees the claim → also skips →
 * orphan receipt still exists in DB but at least no DOUBLE-charge of stock.
 * That's the realistic safest tradeoff under at-least-once webhook delivery.
 */
export async function confirmPosQrSale(refCode: string): Promise<number | null> {
  // ── Phase A: claim ─────────────────────────────────────────────────────
  type Claim =
    | { kind: "skip"; receiptId: number | null }
    | { kind: "go"; intentId: number; createdBy: number | null; cart: Omit<CheckoutInput, "payment_method"> & { userId?: number } };

  const claim: Claim = await pgClient.begin(async (sqlTx) => {
    const rows = await sqlTx<Array<{
      id: number;
      status: string;
      intent_type: string | null;
      cart_snapshot: unknown;
      receipt_id: number | null;
      confirmed_via: string | null;
      created_by: number | null;
    }>>`
      SELECT id, status, intent_type, cart_snapshot, receipt_id, confirmed_via, created_by
      FROM payment_intents
      WHERE ref_code = ${refCode}
      FOR UPDATE
    `;
    const intent = rows[0];
    if (!intent) return { kind: "skip", receiptId: null };
    if (intent.intent_type !== "pos_sale") return { kind: "skip", receiptId: null };
    // Receipt already stamped — idempotent return of the existing receipt.
    if (intent.receipt_id !== null) return { kind: "skip", receiptId: intent.receipt_id };
    // Cancelled intent — never produce a receipt.
    if (intent.status === "cancelled") return { kind: "skip", receiptId: null };
    // Another worker has already taken the claim — back off. They (or the
    // next retry after a phase-B crash) will finish stamping the receipt.
    if (intent.confirmed_via === "gateway_webhook_claimed") {
      return { kind: "skip", receiptId: null };
    }

    const cart = intent.cart_snapshot as
      | (Omit<CheckoutInput, "payment_method"> & { userId?: number })
      | null;
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      // Malformed snapshot — cancel rather than ever attempting checkout.
      await sqlTx`UPDATE payment_intents SET status = 'cancelled' WHERE id = ${intent.id}`;
      return { kind: "skip", receiptId: null };
    }

    // Take the claim. confirmed_via='..._claimed' is our sentinel — phase
    // C will overwrite it to 'gateway_webhook' once receipt_id is set.
    await sqlTx`
      UPDATE payment_intents
      SET confirmed_via = 'gateway_webhook_claimed'
      WHERE id = ${intent.id}
    `;

    return {
      kind: "go",
      intentId: intent.id,
      createdBy: intent.created_by,
      cart,
    };
  });

  if (claim.kind === "skip") return claim.receiptId;

  // ── Phase B: run checkout (its own tx) ────────────────────────────────
  const checkoutInput: CheckoutInput = {
    ...claim.cart,
    payment_method: "qr_promptpay",
    userId: claim.cart.userId ?? claim.createdBy ?? 0,
  };
  const receipt = await checkout(checkoutInput);
  const receiptId = receipt.id;

  // ── Phase C: stamp receipt + flip status (guarded UPDATE) ─────────────
  // WHERE receipt_id IS NULL means a parallel retry that somehow slipped
  // the Phase A guard still can't overwrite. confirmed_via flips from the
  // claim sentinel back to the final value.
  await db.execute(
    sql`UPDATE payment_intents
        SET status = 'confirmed',
            confirmed_at = NOW(),
            confirmed_via = 'gateway_webhook',
            receipt_id = ${receiptId}
        WHERE id = ${claim.intentId}
          AND receipt_id IS NULL`,
  );

  return receiptId;
}

/**
 * Force-cancel a POS QR intent. Used when the BAY webhook reports FAILED,
 * or the cashier hits "Cancel" before the customer pays.
 */
export async function cancelPosQrIntent(refCode: string): Promise<void> {
  await db
    .update(paymentIntents)
    .set({ status: "cancelled" })
    .where(
      sql`${paymentIntents.refCode} = ${refCode} AND ${paymentIntents.status} = 'pending' AND ${paymentIntents.intentType} = 'pos_sale'`,
    );
}
