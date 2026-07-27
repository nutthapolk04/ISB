import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PaginationBar } from "@/components/PaginationBar";
import { toast } from "@/hooks/use-toast";
import { fmtDateTime } from "@/lib/dateFormat";
import { formatCurrency as formatTHB } from "@/lib/format";
import { Bell, ClipboardList, Search, Send } from "lucide-react";

interface SettingsResponse {
  low_balance_alert_enabled?: boolean;
  low_balance_threshold?: number;
  low_balance_alert_send_time?: string;
  [key: string]: unknown;
}

// ── Alert queue/history table ────────────────────────────────────────────

interface LowBalanceAlertRow {
  id: number;
  sent_at: string;
  student_name: string;
  student_code: string | null;
  parent_name: string;
  parent_username: string;
  recipient_email: string;
  balance_at_alert: number;
  threshold_amount: number;
  status: "pending" | "sent" | "failed";
  error_message: string | null;
}

interface LowBalanceAlertReportResponse {
  items: LowBalanceAlertRow[];
  total: number;
  page: number;
  pages: number;
}

const ALERT_PAGE_SIZE = 10;

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  sent: "bg-green-100 text-green-700 hover:bg-green-100",
  failed: "bg-red-100 text-red-700 hover:bg-red-100",
};

export default function LowBalanceAlert() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState("100");
  const [sendTime, setSendTime] = useState("19:00");

  // ── Alert queue/history table state ─────────────────────────────────────
  const [logRows, setLogRows] = useState<LowBalanceAlertRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logPages, setLogPages] = useState(1);
  const [logLoading, setLogLoading] = useState(false);
  const [logDateFrom, setLogDateFrom] = useState("");
  const [logDateTo, setLogDateTo] = useState("");
  const [logStatus, setLogStatus] = useState<"all" | "pending" | "sent" | "failed">("all");
  const [sendingId, setSendingId] = useState<number | null>(null);

  const loadLog = async (page = 1) => {
    setLogLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(ALERT_PAGE_SIZE) });
      if (logDateFrom) params.set("date_from", logDateFrom);
      if (logDateTo) params.set("date_to", logDateTo);
      if (logStatus !== "all") params.set("status", logStatus);
      const data = await api.get<LowBalanceAlertReportResponse>(
        `/admin/low-balance-alert-report?${params.toString()}`,
      );
      setLogRows(data.items);
      setLogTotal(data.total);
      setLogPage(data.page);
      setLogPages(data.pages);
    } catch (e) {
      toast({
        title: t("admin.lowBalanceAlert.logLoadError", "Failed to load alert history"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLogLoading(false);
    }
  };

  useEffect(() => { loadLog(1); }, []);

  const sendNow = async (row: LowBalanceAlertRow) => {
    setSendingId(row.id);
    try {
      await api.post(`/admin/low-balance-alert-report/${row.id}/send`, {});
      toast({ title: t("admin.lowBalanceAlert.sendNowSuccess", "Alert sent") });
      await loadLog(logPage);
    } catch (e) {
      toast({
        title: t("admin.lowBalanceAlert.sendNowError", "Failed to send alert"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSendingId(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<SettingsResponse>("/admin/settings/");
        setAlertEnabled(!!data.low_balance_alert_enabled);
        setAlertThreshold(String(data.low_balance_threshold ?? 100));
        setSendTime(data.low_balance_alert_send_time ?? "19:00");
      } catch (e) {
        toast({
          title: t("admin.settings.loadFailed", "Failed to load settings"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    const threshold = parseFloat(alertThreshold);
    if (isNaN(threshold) || threshold < 0) {
      toast({ title: t("admin.settings.invalidThreshold", "Enter a valid amount ≥ 0"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await Promise.all([
        api.put("/admin/settings/low_balance_alert_enabled", { value: alertEnabled }),
        api.put("/admin/settings/low_balance_threshold", { value: threshold }),
        api.put("/admin/settings/low_balance_alert_send_time", { value: sendTime }),
      ]);
      toast({ title: t("admin.settings.saved", "Setting saved") });
    } catch (e) {
      toast({
        title: t("admin.settings.saveFailed", "Failed to save"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">
        <div className="page-header flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" />
          <div>
            <h1 className="page-title">
              {t("admin.lowBalanceAlert.title", "Low Balance Alert")}
            </h1>
            <p className="page-description">
              {t("admin.lowBalanceAlert.subtitle", "Notify parents when a student's wallet balance falls below a threshold")}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("admin.lowBalanceAlert.configTitle", "Notification Settings")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  {t("admin.settings.lowBalanceEnabled", "Enable low balance notification")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("admin.settings.lowBalanceEnabledHint", "Notify parents when a student's wallet balance falls below the threshold.")}
                </p>
              </div>
              <Switch
                checked={alertEnabled}
                disabled={loading || saving}
                onCheckedChange={setAlertEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="alert-threshold">
                {t("admin.settings.lowBalanceThreshold", "Alert threshold (฿)")}
              </Label>
              <div className="flex items-center gap-2 max-w-xs">
                <span className="text-sm text-muted-foreground font-medium">฿</span>
                <Input
                  id="alert-threshold"
                  type="number"
                  min={0}
                  step={10}
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                  disabled={!alertEnabled || loading || saving}
                  placeholder="100"
                  className="w-32"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.lowBalanceThresholdHint", "Parents will be alerted when their child's balance drops below this amount.")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="send-time">
                {t("admin.lowBalanceAlert.sendTime", "Daily send time (Bangkok time)")}
              </Label>
              <Input
                id="send-time"
                type="time"
                value={sendTime}
                onChange={(e) => setSendTime(e.target.value)}
                disabled={!alertEnabled || loading || saving}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.lowBalanceAlert.sendTimeHint", "Alerts queued during the day will be sent to parents at this time.")}
              </p>
            </div>

            <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">{t("admin.lowBalanceAlert.howItWorks", "How it works")}</p>
              <ul className="list-disc list-inside space-y-0.5 text-blue-700">
                <li>{t("admin.lowBalanceAlert.hint1", "Balance is checked after each purchase at POS")}</li>
                <li>{t("admin.lowBalanceAlert.hint2", "If below threshold, alert is queued — not sent immediately")}</li>
                <li>{t("admin.lowBalanceAlert.hint3", "All queued alerts are sent to parents at the configured daily time")}</li>
                <li>{t("admin.lowBalanceAlert.hint4", "Cooldown: one alert per parent–student pair per 24 hours")}</li>
              </ul>
            </div>

            <Button onClick={save} disabled={loading || saving}>
              {saving ? t("admin.settings.saving", "Saving…") : t("common.save", "Save")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {t("admin.lowBalanceAlert.logTitle", "Alert Queue & History")}
              {logTotal > 0 && <span className="text-sm text-muted-foreground font-normal">({logTotal} {t("admin.lowBalanceAlert.logTotalSuffix", "total")})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t("admin.lowBalanceAlert.logSubtitle", "Every student who has crossed the threshold, which parent email it will go to, and whether it's been sent yet.")}
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-sm">{t("adjustmentReport.dateFrom", "From")}</Label>
                <DatePicker value={logDateFrom} onChange={setLogDateFrom} className="w-36 h-9 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-sm">{t("adjustmentReport.dateTo", "To")}</Label>
                <DatePicker value={logDateTo} onChange={setLogDateTo} className="w-36 h-9 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-sm">{t("admin.lowBalanceAlert.logStatus", "Status")}</Label>
                <Select value={logStatus} onValueChange={(v) => setLogStatus(v as typeof logStatus)}>
                  <SelectTrigger className="w-32 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("admin.lowBalanceAlert.logStatusAll", "All")}</SelectItem>
                    <SelectItem value="pending">{t("admin.lowBalanceAlert.logStatusPending", "Pending")}</SelectItem>
                    <SelectItem value="sent">{t("admin.lowBalanceAlert.logStatusSent", "Sent")}</SelectItem>
                    <SelectItem value="failed">{t("admin.lowBalanceAlert.logStatusFailed", "Failed")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => loadLog(1)} disabled={logLoading} className="gap-1.5 h-9">
                <Search className="h-3.5 w-3.5" />
                {logLoading ? "…" : t("adjustmentReport.search", "Search")}
              </Button>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">{t("admin.lowBalanceAlert.colQueuedAt", "Queued / Sent At")}</TableHead>
                    <TableHead>{t("admin.lowBalanceAlert.colStudent", "Student")}</TableHead>
                    <TableHead>{t("admin.lowBalanceAlert.colParent", "Parent")}</TableHead>
                    <TableHead>{t("admin.lowBalanceAlert.colEmail", "Sent to email")}</TableHead>
                    <TableHead className="text-right">{t("admin.lowBalanceAlert.colBalance", "Balance at alert")}</TableHead>
                    <TableHead className="text-right">{t("admin.lowBalanceAlert.colThreshold", "Threshold")}</TableHead>
                    <TableHead className="text-center">{t("admin.lowBalanceAlert.colStatus2", "Status")}</TableHead>
                    <TableHead className="text-center">{t("admin.lowBalanceAlert.colActions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        {t("admin.lowBalanceAlert.loading", "Loading…")}
                      </TableCell>
                    </TableRow>
                  ) : logRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        {t("admin.lowBalanceAlert.logNoResults", "No students have crossed the threshold yet.")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    logRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs font-mono">{fmtDateTime(r.sent_at)}</TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{r.student_name}</p>
                          {r.student_code && <p className="text-xs font-mono text-muted-foreground">{r.student_code}</p>}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{r.parent_name}</p>
                          <p className="text-xs font-mono text-muted-foreground">@{r.parent_username}</p>
                        </TableCell>
                        <TableCell className="text-sm">{r.recipient_email}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">{formatTHB(r.balance_at_alert)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatTHB(r.threshold_amount)}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={`border-0 capitalize ${STATUS_BADGE[r.status] ?? ""}`}>
                            {t(`admin.lowBalanceAlert.logStatus${r.status.charAt(0).toUpperCase()}${r.status.slice(1)}`, r.status)}
                          </Badge>
                          {r.status === "failed" && r.error_message && (
                            <p className="text-[10px] text-destructive mt-0.5 max-w-[160px] truncate" title={r.error_message}>
                              {r.error_message}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.status !== "sent" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={sendingId === r.id}
                              title={t("admin.lowBalanceAlert.sendNow", "Send now")}
                              onClick={() => sendNow(r)}
                            >
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {logPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-sm text-muted-foreground">
                  {t("common.pageOf", { page: logPage, pages: logPages, defaultValue: `Page ${logPage} of ${logPages}` })}
                </p>
                <PaginationBar currentPage={logPage} totalPages={logPages} onPageChange={loadLog} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
