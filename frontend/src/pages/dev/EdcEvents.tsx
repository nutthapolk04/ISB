/**
 * EDC bridge event log — internal diagnostics, admin only.
 *
 * Deliberately not in the sidebar: this is a developer tool for investigating
 * terminal transactions that did not turn into sales, reached by typing the
 * URL. Hiding it is convenience, not security — the route is role-guarded in
 * App.tsx and the API refuses anyone below manager, because these rows carry
 * cart contents and masked card numbers.
 *
 * Read-only on purpose. Acting on a stuck sale (issuing the receipt, deducting
 * the stock) is a money-path decision that has not been signed off, so this
 * page shows what happened and nothing more.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Loader2, RefreshCw, Terminal } from "lucide-react";
import { fmtDateTime } from "@/lib/dateFormat";

interface EdcCartItem {
    product_code: string;
    name: string;
    quantity: number;
    unit_price: number;
    discount: number;
    line_total: number;
    is_bundle?: boolean;
}

interface EdcCartSnapshot {
    shop_id: string | null;
    transaction_mode: string | null;
    payer: { customer_id: number | null; user_id: number | null; external_id: string | null } | null;
    items: EdcCartItem[];
    discount: number;
    total: number;
}

interface EdcEvent {
    id: number;
    event: string;
    context: string;
    shop_id: string | null;
    cashier_user_id: number | null;
    idempotency_key: string | null;
    pos_ref: string | null;
    edc_mode: string | null;
    amount: number | null;
    response_code: string | null;
    response_message: string | null;
    approval_code: string | null;
    has_approval_code: boolean;
    masked_card: string | null;
    rrn: string | null;
    fields: Record<string, string> | null;
    cart_snapshot: EdcCartSnapshot | null;
    amounts_match: boolean | null;
    checkout_attempted: boolean;
    client_error: string | null;
    client_at: string | null;
    created_at: string;
}

/** Response codes that mean the customer's money is committed — mirrors
 *  lib/paywire/edcResponseCodes.ts, kept local so this diagnostic page has no
 *  dependency on POS code. */
const APPROVED_CODES = new Set(["00", "Y1", "Y3", "DR", "DI"]);

function isUnrecorded(e: EdcEvent): boolean {
    return APPROVED_CODES.has(e.response_code ?? "") && !e.checkout_attempted;
}

