import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { toast } from "@/hooks/use-toast";
import { Building2, ArrowDownCircle, ArrowUpCircle, History, Loader2, Plus, X, FileText, FileSpreadsheet } from "lucide-react";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { exportToPDF, exportToExcel, type ReportColumn, type ReportPayload } from "@/lib/reportExport";

interface Department {
  id: number;
  department_code: string;
  department_name: string;
  is_active: boolean;
  wallet_id: number | null;
  wallet_balance: number | null;
}

interface WalletTransaction {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_type?: string | null;
  reference_id?: number | null;
  description?: string | null;
  created_at: string;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);


export default function DepartmentAdjust() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "th-TH";
  const school = useSchoolInfo();
  const DEFAULT_REASONS = [
    t("cardholders.deptAdjust.quickClear"),
    t("cardholders.deptAdjust.quickTopup"),
    t("cardholders.deptAdjust.quickFix"),
    t("cardholders.deptAdjust.quickReturn"),
  ];
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [reason, setReason] = useState("");
  const [referenceTicket, setReferenceTicket] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  // Custom quick-reason chips persisted in system_setting (shared across admins).
  const [customShortcuts, setCustomShortcuts] = useState<string[]>([]);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [newShortcutText, setNewShortcutText] = useState("");
  // Date filter for the transaction history + exports.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const QUICK_REASONS = useMemo(() => [...DEFAULT_REASONS, ...customShortcuts], [DEFAULT_REASONS, customShortcuts]);

  const loadCustomShortcuts = async () => {
    try {
      const all = await api.get<Record<string, unknown>>("/admin/settings/");
      const v = all.department_adjust_shortcuts;
      if (Array.isArray(v)) setCustomShortcuts(v.filter((x): x is string => typeof x === "string"));
    } catch { /* not fatal — fall back to defaults */ }
  };

  const saveCustomShortcuts = async (next: string[]) => {
    try {
      await api.put("/admin/settings/department_adjust_shortcuts", { value: next });
      setCustomShortcuts(next);
    } catch (e) {
      toast({
        title: t("cardholders.deptAdjust.shortcutSaveFailed", "Could not save shortcut"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const addShortcut = async () => {
    const text = newShortcutText.trim();
    if (!text || DEFAULT_REASONS.includes(text) || customShortcuts.includes(text)) {
      setShortcutDialogOpen(false);
      setNewShortcutText("");
      return;
    }
    await saveCustomShortcuts([...customShortcuts, text]);
    setShortcutDialogOpen(false);
    setNewShortcutText("");
  };

  const removeShortcut = async (text: string) => {
    await saveCustomShortcuts(customShortcuts.filter((s) => s !== text));
  };

  const loadDepartments = async () => {
    setLoading(true);
    try {
      const data = await api.get<Department[]>("/departments/?active_only=false");
      setDepartments(data);
      if (data.length > 0 && selectedId == null) setSelectedId(data[0].id);
    } catch (e) {
      toast({
        title: t("cardholders.deptAdjust.loadFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async (deptId: number) => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({ limit: "500" });
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await api.get<{ items: WalletTransaction[] }>(
        `/admin/departments/${deptId}/transactions?${params.toString()}`,
      );
      setTransactions(res.items);
    } catch {
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => {
    loadDepartments();
    loadCustomShortcuts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId != null) loadTransactions(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, dateFrom, dateTo]);

  // ── Export helpers ──────────────────────────────────────────────────────
  const buildReportPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!selected || transactions.length === 0) return null;
    const columns: ReportColumn[] = [
      { header: t("cardholders.deptAdjust.colDate"), key: "date", format: "datetime", width: 90 },
      { header: t("cardholders.deptAdjust.colType"), key: "type", width: 70 },
      { header: t("cardholders.deptAdjust.colDesc"), key: "description", width: 220 },
      { header: t("cardholders.deptAdjust.colAmount"), key: "amount", format: "currency", width: 80 },
      { header: t("cardholders.deptAdjust.colBalance"), key: "balance", format: "currency", width: 80 },
    ];
    let totalIn = 0;
    let totalOut = 0;
    // Render newest-first in the UI but oldest-first in the export so the
    // running balance reads naturally on the printed page.
    const rows = [...transactions].reverse().map((tx) => {
      const isCredit = tx.balance_after >= tx.balance_before;
      const signed = isCredit ? Math.abs(tx.amount) : -Math.abs(tx.amount);
      if (isCredit) totalIn += Math.abs(tx.amount);
      else totalOut += Math.abs(tx.amount);
      return {
        date: tx.created_at,
        type: tx.transaction_type,
        description: tx.description ?? "—",
        amount: signed,
        balance: tx.balance_after,
      };
    });
    return {
      meta: {
        title: t("cardholders.deptAdjust.reportTitle", "Department wallet transactions"),
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        filters: [
          `${t("cardholders.deptAdjust.reportDept", "Department")}: ${selected.department_name} (${selected.department_code})`,
          `${t("cardholders.deptAdjust.reportPeriod", "Period")}: ${dateFrom || "—"}  →  ${dateTo || "—"}`,
          `${t("cardholders.deptAdjust.reportBalance", "Current balance")}: ${formatTHB(Number(selected.wallet_balance ?? 0))}`,
        ],
      },
      columns,
      rows,
      totals: {
        type: "TOTAL",
        amount: totalIn - totalOut,
      },
    };
  };

  const exportPdf = async () => {
    const payload = buildReportPayload();
    if (!payload || !selected) return;
    const period = `${dateFrom || "all"}_${dateTo || "all"}`;
    try {
      await exportToPDF(payload, `Dept_${selected.department_code}_${period}.pdf`);
    } catch (e) {
      toast({
        title: t("cardholders.deptAdjust.exportFailed", "Export failed"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const exportExcel = () => {
    const payload = buildReportPayload();
    if (!payload || !selected) return;
    const period = `${dateFrom || "all"}_${dateTo || "all"}`;
    try {
      exportToExcel(payload, `Dept_${selected.department_code}_${period}.xlsx`);
    } catch (e) {
      toast({
        title: t("cardholders.deptAdjust.exportFailed", "Export failed"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const selected = useMemo(
    () => departments.find((d) => d.id === selectedId) ?? null,
    [departments, selectedId],
  );

  const amountNum = parseFloat(amount) || 0;
  const signedAmount = direction === "credit" ? amountNum : -amountNum;
  const projectedBalance = (selected?.wallet_balance ?? 0) + signedAmount;
  const canSubmit =
    !!selected && amountNum > 0 && reason.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.post(`/admin/departments/${selected.id}/adjust`, {
        amount: signedAmount,
        reason: reason.trim(),
        reference_ticket: referenceTicket.trim() || undefined,
      });
      toast({
        title: t("cardholders.deptAdjust.successTitle"),
        description: `${selected.department_name} ${direction === "credit" ? "+" : "−"}${formatTHB(amountNum)}`,
      });
      setAmount("");
      setReason("");
      setReferenceTicket("");
      await loadDepartments();
      await loadTransactions(selected.id);
    } catch (e) {
      toast({
        title: t("cardholders.deptAdjust.errorTitle"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="space-y-4">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Building2 className="h-6 w-6" /> {t("cardholders.deptAdjust.title")}
        </h1>
        <p className="page-description">
          {t("cardholders.deptAdjust.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Department picker */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("cardholders.deptAdjust.deptPickerTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-1">
            {loading && (
              <p className="text-center text-xs text-muted-foreground py-3">
                <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                {t("cardholders.deptAdjust.loading")}
              </p>
            )}
            {!loading && departments.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-3">{t("cardholders.deptAdjust.noDepts")}</p>
            )}
            {departments.map((d) => {
              const balance = Number(d.wallet_balance ?? 0);
              const isNeg = balance < 0;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left rounded-md p-2 transition ${
                    selectedId === d.id
                      ? "bg-primary/10 border-2 border-primary"
                      : "hover:bg-muted border-2 border-transparent"
                  }`}
                >
                  <div className="text-sm font-medium truncate">{d.department_name}</div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono text-[10px] text-muted-foreground">{d.department_code}</span>
                    <span className={`text-sm font-semibold tabular-nums ${isNeg ? "text-red-600" : "text-emerald-700"}`}>
                      {formatTHB(balance)}
                    </span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Adjust panel */}
        <div className="space-y-4">
          {selected ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{selected.department_name}</CardTitle>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{selected.department_code}</p>
                    </div>
                    <Badge variant={(selected.wallet_balance ?? 0) < 0 ? "destructive" : "secondary"}>
                      {formatTHB(Number(selected.wallet_balance ?? 0))}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDirection("credit")}
                      className={`flex items-center justify-center gap-2 rounded-md border-2 p-2.5 text-sm font-semibold transition ${
                        direction === "credit"
                          ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                          : "border-input bg-background text-muted-foreground"
                      }`}
                    >
                      <ArrowUpCircle className="h-4 w-4" />
                      Credit (+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirection("debit")}
                      className={`flex items-center justify-center gap-2 rounded-md border-2 p-2.5 text-sm font-semibold transition ${
                        direction === "debit"
                          ? "border-red-500 bg-red-50 text-red-900"
                          : "border-input bg-background text-muted-foreground"
                      }`}
                    >
                      <ArrowDownCircle className="h-4 w-4" />
                      Debit (−)
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="amount">{t("cardholders.deptAdjust.amountLabel")}</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="text-lg tabular-nums"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reason">{t("cardholders.deptAdjust.reasonLabel")}</Label>
                    <Textarea
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("cardholders.deptAdjust.reasonPlaceholder")}
                      rows={2}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {DEFAULT_REASONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setReason(r)}
                          className="text-xs rounded-full border bg-background px-2 py-0.5 hover:bg-muted"
                        >
                          {r}
                        </button>
                      ))}
                      {customShortcuts.map((r) => (
                        <span
                          key={r}
                          className="inline-flex items-center text-xs rounded-full border bg-amber-50/60 border-amber-200 pl-2 pr-1 py-0.5"
                        >
                          <button type="button" onClick={() => setReason(r)} className="hover:underline">
                            {r}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeShortcut(r)}
                            className="ml-1 rounded-full hover:bg-amber-200/60 p-0.5"
                            title={t("cardholders.deptAdjust.shortcutRemove", "Remove")}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShortcutDialogOpen(true)}
                        className="inline-flex items-center text-xs font-medium rounded-full border border-amber-500 bg-amber-500 text-white px-2.5 py-0.5 shadow-sm hover:bg-amber-600 hover:border-amber-600 transition-colors"
                        title={t("cardholders.deptAdjust.shortcutAdd", "Add custom shortcut")}
                      >
                        <Plus className="h-3 w-3 mr-0.5" />
                        {t("cardholders.deptAdjust.shortcutAdd", "Add")}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ref">{t("cardholders.deptAdjust.refLabel")}</Label>
                    <Input
                      id="ref"
                      value={referenceTicket}
                      onChange={(e) => setReferenceTicket(e.target.value)}
                      placeholder={t("cardholders.deptAdjust.refPlaceholder")}
                    />
                  </div>

                  {amountNum > 0 && (
                    <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("cardholders.deptAdjust.currentBalance")}</span>
                        <span className="tabular-nums">{formatTHB(Number(selected.wallet_balance ?? 0))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{direction === "credit" ? t("cardholders.deptAdjust.credit") : t("cardholders.deptAdjust.debit")}</span>
                        <span className={`tabular-nums ${direction === "credit" ? "text-emerald-700" : "text-red-700"}`}>
                          {direction === "credit" ? "+" : "−"}{formatTHB(amountNum)}
                        </span>
                      </div>
                      <div className="flex justify-between border-t pt-1 font-semibold">
                        <span>{t("cardholders.deptAdjust.afterAdjust")}</span>
                        <span className={`tabular-nums ${projectedBalance < 0 ? "text-red-600" : ""}`}>
                          {formatTHB(projectedBalance)}
                        </span>
                      </div>
                    </div>
                  )}

                  <Button onClick={submit} disabled={!canSubmit} className="w-full">
                    {submitting ? t("cardholders.deptAdjust.submitting") : t("cardholders.deptAdjust.submitBtn")}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="space-y-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" /> {t("cardholders.deptAdjust.historyTitle")}
                  </CardTitle>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[260px]">
                      <Label className="text-xs">{t("reports.startDate", "Start date")} — {t("reports.endDate", "End date")}</Label>
                      <DateRangePicker
                        id="deptTxRange"
                        startDate={dateFrom}
                        endDate={dateTo}
                        onStartChange={setDateFrom}
                        onEndChange={setDateTo}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportPdf}
                        disabled={transactions.length === 0}
                      >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        PDF
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportExcel}
                        disabled={transactions.length === 0}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                        Excel
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("cardholders.deptAdjust.colDate")}</TableHead>
                        <TableHead>{t("cardholders.deptAdjust.colType")}</TableHead>
                        <TableHead>{t("cardholders.deptAdjust.colDesc")}</TableHead>
                        <TableHead className="text-right">{t("cardholders.deptAdjust.colAmount")}</TableHead>
                        <TableHead className="text-right">{t("cardholders.deptAdjust.colBalance")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txLoading && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                            <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                            {t("cardholders.deptAdjust.txLoading")}
                          </TableCell>
                        </TableRow>
                      )}
                      {!txLoading && transactions.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                            {t("cardholders.deptAdjust.noTx")}
                          </TableCell>
                        </TableRow>
                      )}
                      {transactions.map((tx) => {
                        const isCredit = tx.balance_after >= tx.balance_before;
                        return (
                          <TableRow key={tx.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(tx.created_at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}
                            </TableCell>
                            <TableCell className="text-xs capitalize">{tx.transaction_type}</TableCell>
                            <TableCell className="text-xs max-w-xs truncate">{tx.description ?? "—"}</TableCell>
                            <TableCell className={`text-right tabular-nums text-sm font-semibold ${isCredit ? "text-emerald-700" : "text-red-700"}`}>
                              {isCredit ? "+" : "−"}{formatTHB(Math.abs(tx.amount))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm">
                              {formatTHB(tx.balance_after)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                {t("cardholders.deptAdjust.selectPrompt")}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </div>

      {/* ── Add custom shortcut dialog ─────────────────────────────────────── */}
      <Dialog open={shortcutDialogOpen} onOpenChange={(open) => { if (!open) { setShortcutDialogOpen(false); setNewShortcutText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("cardholders.deptAdjust.shortcutDialogTitle", "Add custom shortcut")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="shortcut-text">{t("cardholders.deptAdjust.shortcutDialogLabel", "Reason text")}</Label>
            <Input
              id="shortcut-text"
              value={newShortcutText}
              onChange={(e) => setNewShortcutText(e.target.value)}
              placeholder={t("cardholders.deptAdjust.shortcutDialogPlaceholder", "e.g. คืนเครดิตงานวิ่งการกุศล")}
              onKeyDown={(e) => { if (e.key === "Enter") addShortcut(); }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t("cardholders.deptAdjust.shortcutDialogHint", "Saved to system settings — shared across all admins.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShortcutDialogOpen(false); setNewShortcutText(""); }}>
              {t("cardholders.deptAdjust.cancel", "Cancel")}
            </Button>
            <Button onClick={addShortcut} disabled={!newShortcutText.trim()}>
              {t("cardholders.deptAdjust.shortcutDialogSave", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
