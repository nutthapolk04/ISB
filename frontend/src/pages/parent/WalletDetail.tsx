import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { formatCurrency as formatTHB } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { InfoCallout } from "@/components/InfoCallout";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getRoleStyle, getRoleLabel } from "@/lib/roleStyles";
import { BackButton } from "@/components/BackButton";
import { ReceiptDetailDialog } from "@/components/ReceiptDetailDialog";
import { TopupDetailDialog, type TopupTransaction } from "@/components/TopupDetailDialog";
import { Wallet as WalletIcon, CheckCircle2, AlertCircle, History, Loader2, QrCode, CreditCard } from "lucide-react";
import { KrungsriGatewayDialog } from "@/components/KrungsriGatewayDialog";
import { storeBayIntent } from "@/pages/payment/MockBayGateway";

// Demo May-2026 — Topup channel limits & fee.
// Fee is UI-only for now (not persisted on payment_intents) — wallet still
// credits the face amount; the 3% is shown as the cost the parent pays the
// processor.
const MAX_TOPUP_THB = 50_000;
const MAX_WALLET_BALANCE = 50_000;
const CREDIT_FEE_RATE = 0.03;

interface StudentProfile {
  id: number;
  name: string;
  student_code?: string | null;
  grade?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  card_frozen: boolean;
  is_own_user_wallet?: boolean;
  role?: string | null;
}