const fmtMoney = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function EdcEvents() {
    const [rows, setRows] = useState<EdcEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<number | null>(null);

    const [shopId, setShopId] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [unrecordedOnly, setUnrecordedOnly] = useState(false);
    const [q, setQ] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ limit: "300" });
            if (shopId.trim()) params.set("shop_id", shopId.trim());
            if (dateFrom) params.set("date_from", dateFrom);
            if (dateTo) params.set("date_to", dateTo);
            if (unrecordedOnly) params.set("unrecorded_only", "true");
            setRows(await api.get<EdcEvent[]>(`/pos/edc-events?${params.toString()}`));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [shopId, dateFrom, dateTo, unrecordedOnly]);

    useEffect(() => { void load(); }, [load]);

    // Filtering by reference happens client-side: the server has no search
    // parameter and this page never holds more than a few hundred rows.
    const needle = q.trim().toLowerCase();
    const visible = needle
        ? rows.filter((r) =>
            [r.pos_ref, r.approval_code, r.idempotency_key, r.rrn, r.masked_card]
                .some((v) => (v ?? "").toLowerCase().includes(needle)))
        : rows;

    const unrecordedCount = rows.filter(isUnrecorded).length;

    return (
        <div className="page-shell">
            <div className="page-header">
                <h1 className="page-title flex items-center gap-2">
                    <Terminal className="h-6 w-6" />
                    EDC Events
                </h1>
                <p className="page-description">
                    Raw terminal telemetry, newest first. Internal diagnostics — read-only.
                </p>
            </div>

            <Card>
                <CardContent className="pt-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                            <Label className="text-sm">Shop ID</Label>
                            <Input value={shopId} onChange={(e) => setShopId(e.target.value)} placeholder="S0001" className="w-32" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-sm">From</Label>
                            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-sm">To</Label>
                            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                        </div>
                        <div className="flex flex-col gap-1 grow min-w-[200px]">
                            <Label className="text-sm">POS REF / APPR / card</Label>
                            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="56d032721d23…" />
                        </div>
                        <label className="flex items-center gap-2 text-sm h-10">
                            <input
                                type="checkbox"
                                checked={unrecordedOnly}
                                onChange={(e) => setUnrecordedOnly(e.target.checked)}
                            />
                            Unrecorded only
                        </label>
                        <Button variant="outline" onClick={() => void load()} disabled={loading}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        </Button>
                    </div>

                    {unrecordedCount > 0 && (
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4" />
                            {unrecordedCount} charge(s) approved at the terminal that the POS never sent to checkout
                        </div>
                    )}
                    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
                </CardContent>
            </Card>

            <Card className="mt-4">
                <CardContent className="pt-4">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/40">
                                    <TableHead>Time</TableHead>
                                    <TableHead>Event</TableHead>
                                    <TableHead>Shop</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead>Code</TableHead>
                                    <TableHead>APPR</TableHead>
                                    <TableHead>Card</TableHead>
                                    <TableHead>POS REF</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visible.length === 0 && !loading && (
                                    <TableRow>
                                        <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                                            No events.
                                        </TableCell>
                                    </TableRow>
                                )}
                                {visible.map((r) => (
                                    <>
                                        <TableRow
                                            key={r.id}
                                            className="cursor-pointer"
                                            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                                        >
                                            <TableCell className="whitespace-nowrap text-xs font-mono">{fmtDateTime(r.created_at)}</TableCell>
                                            <TableCell className="text-xs">{r.event}</TableCell>
                                            <TableCell className="text-xs">{r.shop_id ?? "—"}</TableCell>
                                            <TableCell className="text-right font-mono text-sm">{fmtMoney(r.amount)}</TableCell>
                                            <TableCell className="font-mono text-xs">{r.response_code ?? "—"}</TableCell>
                                            <TableCell className="font-mono text-xs">{r.approval_code ?? "—"}</TableCell>
                                            <TableCell className="font-mono text-xs">{r.masked_card ?? "—"}</TableCell>
                                            <TableCell className="font-mono text-[11px]">{r.pos_ref ?? "—"}</TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                {isUnrecorded(r) ? (
                                                    <Badge variant="destructive">NOT RECORDED</Badge>
                                                ) : r.checkout_attempted ? (
                                                    <Badge variant="secondary">sent to checkout</Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">—</span>
                                                )}
                                                {r.amounts_match === false && (
                                                    <Badge variant="destructive" className="ml-1">amount mismatch</Badge>
                                                )}
                                            </TableCell>
                                        </TableRow>

                                        {expanded === r.id && (
                                            <TableRow key={`${r.id}-detail`}>
                                                <TableCell colSpan={9} className="bg-muted/30">
                                                    <div className="grid gap-4 py-2 md:grid-cols-2">
                                                        <div>
                                                            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Cart</p>
                                                            {r.cart_snapshot ? (
                                                                <>
                                                                    <table className="w-full text-xs">
                                                                        <tbody>
                                                                            {r.cart_snapshot.items.map((it, i) => (
                                                                                <tr key={i}>
                                                                                    <td className="pr-2 font-mono text-muted-foreground">{it.product_code}</td>
                                                                                    <td className="pr-2">{it.name}</td>
                                                                                    <td className="pr-2 text-right">×{it.quantity}</td>
                                                                                    <td className="text-right font-mono">{fmtMoney(it.line_total)}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                    <p className="mt-1 text-xs">
                                                                        Snapshot total <span className="font-mono">{fmtMoney(r.cart_snapshot.total)}</span>
                                                                        {r.amounts_match === false && (
                                                                            <span className="ml-2 text-destructive">
                                                                                ≠ terminal {fmtMoney(r.amount)}
                                                                            </span>
                                                                        )}
                                                                    </p>
                                                                    {r.cart_snapshot.payer && (
                                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                                            payer — customer_id: {r.cart_snapshot.payer.customer_id ?? "—"} ·
                                                                            user_id: {r.cart_snapshot.payer.user_id ?? "—"} ·
                                                                            external_id: {r.cart_snapshot.payer.external_id ?? "—"}
                                                                        </p>
                                                                    )}
                                                                </>
                                                            ) : (
                                                                <p className="text-xs text-muted-foreground">
                                                                    No snapshot — only the <code>started</code> event carries one, and it is
                                                                    cleared 30 days after the event.
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Bridge fields</p>
                                                            <pre className="max-h-64 overflow-auto rounded bg-background p-2 text-[11px]">
                                                                {JSON.stringify(
                                                                    {
                                                                        context: r.context,
                                                                        cashier_user_id: r.cashier_user_id,
                                                                        edc_mode: r.edc_mode,
                                                                        idempotency_key: r.idempotency_key,
                                                                        rrn: r.rrn,
                                                                        response_message: r.response_message,
                                                                        client_error: r.client_error,
                                                                        client_at: r.client_at,
                                                                        fields: r.fields,
                                                                    },
                                                                    null,
                                                                    2,
                                                                )}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
