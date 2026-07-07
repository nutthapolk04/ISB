import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BookOpen, FileDown, FileText, Loader2, PackagePlus } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Types matching backend balance_file_service.ts ──────────────────────

interface LedgerRow {
  date: string | null;
  description: string;
  doc_no: string | null;
  in_qty: number | null;
  in_unit_cost: number | null;
  in_amount: number | null;
  out_qty: number | null;
  out_avg_cost: number | null;
  out_amount: number | null;
  bal_qty: number;
  bal_avg_cost: number;
  bal_total_value: number;
  note: string | null;
}

interface BalanceFileBlock {
  product_id: number;
  product_code: string | null;
  product_name: string;
  rows: LedgerRow[];
  summary: {
    in_qty: number;
    in_amount: number;
    out_qty: number;
    out_amount: number;
    final_qty: number;
    final_avg_cost: number;
    final_value: number;
  };
}

interface BalanceFileReportData {
  shop_id: string;
  shop_name: string | null;
  year: number;
  month: number | null;
  blocks: BalanceFileBlock[];
}

interface ShopOption { id: string; name: string; }
interface ProductOption { id: number; name: string; product_code?: string | null; }

// ── Helpers ─────────────────────────────────────────────────────────────

const DASH = "—";
const fmtNum = (v: number | null, dp = 2) =>
  v === null || v === undefined ? DASH : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtQty = (v: number | null) =>
  v === null || v === undefined ? DASH : v.toLocaleString(undefined, { maximumFractionDigits: 0 });

function getMonthLabel(monthIndex: number, lang: string) {
  const date = new Date(2000, monthIndex, 1);
  return date.toLocaleDateString(lang === "th" ? "th-TH" : "en-US", { month: "long" });
}

function formatYear(adYear: number, lang: string) {
  return lang === "th" ? `${adYear} / ${adYear + 543}` : String(adYear);
}

function formatPeriod(month: number | null, adYear: number, lang: string) {
  if (month === null) return lang === "th" ? `ปี ${adYear + 543}` : `Year ${adYear}`;
  const label = getMonthLabel(month - 1, lang);
  return lang === "th"
    ? `${String(month).padStart(2, "0")}/${adYear + 543} — ${label}`
    : `${label} ${adYear}`;
}

// ── Component ───────────────────────────────────────────────────────────

interface Props {
  /** When provided (embedded inside Inventory tab), skip shop selector + Receive Stock nav button. */
  lockedShopId?: string;
}

