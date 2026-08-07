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
import { Input } from "@/components/ui/input";
import { CheckCircle2, ChevronLeft, CreditCard, Loader2, Nfc, QrCode, XCircle } from "lucide-react";
import { getEdcClient, readyEdc } from "@/lib/paywire/edcClient";
import { logEdcEvent } from "@/lib/paywire/edcTelemetry";
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
     * Where this modal is mounted, for the server-side EDC event log. The
     * bridge runs on the cashier's own machine, so without this the backend has
     * no idea which POS produced a terminal charge. Optional so the three
     * existing call sites can adopt it independently; falls back to "unknown".
     */
    telemetry?: { context: string; shopId?: string | null };
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
    const [terminalStatus, setTerminalStatus] = useState<"connected" | "disconnected" | "unknown">(
        "unknown",
    );
    // ── Recovery, for the "terminal charged but we can't record it" dead end ──
    // Before this existed the cashier's only option was Back: the sale was lost
    // and the customer had already paid. Two ways out now, in order of
    // preference: ask the terminal what really happened (LinkPOS QUERY), or let
    // the cashier type the approval code printed on the slip in front of them.
    const [recovering, setRecovering] = useState(false);
    const [recoveryNote, setRecoveryNote] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState("");
    /** Details of the attempt that dead-ended, so recovery can finish it. */
    const lastAttemptRef = useRef<{
        posRef: string;
        mode: EdcMode;
        terminalRef: string;
        maskedCard: string;
        responseCode: string;
    } | null>(null);

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

    // Live terminal status while the modal is open: eagerly connect the bridge
    // (readyEdc is cached/shared) and mirror the /status stream into a pill.
    useEffect(() => {
        if (!open) return;
        let active = true;
        setTerminalStatus("unknown");

        const edc = getEdcClient();
        // Subscribe before ready() so the first /status message is never missed.
        const unsubscribe = edc.onTerminalStatus((s) => {
            if (!active) return;
            console.log("[EDC] terminal status:", s.state);
            setTerminalStatus(s.state === "connected" ? "connected" : "disconnected");
        });

        readyEdc()
            .then(() => {
                if (!active) return;
                setTerminalStatus(edc.terminalConnected ? "connected" : "disconnected");
            })
            .catch((err) => {
                console.error("[EDC] readyEdc() failed", err);
                if (active) setTerminalStatus("disconnected");
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [open]);

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
        setRecoveryNote(null);
        setManualCode("");
    };

    /**
     * Finish a dead-ended attempt with an approval code obtained after the fact
     * — either recovered from the terminal via QUERY, or read off the slip by
     * the cashier. Same onConfirm path as a normal sale, so it produces a real
     * receipt and deducts stock exactly once.
     */
    const finishWithApprovalCode = async (approvalCode: string, source: "query" | "manual") => {
        const last = lastAttemptRef.current;
        if (!last || pendingRef.current) return;
        pendingRef.current = true;
        setRecovering(true);
        try {
            logEdcEvent({
                event: "result",
                context: telemetry?.context ?? "unknown",
                shop_id: telemetry?.shopId ?? null,
                idempotency_key: idempotencyKeyRef.current,
                pos_ref: last.posRef,
                edc_mode: last.mode,
                amount: total,
                response_code: last.responseCode,
                approval_code: approvalCode,
                masked_card: last.maskedCard || null,
                checkout_attempted: true,
                // Recorded so an audit can tell a normal sale from one rescued
                // after the fact, and by which route.
                client_error: `recovered via ${source}`,
            });
            setStep("approved");
            await onConfirm({
                approval_code: approvalCode,
                terminal_ref: last.terminalRef || undefined,
                masked_card: last.maskedCard || undefined,
                mode: last.mode,
            });
        } catch (err) {
            console.error("[EDC] recovery confirm failed", err);
            setStep("declined");
            setRecoveryNote(
                t("storePos.edcRecoveryConfirmFailed", "บันทึกใบเสร็จไม่สำเร็จ — ลองอีกครั้งหรือแจ้งผู้ดูแลระบบ"),
            );
        } finally {
            pendingRef.current = false;
            setRecovering(false);
        }
    };

    /**
     * Ask the terminal what actually happened to the dead-ended sale.
     *
     * GUIDELINE.md §6: QUERY is the sanctioned way to learn the real outcome
     * after a lost response, instead of blindly re-charging. The POS reference
     * is derived from the original idempotency key, so this works even though
     * we never passed one explicitly.
     */
    const runQueryRecovery = async () => {
        const last = lastAttemptRef.current;
        if (!last || recovering) return;
        setRecovering(true);
        setRecoveryNote(null);
        try {
            const edc = getEdcClient();
            let resolved = false;
            for await (const ev of edc.query({
                posRef: last.posRef,
                idempotencyKey: crypto.randomUUID(),
            })) {
                if (ev.kind !== "result") continue;
                resolved = true;
                const code = (ev.approvalCode ?? "").trim();
                const outcome = classifyEdcResponse(ev.responseCode);
                if (outcome === "approved" && code) {
                    await finishWithApprovalCode(code, "query");
                } else if (outcome === "approved") {
                    setRecoveryNote(
                        t("storePos.edcQueryApprovedNoCode", "เครื่องยืนยันว่าอนุมัติแล้ว แต่ยังไม่ได้รหัสอนุมัติ — กรอกจากสลิปด้านล่าง"),
                    );
                } else {
                    // NE = "transaction does not exist" per GUIDELINE §5, i.e.
                    // nothing was charged after all — confirmed safe, so skip
                    // both the "cashier reads the note, then clicks Back" step
                    // AND the single-button card choice screen (there's only
                    // one EDC method now), straight out to the POS's own
                    // payment-method picker.
                    console.log(`[EDC] query recovery confirmed not charged (${ev.responseCode}) — back to payment picker`);
                    resetAttemptState();
                    onBack();
                    return;
                }
            }
            if (!resolved) {
                setRecoveryNote(t("storePos.edcQueryNoAnswer", "เครื่องไม่ตอบกลับ — กรอกรหัสจากสลิปด้านล่างแทน"));
            }
        } catch (err) {
            console.error("[EDC] query recovery failed", err);
            setRecoveryNote(
                t("storePos.edcQueryFailed", "ตรวจสอบกับเครื่องไม่สำเร็จ — กรอกรหัสจากสลิปด้านล่างแทน"),
            );
        } finally {
            setRecovering(false);
        }
    };

    const runAttempt = async (mode: EdcMode) => {
        const attemptId = ++attemptRef.current;
        const isCurrent = () => attemptRef.current === attemptId;

        idempotencyKeyRef.current = crypto.randomUUID();
        setEdcMode(mode);
        resetAttemptState();
        setStep("processing");
        console.log(`[EDC] attempt #${attemptId} start`, { mode, idempotencyKey: idempotencyKeyRef.current, total });

        try {
            await readyEdc();
            if (!isCurrent()) return;
            console.log(`[EDC] attempt #${attemptId} bridge ready`);

            const edc = getEdcClient();
            // Card swipe/tap carries a 3% surcharge the customer pays on top of
            // the goods total — QR never does. Backend recomputes and stores
            // this independently; this is what's actually charged at the terminal.
            const cardFee = mode === "card" ? Math.round(total * EDC_CARD_FEE_RATE * 100) / 100 : 0;
            const chargeAmount = total + cardFee;
            const satang = Math.round(chargeAmount * 100);

            // Bookend for the worst case: a terminal that charges the card and
            // then never yields a result event at all. Without this row the
            // attempt is invisible server-side — no result, no error, nothing.
            logEdcEvent({
                event: "started",
                context: telemetry?.context ?? "unknown",
                shop_id: telemetry?.shopId ?? null,
                idempotency_key: idempotencyKeyRef.current,
                pos_ref: posRefFromIdempotencyKey(idempotencyKeyRef.current),
                edc_mode: mode,
                amount: chargeAmount,
                checkout_attempted: false,
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
                        // window ends. Don't assume "nothing happened": confirm with the
                        // terminal via QUERY first, same as the approved-no-code dead end,
                        // before it's safe to bounce back to choice.
                        console.log(`[EDC] attempt #${attemptId} QR timeout — confirming with terminal before resetting`);
                        lastAttemptRef.current = {
                            posRef: ev.fields?.["pos_ref_no"]?.trim()
                                || posRefFromIdempotencyKey(idempotencyKeyRef.current),
                            mode,
                            terminalRef: nextTerminalRef.trim(),
                            maskedCard: nextMaskedCard.trim(),
                            responseCode: "TO",
                        };
                        setConnectionLost(true);
                        setDeclineInfo({
                            code: "TO",
                            message: t(
                                "storePos.edcQrTimeoutChecking",
                                "หมดเวลารอสแกน QR ฝั่งเรา — เครื่อง EDC อาจยังทำรายการค้างอยู่จริง (ยังไม่ครบ 3 นาทีของเครื่อง) ระบบกำลังตรวจสอบกับเครื่องอัตโนมัติ ห้ามลองรายการใหม่จนกว่าจะยืนยันผล",
                            ),
                        });
                        setStep("declined");
                        void runQueryRecovery();
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
                                // Stash what recovery needs — the POS reference
                                // above all, since QUERY is keyed on it.
                                lastAttemptRef.current = {
                                    posRef: ev.fields?.["pos_ref_no"]?.trim()
                                        || posRefFromIdempotencyKey(idempotencyKeyRef.current),
                                    mode,
                                    terminalRef: nextTerminalRef.trim(),
                                    maskedCard: nextMaskedCard.trim(),
                                    responseCode: String(ev.responseCode),
                                };
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
                        resetAttemptState();
                        onBack();
                    } else {
                        console.log(`[EDC] attempt #${attemptId} declined`, ev.responseCode, ev.responseMessage);
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
            // We never got a result event, so the terminal may still be mid-sale
            // (e.g. a QR still live on-screen, customer yet to scan). Stash what
            // recovery needs, same as the approved-no-code dead end — QUERY is
            // keyed on posRef alone, so this works even though nothing else about
            // the attempt is known.
            lastAttemptRef.current = {
                posRef: posRefFromIdempotencyKey(idempotencyKeyRef.current),
                mode,
                terminalRef: "",
                maskedCard: "",
                responseCode: "",
            };
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
    const handleFooterBack = step === "choice" ? onBack : handleBackToChoice;

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

                        {/* Way out of the dead end. Never a "Try again" here —
                            the customer may already have been charged (or the
                            terminal may still be mid-sale after a lost
                            connection), so the only safe moves are to ask the
                            terminal what happened or to record the code printed
                            on the slip. */}
                        {(approvedNoRecord || connectionLost) && lastAttemptRef.current && (
                            <div className="space-y-3 rounded-xl border border-border p-3">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    className="w-full gap-2 h-11"
                                    disabled={recovering || confirming}
                                    onClick={() => void runQueryRecovery()}
                                >
                                    {recovering
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <Nfc className="h-4 w-4" />}
                                    {t("storePos.edcQueryTerminal", "ตรวจสอบรายการล่าสุดกับเครื่อง")}
                                </Button>

                                {recoveryNote && (
                                    <p className="text-xs text-amber-700 dark:text-amber-400">{recoveryNote}</p>
                                )}

                                <div className="space-y-1.5">
                                    <label className="text-xs text-muted-foreground" htmlFor="edc-manual-appr">
                                        {t("storePos.edcManualApprLabel", "หรือกรอก APPR.CODE จากสลิป")}
                                    </label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="edc-manual-appr"
                                            value={manualCode}
                                            inputMode="numeric"
                                            autoComplete="off"
                                            placeholder="139350"
                                            maxLength={32}
                                            disabled={recovering || confirming}
                                            onChange={(e) => setManualCode(e.target.value)}
                                        />
                                        <Button
                                            type="button"
                                            disabled={!manualCode.trim() || recovering || confirming}
                                            onClick={() => void finishWithApprovalCode(manualCode.trim(), "manual")}
                                        >
                                            {t("storePos.edcRecordSale", "บันทึกการขาย")}
                                        </Button>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        POS REF: <span className="font-mono">{lastAttemptRef.current.posRef}</span>
                                    </p>
                                </div>
                            </div>
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
