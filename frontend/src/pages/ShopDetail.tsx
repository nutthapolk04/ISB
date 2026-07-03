import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import Inventory from "./Inventory";
import Bundles from "./Bundles";
import { fmtDateTime } from "@/lib/dateFormat";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Building2, ChevronLeft, Package, Users, Loader2, History, ArrowUpRight, Layers, Tag, Upload, Download, ChevronDown, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { PricePanelManager } from "@/components/PricePanelManager";

interface ProductPreviewRow {
  row: number;
  name: string;
  barcode: string | null;
  price: number;
  cost_price: number;
  category: string;
  action: "create" | "update" | "stock_only";
  quantity: number | null;
}

interface StoreImportResult {
  products: {
    created: number;
    updated: number;
    errors: { row: number; reason: string }[];
    preview?: ProductPreviewRow[];
  };
  stock: { imported: number; errors: { row: number; reason: string }[] };
}

type ImportPhase = "preview" | "importing" | "done";

interface PreviewState {
  open: boolean;
  phase: ImportPhase;
  result: StoreImportResult | null;
  doneResult: StoreImportResult | null;
  fileName: string;
  file: File | null;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopApiResponse {
  id: string;
  name: string;
  shop_type: "avg_cost" | "fifo";
  description: string | null;
  is_active: boolean;
  receipt_header: string | null;
  receipt_footer: string | null;
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
  const [shopInfoDraft, setShopInfoDraft] = useState({ name: "", description: "", isActive: "active" as "active" | "inactive", receiptHeader: "", receiptFooter: "" });

  useEffect(() => {
    if (shopData) {
      setShopInfoDraft({
        name: shopData.name,
        description: shopData.description ?? "",
        isActive: shopData.is_active ? "active" : "inactive",
        receiptHeader: shopData.receipt_header ?? "",
        receiptFooter: shopData.receipt_footer ?? "",
      });
    }
  }, [shopData]);

  const [saving, setSaving] = useState(false);

  // ── Bulk import state ───────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [inventoryKey, setInventoryKey] = useState(0);
  const storeFileRef = useRef<HTMLInputElement>(null);

  const startStorePreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !shopId) return;
    e.target.value = "";
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api.postFormData<StoreImportResult>(
        `/admin/import/store?shop_id=${encodeURIComponent(shopId)}&dry_run=true`,
        form,
      );
      setPreview({ open: true, phase: "preview", result, doneResult: null, fileName: file.name, file });
    } catch (err: any) {
      toast.error(err?.detail ?? t("shopImport.productsFailed", "Import failed"));
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    if (!preview?.file) return;
    setPreview({ ...preview, phase: "importing" });
    try {
      const form = new FormData();
      form.append("file", preview.file);
      const result = await api.postFormData<StoreImportResult>(
        `/admin/import/store?shop_id=${encodeURIComponent(shopId ?? "")}&dry_run=false`,
        form,
      );
      setPreview((prev) => prev ? { ...prev, phase: "done", doneResult: result } : prev);
      setInventoryKey((k) => k + 1);
    } catch (err: any) {
      toast.error(err?.detail ?? t("shopImport.commitFailed", "Import failed"));
      setPreview((prev) => (prev ? { ...prev, phase: "preview" } : prev));
    }
  };

  // Trigger an authenticated download of the combined template xlsx; fetch
  // + blob so we can include the Bearer token (browser <a> downloads cannot
  // set headers).
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
        receipt_header: shopInfoDraft.receiptHeader.trim() || null,
        receipt_footer: shopInfoDraft.receiptFooter.trim() || null,
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
            <Link to={`/users?tab=cardholders&kind=staff&shop=${shopId}`}>
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
            Tab
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
              <div>
                <Label>{t("management.receiptHeader", "Receipt Header")}</Label>
                <Textarea
                  value={shopInfoDraft.receiptHeader}
                  onChange={(e) => setShopInfoDraft({ ...shopInfoDraft, receiptHeader: e.target.value })}
                  placeholder={t("management.receiptHeaderPlaceholder", "e.g. Shop Building A, 2nd Floor")}
                  maxLength={200}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("management.receiptHeaderHint", "Shown below shop name on receipt")}</p>
              </div>
              <div>
                <Label>{t("management.receiptFooter", "Receipt Footer")}</Label>
                <Textarea
                  value={shopInfoDraft.receiptFooter}
                  onChange={(e) => setShopInfoDraft({ ...shopInfoDraft, receiptFooter: e.target.value })}
                  placeholder={t("management.receiptFooterPlaceholder", "e.g. Thank you for shopping with us!")}
                  maxLength={200}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("management.receiptFooterHint", "Overrides school footer. Leave blank to use school default.")}</p>
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
                    <span>{t("shopImport.title", "Import data (.xlsx)")}</span>
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

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={importing}
                    onClick={() => storeFileRef.current?.click()}
                  >
                    {importing ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("shopImport.checking", "Checking…")}</>
                    ) : (
                      <><Upload className="h-3.5 w-3.5 mr-1.5" />{t("shopImport.importData", "Import store file")}</>
                    )}
                  </Button>

                  <input
                    ref={storeFileRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={startStorePreview}
                    disabled={importing}
                  />

                  <span className="text-xs text-muted-foreground ml-auto">
                    {t("shopImport.hint", "One row per product — fill quantity to receive stock at the same time")}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Preview / Import dialog ────────────────────────────────── */}
          <Dialog
            open={preview?.open ?? false}
            onOpenChange={(open) => { if (!open && preview?.phase !== "importing") setPreview(null); }}
          >
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>
                  {preview?.phase === "done"
                    ? t("shopImport.doneTitle", "Import complete")
                    : t("shopImport.previewTitle", "Preview import")}
                </DialogTitle>
              </DialogHeader>

              {/* ── Phase: importing (spinner only) ── */}
              {preview?.phase === "importing" && (
                <div className="flex flex-col items-center justify-center gap-3 py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">{t("shopImport.importing", "Importing…")}</p>
                </div>
              )}

              {/* ── Phase: preview (dry-run stats) ── */}
              {preview?.phase === "preview" && preview.result && (
                <div className="space-y-4 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {t("shopImport.previewFile", "File")}: <span className="font-mono">{preview.fileName}</span>
                  </p>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">{t("shopImport.sectionProducts", "Products")}</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-md border border-green-200 bg-green-50 p-3">
                        <div className="text-xs text-green-700">{t("shopImport.statCreated", "Would create")}</div>
                        <div className="text-2xl font-bold text-green-800 tabular-nums">{preview.result.products.created}</div>
                      </div>
                      <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                        <div className="text-xs text-blue-700">{t("shopImport.statUpdated", "Would update")}</div>
                        <div className="text-2xl font-bold text-blue-800 tabular-nums">{preview.result.products.updated}</div>
                      </div>
                      <div className={`rounded-md border p-3 ${preview.result.products.errors.length > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                        <div className={`text-xs ${preview.result.products.errors.length > 0 ? "text-red-700" : "text-slate-600"}`}>{t("shopImport.statErrors", "Errors")}</div>
                        <div className={`text-2xl font-bold tabular-nums ${preview.result.products.errors.length > 0 ? "text-red-800" : "text-slate-700"}`}>{preview.result.products.errors.length}</div>
                      </div>
                    </div>
                  </div>
                  {preview.result.products.updated > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                      <span>{t("shopImport.warnUpdatedStock", { count: preview.result.products.updated, defaultValue: "{{count}} product(s) already exist — their name/price will be updated and any quantity in this file will be added on top of existing stock." })}</span>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">{t("shopImport.sectionStock", "Stock receive")}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-green-200 bg-green-50 p-3">
                        <div className="text-xs text-green-700">{t("shopImport.statImported", "Would receive")}</div>
                        <div className="text-2xl font-bold text-green-800 tabular-nums">{preview.result.stock.imported}</div>
                      </div>
                      <div className={`rounded-md border p-3 ${preview.result.stock.errors.length > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                        <div className={`text-xs ${preview.result.stock.errors.length > 0 ? "text-red-700" : "text-slate-600"}`}>{t("shopImport.statErrors", "Errors")}</div>
                        <div className={`text-2xl font-bold tabular-nums ${preview.result.stock.errors.length > 0 ? "text-red-800" : "text-slate-700"}`}>{preview.result.stock.errors.length}</div>
                      </div>
                    </div>
                  </div>
                  {preview.result.products.preview && preview.result.products.preview.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">{t("shopImport.previewRows", "Items to import")}</p>
                      <div className="max-h-56 overflow-y-auto rounded border text-xs">
                        <table className="w-full">
                          <thead className="sticky top-0 bg-muted/80">
                            <tr>
                              <th className="p-2 text-left font-medium">#</th>
                              <th className="p-2 text-left font-medium">{t("shopImport.colName", "Name")}</th>
                              <th className="p-2 text-left font-medium">{t("shopImport.colBarcode", "Barcode")}</th>
                              <th className="p-2 text-right font-medium">{t("shopImport.colPrice", "Price")}</th>
                              <th className="p-2 text-right font-medium">{t("shopImport.colQty", "Qty")}</th>
                              <th className="p-2 text-center font-medium">{t("shopImport.colAction", "Action")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.result.products.preview.map((r) => (
                              <tr key={r.row} className="border-t">
                                <td className="p-2 text-muted-foreground font-mono">{r.row}</td>
                                <td className="p-2 font-medium">{r.name}</td>
                                <td className="p-2 font-mono text-muted-foreground">{r.barcode || "—"}</td>
                                <td className="p-2 text-right tabular-nums">{r.action !== "stock_only" ? `฿${r.price}` : "—"}</td>
                                <td className="p-2 text-right tabular-nums">{r.quantity != null ? `+${r.quantity}` : "—"}</td>
                                <td className="p-2 text-center">
                                  {r.action === "create" ? (
                                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">Create</span>
                                  ) : r.action === "update" ? (
                                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">Update</span>
                                  ) : (
                                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">Stock+</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {(preview.result.products.errors.length > 0 || preview.result.stock.errors.length > 0) ? (
                    <div className="max-h-64 overflow-y-auto rounded border border-red-200 bg-red-50/40 p-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 mb-2">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {preview.result.products.errors.length + preview.result.stock.errors.length} error(s)
                      </div>
                      <ul className="space-y-1 text-xs">
                        {preview.result.products.errors.length > 0 && (
                          <li className="font-semibold text-red-700 mt-1">{t("shopImport.errorsProduct", "Product errors")}</li>
                        )}
                        {preview.result.products.errors.slice(0, 25).map((e, i) => (
                          <li key={`p${i}`} className="text-red-700"><span className="font-mono mr-1.5">Row {e.row}:</span>{e.reason}</li>
                        ))}
                        {preview.result.stock.errors.length > 0 && (
                          <li className="font-semibold text-red-700 mt-1">{t("shopImport.errorsStock", "Stock receive errors")}</li>
                        )}
                        {preview.result.stock.errors.slice(0, 25).map((e, i) => (
                          <li key={`s${i}`} className="text-red-700"><span className="font-mono mr-1.5">Row {e.row}:</span>{e.reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("shopImport.noErrors", "No errors detected — safe to import.")}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">{t("shopImport.previewNote", "This is a preview — no data has been saved yet.")}</p>
                </div>
              )}

              {/* ── Phase: done (actual import result) ── */}
              {preview?.phase === "done" && preview.doneResult && (
                <div className="space-y-4 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {t("shopImport.previewFile", "File")}: <span className="font-mono">{preview.fileName}</span>
                  </p>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">{t("shopImport.sectionProducts", "Products")}</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-md border border-green-200 bg-green-50 p-3">
                        <div className="text-xs text-green-700">{t("shopImport.statCreatedDone", "Created")}</div>
                        <div className="text-2xl font-bold text-green-800 tabular-nums">{preview.doneResult.products.created}</div>
                      </div>
                      <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                        <div className="text-xs text-blue-700">{t("shopImport.statUpdatedDone", "Updated")}</div>
                        <div className="text-2xl font-bold text-blue-800 tabular-nums">{preview.doneResult.products.updated}</div>
                      </div>
                      <div className={`rounded-md border p-3 ${preview.doneResult.products.errors.length > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                        <div className={`text-xs ${preview.doneResult.products.errors.length > 0 ? "text-red-700" : "text-slate-600"}`}>{t("shopImport.statErrors", "Errors")}</div>
                        <div className={`text-2xl font-bold tabular-nums ${preview.doneResult.products.errors.length > 0 ? "text-red-800" : "text-slate-700"}`}>{preview.doneResult.products.errors.length}</div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">{t("shopImport.sectionStock", "Stock receive")}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-green-200 bg-green-50 p-3">
                        <div className="text-xs text-green-700">{t("shopImport.statReceivedDone", "Received")}</div>
                        <div className="text-2xl font-bold text-green-800 tabular-nums">{preview.doneResult.stock.imported}</div>
                      </div>
                      <div className={`rounded-md border p-3 ${preview.doneResult.stock.errors.length > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                        <div className={`text-xs ${preview.doneResult.stock.errors.length > 0 ? "text-red-700" : "text-slate-600"}`}>{t("shopImport.statErrors", "Errors")}</div>
                        <div className={`text-2xl font-bold tabular-nums ${preview.doneResult.stock.errors.length > 0 ? "text-red-800" : "text-slate-700"}`}>{preview.doneResult.stock.errors.length}</div>
                      </div>
                    </div>
                  </div>
                  {(preview.doneResult.products.errors.length > 0 || preview.doneResult.stock.errors.length > 0) && (
                    <div className="max-h-48 overflow-y-auto rounded border border-red-200 bg-red-50/40 p-2">
                      <ul className="space-y-1 text-xs">
                        {preview.doneResult.products.errors.slice(0, 25).map((e, i) => (
                          <li key={`p${i}`} className="text-red-700"><span className="font-mono mr-1.5">Row {e.row}:</span>{e.reason}</li>
                        ))}
                        {preview.doneResult.stock.errors.slice(0, 25).map((e, i) => (
                          <li key={`s${i}`} className="text-red-700"><span className="font-mono mr-1.5">Row {e.row}:</span>{e.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                {preview?.phase === "preview" && (
                  <>
                    <Button variant="outline" onClick={() => setPreview(null)}>{t("shopImport.cancel", "Cancel")}</Button>
                    <Button onClick={confirmImport}>{t("shopImport.confirmImport", "Confirm import")}</Button>
                  </>
                )}
                {preview?.phase === "done" && (
                  <Button onClick={() => setPreview(null)}>{t("shopImport.done", "Done")}</Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Inventory lockedShopId={shopId} shopType={shopType} refreshKey={inventoryKey} />
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                          {t("auditLog.noLogs")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {log.created_at ? fmtDateTime(log.created_at) : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.user_full_name || log.user_username || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={log.action === "DELETE" ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{log.entity_name || "-"}</TableCell>
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
