import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCloseDetail,
  useBulkUpdateItems,
  useImportExcel,
  useConfirmClose,
} from "@/hooks/useCloseMonth";
import { ApiError } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function CloseMonthDetail() {
  const { closeId } = useParams<{ closeId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const shopId = user?.shopId ?? "";
  const id = parseInt(closeId ?? "0");

  const { data: close, isLoading } = useCloseDetail(shopId, id);
  const bulkUpdate = useBulkUpdateItems(shopId, id);
  const importExcelMutation = useImportExcel(shopId, id);
  const confirm = useConfirmClose(shopId, id);

  const [localQty, setLocalQty] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const isClosed = close?.status === "closed";

  function getQty(itemId: number, fallback: number | null): string {
    if (itemId in localQty) return localQty[itemId];
    return fallback !== null ? String(fallback) : "";
  }

  async function handleSave() {
    const updates = Object.entries(localQty)
      .map(([itemId, qty]) => ({ item_id: parseInt(itemId), physical_qty: parseInt(qty) }))
      .filter((u) => !isNaN(u.physical_qty) && u.physical_qty >= 0);
    if (updates.length === 0) return;
    try {
      await bulkUpdate.mutateAsync(updates);
      setLocalQty({});
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : (e as Error)?.message ?? "An error occurred");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importExcelMutation.mutateAsync(file);
      toast.success(`Imported ${result.imported} items (skipped ${result.skipped})`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : (err as Error)?.message ?? "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleConfirm() {
    if (!window.confirm("Confirm closing this period? The system will create stock adjustment entries based on the variance.")) return;
    try {
      await confirm.mutateAsync();
      toast.success("Period closed successfully");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : (e as Error)?.message ?? "An error occurred");
    }
  }

  async function handleExportCsv() {
    const token = localStorage.getItem("access_token");
    const url = `${API_BASE_URL}/shops/${shopId}/close-month/${id}/export-excel`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `close-${id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("Download failed");
    }
  }

  if (!shopId) return <div className="p-6 text-muted-foreground">No shop assigned</div>;
  if (!id || isNaN(id)) return <div className="p-6 text-muted-foreground">Invalid close period ID</div>;
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!close) return <div className="p-6 text-muted-foreground">Not found</div>;

  const filledCount = close.items.filter((i) => {
    const v = localQty[i.id];
    return v !== undefined ? v !== "" : i.physical_qty !== null;
  }).length;
  const totalCount = close.items.length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/store/close-month")}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold">
          Close Period {MONTH_NAMES[close.period_month - 1]} {close.period_year}
        </h1>
        <Badge variant={isClosed ? "success" : "secondary"}>
          {isClosed ? "Closed" : "Draft"}
        </Badge>
      </div>

      {/* Warning banner */}
      {close.has_backdated_movements && (
        <div className="rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Some movements occurred after this period was created. Data may not reflect the current state.
        </div>
      )}

      <Tabs defaultValue="count">
        <TabsList>
          <TabsTrigger value="count">Stock Count ({filledCount}/{totalCount})</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        {/* Tab 1: Physical count + Import Excel */}
        <TabsContent value="count" className="space-y-3">
          {!isClosed && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                  Download Excel Template
                </Button>
                <label className={`text-sm cursor-pointer px-3 py-1.5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground ${importExcelMutation.isPending ? "opacity-50 pointer-events-none" : ""}`}>
                  {importExcelMutation.isPending ? "Importing..." : "Import Excel"}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={handleImport}
                    disabled={importExcelMutation.isPending}
                  />
                </label>
              </div>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={bulkUpdate.isPending || Object.keys(localQty).length === 0}
              >
                {bulkUpdate.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          )}
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Product</th>
                  <th className="p-3 text-right">System Qty</th>
                  <th className="p-3 text-right">Physical Count</th>
                  <th className="p-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {close.items.map((item) => {
                  const physical = getQty(item.id, item.physical_qty);
                  const physNum = physical !== "" ? parseInt(physical) : null;
                  const variance = physNum !== null ? physNum - item.system_qty : null;
                  return (
                    <tr key={item.id} className="border-t">
                      <td className="p-3">{item.product_name}</td>
                      <td className="p-3 text-right tabular-nums">{item.system_qty}</td>
                      <td className="p-3 text-right">
                        {isClosed ? (
                          <span className="tabular-nums">{item.physical_qty ?? "—"}</span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            className="w-24 text-right ml-auto"
                            value={physical}
                            onChange={(e) =>
                              setLocalQty((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                        )}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${
                          variance === null
                            ? "text-muted-foreground"
                            : variance < 0
                            ? "text-red-600"
                            : variance > 0
                            ? "text-green-600"
                            : ""
                        }`}
                      >
                        {variance === null ? "—" : variance > 0 ? `+${variance}` : variance}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Tab 3: Summary */}
        <TabsContent value="summary" className="space-y-4">
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Product</th>
                  <th className="p-3 text-right">System Qty</th>
                  <th className="p-3 text-right">Physical Count</th>
                  <th className="p-3 text-right">Variance</th>
                  <th className="p-3 text-right">Variance Value</th>
                </tr>
              </thead>
              <tbody>
                {close.items
                  .filter((i) => i.physical_qty !== null)
                  .map((item) => {
                    const v = item.physical_qty! - item.system_qty;
                    const val = item.unit_cost
                      ? (v * parseFloat(item.unit_cost)).toFixed(2)
                      : null;
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="p-3">{item.product_name}</td>
                        <td className="p-3 text-right tabular-nums">{item.system_qty}</td>
                        <td className="p-3 text-right tabular-nums">{item.physical_qty}</td>
                        <td
                          className={`p-3 text-right tabular-nums ${
                            v < 0 ? "text-red-600" : v > 0 ? "text-green-600" : ""
                          }`}
                        >
                          {v > 0 ? `+${v}` : v}
                        </td>
                        <td
                          className={`p-3 text-right tabular-nums ${
                            v < 0 ? "text-red-600" : v > 0 ? "text-green-600" : ""
                          }`}
                        >
                          {val !== null ? `฿${val}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {!isClosed && (
            <div className="flex justify-end">
              <Button
                onClick={handleConfirm}
                disabled={confirm.isPending || filledCount < totalCount}
              >
                {confirm.isPending
                  ? "Closing..."
                  : filledCount < totalCount
                  ? `Incomplete (${filledCount}/${totalCount})`
                  : "Confirm Close Period"}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
