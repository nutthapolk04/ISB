import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/dateFormat";
import { formatCurrency as formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ArrowDown, ArrowUp, Download, History, Receipt, X } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { ReceiptDetailDialog } from "@/components/ReceiptDetailDialog";
import { TopupDetailDialog, type TopupTransaction } from "@/components/TopupDetailDialog";
import { getRoleStyle } from "@/lib/roleStyles";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StudentProfile {
    id: number;
    name: string;
    student_code?: string | null;
    wallet_id?: number | null;
    // for own/wallet-N resolved wallets
    is_own_wallet?: boolean;
    role?: string | null;
}

interface Transaction {
    id: number;
    wallet_id: number;
    transaction_type: string;
    amount: number;
    balance_before: number;
    balance_after: number;
    reference_type?: string | null;
    reference_id?: number | null;
    description?: string | null;
    shop_id?: string | null;
    shop_name?: string | null;
    confirmed_via?: string | null;
    is_voided?: boolean;
    receipt_number?: string | null;
    created_at: string;
}

// API shape returned by /wallets/me and /wallets/:id
interface WalletResponse {
    id: number;
    owner_type: "user" | "customer";
    user_id: number | null;
    customer_id: number | null;
    balance: number;
    name: string | null;
    username: string | null;
    role: string | null;
    photo_url: string | null;
}


// ── Component ─────────────────────────────────────────────────────────────────

