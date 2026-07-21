import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import {
    exportToPDF,
    exportToExcel,
    buildDateFilterLine,
    type ReportPayload,
} from "@/lib/reportExport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { InfoCallout } from "@/components/InfoCallout";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { FileSpreadsheet, FileText, Loader2, Wallet, Receipt } from "lucide-react";
import UserPicker, { type StaffPickerUser } from "@/components/UserPicker";
import ShopPicker from "@/components/ShopPicker";
import CardholderPicker, { type CardholderPickerValue } from "@/components/CardholderPicker";
import { PaginationBar } from "@/components/PaginationBar";

type ReportKind = "topup" | "transaction";
type TopupChannel = "all" | "kiosk" | "online" | "cashier";

interface TopupRow {
    id: number;
    created_at: string;
    channel: "kiosk" | "online" | "cashier";
    topped_by: string;
    recipient_name: string;
    recipient_code: string;
    amount: number;
    cashier_name: string | null;
    payment_method: string | null;
}

type TransactionKind = "sale" | "adjustment" | "topup" | "transfer" | "other";

interface TransactionRow {
    id: number;
    kind: TransactionKind;
    created_at: string;
    payer_id: string;
    payer_name: string;
    payment_method: string;
    shop_name: string;
    amount: number;
    cashier_name: string;
    receipt_number: string | null;
    status: string;
}

const TXN_KIND_LABEL: Record<TransactionKind, string> = {
    sale: "Sale",
    adjustment: "Adjustment",
    topup: "Top-up",
    transfer: "Transfer",
    other: "Other",
};

const TXN_KIND_COLORS: Record<TransactionKind, string> = {
    sale: "bg-blue-100 text-blue-800",
    adjustment: "bg-amber-100 text-amber-800",
    topup: "bg-green-100 text-green-800",
    transfer: "bg-purple-100 text-purple-800",
    other: "bg-gray-100 text-gray-700",
};

interface TopupReportData {
    items: TopupRow[];
    amount_total: number;
}

interface TransactionReportData {
    items: TransactionRow[];
    total: number;
    amount_total: number;
    page: number;
    pages: number;
}

const TXN_PAGE_SIZE = 50;
/** Cap for the Export re-fetch — mirrors adjustmentReport/transferReport's
 * own page_size ceiling (backend-bun/src/controllers/AdminReportsController.ts). */
const TXN_EXPORT_PAGE_SIZE = 5000;

const CHANNEL_LABEL: Record<string, string> = {
    kiosk: "Kiosk",
    online: "Online (Parent)",
    cashier: "Cashier (Store)",
};

interface AdminReportExport {
    payload: ReportPayload<Record<string, unknown>>;
    baseFilename: string;
}

