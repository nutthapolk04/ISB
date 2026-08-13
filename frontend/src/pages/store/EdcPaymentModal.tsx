import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ChevronLeft, CreditCard, Loader2, Nfc, QrCode, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { getEdcClient, readyEdc } from "@/lib/paywire/edcClient";
import { logEdcEvent } from "@/lib/paywire/edcTelemetry";
import { useEdcTerminalStatus } from "@/hooks/useEdcTerminalStatus";
import {
    classifyEdcResponse,
    isNonStandardApproval,
    posRefFromIdempotencyKey,
} from "@/lib/paywire/edcResponseCodes";

interface EdcRefs {
    approval_code: string;
    terminal_ref?: string;
    masked_card?: string;
    /** Drives the 3% card-swipe surcharge server-side — never applied for "qr". */
    mode: EdcMode;
    /** ref_code of the pending Transactions-tab row logged when this attempt
     *  started (see POST /pos/edc-intent) — lets checkout() update that row
     *  instead of creating a second one. Null if logging it failed. */
    edc_pending_ref?: string | null;
}

/** Which way the customer pays on the terminal — drives qrSale vs sale. */
export type EdcMode = "qr" | "card";

/** Customer-facing card surcharge — must match EDC_CARD_FEE_RATE in
 * backend-bun/src/services/pos_checkout_service.ts; the backend recomputes
 * and is the source of truth, this is only for the on-screen preview.
 * NOTE: ปรับจาก 3% → 0% (ไม่มีค่าธรรมเนียม) */
const EDC_CARD_FEE_RATE = 0;

interface EdcPaymentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    total: number;
    onBack: () => void;
    onConfirm: (refs: EdcRefs) => Promise<void>;
    confirming: boolean;
    /**
     * Builds the checkout-shaped cart (same shape /pos/checkout expects) used
     * to log a pending Transactions-tab row the instant an attempt starts —
     * see POST /pos/edc-intent. Optional so existing call sites keep working
     * unchanged; without it, an EDC attempt only shows up in the Transactions
     * tab once/if checkout() itself is reached, same as before.
     */
    buildCartPayload?: () => Record<string, unknown>;
    /**
     * Where this modal is mounted, for the server-side EDC event log. The
     * bridge runs on the cashier's own machine, so without this the backend has
     * no idea which POS produced a terminal charge. Optional so the three
     * existing call sites can adopt it independently; falls back to "unknown".
     */
    telemetry?: {
        context: string;
        shopId?: string | null;
        /**
         * Cart as it stands right now, evaluated once per attempt and attached
         * to the `started` telemetry event. A function so the modal never
         * closes over a stale cart, and so nothing is computed on renders where
         * no sale is in flight.
         */
        getCartSnapshot?: () => unknown;
    };
}

interface DeclineInfo {
    code: string;
    message: string;
}

// Response-code meanings live in lib/paywire/edcResponseCodes.ts so they can be
// unit-tested away from this component — see GUIDELINE.md §5 for the source
// tables. The cancel set that used to live here moved there unchanged.

