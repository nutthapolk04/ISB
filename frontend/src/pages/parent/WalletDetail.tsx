import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
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
import { ArrowLeft, Wallet as WalletIcon, CheckCircle2, Clock, AlertCircle, History, Loader2, QrCode, CreditCard } from "lucide-react";
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

interface Transaction {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description?: string | null;
  created_at: string;
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

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function WalletDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = searchParams.get("tab") === "history" ? "history" : "topup";
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("100");
  const [paymentMethod, setPaymentMethod] = useState<"qr_promptpay" | "credit_card">("qr_promptpay");
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [intent, setIntent] = useState<TopupIntent | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [pendingAmt, setPendingAmt] = useState(0);

  const locale = i18n.language === "en" ? "en-US" : "th-TH";
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

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
        const txs = await api.get<Transaction[]>(`/wallets/${w.id}/transactions`);
        setTransactions(txs.slice(0, 10));
        return;
      }
      const p = await api.get<StudentProfile>(`/customers/${effectiveId}`);
      setProfile(p);
      if (p.wallet_id) {
        const txs = await api.get<Transaction[]>(`/wallets/${p.wallet_id}/transactions`);
        setTransactions(txs.slice(0, 10));
      }
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


  const handleCreateTopup = async () => {
    if (!profile?.wallet_id) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
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
        { amount: amt, payment_method: "qr_promptpay" },
      );
      setIntent(resp);
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

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">

        {/* Header banner */}
        <div className="rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-400 p-5 shadow-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-white shadow-inner">
                <WalletIcon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white drop-shadow-sm">
                  {profile.is_own_user_wallet
                    ? t("parent.wallet.myWalletLabel", { name: profile.name })
                    : profile.name}
                </h1>
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  {profile.is_own_user_wallet && profile.role && (
                    <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium text-white capitalize">
                      {profile.role}
                    </span>
                  )}
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
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-9 shrink-0 text-white hover:bg-white/20 hover:text-white border border-white/30"
            >
              <Link to={user?.role === "parent" ? "/parent/dashboard" : "/"}>
                <ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}
              </Link>
            </Button>
          </div>
        </div>

        {/* Balance card */}
        <Card className="overflow-hidden border-0 shadow-lg">
          <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-6 text-center">
            <p className="text-sm font-medium text-orange-100">{t("parent.wallet.balance")}</p>
            <p className="text-4xl sm:text-5xl font-extrabold text-white mt-1 tabular-nums drop-shadow-sm">
              {formatTHB(profile.wallet_balance ?? 0)}
            </p>
          </div>
        </Card>

        {/* Tab toggle */}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => setSearchParams({})}
            className={cn(
              "h-10 gap-1.5 font-semibold transition-all whitespace-nowrap",
              activeTab === "topup"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md hover:from-orange-600 hover:to-amber-600 border-0"
                : "bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300",
            )}
          >
            <WalletIcon className="h-4 w-4" />
            {t("parent.wallet.topUpTitle")}
          </Button>
          <Button
            size="sm"
            onClick={() => setSearchParams({ tab: "history" })}
            className={cn(
              "h-10 gap-1.5 font-semibold transition-all whitespace-nowrap",
              activeTab === "history"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md hover:from-orange-600 hover:to-amber-600 border-0"
                : "bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300",
            )}
          >
            <History className="h-4 w-4" />
            {t("parent.wallet.recentTitle")}
          </Button>
        </div>

        {activeTab === "topup" && (
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
                {t("parent.wallet.topupFlowBody")}
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
                    <span className="text-[10px] font-normal opacity-80">{t("parent.wallet.creditFee")}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="amount" className="text-sm font-medium text-gray-700">{t("parent.wallet.amountLabel")}</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="1"
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

              <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
                {[100, 200, 500, 1000].map((v) => (
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
                    ฿{v}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "history" && (
          <Card className="overflow-hidden border border-amber-100 shadow-md">
            <CardHeader className="bg-amber-50/60 border-b border-amber-100 pb-4 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-lg text-amber-900 flex items-center gap-2">
                <History className="h-5 w-5 text-amber-600" />
                {t("parent.wallet.recentTitle")}
              </CardTitle>
              {!profile.is_own_user_wallet && (
                <Button
                  asChild
                  size="sm"
                  className="h-9 shrink-0 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold shadow-sm hover:from-orange-600 hover:to-amber-600 border-0"
                >
                  <Link to={`/parent/transactions/${profile.id}`}>
                    <History className="h-4 w-4 mr-1" /> {t("parent.wallet.viewAll")}
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2 pt-4">
              {transactions.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">{t("parent.wallet.noTransactions")}</p>
              )}
              {transactions.map((tx) => {
                const isCredit = (tx.balance_after ?? 0) >= (tx.balance_before ?? 0);
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-sm hover:bg-amber-50/80 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-gray-800">{tx.description || tx.transaction_type}</p>
                      <p className="text-xs text-amber-700/70 mt-0.5">{formatDate(tx.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "font-bold tabular-nums",
                        isCredit ? "text-emerald-600" : "text-red-500",
                      )}>
                        {isCredit ? "+" : "-"}
                        {formatTHB(Math.abs(tx.amount))}
                      </p>
                      <p className="text-xs text-amber-700/70 mt-0.5">
                        {t("parent.wallet.balanceAfter", { amount: formatTHB(tx.balance_after) })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <KrungsriGatewayDialog
          open={gatewayOpen}
          amount={pendingAmt}
          fee={Math.round(pendingAmt * CREDIT_FEE_RATE * 100) / 100}
          onSuccess={handleGatewaySuccess}
          onCancel={() => setGatewayOpen(false)}
        />

        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
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
                    <Badge className="gap-1 bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">
                      <Clock className="h-3 w-3" /> {t("parent.wallet.qrWaiting")}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{t("parent.wallet.qrConfirmNote")}</span>
                </div>
              </div>
            )}

            <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setQrOpen(false)}
                className="h-11 sm:h-10 border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                {t("parent.wallet.close")}
              </Button>
              <Button
                onClick={handleConfirmTransfer}
                disabled={confirming}
                className="h-11 sm:h-10 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold hover:from-orange-600 hover:to-amber-600 border-0 shadow-md"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                {confirming ? t("parent.wallet.confirming") : t("parent.wallet.confirmTransfer")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
