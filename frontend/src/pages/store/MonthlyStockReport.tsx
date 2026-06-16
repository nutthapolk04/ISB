import { useState } from "react";
import { useMonthlyStockReport } from "@/hooks/useMonthlyStock";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_BASE_URL } from "@/lib/constants";
import { toast } from "@/components/ui/sonner";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function MonthlyStockReport({ shopId }: { shopId: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  const { data: rows = [], isLoading, isError } = useMonthlyStockReport(shopId, year, month);

  async function handleExport() {
    const token = localStorage.getItem("access_token");
    const url = `${API_BASE_URL}/shops/${shopId}/monthly-stock-report/export?year=${year}&month=${month}`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `stock-report-${year}-${String(month).padStart(2, "0")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("Export failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((n, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0}>
          Export Excel
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : isError ? (
        <div className="text-destructive text-sm">Failed to load data</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground text-sm">No movements in {MONTH_NAMES[month - 1]} {year}</div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-right">Received</th>
                <th className="p-3 text-right">Sold</th>
                <th className="p-3 text-right">Internal Use</th>
                <th className="p-3 text-right">Adjustment</th>
                <th className="p-3 text-right">Net Change</th>
                <th className="p-3 text-right">Current Stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const net = r.received - r.sold - r.internal_use + r.adjustment;
                return (
                  <tr key={r.product_id ?? idx} className="border-t">
                    <td className="p-3">{r.product_name}</td>
                    <td className="p-3 text-right tabular-nums text-green-700">{r.received > 0 ? `+${r.received}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums text-red-600">{r.sold > 0 ? `-${r.sold}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums text-orange-600">{r.internal_use > 0 ? `-${r.internal_use}` : "—"}</td>
                    <td className={`p-3 text-right tabular-nums ${r.adjustment > 0 ? "text-green-700" : r.adjustment < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {r.adjustment > 0 ? `+${r.adjustment}` : r.adjustment < 0 ? `${r.adjustment}` : "—"}
                    </td>
                    <td className={`p-3 text-right tabular-nums font-medium ${net > 0 ? "text-green-700" : net < 0 ? "text-red-600" : ""}`}>
                      {net > 0 ? `+${net}` : net === 0 ? "0" : `${net}`}
                    </td>
                    <td className="p-3 text-right tabular-nums font-semibold">
                      {r.current_stock ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
