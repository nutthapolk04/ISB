import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { RefreshCw, TrendingUp, TrendingDown, Clock } from "lucide-react";

interface SyncStats {
  total_runs: number;
  total_success: number;
  total_failed: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  daily: { date: string; success: number; failed: number }[];
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
  finished_at: string | null;
  error_log: string | null;
}

const ALL_ROLES = ["student", "parent", "staff", "admin", "manager", "cashier"];

export default function SyncDashboard() {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncType, setSyncType] = useState<"delta" | "full">("delta");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["student", "parent", "staff"]);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<SyncStats>("/sync/stats?days=30");
      setStats(data);
    } catch (e) {
      toast({
        title: "โหลดสถิติไม่สำเร็จ",
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

  const toggleRole = (r: string) => {
    setSelectedRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  const runSync = async () => {
    if (selectedRoles.length === 0) {
      toast({ title: "กรุณาเลือกอย่างน้อย 1 role", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<SyncResponse>("/sync/powerschool", {
        sync_type: syncType,
        target_roles: selectedRoles,
      });
      toast({
        title: `Sync ${res.status}`,
        description: `${res.records_success} success, ${res.records_failed} failed (${res.records_total} total)`,
      });
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({
        title: "Sync ไม่สำเร็จ",
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Total runs (30d)</div>
            <div className="text-2xl font-bold">{stats?.total_runs ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-green-600" /> Records synced
            </div>
            <div className="text-2xl font-bold text-green-600">{stats?.total_success ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-destructive" /> Failures
            </div>
            <div className={`text-2xl font-bold ${(stats?.total_failed ?? 0) > 0 ? "text-destructive" : ""}`}>
              {stats?.total_failed ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last sync
            </div>
            <div className="text-sm font-medium mt-1">
              {stats?.last_sync_at ? new Date(stats.last_sync_at).toLocaleString() : "—"}
            </div>
            {stats?.last_sync_status && (
              <Badge
                className="mt-1"
                variant={
                  stats.last_sync_status === "success"
                    ? "default"
                    : stats.last_sync_status === "partial"
                    ? "secondary"
                    : "destructive"
                }
              >
                {stats.last_sync_status}
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action bar */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg">Last 30 days</CardTitle>
            <p className="text-sm text-muted-foreground">Daily success / failure counts from PowerSchool syncs</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <RefreshCw className="h-4 w-4 mr-1" /> Sync Now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm py-12 text-center">กำลังโหลด...</p>
          ) : !stats || stats.daily.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground text-sm">ยังไม่มีการ sync — กดปุ่ม Sync Now เพื่อเริ่มต้น</p>
            </div>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.daily} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    contentStyle={{ borderRadius: "6px", border: "1px solid #e5e7eb" }}
                  />
                  <Legend />
                  <Bar dataKey="success" fill="#16a34a" name="Success" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="failed" fill="#dc2626" name="Failed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trigger PowerSchool Sync</DialogTitle>
            <DialogDescription>
              เลือกประเภทการ sync และ roles ที่ต้องการอัปเดต (mock — ไม่เรียก HTTP จริง)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Sync type</Label>
              <Select value={syncType} onValueChange={(v) => setSyncType(v as "delta" | "full")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delta">Delta — only recent changes (~60%)</SelectItem>
                  <SelectItem value="full">Full — every matching record</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Target roles</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_ROLES.map((r) => (
                  <Badge
                    key={r}
                    variant={selectedRoles.includes(r) ? "default" : "outline"}
                    className="cursor-pointer capitalize"
                    onClick={() => toggleRole(r)}
                  >
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              ยกเลิก
            </Button>
            <Button onClick={runSync} disabled={submitting}>
              {submitting ? "กำลัง sync..." : "เริ่ม Sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
