import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fmtDate, fmtDateTime } from "@/lib/dateFormat";
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

export default function SyncDashboard() {
    const { t } = useTranslation();
    const [stats, setStats] = useState<SyncStats | null>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.get<SyncStats>("/sync/stats?days=30");
            setStats(data);
        } catch (e) {
            toast({
                title: t("sync.loadFailed"),
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
                            {stats?.last_sync_at ? fmtDateTime(stats.last_sync_at) : "—"}
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
                        <p className="text-sm text-muted-foreground">Daily success / failure counts from API Data Sync</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p className="text-muted-foreground text-sm py-12 text-center">{t("sync.loading")}</p>
                    ) : !stats || stats.daily.length === 0 ? (
                        <div className="py-12 text-center">
                            <p className="text-muted-foreground text-sm">{t("sync.noHistory")}</p>
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
                                        labelFormatter={(v) => fmtDate(v)}
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
        </div>
    );
}
