import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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

interface BundleReportComponent {
  product_id: number;
  product_code: string;
  product_name: string;
  qty_per_bundle: number;
  stock: number;
}
interface BundleReportRow {
  bundle_id: number;
  bundle_code: string;
  bundle_name: string;
  shop_id: string;
  shop_name: string | null;
  external_price: number;
  internal_price: number;
  sellable_qty: number;
  components: BundleReportComponent[];
}
interface BundleReportData {
  shop_id: string | null;
  rows: BundleReportRow[];
}

interface BundleReportProps {
  reportId: string;
}

export function BundleReport({ reportId }: BundleReportProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();

  const [bundleShopId, setBundleShopId] = useState<string>("");
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleData, setBundleData] = useState<BundleReportData | null>(null);
  const [bundleShops, setBundleShops] = useState<ShopOption[]>([]);

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    api
      .get<ShopOption[]>("/shops?active_only=true&module=store")
      .then(setBundleShops)
      .catch((e) => console.error("[Reports] shop fetch failed:", e));
  }, [user]);

  useEffect(() => {
    setBundleData(null);
  }, [bundleShopId]);

  const handleLoadBundle = async () => {
    const effectiveShopId = user?.role === "admin" ? bundleShopId : (user?.shopId ?? "");
    if (!effectiveShopId) {
      toast.error(t("reports.stockCard.fillAll"));
      return;
    }
    setBundleLoading(true);
    setBundleData(null);
    try {
      const data = await api.get<BundleReportData>(
        `/reports/bundle-report?shop_id=${encodeURIComponent(effectiveShopId)}`,
      );
      setBundleData(data);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setBundleLoading(false);
    }
  };

  const buildBundlePayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!bundleData) return null;

    const columns: ReportColumn[] = [
      { header: "Component Code", key: "component_code", width: 90 },
      { header: "Component Name", key: "component_name", width: 130 },
      { header: "Qty / Bundle", key: "qty_per_bundle", format: "number", width: 60 },
      { header: "Component Stock", key: "component_stock", format: "number", width: 65 },
    ];

    const body: Record<string, unknown>[] = [];
    for (const bundle of bundleData.rows) {
      body.push({
        [SECTION_KEY]:
          `Bundle Code: ${bundle.bundle_code} — ${bundle.bundle_name}` +
          ` (Sellable now: ${bundle.sellable_qty}, External: ${bundle.external_price.toFixed(2)}, Internal: ${bundle.internal_price.toFixed(2)})`,
      });
      for (const c of bundle.components) {
        body.push({
          component_code: c.product_code,
          component_name: c.product_name,
          qty_per_bundle: c.qty_per_bundle,
          component_stock: c.stock,
        });
      }
      body.push({
        [EMPHASIS_KEY]: "total" as const,
        component_code: "",
        component_name: "Sellable now :",
        qty_per_bundle: "",
        component_stock: bundle.sellable_qty,
      });
    }

    const filterLines: string[] = [];
    filterLines.push(`User ID: ${user?.username ?? user?.fullName ?? "-"}`);
    filterLines.push(`Print Date: ${new Date().toLocaleString("en-GB")}`);

    return {
      meta: {
        title: "Bundle Report",
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        reportId,
        filters: filterLines,
      },
      columns,
      rows: body,
    };
  };

  const handleExportBundlePdf = async () => {
    const payload = buildBundlePayload();
    if (!payload || !bundleData) return;
    try {
      const fname = `BundleReport_${bundleData.shop_id ?? "shop"}.pdf`;
      await exportToPDF(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  const handleExportBundleExcel = () => {
    const payload = buildBundlePayload();
    if (!payload || !bundleData) return;
    try {
      const fname = `BundleReport_${bundleData.shop_id ?? "shop"}.xlsx`;
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
            <Package className="h-5 w-5 text-primary" />
            {t("reports.bundleReport")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {user?.role === "admin" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bdlShop">{t("reports.colShop")}</Label>
                <Select value={bundleShopId} onValueChange={setBundleShopId}>
                  <SelectTrigger id="bdlShop">
                    <SelectValue placeholder={t("reports.selectShopPlaceholder", "Select shop")} />
                  </SelectTrigger>
                  <SelectContent>
                    {bundleShops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleLoadBundle} disabled={bundleLoading}>
              {bundleLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("reports.stockCard.load")}
            </Button>
            {bundleData && bundleData.rows.length > 0 && (
              <>
                <Button variant="outline" onClick={handleExportBundlePdf}>
                  <FileText className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
                <Button variant="outline" onClick={handleExportBundleExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export Excel
                </Button>
              </>
            )}
          </div>

          {bundleData && (
            <div className="space-y-2">
              {bundleData.rows.length === 0 ? (
                <div className="rounded-md border p-6 text-center text-muted-foreground text-sm">
                  {t("reports.stockCard.noMovements")}
                </div>
              ) : (
                <div className="space-y-4">
                  {bundleData.rows.map((bundle) => (
                    <div key={bundle.bundle_id} className="overflow-x-auto rounded-md border">
                      <div className="bg-secondary/40 px-3 py-2 text-sm font-semibold flex flex-wrap items-center justify-between gap-2">
                        <span>{bundle.bundle_code} — {bundle.bundle_name}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          External {bundle.external_price.toFixed(2)} · Internal {bundle.internal_price.toFixed(2)}
                        </span>
                      </div>
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-2 py-2 text-left">Component Code</th>
                            <th className="px-2 py-2 text-left">Component Name</th>
                            <th className="px-2 py-2 text-right">Qty / Bundle</th>
                            <th className="px-2 py-2 text-right">Component Stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bundle.components.map((c) => (
                            <tr key={c.product_id} className="border-t">
                              <td className="px-2 py-1">{c.product_code}</td>
                              <td className="px-2 py-1">{c.product_name}</td>
                              <td className="px-2 py-1 text-right font-mono">{c.qty_per_bundle}</td>
                              <td className="px-2 py-1 text-right font-mono">{c.stock}</td>
                            </tr>
                          ))}
                          <tr className="border-t font-semibold bg-muted/30">
                            <td className="px-2 py-1"></td>
                            <td className="px-2 py-1">Sellable now :</td>
                            <td></td>
                            <td className="px-2 py-1 text-right font-mono">{bundle.sellable_qty}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
