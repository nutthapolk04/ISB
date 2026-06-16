import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCloseList, useCreateClose } from "@/hooks/useCloseMonth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const MONTH_NAMES_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export default function CloseMonthList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const shopId = user?.shopId ?? "";

  const { data: closes = [], isLoading } = useCloseList(shopId);
  const createClose = useCreateClose(shopId);

  const [open, setOpen] = useState(false);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  async function handleCreate() {
    try {
      const result = await createClose.mutateAsync({ period_year: year, period_month: month });
      setOpen(false);
      navigate(`/store/close-month/${result.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? "เกิดข้อผิดพลาด");
    }
  }

  if (!shopId) {
    return <div className="p-6 text-muted-foreground">ไม่พบร้านค้าที่กำหนด</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ปิดรอบเดือน</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>+ เริ่มปิดรอบ</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>เลือกรอบที่ต้องการปิด</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground">ปี</label>
                  <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">เดือน</label>
                  <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES_TH.map((n, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={createClose.isPending}
              >
                {createClose.isPending ? "กำลังสร้าง..." : "สร้างรอบปิด"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">กำลังโหลด...</div>
      ) : closes.length === 0 ? (
        <div className="text-muted-foreground">ยังไม่มีรอบปิดเดือน</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">เดือน</th>
                <th className="p-3 text-left">สถานะ</th>
                <th className="p-3 text-left">วันที่ปิด</th>
              </tr>
            </thead>
            <tbody>
              {closes.map((c) => (
                <tr
                  key={c.id}
                  className="border-t cursor-pointer hover:bg-muted/30"
                  onClick={() => navigate(`/store/close-month/${c.id}`)}
                >
                  <td className="p-3">
                    {MONTH_NAMES_TH[c.period_month - 1]} {c.period_year}
                  </td>
                  <td className="p-3">
                    <Badge variant={c.status === "closed" ? "success" : "secondary"}>
                      {c.status === "closed" ? "ปิดแล้ว" : "ร่าง"}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {c.closed_at
                      ? new Date(c.closed_at).toLocaleDateString("th-TH")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
