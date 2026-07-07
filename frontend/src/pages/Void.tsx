import { useState, useEffect, useCallback } from "react";
import { XCircle, Search, Clock, CreditCard, Banknote, QrCode, Building2, CheckCircle2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { VoidDialog, type VoidCartItem } from "@/components/VoidDialog";
import { InfoCallout } from "@/components/InfoCallout";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/dateFormat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentMethod = "student" | "qr" | "cash" | "department";
type TransactionStatus = "completed" | "voided";

interface TransactionItem {
    id: number;
    name: string;
    barcode: string;
    quantity: number;
    unitPrice: number;
}

interface Transaction {
    id: number;
    receiptId: string;
    timestamp: string;
    paymentMethod: PaymentMethod;
    items: TransactionItem[];
    total: number;
    status: TransactionStatus;
}

// Map backend payment_method enum → frontend PaymentMethod
const PAYMENT_MAP: Record<string, PaymentMethod> = {
    cash: "cash",
    credit_card: "qr",
    wallet: "student",
    bank_transfer: "department",
    debit_card: "cash",
    other: "cash",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Void = () => {
    const { t } = useTranslation();

    const [search, setSearch] = useState("");
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Transaction | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    // ── Load receipts from API ──────────────────────────────────────────────
    const fetchTransactions = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.get<any[]>("/pos/receipt");
            setTransactions(
                data.map((r: any): Transaction => ({
                    id: r.id,
                    receiptId: r.receipt_number,
                    timestamp: r.transaction_date,
                    paymentMethod: PAYMENT_MAP[r.payment_method] ?? "cash",
                    total: r.total,
                    status: r.status === "voided" ? "voided" : "completed",
                    items: (r.items ?? []).map((item: any) => ({
                        id: item.id,
                        name: item.product_variant?.variant_name ?? `Product #${item.product_variant_id}`,
                        barcode: item.product_variant?.barcode ?? "",
                        quantity: item.quantity,
                        unitPrice: item.unit_price,
                    })),
                })),
            );
        } catch { /* silent */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

    // ── Filter ──────────────────────────────────────────────────────────────
    const filtered = transactions.filter((tx) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
            tx.receiptId.toLowerCase().includes(q) ||
            tx.items.some((i) => i.name.toLowerCase().includes(q) || i.barcode.includes(q))
        );
    });

    const handleSelectTransaction = (tx: Transaction) => {
        setSelected(tx);
        setDialogOpen(true);
    };

    // ── Void confirmed (API already called inside VoidDialog) → refresh ────
    const handleVoidConfirmed = async () => {
        await fetchTransactions();
        setSelected(null);
    };

    // ── Helpers ─────────────────────────────────────────────────────────────
    const paymentIcon = (method: PaymentMethod) => {
        if (method === "student") return <CreditCard className="h-3.5 w-3.5" />;
        if (method === "qr") return <QrCode className="h-3.5 w-3.5" />;
        if (method === "department") return <Building2 className="h-3.5 w-3.5" />;
        return <Banknote className="h-3.5 w-3.5" />;
    };

    const paymentLabel = (method: PaymentMethod) => {
        if (method === "student") return t("store.studentCard");
        if (method === "qr") return t("store.qrPromptpay");
        if (method === "department") return t("store.department");
        return t("store.cash");
    };

    const formatTime = (iso: string) => {
        try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
        catch { return iso; }
    };

    const formatDate = (iso: string) => fmtDate(iso);

    // ── Loading ─────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="page-shell">

            {/* ── Header ── */}
            <div className="page-header">
                <h1 className="page-title">{t("void.title")}</h1>
                <p className="page-description">{t("void.description")}</p>
            </div>

            <InfoCallout
                id="void.irreversible"
                variant="warn"
                title={t("void.info.irreversible.title")}
            >
                {t("void.info.irreversible.body")}
            </InfoCallout>

            {/* ── Search ── */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                    className="pl-9"
                    placeholder={t("void.searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* ── Stats bar ── */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{t("void.totalShown", { count: filtered.length })}</span>
                <span>·</span>
                <span className="text-destructive font-medium">
                    {t("void.alreadyVoided", { count: filtered.filter((tx) => tx.status === "voided").length })}
                </span>
            </div>

            {/* ── Transaction list ── */}
            <div className="flex-1 overflow-auto space-y-2">
                {filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                        <XCircle className="h-12 w-12 opacity-20" />
                        <p>{t("void.noResults")}</p>
                    </div>
                )}

                {filtered.map((tx) => (
                    <div
                        key={tx.id}
                        className={`rounded-xl border bg-card/80 p-4 flex items-start justify-between gap-4 transition-colors ${tx.status === "voided"
                                ? "opacity-50 border-border/40"
                                : "hover:bg-accent/30 cursor-pointer"
                            }`}
                        onClick={() => tx.status !== "voided" && handleSelectTransaction(tx)}
                    >
                        {/* Left: receipt info */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-bold text-sm">{tx.receiptId}</span>
                                {tx.status === "voided" ? (
                                    <Badge variant="destructive" className="text-xs gap-1">
                                        <XCircle className="h-3 w-3" />
                                        {t("void.statusVoided")}
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="text-xs gap-1 text-success border-success/40">
                                        <CheckCircle2 className="h-3 w-3" />
                                        {t("void.statusCompleted")}
                                    </Badge>
                                )}
                            </div>

                            <p className="text-sm text-muted-foreground truncate">
                                {tx.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}
                            </p>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatDate(tx.timestamp)} {formatTime(tx.timestamp)}
                                </span>
                                <span className="flex items-center gap-1">
                                    {paymentIcon(tx.paymentMethod)}
                                    {paymentLabel(tx.paymentMethod)}
                                </span>
                            </div>
                        </div>

                        {/* Right: total + action */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <span className="text-lg font-bold tabular-nums text-primary">
                                ฿{tx.total.toLocaleString()}
                            </span>
                            {tx.status !== "voided" && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="gap-1.5 text-xs"
                                    onClick={(e) => { e.stopPropagation(); handleSelectTransaction(tx); }}
                                >
                                    <XCircle className="h-3.5 w-3.5" />
                                    {t("void.voidButton")}
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── VoidDialog ── */}
            {selected && (
                <VoidDialog
                    open={dialogOpen}
                    onOpenChange={(open) => {
                        setDialogOpen(open);
                        if (!open) setSelected(null);
                    }}
                    receiptId={selected.id}
                    items={selected.items.map((i): VoidCartItem => ({
                        id: i.id,
                        name: i.name,
                        barcode: i.barcode,
                        quantity: i.quantity,
                        unitPrice: i.unitPrice,
                    }))}
                    total={selected.total}
                    onConfirmed={handleVoidConfirmed}
                />
            )}
        </div>
    );
};

export default Void;
