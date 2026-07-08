import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useTranslation } from "react-i18next";

interface AppliedSearch {
  receiptId: string;
  payer: string;
  dateFrom: string;
  dateTo: string;
  paymentType: string;
}

interface ReceiptSearchPanelProps {
  searchReceiptId: string;
  onReceiptIdChange: (v: string) => void;
  searchPayer: string;
  onPayerChange: (v: string) => void;
  searchDateFrom: string;
  onDateFromChange: (v: string) => void;
  searchDateTo: string;
  onDateToChange: (v: string) => void;
  searchPaymentType: string;
  onPaymentTypeChange: (v: string) => void;
  appliedSearch: AppliedSearch;
  hasActiveSearch: boolean;
  resultsCount: number;
  onSearch: () => void;
  onClearSearch: () => void;
}

export function ReceiptSearchPanel({
  searchReceiptId, onReceiptIdChange,
  searchPayer, onPayerChange,
  searchDateFrom, onDateFromChange,
  searchDateTo, onDateToChange,
  searchPaymentType, onPaymentTypeChange,
  appliedSearch, hasActiveSearch, resultsCount,
  onSearch, onClearSearch,
}: ReceiptSearchPanelProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{t("receipts.searchPanel.title", "Search Receipt")}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Receipt ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("receipts.searchPanel.receiptId", "Receipt ID")}
            </label>
            <Input
              placeholder="R-001"
              value={searchReceiptId}
              onChange={(e) => onReceiptIdChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </div>

          {/* Payer name / code */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("receipts.searchPanel.payer", "รหัส/ชื่อนักเรียน")}
            </label>
            <Input
              placeholder={t("receipts.searchPanel.payerPlaceholder")}
              value={searchPayer}
              onChange={(e) => onPayerChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />
          </div>

          {/* Purchase Date Range */}
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
                <SelectItem value="wallet">{t("common.paymentMethods.wallet")}</SelectItem>
                <SelectItem value="cash">{t("common.paymentMethods.cash")}</SelectItem>
                <SelectItem value="qr_promptpay">{t("common.paymentMethods.qr_promptpay")}</SelectItem>
                <SelectItem value="edc">{t("common.paymentMethods.edc")}</SelectItem>
                <SelectItem value="department">{t("common.paymentMethods.department")}</SelectItem>
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
            {appliedSearch.receiptId && (
              <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                ID: {appliedSearch.receiptId}
              </span>
            )}
            {appliedSearch.payer && (
              <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                {t("receipts.searchPanel.chipPayer")}: {appliedSearch.payer}
              </span>
            )}
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
            <span className="text-xs text-muted-foreground self-center ml-1">
              ({resultsCount} {t("receipts.searchPanel.results", "รายการ")})
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
