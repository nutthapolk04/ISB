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
import { Label } from "@/components/ui/label";
import { CheckCircle2, ChevronLeft, CreditCard, Loader2, Nfc, QrCode, XCircle } from "lucide-react";
import { getEdcClient, readyEdc } from "@/lib/paywire/edcClient";

interface EdcRefs {
  approval_code: string;
  terminal_ref?: string;
  masked_card?: string;
}

/** Which way the customer pays on the terminal — drives qrSale vs sale. */
export type EdcMode = "qr" | "card";

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
  const [step, setStep] = useState<"choice" | "processing" | "declined" | "form">("choice");
  const [edcMode, setEdcMode] = useState<EdcMode | null>(null);
  const [approvalCode, setApprovalCode] = useState("");
  const [terminalRef, setTerminalRef] = useState("");
  const [maskedCard, setMaskedCard] = useState("");
  const [approved, setApproved] = useState(false);
  const [declineInfo, setDeclineInfo] = useState<DeclineInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [qrShown, setQrShown] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState<"connected" | "disconnected" | "unknown">(
    "unknown",
  );

  // Guards against setState after the modal is closed/unmounted mid-transaction —
  // any in-flight attempt bumps this ref to invalidate itself before touching state.
  const attemptRef = useRef(0);
  const idempotencyKeyRef = useRef("");

  useEffect(() => {
    if (!open) {
      attemptRef.current += 1;
      setStep("choice");
      setEdcMode(null);
      setApprovalCode("");
      setTerminalRef("");
      setMaskedCard("");
      setApproved(false);
      setDeclineInfo(null);
      setBridgeError(null);
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
    setBridgeError(null);
    setApproved(false);
    setApprovalCode("");
    setTerminalRef("");
    setMaskedCard("");
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
      const satang = Math.round(total * 100);
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
            setApprovalCode(ev.approvalCode ?? "");
            setTerminalRef(ev.fields?.["invoice_no"] ?? ev.rrn ?? "");
            setMaskedCard(ev.maskedPan ?? ev.payerId ?? "");
            setApproved(true);
            setStep("form");
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
      setBridgeError(
        t(
          "storePos.edcBridgeUnreachable",
          "เชื่อมต่อ EDC bridge ไม่ได้ — กรอกข้อมูลเองได้",
        ),
      );
      setStep("form");
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

  const canConfirm = step === "form" && approvalCode.trim().length > 0 && !confirming;

  const pendingRef = useRef(false);
  const handleConfirm = async () => {
    if (pendingRef.current || !canConfirm) return;
    pendingRef.current = true;
    try {
      await onConfirm({
        approval_code: approvalCode.trim(),
        terminal_ref: terminalRef.trim() || undefined,
        masked_card: maskedCard.trim() || undefined,
      });
    } finally {
      pendingRef.current = false;
    }
  };

  const showModeHeader = step !== "choice" && edcMode !== null;
  const HeaderIcon = showModeHeader ? (edcMode === "qr" ? QrCode : CreditCard) : Nfc;
  const headerTitle = showModeHeader
    ? edcMode === "qr"
      ? t("storePos.edcModalTitleQr", "EDC — QR CODE")
      : t("storePos.edcModalTitleCard", "EDC — Credit Card")
    : t("storePos.edcModalTitle", "EDC — Credit / Debit Card");

  const description =
    step === "choice"
      ? t("storePos.edcModeChoiceDesc", "Choose how the customer will pay.")
      : step === "processing"
        ? t("storePos.edcProcessingDesc", "Waiting for the terminal…")
        : step === "declined"
          ? t("storePos.edcDeclinedDesc", "The transaction was not approved.")
          : approved
            ? t("storePos.edcApprovedDesc", "Transaction approved — confirm to record the receipt.")
            : t("storePos.edcManualDesc", "Enter the approval code manually.");

  const footerBackDisabled = confirming;
  const footerBackLabel =
    step === "processing" ? t("storePos.cancel", "Cancel") : t("storePos.back", "Back");
  const handleFooterBack =
    step === "choice" ? onBack : step === "processing" ? handleCancelProcessing : handleBackToChoice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md canteen-modal-pop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <HeaderIcon className="h-6 w-6 text-violet-500" />
            {headerTitle} —{" "}
            <span className="text-violet-600 tabular-nums">฿{total.toFixed(2)}</span>
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <span
              className={`h-2 w-2 rounded-full ${
                terminalStatus === "connected"
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

        {step === "declined" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-center">
              <XCircle className="h-8 w-8 text-destructive" />
              <div className="font-semibold text-destructive">
                {t("storePos.edcDeclined", "DECLINED")}
              </div>
              <div className="text-sm text-muted-foreground">
                {[declineInfo?.code, declineInfo?.message].filter(Boolean).join(" — ")}
              </div>
            </div>
            <Button
              type="button"
              onClick={handleTryAgain}
              className="w-full gap-2 h-12 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {t("storePos.edcTryAgain", "Try again")}
            </Button>
          </div>
        )}

        {step === "form" && (
          <div className="space-y-4">
            {approved && (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-50 p-3 text-center dark:bg-emerald-950/30">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {t("storePos.edcApproved", "APPROVED")}
                </span>
              </div>
            )}

            {bridgeError && (
              <div className="rounded-xl border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {bridgeError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="edc-approval">
                {t("storePos.edcApproval", "Approval code")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edc-approval"
                value={approvalCode}
                onChange={(e) => setApprovalCode(e.target.value)}
                placeholder="AUTH123456"
                autoComplete="off"
                className="font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edc-terminal">
                {t("storePos.edcTerminalRef", "Terminal reference")}{" "}
                <span className="text-muted-foreground text-xs">({t("storePos.optional", "optional")})</span>
              </Label>
              <Input
                id="edc-terminal"
                value={terminalRef}
                onChange={(e) => setTerminalRef(e.target.value)}
                placeholder="TXN12345678"
                autoComplete="off"
                className="font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edc-card">
                {t("storePos.edcMaskedCard", "Masked card")}{" "}
                <span className="text-muted-foreground text-xs">({t("storePos.optional", "optional")})</span>
              </Label>
              <Input
                id="edc-card"
                value={maskedCard}
                onChange={(e) => setMaskedCard(e.target.value)}
                placeholder="**** **** **** 1234"
                autoComplete="off"
                className="font-mono"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleFooterBack}
            disabled={footerBackDisabled}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            {footerBackLabel}
          </Button>
          {step === "form" && (
            <Button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {confirming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("storePos.confirmCharge", "Confirm charge")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
