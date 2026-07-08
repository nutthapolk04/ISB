import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/dateFormat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Eye } from "lucide-react";

interface LogItem {
  id: number;
  sync_type: string;
  target_roles: string[];
  triggered_by_name: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_total: number;
  records_success: number;
  records_failed: number;
  error_log: string | null;
}

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "success") return "default";
  if (s === "partial") return "secondary";
  if (s === "failed") return "destructive";
  return "outline";
};

export default function SyncLog() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LogItem | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<LogItem[]>("/sync/logs?limit=100");
      setLogs(data);
    } catch (e) {
      toast({
        title: t("syncLog.loadFailed", "Failed to load sync log"),
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

  const duration = (a: string, b: string | null) => {
    if (!b) return "—";
    const ms = new Date(b).getTime() - new Date(a).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-lg">{t("syncLog.title", "Sync log")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("syncLog.subtitle", "Last 100 sync runs")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> {t("syncLog.refresh", "Refresh")}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground text-sm py-8 text-center">{t("syncLog.loading", "Loading…")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t("syncLog.colStarted", "Started")}</TableHead>
                <TableHead>{t("syncLog.colType", "Type")}</TableHead>
                <TableHead>{t("syncLog.colRoles", "Roles")}</TableHead>
                <TableHead>{t("syncLog.colBy", "By")}</TableHead>
                <TableHead>{t("syncLog.colDuration", "Duration")}</TableHead>
                <TableHead className="text-right">{t("syncLog.colRecords", "Records")}</TableHead>
                <TableHead>{t("syncLog.colStatus", "Status")}</TableHead>
                <TableHead className="text-right">{t("syncLog.colActions", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    {t("syncLog.empty", "No sync runs recorded yet")}
                  </TableCell>
                </TableRow>
              )}
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">#{l.id}</TableCell>
                  <TableCell className="text-xs">
                    {fmtDateTime(l.started_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{l.sync_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {l.target_roles.map((r) => (
                        <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{l.triggered_by_name || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{duration(l.started_at, l.finished_at)}</TableCell>
                  <TableCell className="text-right text-xs font-mono">
                    <span className="text-green-600">{l.records_success}</span>
                    {" / "}
                    <span className={l.records_failed > 0 ? "text-destructive" : ""}>{l.records_failed}</span>
                    {" / "}
                    <span className="text-muted-foreground">{l.records_total}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(l.status)} className="capitalize">{l.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelected(l)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sync #{selected?.id} — {selected?.status}</DialogTitle>
            <DialogDescription>
              {selected && fmtDateTime(selected.started_at)} • {selected?.sync_type} • {selected?.records_total} records
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Success</div><div className="font-mono font-semibold text-green-600">{selected?.records_success}</div></div>
              <div><div className="text-xs text-muted-foreground">Failed</div><div className="font-mono font-semibold text-destructive">{selected?.records_failed}</div></div>
              <div><div className="text-xs text-muted-foreground">Total</div><div className="font-mono font-semibold">{selected?.records_total}</div></div>
            </div>
            {selected?.error_log ? (
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t("syncLog.errorLog", "Error log")}</div>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-80 whitespace-pre-wrap">
                  {selected.error_log}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("syncLog.noErrors", "No errors recorded")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
