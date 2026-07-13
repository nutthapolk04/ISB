import type {
  TxnEvent,
  ResultEvent,
  EDCStatusEvent,
  WhoamiResponse,
  SaleRequest,
  QrSaleRequest,
  WalletSaleRequest,
  VoidRequest,
  RefundRequest,
  WalletRefundRequest,
  QueryRequest,
  VerifyRequest,
  EdcClientOptions,
  AcceptedDevice,
  DeviceInfo,
} from "./types.js";
import { UnsupportedDeviceError, UnsupportedCapabilityError } from "./errors.js";

const DEFAULT_DOMAIN = "pos.local.bridge.schooney.tech";
const DEFAULT_PORT = 7331;

/** Raw transaction response body returned by POST /txn/{cmd}. */
interface RawTxnResponse {
  responseCode: string;
  approvalCode?: string | null;
  fields?: Record<string, string>;
}

export class EdcClient {
  private readonly baseUrl: string;
  private readonly wsBase: string;
  private readonly acceptedDevices: AcceptedDevice[] | undefined;

  private _whoami: WhoamiResponse | null = null;
  private _terminalConnected = false;
  private _statusWs: WebSocket | null = null;
  private _statusListeners: Array<(s: EDCStatusEvent) => void> = [];

  constructor(opts: EdcClientOptions = {}) {
    const domain = opts.domain ?? DEFAULT_DOMAIN;
    const port = opts.port ?? DEFAULT_PORT;
    // In dev/mock the bridge serves plain HTTP on 127.0.0.1:7331; in production it
    // serves HTTPS via the wildcard cert. We pick the scheme from the page's own
    // protocol, so a page served over http:// (e.g. `vite dev`) talks http/ws and
    // needs no certificate at all.
    const isSecure = typeof window !== "undefined"
      ? window.location.protocol === "https:"
      : true;
    const scheme = isSecure ? "https" : "http";
    const wsScheme = isSecure ? "wss" : "ws";
    this.baseUrl = `${scheme}://${domain}:${port}`;
    this.wsBase = `${wsScheme}://${domain}:${port}`;
    this.acceptedDevices = opts.acceptedDevices;
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  async ready(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/whoami`);
    if (!res.ok) throw new Error(`/whoami returned ${res.status}`);
    this._whoami = (await res.json()) as WhoamiResponse;
    this._terminalConnected = this._whoami.device.connected;

    if (this.acceptedDevices !== undefined && this.acceptedDevices.length > 0) {
      const { brand, protocol } = this._whoami.device;
      const ok = this.acceptedDevices.some(
        a => a.brand === brand && a.protocol === protocol
      );
      if (!ok) {
        throw new UnsupportedDeviceError(this._whoami.device, this.acceptedDevices);
      }
    }

    this._connectStatus();
  }

  get bridgeId(): string { return this._whoami?.bridgeId ?? ""; }
  get device(): DeviceInfo | null { return this._whoami?.device ?? null; }
  get terminalConnected(): boolean { return this._terminalConnected; }
  get capabilities(): string[] { return this._whoami?.device.capabilities ?? []; }

  // ── Status stream ──────────────────────────────────────────────────────────

  onTerminalStatus(listener: (s: EDCStatusEvent) => void): () => void {
    this._statusListeners.push(listener);
    return () => {
      this._statusListeners = this._statusListeners.filter(l => l !== listener);
    };
  }

  private _connectStatus(): void {
    if (this._statusWs) return;
    const ws = new WebSocket(`${this.wsBase}/status`);
    this._statusWs = ws;

    ws.addEventListener("message", (ev: MessageEvent) => {
      // The bridge sends { kind, edc:{ state, port, firmware, reason, since }, cert, sessions }.
      // Flatten the EDC status to the SDK's EDCStatusEvent shape for listeners.
      const raw = JSON.parse(ev.data as string) as {
        kind: string;
        edc?: { state?: string; port?: string; firmware?: string; reason?: string; since?: string };
      };
      if (raw.kind === "edc" && raw.edc) {
        const e = raw.edc;
        this._terminalConnected = e.state === "connected";
        const flat: EDCStatusEvent = {
          kind: "edc",
          state: (e.state ?? "disconnected") as EDCStatusEvent["state"],
          ...(e.port ? { port: e.port } : {}),
          ...(e.firmware ? { firmware: e.firmware } : {}),
          ...(e.reason ? { reason: e.reason } : {}),
          ...(e.since ? { since: e.since } : {}),
        };
        for (const l of this._statusListeners) l(flat);
      }
    });
    ws.addEventListener("close", () => {
      this._statusWs = null;
      setTimeout(() => this._connectStatus(), 3000);
    });
    ws.addEventListener("error", () => ws.close());
  }

  // ── Capability guard ───────────────────────────────────────────────────────

  private requireCapability(cap: string): void {
    if (!this.capabilities.includes(cap)) {
      throw new UnsupportedCapabilityError(cap, this.capabilities);
    }
  }

  // ── Transaction commands ─────────────────────────────────────────────────────
  // Device-neutral: the SDK sends canonical fields (amount, payment_type, pos_ref_no,
  // invoice…) and the bridge driver maps them to the device's wire format. The same
  // method names work whether Paywire is paired with a VTI (Verifone) or LinkPOS
  // (Newland) terminal.

  async *sale(req: SaleRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability("sale");
    yield* this._txnStream("sale", req.idempotencyKey, {
      amount: String(req.amount),
      fields: this._fields(req.posRef, {
        ...(req.paymentType ? { payment_type: req.paymentType } : {}),
        ...(req.acquirerId ? { E1: req.acquirerId } : {}),
      }, req.extra),
    });
  }

  async *qrSale(req: QrSaleRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability(`qrSale.${req.payment.toLowerCase()}`);
    yield* this._txnStream("qrsale", req.idempotencyKey, {
      amount: String(req.amount),
      fields: this._fields(req.posRef, {
        payment_type: req.payment,
        ...(req.acquirerId ? { E1: req.acquirerId } : {}),
      }, req.extra),
    });
  }

  async *walletSale(req: WalletSaleRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability(`walletSale.${req.payment.toLowerCase()}`);
    yield* this._txnStream("walletsale", req.idempotencyKey, {
      amount: String(req.amount),
      fields: this._fields(req.posRef, { payment_type: req.payment }, req.extra),
    });
  }

  async *void(req: VoidRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability("void");
    yield* this._txnStream("void", req.idempotencyKey, {
      fields: this._fields(req.posRef, this._reversalFields(req)),
    });
  }

  async *refund(req: RefundRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability("refund");
    yield* this._txnStream("refund", req.idempotencyKey, {
      amount: String(req.amount),
      fields: this._fields(req.posRef, this._reversalFields(req)),
    });
  }

  async *walletRefund(req: WalletRefundRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability("walletRefund");
    yield* this._txnStream("walletrefund", req.idempotencyKey, {
      amount: String(req.amount),
      fields: this._fields(req.posRef, this._reversalFields(req)),
    });
  }

  /// Identifiers a VOID/REFUND must carry from the original sale. LinkPOS needs
  /// invoice_no + transaction_id (terminal TID) + card_approval_code; VTI uses field 50.
  /// The bridge driver keeps only what its protocol understands.
  private _reversalFields(r: {
    invoice?: string; transactionId?: string; cardApprovalCode?: string;
  }): Record<string, string> {
    return {
      ...(r.invoice ? { "50": r.invoice, invoice_no: r.invoice } : {}),
      ...(r.transactionId ? { transaction_id: r.transactionId } : {}),
      ...(r.cardApprovalCode ? { card_approval_code: r.cardApprovalCode } : {}),
    };
  }

  async *settle(): AsyncGenerator<TxnEvent> {
    this.requireCapability("settle");
    yield* this._txnStream("settle", this._randomKey(), { fields: {} });
  }

  async *settleAll(): AsyncGenerator<TxnEvent> {
    this.requireCapability("settleAll");
    yield* this._txnStream("settleall", this._randomKey(), { fields: {} });
  }

  /** LinkPOS QUERY — recover a sale whose response was lost (timeout). */
  async *query(req: QueryRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability("query");
    yield* this._txnStream("query", req.idempotencyKey, {
      fields: { pos_ref_no: req.posRef },
    });
  }

  /** LinkPOS TRANSVER — ask the EDC to re-check a QR/wallet txn with the acquirer host. */
  async *verify(req: VerifyRequest): AsyncGenerator<TxnEvent> {
    this.requireCapability("verify");
    yield* this._txnStream("verify", req.idempotencyKey, {
      fields: {
        pos_ref_no: req.posRef,
        ...(req.payment ? { payment_type: req.payment } : {}),
      },
    });
  }

  async *commsTest(): AsyncGenerator<TxnEvent> {
    yield* this._txnStream("commstest", this._randomKey(), { fields: {} });
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  /// Merges the canonical pos_ref_no + caller fields + protocol-scoped `extra` buckets.
  private _fields(
    posRef: string | undefined,
    base: Record<string, string>,
    extra?: Record<string, Record<string, string>>
  ): Record<string, string> {
    return {
      ...(posRef ? { pos_ref_no: posRef } : {}),
      ...base,
      ...(extra?.["vti"] ?? {}),
      ...(extra?.["linkpos"] ?? {}),
    };
  }

  /// Opens the events WebSocket, fires the POST, streams any mid-transaction events,
  /// then yields a final `result` event built from the HTTP response body. The result
  /// is the POST body (not a WS message); the WS carries only mid-txn events.
  private async *_txnStream(
    cmd: string,
    idempotencyKey: string,
    body: { amount?: string; fields: Record<string, string> }
  ): AsyncGenerator<TxnEvent> {
    const reqId = idempotencyKey;
    const queue: TxnEvent[] = [];

    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${this.wsBase}/events?reqId=${encodeURIComponent(reqId)}`);
      ws.addEventListener("message", (ev: MessageEvent) => {
        try { queue.push(JSON.parse(ev.data as string) as TxnEvent); } catch { /* ignore */ }
      });
      // Wait (briefly) for the socket to open so we don't miss early events;
      // proceed regardless — events are best-effort, the result is the POST body.
      await new Promise<void>(resolve => {
        if (ws!.readyState === WebSocket.OPEN) return resolve();
        const go = () => resolve();
        ws!.addEventListener("open", go);
        ws!.addEventListener("error", go);
        setTimeout(go, 800);
      });
    } catch {
      ws = null;
    }

