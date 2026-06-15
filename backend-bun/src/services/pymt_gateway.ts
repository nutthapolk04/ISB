/**
 * PYMT gateway HTTP client — mirrors FastAPI app/services/pymt_gateway.py.
 * Calls BAY (Bank of Ayudhya) for QR PromptPay + EASYPay credit card flows.
 *
 * Env config:
 *   PYMT_BASE_URL          gateway base, e.g. https://pymt.example.com
 *   PYMT_MERCHANT_TOKEN    Basic-auth token (already base64'd)
 */

const BASE_URL = process.env.PYMT_BASE_URL ?? "";
const MERCHANT_TOKEN = process.env.PYMT_MERCHANT_TOKEN ?? "";

export class PymtGatewayError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface QRResult {
  txn_no: string;
  qrcode_content: string;
}

export interface EasyPayResult {
  order_ref: string;
  txn_no: string;
  payment_page_url: string;
  payment_form_params: Record<string, string>;
}

export function isPymtConfigured(): boolean {
  return Boolean(BASE_URL && MERCHANT_TOKEN);
}

function sanitizeRef(value: string, maxLen = 20): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, maxLen);
}

function buildHeaders(configApp: string): Record<string, string> {
  return {
    "Authorization": `Basic ${MERCHANT_TOKEN}`,
    "x-config-app": configApp,
    "Content-Type": "application/json",
  };
}

async function postWithTimeout(url: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 30000);
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(tid);
  }
}

export async function createQrPayment(args: {
  amount: number;
  refCode: string;
  walletId: number;
  channel?: number;
  expiredMinutes?: number;
  remark?: string | null;
}): Promise<QRResult> {
  if (!isPymtConfigured()) throw new PymtGatewayError("PYMT not configured", 503);
  const payload: Record<string, unknown> = {
    amount: args.amount,
    ref1: sanitizeRef(args.refCode, 20),
    ref2: sanitizeRef(`W${args.walletId}`, 20),
    channel: args.channel ?? 2,
    expiredMinutes: args.expiredMinutes ?? 10,
  };
  if (args.remark && args.remark.trim()) payload.remark = args.remark.trim();
  const resp = await postWithTimeout(
    `${BASE_URL}/api/v1/bay/qr`,
    payload,
    buildHeaders("bay.qrPayment"),
  );
  if (resp.status !== 200) {
    const text = await resp.text();
    throw new PymtGatewayError(`PYMT QR error ${resp.status}: ${text}`, resp.status);
  }
  const data = (await resp.json()) as { status?: string; message?: string; data?: { txnNo: string; qrcodeContent: string } };
  if (data.status === "error") throw new PymtGatewayError(data.message ?? "PYMT QR failed");
  const d = data.data!;
  return { txn_no: d.txnNo, qrcode_content: d.qrcodeContent };
}

// ── Inquiry shapes ──────────────────────────────────────────────────────
export interface InquiryResult {
  /** Normalized: "pending" | "confirmed" | "cancelled" — derived from BAY status. */
  status: "pending" | "confirmed" | "cancelled";
  /** Raw BAY transaction status text (COMPLETED / FAILED / PENDING / etc). */
  raw_status: string;
  /** BAY transaction number for reconciliation. */
  txn_no: string | null;
  /** Card number (masked) on EASYPay; null for QR. */
  card_no: string | null;
  /** Payment method label (e.g. "Visa", "PromptPay"). */
  payment_method: string | null;
  /** ISO timestamp when payment landed (null if still pending). */
  paid_at: string | null;
  /** BAY trxStatus when present (extra signal for QR pre-confirm phase). */
  bay_trx_status: string | null;
}

function normalizeStatus(raw: string | undefined | null): "pending" | "confirmed" | "cancelled" {
  if (!raw) return "pending";
  const s = String(raw).toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS" || s === "SUCCEED") return "confirmed";
  if (s === "FAILED" || s === "CANCELLED" || s === "CANCELED" || s === "EXPIRED") return "cancelled";
  return "pending";
}

/**
 * Poll BAY for the latest QR transaction status. Useful when the gateway
 * webhook is delayed or missed — the cashier UI can fall back to this
 * before assuming the payment failed.
 */
