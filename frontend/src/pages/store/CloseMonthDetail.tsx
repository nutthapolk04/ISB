import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCloseDetail,
  useBulkUpdateItems,
  useImportCsv,
  useConfirmClose,
} from "@/hooks/useCloseMonth";
import { ApiError } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";

const MONTH_NAMES_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export default function CloseMonthDetail() {
  const { closeId } = useParams<{ closeId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const shopId = user?.shopId ?? "";
  const id = parseInt(closeId ?? "0");

  const { data: close, isLoading } = useCloseDetail(shopId, id);
  const bulkUpdate = useBulkUpdateItems(shopId, id);
  const importCsvMutation = useImportCsv(shopId, id);
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
      toast.success("บันทึกแล้ว");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : (e as Error)?.message ?? "เกิดข้อผิดพลาด");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importCsvMutation.mutateAsync(file);
      toast.success(`นำเข้า ${result.imported} รายการ (ข้าม ${result.skipped} รายการ)`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : (err as Error)?.message ?? "นำเข้าไม่สำเร็จ");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleConfirm() {
    if (!window.confirm("ยืนยันปิดรอบเดือนนี้? ระบบจะสร้างรายการปรับสต๊อกตามผลต่าง")) return;
    try {
      await confirm.mutateAsync();
      toast.success("ปิดรอบเดือนสำเร็จ");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : (e as Error)?.message ?? "เกิดข้อผิดพลาด");
    }
  }

  async function handleExportCsv() {
    const token = localStorage.getItem("access_token");
    const url = `${API_BASE_URL}/shops/${shopId}/close-month/${id}/export-csv`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `close-${id}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("ดาวน์โหลดไม่สำเร็จ");
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">กำลังโหลด...</div>;
  if (!close) return <div className="p-6 text-muted-foreground">ไม่พบข้อมูล</div>;

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
          ← กลับ
        </button>
        <h1 className="text-xl font-semibold">
          ปิดรอบ {MONTH_NAMES_TH[close.period_month - 1]} {close.period_year}
        </h1>
        <Badge variant={isClosed ? "success" : "secondary"}>
          {isClosed ? "ปิดแล้ว" : "ร่าง"}
        </Badge>
      </div>

      {/* Warning banner */}
      {close.has_backdated_movements && (
        <div className="rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          มีรายการ movement ที่เกิดขึ้นหลังจากสร้างรอบนี้ ข้อมูลอาจไม่ตรงกับความเป็นจริง
        </div>
      )}

      <Tabs defaultValue="count">
        <TabsList>
          <TabsTrigger value="count">นับสต๊อก ({filledCount}/{totalCount})</TabsTrigger>
          <TabsTrigger value="csv">นำเข้า CSV</TabsTrigger>
          <TabsTrigger value="summary">สรุป</TabsTrigger>
        </TabsList>

        {/* Tab 1: Physical count */}
        <TabsContent value="count" className="space-y-3">
          {!isClosed && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={bulkUpdate.isPending || Object.keys(localQty).length === 0}
              >
                {bulkUpdate.isPending ? "กำลังบันทึก..." : "บันทึก"}
              </Button>
            </div>
          )}
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">สินค้า</th>
                  <th className="p-3 text-right">ในระบบ</th>
                  <th className="p-3 text-right">นับจริง</th>
                  <th className="p-3 text-right">ผลต่าง</th>
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

        {/* Tab 2: CSV */}
        <TabsContent value="csv" className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              ดาวน์โหลด template แล้วกรอก physical_qty จากนั้นอัปโหลดกลับ
            </p>
            <Button variant="outline" onClick={handleExportCsv}>
              ดาวน์โหลด CSV Template
            </Button>
          </div>
          {!isClosed && (
            <div className="space-y-2">
              <p className="text-sm font-medium">อัปโหลด CSV ที่กรอกแล้ว</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="text-sm"
                onChange={handleImport}
                disabled={importCsvMutation.isPending}
              />
              {importCsvMutation.isPending && (
                <p className="text-sm text-muted-foreground">กำลังนำเข้า...</p>
              )}
            </div>
          )}
        </TabsContent>

        {/* Tab 3: Summary */}
        <TabsContent value="summary" className="space-y-4">
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">สินค้า</th>
                  <th className="p-3 text-right">ในระบบ</th>
                  <th className="p-3 text-right">นับจริง</th>
                  <th className="p-3 text-right">ผลต่าง</th>
                  <th className="p-3 text-right">มูลค่าต่าง</th>
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
                  ? "กำลังปิดรอบ..."
                  : filledCount < totalCount
                  ? `ยังกรอกไม่ครบ (${filledCount}/${totalCount})`
                  : "ยืนยันปิดรอบ"}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