    let raw: RawTxnResponse;
    try {
      const res = await fetch(`${this.baseUrl}/txn/${cmd}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": reqId },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`/txn/${cmd} returned HTTP ${res.status}`);
      raw = (await res.json()) as RawTxnResponse;
    } catch (err) {
      ws?.close();
      throw err;
    }

    // Brief grace for any trailing mid-txn events still in flight on the WS.
    await new Promise<void>(r => setTimeout(r, 50));
    ws?.close();

    for (const ev of queue) yield ev;
    yield this._toResult(reqId, raw);
  }

  private _toResult(reqId: string, raw: RawTxnResponse): ResultEvent {
    const fields = raw.fields ?? {};
    // Only include optional keys when present (tsconfig: exactOptionalPropertyTypes).
    const approvalCode = raw.approvalCode ?? fields["approval_code"];
    const maskedPan = fields["30"];                              // VTI masked PAN
    const rrn = fields["D3"] ?? fields["ref_no"];
    const responseMessage = fields["response_msg"] ?? fields["02"];
    const payerId = fields["payer_id"];                          // LinkPOS, already masked
    return {
      kind: "result",
      reqId,
      responseCode: raw.responseCode as ResultEvent["responseCode"],
      ...(approvalCode ? { approvalCode } : {}),
      ...(maskedPan ? { maskedPan } : {}),
      ...(rrn ? { rrn } : {}),
      ...(responseMessage ? { responseMessage } : {}),
      ...(payerId ? { payerId } : {}),
      fields,
    };
  }

  // ── Convenience: run a sale and return only the final result ───────────────

  async saleResult(
    req: SaleRequest,
    onEvent?: (ev: TxnEvent) => void
  ): Promise<ResultEvent> {
    for await (const ev of this.sale(req)) {
      onEvent?.(ev);
      if (ev.kind === "result") return ev;
    }
    throw new Error("sale stream ended without a result event");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _randomKey(): string {
    return crypto.randomUUID();
  }
}
