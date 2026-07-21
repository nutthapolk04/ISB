import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/dateFormat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Eye, Play, ChevronDown, Loader2, CheckCircle2, XCircle } from "lucide-react";

type SyncChannel = "families" | "staffs" | "departments";

interface RoundSummary {
  roundId: string;
  batchCount: number;
  startedAt: string | null;
  lastWriteAt: string | null;
  recordCount: number;
}

interface BatchResult {
  success: number;
  failed: number;
  errors: Array<{ index: number; id: string | number; error: string }>;
}

const CHANNELS: { value: SyncChannel; labelKey: string; label: string }[] = [
  { value: "families", labelKey: "manualSync.channelFamilies", label: "Families" },
  { value: "staffs", labelKey: "manualSync.channelStaffs", label: "Staffs" },
  { value: "departments", labelKey: "manualSync.channelDepartments", label: "Departments" },
];

export default function ManualSyncPanel() {
  const { t } = useTranslation();
  const [channel, setChannel] = useState<SyncChannel>("families");
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [previewRound, setPreviewRound] = useState<RoundSummary | null>(null);
  const [previewRecords, setPreviewRecords] = useState<unknown[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const [runTarget, setRunTarget] = useState<RoundSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<BatchResult | null>(null);

  const load = async (c: SyncChannel) => {
    setLoading(true);
    try {
      const data = await api.get<{ items: RoundSummary[] }>(`/admin/sync-captures/${c}`);
      setRounds(data.items);
    } catch (e) {
      toast({
        title: t("manualSync.loadFailed", "Failed to load captured rounds"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const openPreview = async (round: RoundSummary) => {
    setPreviewRound(round);
    setShowRawJson(false);
    setPreviewRecords(null);
    setPreviewLoading(true);
    try {
      const data = await api.get<{ count: number; records: unknown[] }>(
        `/admin/sync-captures/${channel}/${round.roundId}`,
      );
      setPreviewRecords(data.records);
    } catch (e) {
      toast({
        title: t("manualSync.previewFailed", "Failed to load preview"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
      setPreviewRound(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const runManualSync = async () => {
    if (!runTarget) return;
    setRunning(true);
    try {
      const result = await api.post<BatchResult>(
        `/admin/sync-captures/${channel}/${runTarget.roundId}/run`,
        {},
      );
      setRunResult(result);
    } catch (e) {
      toast({
        title: t("manualSync.runFailed", "Manual Sync failed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
      setRunTarget(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-3">
        <div>
          <CardTitle className="text-lg">{t("manualSync.title", "Manual Sync")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t(
              "manualSync.subtitle",
              "Re-run a captured round of real ISB sync data through the same upsert path used by the live hourly sync.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={channel} onValueChange={(v) => setChannel(v as SyncChannel)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{t(c.labelKey, c.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => load(channel)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground text-sm py-8 text-center">{t("manualSync.loading", "Loading…")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("manualSync.colRound", "Round")}</TableHead>
                <TableHead>{t("manualSync.colStarted", "Started")}</TableHead>
                <TableHead>{t("manualSync.colLastWrite", "Last write")}</TableHead>
                <TableHead className="text-right">{t("manualSync.colBatches", "Batches")}</TableHead>
                <TableHead className="text-right">{t("manualSync.colRecords", "Records")}</TableHead>
                <TableHead className="text-right">{t("manualSync.colActions", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rounds.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {t("manualSync.empty", "No captured rounds for this channel yet")}
                  </TableCell>
                </TableRow>
              )}
              {rounds.map((r) => (
                <TableRow key={r.roundId}>
                  <TableCell className="font-mono text-xs">{r.roundId}</TableCell>
                  <TableCell className="text-xs">{r.startedAt ? fmtDateTime(r.startedAt) : "—"}</TableCell>
                  <TableCell className="text-xs">{r.lastWriteAt ? fmtDateTime(r.lastWriteAt) : "—"}</TableCell>
                  <TableCell className="text-right text-xs font-mono">{r.batchCount}</TableCell>
                  <TableCell className="text-right text-xs font-mono">{r.recordCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openPreview(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRunTarget(r)}>
                        <Play className="h-4 w-4 mr-1" /> {t("manualSync.run", "Run Manual Sync")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Preview dialog */}
      <Dialog open={!!previewRound} onOpenChange={(o) => !o && setPreviewRound(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("manualSync.previewTitle", "Preview round")} {previewRound?.roundId}</DialogTitle>
            <DialogDescription>
              {previewRound?.batchCount} {t("manualSync.batches", "batch(es)")} ·{" "}
              {previewRound?.startedAt ? fmtDateTime(previewRound.startedAt) : "—"}
            </DialogDescription>
          </DialogHeader>

          {previewLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                {t("manualSync.previewSummary", "{{count}} record(s) will be replayed through the real upsert path", {
                  count: previewRecords?.length ?? 0,
                })}
              </div>

              <Collapsible open={showRawJson} onOpenChange={setShowRawJson}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between">
                    {t("manualSync.viewRaw", "View raw data")}
                    <ChevronDown className={`h-4 w-4 transition-transform ${showRawJson ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 bg-muted rounded-md p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                    {JSON.stringify(previewRecords, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewRound(null)}>
              {t("common.close", "Close")}
            </Button>
            <Button
              disabled={previewLoading}
              onClick={() => {
                const target = previewRound;
                setPreviewRound(null);
                if (target) setRunTarget(target);
              }}
            >
              <Play className="h-4 w-4 mr-1" /> {t("manualSync.run", "Run Manual Sync")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-before-run */}
      <AlertDialog
        open={!!runTarget && !runResult}
        onOpenChange={(open) => !open && !running && setRunTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("manualSync.confirmTitle", "Run Manual Sync?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "manualSync.confirmDesc",
                "This replays round {{roundId}} ({{count}} records) through the real upsert path — the same one the live ISB sync uses. Existing records will be updated in place.",
                { roundId: runTarget?.roundId, count: runTarget?.recordCount },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={runManualSync} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              {running ? t("manualSync.running", "Running…") : t("manualSync.run", "Run Manual Sync")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Result dialog */}
      <Dialog open={!!runResult} onOpenChange={(o) => { if (!o) { setRunResult(null); setRunTarget(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {runResult && runResult.failed === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              {t("manualSync.resultTitle", "Manual Sync complete")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-md bg-emerald-50 p-2">
                <div className="text-xs text-emerald-700">{t("manualSync.success", "Success")}</div>
                <div className="text-xl font-bold tabular-nums text-emerald-700">{runResult?.success ?? 0}</div>
              </div>
              <div className="rounded-md bg-red-50 p-2">
                <div className="text-xs text-destructive">{t("manualSync.failed", "Failed")}</div>
                <div className="text-xl font-bold tabular-nums text-destructive">{runResult?.failed ?? 0}</div>
              </div>
            </div>
            {runResult && runResult.errors.length > 0 && (
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap">
                {runResult.errors.map((e) => `#${e.index} (${e.id}): ${e.error}`).join("\n")}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => { setRunResult(null); setRunTarget(null); }}>
              {t("common.close", "Close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