export default function BalanceFileReport({ lockedShopId }: Props = {}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user } = useAuth();
  const navigate = useNavigate();
  const embedded = !!lockedShopId;
  const isAdmin = user?.role === "admin";

  const now = new Date();
  const [viewMode, setViewMode] = useState<"monthly" | "yearly">("monthly");
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);

  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopId, setShopId] = useState<string>(lockedShopId ?? "");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productId, setProductId] = useState<string>("all");

  const [data, setData] = useState<BalanceFileReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load shops list (admin only, non-embedded); embedded uses lockedShopId; non-admin uses own shopId
  useEffect(() => {
    if (embedded) return;
    if (isAdmin) {
      api.get<ShopOption[]>("/shops?active_only=true&module=store")
        .then((rows) => {
          setShops(rows);
          if (rows.length > 0 && !shopId) setShopId(rows[0].id);
        })
        .catch(() => setShops([]));
    } else if (user?.shopId) {
      setShopId(user.shopId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, isAdmin, user?.shopId]);

  // Load products when shop changes
  useEffect(() => {
    if (!shopId) {
      setProducts([]);
      return;
    }
    api.get<ProductOption[]>(`/shops/${shopId}/products?include_inactive=false`)
      .then(setProducts)
      .catch(() => setProducts([]));
    setProductId("all");
    setData(null);
  }, [shopId]);

  const yearOptions = useMemo(() => {
    const current = now.getFullYear();
    const out: number[] = [];
    for (let y = current; y >= current - 5; y--) out.push(y);
    return out;
  }, [now]);

  const load = async () => {
    if (!shopId) {
      toast({ title: t("balanceFile.selectShop", "Please select a shop"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (viewMode === "monthly") params.set("month", String(month));
      if (productId !== "all") params.set("product_id", productId);
      const res = await api.get<BalanceFileReportData>(
        `/shops/${shopId}/balance-file?${params.toString()}`,
      );
      setData(res);
      if (res.blocks.length === 0) {
        toast({ title: t("balanceFile.empty", "No data for the selected period.") });
      }
    } catch (e) {
      toast({
        title: t("balanceFile.loadFailed", "Failed to load balance file"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = async () => {
    if (!shopId) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (viewMode === "monthly") params.set("month", String(month));
      if (productId !== "all") params.set("product_id", productId);
      const token = localStorage.getItem("access_token");
      const res = await fetch(
        `${API_BASE_URL}/shops/${shopId}/balance-file/export?${params.toString()}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = viewMode === "monthly" ? `-${String(month).padStart(2, "0")}` : "";
      a.download = `balance-file-${year}${suffix}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: t("balanceFile.exportFailed", "Excel export failed"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const goReceiveStock = () => {
    if (shopId) navigate(`/store/management/${shopId}`);
    else navigate("/store/management");
  };

  const exportPdf = () => {
    if (!data || data.blocks.length === 0) return;

    const periodLabel = formatPeriod(data.month, data.year, lang);
    const shopLabel = data.shop_name ?? shopId;
    const generatedAt = new Date().toLocaleString(lang === "th" ? "th-TH" : "en-US", { calendar: "gregory" });

    const colIn  = t("balanceFile.col.in");
    const colOut = t("balanceFile.col.out");
    const colBal = t("balanceFile.col.balance");

    const blocksHtml = data.blocks.map((block) => {
      const heading = block.product_code
        ? `${block.product_code} — ${block.product_name}`
        : block.product_name;

      const rows = block.rows.map((r, idx) => {
        const isOpening = idx === 0;
        const isSummary = idx === block.rows.length - 1;
        const dateCell = r.date ?? (isOpening ? t("balanceFile.opening") : isSummary ? t("balanceFile.summary") : "—");
        const cls = isOpening ? 'class="opening"' : isSummary ? 'class="summary"' : "";
        return `<tr ${cls}>
          <td>${dateCell}</td>
          <td>${r.description}</td>
          <td class="mono">${r.doc_no ?? "—"}</td>
          <td class="num">${fmtQty(r.in_qty)}</td>
          <td class="num">${fmtNum(r.in_unit_cost)}</td>
          <td class="num">${fmtNum(r.in_amount)}</td>
          <td class="num">${fmtQty(r.out_qty)}</td>
          <td class="num">${fmtNum(r.out_avg_cost, 4)}</td>
          <td class="num">${fmtNum(r.out_amount)}</td>
          <td class="num">${fmtQty(r.bal_qty)}</td>
          <td class="num">${fmtNum(r.bal_avg_cost, 4)}</td>
          <td class="num">${fmtNum(r.bal_total_value)}</td>
          <td>${r.note ?? "—"}</td>
        </tr>`;
      }).join("");

      return `
        <div class="block">
          <div class="block-heading">${heading}</div>
          <table>
            <thead>
              <tr>
                <th rowspan="2">${t("balanceFile.col.date")}</th>
                <th rowspan="2">${t("balanceFile.col.desc")}</th>
                <th rowspan="2">${t("balanceFile.col.doc")}</th>
                <th colspan="3" class="group-in">${colIn}</th>
                <th colspan="3" class="group-out">${colOut}</th>
                <th colspan="3" class="group-bal">${colBal}</th>
                <th rowspan="2">${t("balanceFile.col.note")}</th>
              </tr>
              <tr>
                <th class="group-in num">Qty</th>
                <th class="group-in num">Unit Cost</th>
                <th class="group-in num">Amount</th>
                <th class="group-out num">Qty</th>
                <th class="group-out num">Avg Cost</th>
                <th class="group-out num">Amount</th>
                <th class="group-bal num">Qty</th>
                <th class="group-bal num">Avg Cost</th>
                <th class="group-bal num">Total Value</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>Balance File — ${periodLabel}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Sarabun", "Noto Sans Thai", Arial, sans-serif; font-size: 8pt; color: #111; }
  .report-header { text-align: center; margin-bottom: 10px; }
  .report-header h1 { font-size: 13pt; margin: 0 0 2px; }
  .report-header h2 { font-size: 10pt; margin: 0 0 2px; font-weight: normal; }
  .report-header .meta { font-size: 8pt; color: #555; }
  .block { margin-bottom: 14px; page-break-inside: avoid; }
  .block-heading { font-size: 9pt; font-weight: bold; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
  th, td { border: 1px solid #ccc; padding: 2px 4px; white-space: nowrap; }
  th { background: #f3f4f6; font-weight: 600; text-align: center; }
  .group-in  { background: #dcfce7 !important; }
  .group-out { background: #ffedd5 !important; }
  .group-bal { background: #dbeafe !important; }
  .num { text-align: right; }
  .mono { font-family: monospace; font-size: 7pt; }
  tr.opening { background: #fefce8; font-weight: 600; }
  tr.summary { background: #f4f4f5; font-weight: 700; border-top: 2px solid #888; }
  .footer { text-align: right; font-size: 7pt; color: #888; margin-top: 6px; }
  @media print {
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="report-header">
  <h1>International School Bangkok</h1>
  <h2>Balance File Report</h2>
  <div class="meta">${t("balanceFile.period")}: ${periodLabel} &nbsp;·&nbsp; Shop: ${shopLabel}</div>
</div>
${blocksHtml}
<div class="footer">${t("common.generatedAt", "Generated")}: ${generatedAt}</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) {
      toast({ title: "Popup blocked — please allow popups for this site.", variant: "destructive" });
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className={embedded ? "space-y-4" : "page-shell space-y-4"}>
      {!embedded && (
        <div className="page-header">
          <h1 className="page-title flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            {t("balanceFile.title", "Balance File")}
          </h1>
          <p className="page-description">
            {t("balanceFile.subtitle", "Inventory ledger using Average Cost method — monthly breakdown linked to Receive Stock data.")}
          </p>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("balanceFile.filters", "Filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* View mode toggle */}
            <div className="space-y-1">
              <Label>{t("balanceFile.viewMode", "View")}</Label>
              <div className="flex rounded-md border border-input overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode("monthly")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium transition-colors",
                    viewMode === "monthly"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t("balanceFile.monthly", "Monthly")}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("yearly")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium transition-colors border-l border-input",
                    viewMode === "yearly"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t("balanceFile.yearly", "Yearly")}
                </button>
              </div>
            </div>

            {isAdmin && !embedded && (
              <div className="space-y-1">
                <Label>{t("balanceFile.shop", "Shop")}</Label>
                <Select value={shopId} onValueChange={setShopId}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Select shop" /></SelectTrigger>
                  <SelectContent>
                    {shops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>{t("balanceFile.product", "Product")}</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">{t("balanceFile.allProducts", "All products")}</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.product_code ? `${p.product_code} — ${p.name}` : p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {viewMode === "monthly" && (
              <div className="space-y-1">
                <Label>{t("balanceFile.month", "Month")}</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {String(i + 1).padStart(2, "0")} — {getMonthLabel(i, lang)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>{t("balanceFile.year", "Year")}</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {formatYear(y, lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={load} disabled={loading || !shopId}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t("balanceFile.load", "Load")}
            </Button>

            <Button variant="outline" onClick={exportExcel} disabled={exporting || !data || data.blocks.length === 0}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileDown className="h-4 w-4 mr-1" />}
              {t("balanceFile.exportExcel", "Export Excel")}
            </Button>

            <Button variant="outline" onClick={exportPdf} disabled={!data || data.blocks.length === 0}>
              <FileText className="h-4 w-4 mr-1" />
              {t("balanceFile.exportPdf", "Export PDF")}
            </Button>

            {!embedded && (
              <Button variant="secondary" onClick={goReceiveStock} className="ml-auto">
                <PackagePlus className="h-4 w-4 mr-1" />
                {t("balanceFile.goReceive", "Receive Stock")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Ledger */}
      {data && data.blocks.map((block) => (
        <Card key={block.product_id}>
          <CardHeader>
            <CardTitle className="text-base">
              {block.product_code ? `${block.product_code} — ` : ""}
              {block.product_name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("balanceFile.period", "Period")}: {formatPeriod(data.month, data.year, lang)}
              {data.shop_name && ` · ${data.shop_name}`}
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead rowSpan={2}>{t("balanceFile.col.date")}</TableHead>
                  <TableHead rowSpan={2}>{t("balanceFile.col.desc")}</TableHead>
                  <TableHead rowSpan={2}>{t("balanceFile.col.doc")}</TableHead>
                  <TableHead colSpan={3} className="text-center bg-green-50">
                    {t("balanceFile.col.in")}
                  </TableHead>
                  <TableHead colSpan={3} className="text-center bg-orange-50">
                    {t("balanceFile.col.out")}
                  </TableHead>
                  <TableHead colSpan={3} className="text-center bg-blue-50">
                    {t("balanceFile.col.balance")}
                  </TableHead>
                  <TableHead rowSpan={2}>{t("balanceFile.col.note")}</TableHead>
                </TableRow>
                <TableRow className="bg-muted/40">
                  <TableHead className="bg-green-50 text-right">Qty</TableHead>
                  <TableHead className="bg-green-50 text-right">Unit Cost</TableHead>
                  <TableHead className="bg-green-50 text-right">Amount</TableHead>
                  <TableHead className="bg-orange-50 text-right">Qty</TableHead>
                  <TableHead className="bg-orange-50 text-right">Avg Cost</TableHead>
                  <TableHead className="bg-orange-50 text-right">Amount</TableHead>
                  <TableHead className="bg-blue-50 text-right">Qty</TableHead>
                  <TableHead className="bg-blue-50 text-right">Avg Cost</TableHead>
                  <TableHead className="bg-blue-50 text-right">Total Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {block.rows.map((r, idx) => {
                  const isOpening = idx === 0;
                  const isSummary = idx === block.rows.length - 1;
                  return (
                    <TableRow key={idx} className={cn(
                      isOpening && "bg-amber-50/60 font-semibold",
                      isSummary && "bg-zinc-100 font-semibold border-t-2",
                    )}>
                      <TableCell>{r.date ?? (isOpening ? t("balanceFile.opening") : isSummary ? t("balanceFile.summary") : DASH)}</TableCell>
                      <TableCell>{isOpening ? t("balanceFile.opening") : isSummary ? t("balanceFile.summary") : r.description}</TableCell>
                      <TableCell className="font-mono">{r.doc_no ?? DASH}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(r.in_qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.in_unit_cost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.in_amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(r.out_qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.out_avg_cost, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.out_amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(r.bal_qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.bal_avg_cost, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.bal_total_value)}</TableCell>
                      <TableCell>{isOpening ? t("balanceFile.opening") : isSummary ? t("balanceFile.closingBalance", "Closing Balance") : (r.note ?? DASH)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {data && data.blocks.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("balanceFile.empty", "No data for the selected period.")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
