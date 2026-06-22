import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  UserCircle2,
  Loader2,
  Wallet,
  ArrowLeft,
  Check,
  Banknote,
  QrCode,
  AlertCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

interface CustomerResult {
  id: number;
  name: string;
  customer_code?: string;
  student_code?: string;
  grade?: string;
  photo_url?: string | null;
  wallet_balance?: number;
  card_frozen?: boolean;
  wallet_id?: number;
}

interface TopupSuccessResult {
  wallet_id: number;
  customer_name: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  transaction_id: number;
}

interface TopupIntent {
  ref_code: string;
  wallet_id: number;
  amount: number;
  qr_payload: string;
  status: string;
  created_at: string;
  payment_page_url: string | null;
  payment_form_params: Record<string, string> | null;
  txn_no: string | null;
}

interface IntentStatus {
  status: string;
}

interface WalletBalance {
  id: number;
  balance: number;
}

type PaymentMethod = "cash" | "bay_qr";
type QrStatus = "waiting" | "confirmed" | "cancelled" | "timeout";

interface CashierTopupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (result: TopupSuccessResult) => void;
}

type ModalStep = "search" | "topup" | "qr" | "success";

export function CashierTopupModal({
  open,
  onOpenChange,
  onSuccess,
}: CashierTopupModalProps) {
  const { t } = useTranslation();

  const [step, setStep] = useState<ModalStep>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);

  const [topupResult, setTopupResult] = useState<TopupSuccessResult | null>(null);
  const [intent, setIntent] = useState<TopupIntent | null>(null);
  const [qrStatus, setQrStatus] = useState<QrStatus>("waiting");
  const [confirming, setConfirming] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep("search");
      setQuery("");
      setResults([]);
      setError(null);
      setSelectedCustomer(null);
      setAmount("");
      setNotes("");
      setPaymentMethod("cash");
      setTopupResult(null);
      setIntent(null);
      setQrStatus("waiting");
    }
  }, [open]);

  // Debounced search
  const searchCustomers = useCallback(async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CustomerResult[]>(
        `/customers/search?q=${encodeURIComponent(q)}&limit=10`
      );
      setResults(data);
      if (data.length === 0) {
        setError(t("topup.noResults", "No customers found"));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : t("topup.searchError", "Search failed"));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (step === "search") {
        searchCustomers(query);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchCustomers, step]);

  const handleSelectCustomer = (customer: CustomerResult) => {
    setSelectedCustomer(customer);
    setStep("topup");
  };

  const handleBack = () => {
    if (step === "topup") {
      setStep("search");
      setAmount("");
      setNotes("");
    } else if (step === "qr") {
      setStep("topup");
      setIntent(null);
      setQrStatus("waiting");
    } else if (step === "success") {
      setStep("search");
      setSelectedCustomer(null);
      setAmount("");
      setNotes("");
      setTopupResult(null);
      setIntent(null);
      setQrStatus("waiting");
    }
  };

  const handleSubmitTopup = async () => {
    if (!selectedCustomer || !selectedCustomer.wallet_id) {
      toast.error(t("topup.noWallet", "Customer has no wallet"));
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 100 || amountNum > 50000) {
      toast.error(t("topup.invalidAmount", "Amount must be between ฿100 and ฿50,000"));
      return;
    }

    setSubmitting(true);
    try {
      if (paymentMethod === "bay_qr") {
        const resp = await api.post<TopupIntent>(
          `/wallets/${selectedCustomer.wallet_id}/topup`,
          {
            amount: amountNum,
            payment_method: "bay_qr",
            notes: notes.trim() || null,
          }
        );
        setIntent(resp);
        setQrStatus("waiting");
        setStep("qr");
      } else {
        const result = await api.post<TopupSuccessResult>(
          `/wallets/${selectedCustomer.wallet_id}/cashier-topup`,
          {
            amount: amountNum,
            notes: notes.trim() || null,
          }
        );

        setTopupResult(result);
        setStep("success");
        onSuccess?.(result);
        toast.success(t("topup.success", "Top-up successful"));
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : t("topup.failed", "Top-up failed");
      toast.error(paymentMethod === "bay_qr" ? t("topup.qrCreateFailed", "Failed to create QR") : msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Poll BAY QR status while waiting
  useEffect(() => {
    if (step !== "qr" || !intent) return;
    let cancelled = false;
    const MAX_WAIT_MS = 15 * 60 * 1000;
    const POLL_INTERVAL_MS = 3_000;
    const startTime = Date.now();
    const refCode = intent.ref_code;
    const walletId = intent.wallet_id;
    const customerName = selectedCustomer?.name ?? "";
    const intentAmount = intent.amount;

    async function poll() {
      while (Date.now() - startTime < MAX_WAIT_MS) {
        if (cancelled) return;
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled) return;
        try {
          const s = await api.get<IntentStatus>(`/wallets/topup/${refCode}/status`);
          if (s.status === "confirmed") {
            if (cancelled) return;
            setQrStatus("confirmed");
            try {
              const wallet = await api.get<WalletBalance>(`/wallets/${walletId}`);
              const balanceAfter = wallet.balance;
              const balanceBefore = balanceAfter - intentAmount;
              const successResult: TopupSuccessResult = {
                wallet_id: walletId,
                customer_name: customerName,
                amount: intentAmount,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                transaction_id: 0,
              };
              if (cancelled) return;
              setTopupResult(successResult);
              setStep("success");
              onSuccess?.(successResult);
            } catch {
              // Wallet fetch failed — still surface success
              const successResult: TopupSuccessResult = {
                wallet_id: walletId,
                customer_name: customerName,
                amount: intentAmount,
                balance_before: selectedCustomer?.wallet_balance ?? 0,
                balance_after: (selectedCustomer?.wallet_balance ?? 0) + intentAmount,
                transaction_id: 0,
              };
              if (cancelled) return;
              setTopupResult(successResult);
              setStep("success");
              onSuccess?.(successResult);
            }
            toast.success(t("topup.success", "Top-up successful"));
            return;
          }
          if (s.status === "cancelled") {
            if (cancelled) return;
            setQrStatus("cancelled");
            return;
          }
        } catch { /* ignore poll errors */ }
      }
      if (!cancelled) setQrStatus("timeout");
    }
    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, intent?.ref_code]);

  const handleCancelQr = () => {
    setIntent(null);
    setQrStatus("waiting");
    setStep("topup");
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  // Quick amount buttons
  const quickAmounts = [500, 1000, 2000, 5000, 10000, 20000, 50000];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-500" />
            {t("topup.title", "Top-up")}
            {step === "qr" && (
              <Badge variant="secondary" className="ml-1">
                {t("topup.methodBayQr", "QR Code")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {step === "search" && (
          <div className="space-y-4">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("topup.searchPlaceholder", "Search by name or student code...")}
                className="pl-9"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {t("topup.searchHint", "Type at least 2 characters to search")}
            </p>

            {/* Results list */}
            {results.length > 0 && (
              <div className="max-h-80 overflow-y-auto space-y-2">
                {results.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => handleSelectCustomer(customer)}
                    disabled={customer.card_frozen || !customer.wallet_id}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl border p-3 text-left transition",
                      customer.card_frozen || !customer.wallet_id
                        ? "border-red-200 bg-red-50 opacity-60 cursor-not-allowed"
                        : "border-border bg-card hover:border-emerald-400 hover:bg-emerald-50/50"
                    )}
                  >
                    {/* Photo */}
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted flex items-center justify-center">
                      {customer.photo_url ? (
                        <img
                          src={customer.photo_url}
                          alt={customer.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <UserCircle2 className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm truncate">
                          {customer.name}
                        </span>
                        {customer.grade && (
                          <Badge variant="secondary" className="h-4 text-[10px] px-1">
                            Grade {customer.grade}
                          </Badge>
                        )}
                        {customer.card_frozen && (
                          <Badge variant="destructive" className="h-4 text-[10px] px-1">
                            Frozen
                          </Badge>
                        )}
                        {!customer.wallet_id && (
                          <Badge variant="outline" className="h-4 text-[10px] px-1">
                            No Wallet
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {customer.student_code ?? customer.customer_code}
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          "text-sm font-bold tabular-nums",
                          (customer.wallet_balance ?? 0) < 0
                            ? "text-destructive"
                            : "text-foreground"
                        )}
                      >
                        ฿{(customer.wallet_balance ?? 0).toFixed(2)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Error message */}
            {error && !loading && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                {error}
              </div>
            )}
          </div>
        )}

        {step === "topup" && selectedCustomer && (
          <div className="space-y-4">
            {/* Back button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="mb-2 -ml-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t("common.back", "Back")}
            </Button>

            {/* Customer card */}
            <div className="flex gap-4 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-emerald-100 ring-2 ring-emerald-300">
                {selectedCustomer.photo_url ? (
                  <img
                    src={selectedCustomer.photo_url}
                    alt={selectedCustomer.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-emerald-400">
                    <UserCircle2 className="h-12 w-12" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold truncate">
                  {selectedCustomer.name}
                </div>
                <div className="text-sm text-muted-foreground">
                  {selectedCustomer.student_code ?? selectedCustomer.customer_code}
                  {selectedCustomer.grade && ` · Grade ${selectedCustomer.grade}`}
                </div>
                <div className="mt-1 text-base font-bold tabular-nums">
                  {t("topup.currentBalance", "Current Balance")}:{" "}
                  <span
                    className={cn(
                      (selectedCustomer.wallet_balance ?? 0) < 0
                        ? "text-destructive"
                        : "text-emerald-600"
                    )}
                  >
                    ฿{(selectedCustomer.wallet_balance ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment method picker */}
            <div className="space-y-2">
              <Label>{t("topup.methodLabel", "Payment Method")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("cash")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-all",
                    paymentMethod === "cash"
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm"
                      : "border-gray-200 bg-white text-gray-500 hover:border-emerald-300 hover:text-emerald-700",
                  )}
                >
                  <Banknote className="h-4 w-4" />
                  {t("topup.methodCash", "Cash")}
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("bay_qr")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-all",
                    paymentMethod === "bay_qr"
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm"
                      : "border-gray-200 bg-white text-gray-500 hover:border-emerald-300 hover:text-emerald-700",
                  )}
                >
                  <QrCode className="h-4 w-4" />
                  {t("topup.methodBayQr", "QR Code")}
                </button>
              </div>
            </div>

            {/* Amount input */}
            <div className="space-y-2">
              <Label>{t("topup.amount", "Top-up Amount")} (THB)</Label>
              <div className="relative">
                <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  min="100"
                  max="50000"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="pl-9 text-lg font-bold"
                  autoFocus
                />
              </div>

              {/* Quick amount buttons */}
              <div className="flex gap-2 flex-wrap">
                {quickAmounts.map((qa) => (
                  <Button
                    key={qa}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(String(qa))}
                    className={cn(
                      "flex-1 min-w-16",
                      amount === String(qa) && "border-emerald-500 bg-emerald-50"
                    )}
                  >
                    ฿{qa}
                  </Button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>{t("topup.notes", "Notes")} ({t("common.optional", "Optional")})</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("topup.notesPlaceholder", "e.g., Received cash from parent")}
                rows={2}
              />
            </div>

            {/* Preview new balance */}
            {amount && parseFloat(amount) > 0 && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("topup.currentBalance", "Current Balance")}:</span>
                  <span className="tabular-nums">฿{(selectedCustomer.wallet_balance ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-emerald-600">
                  <span>+ {t("topup.topupAmount", "Top-up")}:</span>
                  <span className="tabular-nums">฿{parseFloat(amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold border-t mt-2 pt-2">
                  <span>{t("topup.newBalance", "New Balance")}:</span>
                  <span className="tabular-nums text-emerald-600">
                    ฿{((selectedCustomer.wallet_balance ?? 0) + parseFloat(amount)).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* Submit button */}
            <Button
              onClick={handleSubmitTopup}
              disabled={submitting || !amount || parseFloat(amount) < 100 || parseFloat(amount) > 50000}
              className="w-full h-12 text-base font-bold bg-emerald-500 hover:bg-emerald-600"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  {t("topup.processing", "Processing...")}
                </>
              ) : (
                <>
                  {paymentMethod === "bay_qr" ? (
                    <QrCode className="h-5 w-5 mr-2" />
                  ) : (
                    <Wallet className="h-5 w-5 mr-2" />
                  )}
                  {t("topup.confirmTopup", "Confirm Top-up")}
                  {amount && parseFloat(amount) > 0 && ` ฿${parseFloat(amount).toLocaleString()}`}
                </>
              )}
            </Button>
          </div>
        )}

        {step === "qr" && intent && selectedCustomer && (
          <div className="space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="mb-2 -ml-2"
              disabled={qrStatus === "waiting" && confirming}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t("common.back", "Back")}
            </Button>

            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">
                {selectedCustomer.name}
              </p>
              <p className="text-2xl font-bold tabular-nums text-emerald-600">
                ฿{intent.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("topup.scanQr", "Ask customer to scan this QR with their banking app")}
              </p>
            </div>

            <div className="flex justify-center rounded-xl bg-white p-4 border border-emerald-100 shadow-inner">
              <QRCodeSVG value={intent.qr_payload} size={220} />
            </div>

            <div className="space-y-1 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-emerald-700">{t("topup.qrRefCode", "Reference")}</span>
                <span className="font-mono text-emerald-900">{intent.ref_code}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-emerald-700">{t("topup.amount", "Top-up Amount")}</span>
                <span className="font-semibold text-emerald-900 tabular-nums">
                  ฿{intent.amount.toFixed(2)}
                </span>
              </div>
            </div>

            {qrStatus === "waiting" && (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>{t("topup.waitingPayment", "Waiting for payment...")}</span>
              </div>
            )}
            {qrStatus === "cancelled" && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t("topup.qrCancelled", "Payment cancelled")}</span>
              </div>
            )}
            {qrStatus === "timeout" && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t("topup.qrTimedOut", "QR timed out")}</span>
              </div>
            )}
            {qrStatus === "waiting" && (
              <p className="text-xs text-center text-muted-foreground">
                {t("topup.timeoutWarning", "QR expires in 15 minutes")}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-11"
                onClick={handleCancelQr}
                disabled={confirming}
              >
                {t("topup.cancel", "Cancel")}
              </Button>
            </div>
          </div>
        )}

        {step === "success" && topupResult && (
          <div className="space-y-4 text-center">
            {/* Success icon */}
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="h-8 w-8 text-emerald-600" />
            </div>

            <div>
              <h3 className="text-xl font-bold text-emerald-600">
                {t("topup.successTitle", "Top-up Successful!")}
              </h3>
              <p className="text-muted-foreground mt-1">
                {topupResult.customer_name}
              </p>
            </div>

            {/* Transaction details */}
            <div className="rounded-xl bg-muted p-4 space-y-2 text-sm text-left">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("topup.amount", "Amount")}:</span>
                <span className="font-bold text-emerald-600 tabular-nums">
                  +฿{topupResult.amount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("topup.balanceBefore", "Balance Before")}:</span>
                <span className="tabular-nums">฿{topupResult.balance_before.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>{t("topup.balanceAfter", "Balance After")}:</span>
                <span className="text-emerald-600 tabular-nums">
                  ฿{topupResult.balance_after.toFixed(2)}
                </span>
              </div>
              {topupResult.transaction_id > 0 && (
                <div className="flex justify-between text-xs pt-2 border-t">
                  <span className="text-muted-foreground">Transaction ID:</span>
                  <span className="font-mono">{topupResult.transaction_id}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleBack}
              >
                {t("topup.topupAnother", "Top-up Another")}
              </Button>
              <Button
                className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                onClick={handleClose}
              >
                {t("common.done", "Done")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