export default function TransactionHistory() {
    // customerId can be a numeric string, "own", or "wallet-N"
    const { customerId } = useParams<{ customerId: string }>();
    const { t, i18n } = useTranslation();
    const schoolInfo = useSchoolInfo();
    const { user } = useAuth();
    const [profile, setProfile] = useState<StudentProfile | null>(null);
    const [txs, setTxs] = useState<Transaction[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [filtered, setFiltered] = useState(false);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [openReceiptId, setOpenReceiptId] = useState<number | null>(null);
    const [openTopupTx, setOpenTopupTx] = useState<TopupTransaction | null>(null);

    const formatDate = (iso: string) => fmtDateTime(iso);

    const txTypeLabel = (type: string): string => {
        const map: Record<string, string> = {
            TOPUP: t("parent.transactions.txTopup"),
            topup: t("parent.transactions.txTopup"),
            DEDUCTION: t("parent.transactions.txDeduction"),
            deduction: t("parent.transactions.txDeduction"),
            REFUND: t("parent.transactions.txRefund"),
            refund: t("parent.transactions.txRefund"),
            ADJUSTMENT_CREDIT: t("parent.transactions.txAdjCredit"),
            ADJUSTMENT_DEBIT: t("parent.transactions.txAdjDebit"),
        };
        return map[type] ?? type;
    };

    // A void refund names the receipt it reverses instead of a generic
    // "Refund" label, so it visually pairs with the original purchase row.
    const rowLabel = (tx: Transaction): string =>
        tx.reference_type === "receipt_void"
            ? t("parent.transactions.txVoidRefund", { receipt: tx.receipt_number ?? "—" })
            : txTypeLabel(tx.transaction_type);

    const loadTransactions = async (walletId: number) => {
        const params = new URLSearchParams();
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
        const qs = params.toString();
        const path = `/wallets/${walletId}/transactions${qs ? `?${qs}` : ""}`;
        try {
            const data = await api.get<Transaction[]>(path);
            setTxs(data);
        } catch (e) {
            toast({
                title: t("parent.transactions.historyFailed"),
                description: e instanceof ApiError ? e.detail : "Unknown error",
                variant: "destructive",
            });
        }
    };

    // Resolve profile + wallet from any supported customerId form
    const resolveProfile = async (): Promise<{ profile: StudentProfile; walletId: number | null }> => {
        if (!customerId) throw new Error("No customer ID");

        if (customerId === "own") {
            const w = await api.get<WalletResponse>("/wallets/me");
            const p: StudentProfile = {
                id: w.user_id ?? 0,
                name: w.name ?? w.username ?? "",
                wallet_id: w.id,
                is_own_wallet: true,
                role: w.role,
            };
            return { profile: p, walletId: w.id };
        }

        if (customerId.startsWith("wallet-")) {
            const walletId = parseInt(customerId.slice(7), 10);
            const w = await api.get<WalletResponse>(`/wallets/${walletId}`);
            const p: StudentProfile = {
                id: w.user_id ?? walletId,
                name: w.name ?? w.username ?? "",
                wallet_id: w.id,
                is_own_wallet: true,
                role: w.role,
            };
            return { profile: p, walletId: w.id };
        }

        // Numeric customer ID — child wallet
        const p = await api.get<StudentProfile>(`/customers/${customerId}`);
        return { profile: p, walletId: p.wallet_id ?? null };
    };

    useEffect(() => {
        (async () => {
            if (!customerId) return;
            try {
                const { profile: p, walletId } = await resolveProfile();
                setProfile(p);
                if (walletId) {
                    // Auto-load current month so transactions are visible without needing to filter
                    const today = new Date();
                    const from = new Date(today.getFullYear(), today.getMonth(), 1);
                    const fmt = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
                    const autoFrom = fmt(from);
                    const autoTo = fmt(today);
                    setDateFrom(autoFrom);
                    setDateTo(autoTo);
                    const qs = `date_from=${autoFrom}&date_to=${autoTo}`;
                    const data = await api.get<Transaction[]>(`/wallets/${walletId}/transactions?${qs}`);
                    setTxs(data);
                    setFiltered(true);
                }
            } catch (e) {
                const err = e instanceof ApiError ? e : null;
                const status = err?.status ?? 0;
                if (status === 403) {
                    setLoadError(t("parent.transactions.accessDenied", "You don't have access to this wallet."));
                } else if (status === 404) {
                    setLoadError(t("parent.transactions.walletNotFound", "Wallet not found."));
                } else {
                    setLoadError(err?.detail ?? t("parent.transactions.loadFailed", "Failed to load transactions."));
                }
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customerId]);

    const handleRowClick = (tx: Transaction) => {
        const isCredit = tx.balance_after >= tx.balance_before;
        // A void-refund row's reference_id is the SAME original receipt it
        // reverses — open that receipt (which already shows a "VOIDED" banner)
        // instead of the generic top-up dialog, so both rows of a void pair
        // lead to the same place.
        if ((tx.reference_type === "receipt" || tx.reference_type === "receipt_void") && tx.reference_id) {
            setOpenReceiptId(tx.reference_id);
        } else {
            // topup, credit, adjustment, or any other non-receipt row
            setOpenTopupTx(tx as TopupTransaction);
        }
        // Suppress unused-var lint for isCredit: kept for clarity, all non-receipt rows open TopupDetailDialog
        void isCredit;
    };

    const hasFilter = !!(dateFrom || dateTo);

    const handleFilter = () => {
        if (profile?.wallet_id) {
            loadTransactions(profile.wallet_id);
            setFiltered(true);
        }
    };

    const handleClearFilter = () => {
        setDateFrom("");
        setDateTo("");
        setTxs([]);
        setFiltered(false);
    };

    const handleExportPDF = () => {
        const title = t("parent.transactions.title", { name: profile?.name ?? "" });
        const rows = txs.map((tx) => {
            const isCredit = (tx.balance_after ?? 0) >= (tx.balance_before ?? 0);
            return `
        <tr>
          <td>${formatDate(tx.created_at)}</td>
          <td>${txTypeLabel(tx.transaction_type)}</td>
          <td>${tx.shop_name ?? ""}</td>
          <td>${tx.description ?? ""}</td>
          <td style="text-align:right;font-weight:600;color:${isCredit ? "#16a34a" : "#dc2626"}">${isCredit ? "+" : "-"}${formatTHB(Math.abs(tx.amount))}</td>
          <td style="text-align:right">${formatTHB(tx.balance_after)}</td>
        </tr>`;
        }).join("");

        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: sans-serif; font-size: 12px; color: #1e293b; margin: 24px; }
    .meta-bar { display: flex; justify-content: space-between; font-size: 9px; color: #000; margin-bottom: 10px; }
    .report-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .report-header img { object-fit: contain; }
    .report-header .school-name { font-size: 16px; font-weight: bold; line-height: 1.2; }
    .report-header .report-title { font-size: 13px; margin-top: 2px; }
    .filters { text-align: right; font-size: 9px; color: #000; margin-bottom: 14px; }
    .filters div { margin-top: 1px; }
    p.sub { font-size: 11px; color: #64748b; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #fff7ed; color: #c2410c; font-weight: 700; text-align: left; padding: 6px 8px; border-bottom: 2px solid #fed7aa; }
    td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr:nth-child(even) td { background: #fafaf9; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="meta-bar">
    <span>Report ID: ISB000${user?.fullName || user?.username ? ` &middot; By: ${user?.fullName || user?.username}` : ""}</span>
    <span>Printed: ${(() => { const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; })()}</span>
  </div>
  <div class="report-header">
    ${schoolInfo.logoUrl ? `<img src="${schoolInfo.logoUrl}" width="52" height="52" />` : ""}
    <div>
      <div class="school-name">${schoolInfo.name || ""}</div>
      <div class="report-title">${title}</div>
    </div>
  </div>
  ${(dateFrom || dateTo) ? `<div class="filters"><div>Date: ${dateFrom || "-"} &rarr; ${dateTo || "-"}</div></div>` : ""}
  <table>
    <thead>
      <tr>
        <th>${t("txHistory.csv.date", "Date")}</th>
        <th>${t("txHistory.csv.type", "Type")}</th>
        <th>${t("txHistory.csv.shop", "Shop")}</th>
        <th>${t("txHistory.csv.description", "Description")}</th>
        <th style="text-align:right">${t("txHistory.csv.amount", "Amount")}</th>
        <th style="text-align:right">${t("txHistory.csv.balance", "Balance")}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

        const win = window.open("", "_blank");
        if (!win) return;
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
    };

    // Display role for gradient color: use profile.role for own/wallet-N, "student" for children
    const displayRole = profile?.is_own_wallet ? (profile.role ?? "staff") : "student";
    const headerStyle = getRoleStyle(displayRole);

    // ── Per-day grouping ──────────────────────────────────────────────────────
    const getTxDate = (tx: Transaction) =>
        new Date(tx.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const TODAY = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

    const groupedByDay = txs.reduce<Record<string, Transaction[]>>((acc, tx) => {
        const d = getTxDate(tx);
        (acc[d] ??= []).push(tx);
        return acc;
    }, {});
    const sortedDates = Object.keys(groupedByDay).sort((a, b) => b.localeCompare(a));
    const showDayGroups = hasFilter && sortedDates.length > 1;

    if (loading) return <div className="page-shell text-muted-foreground">{t("parent.common.loading")}</div>;
    if (loadError || !profile) return (
        <div className="page-shell flex flex-col items-center justify-center gap-4 py-20 text-center">
            <div className="rounded-full bg-red-50 p-5">
                <History className="h-8 w-8 text-red-300" />
            </div>
            <p className="text-destructive font-medium">{loadError ?? t("parent.common.notFound", "Not found")}</p>
            <BackButton to="/parent/dashboard" />
        </div>
    );

    return (
        <div className="page-shell space-y-4">

            {/* Header banner — BackButton inside, absolute top-right */}
            <div className="rounded-2xl px-6 py-5 shadow-lg text-white relative" style={headerStyle}>
                <div className="absolute top-3 right-3 z-10">
                    <BackButton to="/parent/dashboard" />
                </div>
                <div className="pr-24">
                    <h1 className="text-2xl font-bold tracking-tight drop-shadow-sm">
                        {t("parent.transactions.title", { name: profile.name })}
                    </h1>
                    {profile.student_code && (
                        <span className="mt-2 inline-block rounded-full bg-white/25 px-3 py-0.5 text-sm font-medium text-white">
                            {profile.student_code}
                        </span>
                    )}
                </div>
            </div>

            {/* Filter card */}
            <Card className="rounded-2xl shadow-md border-orange-100">
                <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-orange-600">
                        {t("parent.transactions.filterTitle")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                        <div>
                            <Label htmlFor="dateRange" className="text-xs text-orange-500 font-medium">
                                {t("parent.transactions.dateRange")}
                            </Label>
                            <DateRangePicker
                                id="dateRange"
                                startDate={dateFrom}
                                endDate={dateTo}
                                onStartChange={setDateFrom}
                                onEndChange={setDateTo}
                            />
                        </div>
                        <Button onClick={handleFilter} className="h-10 bg-orange-500 hover:bg-orange-600 text-white shadow-sm">
                            {t("parent.transactions.filter")}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleClearFilter}
                            disabled={!hasFilter}
                            className="h-10 border-orange-300 text-orange-600 hover:bg-orange-50 disabled:opacity-40"
                        >
                            <X className="h-4 w-4 mr-1" /> {t("parent.transactions.clearFilter", "Clear")}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleExportPDF}
                            disabled={txs.length === 0}
                            className="h-10 border-orange-300 text-orange-600 hover:bg-orange-50"
                        >
                            <Download className="h-4 w-4 mr-1" /> {t("parent.transactions.exportPdf", "PDF")}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Transaction list — grouped by date, card per transaction */}
            {!filtered ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                    <History className="h-10 w-10 text-slate-300" />
                    <p className="font-medium">{t("parent.transactions.selectDatePrompt", "Select a date range and tap Filter to view transactions")}</p>
                </div>
            ) : txs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                    <History className="h-10 w-10 text-slate-300" />
                    <p className="font-medium">{t("parent.transactions.noResults")}</p>
                </div>
            ) : (
                <div className="space-y-5">
                    {sortedDates.map((date) => {
                        const dayTxs = groupedByDay[date];
                        const isToday = date === TODAY;
                        const dateHeader = isToday
                            ? t("parent.transactions.today", "TODAY")
                            : new Date(date + "T12:00:00")
                                .toLocaleDateString(i18n.language === "th" ? "th-TH" : "en-US", {
                                    day: "numeric", month: "long", year: "numeric", calendar: "gregory",
                                })
                                .toUpperCase();

                        return (
                            <div key={date}>
                                {/* Date header */}
                                <p className="text-xs font-bold tracking-widest text-slate-400 mb-2 px-1">
                                    {dateHeader}
                                </p>

                                {/* Cards for this day */}
                                <div className="space-y-2.5">
                                    {dayTxs.map((tx) => {
                                        const isCredit = (tx.balance_after ?? 0) >= (tx.balance_before ?? 0);
                                        const typeLabel = rowLabel(tx);
                                        const time = new Date(tx.created_at).toLocaleTimeString(
                                            i18n.language === "th" ? "th-TH" : "en-US",
                                            { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" },
                                        );
                                        const hasReceipt = (tx.reference_type === "receipt" || tx.reference_type === "receipt_void") && tx.reference_id;
                                        // Only the original purchase row gets the "Voided" badge —
                                        // the void_refund row already names itself via rowLabel().
                                        const showVoidedBadge = tx.is_voided && tx.reference_type === "receipt";

                                        return (
                                            <div
                                                key={tx.id}
                                                onClick={() => handleRowClick(tx)}
                                                className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all ${showVoidedBadge ? "opacity-60" : ""}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    {/* Icon */}
                                                    <div className={`mt-0.5 w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isCredit ? "bg-emerald-100" : "bg-red-100"}`}>
                                                        {isCredit
                                                            ? <ArrowUp className="h-4 w-4 text-emerald-600" />
                                                            : <ArrowDown className="h-4 w-4 text-red-500" />}
                                                    </div>

                                                    {/* Body */}
                                                    <div className="flex-1 min-w-0">
                                                        {/* Title row */}
                                                        <div className="flex items-start justify-between gap-3">
                                                            <p className="font-bold text-gray-900 text-sm leading-tight">
                                                                <span className={showVoidedBadge ? "line-through" : ""}>{typeLabel}</span>
                                                                {tx.shop_name && (
                                                                    <span className="font-normal text-gray-400"> — {tx.shop_name}</span>
                                                                )}
                                                                {showVoidedBadge && (
                                                                    <span className="ml-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600 align-middle">
                                                                        {t("parent.transactions.voidedBadge")}
                                                                    </span>
                                                                )}
                                                            </p>
                                                            <span className={`font-bold tabular-nums text-base shrink-0 leading-tight ${isCredit ? "text-emerald-600" : "text-red-500"}`}>
                                                                {isCredit ? "+" : "-"}฿{Math.abs(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </span>
                                                        </div>

                                                        {/* Description */}
                                                        {tx.description && (
                                                            <p className="text-xs text-gray-500 mt-1 leading-snug line-clamp-2">
                                                                {tx.description}
                                                            </p>
                                                        )}

                                                        {/* Footer row */}
                                                        <div className="flex items-center justify-between mt-2">
                                                            <span className="text-xs text-gray-400">
                                                                {time}
                                                                {tx.shop_name && !tx.description ? "" : ""}
                                                            </span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs text-gray-400 tabular-nums">
                                                                    {t("parent.transactions.balanceAfter", { amount: formatTHB(tx.balance_after) })}
                                                                </span>
                                                                {hasReceipt && (
                                                                    <Receipt className="h-3.5 w-3.5 text-gray-300" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <ReceiptDetailDialog
                receiptId={openReceiptId}
                onClose={() => setOpenReceiptId(null)}
            />
            <TopupDetailDialog
                transaction={openTopupTx}
                onClose={() => setOpenTopupTx(null)}
            />
        </div>
    );
}
