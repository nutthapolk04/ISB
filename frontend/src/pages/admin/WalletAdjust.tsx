import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { formatCurrency as formatTHB } from "@/lib/format";
import { exportToPDF, exportToExcel } from "@/lib/reportExport";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
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
import { PaginationBar } from "@/components/PaginationBar";
import { Minus, Plus, Search, Wallet as WalletIcon, FileSpreadsheet, FileText, ClipboardList } from "lucide-react";

const PAGE_SIZE = 10;

// ── Adjustment Report helpers ────────────────────────────────────────────────

interface AdjustmentRow {
  id: number;
  created_at: string;
  entity_type: string;
  entity_name: string;
  entity_code: string;
  direction: "credit" | "debit";
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  reference_ticket: string | null;
  adjusted_by: string;
}

const ENTITY_COLORS: Record<string, string> = {
  student: "bg-blue-100 text-blue-800",
  parent: "bg-purple-100 text-purple-800",
  staff: "bg-amber-100 text-amber-800",
  admin: "bg-red-100 text-red-800",
  department: "bg-green-100 text-green-800",
};

const formatDT = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const RPT_COLUMNS = [
  { header: "Date / Time",    key: "created_at",       format: "datetime" as const, width: 18 },
  { header: "Type",           key: "entity_type",      format: "text" as const,     width: 12 },
  { header: "Name",           key: "entity_name",      format: "text" as const,     width: 24 },
  { header: "Code",           key: "entity_code",      format: "text" as const,     width: 16 },
  { header: "Direction",      key: "direction",        format: "text" as const,     width: 10 },
  { header: "Amount (฿)",     key: "amount",           format: "currency" as const, width: 14, align: "right" as const },
  { header: "Balance Before", key: "balance_before",   format: "currency" as const, width: 14, align: "right" as const },
  { header: "Balance After",  key: "balance_after",    format: "currency" as const, width: 14, align: "right" as const },
  { header: "Reason",         key: "reason",           format: "text" as const,     width: 30 },
  { header: "Ref / Ticket",   key: "reference_ticket", format: "text" as const,     width: 16 },
  { header: "Adjusted By",    key: "adjusted_by",      format: "text" as const,     width: 20 },
];

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
  const schoolInfo = useSchoolInfo();
  const [cardholders, setCardholders] = useState<Cardholder[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Cardholder | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Adjustment Report state ───────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + "-01";
  const [rptDateFrom, setRptDateFrom] = useState(firstOfMonth);
  const [rptDateTo, setRptDateTo] = useState(today);
  const [rptDirection, setRptDirection] = useState<"all" | "credit" | "debit">("all");
  // Type filter sent to /wallets/admin/adjustment-report?type=...; 'student'
  // maps directly to entity_type, 'staff' bundles user-owned wallets
  // (cashier/manager/teacher/etc.). Department adjustments live on a separate
  // page (/admin/department-adjust) and are excluded from this report.
  const [rptType, setRptType] = useState<"all" | "student" | "staff" | "other">("all");
  const [rptRows, setRptRows] = useState<AdjustmentRow[]>([]);
  const [rptLoading, setRptLoading] = useState(false);
  const [rptSearched, setRptSearched] = useState(false);

  const loadReport = async () => {
    setRptLoading(true);
    try {
      const params = new URLSearchParams();
      if (rptDateFrom) params.set("date_from", rptDateFrom);
      if (rptDateTo) params.set("date_to", rptDateTo);
      if (rptDirection !== "all") params.set("direction", rptDirection);
      if (rptType !== "all") params.set("type", rptType);
      const data = await api.get<AdjustmentRow[]>(`/wallets/admin/adjustment-report?${params.toString()}`);
      setRptRows(data);
      setRptSearched(true);
    } catch (e) {
      toast({
        title: t("adjustmentReport.loadError", "Failed to load report"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRptLoading(false);
    }
  };

  const rptFilterLabel = [
    rptDateFrom && rptDateTo ? `${rptDateFrom} → ${rptDateTo}` : "All dates",
    rptDirection !== "all" ? `Direction: ${rptDirection}` : null,
    rptType !== "all" ? `Type: ${rptType}` : null,
  ].filter(Boolean).join("  |  ");

  const rptExportRows = rptRows.map((r) => ({ ...r, reason: r.reason ?? "", reference_ticket: r.reference_ticket ?? "" }));
  const rptTotals = {
    entity_name: `${rptRows.length} records`,
    amount: rptRows.reduce((s, r) => s + (r.direction === "credit" ? r.amount : -r.amount), 0),
  };
  const rptCreditTotal = rptRows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0);
  const rptDebitTotal  = rptRows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0);

  const handleRptExcel = () => exportToExcel(
    { meta: { title: "Wallet Adjustment Report", schoolName: schoolInfo?.name ?? "ISB", filters: [rptFilterLabel] }, columns: RPT_COLUMNS, rows: rptExportRows, totals: rptTotals },
    `WalletAdjustments_${rptDateFrom}_${rptDateTo}`,
  );

  const handleRptPdf = () => exportToPDF(
    { meta: { title: "Wallet Adjustment Report", schoolName: schoolInfo?.name ?? "ISB", schoolLogoUrl: schoolInfo?.logoUrl || undefined, filters: [rptFilterLabel] }, columns: RPT_COLUMNS, rows: rptExportRows, totals: rptTotals },
    `WalletAdjustments_${rptDateFrom}_${rptDateTo}.pdf`,
  );

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: Cardholder[]; total: number }>(
        "/admin/cardholders?page_size=500"
      );
      // Only cardholders with a wallet, and exclude departments — those are
      // adjusted via the dedicated Dept Wallet Adjust page so the two screens
      // don't overlap and confuse operators.
      setCardholders(
        data.items.filter((c) => c.wallet_id != null && c.entity_type !== "department"),
      );
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 whenever search changes
  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

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

      {/* ── Adjustment Report Section ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          {t("adjustmentReport.title", "Adjustment Report")}
        </h2>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("adjustmentReport.filters", "Filters")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="rpt-date-from">{t("adjustmentReport.dateFrom", "From")}</Label>
                <Input id="rpt-date-from" type="date" value={rptDateFrom} onChange={(e) => setRptDateFrom(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rpt-date-to">{t("adjustmentReport.dateTo", "To")}</Label>
                <Input id="rpt-date-to" type="date" value={rptDateTo} onChange={(e) => setRptDateTo(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label>{t("adjustmentReport.direction", "Direction")}</Label>
                <Select value={rptDirection} onValueChange={(v) => setRptDirection(v as typeof rptDirection)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="credit">+</SelectItem>
                    <SelectItem value="debit">−</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("adjustmentReport.type", "Type")}</Label>
                <Select value={rptType} onValueChange={(v) => setRptType(v as typeof rptType)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("adjustmentReport.typeAll", "All")}</SelectItem>
                    <SelectItem value="student">{t("adjustmentReport.typeStudent", "Student")}</SelectItem>
                    <SelectItem value="staff">{t("adjustmentReport.typeStaff", "Staff")}</SelectItem>
                    <SelectItem value="other">{t("adjustmentReport.typeOther", "Other")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={loadReport} disabled={rptLoading} className="gap-2">
                <Search className="h-4 w-4" />
                {rptLoading ? t("adjustmentReport.loading", "Loading…") : t("adjustmentReport.search", "Search")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {rptSearched && rptRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-muted-foreground">{rptRows.length} records</span>
              <Badge variant="outline" className="text-green-700 border-green-300">+ {formatTHB(rptCreditTotal)}</Badge>
              <Badge variant="outline" className="text-destructive border-destructive/30">− {formatTHB(rptDebitTotal)}</Badge>
              <Badge variant="secondary">Net: {formatTHB(rptCreditTotal - rptDebitTotal)}</Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRptExcel} className="gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-700" />Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleRptPdf} className="gap-2">
                <FileText className="h-4 w-4 text-red-600" />PDF
              </Button>
            </div>
          </div>
        )}

        {rptSearched && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-right">{t("common.colNo", "No.")}</TableHead>
                      <TableHead className="whitespace-nowrap">Date / Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance Before</TableHead>
                      <TableHead className="text-right">Balance After</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Ref / Ticket</TableHead>
                      <TableHead>Adjusted By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rptRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                          {t("adjustmentReport.noResults", "No adjustments found.")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      rptRows.map((r, idx) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-mono">{formatDT(r.created_at)}</TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${ENTITY_COLORS[r.entity_type] ?? "bg-gray-100 text-gray-700"}`}>
                              {r.entity_type}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium">{r.entity_name}</TableCell>
                          <TableCell><Badge variant="secondary" className="font-mono text-xs">{r.entity_code}</Badge></TableCell>
                          <TableCell>
                            <Badge variant="outline" className={r.direction === "credit" ? "text-green-700 border-green-300" : "text-destructive border-destructive/30"}>
                              {r.direction === "credit" ? "+" : "−"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">{formatTHB(r.amount)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground text-sm">{formatTHB(r.balance_before)}</TableCell>
                          <TableCell className={`text-right font-mono font-semibold ${r.balance_after < 0 ? "text-destructive" : ""}`}>{formatTHB(r.balance_after)}</TableCell>
                          <TableCell className="max-w-[220px] text-sm"><span title={r.reason ?? ""} className="line-clamp-2">{r.reason || <span className="text-muted-foreground italic">—</span>}</span></TableCell>
                          <TableCell className="text-sm font-mono">{r.reference_ticket || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-sm">{r.adjusted_by}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
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
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <p className="text-muted-foreground text-sm">{t("admin.walletAdjust.loading")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">{t("common.colNo", "No.")}</TableHead>
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
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {t("admin.walletAdjust.noResults")}
                    </TableCell>
                  </TableRow>
                )}
                {paged.map((c, idx) => (
                  <TableRow key={c.key}>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {(safePage - 1) * PAGE_SIZE + idx + 1}
                    </TableCell>
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

          {!loading && filtered.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                {t("common.showingOf", {
                  from: (safePage - 1) * PAGE_SIZE + 1,
                  to: Math.min(safePage * PAGE_SIZE, filtered.length),
                  total: filtered.length,
                  defaultValue: `Showing {{from}}–{{to}} of {{total}}`,
                })}
              </p>
              <PaginationBar currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
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