export default function AdminReports() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const school = useSchoolInfo();

    const [selected, setSelected] = useState<ReportKind | "">("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [channel, setChannel] = useState<TopupChannel>("all");
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [exporting, setExporting] = useState(false);

    const [topupData, setTopupData] = useState<TopupReportData | null>(null);
    const [txnData, setTxnData] = useState<TransactionReportData | null>(null);

    // Top-up Report filters
    const [toppedByValue, setToppedByValue] = useState<CardholderPickerValue | null>(null);
    const [toppedByLabel, setToppedByLabel] = useState<string | null>(null);
    const [recipientValue, setRecipientValue] = useState<CardholderPickerValue | null>(null);
    const [recipientLabel, setRecipientLabel] = useState<string | null>(null);

    // Transaction Report filters
    const [txnSearch, setTxnSearch] = useState("");
    const [txnCashier, setTxnCashier] = useState<StaffPickerUser | null>(null);
    const [txnStatus, setTxnStatus] = useState<string>("all");
    const [txnPaymentMethod, setTxnPaymentMethod] = useState<string>("all");
    const [txnShopId, setTxnShopId] = useState<string | null>(null);
    const [txnShopName, setTxnShopName] = useState<string | null>(null);
    const [txnType, setTxnType] = useState<string>("all");
    const [txnPage, setTxnPage] = useState(1);

    const openReport = (kind: ReportKind) => {
        setSelected(kind);
        setDateFrom("");
        setDateTo("");
        setChannel("all");
        setToppedByValue(null);
        setToppedByLabel(null);
        setRecipientValue(null);
        setRecipientLabel(null);
        setTxnSearch("");
        setTxnCashier(null);
        setTxnStatus("all");
        setTxnPaymentMethod("all");
        setTxnShopId(null);
        setTxnShopName(null);
        setTxnType("all");
        setTxnPage(1);
        setSearched(false);
        setTopupData(null);
        setTxnData(null);
    };

    /** Shared filter params for Transaction Report — page is separate since
     * the Search button and the pagination bar both need to build these but
     * start from a different page. */
    const buildTxnParams = (page: number, pageSize: number) => {
        const params = new URLSearchParams();
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
        if (txnSearch.trim()) params.set("search", txnSearch.trim());
        if (txnCashier) params.set("cashier_id", String(txnCashier.id));
        if (txnStatus !== "all") params.set("status", txnStatus);
        if (txnPaymentMethod !== "all") params.set("payment_method", txnPaymentMethod);
        if (txnShopId) params.set("shop_id", txnShopId);
        if (txnType !== "all") params.set("type", txnType);
        params.set("page", String(page));
        params.set("page_size", String(pageSize));
        return params;
    };

    const loadTransactionPage = async (page: number) => {
        setLoading(true);
        try {
            const params = buildTxnParams(page, TXN_PAGE_SIZE);
            const data = await api.get<TransactionReportData>(`/wallets/admin/transaction-report?${params.toString()}`);
            setTxnData(data);
            setTxnPage(data.page);
            setSearched(true);
            if (data.items.length === 0) toast.message("No transactions match these filters.");
        } catch (err) {
            toast.error(err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"));
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async () => {
        // Top-up report still requires an explicit date range; Transaction
        // Report's filters (including date) are all independently optional —
        // matching how Sales Summary Report's filters behave.
        if (selected === "topup" && (!dateFrom || !dateTo)) {
            toast.error(t("reports.selectDateRangeDesc"));
            return;
        }
        if (selected === "transaction") {
            await loadTransactionPage(1);
            return;
        }
        setLoading(true);
        try {
            if (selected === "topup") {
                const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
                if (channel !== "all") params.set("channel", channel);
                if (toppedByValue) {
                    params.set(toppedByValue.entity_type === "user" ? "topped_by_user_id" : "topped_by_customer_id", String(toppedByValue.entity_id));
                }
                if (recipientValue) {
                    params.set(recipientValue.entity_type === "user" ? "recipient_user_id" : "recipient_customer_id", String(recipientValue.entity_id));
                }
                const data = await api.get<TopupReportData>(`/wallets/admin/topup-report?${params.toString()}`);
                setTopupData(data);
                if (data.items.length === 0) toast.message("No top-ups match these filters.");
            }
            setSearched(true);
        } catch (err) {
            toast.error(err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"));
        } finally {
            setLoading(false);
        }
    };

    const buildFilterLines = (): string[] => {
        const lines: string[] = [];
        const dateLine = buildDateFilterLine("Date", dateFrom, dateTo);
        if (dateLine) lines.push(dateLine);
        if (selected === "topup") {
            if (channel !== "all") lines.push(`Type: ${CHANNEL_LABEL[channel]}`);
            if (toppedByLabel) lines.push(`Topped by: ${toppedByLabel}`);
            if (recipientLabel) lines.push(`Recipient: ${recipientLabel}`);
        }
        if (selected === "transaction") {
            if (txnSearch.trim()) lines.push(`Search: ${txnSearch.trim()}`);
            if (txnCashier) lines.push(`Cashier: ${txnCashier.full_name || txnCashier.username}`);
            if (txnStatus !== "all") lines.push(`Status: ${txnStatus}`);
            if (txnPaymentMethod !== "all") lines.push(`Payment Type: ${txnPaymentMethod}`);
            if (txnShopName) lines.push(`Shop: ${txnShopName}`);
            if (txnType !== "all") lines.push(`Type: ${TXN_KIND_LABEL[txnType as TransactionKind] ?? txnType}`);
        }
        return lines;
    };

    /** Builds the export payload. Top-up Report exports whatever is already
     * on screen (never paginated). Transaction Report is paginated on
     * screen, so export re-fetches every row matching the current filters
     * (capped at TXN_EXPORT_PAGE_SIZE) — otherwise exporting would silently
     * only cover whichever page happened to be showing. */
    const buildPayload = async (): Promise<AdminReportExport | null> => {
        const filters = buildFilterLines();
        const dateLabel = `_${dateFrom}_${dateTo}`;

        if (selected === "topup" && topupData) {
            return {
                payload: {
                    meta: {
                        title: t("admin.adminReports.topupReport"),
                        schoolName: school.name,
                        schoolLogoUrl: school.logoUrl || undefined,
                        reportId: "ISB-ADM-TOPUP",
                        filters,
                        runByName: user?.fullName ?? user?.username,
                    },
                    columns: [
                        { header: t("admin.adminReports.colDateTime"), key: "created_at", format: "datetime", width: 20 },
                        { header: t("admin.adminReports.colChannel"), key: "channel_label", width: 16 },
                        { header: t("admin.adminReports.colToppedBy"), key: "topped_by", width: 24 },
                        { header: t("admin.adminReports.colRecipient"), key: "recipient_name", width: 24 },
                        { header: t("admin.adminReports.colAmount"), key: "amount", format: "currency", align: "right", width: 14 },
                        { header: t("admin.adminReports.colCashier"), key: "cashier_name", width: 20 },
                    ],
                    rows: topupData.items.map((r) => ({
                        ...r,
                        channel_label: CHANNEL_LABEL[r.channel] ?? r.channel,
                        cashier_name: r.cashier_name ?? "",
                    })) as unknown as Record<string, unknown>[],
                    totals: { amount: topupData.amount_total },
                },
                baseFilename: `TopupReport${dateLabel}`,
            };
        }

        if (selected === "transaction" && txnData) {
            const params = buildTxnParams(1, TXN_EXPORT_PAGE_SIZE);
            const full = await api.get<TransactionReportData>(`/wallets/admin/transaction-report?${params.toString()}`);
            return {
                payload: {
                    meta: {
                        title: t("admin.adminReports.transactionReport"),
                        schoolName: school.name,
                        schoolLogoUrl: school.logoUrl || undefined,
                        reportId: "ISB-ADM-TXN",
                        filters,
                        runByName: user?.fullName ?? user?.username,
                    },
                    columns: [
                        { header: t("admin.adminReports.colDateTime"), key: "created_at", format: "datetime", width: 20 },
                        { header: t("admin.adminReports.colType", "Type"), key: "kind_label", width: 12 },
                        { header: t("admin.adminReports.colPayerId"), key: "payer_id", width: 14 },
                        { header: t("admin.adminReports.colPayerName"), key: "payer_name", width: 24 },
                        { header: t("admin.adminReports.colPaymentMethod"), key: "payment_method", width: 14 },
                        { header: t("admin.adminReports.colShop"), key: "shop_name", width: 20 },
                        { header: t("admin.adminReports.colAmount"), key: "amount", format: "currency", align: "right", width: 14 },
                        { header: t("admin.adminReports.colCashier"), key: "cashier_name", width: 20 },
                        { header: t("admin.adminReports.colStatus"), key: "status", width: 10 },
                    ],
                    rows: full.items.map((r) => ({ ...r, kind_label: TXN_KIND_LABEL[r.kind] })) as unknown as Record<string, unknown>[],
                    totals: { amount: full.amount_total },
                },
                baseFilename: `TransactionReport${dateLabel}`,
            };
        }

        return null;
    };

    const handleExportExcel = async () => {
        setExporting(true);
        try {
            const result = await buildPayload();
            if (!result) return;
            exportToExcel(result.payload, `${result.baseFilename}.xlsx`);
            toast.success(t("reports.exportSuccess"));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : t("shopUsers.errorGeneric"));
        } finally {
            setExporting(false);
        }
    };

    const handleExportPdf = async () => {
        setExporting(true);
        try {
            const result = await buildPayload();
            if (!result) return;
            await exportToPDF(result.payload, `${result.baseFilename}.pdf`);
            toast.success(t("reports.exportSuccess"));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : t("shopUsers.errorGeneric"));
        } finally {
            setExporting(false);
        }
    };

    const cards = [
        {
            kind: "topup" as const,
            icon: Wallet,
            title: t("admin.adminReports.topupReport"),
            desc: t("admin.adminReports.topupReportDesc"),
        },
        {
            kind: "transaction" as const,
            icon: Receipt,
            title: t("admin.adminReports.transactionReport"),
            desc: t("admin.adminReports.transactionReportDesc"),
        },
    ];

    const hasData = selected === "topup" ? !!topupData : selected === "transaction" ? !!txnData : false;

    return (
        <div className="page-shell">
            <div className="page-header">
                <h1 className="page-title mb-2">{t("admin.adminReports.title")}</h1>
                <p className="page-description">{t("admin.adminReports.description")}</p>
            </div>

            <InfoCallout
                id="adminReports.info"
                variant="info"
                title={t("admin.adminReports.infoTitle")}
            >
                {t("admin.adminReports.infoBody")}
            </InfoCallout>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {cards.map(({ kind, icon: Icon, title, desc }) => (
                    <Card
                        key={kind}
                        className={cn("interactive-card", selected === kind && "border-primary")}
                        onClick={() => openReport(kind)}
                    >
                        <CardHeader>
                            <CardTitle className="flex items-center">
                                <Icon className="h-5 w-5 mr-2 text-primary" />
                                {title}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">{desc}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {selected && (
                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            {selected === "topup" ? <Wallet className="h-5 w-5 text-primary" /> : <Receipt className="h-5 w-5 text-primary" />}
                            {selected === "topup" ? t("admin.adminReports.topupReport") : t("admin.adminReports.transactionReport")}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">{t("reports.selectDateRangeDesc")}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div className="space-y-2 md:col-span-2 lg:col-span-3">
                                <Label>{t("reports.startDate")} — {t("reports.endDate")}</Label>
                                <DateRangePicker
                                    startDate={dateFrom}
                                    endDate={dateTo}
                                    onStartChange={setDateFrom}
                                    onEndChange={setDateTo}
                                />
                            </div>
                            {selected === "topup" && (
                                <>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.channelFilter")}</Label>
                                        <Select value={channel} onValueChange={(v) => setChannel(v as TopupChannel)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">{t("admin.adminReports.channelAll")}</SelectItem>
                                                <SelectItem value="kiosk">{t("admin.adminReports.channelKiosk")}</SelectItem>
                                                <SelectItem value="online">{t("admin.adminReports.channelOnline")}</SelectItem>
                                                <SelectItem value="cashier">{t("admin.adminReports.channelCashier")}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.toppedByFilter", "Topped by")}</Label>
                                        <CardholderPicker
                                            value={toppedByValue}
                                            onChange={(v, item) => {
                                                setToppedByValue(v);
                                                setToppedByLabel(item ? `${item.name} (${item.identifier})` : null);
                                            }}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.recipientFilter", "Recipient")}</Label>
                                        <CardholderPicker
                                            value={recipientValue}
                                            onChange={(v, item) => {
                                                setRecipientValue(v);
                                                setRecipientLabel(item ? `${item.name} (${item.identifier})` : null);
                                            }}
                                        />
                                    </div>
                                </>
                            )}
                            {selected === "transaction" && (
                                <>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.searchFilter", "Search (ID / Username / Name)")}</Label>
                                        <Input
                                            value={txnSearch}
                                            onChange={(e) => setTxnSearch(e.target.value)}
                                            placeholder={t("admin.adminReports.searchPlaceholder", "ID, username, or full name…")}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.cashierFilter", "Cashier")}</Label>
                                        <UserPicker
                                            value={txnCashier?.id ?? null}
                                            onChange={(_, u) => setTxnCashier(u)}
                                            roles={["cashier", "manager", "admin", "staff", "kitchen"]}
                                            allowNone
                                            placeholder={t("admin.adminReports.allCashiers", "All cashiers")}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.shopFilter", "Shop")}</Label>
                                        <ShopPicker
                                            value={txnShopId}
                                            onChange={(id, shop) => { setTxnShopId(id); setTxnShopName(shop?.name ?? null); }}
                                            placeholder={t("admin.adminReports.allShops", "All shops")}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.typeFilter", "Type")}</Label>
                                        <Select value={txnType} onValueChange={setTxnType}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">{t("admin.adminReports.typeAll", "All")}</SelectItem>
                                                <SelectItem value="sale">{t("admin.adminReports.typeSale", "Sale")}</SelectItem>
                                                <SelectItem value="adjustment">{t("admin.adminReports.typeAdjustment", "Adjustment")}</SelectItem>
                                                <SelectItem value="topup">{t("admin.adminReports.typeTopup", "Top-up")}</SelectItem>
                                                <SelectItem value="transfer">{t("admin.adminReports.typeTransfer", "Transfer")}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.statusFilter", "Status")}</Label>
                                        <Select value={txnStatus} onValueChange={setTxnStatus}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">{t("admin.adminReports.statusAll", "All")}</SelectItem>
                                                <SelectItem value="ACTIVE">{t("admin.adminReports.statusActive", "Active")}</SelectItem>
                                                <SelectItem value="VOIDED">{t("admin.adminReports.statusVoided", "Voided")}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("admin.adminReports.paymentMethodFilter", "Payment Type")}</Label>
                                        <Select value={txnPaymentMethod} onValueChange={setTxnPaymentMethod}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">{t("admin.adminReports.paymentMethodAll", "All")}</SelectItem>
                                                <SelectItem value="CASH">Cash</SelectItem>
                                                <SelectItem value="WALLET">Wallet</SelectItem>
                                                <SelectItem value="CARD_TAP">Card Tap</SelectItem>
                                                <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                                                <SelectItem value="DEBIT_CARD">Debit Card</SelectItem>
                                                <SelectItem value="QR_PROMPTPAY">QR PromptPay</SelectItem>
                                                <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                                                <SelectItem value="EDC">EDC</SelectItem>
                                                <SelectItem value="DEPARTMENT">Department</SelectItem>
                                                <SelectItem value="OTHER">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button onClick={handleSearch} disabled={loading}>
                                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                Search
                            </Button>
                            {searched && hasData && (
                                <>
                                    <Button variant="outline" onClick={handleExportPdf} disabled={exporting}>
                                        {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                                        {t("reports.exportPdf")}
                                    </Button>
                                    <Button variant="outline" onClick={handleExportExcel} disabled={exporting}>
                                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                                        {t("reports.exportExcel")}
                                    </Button>
                                </>
                            )}
                        </div>

                        {searched && selected === "topup" && topupData && (
                            <div className="space-y-3">
                                <div className="text-sm text-muted-foreground">
                                    Found <span className="font-semibold text-foreground">{topupData.items.length}</span> top-ups
                                    {" · "}Total{" "}
                                    <span className="font-semibold text-foreground">
                                        ฿{topupData.amount_total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                                <div className="overflow-x-auto rounded-md border">
                                    <table className="w-full text-xs">
                                        <thead className="bg-muted/50 whitespace-nowrap">
                                            <tr>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colDateTime")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colChannel")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colToppedBy")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colRecipient")}</th>
                                                <th className="px-2 py-2 text-right">{t("admin.adminReports.colAmount")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colCashier")}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {topupData.items.length === 0 ? (
                                                <tr>
                                                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                                                        No top-ups match these filters.
                                                    </td>
                                                </tr>
                                            ) : (
                                                topupData.items.map((r) => (
                                                    <tr key={r.id} className="border-t">
                                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.created_at.slice(0, 19).replace("T", " ")}</td>
                                                        <td className="px-2 py-1.5">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                                                        <td className="px-2 py-1.5">{r.topped_by}</td>
                                                        <td className="px-2 py-1.5">{r.recipient_name} <span className="text-muted-foreground font-mono">({r.recipient_code})</span></td>
                                                        <td className="px-2 py-1.5 text-right font-mono">{r.amount.toFixed(2)}</td>
                                                        <td className="px-2 py-1.5 text-muted-foreground">{r.cashier_name ?? ""}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                        {topupData.items.length > 0 && (
                                            <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                                                <tr className="border-t">
                                                    <td colSpan={4} className="px-2 py-2 text-left">TOTAL</td>
                                                    <td className="px-2 py-2 text-right font-mono">{topupData.amount_total.toFixed(2)}</td>
                                                    <td />
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>
                        )}

                        {searched && selected === "transaction" && txnData && (
                            <div className="space-y-3">
                                <div className="text-sm text-muted-foreground">
                                    Found <span className="font-semibold text-foreground">{txnData.total}</span> transactions
                                    {" · "}Total{" "}
                                    <span className="font-semibold text-foreground">
                                        ฿{txnData.amount_total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                                <div className="overflow-x-auto rounded-md border">
                                    <table className="w-full text-xs">
                                        <thead className="bg-muted/50 whitespace-nowrap">
                                            <tr>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colDateTime")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colType", "Type")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colPayerId")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colPayerName")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colPaymentMethod")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colShop")}</th>
                                                <th className="px-2 py-2 text-right">{t("admin.adminReports.colAmount")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colCashier")}</th>
                                                <th className="px-2 py-2 text-left">{t("admin.adminReports.colStatus")}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {txnData.items.length === 0 ? (
                                                <tr>
                                                    <td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">
                                                        No transactions match these filters.
                                                    </td>
                                                </tr>
                                            ) : (
                                                txnData.items.map((r) => (
                                                    <tr key={`${r.kind}-${r.id}`} className={cn("border-t", r.status !== "ACTIVE" && "opacity-60")}>
                                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.created_at.slice(0, 19).replace("T", " ")}</td>
                                                        <td className="px-2 py-1.5">
                                                            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", TXN_KIND_COLORS[r.kind])}>
                                                                {TXN_KIND_LABEL[r.kind]}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-1.5 font-mono">{r.payer_id}</td>
                                                        <td className="px-2 py-1.5">{r.payer_name}</td>
                                                        <td className="px-2 py-1.5">{r.payment_method || "—"}</td>
                                                        <td className="px-2 py-1.5">{r.shop_name}</td>
                                                        <td className="px-2 py-1.5 text-right font-mono">{r.amount.toFixed(2)}</td>
                                                        <td className="px-2 py-1.5 text-muted-foreground">{r.cashier_name}</td>
                                                        <td className="px-2 py-1.5">
                                                            {r.status === "ACTIVE" ? (
                                                                <span className="text-muted-foreground">Active</span>
                                                            ) : (
                                                                <span className="font-semibold text-destructive">Voided</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                        {txnData.items.length > 0 && (
                                            <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                                                <tr className="border-t">
                                                    <td colSpan={6} className="px-2 py-2 text-left">TOTAL (sales only)</td>
                                                    <td className="px-2 py-2 text-right font-mono">{txnData.amount_total.toFixed(2)}</td>
                                                    <td colSpan={2} />
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                                <div className="flex justify-center">
                                    <PaginationBar
                                        currentPage={txnPage}
                                        totalPages={txnData.pages}
                                        onPageChange={(p) => loadTransactionPage(p)}
                                    />
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
