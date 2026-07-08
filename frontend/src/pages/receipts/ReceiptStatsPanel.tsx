import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

interface ReceiptStatsPanelProps {
  todaySales: number;
  displayMonthlySales: number;
  displayMonthlyCount: number;
}

export function ReceiptStatsPanel({ todaySales, displayMonthlySales, displayMonthlyCount }: ReceiptStatsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="kpi-card">
        <CardHeader>
          <CardTitle className="kpi-label">{t("receipts.todaySales")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="kpi-value text-success">฿{todaySales.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card className="kpi-card">
        <CardHeader>
          <CardTitle className="kpi-label">{t("receipts.totalSalesMonthly", "Total Sales Monthly")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="kpi-value text-primary">฿{displayMonthlySales.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card className="kpi-card">
        <CardHeader>
          <CardTitle className="kpi-label">{t("receipts.receiptCountMonthly", "Receipt Count Monthly")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="kpi-value">{displayMonthlyCount}</p>
        </CardContent>
      </Card>
    </div>
  );
}
