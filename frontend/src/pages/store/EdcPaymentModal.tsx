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
import { getEdcClient, readyEdc } from "@/lib/paywire/edcClient";

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
 * and is the source of truth, this is only for the on-screen preview. */
const EDC_CARD_FEE_RATE = 0.03;

interface EdcPaymentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    total: number;
    onBack: () => void;
    onConfirm: (refs: EdcRefs) => Promise<void>;
    confirming: boolean;
}

interface DeclineInfo {
    code: string;
    message: string;
}

export function EdcPaymentModal({
    open,
    onOpenChange,
    total,
    onBack,
    onConfirm,
    confirming,
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
    const [declineInfo, setDeclineInfo] = useState<DeclineInfo | null>(null);
    const [qrShown, setQrShown] = useState(false);
    const [terminalStatus, setTerminalStatus] = useState<"connected" | "disconnected" | "unknown">(
        "unknown",
    );

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
            setTerminalStatus(s.state === "connected" ? "connected" : "disconnected");
        });

        readyEdc()
            .then(() => {
                if (!active) return;
                setTerminalStatus(edc.terminalConnected ? "connected" : "disconnected");
            })
            .catch(() => {
                if (active) setTerminalStatus("disconnected");
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [open]);

    const resetAttemptState = () => {
        setDeclineInfo(null);
        setApprovedNoRecord(false);
        setQrShown(false);
    };

    const runAttempt = async (mode: EdcMode) => {
        const attemptId = ++attemptRef.current;
        const isCurrent = () => attemptRef.current === attemptId;

        idempotencyKeyRef.current = crypto.randomUUID();
        setEdcMode(mode);
        resetAttemptState();
        setStep("processing");

        try {
            await readyEdc();
            if (!isCurrent()) return;

            const edc = getEdcClient();
            // Card swipe/tap carries a 3% surcharge the customer pays on top of
            // the goods total — QR never does. Backend recomputes and stores
            // this independently; this is what's actually charged at the terminal.
            const cardFee = mode === "card" ? Math.round(total * EDC_CARD_FEE_RATE * 100) / 100 : 0;
            const chargeAmount = total + cardFee;
            const satang = Math.round(chargeAmount * 100);
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

                if (ev.kind === "qr-shown") {
                    // LinkPOS does not emit this — keep it as a nice-to-have, never depended on.
                    setQrShown(true);
                    continue;
                }

                if (ev.kind === "result") {
                    if (ev.responseCode === "00") {
                        const nextApprovalCode = ev.approvalCode ?? "";
                        const nextTerminalRef = ev.fields?.["invoice_no"] ?? ev.rrn ?? "";
                        const nextMaskedCard = ev.maskedPan ?? ev.payerId ?? "";

                        // Stale results (cashier cancelled or closed the modal mid-transaction)
                        // are ignored, matching handleCancelProcessing's contract — the
                        // terminal-side charge, if any, is reconciled manually.
                        if (isCurrent()) {
                            if (nextApprovalCode.trim().length > 0) {
                                // Auto-confirm — no manual entry needed when the terminal already
                                // gave us an approval code.
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
                                    } catch (err) {
                                        // onConfirm already closes the modal and shows its own error
                                        // toast — this catch only prevents an unhandled rejection.
                                        console.error("[EDC] auto-confirm error", err);
                                    } finally {
                                        pendingRef.current = false;
                                    }
                                }
                            } else {
                                // Terminal approved but gave no approval code to record the
                                // receipt with — cannot auto-confirm, and manual entry is
                                // intentionally not offered (see below). Surfaced as a distinct
                                // "approved but unrecorded" state so cashiers never retry blindly.
                                setApprovedNoRecord(true);
                                setDeclineInfo({
                                    code: "",
                                    message: t(
                                        "storePos.edcApprovedNoCode",
                                        "เครื่องอนุมัติรายการแล้วแต่ไม่ได้รับรหัสยืนยันกลับมา — ห้ามลองใหม่ซ้ำ (อาจตัดเงินซ้ำ) กรุณาติดต่อผู้ดูแลระบบเพื่อบันทึกใบเสร็จด้วยตนเอง",
                                    ),
                                });
                                setStep("declined");
                            }
                        }
                    } else {
                        setDeclineInfo({
                            code: String(ev.responseCode),
                            message: ev.responseMessage ?? "",
                        });
                        setStep("declined");
                    }
                }
            }
        } catch (err) {
            if (!isCurrent()) return;
            // Never log full card data — the SDK never exposes it, but keep this guard in mind.
            console.error("[EDC] bridge/transaction error", err);
            setDeclineInfo({
                code: "",
                message: t(
                    "storePos.edcBridgeUnreachable",
                    "เชื่อมต่อ EDC bridge ไม่ได้ — ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ",
                ),
            });
            setStep("declined");
        }
    };

    const handleSelectMode = (mode: EdcMode) => {
        void runAttempt(mode);
    };

    const handleCancelProcessing = () => {
        // Invalidates result handling for this attempt — cannot abort the terminal-side
        // transaction itself, it will just be ignored when/if it eventually resolves.
        attemptRef.current += 1;
        setStep("choice");
        setEdcMode(null);
    };

    const handleBackToChoice = () => {
        attemptRef.current += 1;
        resetAttemptState();
        setStep("choice");
        setEdcMode(null);
    };

    const handleTryAgain = () => {
        if (edcMode) void runAttempt(edcMode);
    };

    // Once a QR/card attempt is in flight (or has just been approved and is
    // being recorded), block Escape/outside-click dismissal — the cashier
    // must use the explicit Cancel button (which only resets the step, it
    // never closes the dialog) rather than accidentally losing the modal
    // mid-transaction. Does not affect the parent's own `setEdcOpen(false)`
    // call after a successful onConfirm, since that happens outside
    // onOpenChange entirely.
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
                    : t("storePos.edcDeclinedDesc", "The transaction was not approved.");

    const footerBackDisabled = confirming;
    const footerBackLabel =
        step === "processing" ? t("storePos.cancel", "Cancel") : t("storePos.back", "Back");
    const handleFooterBack =
        step === "choice" ? onBack : step === "processing" ? handleCancelProcessing : handleBackToChoice;

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
                    <div className="grid grid-cols-2 gap-4 pt-1">
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
                            <div className="text-xs text-muted-foreground">
                                {t("storePos.edcCardFeeHint", "+3% fee")}
                            </div>
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
                            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${approvedNoRecord
                                ? "border-amber-400/50 bg-amber-50 dark:bg-amber-950/30"
                                : "border-destructive/40 bg-destructive/10"
                                }`}
                        >
                            <XCircle
                                className={`h-8 w-8 ${approvedNoRecord ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}
                            />
                            <div
                                className={`font-semibold ${approvedNoRecord ? "text-amber-800 dark:text-amber-300" : "text-destructive"}`}
                            >
                                {approvedNoRecord
                                    ? t("storePos.edcApprovedUnrecorded", "APPROVED — NOT RECORDED")
                                    : t("storePos.edcDeclined", "DECLINED")}
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {[declineInfo?.code, declineInfo?.message].filter(Boolean).join(" — ")}
                            </div>
                        </div>
                        {!approvedNoRecord && (
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
                    {step !== "approved" && (
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
