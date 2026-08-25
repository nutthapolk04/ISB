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
import { markPendingTxn, clearPendingTxn } from "./edcPendingTxn";

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

  // ── Heartbeat support (see edcHeartbeat.ts) ─────────────────────────────
  // `_txnInFlight` and `_pingAbortController` exist purely so an optional,
  // opt-in liveness probe can never collide with a real transaction. Both
  // are no-ops unless something calls pingTerminal()/setHeartbeatHealthy().
  private _txnInFlight = 0;
  private _pingAbortController: AbortController | null = null;
  private _pingInFlight: Promise<boolean> | null = null;
  private _heartbeatOverride = false;

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

  private _refreshInFlight: Promise<void> | null = null;

  /**
   * Re-fetches /whoami and updates `capabilities`/`device` from it, then
   * notifies status listeners. Needed because the /status WS push only ever
   * carries `{ state, port, firmware, reason, since }` — never
   * capabilities — so a page that first loaded (or last called ready())
   * while the terminal happened to be down freezes `capabilities: []`
   * forever, even after the pill goes back to green from a WS "connected"
   * push. requireCapability() would then reject a real sale on a terminal
   * that is, in fact, back up. Safe to call anytime; failures are swallowed
   * (the WS-driven `terminalConnected` still reflects the live state either
   * way) and overlapping calls share the one in-flight request.
   */
  async refresh(): Promise<void> {
    if (this._refreshInFlight) return this._refreshInFlight;
    this._refreshInFlight = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/whoami`);
        if (!res.ok) return;
        this._whoami = (await res.json()) as WhoamiResponse;
        this._terminalConnected = this._whoami.device.connected;
        this._emitStatus();
      } catch {
        // best-effort — see doc comment above.
      } finally {
        this._refreshInFlight = null;
      }
    })();
    return this._refreshInFlight;
  }

  get bridgeId(): string { return this._whoami?.bridgeId ?? ""; }
  get device(): DeviceInfo | null { return this._whoami?.device ?? null; }
  // `_heartbeatOverride` stays false forever unless something calls
  // setHeartbeatHealthy(false) — with no heartbeat wired up (today's
  // default everywhere), this is byte-for-byte the same `_terminalConnected`
  // read as before.
  get terminalConnected(): boolean { return this._terminalConnected && !this._heartbeatOverride; }
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
        const wasConnected = this._terminalConnected;
        this._terminalConnected = e.state === "connected";
        // Reconnect transition — refresh capabilities (see refresh() doc
        // comment); fire-and-forget so this handler stays synchronous.
        if (this._terminalConnected && !wasConnected) void this.refresh();
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

  // ── Heartbeat support ────────────────────────────────────────────────────
  // Everything below this line only ever runs if something outside this
  // class calls it — no existing code path (sale, qrSale, the /status WS
  // handler, etc.) calls into any of it, so it is inert by construction, not
  // just by config.

  private _emitStatus(reason?: string): void {
    const flat: EDCStatusEvent = {
      kind: "edc",
      state: this.terminalConnected ? "connected" : "disconnected",
      ...(reason ? { reason } : {}),
    };
    for (const l of this._statusListeners) l(flat);
  }

  /**
   * Called only by the optional heartbeat (edcHeartbeat.ts) — never by the
   * /status WS handler. Forces `terminalConnected` false once a direct
   * hardware probe fails `failThreshold` times in a row, even though the
   * bridge still reports the port as open (that's the whole "shows
   * connected but hangs on payment" bug this exists to catch); clears the
   * instant a probe succeeds again, independent of whatever the bridge's own
   * WS is currently saying.
   */
  setHeartbeatHealthy(healthy: boolean): void {
    if (this._heartbeatOverride === !healthy) return;
    this._heartbeatOverride = !healthy;
    this._emitStatus(healthy ? undefined : "heartbeat-timeout");
  }

  /**
   * Direct, isolated hardware-liveness probe — deliberately bypasses
   * _txnStream entirely (no /events WS, no shared code with a real sale) so
   * a bug here can never touch the payment path. Never throws; resolves
   * `false` on any timeout/HTTP/network failure.
   *
   * Skips outright (resolves `true` — "assume fine, don't disturb it")
   * whenever a real transaction is already in flight: this must never be
   * the thing standing between a cashier and a live sale. If a real
   * transaction starts while a probe is still in flight, _txnStream aborts
   * the probe immediately (see the abort call at its top) rather than risk
   * two concurrent commands reaching the physical terminal at once.
   */
  async pingTerminal(timeoutMs = 6000): Promise<boolean> {
    if (this._txnInFlight > 0) return true;
    // Single-flight: the app-wide heartbeat (every VITE_EDC_HEARTBEAT_MS) and
    // useEdcPendingClear's own 3s poll both call this independently, and
    // nothing stopped them landing at the same moment — 2026-08-25: this is
    // what actually flooded the single serial link with overlapping
    // /txn/commstest writes (seen as several TX lines a few *milliseconds*
    // apart with no RX at all), which is what desynced the terminal's
    // request/response pairing in the first place. Callers that arrive while
    // one is already running just await that same result instead of
    // starting a second one.
    if (this._pingInFlight) return this._pingInFlight;
    this._pingInFlight = (async () => {
      const controller = new AbortController();
      this._pingAbortController = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/txn/commstest`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": this._randomKey() },
          body: JSON.stringify({ fields: {} }),
          signal: controller.signal,
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
        if (this._pingAbortController === controller) this._pingAbortController = null;
        this._pingInFlight = null;
      }
    })();
    return this._pingInFlight;
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

  /// Opens the events WebSocket, fires the POST, and yields mid-transaction events
  /// LIVE while the POST is still pending — a QR sale can wait many seconds for the
  /// customer to scan, and `qr-shown` must surface immediately, not after the result.
  /// The final `result` event is still built from the HTTP response body and always
  /// yielded last (the WS carries only mid-txn events); fetch errors close the WS and
  /// rethrow. A WS error/close can never hang the loop — the fetch settling ends it.
  private async *_txnStream(
    cmd: string,
    idempotencyKey: string,
    body: { amount?: string; fields: Record<string, string> }
  ): AsyncGenerator<TxnEvent> {
    const reqId = idempotencyKey;

    // Survives exactly what wipes everything else here: a refresh/tab-close
    // while the terminal may still be mid-transaction on the wire. Marked
    // only for commands that actually charge a card — cleared in the finally
    // below, but ONLY once we've seen a trustworthy outcome (see
    // paymentOutcomeKnown below); a marker still present on the NEXT page
    // load — or still present a moment from now in THIS session, since
    // _emitStatus() right after this line makes useEdcPendingClear.ts
    // re-check and block immediately, refresh or not — means the caller
    // must wait for the terminal to prove it's idle again before starting a
    // new one.
    const isPayment = cmd === "sale" || cmd === "qrsale" || cmd === "walletsale";
    if (isPayment) {
      markPendingTxn(cmd, reqId);
      this._emitStatus();
    }
    // Only a well-formed result (a real responseCode) proves the terminal
    // actually let go of this attempt. A blank one — empty responseCode, the
    // exact shape seen 2026-08-25 when overlapping SALE writes left the
    // terminal returning cross-wired/empty responses — means something WAS
    // written to the terminal and its true outcome is still unknown, so the
    // marker must survive this attempt's finally rather than clear as if
    // nothing happened.
    let paymentOutcomeKnown = true;

    // A real transaction always wins over the optional heartbeat: cancel any
    // liveness probe still in flight (no-op if none is) before this command
    // reaches the terminal, and mark ourselves busy so the heartbeat won't
    // start a new one until we're done (see pingTerminal()/finally below).
    this._pingAbortController?.abort();
    this._txnInFlight++;

    // Push-queue + notifier: the WS handler pushes and wakes the loop below.
    const queue: TxnEvent[] = [];
    let wake: (() => void) | null = null;
    const notify = () => { const w = wake; wake = null; w?.(); };

    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${this.wsBase}/events?reqId=${encodeURIComponent(reqId)}`);
      ws.addEventListener("message", (ev: MessageEvent) => {
        try {
          queue.push(JSON.parse(ev.data as string) as TxnEvent);
          notify();
        } catch { /* ignore */ }
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

    // try/finally so an abandoned generator (consumer breaks/returns out of its
    // for-await mid-stream — generator.return() runs finally blocks) still closes
    // the /events WebSocket instead of leaking it until page reload.
    //
    // fetchAbort exists so that abandonment also aborts the POST itself, not
    // just the WS — without it, closing the modal (or our own pendingClear
    // retry after a refresh) left the ORIGINAL fetch running invisibly in the
    // background with nothing awaiting it, so a cashier who gave up and
    // tried again fired a second overlapping /txn/sale at the terminal while
    // the first was possibly still being written to it (2026-08-25: seen as
    // multiple SALE TX lines to the same terminal within seconds of each
    // other, terminal never responding to any of them cleanly).
    const fetchAbort = new AbortController();
    try {
      // Start the POST without awaiting so events stream while it is pending.
      const fetchPromise: Promise<RawTxnResponse> = (async () => {
        const res = await fetch(`${this.baseUrl}/txn/${cmd}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": reqId },
          body: JSON.stringify(body),
          signal: fetchAbort.signal,
        });
        if (!res.ok) throw new Error(`/txn/${cmd} returned HTTP ${res.status}`);
        return (await res.json()) as RawTxnResponse;
      })();
      // Track settlement separately so the loop ends on error too — the rejection
      // itself is consumed (and rethrown) by the `await fetchPromise` below.
      let settled = false;
      const fetchSettled = fetchPromise.then(() => { settled = true; }, () => { settled = true; });

      // Drain the queue, then sleep until either a new event or the fetch settling.
      while (!settled) {
        while (queue.length > 0) yield queue.shift()!;
        if (settled) break;
        await Promise.race([
          fetchSettled,
          new Promise<void>(resolve => { wake = resolve; }),
        ]);
      }

      const raw = await fetchPromise;
      if (isPayment && !String(raw.responseCode ?? "").trim()) paymentOutcomeKnown = false;

      // Brief grace for any trailing mid-txn events still in flight on the WS.
      await new Promise<void>(r => setTimeout(r, 50));

      // Final drain, then the result — nothing is ever yielded after the result.
      while (queue.length > 0) yield queue.shift()!;
      yield this._toResult(reqId, raw);
    } finally {
      // No-op if the fetch already settled on its own — abort() past that
      // point is harmless. If it hasn't (generator abandoned mid-flight),
      // this is what actually stops a second attempt from ever overlapping
      // with this one's still-open POST.
      fetchAbort.abort();
      ws?.close();
      this._txnInFlight--;
      if (isPayment) {
        if (paymentOutcomeKnown) clearPendingTxn();
        this._emitStatus();
      }
    }
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
