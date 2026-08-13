import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { PAYMENT_QR_BG, PAYMENT_QR_FG } from "@/lib/paymentQrColors";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QrCode, Loader2, ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface QrPaymentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    total: number;
    onBack: () => void;
    /**
     * Called when BAY confirms payment AND the backend has created a receipt
     * automatically from the cart snapshot. The callee should advance the
     * cashier UI into the success flow (clear cart, show receipt modal).
     */
    onPaid: (info: { refCode: string; receiptId: number | null; receiptNumber: string | null }) => void;
    /** Used to build the intent — the parent owns the cart shape. */
    buildCartPayload: () => Record<string, unknown>;
    /**
     * Called the moment the BAY intent comes back with a real qr_payload
     * (or fails). Parent uses this to push the same QR onto the second
     * monitor / customer display so the customer can scan it without
     * leaning over the cashier's shoulder. Receives null when the modal
     * is closing / cancelled.
     */
    onIntentReady?: (info: { qrPayload: string; refCode: string } | null) => void;
}

interface PosQrIntent {
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

type Phase = "creating" | "waiting" | "confirmed" | "failed" | "expired";

const POLL_INTERVAL_MS = 2000;
const SLOW_POLL_INTERVAL_MS = 5000; // after the timeout banner shows, ease off but never stop checking
const INQUIRY_EVERY_N_POLLS = 3; // ~6 s while fast-polling
const TIMEOUT_DISPLAY_MS = 5 * 60 * 1000; // past this, show "still waiting" — auto-check keeps running regardless

export function QrPaymentModal({
    open,
    onOpenChange,
    total,
    onBack,
    onPaid,
    buildCartPayload,
    onIntentReady,
}: QrPaymentModalProps) {
    const [phase, setPhase] = useState<Phase>("creating");
    const [intent, setIntent] = useState<PosQrIntent | null>(null);
    const [error, setError] = useState<string>("");
    // Stable ref so the poll loop can cancel itself when the modal closes.
    const cancelledRef = useRef(false);
    // Guards against ever firing a second BAY intent for the same open
    // session (e.g. a double-invoked effect) — two live intents for one cart
    // would put two distinct QR codes in front of the customer and risk a
    // duplicate charge if both got scanned.
    const intentRequestedRef = useRef(false);
    // The parent passes a fresh `buildCartPayload` closure on every render.
    // We snapshot the latest reference in a ref so the create-intent effect
    // can read it WITHOUT taking it as a dep — otherwise the effect would
    // re-run on every parent re-render (e.g. react-query refetches) and
    // create a brand-new BAY transaction each time. amount is captured at
    // mount via `totalRef` for the same reason.
    const buildCartRef = useRef(buildCartPayload);
    buildCartRef.current = buildCartPayload;
    const totalRef = useRef(total);
    totalRef.current = total;

    // Create the BAY intent the moment the modal opens — exactly once per
    // open transition. Deps are intentionally only `open`.
    useEffect(() => {
        if (!open) {
            // Reset state when modal closes — next open starts fresh.
            // Also clear the customer display so it doesn't keep showing a
            // stale QR after the cashier cancels or the payment completes.
            cancelledRef.current = true;
            intentRequestedRef.current = false;
            setIntent(null);
            setError("");
            setPhase("creating");
            onIntentReadyRef.current?.(null);
            return;
        }
        if (intentRequestedRef.current) return;
        intentRequestedRef.current = true;
        cancelledRef.current = false;

        const createIntent = async () => {
            try {
                const cart = buildCartRef.current();
                const created = await api.post<PosQrIntent>("/pos/qr-intent", {
                    amount: totalRef.current,
                    cart,
                });
                if (cancelledRef.current) return;
                setIntent(created);
                setPhase("waiting");
                // Push the real BAY QR to the customer-facing screen so the
                // customer can scan without leaning over the cashier.
                if (created.qr_payload) {
                    onIntentReadyRef.current?.({
                        qrPayload: created.qr_payload,
                        refCode: created.ref_code,
                    });
                }
            } catch (e) {
                if (cancelledRef.current) return;
                setError(e instanceof ApiError ? e.detail : "Could not generate QR code");
                setPhase("failed");
                onIntentReadyRef.current?.(null);
            }
        };
        void createIntent();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Same ref-stabilizing trick for the parent's onPaid callback so the
    // polling effect doesn't reset every time the parent re-renders.
    const onPaidRef = useRef(onPaid);
    onPaidRef.current = onPaid;
    const onIntentReadyRef = useRef(onIntentReady);
    onIntentReadyRef.current = onIntentReady;

    // Poll status while the intent is alive. There is no manual "Check Now"
    // button — this loop is the only thing that ever asks the bank again, and
    // it keeps running through both the "waiting" and "expired" UI states.
    // Crossing the timeout only changes what's on screen; it never stops the
    // background checking.
    useEffect(() => {
        if (!open || !intent || (phase !== "waiting" && phase !== "expired")) return;
        cancelledRef.current = false;
        let round = 0;
        const startTime = Date.now();
        let pastTimeout = phase === "expired";

        const poll = async () => {
            while (!cancelledRef.current) {
                round += 1;
                if (!pastTimeout && Date.now() - startTime >= TIMEOUT_DISPLAY_MS) {
                    pastTimeout = true;
                    setError(
                        "Bank has not confirmed in 5 minutes. Still checking automatically in the background — safe to skip and move on, this will complete on its own once the bank answers.",
                    );
                    setPhase("expired");
                }
                try {
                    // Cheap local-status poll most rounds; force-sync against BAY
                    // every Nth round so we don't depend solely on the webhook.
                    const url =
                        round % INQUIRY_EVERY_N_POLLS === 0
                            ? `/pos/qr-intent/${intent.ref_code}/inquiry`
                            : `/pos/qr-intent/${intent.ref_code}/status`;

                    const fresh =
                        round % INQUIRY_EVERY_N_POLLS === 0
                            ? await api.post<PosQrIntent>(url, {})
                            : await api.get<PosQrIntent>(url);

                    if (cancelledRef.current) return;
                    if (fresh.status === "confirmed") {
                        setIntent(fresh);
                        setPhase("confirmed");
                        onPaidRef.current({
                            refCode: fresh.ref_code,
                            receiptId: fresh.receipt_id,
                            receiptNumber: fresh.receipt_number,
                        });
                        return;
                    }
                    if (fresh.status === "cancelled") {
                        setError("Payment was cancelled or failed at the bank.");
                        setPhase("failed");
                        return;
                    }
                } catch {
                    // Network / 5xx — keep trying. Webhook is the source of truth.
                }
                await new Promise<void>((res) =>
                    setTimeout(res, pastTimeout ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS),
                );
            }
        };
        void poll();
        return () => { cancelledRef.current = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, intent, phase]);

    // Shared first step for both "Skip" and "Cancel": ask BAY directly via
    // /inquiry (same endpoint the background poll loop uses) before leaving.
    // Never blindly mark the intent cancelled here — if the customer had in
    // fact paid and the webhook was only delayed, confirmPosQrSale's Phase A
    // skips cancelled intents outright and the payment would be captured with
    // no receipt ever created, permanently. Returns true if BAY confirmed the
    // payment (caller should stop — onPaid already fired).
    const checkBeforeLeaving = async (): Promise<boolean> => {
        if (!intent) return false;
        try {
            const fresh = await api.post<PosQrIntent>(`/pos/qr-intent/${intent.ref_code}/inquiry`, {});
            if (fresh.status === "confirmed") {
                // Rare race: BAY confirmed between the last poll and this call.
                onPaidRef.current({
                    refCode: fresh.ref_code,
                    receiptId: fresh.receipt_id,
                    receiptNumber: fresh.receipt_number,
                });
                return true;
            }
            if (fresh.status === "pending") {
                console.log(
                    `[POS QR] left waiting — ref=${intent.ref_code} still pending at BAY, left for a later callback/inquiry`,
                );
            }
        } catch (e) {
            // Could not reach BAY/our backend to check — still don't guess.
            console.log(
                `[POS QR] could not confirm outcome before leaving — ref=${intent.ref_code} left pending`,
                e,
            );
        }
        return false;
    };

    /**
     * "Skip" — cashier moves on without giving up on this QR. The intent AND
     * the Transactions-tab row are left exactly as 'pending': the cart is
     * already in the log (created back at /pos/qr-intent time), and if BAY's
     * webhook calls back later, confirmPosQrSale resolves it the normal way —
     * flips the transaction to 'success' and stamps the receipt — with no
     * further action needed here.
     */
    const handleSkip = async () => {
        if (!intent) {
            onBack();
            return;
        }
        cancelledRef.current = true;
        const confirmed = await checkBeforeLeaving();
        if (confirmed) return;
        onBack();
    };

    /**
     * "Cancel" — cashier is certain this attempt is done (e.g. the customer
     * walked away). Marks only the Transactions-tab row 'cancelled' for
     * visibility; the payment_intent itself is left untouched so a late
     * webhook can still complete the sale, which flips this same row back to
     * 'success' automatically if that happens.
     */
    const handleCancel = async () => {
        if (!intent) {
            onBack();
            return;
        }
        cancelledRef.current = true;
        const confirmed = await checkBeforeLeaving();
        if (confirmed) return;
        try {
            await api.post(`/pos/qr-intent/${intent.ref_code}/abandon`, {});
        } catch {
            // Best-effort — Transactions tab may show "pending" a bit longer.
        }
        onBack();
    };

    const isPending = phase === "waiting" || phase === "expired";

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!isPending) onOpenChange(v);
            }}
        >
            <DialogContent className="sm:max-w-md canteen-modal-pop" showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={handleSkip}
                            className="-ml-2 h-7 w-7"
                            aria-label="Back"
                            disabled={phase === "creating"}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <QrCode className="h-5 w-5 text-indigo-500" />
                        QR PromptPay (BAY)
                    </DialogTitle>
                </DialogHeader>

                {phase === "creating" && (
                    <div className="flex flex-col items-center gap-3 py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                        <p className="text-sm text-muted-foreground">Generating QR code…</p>
                    </div>
                )}

                {phase === "waiting" && intent && (
                    <>
                        <div className="flex flex-col items-center gap-3 py-2">
                            <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-indigo-200 bg-white p-3">
                                <QRCodeSVG
                                    value={intent.qr_payload || `PROMPTPAY|AMOUNT|${total.toFixed(2)}`}
                                    size={168}
                                    level="M"
                                    includeMargin={false}
                                    fgColor={PAYMENT_QR_FG}
                                    bgColor={PAYMENT_QR_BG}
                                    aria-label="BAY PromptPay QR"
                                />
                            </div>
                            <div className="text-center">
                                <div className="text-xs uppercase text-muted-foreground">Scan to pay</div>
                                <div className="text-3xl font-bold tabular-nums text-indigo-700">
                                    ฿{total.toFixed(2)}
                                </div>
                                <div className="mt-1 text-[10px] text-muted-foreground italic">
                                    Ref: <span className="font-mono">{intent.ref_code}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Waiting for payment…
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button variant="outline" className="flex-1" onClick={handleSkip}>
                                Skip
                            </Button>
                            <Button
                                variant="outline"
                                className="flex-1 text-destructive hover:text-destructive"
                                onClick={handleCancel}
                            >
                                Cancel
                            </Button>
                        </div>
                    </>
                )}

                {phase === "confirmed" && (
                    <div className="flex flex-col items-center gap-3 py-6">
                        <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                        <p className="font-semibold text-lg">Payment confirmed</p>
                        <p className="text-sm text-muted-foreground">Closing…</p>
                    </div>
                )}

                {phase === "expired" && (
                    <div className="flex flex-col items-center gap-3 py-4">
                        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
                        <p className="text-sm text-center text-muted-foreground">{error}</p>
                        <div className="flex gap-2 w-full">
                            <Button variant="outline" className="flex-1" onClick={handleSkip}>
                                Skip
                            </Button>
                            <Button
                                variant="outline"
                                className="flex-1 text-destructive hover:text-destructive"
                                onClick={handleCancel}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {phase === "failed" && (
                    <div className="flex flex-col items-center gap-3 py-4">
                        <AlertTriangle className="h-10 w-10 text-amber-500" />
                        <p className="text-sm text-center text-muted-foreground">{error}</p>
                        <Button variant="outline" className="w-full" onClick={handleSkip}>
                            Back
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
