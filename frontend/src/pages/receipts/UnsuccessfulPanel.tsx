/**
 * Sales that never became receipts.
 *
 * Merges two sources the reader should not have to know apart:
 *   - `pos_failed_checkouts` — the request reached the server and was rejected,
 *     or never completed at all. Covers every payment method.
 *   - `edc_txn_events` — the card terminal approved but the POS never sent the
 *     sale to checkout. Only EDC can fail this way, because only EDC takes the
 *     money before we record it.
 *
 * Read-only by design. Turning one of these back into a receipt is a
 * money-path decision that has not been signed off, so this shows what
 * happened and nothing more.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { fmtDateTime } from "@/lib/dateFormat";

interface FailedCartItem {
    product_code: string;
    name: string;
    quantity: number;
    unit_price: number;
    discount: number;
    line_total: number;
}

interface FailedCheckout {
    id: number;
    status: string;
    shop_id: string | null;
    payment_method: string | null;
    amount: number | null;
    cart_snapshot: { items: FailedCartItem[]; total: number } | null;
    error_code: string | null;
    error_message: string | null;
    idempotency_key: string | null;
    edc_approval_code: string | null;
    created_at: string;
}

interface EdcEvent {
    id: number;
    shop_id: string | null;
    amount: number | null;
    response_code: string | null;
    approval_code: string | null;
    masked_card: string | null;
    pos_ref: string | null;
    checkout_attempted: boolean;
    cart_snapshot: { items: FailedCartItem[]; total: number } | null;
    created_at: string;
}

/** One row of the merged list, whichever table it came from. */
interface Row {
    key: string;
    createdAt: string;
    /** POS REF for a terminal row, the idempotency key otherwise — both are the
     *  handle that ties the row to something outside the system. */
    reference: string | null;
    paymentMethod: string;
    amount: number | null;
    status: string;
    detail: string | null;
    items: FailedCartItem[] | null;
}

/** Mirrors lib/paywire/edcResponseCodes — kept local so this page carries no
 *  dependency on POS internals. */
const APPROVED_CODES = new Set(["00", "Y1", "Y3", "DR", "DI"]);

const STATUS_LABEL: Record<string, string> = {
    rejected: "Rejected",
    error: "Server error",
    not_recorded: "Not recorded",
    edc_unrecorded: "Charged, not recorded",
};

interface Props {
    /** Shared with the All Receipts tab so both views always agree. */
    dateFrom: string;
    dateTo: string;
    shopId?: string | null;
}

