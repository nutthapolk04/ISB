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
import { toast } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function CloseMonthList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const shopId = user?.shopId ?? "";

  const { data: closes = [], isLoading, isError } = useCloseList(shopId);
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
      toast.error(e instanceof ApiError ? e.detail : (e as Error)?.message ?? "An error occurred");
    }
  }

  if (!shopId) {
    return <div className="p-6 text-muted-foreground">No shop assigned</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Close Month</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>+ Start Close Period</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Select Period to Close</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground">Year</label>
                  <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Month</label>
                  <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((n, i) => (
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
                {createClose.isPending ? "Creating..." : "Create Close Period"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : isError ? (
        <div className="text-destructive text-sm">Failed to load data</div>
      ) : closes.length === 0 ? (
        <div className="text-muted-foreground">No close periods yet</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">Month</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Closed Date</th>
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
                    {MONTH_NAMES[c.period_month - 1]} {c.period_year}
                  </td>
                  <td className="p-3">
                    <Badge variant={c.status === "closed" ? "success" : "secondary"}>
                      {c.status === "closed" ? "Closed" : "Draft"}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {c.closed_at
                      ? new Date(c.closed_at).toLocaleDateString("en-GB")
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
