/**
 * Wallet top-up flow — mirrors WalletService.create_topup_intent +
 * confirm_topup in app/services/wallet_service.py.
 *
 * Bun port limitation: real PYMT gateway HTTP integration is intentionally
 * not implemented. `payment_method=qr_promptpay` (mock QR) works fully;
 * `bay_qr` / `bay_easypay` return 501 — callers route those through FastAPI.
 */
import { and, desc, eq, isNotNull, isNull, like, lt, or } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { paymentIntents, wallets, walletTransactions, customers, users, parentChildLinks } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import { logger } from "@/logger";
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
const EASYPAY_FEE_RATE = 0.03;

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
    /** Present when status is `confirmed` — wallet_transactions.id for the TOPUP row. */
    transaction_id?: number | null;
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
    // QR top-up's floor was lowered to ฿1 — bay_easypay/credit_card keep the
    // ฿100 floor since that request wasn't about those methods.
    const minAmount = paymentMethod === "bay_qr" ? 1 : 100;
    if (input.amount < minAmount || input.amount > 50000) {
        const err = new Error(`Top-up amount must be between ฿${minAmount} and ฿50,000`);
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
            // Return URLs route through the backend (not the frontend) to avoid
            // a Vercel 405 on BAY's redirect back — the backend then 302s to the FE.
            const apiBase = process.env.BACKEND_BASE_URL ?? "";
            const chargeAmount = Math.round(input.amount * (1 + EASYPAY_FEE_RATE) * 100) / 100;
            const r = await createEasyPay({
                amount: chargeAmount, refCode,
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
            // Reuse the webhook path — same idempotent confirmTopup call.
            // Same rule as the webhook: never skip crediting just because
            // created_by is null — the gateway already confirmed payment.
            const confirmerId = intent.createdBy ?? await getOrCreatePaymentGatewayServiceUser();
            try {
                const confirmed = await confirmTopup({ refCode: intent.refCode, confirmerId, confirmedVia: "gateway_inquiry" });
                logger.info(
                    `[gateway inquiry] Wallet credited ref=${intent.refCode} walletId=${confirmed.wallet_id} amount=${confirmed.amount} confirmerId=${confirmerId}`,
                );
            } catch (e) {
                const err = e as { code?: string };
                if (err.code !== "ALREADY_PROCESSED") {
                    // best-effort: the caller (manual "check again") still
                    // gets the freshly-inquired gateway status back below;
                    // log loudly so ops can see the credit didn't land.
                    logger.error(`[gateway inquiry] confirmTopup failed for ref=${intent.refCode} confirmerId=${confirmerId}`, e);
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

// ── Reconciliation sweep ──────────────────────────────────────────────────
//
// Damage-control net for the created_by=null hotfix: finds top-up intents
// that are still `pending` locally well past the point BAY should have
// answered (webhook missed/delayed, or predates the hotfix), inquires the
// gateway directly, and — for anything the gateway says COMPLETED — credits
// the wallet via the same idempotent confirmTopup() path. Never touches
// intent_type='pos_sale' rows (those are POS QR sales, not wallet top-ups,
// and are reconciled by their own flow in pos_qr_service.ts).

const DEFAULT_RECONCILE_OLDER_THAN_MINUTES = 15;
const DEFAULT_RECONCILE_LIMIT = 50;
/** Sequential delay between gateway inquiries — don't hammer BAY. */
const RECONCILE_GATEWAY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ReconcileTopupItem {
    ref_code: string;
    wallet_id: number;
    /** Human-readable owner label (customer name/code, username, or department id) for damage-assessment reading. */
    wallet_owner: string | null;
    amount: number;
    created_at: string;
    payment_method: string;
    /** Raw gateway status string (COMPLETED / FAILED / PENDING / ...), or a local marker (e.g. INQUIRY_ERROR). */
    gateway_status: string;
    reason?: string;
}

export interface ReconcileTopupsSummary {
    dry_run: boolean;
    scanned: number;
    /** Confirmed COMPLETED at the gateway — credited (or, if dryRun, would-be-credited). */
    credited: ReconcileTopupItem[];
    /** Gateway says FAILED/EXPIRED/CANCELLED — marked cancelled (or would be, if dryRun). */
    failed: ReconcileTopupItem[];
    /** Still pending at the gateway, no gateway txn_no, inquiry error, or raced to already-processed — left untouched. */
    skipped: ReconcileTopupItem[];
}

async function describeWalletOwner(walletId: number | null): Promise<string | null> {
    if (walletId == null) return null;
    const wRows = await db
        .select({ customerId: wallets.customerId, userId: wallets.userId, departmentId: wallets.departmentId })
        .from(wallets)
        .where(eq(wallets.id, walletId))
        .limit(1);
    const w = wRows[0];
    if (!w) return null;
    if (w.customerId != null) {
        const c = (await db.select({ name: customers.name, code: customers.studentCode }).from(customers).where(eq(customers.id, w.customerId)).limit(1))[0];
        return c ? `${c.name} (${c.code ?? "-"})` : `customer#${w.customerId}`;
    }
    if (w.userId != null) {
        const u = (await db.select({ name: users.fullName, username: users.username }).from(users).where(eq(users.id, w.userId)).limit(1))[0];
        return u ? `${u.name} (@${u.username})` : `user#${w.userId}`;
    }
    if (w.departmentId != null) return `department#${w.departmentId}`;
    return null;
}

/**
 * Scan for top-up intents stuck `pending` past `olderThanMinutes`, inquire
 * BAY for each, and (unless dryRun) credit the wallet for anything the
 * gateway confirms COMPLETED — reusing the same idempotent confirmTopup()
 * path as the webhook and the manual "check again" inquiry, including the
 * created_by=null → system-user fallback. dryRun defaults to TRUE so the
 * first run is always a damage assessment, not a mutation.
 */
export async function reconcilePendingTopups(args: {
    olderThanMinutes?: number;
    limit?: number;
    dryRun?: boolean;
}): Promise<ReconcileTopupsSummary> {
    const olderThanMinutes = args.olderThanMinutes ?? DEFAULT_RECONCILE_OLDER_THAN_MINUTES;
    const limit = args.limit ?? DEFAULT_RECONCILE_LIMIT;
    const dryRun = args.dryRun ?? true;
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

    // Wallet top-ups only: intent_type is NULL (legacy rows, pre-migration)
    // or 'wallet_topup' (current default) — never 'pos_sale'. Must have a
    // gateway txn_no to inquire (mock qr_promptpay / cash / plain credit_card
    // rows with no BAY leg have nothing to reconcile against).
    const candidates = await db
        .select()
        .from(paymentIntents)
        .where(and(
            eq(paymentIntents.status, "pending"),
            or(isNull(paymentIntents.intentType), eq(paymentIntents.intentType, "wallet_topup")),
            isNotNull(paymentIntents.txnNo),
            lt(paymentIntents.createdAt, cutoff),
        ))
        .orderBy(paymentIntents.createdAt)
        .limit(limit);

    const summary: ReconcileTopupsSummary = {
        dry_run: dryRun,
        scanned: candidates.length,
        credited: [],
        failed: [],
        skipped: [],
    };

    for (const intent of candidates) {
        const base: ReconcileTopupItem = {
            ref_code: intent.refCode,
            wallet_id: intent.walletId ?? 0,
            wallet_owner: await describeWalletOwner(intent.walletId),
            amount: pgNumber(intent.amount) ?? 0,
            created_at: pgToIso(intent.createdAt) ?? intent.createdAt,
            payment_method: intent.paymentMethod,
            gateway_status: "UNKNOWN",
        };

        if (intent.walletId == null || !intent.txnNo) {
            // Defensive — the WHERE clause already requires txn_no; walletId
            // should never be null for a wallet_topup intent.
            summary.skipped.push({ ...base, reason: "missing wallet_id or txn_no" });
            continue;
        }

        let gw: InquiryResult;
        try {
            if (intent.paymentMethod === "bay_easypay") {
                gw = await easyPayInquiry({ transactionNo: intent.txnNo });
            } else if (intent.paymentMethod === "bay_qr") {
                gw = await qrInquiry({ transactionNo: intent.txnNo });
            } else {
                summary.skipped.push({ ...base, reason: `payment_method '${intent.paymentMethod}' has no gateway inquiry` });
                continue;
            }
        } catch (e) {
            logger.error(`[reconcile] gateway inquiry failed for ref=${intent.refCode}`, e);
            summary.skipped.push({
                ...base,
                gateway_status: "INQUIRY_ERROR",
                reason: e instanceof Error ? e.message : String(e),
            });
            await sleep(RECONCILE_GATEWAY_DELAY_MS);
            continue;
        }

        base.gateway_status = gw.raw_status;

        if (gw.status === "confirmed") {
            if (dryRun) {
                summary.credited.push({ ...base, reason: "would credit (dry run)" });
            } else {
                const confirmerId = intent.createdBy ?? await getOrCreatePaymentGatewayServiceUser();
                try {
                    const confirmed = await confirmTopup({ refCode: intent.refCode, confirmerId, confirmedVia: "reconcile_sweep" });
                    logger.info(
                        `[reconcile] Wallet credited ref=${intent.refCode} walletId=${confirmed.wallet_id} amount=${confirmed.amount} confirmerId=${confirmerId}`,
                    );
                    summary.credited.push(base);
                } catch (e) {
                    const err = e as { code?: string };
                    if (err.code === "ALREADY_PROCESSED") {
                        // Raced the webhook (or another sweep) between our SELECT
                        // and confirmTopup's row lock — already handled elsewhere.
                        summary.skipped.push({ ...base, reason: "already processed by another path" });
                    } else {
                        logger.error(`[reconcile] confirmTopup failed for ref=${intent.refCode}`, e);
                        summary.failed.push({ ...base, reason: e instanceof Error ? e.message : String(e) });
                    }
                }
            }
        } else if (gw.status === "cancelled") {
            // Reuses the same transition inquireTopupFromGateway already
            // performs for a gateway-cancelled result — no new status invented.
            if (!dryRun) {
                await db.update(paymentIntents).set({ status: "cancelled" }).where(eq(paymentIntents.id, intent.id));
            }
            summary.failed.push({ ...base, reason: dryRun ? "gateway reports failed/expired (would mark cancelled)" : "marked cancelled" });
        } else {
            summary.skipped.push({ ...base, reason: "still pending at gateway" });
        }

        await sleep(RECONCILE_GATEWAY_DELAY_MS);
    }

    return summary;
}

// ── Status + parent-confirm ──────────────────────────────────────────────

export async function cancelTopupIntent(refCode: string): Promise<void> {
  const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.refCode, refCode)).limit(1);
  const intent = rows[0];
  if (!intent) {
    const err = new Error("Top-up intent not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (intent.status === "cancelled") return;
  if (intent.status === "confirmed") {
    const err = new Error("Cannot cancel a confirmed payment");
    (err as { status?: number }).status = 400;
    throw err;
  }
  await db.update(paymentIntents).set({ status: "cancelled" }).where(eq(paymentIntents.id, intent.id));
}

export async function getTopupStatus(refCode: string): Promise<{ intent: TopupStatusDTO; walletId: number }> {
    const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.refCode, refCode)).limit(1);
    const intent = rows[0];
    if (!intent) {
        const err = new Error("Top-up intent not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    let transactionId: number | null = null;
    if (intent.status === "confirmed") {
        const txRows = await db
            .select({ id: walletTransactions.id })
            .from(walletTransactions)
            .where(
                and(
                    eq(walletTransactions.referenceType, "payment_intent"),
                    eq(walletTransactions.referenceId, intent.id),
                    eq(walletTransactions.transactionType, "TOPUP"),
                ),
            )
            .limit(1);
        transactionId = txRows[0]?.id ?? null;
    }

    return {
        intent: {
            ref_code: intent.refCode,
            status: intent.status,
            amount: pgNumber(intent.amount) ?? 0,
            payment_method: intent.paymentMethod,
            transaction_id: transactionId,
        },
        walletId: requireIntentWalletId(intent.walletId, refCode),
    };
}

let gatewayServiceUserIdCache: number | null = null;

/**
 * Self-healing system account attributed as wallet_transactions.created_by
 * when a gateway webhook needs to confirm a top-up whose intent has no
 * created_by (nullable column — legacy rows / defensive edge case). Money has
 * already left the customer's card by the time COMPLETED arrives, so crediting
 * the wallet must never be skipped just because there's no human actor to
 * attribute it to. Mirrors getOrCreateVendorApiServiceUser's lazy-create
 * pattern in wallet_service.ts. Inactive + random password — never usable for
 * interactive login.
 */
async function getOrCreatePaymentGatewayServiceUser(): Promise<number> {
    if (gatewayServiceUserIdCache !== null) return gatewayServiceUserIdCache;
    const existing = (await db.select({ id: users.id }).from(users).where(eq(users.username, "payment_gateway_service")).limit(1))[0];
    if (existing) {
        gatewayServiceUserIdCache = existing.id;
        return existing.id;
    }
    const hash = await Bun.password.hash(crypto.randomUUID(), { algorithm: "bcrypt", cost: 12 });
    const [created] = await db.insert(users).values({
        username: "payment_gateway_service",
        email: "payment-gateway-service@isb-coop.local",
        fullName: "Payment Gateway Service Account",
        hashedPassword: hash,
        isActive: false,
        isSuperuser: false,
        role: "staff",
        status: "active",
    }).returning({ id: users.id });
    gatewayServiceUserIdCache = created.id;
    return created.id;
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
    // Locate intent: orderRef (refCode → txnNo) → txnNo → reference1.
    // EASYPay callbacks carry the sanitized orderRef we sent to PYMT, which
    // matches paymentIntents.txnNo rather than refCode (refCode keeps the
    // hyphens). Fall back to txnNo when refCode lookup misses.
    const select = () => db
        .select({ refCode: paymentIntents.refCode, status: paymentIntents.status, intentType: paymentIntents.intentType })
        .from(paymentIntents);
    let refCode: string | null = null;
    let currentStatus: string | null = null;
    let intentType: string | null = null;

    const adopt = (row: { refCode: string; status: string; intentType: string | null } | undefined) => {
        if (!row) return false;
        refCode = row.refCode; currentStatus = row.status; intentType = row.intentType ?? null;
        return true;
    };

    if (body.orderRef) {
        const byRef = await select().where(eq(paymentIntents.refCode, body.orderRef)).limit(1);
        if (!adopt(byRef[0])) {
            const byTxn = await select().where(eq(paymentIntents.txnNo, body.orderRef)).limit(1);
            adopt(byTxn[0]);
        }
    } else if (body.transactionNo) {
        const byTxn = await select().where(eq(paymentIntents.txnNo, body.transactionNo)).limit(1);
        if (!adopt(byTxn[0]) && body.reference1) {
            const byRef = await select().where(eq(paymentIntents.refCode, body.reference1)).limit(1);
            adopt(byRef[0]);
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
            } catch (e) {
                logger.error(
                    `[BAY callback] confirmPosQrSale failed for ref=${refCode} txnNo=${body.transactionNo ?? "-"} amount=${body.amount}`,
                    e,
                );
                // Do NOT swallow: confirmPosQrSale is already idempotent (FOR
                // UPDATE + status guard), so a thrown error here is a genuine
                // failure, not a duplicate-delivery no-op. Rethrow so the
                // controller returns 5xx and the gateway retries the webhook.
                throw e;
            }
            return { received: true };
        }

        // wallet_transactions.created_by is NOT NULL with FK → users(id).
        // Prefer the intent's creator; if it's null (legacy row / defensive
        // edge case) fall back to a self-healing system service account
        // instead of skipping the credit — the gateway has already taken the
        // customer's money by the time COMPLETED arrives, so this must never
        // be silently skipped.
        const creatorRows = await db.select({ createdBy: paymentIntents.createdBy }).from(paymentIntents).where(eq(paymentIntents.refCode, refCode)).limit(1);
        const confirmerId = creatorRows[0]?.createdBy ?? await getOrCreatePaymentGatewayServiceUser();

        try {
            const confirmed = await confirmTopup({ refCode, confirmerId, confirmedVia: "gateway_webhook" });
            logger.info(
                `[BAY callback] Wallet credited ref=${refCode} walletId=${confirmed.wallet_id} amount=${confirmed.amount} confirmerId=${confirmerId}`,
            );
        } catch (e) {
            const err = e as { status?: number; code?: string; message?: string };
            if (err.code === "ALREADY_PROCESSED") {
                // Duplicate webhook delivery raced another delivery (or a
                // manual gateway-inquiry sync) that already confirmed this
                // intent under the same row lock in confirmTopup — idempotent
                // no-op, not a failure. Do not retry.
                logger.info(`[BAY callback] Duplicate COMPLETED callback for ref=${refCode} — already processed, skipping.`);
            } else {
                logger.error(
                    `[BAY callback] confirmTopup failed for ref=${refCode} txnNo=${body.transactionNo ?? "-"} amount=${body.amount} confirmerId=${confirmerId}`,
                    e,
                );
                // Do NOT swallow: the card was charged but the wallet credit
                // failed. Rethrow so the controller returns 5xx and the
                // gateway retries the webhook instead of treating this as
                // delivered.
                throw e;
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
            // Idempotency guard: row is locked FOR UPDATE above, so under
            // concurrent/duplicate webhook or gateway-inquiry callers, only
            // the first transaction observes status='pending' and credits
            // the wallet — every later one lands here and no-ops instead of
            // double-crediting.
            const err = new Error(`Intent already ${intent.status}`);
            (err as { status?: number; code?: string }).status = 400;
            (err as { status?: number; code?: string }).code = "ALREADY_PROCESSED";
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
