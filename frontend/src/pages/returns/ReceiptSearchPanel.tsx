import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import type { Receipt } from "./returnsTypes";
import { getPaymentMethodLabel } from "./returnsHelpers";

interface ReceiptSearchPanelProps {
    searchReceiptId: string;
    onSearchReceiptIdChange: (v: string) => void;
    searchStudent: string;
    onSearchStudentChange: (v: string) => void;
    searchDateFrom: string;
    onSearchDateFromChange: (v: string) => void;
    searchDateTo: string;
    onSearchDateToChange: (v: string) => void;
    searchPaymentMethod: string;
    onSearchPaymentMethodChange: (v: string) => void;
    onSearch: () => void;
    searchResults: (Receipt & { shopId?: string })[];
    selectedReceipt: Receipt | null;
    onPickResult: (receipt: Receipt & { shopId?: string }) => void;
}

/** Receipt search form + multi-match result picker for the with-receipt return flow. */
export function ReceiptSearchPanel({
    searchReceiptId,
    onSearchReceiptIdChange,
    searchStudent,
    onSearchStudentChange,
    searchDateFrom,
    onSearchDateFromChange,
    searchDateTo,
    onSearchDateToChange,
    searchPaymentMethod,
    onSearchPaymentMethodChange,
    onSearch,
    searchResults,
    selectedReceipt,
    onPickResult,
}: ReceiptSearchPanelProps) {
    const { t } = useTranslation();

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center text-xl">
                        <Search className="h-6 w-6 mr-2 text-primary" />
                        {t('returns.searchReceipt')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <Label htmlFor="searchReceiptId" className="text-sm font-semibold">{t('returns.receiptId')}</Label>
                            <Input
                                id="searchReceiptId"
                                placeholder="R-001"
                                value={searchReceiptId}
                                onChange={(e) => onSearchReceiptIdChange(e.target.value)}
                                className="mt-1.5"
                            />
                        </div>
                        <div>
                            <Label htmlFor="searchStudent" className="text-sm font-semibold">{t('returns.studentCodeOrName')}</Label>
                            <Input
                                id="searchStudent"
                                placeholder={t('returns.studentCodePlaceholder')}
                                value={searchStudent}
                                onChange={(e) => onSearchStudentChange(e.target.value)}
                                className="mt-1.5"
                            />
                        </div>
                        <div>
                            <Label className="text-sm font-semibold">{t('returns.purchaseDate')}</Label>
                            <div className="mt-1.5">
                                <DateRangePicker
                                    startDate={searchDateFrom}
                                    endDate={searchDateTo}
                                    onStartChange={onSearchDateFromChange}
                                    onEndChange={onSearchDateToChange}
                                />
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="searchPaymentMethod" className="text-sm font-semibold">{t('returns.paymentType')}</Label>
                            <Select value={searchPaymentMethod} onValueChange={onSearchPaymentMethodChange}>
                                <SelectTrigger className="mt-1.5">
                                    <SelectValue placeholder={t('returns.all')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('returns.all')}</SelectItem>
                                    <SelectItem value="student">{t('returns.studentCard')}</SelectItem>
                                    <SelectItem value="qr">{t('returns.qrPromptpay')}</SelectItem>
                                    <SelectItem value="cash">{t('returns.cash')}</SelectItem>
                                    <SelectItem value="department">{t('returns.departmentCard')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex justify-end mt-6">
                        <Button onClick={onSearch} className="px-8">
                            <Search className="h-4 w-4 mr-2" />
                            {t('returns.search')}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Multi-match results — let user pick a receipt */}
            {searchResults.length > 0 && !selectedReceipt && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {t("returns.searchResultsCount", { count: searchResults.length, defaultValue: "{{count}} receipts found — click to select" })}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-muted">
                                    <tr>
                                        <th className="text-left p-3">Date / Time</th>
                                        <th className="text-left p-3">Receipt ID</th>
                                        <th className="text-left p-3">Payer</th>
                                        <th className="text-left p-3">Payment</th>
                                        <th className="text-right p-3">Total</th>
                                        <th className="p-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map((r) => (
                                        <tr key={r.id} className="border-t hover:bg-muted/50">
                                            <td className="p-3">{(r as any).date}</td>
                                            <td className="p-3 font-mono">{r.id}</td>
                                            <td className="p-3">{(r as any).payer?.label || "—"}</td>
                                            <td className="p-3">{getPaymentMethodLabel(t, (r as any).paymentMethod)}</td>
                                            <td className="p-3 text-right">฿{Number((r as any).total).toFixed(2)}</td>
                                            <td className="p-3">
                                                <Button size="sm" onClick={() => onPickResult(r)}>
                                                    {t("common.select", "Select")}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </>
    );
}
