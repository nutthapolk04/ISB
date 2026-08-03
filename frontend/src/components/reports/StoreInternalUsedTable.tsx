import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/dateFormat";
import { SortableDateTimeHeader } from "@/components/SortableDateTimeHeader";
import type { DateTimeSortDir } from "@/lib/dateTimeSort";
import type { InternalUsedRow, InternalUsedReportData } from "@/components/reports/InternalUsedTable";

export type { InternalUsedReportData as StoreInternalUsedReportData };

interface Props {
  data: InternalUsedReportData;
  dateTimeSort: DateTimeSortDir;
  onToggleDateTimeSort: () => void;
  emptyMessage?: string;
}

/** Store/Canteen-facing variant of the Internal Used Report table — same
 *  department-grouped data (reuses InternalUsedTable's response type), but
 *  its own column set and total labels per the store-side spec. Kept as a
 *  separate component (not a shared prop toggle on InternalUsedTable) so the
 *  admin-only Internal Used Report page's columns/wording never move when
 *  this one is adjusted. */
export function StoreInternalUsedTable({
  data,
  dateTimeSort,
  onToggleDateTimeSort,
  emptyMessage,
}: Props) {
  const { t } = useTranslation();

  if (data.groups.length === 0) {
    return (
      <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
        {emptyMessage ?? t("admin.adminReports.internalUsedEmpty", "No internal-use receipts match these filters.")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.groups.map((g) => (
        <div key={g.department_id} className="space-y-2">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm font-semibold">
            {t("admin.adminReports.departmentHeader", "Department code")} : {g.department_code}   {g.department_name}
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 whitespace-nowrap">
                <tr>
                  <th className="px-2 py-2 text-left w-12">{t("admin.adminReports.colSeq", "Seq.")}</th>
                  <th className="px-2 py-2 text-left min-w-[9rem]">{t("admin.adminReports.colReceiptNo")}</th>
                  <SortableDateTimeHeader
                    label={t("admin.adminReports.colDateTime")}
                    sortDir={dateTimeSort}
                    onToggle={onToggleDateTimeSort}
                  />
                  <th className="px-2 py-2 text-left">{t("admin.adminReports.colCashierId", "Cashier ID")}</th>
                  <th className="px-2 py-2 text-left">{t("admin.adminReports.colStaffId", "Staff ID")}</th>
                  <th className="px-2 py-2 text-right">{t("admin.adminReports.colAmtBilling", "Amt. Billing")}</th>
                  <th className="px-2 py-2 text-left max-w-[8rem]">{t("admin.adminReports.colRemark", "Remark")}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r: InternalUsedRow, idx: number) => (
                  <tr key={r.id} className={cn("border-t", r.status !== "ACTIVE" && "opacity-60")}>
                    <td className="px-2 py-1.5">{idx + 1}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{r.receipt_number}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{r.cashier_id}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{r.isb_id}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.amount.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground max-w-[8rem] truncate" title={r.remarks ?? ""}>{r.remarks ?? ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                <tr className="border-t">
                  <td colSpan={4} className="px-2 py-2 text-left">{t("admin.adminReports.total", "TOTAL")}</td>
                  <td />
                  <td className="px-2 py-2 text-right font-mono">{g.subtotal.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-end gap-2 rounded-md border bg-muted px-3 py-2 text-sm font-bold">
        {t("admin.adminReports.grandTotalCaps", "Grand TOTAL")}
        <span className="font-mono">{data.grand_total.toFixed(2)}</span>
      </div>
    </div>
  );
}