export function EdcPaymentModal({
    open,
    onOpenChange,
    total,
    onBack,
    onConfirm,
    confirming,
    buildCartPayload,
    telemetry,
}: EdcPaymentModalProps) {
    const { t } = useTranslation();
    const [step, setStep] = useState<"choice" | "processing" | "approved" | "declined">(
        "choice",
    );
    const [edcMode, setEdcMode] = useState<EdcMode | null>(null);
    // True when the terminal approved the sale but the modal couldn't record it
    // (bridge unreachable, or no approval code came back) — distinguishes this
    // from a genuine bank decline so "declined" doesn't offer a naive "Try
    // again" that could double-charge the customer.
    const [approvedNoRecord, setApprovedNoRecord] = useState(false);
    // True whenever the outcome is genuinely unknown, not just unfavourable —
    // covers two distinct causes: (1) we lost the connection to the bridge
    // mid-attempt, so the terminal itself never answered, or (2) a QR sale
    // came back `TO` (timeout), which our side has no way to distinguish from
    // a bridge/terminal timeout that fired before the terminal's own on-screen
    // QR window actually ended. Either way, the terminal may still be running
    // the sale. Same "don't guess, go recover" treatment as approvedNoRecord:
    // no naive "Try again" (would fire a second live attempt against a
    // terminal that might still complete the first), recovery via
    // QUERY/manual code instead.
    const [connectionLost, setConnectionLost] = useState(false);
    const [declineInfo, setDeclineInfo] = useState<DeclineInfo | null>(null);
    const [qrShown, setQrShown] = useState(false);
    // Shared with the payment method picker (see useEdcTerminalStatus) so the
    // EDC tile can show a live connection dot before this modal ever opens.
    const terminalStatus = useEdcTerminalStatus();

    // Guards against setState after the modal is closed/unmounted mid-transaction —
    // any in-flight attempt bumps this ref to invalidate itself before touching state.
    const attemptRef = useRef(0);
    const idempotencyKeyRef = useRef("");
    // Guards onConfirm against a double-fire if the result stream somehow
    // emits more than one approved result for the same attempt.
    const pendingRef = useRef(false);

    useEffect(() => {
        if (!open) {
            attemptRef.current += 1;
            setStep("choice");
            setEdcMode(null);
            setApprovedNoRecord(false);
            setConnectionLost(false);
            setDeclineInfo(null);
            setQrShown(false);
        }
    }, [open]);

    useEffect(() => {
        return () => {
            attemptRef.current += 1;
        };
    }, []);

    // EDC only offers card for now (QR is commented out below) — jump straight
    // into the sale the instant the modal opens instead of making the cashier
    // pick from a sub-menu with a single option. The "choice" screen still
    // exists as the retry launchpad a cancel/decline bounces back to; it just
    // isn't shown on first entry anymore.
    useEffect(() => {
        if (open) {
            handleSelectMode("card");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const resetAttemptState = () => {
        setDeclineInfo(null);
        setApprovedNoRecord(false);
        setConnectionLost(false);
        setQrShown(false);
    };

    /**
     * Best-effort — a failure here must never surface to the cashier. Marks
     * the pending Transactions-tab row 'cancelled' once an attempt's outcome
     * is definitely known to be "no sale" (bank decline, cancelled at
     * terminal, or QUERY-confirmed not charged). Deliberately NOT called for
     * an unknown outcome (bridge error, QR timeout, approved-no-code) — same
     * reasoning as QR's abandon endpoint: leave it pending so a manual
     * recovery that finishes the sale can still flip it to 'success'.
     */
    const abandonPendingRef = async (refCode: string | null | undefined) => {
        if (!refCode) return;
        try {
            await api.post(`/pos/edc-intent/${refCode}/abandon`, {});
        } catch {
            // Transactions tab may show "pending" a bit longer — acceptable.
        }
    };

    const runAttempt = async (mode: EdcMode) => {
        const attemptId = ++attemptRef.current;
        const isCurrent = () => attemptRef.current === attemptId;

        idempotencyKeyRef.current = crypto.randomUUID();
        const posRef = posRefFromIdempotencyKey(idempotencyKeyRef.current);
        setEdcMode(mode);
        resetAttemptState();
        setStep("processing");
        console.log(`[EDC] attempt #${attemptId} start`, { mode, idempotencyKey: idempotencyKeyRef.current, total });

        // Card swipe/tap carries a 3% surcharge the customer pays on top of
        // the goods total — QR never does. Backend recomputes and stores
        // this independently; this is what's actually charged at the terminal.
        const cardFee = mode === "card" ? Math.round(total * EDC_CARD_FEE_RATE * 100) / 100 : 0;
        const chargeAmount = total + cardFee;

        // Log a `pending` Transactions-tab row for this attempt BEFORE
        // touching the bridge at all — deliberately ahead of readyEdc()
        // below, not after. This is what "Failed to fetch" (bridge
        // unreachable, 2026-08-10) looks like: readyEdc() throws before a
        // single terminal byte moves, straight into the catch block. Placing
        // this after readyEdc() would mean that exact failure — the one this
        // feature exists for — never gets logged at all. Fired in parallel
        // with the terminal call below (never awaited here) so it can't add
        // latency to the card read; resolved just before onConfirm/abandon
        // need it.
        const pendingTxnPromise: Promise<string | null> = buildCartPayload
            ? api
                .post<{ ref_code: string | null }>("/pos/edc-intent", {
                    ref_code: posRef,
                    amount: chargeAmount,
                    cart: buildCartPayload(),
                })
                .then((r) => r.ref_code)
                .catch(() => null)
            : Promise.resolve(null);

        try {
            await readyEdc();
            if (!isCurrent()) return;
            console.log(`[EDC] attempt #${attemptId} bridge ready`);

            const edc = getEdcClient();
            const satang = Math.round(chargeAmount * 100);

            // Bookend for the worst case: a terminal that charges the card and
            // then never yields a result event at all. Without this row the
            // attempt is invisible server-side — no result, no error, nothing.
            logEdcEvent({
                event: "started",
                context: telemetry?.context ?? "unknown",
                shop_id: telemetry?.shopId ?? null,
                idempotency_key: idempotencyKeyRef.current,
                pos_ref: posRef,
                edc_mode: mode,
                amount: chargeAmount,
                checkout_attempted: false,
                cart_snapshot: telemetry?.getCartSnapshot?.(),
            });

            const stream =
                mode === "qr"
                    ? edc.qrSale({
                        amount: satang,
                        idempotencyKey: idempotencyKeyRef.current,
                        payment: "thaiqr",
                    })
                    : edc.sale({
                        amount: satang,
                        idempotencyKey: idempotencyKeyRef.current,
                    });

            for await (const ev of stream) {
                if (!isCurrent()) return;
                console.log(`[EDC] attempt #${attemptId} event:`, ev.kind, ev);

                if (ev.kind === "qr-shown") {
                    // LinkPOS does not emit this — keep it as a nice-to-have, never depended on.
                    setQrShown(true);
                    continue;
                }

                if (ev.kind === "result") {
                    const nextApprovalCode = ev.approvalCode ?? "";
                    const nextTerminalRef = ev.fields?.["invoice_no"] ?? ev.rrn ?? "";
                    const nextMaskedCard = ev.maskedPan ?? ev.payerId ?? "";
                    // "Approved" is wider than "00": VTI offline approvals
                    // (Y1/Y3) and duplicate-reference echoes (DR/DI) are real
                    // charges per GUIDELINE.md §5. Treating them as declines is
                    // what put a "Try again" button in front of a cashier whose
                    // customer had already been charged.
                    const outcome = classifyEdcResponse(ev.responseCode);
                    const isQrTimeout = mode === "qr" && String(ev.responseCode).trim().toUpperCase() === "TO";
                    const willAttemptCheckout =
                        outcome === "approved" && nextApprovalCode.trim().length > 0 && isCurrent();

                    // Report BEFORE branching. The branch below can decide not to
                    // call checkout at all (approved with no approval code), and
                    // that silent path is precisely the one that left the
                    // 2026-08-06 charge with no server-side trace whatsoever.
                    // `fields` is the raw bag: which key actually carried the
                    // approval code is the open question this is here to answer.
                    logEdcEvent({
                        event: "result",
                        context: telemetry?.context ?? "unknown",
                        shop_id: telemetry?.shopId ?? null,
                        idempotency_key: idempotencyKeyRef.current,
                        // Prefer what the bridge echoed; fall back to the derived
                        // value so this column is never empty.
                        pos_ref: ev.fields?.["pos_ref_no"]?.trim()
                            || posRefFromIdempotencyKey(idempotencyKeyRef.current),
                        edc_mode: mode,
                        amount: chargeAmount,
                        response_code: String(ev.responseCode),
                        response_message: ev.responseMessage ?? null,
                        approval_code: nextApprovalCode.trim() || null,
                        masked_card: nextMaskedCard.trim() || null,
                        rrn: ev.rrn ?? null,
                        fields: ev.fields,
                        checkout_attempted: willAttemptCheckout,
                    });

                    if (isQrTimeout) {
                        // Our request has no timeout of its own (see classifyEdcResponse's
                        // doc comment) — TO here is whatever the bridge/terminal decided,
                        // which can fire before the terminal's own ~3-minute on-screen QR
                        // window ends. Don't assume "nothing happened" — leave the pending
                        // Transactions-tab row as-is (no abandon call) so a manager can
                        // reconcile it once the terminal's own window has actually elapsed.
                        console.log(`[EDC] attempt #${attemptId} QR timeout — outcome unknown`);
                        setConnectionLost(true);
                        setDeclineInfo({
                            code: "TO",
                            message: t(
                                "storePos.edcQrTimeoutChecking",
                                "หมดเวลารอสแกน QR ฝั่งเรา — เครื่อง EDC อาจยังทำรายการค้างอยู่จริง (ยังไม่ครบ 3 นาทีของเครื่อง) ห้ามลองรายการใหม่จนกว่าจะตรวจสอบกับเครื่องก่อน",
                            ),
                        });
                        setStep("declined");
                    } else if (outcome === "approved") {
                        // Stale results (cashier cancelled or closed the modal mid-transaction)
                        // are ignored, matching handleCancelProcessing's contract — the
                        // terminal-side charge, if any, is reconciled manually.
                        if (isCurrent()) {
                            if (nextApprovalCode.trim().length > 0) {
                                // Auto-confirm — no manual entry needed when the terminal already
                                // gave us an approval code.
                                console.log(`[EDC] attempt #${attemptId} approved`, {
                                    terminalRef: nextTerminalRef.trim() || undefined,
                                    maskedCard: nextMaskedCard.trim() || undefined,
                                });
                                setStep("approved");
                                if (!pendingRef.current) {
                                    pendingRef.current = true;
                                    try {
                                        await onConfirm({
                                            approval_code: nextApprovalCode.trim(),
                                            terminal_ref: nextTerminalRef.trim() || undefined,
                                            masked_card: nextMaskedCard.trim() || undefined,
                                            mode,
                                            edc_pending_ref: await pendingTxnPromise,
                                        });
                                        console.log(`[EDC] attempt #${attemptId} onConfirm recorded`);
                                    } catch (err) {
                                        // onConfirm already closes the modal and shows its own error
                                        // toast — this catch only prevents an unhandled rejection.
                                        console.error("[EDC] auto-confirm error", err);
                                        // The customer HAS been charged and the sale did not
                                        // record. The `result` row above says only that we
                                        // were going to try; without this the failure itself
                                        // is invisible server-side whenever the checkout
                                        // request died before reaching the backend.
                                        logEdcEvent({
                                            event: "error",
                                            context: telemetry?.context ?? "unknown",
                                            shop_id: telemetry?.shopId ?? null,
                                            idempotency_key: idempotencyKeyRef.current,
                                            pos_ref: ev.fields?.["pos_ref_no"]?.trim()
                                                || posRefFromIdempotencyKey(idempotencyKeyRef.current),
                                            edc_mode: mode,
                                            amount: chargeAmount,
                                            response_code: String(ev.responseCode),
                                            approval_code: nextApprovalCode.trim() || null,
                                            masked_card: nextMaskedCard.trim() || null,
                                            rrn: ev.rrn ?? null,
                                            checkout_attempted: true,
                                            client_error: `checkout failed after approval: ${err instanceof Error ? err.message : String(err)}`,
                                        });
                                    } finally {
                                        pendingRef.current = false;
                                    }
                                }
                            } else {
                                // Terminal approved but gave no approval code to record the
                                // receipt with — cannot auto-confirm, and manual entry is
                                // intentionally not offered (see below). Surfaced as a distinct
                                // "approved but unrecorded" state so cashiers never retry blindly.
                                console.log(`[EDC] attempt #${attemptId} approved but no approval code returned`);
                                setApprovedNoRecord(true);
                                setDeclineInfo({
                                    // Show the raw code for the non-"00" approvals (offline /
                                    // duplicate) — the cashier needs it when they call it in,
                                    // and it explains why the slip and the screen disagree.
                                    code: isNonStandardApproval(ev.responseCode) ? String(ev.responseCode) : "",
                                    message: t(
                                        "storePos.edcApprovedNoCode",
                                        "เครื่องอนุมัติรายการแล้วแต่ไม่ได้รับรหัสยืนยันกลับมา — ห้ามลองใหม่ซ้ำ (อาจตัดเงินซ้ำ) กรุณาติดต่อผู้ดูแลระบบเพื่อบันทึกใบเสร็จด้วยตนเอง",
                                    ),
                                });
                                setStep("declined");
                            }
                        }
                    } else if (outcome === "cancelled") {
                        // Cancelled at the terminal (not a bank decline) — nothing was
                        // charged, and there's only one EDC method now, so skip both
                        // the decline card AND the single-button card choice screen —
                        // straight back out to the POS's own payment-method picker.
                        console.log(`[EDC] attempt #${attemptId} cancelled at terminal — back to payment picker`, ev.responseCode);
                        void pendingTxnPromise.then(abandonPendingRef);
                        resetAttemptState();
                        onBack();
                    } else {
                        console.log(`[EDC] attempt #${attemptId} declined`, ev.responseCode, ev.responseMessage);
                        void pendingTxnPromise.then(abandonPendingRef);
                        setDeclineInfo({
                            code: String(ev.responseCode),
                            message: ev.responseMessage ?? "",
                        });
                        setStep("declined");
                    }
                }
            }
        } catch (err) {
            // Reported before the isCurrent() bail-out: a cashier who cancelled
            // mid-transaction is exactly when a terminal-side charge goes
            // unreconciled, so the server should hear about it either way.
            logEdcEvent({
                event: "error",
                context: telemetry?.context ?? "unknown",
                shop_id: telemetry?.shopId ?? null,
                idempotency_key: idempotencyKeyRef.current,
                pos_ref: posRefFromIdempotencyKey(idempotencyKeyRef.current),
                edc_mode: mode,
                amount: total,
                checkout_attempted: false,
                client_error: err instanceof Error ? err.message : String(err),
            });
            if (!isCurrent()) return;
            // Never log full card data — the SDK never exposes it, but keep this guard in mind.
            console.error("[EDC] bridge/transaction error", err);
            console.log(`[EDC] attempt #${attemptId} connection lost — outcome unknown`);
            // We never got a result event, so the terminal may still be
            // mid-sale (e.g. a QR still live on-screen, customer yet to
            // scan) — leave the pending Transactions-tab row as-is (no
            // abandon call) rather than guessing at an outcome.
            setConnectionLost(true);
            setDeclineInfo({
                code: "",
                message: t(
                    "storePos.edcConnectionLost",
                    "ขาดการเชื่อมต่อกับเครื่อง EDC ระหว่างทำรายการ — เครื่องอาจยังทำรายการค้างอยู่ (เช่น QR ยังไม่หมดเวลา) ห้ามลองรายการใหม่จนกว่าจะตรวจสอบกับเครื่องก่อน",
                ),
            });
            setStep("declined");
        }
    };

    const handleSelectMode = (mode: EdcMode) => {
        console.log("[EDC] mode selected:", mode);
        void runAttempt(mode);
    };

    const handleBackToChoice = () => {
        console.log("[EDC] back to choice");
        attemptRef.current += 1;
        resetAttemptState();
        setStep("choice");
        setEdcMode(null);
    };

    const handleTryAgain = () => {
        console.log("[EDC] try again:", edcMode);
        if (edcMode) void runAttempt(edcMode);
    };

    // Once a QR/card attempt is in flight (or has just been approved and is
    // being recorded), block Escape/outside-click dismissal AND hide the
    // footer button entirely — there is no cashier-side way to abort a
    // submitted terminal transaction. The only way out is the terminal's own
    // result: an explicit cancel-type response code (see classifyEdcResponse)
    // bounces straight back to "choice"; a QR timeout goes through an extra
    // QUERY confirmation first (see the isQrTimeout branch); anything else
    // lands on "declined"/"approved". Does not affect the parent's own
    // `setEdcOpen(false)` call after a
    // successful onConfirm, since that happens outside onOpenChange entirely.
    const dismissLocked = step === "processing" || step === "approved";

    const showModeHeader = step !== "choice" && edcMode !== null;
    const HeaderIcon = showModeHeader ? (edcMode === "qr" ? QrCode : CreditCard) : Nfc;
    const headerTitle = showModeHeader
        ? edcMode === "qr"
            ? t("storePos.edcModalTitleQr", "EDC — QR CODE")
            : t("storePos.edcModalTitleCard", "EDC — Credit Card")
        : t("storePos.edcModalTitle", "EDC — Credit / Debit Card");

    // Card mode adds the 3% surcharge on top of the goods total — shown once
    // the cashier has actually picked "card" so the choice screen itself
    // still reads as one flat total per method.
    const cardFee = edcMode === "card" ? Math.round(total * EDC_CARD_FEE_RATE * 100) / 100 : 0;
    const chargeTotal = total + cardFee;

    const description =
        step === "choice"
            ? t("storePos.edcModeChoiceDesc", "Choose how the customer will pay.")
            : step === "processing"
                ? t("storePos.edcProcessingDesc", "Waiting for the terminal…")
                : step === "approved"
                    ? t("storePos.edcAutoConfirmDesc", "Transaction approved — recording the receipt…")
                    : connectionLost
                        ? t("storePos.edcUnknownOutcomeDesc", "ยังไม่ทราบผลลัพธ์จริงของรายการ")
                        : t("storePos.edcDeclinedDesc", "The transaction was not approved.");

    const footerBackDisabled = confirming;
    const footerBackLabel = t("storePos.back", "Back");
    // Once the outcome is a genuine dead end (terminal unreachable, or
    // approved with no code to record) — not just an ordinary decline —
    // Back exits straight to the payment method picker instead of bouncing
    // to this modal's own "choice" screen. There is nothing safe to retry
    // from here: the customer may already have been charged, so the only
    // way out is recovery (QUERY / manual code) or fully backing out.
    const handleFooterBack = (step === "choice" || connectionLost || approvedNoRecord)
        ? onBack
        : handleBackToChoice;

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (dismissLocked && !next) return;
                onOpenChange(next);
            }}
        >
            <DialogContent
                className="sm:max-w-md canteen-modal-pop "
                showCloseButton={false}
                onEscapeKeyDown={(e) => { if (dismissLocked) e.preventDefault(); }}
                onPointerDownOutside={(e) => { if (dismissLocked) e.preventDefault(); }}
                onInteractOutside={(e) => { if (dismissLocked) e.preventDefault(); }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <HeaderIcon className="h-6 w-6 text-violet-500" />
                        {headerTitle} —{" "}
                        <span className="text-violet-600 tabular-nums">฿{chargeTotal.toFixed(2)}</span>
                    </DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                    {cardFee > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                            {t(
                                "storePos.edcCardFeeNote",
                                "รวมค่าธรรมเนียมบัตร 3%: ฿{{fee}} (ยอดสินค้า ฿{{goods}})",
                                { fee: cardFee.toFixed(2), goods: total.toFixed(2) },
                            )}
                        </p>
                    )}
                    <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                        <span
                            className={`h-2 w-2 rounded-full ${terminalStatus === "connected"
                                ? "bg-emerald-500"
                                : terminalStatus === "disconnected"
                                    ? "bg-red-500"
                                    : "bg-muted-foreground/40 animate-pulse"
                                }`}
                        />
                        {terminalStatus === "connected"
                            ? t("storePos.edcTerminalConnected", "EDC connected")
                            : terminalStatus === "disconnected"
                                ? t("storePos.edcTerminalDisconnected", "EDC not connected")
                                : t("storePos.edcTerminalConnecting", "Connecting to EDC…")}
                    </div>
                </DialogHeader>

                {step === "choice" && (
                    <div className="grid grid-cols-1 gap-4 pt-1">
                        {/* QR Code temporarily disabled — EDC now goes straight to
                        card (see the auto-start effect above), this screen only
                        ever renders as a retry launchpad after a cancel/decline.
                        <button
                            type="button"
                            onClick={() => handleSelectMode("qr")}
                            className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center transition-all
                         hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-200/40 hover:border-sky-300 active:scale-[0.98]"
                        >
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-md">
                                <QrCode className="h-8 w-8" />
                            </div>
                            <div className="font-semibold">{t("storePos.edcModeQr", "QR CODE")}</div>
                        </button>
                        */}
                        <button
                            type="button"
                            onClick={() => handleSelectMode("card")}
                            className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center transition-all
                         hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-200/40 hover:border-violet-300 active:scale-[0.98]"
                        >
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-purple-600 text-white shadow-md">
                                <CreditCard className="h-8 w-8" />
                            </div>
                            <div className="font-semibold">{t("storePos.edcModeCard", "CREDIT CARD")}</div>
                        </button>
                    </div>
                )}

                {step === "processing" && (
                    <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
                        <Loader2 className="h-10 w-10 animate-spin text-violet-500" />
                        <div className="space-y-1">
                            <div className="font-medium">
                                {t("storePos.edcFollowPrompts", "Follow the prompts on the terminal…")}
                            </div>
                            {edcMode === "qr" && (
                                <div className="text-sm text-muted-foreground">
                                    {t("storePos.edcQrHint", "The QR code will appear on the terminal screen.")}
                                </div>
                            )}
                            {qrShown && (
                                <div className="text-sm text-sky-600">
                                    {t("storePos.edcQrShown", "QR code is now shown on the terminal.")}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {step === "approved" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-50 p-3 text-center dark:bg-emerald-950/30">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                {t("storePos.edcApproved", "APPROVED")}
                            </span>
                        </div>
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("storePos.edcRecording", "Recording receipt…")}
                        </div>
                    </div>
                )}

                {step === "declined" && (
                    <div className="space-y-4">
                        <div
                            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${approvedNoRecord || connectionLost
                                ? "border-amber-400/50 bg-amber-50 dark:bg-amber-950/30"
                                : "border-destructive/40 bg-destructive/10"
                                }`}
                        >
                            <XCircle
                                className={`h-8 w-8 ${approvedNoRecord || connectionLost ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}
                            />
                            <div
                                className={`font-semibold ${approvedNoRecord || connectionLost ? "text-amber-800 dark:text-amber-300" : "text-destructive"}`}
                            >
                                {approvedNoRecord
                                    ? t("storePos.edcApprovedUnrecorded", "APPROVED — NOT RECORDED")
                                    : connectionLost
                                        ? t("storePos.edcConnectionLostTitle", "ไม่ทราบผลการทำรายการ")
                                        : t("storePos.edcDeclined", "DECLINED")}
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {[declineInfo?.code, declineInfo?.message].filter(Boolean).join(" — ")}
                            </div>
                        </div>
                        {!approvedNoRecord && !connectionLost && (
                            <Button
                                type="button"
                                onClick={handleTryAgain}
                                className="w-full gap-2 h-12 bg-violet-600 hover:bg-violet-700 text-white"
                            >
                                {t("storePos.edcTryAgain", "Try again")}
                            </Button>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    {step !== "approved" && step !== "processing" && (
                        <Button
                            variant="outline"
                            onClick={handleFooterBack}
                            disabled={footerBackDisabled}
                        >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            {footerBackLabel}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
