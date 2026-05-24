import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface SyncStatus {
  sync_log_id: number;
  sync_type: string;
  status: "running" | "success" | "partial" | "failed";
  target_roles: string[];
  started_at: string;
  finished_at: string | null;
  records_total: number;
  records_success: number;
  records_failed: number;
  error_log?: string | null;
}

interface SyncAuditEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  entity_name: string | null;
  external_id: string | null;
  action: "create" | "update" | "noop";
  changes: Record<string, { old: any; new: any }> | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFinished?: () => void;
}

export default function SyncRunDialog({ open, onOpenChange, onFinished }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState<SyncAuditEntry[]>([]);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setStatus(null);
      setShowAudit(false);
      setAudit([]);
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    }
  }, [open]);

  const startSync = async () => {
    setRunning(true);
    try {
      const initial = await api.post<SyncStatus>("/admin/sync/run", { sync_type: "full" });
      setStatus(initial);
      // Begin polling
      pollRef.current = window.setInterval(async () => {
        try {
          const fresh = await api.get<SyncStatus>(`/admin/sync-logs/${initial.sync_log_id}`);
          setStatus(fresh);
          if (fresh.status !== "running") {
            if (pollRef.current != null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            onFinished?.();
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    } catch (e) {
      toast({
        title: t("sync.startFailed", "Failed to start sync"),
        description: e instanceof ApiError ? e.detail : t("common.unknownError", "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  const loadAudit = async () => {
    if (!status) return;
    try {
      const rows = await api.get<SyncAuditEntry[]>(`/admin/sync-audit/${status.sync_log_id}`);
      setAudit(rows);
      setShowAudit(true);
    } catch (e) {
      toast({
        title: t("sync.loadAuditFailed", "Failed to load audit"),
        description: e instanceof ApiError ? e.detail : t("common.unknownError", "Unknown error"),
        variant: "destructive",
      });
    }
  };

  const total = status?.records_total ?? 0;
  const done = (status?.records_success ?? 0) + (status?.records_failed ?? 0);
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const isRunning = status?.status === "running";

  const statusBadge = () => {
    if (!status) return null;
    const map: Record<SyncStatus["status"], { color: string; icon: any; label: string }> = {
      running: { color: "bg-blue-100 text-blue-900",  icon: Loader2,       label: "Running" },
      success: { color: "bg-emerald-100 text-emerald-900", icon: CheckCircle2, label: "Success" },
      partial: { color: "bg-amber-100 text-amber-900", icon: AlertTriangle, label: "Partial" },
      failed:  { color: "bg-red-100 text-red-900",     icon: XCircle,       label: "Failed" },
    };
    const m = map[status.status];
    const Icon = m.icon;
    return (
      <Badge className={`${m.color} gap-1`}>
        <Icon className={`h-3 w-3 ${status.status === "running" ? "animate-spin" : ""}`} />
        {m.label}
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>PowerSchool Sync</DialogTitle>
          <DialogDescription>
            {t("sync.description", "Pull Staff / Parent / Student data from PowerSchool — runs in the background and records an audit row for every record")}
          </DialogDescription>
        </DialogHeader>

        {!status && (
          <div className="py-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("sync.idleHint", "Press Run sync to start pulling data. You can close this dialog while the sync runs — the job keeps going.")}
            </p>
            <Button onClick={startSync} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
              {running ? t("sync.starting", "Starting…") : t("sync.runFull", "Run sync (full)")}
            </Button>
          </div>
        )}

        {status && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Log #{status.sync_log_id} — {status.sync_type}</div>
              {statusBadge()}
            </div>

            <Progress value={pct} className="h-2" />

            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Total"  value={status.records_total} />
              <Stat label="Success" value={status.records_success} className="text-emerald-700" />
              <Stat label="Failed" value={status.records_failed} className="text-red-700" />
            </div>

            {!isRunning && (
              <div className="flex justify-between gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={loadAudit} disabled={showAudit}>
                  {showAudit ? "Loaded" : "View changes"}
                </Button>
                <Button size="sm" onClick={() => { setStatus(null); setShowAudit(false); setAudit([]); }}>
                  {t("sync.restart", "Restart")}
                </Button>
              </div>
            )}

            {showAudit && audit.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Changes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{row.entity_name ?? `${row.entity_type}#${row.entity_id}`}</div>
                          <div className="text-muted-foreground">{row.entity_type} · ext={row.external_id ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{row.action}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.changes ? (
                            <ul className="space-y-0.5">
                              {Object.entries(row.changes).map(([f, diff]) => (
                                <li key={f}>
                                  <span className="font-mono text-muted-foreground">{f}:</span>{" "}
                                  <span className="line-through opacity-60">{String(diff.old ?? "—")}</span>
                                  {" → "}
                                  <span className="font-medium">{String(diff.new ?? "—")}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted-foreground">no change</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {showAudit && audit.length === 0 && (
              <p className="text-center text-xs text-muted-foreground">
                {t("sync.noAuditRows", "No audit rows")}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.close", "Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-md bg-muted p-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${className ?? ""}`}>{value}</div>
    </div>
  );
}