export function UnsuccessfulPanel({ dateFrom, dateTo, shopId }: Props) {
    const { t } = useTranslation();
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ limit: "300" });
            if (dateFrom) params.set("date_from", dateFrom);
            if (dateTo) params.set("date_to", dateTo);
            if (shopId) params.set("shop_id", shopId);

            // Both sources in parallel; either can be empty. Failing one must
            // not blank the other, so they settle independently.
            const [failed, edc] = await Promise.allSettled([
                api.get<FailedCheckout[]>(`/pos/failed-checkouts?${params.toString()}`),
                api.get<EdcEvent[]>(`/pos/edc-events?${params.toString()}&unrecorded_only=true`),
            ]);

            const merged: Row[] = [];
            if (failed.status === "fulfilled") {
                for (const f of failed.value) {
                    merged.push({
                        key: `f${f.id}`,
                        createdAt: f.created_at,
                        reference: f.idempotency_key,
                        paymentMethod: f.payment_method ?? "—",
                        amount: f.amount,
                        status: f.status,
                        detail: f.error_code ?? f.error_message,
                        items: f.cart_snapshot?.items ?? null,
                    });
                }
            }
            if (edc.status === "fulfilled") {
                for (const e of edc.value) {
                    // Defensive: the endpoint already filters, but a row that
                    // did reach checkout belongs in the other source, not here.
                    if (!APPROVED_CODES.has(e.response_code ?? "") || e.checkout_attempted) continue;
                    merged.push({
                        key: `e${e.id}`,
                        createdAt: e.created_at,
                        reference: e.pos_ref,
                        paymentMethod: "EDC",
                        amount: e.amount,
                        status: "edc_unrecorded",
                        detail: [e.response_code, e.approval_code, e.masked_card].filter(Boolean).join(" · ") || null,
                        items: e.cart_snapshot?.items ?? null,
                    });
                }
            }
            merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            setRows(merged);

            if (failed.status === "rejected" && edc.status === "rejected") {
                setError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
            }
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, shopId]);

    useEffect(() => { void load(); }, [load]);

    const fmtMoney = (n: number | null) =>
        n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center">
                    <AlertTriangle className="h-6 w-6 mr-2 text-amber-500" />
                    <CardTitle>{t("receipts.unsuccessful", "Unsuccessful")}</CardTitle>
                    {loading && <Loader2 className="h-4 w-4 ml-2 animate-spin text-muted-foreground" />}
                    {rows.length > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs">{rows.length}</Badge>
                    )}
                </div>
                <p className="text-sm text-muted-foreground">
                    {t(
                        "receipts.unsuccessfulHint",
                        "รายการที่ไม่ได้ถูกบันทึกเป็นใบเสร็จ — กดแถวเพื่อดูตะกร้า (ตะกร้าถูกลบหลัง 90 วัน)",
                    )}
                </p>
            </CardHeader>
            <CardContent>
                {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
                {rows.length === 0 && !loading ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <AlertTriangle className="h-10 w-10 mb-3" />
                        <p>{t("receipts.noUnsuccessful", "No unsuccessful transactions in this range.")}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12">Seq.</TableHead>
                                    <TableHead>{t("receipts.dateTime")}</TableHead>
                                    <TableHead>POS REF</TableHead>
                                    <TableHead>{t("receipts.paymentMethod")}</TableHead>
                                    <TableHead className="text-right">{t("receipts.total")}</TableHead>
                                    <TableHead>{t("receipts.status")}</TableHead>
                                    <TableHead>{t("receipts.detail", "Detail")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((r, idx) => (
                                    <>
                                        <TableRow
                                            key={r.key}
                                            className="cursor-pointer"
                                            onClick={() => setExpanded(expanded === r.key ? null : r.key)}
                                        >
                                            <TableCell className="text-right font-mono text-sm text-muted-foreground">{idx + 1}</TableCell>
                                            <TableCell className="whitespace-nowrap text-sm">
                                                {fmtDateTime(r.createdAt)}
                                            </TableCell>
                                            <TableCell className="font-mono text-[11px]">
                                                {r.reference ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-sm uppercase">{r.paymentMethod}</TableCell>
                                            <TableCell className="text-right font-mono">{fmtMoney(r.amount)}</TableCell>
                                            <TableCell>
                                                <Badge variant={r.status === "edc_unrecorded" ? "destructive" : "secondary"}>
                                                    {STATUS_LABEL[r.status] ?? r.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                                                {r.detail ?? "—"}
                                            </TableCell>
                                        </TableRow>
                                        {expanded === r.key && (
                                            <TableRow key={`${r.key}-d`}>
                                                <TableCell colSpan={7} className="bg-muted/30">
                                                    {r.items && r.items.length > 0 ? (
                                                        <table className="w-full text-xs">
                                                            <tbody>
                                                                {r.items.map((it, i) => (
                                                                    <tr key={i}>
                                                                        <td className="pr-3 font-mono text-muted-foreground">
                                                                            {it.product_code || "—"}
                                                                        </td>
                                                                        <td className="pr-3">{it.name}</td>
                                                                        <td className="pr-3 text-right">×{it.quantity}</td>
                                                                        <td className="text-right font-mono">
                                                                            {fmtMoney(it.line_total)}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    ) : (
                                                        <p className="py-2 text-xs text-muted-foreground">
                                                            {t(
                                                                "receipts.noCartSnapshot",
                                                                "ไม่มีข้อมูลตะกร้า — อาจถูกลบตามอายุ 90 วัน",
                                                            )}
                                                        </p>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
