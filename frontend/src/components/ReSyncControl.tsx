import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoCallout } from "@/components/InfoCallout";
import { CheckCircle2, Loader2, RefreshCcw, AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type Phase = "form" | "loading" | "success" | "error";

interface SyncLogItem {
  id: number;
  sync_type: string;
  target_roles: string[];
  triggered_by_name?: string | null;
  started_at: string;
  finished_at?: string | null;
  status: string;
  records_total: number;
  records_success: number;
  records_failed: number;
  error_log?: string | null;
}

interface SyncResponse {
  sync_log_id: number;
  status: string;
  sync_type: string;
  target_roles: string[];
  records_total: number;
  records_success: number;
  records_failed: number;
  started_at: string;
  finished_at?: string | null;
  error_log?: string | null;
}

const TARGET_ROLES = ["staff", "parent", "student"];

function relativeTime(iso: string | null | undefined, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return t("resync.never");
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return t("resync.justNow");
  if (mins < 60) return t("resync.minutesAgo", { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("resync.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("resync.daysAgo", { count: days });
}

export function ReSyncControl() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [lastLog, setLastLog] = useState<SyncLogItem | null>(null);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const loadLastLog = async () => {
    if (!isAdmin) return;
    try {
      const logs = await api.get<SyncLogItem[]>("/sync/logs?limit=1");
      setLastLog(logs[0] ?? null);
    } catch {
      setLastLog(null);
    }
  };

  useEffect(() => {
    void loadLastLog();
  }, [isAdmin]);

  const handleOpen = () => {
    setPhase("form");
    setResult(null);
    setErrorMsg("");
    setOpen(true);
    void loadLastLog();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && phase === "loading") return;
    setOpen(next);
  };

  const handleConfirm = async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      const resp = await api.post<SyncResponse>("/sync/powerschool", {
        sync_type: "delta",
        target_roles: TARGET_ROLES,
      });
      setResult(resp);
      setPhase("success");
      void loadLastLog();
    } catch (e) {
      setErrorMsg(e instanceof ApiError ? e.detail : String(e));
      setPhase("error");
    }
  };

  return (
    <>
      <Button type="button" variant="outline" className="h-9 gap-2" onClick={handleOpen}>
        <RefreshCcw className="h-4 w-4" />
        <span>{t("resync.trigger")}</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          {phase === "form" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <RefreshCcw className="h-5 w-5 text-primary" />
                  {t("resync.title")}
                </DialogTitle>
                <DialogDescription>{t("resync.description")}</DialogDescription>
              </DialogHeader>

              <InfoCallout
                id="resync.schedule"
                variant="info"
                title={t("resync.info.schedule.title")}
              >
                {t("resync.info.schedule.body")}
              </InfoCallout>

              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <p className="font-medium">{t("resync.lastSync")}</p>
                {lastLog ? (
                  <>
                    <p className="text-muted-foreground">
                      {relativeTime(lastLog.finished_at ?? lastLog.started_at, t)}
                      {" · "}
                      {t("resync.summary", {
                        total: lastLog.records_total,
                        success: lastLog.records_success,
                        failed: lastLog.records_failed,
                      })}
                    </p>
                    {lastLog.triggered_by_name && (
                      <p className="text-xs text-muted-foreground">
                        {t("resync.triggeredBy", { name: lastLog.triggered_by_name })}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">{t("resync.never")}</p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="button" onClick={handleConfirm}>
                  <RefreshCcw className="h-4 w-4 mr-1" />
                  {t("resync.syncNow")}
                </Button>
              </div>
            </>
          )}

          {phase === "loading" && (
            <div className="flex flex-col items-center space-y-4 py-8 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="space-y-1">
                <p className="text-lg font-semibold">{t("resync.loadingTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("resync.loadingDescription")}
                </p>
              </div>
            </div>
          )}

          {phase === "success" && result && (
            <div className="flex flex-col items-center space-y-5 py-6 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
                <CheckCircle2 className="h-12 w-12 text-success" />
              </div>
              <div className="space-y-2">
                <p className="text-xl font-bold">{t("resync.successTitle")}</p>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-md bg-muted p-2">
                    <p className="text-muted-foreground text-xs">{t("resync.total")}</p>
                    <p className="font-semibold tabular-nums">{result.records_total}</p>
                  </div>
                  <div className="rounded-md bg-success/10 p-2">
                    <p className="text-success text-xs">{t("resync.success")}</p>
                    <p className="font-semibold tabular-nums text-success">{result.records_success}</p>
                  </div>
                  <div className="rounded-md bg-destructive/10 p-2">
                    <p className="text-destructive text-xs">{t("resync.failed")}</p>
                    <p className="font-semibold tabular-nums text-destructive">{result.records_failed}</p>
                  </div>
                </div>
              </div>
              <Button type="button" className="w-full" onClick={() => handleOpenChange(false)}>
                {t("common.confirm")}
              </Button>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center space-y-4 py-6 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-12 w-12 text-destructive" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold">{t("resync.errorTitle")}</p>
                <p className="text-sm text-muted-foreground">{errorMsg}</p>
              </div>
              <div className="flex gap-2 w-full">
                <Button type="button" variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="button" className="flex-1" onClick={handleConfirm}>
                  {t("resync.retry")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
