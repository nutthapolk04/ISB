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
}): Promise<QRResult> {
  if (!isPymtConfigured()) throw new PymtGatewayError("PYMT not configured", 503);
  const payload = {
    amount: args.amount,
    ref1: sanitizeRef(args.refCode, 20),
    ref2: sanitizeRef(`W${args.walletId}`, 20),
    channel: args.channel ?? 2,
    expiredMinutes: args.expiredMinutes ?? 10,
  };
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

export async function createEasyPay(args: {
  amount: number;
  refCode: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  lang?: string;
}): Promise<EasyPayResult> {
  if (!isPymtConfigured()) throw new PymtGatewayError("PYMT not configured", 503);
  const payload = {
    amount: args.amount,
    orderRef: args.refCode,
    successUrl: args.successUrl,
    failUrl: args.failUrl,
    cancelUrl: args.cancelUrl,
    currCode: "764",
    payType: "N",
    lang: args.lang ?? "T",
  };
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