export async function qrInquiry(args: { transactionNo: string }): Promise<InquiryResult> {
  if (!isPymtConfigured()) throw new PymtGatewayError("PYMT not configured", 503);
  const resp = await postWithTimeout(
    `${BASE_URL}/api/v1/bay/qr/inquiry`,
    { transactionNo: args.transactionNo },
    buildHeaders("bay.qrPayment"),
  );
  if (resp.status !== 200) {
    const text = await resp.text();
    throw new PymtGatewayError(`PYMT QR inquiry error ${resp.status}: ${text}`, resp.status);
  }
  const data = (await resp.json()) as {
    status?: string;
    message?: string;
    data?: {
      transaction?: {
        status?: string;
        paymentMethod?: string;
        cardNo?: string | null;
        paymentAt?: string | null;
        transactionNo?: string;
      };
      txnInfo?: { trxStatus?: string };
    };
  };
  if (data.status === "error") throw new PymtGatewayError(data.message ?? "PYMT QR inquiry failed");
  const txn = data.data?.transaction ?? {};
  return {
    status: normalizeStatus(txn.status),
    raw_status: txn.status ?? "UNKNOWN",
    txn_no: txn.transactionNo ?? args.transactionNo,
    card_no: txn.cardNo ?? null,
    payment_method: txn.paymentMethod ?? null,
    paid_at: txn.paymentAt ?? null,
    bay_trx_status: data.data?.txnInfo?.trxStatus ?? null,
  };
}

/** Same as qrInquiry but for EASYPay (post-landing card-payment status). */
export async function easyPayInquiry(args: { transactionNo: string }): Promise<InquiryResult> {
  if (!isPymtConfigured()) throw new PymtGatewayError("PYMT not configured", 503);
  const resp = await postWithTimeout(
    `${BASE_URL}/api/v1/bay/easypay/inquiry`,
    { transactionNo: args.transactionNo },
    buildHeaders("bay.easypay"),
  );
  if (resp.status !== 200) {
    const text = await resp.text();
    throw new PymtGatewayError(`PYMT EASYPay inquiry error ${resp.status}: ${text}`, resp.status);
  }
  const data = (await resp.json()) as {
    status?: string;
    message?: string;
    data?: {
      transaction?: {
        status?: string;
        paymentMethod?: string;
        cardNo?: string | null;
        paymentAt?: string | null;
        transactionNo?: string;
      };
    };
  };
  if (data.status === "error") throw new PymtGatewayError(data.message ?? "PYMT EASYPay inquiry failed");
  const txn = data.data?.transaction ?? {};
  return {
    status: normalizeStatus(txn.status),
    raw_status: txn.status ?? "UNKNOWN",
    txn_no: txn.transactionNo ?? args.transactionNo,
    card_no: txn.cardNo ?? null,
    payment_method: txn.paymentMethod ?? null,
    paid_at: txn.paymentAt ?? null,
    bay_trx_status: null,
  };
}

export async function createEasyPay(args: {
  amount: number;
  refCode: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  lang?: string;
  /** N = sale (default), H = hold/authorize-only. */
  payType?: "N" | "H";
  remark?: string | null;
}): Promise<EasyPayResult> {
  if (!isPymtConfigured()) throw new PymtGatewayError("PYMT not configured", 503);
  const payload: Record<string, unknown> = {
    amount: args.amount,
    orderRef: args.refCode,
    successUrl: args.successUrl,
    failUrl: args.failUrl,
    cancelUrl: args.cancelUrl,
    currCode: "764",
    payType: args.payType ?? "N",
    lang: args.lang ?? "T",
  };
  if (args.remark && args.remark.trim()) payload.remark = args.remark.trim();
  const resp = await postWithTimeout(
    `${BASE_URL}/api/v1/bay/easypay`,
    payload,
    buildHeaders("bay.easypay"),
  );
  if (resp.status !== 200) {
    const text = await resp.text();
    throw new PymtGatewayError(`PYMT EASYPay error ${resp.status}: ${text}`, resp.status);
  }
  const data = (await resp.json()) as { status?: string; message?: string; data?: { orderRef: string; paymentPageUrl: string; paymentFormParams: Record<string, string> } };
  if (data.status === "error") throw new PymtGatewayError(data.message ?? "PYMT EASYPay failed");
  const d = data.data!;
  return {
    order_ref: d.orderRef,
    txn_no: d.orderRef,
    payment_page_url: d.paymentPageUrl,
    payment_form_params: d.paymentFormParams,
  };
}
