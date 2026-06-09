import { useCallback, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoCallout } from "@/components/InfoCallout";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  Upload,
} from "lucide-react";

interface ImportResultShape {
  created?: number;
  updated?: number;
  imported?: number;
  errors: { row: number; reason: string }[];
}

interface PreviewState {
  open: boolean;
  kind: "products" | "stock";
  result: ImportResultShape | null;
  fileName: string;
  file: File | null;
  confirming: boolean;
}

interface Props {
  shopId: string | undefined;
  /**
   * Whether the StockReceive flow is exposed. Canteen shops don't track
   * per-SKU stock so the option is irrelevant there — hide it to keep the UI
   * focused on the menu/Products import.
   */
  showStockReceive?: boolean;
}

export function ShopImportPanel({ shopId, showStockReceive = true }: Props) {
  const { t } = useTranslation();
  const [importingProducts, setImportingProducts] = useState(false);
  const [importingStock, setImportingStock] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const productsFileRef = useRef<HTMLInputElement>(null);
  const stockFileRef = useRef<HTMLInputElement>(null);

  const callImport = useCallback(
    async (kind: "products" | "stock", file: File, dryRun: boolean): Promise<ImportResultShape> => {
      const form = new FormData();
      form.append("file", file);
      const path =
        kind === "products"
          ? `/admin/import/products?shop_id=${encodeURIComponent(shopId ?? "")}&dry_run=${dryRun}`
          : `/admin/import/stock-receive?dry_run=${dryRun}`;
      return await api.postFormData<ImportResultShape>(path, form);
    },
    [shopId],
  );

  const startProductsPreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !shopId) return;
    e.target.value = "";
    setImportingProducts(true);
    try {
      const result = await callImport("products", file, true);
      setPreview({ open: true, kind: "products", result, fileName: file.name, file, confirming: false });
    } catch (err: any) {
      toast.error(err?.detail ?? t("shopImport.productsFailed", "Product import failed"));
    } finally {
      setImportingProducts(false);
    }
  };

  const startStockPreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportingStock(true);
    try {
      const result = await callImport("stock", file, true);
      setPreview({ open: true, kind: "stock", result, fileName: file.name, file, confirming: false });
    } catch (err: any) {
      toast.error(err?.detail ?? t("shopImport.stockFailed", "Stock import failed"));
    } finally {
      setImportingStock(false);
    }
  };

  const confirmImport = async () => {
    if (!preview || !preview.file) return;
    setPreview({ ...preview, confirming: true });
    try {
      const result = await callImport(preview.kind, preview.file, false);
      if (preview.kind === "products") {
        const msg = t("shopImport.successMsg", {
          created: result.created ?? 0,
          updated: result.updated ?? 0,
          defaultValue: "Import complete: created {{created}}, updated {{updated}}",
        });
        if (result.errors.length > 0) {
          toast.warning(`${msg} — ${t("shopImport.errorsHeader", { count: result.errors.length, defaultValue: "{{count}} error(s)" })}`);
        } else {
          toast.success(msg);
        }
      } else {
        const msg = t("shopImport.stockSuccessMsg", {
          count: result.imported ?? 0,
          defaultValue: "Stock received: {{count}} item(s)",
        });
        if (result.errors.length > 0) {
          toast.warning(`${msg} — ${t("shopImport.errorsHeader", { count: result.errors.length, defaultValue: "{{count}} error(s)" })}`);
        } else {
          toast.success(msg);
        }
      }
      setPreview(null);
    } catch (err: any) {
      toast.error(err?.detail ?? t("shopImport.commitFailed", "Import failed"));
      setPreview((prev) => (prev ? { ...prev, confirming: false } : prev));
    }
  };

  const downloadTemplate = async () => {
    const token = localStorage.getItem("access_token");
    try {
      const qs = shopId ? `?shop_id=${encodeURIComponent(shopId)}` : "";
      const res = await fetch(`${API_BASE_URL}/admin/import/template${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "import_template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("shopImport.templateFailed", "Could not download template"));
    }
  };

  return (
    <>
      {showStockReceive && (
        <InfoCallout
          id="shopImport.twoSheetsExplainer"
          title={t("shopImport.twoSheetsTitle", "Why does the template have 2 sheets?")}
        >
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <Trans
                i18nKey="shopImport.explainerProducts"
                defaults="<b>Products</b> — product master data (name, price, category, UoM). Idempotent — re-importing updates names/prices without affecting stock."
                components={{ b: <strong /> }}
              />
            </li>
            <li>
              <Trans
                i18nKey="shopImport.explainerStock"
                defaults="<b>StockReceive</b> — logs <u>each</u> receiving event (quantity + cost per unit). Not idempotent — re-importing the same file will double-count stock. Use only when goods physically arrive."
                components={{ b: <strong />, u: <u /> }}
              />
            </li>
          </ul>
          <p className="mt-2">
            {t(
              "shopImport.explainerNote",
              "One template covers both — fill in whichever sheet applies and pick the matching import option from the dropdown.",
            )}
          </p>
        </InfoCallout>
      )}

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Upload className="h-4 w-4" />
              <span>{t("shopImport.title", "Import data (.xlsx / .csv)")}</span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={downloadTemplate}
              title={t("shopImport.downloadTemplate", "Download import template (Products + Stock sheets)")}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t("shopImport.template", "Download template")}
            </Button>

            <div className="h-5 w-px bg-border" />

            {showStockReceive ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={importingProducts || importingStock}>
                    {importingProducts || importingStock ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        {t("shopImport.checking", "Checking…")}
                      </>
                    ) : (
                      <>
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        {t("shopImport.importData", "Import data")}
                        <ChevronDown className="h-3.5 w-3.5 ml-1.5 opacity-70" />
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => productsFileRef.current?.click()}>
                    {t("shopImport.menuProducts", "Import products (sheet: Products)")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => stockFileRef.current?.click()}>
                    {t("shopImport.menuStock", "Import stock receipt (sheet: StockReceive)")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={importingProducts}
                onClick={() => productsFileRef.current?.click()}
              >
                {importingProducts ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    {t("shopImport.checking", "Checking…")}
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    {t("shopImport.importMenu", "Import menu items")}
                  </>
                )}
              </Button>
            )}

            <input
              ref={productsFileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={startProductsPreview}
              disabled={importingProducts}
            />
            <input
              ref={stockFileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={startStockPreview}
              disabled={importingStock}
            />

            <span className="text-xs text-muted-foreground ml-auto">
              {t("shopImport.productColumns", "Product columns")}: <code className="bg-muted px-1 rounded text-[11px]">name, barcode, price, cost_price, category, uom, shop_id</code>
              {showStockReceive && (
                <>
                  {" · "}
                  {t("shopImport.stockColumns", "Stock receive columns")}: <code className="bg-muted px-1 rounded text-[11px]">shop_id, barcode, quantity, cost_per_unit, notes</code>
                </>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={preview?.open ?? false} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent
          className="max-w-2xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {preview?.kind === "products"
                ? t("shopImport.previewProductsTitle", "Preview products import")
                : t("shopImport.previewStockTitle", "Preview stock receipt")}
            </DialogTitle>
          </DialogHeader>
          {preview?.result && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {t("shopImport.previewFile", "File")}: <span className="font-mono">{preview.fileName}</span>
              </p>
              <div className="grid grid-cols-3 gap-3">
                {preview.kind === "products" ? (
                  <>
                    <div className="rounded-md border border-green-200 bg-green-50 p-3">
                      <div className="text-xs text-green-700">{t("shopImport.statCreated", "Would create")}</div>
                      <div className="text-2xl font-bold text-green-800 tabular-nums">{preview.result.created ?? 0}</div>
                    </div>
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                      <div className="text-xs text-blue-700">{t("shopImport.statUpdated", "Would update")}</div>
                      <div className="text-2xl font-bold text-blue-800 tabular-nums">{preview.result.updated ?? 0}</div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 col-span-2">
                    <div className="text-xs text-green-700">{t("shopImport.statImported", "Would receive")}</div>
                    <div className="text-2xl font-bold text-green-800 tabular-nums">{preview.result.imported ?? 0}</div>
                  </div>
                )}
                <div className={`rounded-md border p-3 ${preview.result.errors.length > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className={`text-xs ${preview.result.errors.length > 0 ? "text-red-700" : "text-slate-600"}`}>
                    {t("shopImport.statErrors", "Errors")}
                  </div>
                  <div className={`text-2xl font-bold tabular-nums ${preview.result.errors.length > 0 ? "text-red-800" : "text-slate-700"}`}>
                    {preview.result.errors.length}
                  </div>
                </div>
              </div>

              {preview.result.errors.length > 0 ? (
                <div className="max-h-64 overflow-y-auto rounded border border-red-200 bg-red-50/40 p-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 mb-2">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {t("shopImport.errorsHeader", { count: preview.result.errors.length, defaultValue: "{{count}} error(s)" })}
                  </div>
                  <ul className="space-y-1 text-xs">
                    {preview.result.errors.slice(0, 50).map((e, i) => (
                      <li key={i} className="text-red-700">
                        <span className="font-mono mr-1.5">Row {e.row}:</span>{e.reason}
                      </li>
                    ))}
                    {preview.result.errors.length > 50 && (
                      <li className="text-red-600 italic">
                        {t("shopImport.errorsTruncated", { rest: preview.result.errors.length - 50, defaultValue: "… and {{rest}} more" })}
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("shopImport.noErrors", "No errors detected — safe to import.")}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                {t("shopImport.previewNote", "This is a preview — no data has been saved yet.")}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={preview?.confirming}>
              {t("shopImport.cancel", "Cancel")}
            </Button>
            <Button
              onClick={confirmImport}
              disabled={preview?.confirming}
            >
              {preview?.confirming
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("shopImport.importing", "Importing…")}</>
                : t("shopImport.confirmImport", "Confirm import")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
