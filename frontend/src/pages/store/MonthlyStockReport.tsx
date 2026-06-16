import { useState } from "react";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useMonthlyStockReport } from "@/hooks/useMonthlyStock";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportToPDF } from "@/lib/reportExport";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { API_BASE_URL } from "@/lib/constants";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

function toYMD(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export default function MonthlyStockReport({ shopId }: { shopId: string }) {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [range, setRange] = useState<DateRange | undefined>({ from: firstOfMonth, to: now });
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const school = useSchoolInfo();

  const startDate = range?.from ? toYMD(range.from) : "";
  const endDate = range?.to ? toYMD(range.to) : "";

  const { data: rows = [], isLoading, isError, error } = useMonthlyStockReport(shopId, startDate, endDate);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function handleExportExcel() {
    const token = localStorage.getItem("access_token");
    const url = `${API_BASE_URL}/shops/${shopId}/monthly-stock-report/export?start_date=${startDate}&end_date=${endDate}`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `stock-report-${startDate}-to-${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("Export failed");
    }
  }

  async function handleExportPDF() {
    try {
      await exportToPDF(
        {
          meta: {
            title: "Monthly Stock Report",
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            filters: [`Period: ${startDate} — ${endDate}`],
          },
          columns: [
            { header: "Product",       key: "product_name",  align: "left" },
            { header: "Received",      key: "received",      format: "number", align: "right" },
            { header: "Sold",          key: "sold",          format: "number", align: "right" },
            { header: "Internal Use",  key: "internal_use",  format: "number", align: "right" },
            { header: "Adjustment",    key: "adjustment",    format: "number", align: "right" },
            { header: "Net Change",    key: "net",           format: "number", align: "right" },
            { header: "Current Stock", key: "current_stock", format: "number", align: "right" },
          ],
          rows: rows.map((r) => ({
            product_name:  r.product_name,
            received:      r.received,
            sold:          r.sold,
            internal_use:  r.internal_use,
            adjustment:    r.adjustment,
            net:           r.received - r.sold - r.internal_use + r.adjustment,
            current_stock: r.current_stock ?? "",
          })),
        },
        `stock-report-${startDate}-to-${endDate}.pdf`,
      );
    } catch {
      toast.error("PDF export failed");
    }
  }

  const triggerLabel = range?.from
    ? range.to
      ? `${format(range.from, "d MMM yyyy")} — ${format(range.to, "d MMM yyyy")}`
      : format(range.from, "d MMM yyyy")
    : "Select date range";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn("justify-start text-left font-normal w-72", !range && "text-muted-foreground")}
            >
              <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
              {triggerLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="p-2 border-b text-sm font-medium text-muted-foreground px-3 py-2">
              Start Date — End Date
            </div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={range}
              onSelect={(r) => {
                setRange(r);
                setPage(1);
                if (r?.from && r?.to) setOpen(false);
              }}
              disabled={{ after: now }}
              defaultMonth={firstOfMonth}
            />
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={rows.length === 0 || !startDate || !endDate}>
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleExportExcel}>Excel (.xlsx)</DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportPDF}>PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!startDate || !endDate ? (
        <div className="text-muted-foreground text-sm">Select a date range to view report</div>
      ) : isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : isError ? (
        <div className="text-destructive text-sm">Failed to load data: {(error as Error)?.message}</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground text-sm">No movements from {startDate} to {endDate}</div>
      ) : (
        <div className="space-y-3">
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
                {pageRows.map((r, idx) => {
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} of {rows.length} items
              </span>
              <Pagination className="w-auto mx-0">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                    />
                  </PaginationItem>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce<(number | "ellipsis")[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("ellipsis");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`e-${i}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            href="#"
                            isActive={p === currentPage}
                            onClick={(e) => { e.preventDefault(); setPage(p); }}
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => { e.preventDefault(); setPage((p) => Math.min(totalPages, p + 1)); }}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
