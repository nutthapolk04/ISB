import type { ReportColumn } from "@/lib/reportExport";

// Backup of the "Top Selling Report" and "Sales Report" templates as they
// existed before the 2026-07 swap requested by the customer:
//   - Top Selling Report now uses what used to be Sales Report's template
//     (4 columns incl. Status, with vendor subtotal grouping) — see the
//     `topSellingReport` branch in Reports.tsx.
//   - Sales Report now renders via the SalesByItemReport component/template
//     instead of its own inline dialog-export flow — see the `salesReport`
//     gate in Reports.tsx.
// Not imported anywhere live. Kept only so either original can be restored
// quickly if the customer wants to revert.

/** Original Top Selling Report columns — 3 columns, no Status, never
 * grouped by vendor (it was always one global ranking regardless of shop). */
export function legacyTopSellingReportColumns(t: (key: string) => string): ReportColumn[] {
    return [
        { header: t("reports.colProduct"), key: "product_name", width: 45 },
        { header: t("reports.colQuantity"), key: "quantity", format: "number", align: "right", width: 12 },
        { header: t("reports.colTotal"), key: "total", format: "currency", align: "right", width: 15 },
    ];
}

/** Original Sales Report columns — backed by /reports/sales (product-level
 * totals), 4 columns incl. Status, with vendor subtotal grouping for
 * multi-shop admin views. */
export function legacySalesReportColumns(t: (key: string) => string): ReportColumn[] {
    return [
        { header: t("reports.colProduct"), key: "product_name", width: 40 },
        { header: t("reports.colQuantity"), key: "quantity", format: "number", align: "right", width: 12 },
        { header: t("reports.colTotal"), key: "total", format: "currency", align: "right", width: 15 },
        { header: "Status", key: "status", width: 15 },
    ];
}
