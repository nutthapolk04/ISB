import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import Inventory from "./Inventory";
import Bundles from "./Bundles";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, ChevronLeft, Package, Users, Loader2, History, ArrowUpRight, Layers, Tag, Upload, Download, ChevronDown, CheckCircle2, AlertCircle } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { PricePanelManager } from "@/components/PricePanelManager";

// Shape of both import endpoints' response (combined union for the dialog).
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

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopApiResponse {
  id: string;
  name: string;
  shop_type: "avg_cost" | "fifo";
  description: string | null;
  is_active: boolean;
}

interface AuditLogEntry {
  id: number;
  entity_type: string;
  entity_id: number | null;
  entity_name: string | null;
  action: string;
  changes: Record<string, unknown> | null;
  created_at: string;
  user_username: string | null;
  user_full_name: string | null;
}


// ── Component ─────────────────────────────────────────────────────────────────

const ShopDetail = () => {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const { t } = useTranslation();

  // Manager access control — can only view their own shop
  if (hasRole("manager") && user?.shopId && user.shopId !== shopId) {
    return <Navigate to={`/store/management/${user.shopId}`} replace />;
  }

  // ── Shop data from API ──────────────────────────────────────────────────
  const [shopData, setShopData] = useState<ShopApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchShop = useCallback(async () => {
    if (!shopId) return;
    try {
      const data = await api.get<ShopApiResponse>(`/shops/${shopId}`);
      setShopData(data);
    } catch {
      toast.error("Failed to load shop data");
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => { fetchShop(); }, [fetchShop]);

  // ── Shop info edit state ────────────────────────────────────────────────
  const [shopInfoDraft, setShopInfoDraft] = useState({ name: "", description: "", isActive: "active" as "active" | "inactive" });

  useEffect(() => {
    if (shopData) {
      setShopInfoDraft({
        name: shopData.name,
        description: shopData.description ?? "",
        isActive: shopData.is_active ? "active" : "inactive",
      });
    }
  }, [shopData]);

  const [saving, setSaving] = useState(false);

  // ── Bulk import state ───────────────────────────────────────────────────
  const [importingProducts, setImportingProducts] = useState(false);
  const [importingStock, setImportingStock] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // Hidden file inputs triggered from the unified Import menu — kept off-DOM
  // visible so the trigger button stays clean.
  const productsFileRef = useRef<HTMLInputElement>(null);
  const stockFileRef = useRef<HTMLInputElement>(null);

  // Run the upload against the backend; dry_run=true on first pass so the
  // user sees a preview before any data is committed.
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
        const msg = t("shopImport.successMsg", { created: result.created ?? 0, updated: result.updated ?? 0, defaultValue: "Import complete: created {{created}}, updated {{updated}}" });
        if (result.errors.length > 0) {
          toast.warning(`${msg} — ${t("shopImport.errorsHeader", { count: result.errors.length, defaultValue: "{{count}} error(s)" })}`);
        } else {
          toast.success(msg);
        }
      } else {
        const msg = t("shopImport.stockSuccessMsg", { count: result.imported ?? 0, defaultValue: "Stock received: {{count}} item(s)" });
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

  // Trigger an authenticated download of the combined template xlsx; fetch
  // + blob so we can include the Bearer token (browser <a> downloads cannot
  // set headers).
  const downloadTemplate = async () => {
    const token = localStorage.getItem("access_token");
    try {
      const res = await fetch(`${API_BASE_URL}/admin/import/template`, {
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

  // ── Audit log state ─────────────────────────────────────────────────────
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchAuditLogs = useCallback(async () => {
    if (!shopId) return;
    setAuditLoading(true);
    try {
      const data = await api.get<AuditLogEntry[]>(`/shops/${shopId}/audit-logs`);
      setAuditLogs(data);
    } catch {
      /* silently ignore — table may not exist yet in older deploys */
    } finally {
      setAuditLoading(false);
    }
  }, [shopId]);


  const handleSaveShopInfo = async () => {
    if (!shopId) return;
    try {
      setSaving(true);
      await api.patch(`/shops/${shopId}`, {
        name: shopInfoDraft.name.trim(),
        description: shopInfoDraft.description.trim() || null,
        is_active: shopInfoDraft.isActive === "active",
      });
      toast.success(t("management.shopUpdated"));
      await fetchShop();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to update shop");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const shopName = shopData?.name ?? shopId ?? "";
  const shopType = shopData?.shop_type ?? "avg_cost";

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="page-shell">
      {/* Header */}
      <div className="page-header flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {hasRole("admin") && (
            <IconButton
              tooltip={t("shop.tooltip.back")}
              onClick={() => navigate("/store/management")}
            >
              <ChevronLeft className="h-5 w-5" />
            </IconButton>
          )}
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="page-title">{shopName}</h1>
              <p className="page-description">{shopData?.description ?? t("management.description")}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/users?shop=${shopId}`}>
              <Users className="h-4 w-4 mr-1.5" />
              {t("shopUsers.manageStaffLink")}
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
          <Badge variant={shopData?.is_active ? "success" : "secondary"}>
            {shopData?.is_active ? t("management.statusActive") : t("management.statusInactive")}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="info" className="gap-2">
            <Building2 className="h-4 w-4" />
            {t("management.tabInfo")}
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-2">
            <Package className="h-4 w-4" />
            {t("management.tabInventory")}
          </TabsTrigger>
          <TabsTrigger value="pricePanels" className="gap-2">
            <Tag className="h-4 w-4" />
            Price Panels
          </TabsTrigger>
          <TabsTrigger value="bundles" className="gap-2">
            <Layers className="h-4 w-4" />
            {t("management.tabBundles") || "Bundles"}
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2" onClick={fetchAuditLogs}>
            <History className="h-4 w-4" />
            {t("auditLog.title")}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: Shop Info ─────────────────────────────────────────────── */}
        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-4 max-w-md">
              <div>
                <Label>{t("management.shopId", "Shop ID")}</Label>
                <div className="mt-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                  {shopId}
                </div>
              </div>
              <div>
                <Label>{t("management.shopName")} *</Label>
                <Input
                  value={shopInfoDraft.name}
                  onChange={(e) => setShopInfoDraft({ ...shopInfoDraft, name: e.target.value })}
                  placeholder={t("management.shopNamePlaceholder")}
                />
              </div>
              <div>
                <Label>{t("management.shopDescription")}</Label>
                <Input
                  value={shopInfoDraft.description}
                  onChange={(e) => setShopInfoDraft({ ...shopInfoDraft, description: e.target.value })}
                  placeholder={t("management.shopDescPlaceholder")}
                />
              </div>
              <div>
                <Label>{t("management.shopStatus")}</Label>
                <Select
                  value={shopInfoDraft.isActive}
                  onValueChange={(v) =>
                    setShopInfoDraft({ ...shopInfoDraft, isActive: v as "active" | "inactive" })
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("management.statusActive")}</SelectItem>
                    <SelectItem value="inactive">{t("management.statusInactive")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSaveShopInfo} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("management.saveShop")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Inventory ─────────────────────────────────────────────── */}
        <TabsContent value="inventory" className="space-y-4">
          {/* Bulk import section — admin + manager */}
          {(hasRole("admin") || hasRole("manager")) && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    <span>{t("shopImport.title", "Import data (.xlsx / .csv)")}</span>
                  </div>

                  {/* Combined template (one workbook, two sheets) */}
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

                  {/* Unified import menu — pick a sheet then file picker opens. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={importingProducts || importingStock}>
                        {importingProducts || importingStock ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("shopImport.checking", "Checking…")}</>
                        ) : (
                          <><Upload className="h-3.5 w-3.5 mr-1.5" />{t("shopImport.importData", "Import data")}<ChevronDown className="h-3.5 w-3.5 ml-1.5 opacity-70" /></>
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

                  {/* Hidden file pickers triggered by the menu items above. */}
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
                    {" · "}
                    {t("shopImport.stockColumns", "Stock receive columns")}: <code className="bg-muted px-1 rounded text-[11px]">shop_id, barcode, quantity, cost_per_unit, notes</code>
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Preview dialog (dry-run results) ──────────────────────── */}
          <Dialog open={preview?.open ?? false} onOpenChange={(open) => { if (!open) setPreview(null); }}>
            <DialogContent className="max-w-2xl">
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

          <Inventory lockedShopId={shopId} shopType={shopType} />
        </TabsContent>

        {/* ── Tab: Price Panels ─────────────────────────────────────────── */}
        <TabsContent value="pricePanels" className="space-y-4">
          {shopId && <PricePanelManager shopId={shopId} autoLoad />}
        </TabsContent>

        {/* ── Tab: Bundles ──────────────────────────────────────────────── */}
        <TabsContent value="bundles">
          <Bundles lockedShopId={shopId} />
        </TabsContent>

        {/* ── Tab: Audit Log ────────────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              {auditLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("auditLog.date")}</TableHead>
                      <TableHead>{t("auditLog.user")}</TableHead>
                      <TableHead>{t("auditLog.action")}</TableHead>
                      <TableHead>{t("auditLog.product")}</TableHead>
                      <TableHead>{t("auditLog.detail")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          {t("auditLog.noLogs")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {log.created_at
                              ? new Date(log.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
                              : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.user_full_name || log.user_username || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={log.action === "DELETE_PRODUCT" ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              {log.action === "UPDATE_PRICE"
                                ? t("auditLog.actionUpdatePrice")
                                : log.action === "DELETE_PRODUCT"
                                ? t("auditLog.actionDeleteProduct")
                                : log.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{log.entity_name || "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {log.action === "UPDATE_PRICE" && log.changes ? (
                              <span>
                                {t("auditLog.oldPrice")}: ฿{(log.changes as {old: {external_price: number}}).old?.external_price ?? "-"}
                                {" → "}
                                {t("auditLog.newPrice")}: ฿{(log.changes as {new: {external_price: number}}).new?.external_price ?? "-"}
                              </span>
                            ) : log.action === "DELETE_PRODUCT" && log.changes ? (
                              <span>฿{(log.changes as {snapshot: {external_price: number}}).snapshot?.external_price ?? "-"} · stock {(log.changes as {snapshot: {stock: number}}).snapshot?.stock ?? 0}</span>
                            ) : "-"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  );
};

export default ShopDetail;
