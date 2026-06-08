import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, ArrowDown, ArrowLeftRight, AlertTriangle } from "lucide-react";

interface ChildSummary {
  link_id: number;
  relation: string;
  customer_id: number;
  student_code?: string | null;
  name: string;
  grade?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  card_frozen?: boolean;
}

interface OwnWallet {
  id: number;
  owner_type: "user" | "customer";
  user_id: number | null;
  balance: number;
  name: string | null;
  username: string | null;
  role: string | null;
}

interface WalletOption {
  key: string;
  walletId: number;
  rawName: string;
  balance: number;
  isSelf: boolean;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function Transfer() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromKey, setFromKey] = useState<string>("");
  const [toKey, setToKey] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const walletLabel = (w: WalletOption) =>
    w.isSelf ? t("parent.transfer.myWalletOption", { name: w.rawName }) : w.rawName;

  useEffect(() => {
    (async () => {
      try {
        const [children, mine] = await Promise.all([
          api.get<ChildSummary[]>("/family/me"),
          api.get<OwnWallet | null>("/wallets/me").catch(() => null),
        ]);
        const opts: WalletOption[] = [];
        if (mine && mine.owner_type === "user") {
          opts.push({
            key: `self-${mine.id}`,
            walletId: mine.id,
            rawName: mine.name ?? mine.username ?? "",
            balance: mine.balance,
            isSelf: true,
          });
        }
        for (const c of children) {
          if (!c.wallet_id) continue;
          opts.push({
            key: `child-${c.customer_id}`,
            walletId: c.wallet_id,
            rawName: c.name,
            balance: c.wallet_balance ?? 0,
            isSelf: false,
          });
        }
        setWallets(opts);
        const fromParam = new URLSearchParams(window.location.search).get("from");
        if (fromParam) {
          const match = opts.find((o) => String(o.walletId) === fromParam);
          if (match) setFromKey(match.key);
        }
      } catch (e) {
        toast({
          title: t("parent.transfer.loadFailed"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fromWallet = useMemo(() => wallets.find((w) => w.key === fromKey), [wallets, fromKey]);
  const toWallet = useMemo(() => wallets.find((w) => w.key === toKey), [wallets, toKey]);

  const amt = parseFloat(amount) || 0;
  const sameWallet = fromKey && toKey && fromKey === toKey;
  const fromBalance = fromWallet?.balance ?? 0;
  const toBalance = toWallet?.balance ?? 0;
  const canSubmit = fromWallet && toWallet && !sameWallet && amt > 0 && !submitting;

  const handleSubmit = async () => {
    if (!fromWallet || !toWallet) return;
    setSubmitting(true);
    try {
      await api.post("/wallets/transfer", {
        from_wallet_id: fromWallet.walletId,
        to_wallet_id: toWallet.walletId,
        amount: amt,
        note: note.trim() || undefined,
      });
      toast({
        title: t("parent.transfer.success"),
        description: t("parent.transfer.successDesc", {
          amount: formatTHB(amt),
          from: walletLabel(fromWallet),
          to: walletLabel(toWallet),
        }),
      });
      navigate("/parent/dashboard");
    } catch (e) {
      toast({
        title: t("parent.transfer.failed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="page-shell text-muted-foreground">{t("parent.common.loading")}</div>;
  }

  if (wallets.length < 2) {
    return (
      <div className="page-shell">
        <div className="max-w-xl space-y-4">
        <Button asChild variant="ghost" size="sm" className="h-10">
          <Link to="/parent/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}</Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t("parent.transfer.notEnoughWallets")}
          </CardContent>
        </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">
      <Button asChild variant="ghost" size="sm" className="h-10 w-fit">
        <Link to="/parent/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}</Link>
      </Button>

      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6" /> {t("parent.transfer.title")}
        </h1>
        <p className="page-description">
          {t("parent.transfer.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("parent.transfer.detailsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <div className="space-y-1.5">
              <Label>{t("parent.transfer.fromLabel")}</Label>
              <Select value={fromKey} onValueChange={setFromKey}>
                <SelectTrigger>
                  <SelectValue placeholder={t("parent.transfer.selectWallet")} />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.key} value={w.key} disabled={w.key === toKey}>
                      {walletLabel(w)} · {formatTHB(w.balance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fromWallet && (
                <p className="text-xs text-muted-foreground">
                  {t("parent.transfer.currentBalance", { amount: formatTHB(fromBalance) })}
                </p>
              )}
            </div>

            <div className="flex items-center justify-center sm:pb-2 text-muted-foreground">
              <ArrowDown className="h-6 w-6 sm:hidden" />
              <ArrowRight className="h-6 w-6 hidden sm:block" />
            </div>

            <div className="space-y-1.5">
              <Label>{t("parent.transfer.toLabel")}</Label>
              <Select value={toKey} onValueChange={setToKey}>
                <SelectTrigger>
                  <SelectValue placeholder={t("parent.transfer.selectWallet")} />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.key} value={w.key} disabled={w.key === fromKey}>
                      {walletLabel(w)} · {formatTHB(w.balance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {toWallet && (
                <p className="text-xs text-muted-foreground">
                  {t("parent.transfer.currentBalance", { amount: formatTHB(toBalance) })}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">{t("parent.transfer.amountLabel")}</Label>
            <Input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100.00"
            />
            <div className="grid grid-cols-4 gap-2 pt-1 sm:flex sm:flex-wrap">
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">{t("parent.transfer.noteLabel")}</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. lunch money"
              rows={2}
            />
          </div>

          {fromWallet && toWallet && amt > 0 && !sameWallet && (
            <div className="rounded-md bg-muted p-4 space-y-2 text-sm">
              <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                {t("parent.transfer.previewTitle")}
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <Badge variant="secondary">{t("parent.transfer.fromBadge")}</Badge>
                  <span className="ml-2 font-medium">{walletLabel(fromWallet)}</span>
                </div>
                <div className="font-mono">
                  {formatTHB(fromBalance)} →{" "}
                  <span className={fromBalance - amt < 0 ? "text-destructive font-semibold" : "font-semibold"}>
                    {formatTHB(fromBalance - amt)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Badge variant="default">{t("parent.transfer.toBadge")}</Badge>
                  <span className="ml-2 font-medium">{walletLabel(toWallet)}</span>
                </div>
                <div className="font-mono">
                  {formatTHB(toBalance)} →{" "}
                  <span className="font-semibold text-green-600">{formatTHB(toBalance + amt)}</span>
                </div>
              </div>
              {fromBalance - amt < 0 && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("parent.transfer.negativeWarning")}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => navigate("/parent/dashboard")}
              disabled={submitting}
              className="h-11 sm:h-10"
            >
              {t("parent.transfer.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} className="h-11 sm:h-10">
              {submitting ? t("parent.transfer.submitting") : t("parent.transfer.confirmBtn")}
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
