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
import { Building2, ChevronLeft, Package, Users, Loader2, History, ArrowUpRight, Layers, Tag, Upload } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { PricePanelManager } from "@/components/PricePanelManager";

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

  const handleImportProducts = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !shopId) return;
    e.target.value = "";
    setImportingProducts(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api.postFormData<{ created: number; updated: number; errors: { row: number; reason: string }[] }>(
        `/admin/import/products?shop_id=${encodeURIComponent(shopId)}`,
        form,
      );
      const msg = t("shopImport.successMsg", { created: result.created, updated: result.updated, defaultValue: "Import complete: created {{created}}, updated {{updated}}" });
      if (result.errors.length > 0) {
        const errRows = result.errors.map(e => t("shopImport.errorRow", { row: e.row, reason: e.reason, defaultValue: "Row {{row}}: {{reason}}" })).join("; ");
        toast.warning(`${msg}\n${t("shopImport.errorsHeader", { count: result.errors.length, defaultValue: "{{count}} error(s)" })}: ${errRows}`);
      } else {
        toast.success(msg);
      }
    } catch (err: any) {
      toast.error(err?.detail ?? t("shopImport.productsFailed", "Product import failed"));
    } finally {
      setImportingProducts(false);
    }
  };

  const handleImportStock = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportingStock(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api.postFormData<{ imported: number; errors: { row: number; reason: string }[] }>(
        `/admin/import/stock-receive`,
        form,
      );
      const msg = t("shopImport.stockSuccessMsg", { count: result.imported, defaultValue: "Stock received: {{count}} item(s)" });
      if (result.errors.length > 0) {
        const errRows = result.errors.map(e => t("shopImport.errorRow", { row: e.row, reason: e.reason, defaultValue: "Row {{row}}: {{reason}}" })).join("; ");
        toast.warning(`${msg}\n${t("shopImport.errorsHeader", { count: result.errors.length, defaultValue: "{{count}} error(s)" })}: ${errRows}`);
      } else {
        toast.success(msg);
      }
    } catch (err: any) {
      toast.error(err?.detail ?? t("shopImport.stockFailed", "Stock import failed"));
    } finally {
      setImportingStock(false);
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
          {/* Bulk import section — admin only */}
          {hasRole("admin") && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    <span>{t("shopImport.title", "Import data (.xlsx / .csv)")}</span>
                  </div>

                  {/* Import products */}
                  <div className="relative">
                    <input
                      id="import-products-file"
                      type="file"
                      accept=".xlsx,.csv"
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      onChange={handleImportProducts}
                      disabled={importingProducts}
                    />
                    <Button variant="outline" size="sm" disabled={importingProducts} asChild={false}>
                      {importingProducts
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("shopImport.importing", "Importing…")}</>
                        : <>{t("shopImport.importProducts", "Import products (Excel)")}</>}
                    </Button>
                  </div>

                  {/* Import stock receive */}
                  <div className="relative">
                    <input
                      id="import-stock-file"
                      type="file"
                      accept=".xlsx,.csv"
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      onChange={handleImportStock}
                      disabled={importingStock}
                    />
                    <Button variant="outline" size="sm" disabled={importingStock} asChild={false}>
                      {importingStock
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("shopImport.importing", "Importing…")}</>
                        : <>{t("shopImport.importStock", "Import stock receipt (Excel)")}</>}
                    </Button>
                  </div>

                  <span className="text-xs text-muted-foreground ml-auto">
                    {t("shopImport.productColumns", "Product columns")}: <code className="bg-muted px-1 rounded text-[11px]">name, barcode, price, cost_price, category, uom, shop_id</code>
                    {" · "}
                    {t("shopImport.stockColumns", "Stock receive columns")}: <code className="bg-muted px-1 rounded text-[11px]">shop_id, barcode, quantity, cost_per_unit, notes</code>
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

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