interface OwnWalletResponse {
  id: number;
  owner_type: "user" | "customer";
  user_id: number | null;
  customer_id: number | null;
  balance: number;
  name: string | null;
  username: string | null;
  role: string | null;
  photo_url: string | null;
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


export default function WalletDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("100");
  const [paymentMethod, setPaymentMethod] = useState<"qr_promptpay" | "credit_card">("qr_promptpay");
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [intent, setIntent] = useState<TopupIntent | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrStatus, setQrStatus] = useState<"waiting" | "confirmed" | "cancelled" | "timeout">("waiting");
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [pendingAmt, setPendingAmt] = useState(0);
  const [openReceiptId, setOpenReceiptId] = useState<number | null>(null);
  const [openTopupTx, setOpenTopupTx] = useState<TopupTransaction | null>(null);

  const amtNumber = parseFloat(amount) || 0;
  const fee = paymentMethod === "credit_card"
    ? Math.round(amtNumber * CREDIT_FEE_RATE * 100) / 100
    : 0;
  const totalCharged = amtNumber + fee;

  const effectiveId = customerId ?? "own";

  const loadData = async () => {
    if (!effectiveId) return;
    setLoadError(null);
    try {
      if (effectiveId === "own") {
        const w = await api.get<OwnWalletResponse>("/wallets/me");
        if (!w || w.owner_type !== "user") {
          throw new Error(t("parent.wallet.walletNotCreated"));
        }
        const p: StudentProfile = {
          id: w.user_id ?? 0,
          name: w.name ?? w.username ?? "",
          student_code: null,
          grade: null,
          wallet_id: w.id,
          wallet_balance: w.balance,
          card_frozen: false,
          is_own_user_wallet: true,
          role: w.role,
        };
        setProfile(p);
        return;
      }
      if (effectiveId.startsWith("wallet-")) {
        const walletId = parseInt(effectiveId.slice(7), 10);
        const w = await api.get<OwnWalletResponse>(`/wallets/${walletId}`);
        const p: StudentProfile = {
          id: w.user_id ?? walletId,
          name: w.name ?? w.username ?? "",
          student_code: null,
          grade: null,
          wallet_id: w.id,
          wallet_balance: w.balance,
          card_frozen: false,
          is_own_user_wallet: true,
          role: w.role,
        };
        setProfile(p);
        return;
      }
      const p = await api.get<StudentProfile>(`/customers/${effectiveId}`);
      setProfile(p);
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : (e instanceof Error ? e.message : "Unknown error");
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [effectiveId]);

  useEffect(() => {
    if (!qrOpen || !intent) return;
    let cancelled = false;
    const MAX_WAIT_MS = 10 * 60 * 1000;
    const POLL_INTERVAL_MS = 2_000;
    const startTime = Date.now();
    async function poll() {
      while (Date.now() - startTime < MAX_WAIT_MS) {
        if (cancelled) return;
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled) return;
        try {
          const s = await api.get<{ status: string }>(`/wallets/topup/${intent!.ref_code}/status`);
          if (s.status === "confirmed") {
            if (cancelled) return;
            setQrStatus("confirmed");
            await loadData();
            toast({ title: t("parent.wallet.topupSuccess"), description: t("parent.wallet.topupSuccessQrDesc", { amount: formatTHB(intent!.amount) }) });
            setTimeout(() => { if (!cancelled) { setQrOpen(false); setIntent(null); setQrStatus("waiting"); } }, 1500);
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
  }, [qrOpen, intent?.ref_code]);


  const handleCreateTopup = async () => {
    if (!profile?.wallet_id) return;
    const amt = parseFloat(amount);
    if (!amt || amt < 100 || amt > MAX_TOPUP_THB) {
      toast({ title: t("parent.wallet.invalidAmount"), variant: "destructive" });
      return;
    }
    if (amt > MAX_TOPUP_THB) {
      toast({ title: t("parent.wallet.maxAmount"), variant: "destructive" });
      return;
    }
    const currentBalance = profile?.wallet_balance ?? 0;
    if (currentBalance + amt > MAX_WALLET_BALANCE) {
      toast({
        title: t("parent.wallet.balanceCapTitle", "Balance limit exceeded"),
        description: t("parent.wallet.balanceCapDesc", {
          max: formatTHB(MAX_WALLET_BALANCE),
          current: formatTHB(currentBalance),
          available: formatTHB(Math.max(0, MAX_WALLET_BALANCE - currentBalance)),
          defaultValue: "Maximum wallet balance is {{max}}. Current balance: {{current}}. You can top up at most {{available}}.",
        }),
        variant: "destructive",
      });
      return;
    }

    if (paymentMethod === "credit_card") {
      // Real BAY pattern: register the payment intent with PYMT, then
      // redirect the customer's browser to the hosted bank page. Here we
      // create the intent against our existing topup API and bounce to
      // the in-app mock that mimics the hosted form.
      setCreating(true);
      try {
        const resp = await api.post<TopupIntent>(
          `/wallets/${profile.wallet_id}/topup`,
          { amount: amt, payment_method: "bay_easypay" },
        );
        if (resp.payment_page_url && resp.payment_form_params) {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = resp.payment_page_url;
          Object.entries(resp.payment_form_params).forEach(([k, v]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = k;
            input.value = String(v);
            form.appendChild(input);
          });
          document.body.appendChild(form);
          form.submit();
        } else {
          const feeAmt = Math.round(amt * CREDIT_FEE_RATE * 100) / 100;
          storeBayIntent({
            orderRef: resp.ref_code,
            walletId: profile.wallet_id,
            amount: amt,
            fee: feeAmt,
            returnUrl: window.location.pathname + window.location.search,
            merchantName: "ISB SCHOOL SHOP",
            productName: "Wallet Top-up",
          });
          navigate(`/payment/bay/order?ref=${encodeURIComponent(resp.ref_code)}`);
        }
      } catch (e) {
        toast({
          title: t("parent.wallet.topupCreateFailed"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setCreating(false);
      }
      return;
    }

    setCreating(true);
    try {
      const resp = await api.post<TopupIntent>(
        `/wallets/${profile.wallet_id}/topup`,
        { amount: amt, payment_method: "bay_qr" },
      );
      setIntent(resp);
      setQrStatus("waiting");
      setQrOpen(true);
    } catch (e) {
      toast({
        title: t("parent.wallet.topupCreateFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!intent) return;
    setConfirming(true);
    try {
      await api.post(`/wallets/topup/${intent.ref_code}/parent-confirm`, {});
      setQrOpen(false);
      setIntent(null);
      await loadData();
      toast({
        title: t("parent.wallet.topupSuccess"),
        description: t("parent.wallet.topupSuccessQrDesc", { amount: formatTHB(intent.amount) }),
      });
    } catch (e) {
      toast({
        title: t("parent.wallet.confirmFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
    }
  };

  const handleGatewaySuccess = async () => {
    setGatewayOpen(false);
    if (!profile?.wallet_id) return;
    setCreating(true);
    try {
      const resp = await api.post<TopupIntent>(
        `/wallets/${profile.wallet_id}/topup`,
        { amount: pendingAmt, payment_method: "credit_card" },
      );
      await api.post(`/wallets/topup/${resp.ref_code}/parent-confirm`, {});
      await loadData();
      toast({
        title: t("parent.wallet.topupSuccess"),
        description: t("parent.wallet.topupSuccessDesc", {
          amount: formatTHB(pendingAmt),
          fee: formatTHB(Math.round(pendingAmt * CREDIT_FEE_RATE * 100) / 100),
        }),
      });
    } catch (e) {
      toast({
        title: t("parent.wallet.topupFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="page-shell text-muted-foreground">{t("parent.common.loading")}</div>;
  }

  if (!profile) {
    return (
      <div className="page-shell">
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-destructive font-medium">{t("parent.wallet.walletLoadFailed")}</p>
          {loadError && <p className="text-sm text-muted-foreground max-w-sm">{loadError}</p>}
          <Button variant="outline" onClick={loadData}>{t("parent.wallet.walletRetry")}</Button>
        </div>
      </div>
    );
  }

  // Determine role for color theming:
  // - own wallet (effectiveId === "own") → logged-in user's role
  // - wallet-* prefix → the wallet record has role from API (stored in profile.role)
  // - child customer (numeric ID) → "student"
  const displayRole: string = effectiveId === "own" || effectiveId.startsWith("wallet-")
    ? (profile.role ?? user?.role ?? "staff")
    : "student";

  const headerStyle = getRoleStyle(displayRole);

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">

        {/* Header banner with Back button inside */}
        <div className="rounded-2xl p-5 shadow-md relative" style={headerStyle}>
          <div className="absolute top-3 right-3 z-10">
            <BackButton to={user?.role === "parent" ? "/parent/dashboard" : "/"} />
          </div>
          <div className="flex items-start gap-3 pr-24">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-white shadow-inner shrink-0">
              <WalletIcon className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white drop-shadow-sm">
                {profile.is_own_user_wallet
                  ? t("parent.wallet.myWalletLabel", { name: profile.name })
                  : profile.name}
              </h1>
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {/* Role badge pill */}
                <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium text-white">
                  {getRoleLabel(displayRole)}
                </span>
                {!profile.is_own_user_wallet && profile.student_code && (
                  <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium text-white">
                    {profile.student_code}
                  </span>
                )}
                {!profile.is_own_user_wallet && profile.grade && (
                  <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium text-white">
                    {profile.grade}
                  </span>
                )}
                {profile.card_frozen && (
                  <span className="inline-flex items-center rounded-full bg-red-500/80 px-2 py-0.5 text-xs font-medium text-white">
                    {t("parent.wallet.cardFrozen")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Balance card */}
        <Card className="overflow-hidden border-0 shadow-lg">
          <div className="p-6 text-center" style={headerStyle}>
            <p className="text-sm font-medium text-white/80">{t("parent.wallet.balance")}</p>
            <p className="text-4xl sm:text-5xl font-extrabold text-white mt-1 tabular-nums drop-shadow-sm">
              {formatTHB(profile.wallet_balance ?? 0)}
            </p>
          </div>
        </Card>

        {/* Top-up card (always visible) */}
        <Card className="overflow-hidden border border-amber-100 shadow-md">
            <CardHeader className="bg-amber-50/60 border-b border-amber-100 pb-4">
              <CardTitle className="text-lg text-amber-900 flex items-center gap-2">
                <WalletIcon className="h-5 w-5 text-amber-600" />
                {t("parent.wallet.topUpTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <InfoCallout
                id="wallet.topupFlow"
                variant="tip"
                title={t("parent.wallet.topupFlowTitle")}
              >
                <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                  <div>
                    <p className="font-semibold mb-1">PromptPay</p>
                    <ol className="space-y-1 list-decimal list-inside leading-snug">
                      <li>{t("parent.wallet.topupStep.enterAmount", "Enter amount")}</li>
                      <li>{t("parent.wallet.topupStep.tapTopup", "Tap \"Top up\" → scan QR")}</li>
                      <li>{t("parent.wallet.topupStep.confirmTransfer", "Tap \"Confirm transfer\"")}</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Credit / Debit</p>
                    <ol className="space-y-1 list-decimal list-inside leading-snug">
                      <li>{t("parent.wallet.topupStep.enterAmount", "Enter amount")}</li>
                      <li>{t("parent.wallet.topupStep.tapTopupCard", "Tap \"Top up\"")}</li>
                      <li>{t("parent.wallet.topupStep.bankProcess", "Bank processes 2–3s → credited instantly")} <span className="opacity-70">(3% {t("parent.wallet.topupStep.fee", "fee")})</span></li>
                    </ol>
                  </div>
                </div>
              </InfoCallout>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-700">{t("parent.wallet.paymentChannel")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("qr_promptpay")}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-all",
                      paymentMethod === "qr_promptpay"
                        ? "border-orange-400 bg-gradient-to-br from-orange-50 to-amber-50 text-orange-700 shadow-sm"
                        : "border-gray-200 bg-white text-gray-500 hover:border-amber-300 hover:text-amber-700",
                    )}
                  >
                    <QrCode className="h-4 w-4" />
                    PromptPay QR
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("credit_card")}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all",
                      paymentMethod === "credit_card"
                        ? "border-orange-400 bg-gradient-to-br from-orange-50 to-amber-50 text-orange-700 shadow-sm"
                        : "border-gray-200 bg-white text-gray-500 hover:border-amber-300 hover:text-amber-700",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      {t("parent.wallet.creditCard")}
                    </span>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600 ring-1 ring-red-300">
                      {t("parent.wallet.creditFee")}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="amount" className="text-sm font-medium text-gray-700">{t("parent.wallet.amountLabel")}</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="100"
                    max={MAX_TOPUP_THB}
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="100"
                    className="h-11 border-amber-200 focus-visible:ring-amber-400"
                  />
                </div>
                <Button
                  onClick={handleCreateTopup}
                  disabled={creating}
                  className="h-11 sm:h-10 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold shadow-md hover:from-orange-600 hover:to-amber-600 border-0"
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      {paymentMethod === "credit_card"
                        ? t("parent.wallet.processingBank")
                        : t("parent.wallet.creatingQr")}
                    </>
                  ) : (
                    t("parent.wallet.topUpBtn")
                  )}
                </Button>
              </div>

              {paymentMethod === "credit_card" && amtNumber > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-amber-700">{t("parent.wallet.walletAmount")}</span>
                    <span className="tabular-nums font-medium">{formatTHB(amtNumber)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-700">{t("parent.wallet.feeLabel")}</span>
                    <span className="tabular-nums font-medium">{formatTHB(fee)}</span>
                  </div>
                  <div className="flex justify-between border-t border-amber-200 pt-1.5 font-semibold text-amber-900">
                    <span>{t("parent.wallet.totalCharged")}</span>
                    <span className="tabular-nums">{formatTHB(totalCharged)}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {[500, 1000, 2000, 5000, 10000, 20000, 50000].map((v) => (
                  <Button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    className={cn(
                      "h-10 text-sm tabular-nums font-semibold transition-all",
                      String(v) === amount
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md border-0 hover:from-orange-600 hover:to-amber-600"
                        : "bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300",
                    )}
                  >
                    ฿{v.toLocaleString()}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

        <KrungsriGatewayDialog
          open={gatewayOpen}
          amount={pendingAmt}
          fee={Math.round(pendingAmt * CREDIT_FEE_RATE * 100) / 100}
          onSuccess={handleGatewaySuccess}
          onCancel={() => setGatewayOpen(false)}
        />

        <Dialog open={qrOpen} onOpenChange={(open) => {
          if (!open) { setQrOpen(false); setIntent(null); setQrStatus("waiting"); }
        }}>
          <DialogContent className="max-w-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("parent.wallet.qrTitle")}</DialogTitle>
              <DialogDescription>
                {t("parent.wallet.qrDesc")}
              </DialogDescription>
            </DialogHeader>

            {intent && (
              <div className="space-y-4">
                <div className="flex justify-center rounded-xl bg-white p-4 sm:p-6 border border-amber-100 shadow-inner">
                  <QRCodeSVG value={intent.qr_payload} size={200} className="sm:!h-[220px] sm:!w-[220px]" />
                </div>
                <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-amber-700">{t("parent.wallet.qrAmount")}</span>
                    <span className="font-semibold text-amber-900">{formatTHB(intent.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-700">{t("parent.wallet.qrRefCode")}</span>
                    <span className="font-mono text-amber-900">{intent.ref_code}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-amber-700">{t("parent.wallet.qrStatus")}</span>
                    {qrStatus === "waiting" && (
                      <Badge className="gap-1 bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">
                        <Loader2 className="h-3 w-3 animate-spin" /> {t("parent.wallet.qrWaiting")}
                      </Badge>
                    )}
                    {qrStatus === "confirmed" && (
                      <Badge className="gap-1 bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-100">
                        <CheckCircle2 className="h-3 w-3" /> {t("parent.wallet.qrConfirmed", "Confirmed")}
                      </Badge>
                    )}
                    {(qrStatus === "cancelled" || qrStatus === "timeout") && (
                      <Badge className="gap-1 bg-red-100 text-red-800 border border-red-300 hover:bg-red-100">
                        <AlertCircle className="h-3 w-3" />
                        {qrStatus === "timeout" ? t("parent.wallet.qrTimeout", "Timed out") : t("parent.wallet.qrCancelled", "Cancelled")}
                      </Badge>
                    )}
                  </div>
                </div>
                {qrStatus === "waiting" && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                    <span>{t("parent.wallet.qrConfirmNote")}</span>
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => { setQrOpen(false); setIntent(null); setQrStatus("waiting"); }}
                className="h-11 sm:h-10 border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                {t("parent.wallet.close")}
              </Button>
              {intent && !intent.txn_no && qrStatus === "waiting" && (
                <Button
                  onClick={handleConfirmTransfer}
                  disabled={confirming}
                  className="h-11 sm:h-10 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold hover:from-orange-600 hover:to-amber-600 border-0 shadow-md"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  {confirming ? t("parent.wallet.confirming") : t("parent.wallet.confirmTransfer")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ReceiptDetailDialog
          receiptId={openReceiptId}
          onClose={() => setOpenReceiptId(null)}
        />
        <TopupDetailDialog
          transaction={openTopupTx}
          onClose={() => setOpenTopupTx(null)}
        />
      </div>
    </div>
  );
}
