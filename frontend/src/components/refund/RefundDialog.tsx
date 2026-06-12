/**
 * RefundDialog — Graduation Refund (T14)
 *
 * Two-step flow inside a single Dialog:
 *   1. "form"    — operator enters amount, method, optional notes
 *   2. "confirm" — final confirmation step showing summary before posting
 *
 * The dialog is fully controlled by the parent via `open` + `onClose`.
 * On success the underlying React Query mutation already invalidates
 * `refundKeys.candidates()`, so the parent list will auto-refresh.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Wallet } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";
import {
  useCreateRefund,
  type RefundCandidate,
  type RefundMethod,
} from "@/hooks/useRefund";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RefundDialogProps {
  candidate: RefundCandidate | null;
  open: boolean;
  onClose: () => void;
}

type Step = "form" | "confirm";

const REFUND_METHODS: RefundMethod[] = ["CASH", "BANK_TRANSFER", "CHEQUE"];
const NOTES_MAX = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatTHB = (value: number): string =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

const isValidMethod = (v: string): v is RefundMethod =>
  (REFUND_METHODS as string[]).includes(v);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RefundDialog({ candidate, open, onClose }: RefundDialogProps) {
  const { t } = useTranslation();
  const createRefund = useCreateRefund();

  const [step, setStep] = useState<Step>("form");
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<RefundMethod | "">("");
  const [notes, setNotes] = useState<string>("");

  // Reset form whenever a new candidate is opened.
  useEffect(() => {
    if (open && candidate) {
      setStep("form");
      setAmount(candidate.wallet_balance.toFixed(2));
      setMethod("");
      setNotes("");
    }
  }, [open, candidate]);

  if (!candidate) return null;

  const balance = candidate.wallet_balance;
  const parsedAmount = Number.parseFloat(amount);
  const amountValid =
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= balance;
  const methodValid = method !== "" && isValidMethod(method);
  const notesValid = notes.length <= NOTES_MAX;
  const formValid = amountValid && methodValid && notesValid;
  const pending = createRefund.isPending;

  const customerLine = candidate.student_code
    ? `${candidate.name} (${candidate.student_code})`
    : candidate.name;

  // -------- Handlers --------

  const handleOpenChange = (next: boolean) => {
    if (pending) return; // lock during submission
    if (!next) onClose();
  };

  const handleProceed = () => {
    if (!formValid) return;
    setStep("confirm");
  };

  const handleBackToForm = () => {
    if (pending) return;
    setStep("form");
  };

  const handleConfirm = () => {
    if (!formValid || !methodValid) return;

    createRefund.mutate(
      {
        customerId: candidate.id,
        payload: {
          amount: parsedAmount,
          method: method as RefundMethod,
          notes: notes.trim() ? notes.trim() : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(t("refund.toast.success"));
          onClose();
        },
        onError: (err) => {
          const detail = err instanceof ApiError ? err.detail : "";
          toast.error(
            detail
              ? `${t("refund.toast.error")}: ${detail}`
              : t("refund.toast.error"),
          );
          setStep("form");
        },
      },
    );
  };

  // -------- Render: Step 1 (form) --------

  const renderForm = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          {t("refund.dialog.title")}
        </DialogTitle>
        <DialogDescription>
          {t("refund.dialog.description", { defaultValue: "" })}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {/* Customer (read-only) */}
        <div className="rounded-lg border bg-muted/40 divide-y text-sm">
          <div className="flex justify-between px-3 py-2">
            <span className="text-muted-foreground">
              {t("refund.dialog.customerLabel")}
            </span>
            <span className="font-medium text-right">{customerLine}</span>
          </div>
          <div className="flex justify-between px-3 py-2">
            <span className="text-muted-foreground">
              {t("refund.dialog.balanceLabel")}
            </span>
            <span className="font-bold tabular-nums text-primary">
              {formatTHB(balance)}
            </span>
          </div>
        </div>

        {/* Amount */}
        <div className="space-y-1.5">
          <Label htmlFor="refund-amount" className="text-sm font-semibold">
            {t("refund.dialog.amount")}
            <span className="text-destructive ml-1">*</span>
          </Label>
          <Input
            id="refund-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0.01}
            max={balance}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            className={
              amount !== "" && !amountValid
                ? "border-destructive focus-visible:ring-destructive"
                : ""
            }
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {t("refund.dialog.amountHelp")}
          </p>
          {amount !== "" && !amountValid && (
            <p className="text-xs text-destructive">
              {t("refund.dialog.amountInvalid", {
                defaultValue: "Amount must be between 0.01 and the wallet balance.",
              })}
            </p>
          )}
        </div>

        {/* Method */}
        <div className="space-y-1.5">
          <Label htmlFor="refund-method" className="text-sm font-semibold">
            {t("refund.dialog.methodLabel")}
            <span className="text-destructive ml-1">*</span>
          </Label>
          <Select
            value={method}
            onValueChange={(v) => {
              if (isValidMethod(v)) setMethod(v);
            }}
            disabled={pending}
          >
            <SelectTrigger id="refund-method">
              <SelectValue placeholder={t("refund.dialog.methodPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {REFUND_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`refund.dialog.method.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label htmlFor="refund-notes" className="text-sm font-semibold">
            {t("refund.dialog.notes")}
          </Label>
          <Textarea
            id="refund-notes"
            placeholder={t("refund.dialog.notesPlaceholder")}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            rows={3}
            maxLength={NOTES_MAX}
            disabled={pending}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground text-right tabular-nums">
            {notes.length} / {NOTES_MAX}
          </p>
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={pending}
        >
          {t("refund.dialog.cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleProceed}
          disabled={!formValid || pending}
        >
          {t("refund.dialog.continue", { defaultValue: t("refund.dialog.confirm") })}
        </Button>
      </DialogFooter>
    </>
  );

  // -------- Render: Step 2 (confirm) --------

  const renderConfirm = () => (
    <>
      <DialogHeader>
        <DialogTitle>{t("refund.dialog.title")}</DialogTitle>
        <DialogDescription>
          {t("refund.confirm.message", {
            amount: formatTHB(parsedAmount),
            name: candidate.name,
          })}
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-lg border bg-muted/40 divide-y text-sm">
        <div className="flex justify-between px-3 py-2">
          <span className="text-muted-foreground">
            {t("refund.dialog.customerLabel")}
          </span>
          <span className="font-medium text-right">{customerLine}</span>
        </div>
        <div className="flex justify-between px-3 py-2">
          <span className="text-muted-foreground">
            {t("refund.dialog.amount")}
          </span>
          <span className="font-bold tabular-nums text-primary">
            {formatTHB(parsedAmount)}
          </span>
        </div>
        <div className="flex justify-between px-3 py-2">
          <span className="text-muted-foreground">
            {t("refund.dialog.methodLabel")}
          </span>
          <span className="font-medium">
            {methodValid ? t(`refund.dialog.method.${method}`) : ""}
          </span>
        </div>
        {notes.trim() && (
          <div className="flex justify-between px-3 py-2 gap-3">
            <span className="text-muted-foreground shrink-0">
              {t("refund.dialog.notes")}
            </span>
            <span className="font-medium text-right break-words max-w-[60%]">
              {notes.trim()}
            </span>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleBackToForm}
          disabled={pending}
        >
          {t("refund.dialog.back", { defaultValue: t("refund.dialog.cancel") })}
        </Button>
        <Button type="button" onClick={handleConfirm} disabled={pending || !formValid}>
          {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {pending ? t("refund.dialog.processing") : t("refund.dialog.confirm")}
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {step === "form" ? renderForm() : renderConfirm()}
      </DialogContent>
    </Dialog>
  );
}
