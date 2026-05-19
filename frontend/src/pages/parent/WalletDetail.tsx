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

// Demo May-2026 — Topup channel limits & fee.
// Fee is UI-only for now (not persisted on payment_intents) — wallet still
// credits the face amount; the 3% is shown as the cost the parent pays the
// processor.
const MAX_TOPUP_THB = 50_000;
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
      toast({
        title: t("parent.common.loadFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
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

    if (paymentMethod === "credit_card") {
      setPendingAmt(amt);
      setGatewayOpen(true);
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
    return <div className="page-shell text-destructive">{t("parent.common.notFound")}</div>;
  }

  return (
    <div className="page-shell">
      <div className="max-w-3xl space-y-4 sm:space-y-6">
      <div className="page-header flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-10">
          <Link to={user?.role === "parent" ? "/parent/dashboard" : "/"}>
            <ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="break-words">
                {profile.is_own_user_wallet
                  ? t("parent.wallet.myWalletLabel", { name: profile.name })
                  : profile.name}
              </CardTitle>
              <div className="flex flex-wrap gap-2 mt-1">
                {profile.is_own_user_wallet && profile.role && (
                  <Badge variant="secondary" className="capitalize">{profile.role}</Badge>
                )}
                {!profile.is_own_user_wallet && profile.student_code && (
                  <Badge variant="secondary">{profile.student_code}</Badge>
                )}
                {!profile.is_own_user_wallet && profile.grade && (
                  <Badge variant="outline">{profile.grade}</Badge>
                )}
                {profile.card_frozen && (
                  <Badge variant="destructive">{t("parent.wallet.cardFrozen")}</Badge>
                )}
              </div>
            </div>
            <WalletIcon className="h-8 w-8 shrink-0 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-primary/5 p-4 sm:p-6 text-center">
            <p className="text-sm text-muted-foreground">{t("parent.wallet.balance")}</p>
            <p className="text-3xl sm:text-4xl font-bold text-primary mt-2 tabular-nums">
              {formatTHB(profile.wallet_balance ?? 0)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tab toggle */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === "topup" ? "default" : "outline"}
          size="sm"
          onClick={() => setSearchParams({})}
        >
          <WalletIcon className="h-4 w-4 mr-1.5" />
          {t("parent.wallet.topUpTitle")}
        </Button>
        <Button
          variant={activeTab === "history" ? "default" : "outline"}
          size="sm"
          onClick={() => setSearchParams({ tab: "history" })}
        >
          <History className="h-4 w-4 mr-1.5" />
          {t("parent.wallet.recentTitle")}
        </Button>
      </div>

      {activeTab === "topup" && <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("parent.wallet.topUpTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <InfoCallout
            id="wallet.topupFlow"
            variant="tip"
            title={t("parent.wallet.topupFlowTitle")}
          >
            {t("parent.wallet.topupFlowBody")}
          </InfoCallout>

          <div className="space-y-1.5">
            <Label>{t("parent.wallet.paymentChannel")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("qr_promptpay")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border-2 px-3 py-2.5 text-sm font-medium transition",
                  paymentMethod === "qr_promptpay"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-input bg-background text-muted-foreground hover:border-muted-foreground",
                )}
              >
                <QrCode className="h-4 w-4" />
                PromptPay QR
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("credit_card")}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 rounded-md border-2 px-3 py-2 text-sm font-medium transition",
                  paymentMethod === "credit_card"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-input bg-background text-muted-foreground hover:border-muted-foreground",
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
              <Label htmlFor="amount">{t("parent.wallet.amountLabel")}</Label>
              <Input
                id="amount"
                type="number"
                min="1"
                max={MAX_TOPUP_THB}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100"
                className="h-11"
              />
            </div>
            <Button onClick={handleCreateTopup} disabled={creating} className="h-11 sm:h-10">
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
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("parent.wallet.walletAmount")}</span>
                <span className="tabular-nums">{formatTHB(amtNumber)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("parent.wallet.feeLabel")}</span>
                <span className="tabular-nums">{formatTHB(fee)}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 font-semibold">
                <span>{t("parent.wallet.totalCharged")}</span>
                <span className="tabular-nums">{formatTHB(totalCharged)}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
            {[100, 200, 500, 1000].map((v) => (
              <Button
                key={v}
                variant="outline"
                onClick={() => setAmount(String(v))}
                className="h-10 text-sm tabular-nums"
              >
                ฿{v}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>}

      {activeTab === "history" && <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg">{t("parent.wallet.recentTitle")}</CardTitle>
          {!profile.is_own_user_wallet && (
            <Button asChild variant="ghost" size="sm" className="h-10 shrink-0">
              <Link to={`/parent/transactions/${profile.id}`}>
                <History className="h-4 w-4 mr-1" /> {t("parent.wallet.viewAll")}
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {transactions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{t("parent.wallet.noTransactions")}</p>
          )}
          {transactions.map((tx) => {
            const isCredit = (tx.balance_after ?? 0) >= (tx.balance_before ?? 0);
            return (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{tx.description || tx.transaction_type}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(tx.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold ${isCredit ? "text-green-600" : "text-destructive"}`}>
                    {isCredit ? "+" : "-"}
                    {formatTHB(Math.abs(tx.amount))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("parent.wallet.balanceAfter", { amount: formatTHB(tx.balance_after) })}
                  </p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>}

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
              <div className="flex justify-center rounded-md bg-white p-4 sm:p-6">
                <QRCodeSVG value={intent.qr_payload} size={200} className="sm:!h-[220px] sm:!w-[220px]" />
              </div>
              <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("parent.wallet.qrAmount")}</span>
                  <span className="font-semibold">{formatTHB(intent.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("parent.wallet.qrRefCode")}</span>
                  <span className="font-mono">{intent.ref_code}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t("parent.wallet.qrStatus")}</span>
                  <Badge variant="outline" className="gap-1">
                    <Clock className="h-3 w-3" /> {t("parent.wallet.qrWaiting")}
                  </Badge>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{t("parent.wallet.qrConfirmNote")}</span>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setQrOpen(false)} className="h-11 sm:h-10">
              {t("parent.wallet.close")}
            </Button>
            <Button onClick={handleConfirmTransfer} disabled={confirming} className="h-11 sm:h-10">
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
