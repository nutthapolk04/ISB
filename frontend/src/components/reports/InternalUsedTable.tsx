import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SortableDateTimeHeader } from "@/components/SortableDateTimeHeader";
import type { DateTimeSortDir } from "@/lib/dateTimeSort";

export interface InternalUsedRow {
  id: number;
  created_at: string;
  receipt_number: string;
  amount: number;
  staff_id: string;
  staff_name: string;
  remarks: string | null;
  status: string;
}

export interface InternalUsedDepartmentGroup {
  department_id: number;
  department_code: string;
  department_name: string;
  rows: InternalUsedRow[];
  subtotal: number;
}

export interface InternalUsedReportData {
  groups: InternalUsedDepartmentGroup[];
  grand_total: number;
}

interface Props {
  data: InternalUsedReportData;
  dateTimeSort: DateTimeSortDir;
  onToggleDateTimeSort: () => void;
  emptyMessage?: string;
}

export function InternalUsedTable({
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
                  <SortableDateTimeHeader
                    label={t("admin.adminReports.colDateTime")}
                    sortDir={dateTimeSort}
                    onToggle={onToggleDateTimeSort}
                  />
                  <th className="px-2 py-2 text-left">{t("admin.adminReports.colReceiptNo")}</th>
                  <th className="px-2 py-2 text-right">{t("admin.adminReports.colAmountReceived")}</th>
                  <th className="px-2 py-2 text-left">{t("admin.adminReports.colStaffId")}</th>
                  <th className="px-2 py-2 text-left">{t("admin.adminReports.colStaffName")}</th>
                  <th className="px-2 py-2 text-left">{t("admin.adminReports.colRemarks")}</th>
                  <th className="px-2 py-2 text-left">{t("admin.adminReports.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id} className={cn("border-t", r.status !== "ACTIVE" && "opacity-60")}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.created_at.slice(0, 19).replace("T", " ")}</td>
                    <td className="px-2 py-1.5 font-mono">{r.receipt_number}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.amount.toFixed(2)}</td>
                    <td className="px-2 py-1.5 font-mono">{r.staff_id}</td>
                    <td className="px-2 py-1.5">{r.staff_name}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{r.remarks ?? ""}</td>
                    <td className="px-2 py-1.5">
                      {r.status === "ACTIVE" ? (
                        <span className="text-muted-foreground">{t("admin.adminReports.statusActive", "Active")}</span>
                      ) : (
                        <span className="font-semibold text-destructive">{t("admin.adminReports.statusVoided", "Voided")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                <tr className="border-t">
                  <td className="px-2 py-2 text-left">{t("admin.adminReports.totalByDepartment", "Total by Department")}</td>
                  <td />
                  <td className="px-2 py-2 text-right font-mono">{g.subtotal.toFixed(2)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-end gap-2 rounded-md border bg-muted px-3 py-2 text-sm font-bold">
        {t("admin.adminReports.grandTotal", "Grand Total")}
        <span className="font-mono">{data.grand_total.toFixed(2)}</span>
      </div>
    </div>
  );
}
