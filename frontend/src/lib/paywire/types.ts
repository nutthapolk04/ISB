// Typed commands and events. Covers both protocol families:
//  - VTI (Verifone)  — paywire/src/Paywire.Protocols.Vti
//  - LinkPOS (Newland) — paywire/src/Paywire.Protocols.Linkpos

// VTI response codes.
export type VtiResponseCode =
  | "00" | "01" | "ND" | "ED" | "EN" | "TO" | "NA" | "DI"
  | "CL" | "XC" | "SR" | "ST" | "EC" | "Y1" | "Y3" | "Z1"
  | "Z3" | "UC" | "CN";

// LinkPOS response codes (Appendix B): "00" approved, the numeric 01–96 issuer/host
// family, and the 2-letter LinkPOS specials.
export type LinkPosResponseCode =
  | "00" | "ER" | "PT" | "NE" | "UC" | "EA" | "DR" | "CE" | "LE" | "N0" | "N3"
  | (string & {});  // numeric 01–96 etc. — keep open without losing autocomplete

// Any response code from either device family.
export type ResponseCode = VtiResponseCode | LinkPosResponseCode;

// Canonical, device-neutral payment selectors. The SDK sends these names; the
// bridge driver maps them to the device's wire value (VTI field 66 / LinkPOS payment_type).
export type PaymentSelector =
  | "promptpay" | "thaiqr" | "qrvisa" | "qrmc"
  | "alipay" | "wechat" | "truemoney" | "linepay" | "airpay" | "dolfin"
  // deprecated VTI single-letter aliases — still accepted:
  | "P" | "A" | "W" | "L"
  | (string & {});

export type EventKind =
  | "chip-inserted"
  | "card-swiped"
  | "pin-required"
  | "sign-required"
  | "qr-shown"
  | "processing"
  | "result";

export interface BaseEvent {
  kind: EventKind;
  reqId: string;
}

export interface ChipInsertedEvent extends BaseEvent { kind: "chip-inserted"; }
export interface CardSwipedEvent   extends BaseEvent { kind: "card-swiped"; }
export interface PinRequiredEvent  extends BaseEvent { kind: "pin-required"; }
export interface SignRequiredEvent extends BaseEvent { kind: "sign-required"; }
export interface ProcessingEvent   extends BaseEvent { kind: "processing"; }

export interface QrShownEvent extends BaseEvent {
  kind: "qr-shown";
  payload: string;
}

export interface ResultEvent extends BaseEvent {
  kind: "result";
  responseCode: ResponseCode;
  approvalCode?: string;
  maskedPan?: string;
  rrn?: string;
  /** LinkPOS human-readable message (`response_msg`), safe to display. */
  responseMessage?: string;
  /** LinkPOS card/payer reference — already masked by the EDC. */
  payerId?: string;
  fields: Record<string, string>;
}

export type TxnEvent =
  | ChipInsertedEvent
  | CardSwipedEvent
  | PinRequiredEvent
  | SignRequiredEvent
  | QrShownEvent
  | ProcessingEvent
  | ResultEvent;

// ── Requests ─────────────────────────────────────────────────────────────────

export interface SaleRequest {
  amount: number;
  idempotencyKey: string;
  /** VTI: field 66 selector ("I"=IPP, "R"=Redeem). LinkPOS: defaults to CARD. */
  paymentType?: string;
  acquirerId?: string;
  /** LinkPOS POS reference (unique per txn). Defaults to idempotencyKey if omitted. */
  posRef?: string;
  extra?: Record<string, Record<string, string>>;
}

export interface QrSaleRequest {
  amount: number;
  idempotencyKey: string;
  payment: PaymentSelector;
  acquirerId?: string;
  /** LinkPOS POS reference (unique per txn). Defaults to idempotencyKey if omitted. */
  posRef?: string;
  extra?: Record<string, Record<string, string>>;
}

export interface WalletSaleRequest {
  amount: number;
  idempotencyKey: string;
  payment: PaymentSelector;
  posRef?: string;
  extra?: Record<string, Record<string, string>>;
}

export interface VoidRequest {
  /** VTI invoice number (field 50) / LinkPOS `invoice_no` of the original sale. */
  invoice?: string;
  /** LinkPOS POS reference of the txn to void. */
  posRef?: string;
  /** LinkPOS: the terminal's TID — required by the real device for VOID (static per terminal). */
  transactionId?: string;
  /** LinkPOS: the original sale's approval code — required by the real device for VOID. */
  cardApprovalCode?: string;
  idempotencyKey: string;
}

export interface RefundRequest {
  amount: number;
  invoice?: string;
  posRef?: string;
  /** LinkPOS transaction id / terminal TID (required for wallet + card refunds). */
  transactionId?: string;
  /** LinkPOS: original sale's approval code (card refund). */
  cardApprovalCode?: string;
  idempotencyKey: string;
}

export interface WalletRefundRequest {
  amount: number;
  invoice?: string;
  posRef?: string;
  transactionId?: string;
  cardApprovalCode?: string;
  idempotencyKey: string;
}

/** LinkPOS QUERY — timeout recovery: look up a prior txn by its POS reference. */
export interface QueryRequest {
  posRef: string;
  idempotencyKey: string;
}

/** LinkPOS TRANSVER — ask the EDC to re-check a QR/wallet txn with the acquirer host. */
export interface VerifyRequest {
  posRef: string;
  payment?: PaymentSelector;
  idempotencyKey: string;
}

// ── Device / capability info (from /whoami) ──────────────────────────────────

export interface DeviceInfo {
  brand: string;
  model: string;
  protocol: string;
  firmware: string;
  connected: boolean;
  capabilities: string[];
}

export interface WhoamiResponse {
  bridgeId: string;
  device: DeviceInfo;
  version: string;
}

// ── Status stream events (from /status WebSocket) ────────────────────────────

export interface EDCStatusEvent {
  kind: "edc";
  state: "disconnected" | "connecting" | "connected" | "unresponsive" | "error";
  port?: string;
  firmware?: string;
  since?: string;
  reason?: string;
}

export interface CertStatusEvent {
  kind: "cert";
  expiresAt: string;
  daysLeft: number;
}

export type StatusEvent = EDCStatusEvent | CertStatusEvent;

// ── EdcClient options ─────────────────────────────────────────────────────────

export interface AcceptedDevice {
  brand: string;
  protocol: string;
}

export interface EdcClientOptions {
  domain?: string;
  port?: number;
  acceptedDevices?: AcceptedDevice[];
}
