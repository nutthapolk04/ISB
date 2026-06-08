import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { InfoCallout } from "@/components/InfoCallout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Minus, Plus, Search, Wallet as WalletIcon } from "lucide-react";

interface Cardholder {
  key: string;
  entity_type: "user" | "customer" | "department";
  entity_id: number;
  kind: string;
  name: string;
  identifier: string;
  photo_url?: string | null;
  grade?: string | null;
  role?: string | null;
  department_code?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  is_active: boolean;
}

type Direction = "credit" | "debit";

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

function profileHref(c: Cardholder): string {
  if (c.entity_type === "user") return `/users/${c.entity_id}`;
  if (c.entity_type === "customer") return `/admin/customer/${c.entity_id}`;
  return `/users?tab=cardholders`;
}

function kindLabel(c: Cardholder): string {
  if (c.entity_type === "user") return c.role ?? c.kind;
  if (c.entity_type === "department") return "dept";
  return c.grade ?? c.kind;
}

export default function WalletAdjust() {
  const { t } = useTranslation();
  const [cardholders, setCardholders] = useState<Cardholder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Cardholder | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: Cardholder[]; total: number }>(
        "/admin/cardholders?page_size=500"
      );
      // Only show cardholders that have a wallet
      setCardholders(data.items.filter((c) => c.wallet_id != null));
    } catch (e) {
      toast({
        title: t("admin.walletAdjust.loadError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = cardholders.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.identifier.toLowerCase().includes(q) ||
      (c.grade || "").toLowerCase().includes(q)
    );
  });

  const openAdjust = (c: Cardholder) => {
    if (!c.wallet_id) {
      toast({ title: t("admin.walletAdjust.noWallet"), variant: "destructive" });
      return;
    }
    setSelected(c);
    setDirection("credit");
    setAmount("");
    setReason("");
    setReference("");
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selected?.wallet_id) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: t("admin.walletAdjust.invalidAmount"), variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: t("admin.walletAdjust.reasonRequired"), variant: "destructive" });
      return;
    }
    const signed = direction === "credit" ? amt : -amt;
    setSubmitting(true);
    try {
      await api.post(`/wallets/${selected.wallet_id}/adjust`, {
        amount: signed,
        reason: reason.trim(),
        reference_ticket: reference.trim() || undefined,
      });
      toast({
        title: t("admin.walletAdjust.adjustSuccess"),
        description:
          direction === "credit"
            ? t("admin.walletAdjust.adjustCreditDesc", { amount: formatTHB(amt), name: selected.name })
            : t("admin.walletAdjust.adjustDebitDesc", { amount: formatTHB(amt), name: selected.name }),
      });
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast({
        title: t("admin.walletAdjust.adjustError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <WalletIcon className="h-6 w-6" /> {t("admin.walletAdjust.title")}
        </h1>
        <p className="page-description">
          {t("admin.walletAdjust.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.walletAdjust.searchStudent")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("admin.walletAdjust.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <p className="text-muted-foreground text-sm">{t("admin.walletAdjust.loading")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.walletAdjust.colName")}</TableHead>
                  <TableHead>{t("admin.walletAdjust.colCode")}</TableHead>
                  <TableHead>{t("admin.walletAdjust.colClass")}</TableHead>
                  <TableHead className="text-right">{t("admin.walletAdjust.colBalance")}</TableHead>
                  <TableHead className="text-right">{t("admin.walletAdjust.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {t("admin.walletAdjust.noResults")}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">{c.identifier}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-xs capitalize text-muted-foreground"
                      >
                        {kindLabel(c)}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-mono ${(c.wallet_balance ?? 0) < 0 ? "text-destructive" : ""}`}>
                      {formatTHB(c.wallet_balance ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button asChild size="sm" variant="ghost" title={t("admin.walletAdjust.viewProfile")}>
                          <Link to={profileHref(c)}>{t("admin.walletAdjust.viewProfile")}</Link>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openAdjust(c)}>
                          {t("admin.walletAdjust.adjustBalance")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.walletAdjust.dialogTitle", { name: selected?.name ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("admin.walletAdjust.currentBalance", { amount: formatTHB(selected?.wallet_balance ?? 0) })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <InfoCallout
              id="walletAdjust.auditReason"
              variant="warn"
              title={t("admin.walletAdjust.info.auditReason.title")}
            >
              {t("admin.walletAdjust.info.auditReason.body")}
            </InfoCallout>

            <div className="space-y-1.5">
              <Label>{t("admin.walletAdjust.directionType")}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">
                    <span className="flex items-center gap-2"><Plus className="h-4 w-4 text-green-600" /> {t("admin.walletAdjust.directionCredit")}</span>
                  </SelectItem>
                  <SelectItem value="debit">
                    <span className="flex items-center gap-2"><Minus className="h-4 w-4 text-destructive" /> {t("admin.walletAdjust.directionDebit")}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="amount">{t("admin.walletAdjust.amountLabel")}</Label>
              <Input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100.00"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason">
                {t("admin.walletAdjust.reasonLabel")} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("admin.walletAdjust.reasonPlaceholder")}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reference">{t("admin.walletAdjust.referenceTicket")}</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("admin.walletAdjust.referencePlaceholder")}
              />
            </div>

            {amount && !isNaN(parseFloat(amount)) && selected && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("admin.walletAdjust.balanceAfter")}</span>
                  <span className={`font-semibold font-mono ${
                    (selected.wallet_balance ?? 0) + (direction === "credit" ? parseFloat(amount) : -parseFloat(amount)) < 0
                      ? "text-destructive"
                      : ""
                  }`}>
                    {formatTHB(
                      (selected.wallet_balance ?? 0) +
                        (direction === "credit" ? parseFloat(amount) : -parseFloat(amount))
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {t("admin.walletAdjust.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? t("admin.walletAdjust.saving") : t("admin.walletAdjust.confirmAdjustment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
