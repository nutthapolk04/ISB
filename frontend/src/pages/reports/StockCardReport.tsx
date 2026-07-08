import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardList, FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import {
  exportToPDF,
  exportToExcel,
  SECTION_KEY,
  EMPHASIS_KEY,
  type ReportColumn,
  type ReportPayload,
} from "@/lib/reportExport";

interface ShopOption { id: string; name: string; }

interface StockCardRow {
  date: string | null;
  description: string;
  invoice_no: string | null;
  qty_in: number;
  qty_out: number;
  qty_balance: number;
  amount_in: number;
  amount_out: number;
  cost_per_unit: number;
  amount_balance: number;
}
interface StockCardProductBlock {
  product_variant_id: number;
  product_code: string;
  product_name: string;
  rows: StockCardRow[];
  total_qty_in: number;
  total_qty_out: number;
  total_amount_in: number;
  total_amount_out: number;
}
interface StockCardReportData {
  shop_id: string | null;
  shop_name: string | null;
  date_from: string;
  date_to: string;
  products: StockCardProductBlock[];
}

interface StockCardReportProps {
  reportId: string;
  isCanteenReportsPage: boolean;
}

export function StockCardReport({ reportId, isCanteenReportsPage }: StockCardReportProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();

  // Stock Card state. Multi-product mode requires shop_id; admins pick the
  // shop, single-shop users (manager/cashier) auto-use their own.
  const [stockCardShopId, setStockCardShopId] = useState<string>("");
  const [stockCardFrom, setStockCardFrom] = useState("");
  const [stockCardTo, setStockCardTo] = useState("");
  const [stockCardProductSearch, setStockCardProductSearch] = useState("");
  const [stockCardCategory, setStockCardCategory] = useState<string>("all");
  const [stockCardIncludeEmpty, setStockCardIncludeEmpty] = useState(false);
  const [stockCardLoading, setStockCardLoading] = useState(false);
  const [stockCardData, setStockCardData] = useState<StockCardReportData | null>(null);
  const [stockCardShops, setStockCardShops] = useState<ShopOption[]>([]);
  const [stockCardCategories, setStockCardCategories] = useState<string[]>([]);

  // Admin needs a shop dropdown — fetch on mount (this panel only mounts
  // while the Stock Card tile is selected).
  useEffect(() => {
    if (!user) return;
    const module = isCanteenReportsPage ? "canteen" : "store";
    api.get<ShopOption[]>(`/shops?active_only=true&module=${module}`)
      .then(setStockCardShops)
      .catch((e) => console.error("[Reports] shop fetch failed:", e));
  }, [user, isCanteenReportsPage]);

  // Fetch distinct category names for the current shop so the dropdown shows
  // only categories that actually have products. Resets when the shop
  // changes; admins switch shops, manager/cashier are pinned to theirs.
  useEffect(() => {
    const shopForCats = user?.role === "admin" ? stockCardShopId : user?.shopId ?? "";
    if (!shopForCats) {
      setStockCardCategories([]);
      setStockCardCategory("all");
      return;
    }
    api
      .get<{ category: string }[] | string[]>(`/shops/${shopForCats}/products?include_inactive=false`)
      .then((products) => {
        const names = new Set<string>();
        for (const p of products as Array<{ category?: string }>) {
          if (p?.category) names.add(p.category);
        }
        setStockCardCategories([...names].sort());
      })
      .catch(() => setStockCardCategories([]));
    setStockCardCategory("all");
  }, [stockCardShopId, user?.role, user?.shopId]);

  useEffect(() => {
    setStockCardData(null);
  }, [stockCardShopId]);

  const handleLoadStockCard = async () => {
    // Resolve the effective shop_id: admins choose, others are locked to their
    // own shop. Backend will 400 if it ends up empty.
    const effectiveShopId = user?.role === "admin" ? stockCardShopId : (user?.shopId ?? "");
    if (!effectiveShopId || !stockCardFrom || !stockCardTo) {
      toast.error(t("reports.stockCard.fillAll"));
      return;
    }
    setStockCardLoading(true);
    setStockCardData(null);
    try {
      const params = new URLSearchParams({
        shop_id: effectiveShopId,
        date_from: stockCardFrom,
        date_to: stockCardTo,
      });
      const trimmedSearch = stockCardProductSearch.trim();
      if (trimmedSearch) params.set("product_search", trimmedSearch);
      if (stockCardCategory && stockCardCategory !== "all") {
        params.set("category", stockCardCategory);
      }
      if (stockCardIncludeEmpty) params.set("include_empty", "true");
      const data = await api.get<StockCardReportData>(
        `/reports/stock-card?${params.toString()}`,
      );
      setStockCardData(data);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setStockCardLoading(false);
    }
  };

  /**
   * Build the shared ReportPayload for Stockcard. Used by both PDF and Excel
   * exporters so the two outputs stay structurally identical.
   *
   * Layout mirrors the legacy MyCampusCard printed report: per-product
   * sections with a "Product Code … Name" header row, the Beginning Balance
   * row, every movement, the Closing Balance row, and a per-product TOTAL
   * row. All sections share the same column structure so the underlying
   * table renderer doesn't need to know about sections.
   */
  const buildStockCardPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!stockCardData) return null;
    const { shop_name, date_from, date_to, products } = stockCardData;

    const columns: ReportColumn[] = [
      { header: "Date", key: "date", format: "date", width: 60 },
      { header: "Description", key: "description", width: 80 },
      { header: "Invoice No.", key: "invoice_no", width: 95 },
      { header: "Qty In", key: "qty_in", format: "number", width: 45 },
      { header: "Qty Out", key: "qty_out", format: "number", width: 45 },
      { header: "Qty Balance", key: "qty_balance", format: "number", width: 55 },
      { header: "Amt In", key: "amount_in", format: "currency", width: 60 },
      { header: "Amt Out", key: "amount_out", format: "currency", width: 60 },
      { header: "Cost/Unit", key: "cost_per_unit", format: "currency", width: 55 },
      { header: "Amt Balance", key: "amount_balance", format: "currency", width: 70 },
    ];

    const body: Record<string, unknown>[] = [];
    for (const block of products) {
      // Section header — uses the SECTION_KEY sentinel so the PDF/Excel
      // exporter merges the cell across every column (matching the legacy
      // MyCampusCard layout where the product label sits on its own row).
      body.push({
        [SECTION_KEY]: `Product Code: ${block.product_code} — ${block.product_name}`,
      });
      for (const r of block.rows) {
        // The "Closing Balance" row is the per-product running total — mark
        // it as a subtotal so the PDF gives it a tinted background and bold
        // text. "Beginning Balance" stays plain.
        const isClosing =
          typeof r.description === "string" &&
          r.description.toLowerCase().includes("closing");
        body.push({
          ...(isClosing ? { [EMPHASIS_KEY]: "subtotal" as const } : {}),
          date: r.date ?? "",
          description: r.description,
          invoice_no: r.invoice_no ?? "",
          qty_in: r.qty_in || "",
          qty_out: r.qty_out || "",
          qty_balance: r.qty_balance,
          amount_in: r.amount_in || "",
          amount_out: r.amount_out || "",
          cost_per_unit: r.cost_per_unit || "",
          amount_balance: r.amount_balance,
        });
      }
      // Per-product subtotal row — darker emphasis than Closing Balance so
      // the eye can tell them apart at a glance.
      body.push({
        [EMPHASIS_KEY]: "total" as const,
        date: "",
        description: "Total :",
        invoice_no: "",
        qty_in: block.total_qty_in,
        qty_out: block.total_qty_out,
        qty_balance: "",
        amount_in: block.total_amount_in,
        amount_out: block.total_amount_out,
        cost_per_unit: "",
        amount_balance: "",
      });
    }

    const filterLines: string[] = [
      `Shop: ${shop_name ?? stockCardData.shop_id ?? "-"}`,
    ];
    const trimmedSearch = stockCardProductSearch.trim();
    if (trimmedSearch) filterLines.push(`Search: ${trimmedSearch}`);
    if (stockCardCategory && stockCardCategory !== "all") {
      filterLines.push(`Category: ${stockCardCategory}`);
    }
    if (stockCardIncludeEmpty) filterLines.push("Includes empty products");
    filterLines.push(`User ID: ${user?.username ?? user?.fullName ?? "-"}`);
    filterLines.push(`Print Date: ${new Date().toLocaleString("en-GB")}`);

    return {
      meta: {
        title: `Stockcard Report From ${date_from} To ${date_to}`,
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        reportId,
        filters: filterLines,
      },
      columns,
      rows: body,
    };
  };

  const handleExportStockCardPdf = async () => {
    const payload = buildStockCardPayload();
    if (!payload || !stockCardData) return;
    try {
      const fname = `StockCard_${stockCardData.shop_id ?? "shop"}_${stockCardData.date_from}_${stockCardData.date_to}.pdf`;
      await exportToPDF(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  const handleExportStockCardExcel = () => {
    const payload = buildStockCardPayload();
    if (!payload || !stockCardData) return;
    try {
      const fname = `StockCard_${stockCardData.shop_id ?? "shop"}_${stockCardData.date_from}_${stockCardData.date_to}.xlsx`;
      exportToExcel(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            {t("reports.stockCardReport")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {user?.role === "admin" && (
              <div className="space-y-2">
                <Label htmlFor="scShop">{t("reports.colShop")}</Label>
                <Select value={stockCardShopId} onValueChange={setStockCardShopId}>
                  <SelectTrigger id="scShop">
                    <SelectValue placeholder={t("reports.selectShopPlaceholder", "Select shop")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stockCardShops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={`space-y-2 ${user?.role === "admin" ? "md:col-span-2" : "md:col-span-3"}`}>
              <Label>{t("reports.startDate")} — {t("reports.endDate")}</Label>
              <DateRangePicker
                id="scDateRange"
                startDate={stockCardFrom}
                endDate={stockCardTo}
                onStartChange={(v) => { setStockCardFrom(v); setStockCardData(null); }}
                onEndChange={(v) => { setStockCardTo(v); setStockCardData(null); }}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scProductSearch">
                {t("reports.stockCard.productSearch", "Product")}
              </Label>
              <Input
                id="scProductSearch"
                value={stockCardProductSearch}
                onChange={(e) => {
                  setStockCardProductSearch(e.target.value);
                  setStockCardData(null);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") handleLoadStockCard(); }}
                placeholder={t(
                  "reports.stockCard.productSearchPlaceholder",
                  "Search by code, name, or barcode",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scCategory">
                {t("reports.stockCard.category", "Category")}
              </Label>
              <Select value={stockCardCategory} onValueChange={(v) => { setStockCardCategory(v); setStockCardData(null); }}>
                <SelectTrigger id="scCategory">
                  <SelectValue
                    placeholder={t("reports.stockCard.allCategories", "All categories")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("reports.stockCard.allCategories", "All categories")}
                  </SelectItem>
                  {stockCardCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="scIncludeEmpty">
                {t("reports.stockCard.showEmpty", "Show products with no movement")}
              </Label>
              <div className="flex items-center h-10 gap-2">
                <input
                  id="scIncludeEmpty"
                  type="checkbox"
                  checked={stockCardIncludeEmpty}
                  onChange={(e) => setStockCardIncludeEmpty(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-xs text-muted-foreground">
                  {t(
                    "reports.stockCard.showEmptyHint",
                    "Include items that had no sales and zero opening balance",
                  )}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleLoadStockCard} disabled={stockCardLoading}>
              {stockCardLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("reports.stockCard.load")}
            </Button>
            {stockCardData && stockCardData.products.length > 0 && (
              <>
                <Button variant="outline" onClick={handleExportStockCardPdf}>
                  <FileText className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
                <Button variant="outline" onClick={handleExportStockCardExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export Excel
                </Button>
              </>
            )}
          </div>

          {stockCardData && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">{stockCardData.shop_name ?? stockCardData.shop_id ?? "—"}</span>
                {" · "}{stockCardData.date_from} → {stockCardData.date_to}
              </div>
              {stockCardData.products.length === 0 ? (
                <div className="rounded-md border p-6 text-center text-muted-foreground text-sm">
                  {t("reports.stockCard.noMovements")}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-2 py-2 text-left">{t("reports.colDate")}</th>
                        <th className="px-2 py-2 text-left">Description</th>
                        <th className="px-2 py-2 text-left">Invoice No.</th>
                        <th className="px-2 py-2 text-right">Qty In</th>
                        <th className="px-2 py-2 text-right">Qty Out</th>
                        <th className="px-2 py-2 text-right">Qty Bal.</th>
                        <th className="px-2 py-2 text-right">Amt In</th>
                        <th className="px-2 py-2 text-right">Amt Out</th>
                        <th className="px-2 py-2 text-right">Cost/Unit</th>
                        <th className="px-2 py-2 text-right">Amt Bal.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockCardData.products.map((block) => (
                        <React.Fragment key={block.product_variant_id}>
                          <tr className="border-t bg-secondary/40">
                            <td className="px-2 py-2 font-semibold" colSpan={10}>
                              Product Code {block.product_code} &nbsp;&nbsp; {block.product_name}
                            </td>
                          </tr>
                          {block.rows.map((row, i) => (
                            <tr key={`${block.product_variant_id}-${i}`} className="border-t">
                              <td className="px-2 py-1 whitespace-nowrap">
                                {row.date ? row.date.slice(0, 10) : ""}
                              </td>
                              <td className="px-2 py-1">{row.description}</td>
                              <td className="px-2 py-1">{row.invoice_no ?? ""}</td>
                              <td className="px-2 py-1 text-right font-mono">{row.qty_in || ""}</td>
                              <td className="px-2 py-1 text-right font-mono">{row.qty_out || ""}</td>
                              <td className="px-2 py-1 text-right font-mono">{row.qty_balance}</td>
                              <td className="px-2 py-1 text-right font-mono">{row.amount_in ? row.amount_in.toFixed(2) : ""}</td>
                              <td className="px-2 py-1 text-right font-mono">{row.amount_out ? row.amount_out.toFixed(2) : ""}</td>
                              <td className="px-2 py-1 text-right font-mono">{row.cost_per_unit ? row.cost_per_unit.toFixed(2) : ""}</td>
                              <td className="px-2 py-1 text-right font-mono">{row.amount_balance.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr className="border-t font-semibold bg-muted/30">
                            <td className="px-2 py-1"></td>
                            <td className="px-2 py-1">Total :</td>
                            <td></td>
                            <td className="px-2 py-1 text-right font-mono">{block.total_qty_in || ""}</td>
                            <td className="px-2 py-1 text-right font-mono">{block.total_qty_out || ""}</td>
                            <td></td>
                            <td className="px-2 py-1 text-right font-mono">{block.total_amount_in ? block.total_amount_in.toFixed(2) : ""}</td>
                            <td className="px-2 py-1 text-right font-mono">{block.total_amount_out ? block.total_amount_out.toFixed(2) : ""}</td>
                            <td></td>
                            <td></td>
                          </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
