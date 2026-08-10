import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useTranslation } from "react-i18next";

interface AppliedTransactionSearch {
  dateFrom: string;
  dateTo: string;
  paymentType: string;
  status: string;
}

interface TransactionSearchPanelProps {
  searchDateFrom: string;
  onDateFromChange: (v: string) => void;
  searchDateTo: string;
  onDateToChange: (v: string) => void;
  searchPaymentType: string;
  onPaymentTypeChange: (v: string) => void;
  searchStatus: string;
  onStatusChange: (v: string) => void;
  appliedSearch: AppliedTransactionSearch;
  hasActiveSearch: boolean;
  resultsCount: number;
  onSearch: () => void;
  onClearSearch: () => void;
}

export function TransactionSearchPanel({
  searchDateFrom, onDateFromChange,
  searchDateTo, onDateToChange,
  searchPaymentType, onPaymentTypeChange,
  searchStatus, onStatusChange,
  appliedSearch, hasActiveSearch, resultsCount,
  onSearch, onClearSearch,
}: TransactionSearchPanelProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{t("receipts.transactions.searchTitle", "Search Transactions")}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Date range */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("receipts.searchPanel.date", "Purchase Date")}
            </label>
            <DateRangePicker
              startDate={searchDateFrom}
              endDate={searchDateTo}
              onStartChange={onDateFromChange}
              onEndChange={onDateToChange}
            />
          </div>

          {/* Payment Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("receipts.searchPanel.paymentType", "Payment Type")}
            </label>
            <Select value={searchPaymentType} onValueChange={onPaymentTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("receipts.searchPanel.allTypes", "All")}</SelectItem>
                <SelectItem value="wallet">{t("common.paymentMethods.campus_card", "Campus Card")}</SelectItem>
                <SelectItem value="cash">{t("common.paymentMethods.cash", "Cash")}</SelectItem>
                <SelectItem value="bay_qr">{t("common.paymentMethods.thai_qr", "Thai QR")}</SelectItem>
                <SelectItem value="edc">{t("common.paymentMethods.edc_qr", "EDC QR")}</SelectItem>
                <SelectItem value="department">{t("common.paymentMethods.department", "Budget Deduction")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("receipts.transactions.status", "Status")}
            </label>
            <Select value={searchStatus} onValueChange={onStatusChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("receipts.searchPanel.allTypes", "All")}</SelectItem>
                <SelectItem value="pending">{t("receipts.transactions.statusPending", "Pending")}</SelectItem>
                <SelectItem value="success">{t("receipts.transactions.statusSuccess", "Success")}</SelectItem>
                <SelectItem value="failed">{t("receipts.transactions.statusFailed", "Failed")}</SelectItem>
                <SelectItem value="cancelled">{t("receipts.transactions.statusCancelled", "Cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 mt-4">
          {hasActiveSearch && (
            <Button variant="ghost" size="sm" onClick={onClearSearch} className="text-muted-foreground">
              {t("receipts.searchPanel.clear", "ล้างตัวกรอง")}
            </Button>
          )}
          <Button
            onClick={onSearch}
            className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
          >
            <Search className="h-4 w-4" />
            {t("receipts.searchPanel.search", "Search Receipt")}
          </Button>
        </div>

        {/* Active filter chips */}
        {hasActiveSearch && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
            <span className="text-xs text-muted-foreground self-center">
              {t("receipts.searchPanel.filtering", "กรอง:")}
            </span>
            {(appliedSearch.dateFrom || appliedSearch.dateTo) && (
              <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                {t("receipts.searchPanel.chipDate")}: {appliedSearch.dateFrom || "…"} → {appliedSearch.dateTo || "…"}
              </span>
            )}
            {appliedSearch.paymentType !== "all" && (
              <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                {t("receipts.paymentMethod")}: {t(`common.paymentMethods.${(appliedSearch.paymentType ?? "").toLowerCase()}`, appliedSearch.paymentType)}
              </span>
            )}
            {appliedSearch.status !== "all" && (
              <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                {t("receipts.transactions.status", "Status")}: {t(`receipts.transactions.status${appliedSearch.status.charAt(0).toUpperCase()}${appliedSearch.status.slice(1)}`, appliedSearch.status)}
              </span>
            )}
            <span className="text-xs text-muted-foreground self-center ml-1">
              ({resultsCount} {t("receipts.searchPanel.results", "รายการ")})
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
