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
import { Building2, ChevronLeft, Package, Users, Loader2, History, ArrowUpRight, Layers, Tag, Pencil, Trash2, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { toast } from "sonner";
import { api } from "@/lib/api";

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

interface PricePanel {
  id: number;
  shop_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
}

interface PricePanelItem {
  product_id: number;
  product_code: string;
  product_name: string;
  external_price: number;
  panel_price: number | null;
}

const PANEL_COLORS = [
  { value: "blue", label: "Blue", class: "bg-blue-500" },
  { value: "green", label: "Green", class: "bg-green-500" },
  { value: "orange", label: "Orange", class: "bg-orange-500" },
  { value: "red", label: "Red", class: "bg-red-500" },
  { value: "purple", label: "Purple", class: "bg-purple-500" },
  { value: "gray", label: "Gray", class: "bg-gray-500" },
];

const panelColorBadgeClass: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 border-blue-300",
  green: "bg-green-100 text-green-700 border-green-300",
  orange: "bg-orange-100 text-orange-700 border-orange-300",
  red: "bg-red-100 text-red-700 border-red-300",
  purple: "bg-purple-100 text-purple-700 border-purple-300",
  gray: "bg-gray-100 text-gray-700 border-gray-300",
};

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
      const msg = `นำเข้าสำเร็จ: สร้าง ${result.created} รายการ, อัปเดต ${result.updated} รายการ`;
      if (result.errors.length > 0) {
        toast.warning(`${msg}\nข้อผิดพลาด ${result.errors.length} แถว: ${result.errors.map(e => `แถว ${e.row}: ${e.reason}`).join("; ")}`);
      } else {
        toast.success(msg);
      }
    } catch (err: any) {
      toast.error(err?.detail ?? "นำเข้าสินค้าไม่สำเร็จ");
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
      const msg = `รับสินค้าเข้าสต็อกสำเร็จ ${result.imported} รายการ`;
      if (result.errors.length > 0) {
        toast.warning(`${msg}\nข้อผิดพลาด ${result.errors.length} แถว: ${result.errors.map(e => `แถว ${e.row}: ${e.reason}`).join("; ")}`);
      } else {
        toast.success(msg);
      }
    } catch (err: any) {
      toast.error(err?.detail ?? "นำเข้ารับสินค้าไม่สำเร็จ");
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

  // ── Price Panels state ──────────────────────────────────────────────────
  const [panels, setPanels] = useState<PricePanel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [expandedPanelId, setExpandedPanelId] = useState<number | null>(null);
  const [panelItems, setPanelItems] = useState<Record<number, PricePanelItem[]>>({});
  const [panelItemsLoading, setPanelItemsLoading] = useState<Record<number, boolean>>({});
  const [newPanelDialogOpen, setNewPanelDialogOpen] = useState(false);
  const [newPanelName, setNewPanelName] = useState("");
  const [newPanelColor, setNewPanelColor] = useState<string>("");
  const [newPanelSaving, setNewPanelSaving] = useState(false);
  const [editPanelDialogOpen, setEditPanelDialogOpen] = useState(false);
  const [editPanelTarget, setEditPanelTarget] = useState<PricePanel | null>(null);
  const [editPanelName, setEditPanelName] = useState("");
  const [editPanelColor, setEditPanelColor] = useState("");
  const [editPanelSaving, setEditPanelSaving] = useState(false);
  // Track cell edit values: panelId -> productId -> string value
  const [cellDrafts, setCellDrafts] = useState<Record<number, Record<number, string>>>({});

  const fetchPanels = useCallback(async () => {
    if (!shopId) return;
    setPanelsLoading(true);
    try {
      const data = await api.get<PricePanel[]>(`/shops/${shopId}/price-panels`);
      setPanels(data);
    } catch {
      toast.error("Failed to load price panels");
    } finally {
      setPanelsLoading(false);
    }
  }, [shopId]);

  const fetchPanelItems = useCallback(async (panelId: number) => {
    if (!shopId) return;
    setPanelItemsLoading((prev) => ({ ...prev, [panelId]: true }));
    try {
      const data = await api.get<PricePanelItem[]>(`/shops/${shopId}/price-panels/${panelId}/items`);
      setPanelItems((prev) => ({ ...prev, [panelId]: data }));
      // Initialize cell drafts
      const drafts: Record<number, string> = {};
      data.forEach((item) => {
        drafts[item.product_id] = item.panel_price != null ? String(item.panel_price) : "";
      });
      setCellDrafts((prev) => ({ ...prev, [panelId]: drafts }));
    } catch {
      toast.error("Failed to load panel items");
    } finally {
      setPanelItemsLoading((prev) => ({ ...prev, [panelId]: false }));
    }
  }, [shopId]);

  const handleTogglePanel = (panelId: number) => {
    if (expandedPanelId === panelId) {
      setExpandedPanelId(null);
    } else {
      setExpandedPanelId(panelId);
      if (!panelItems[panelId]) {
        fetchPanelItems(panelId);
      }
    }
  };

  const handleCreatePanel = async () => {
    if (!shopId || !newPanelName.trim()) return;
    setNewPanelSaving(true);
    try {
      await api.post(`/shops/${shopId}/price-panels`, {
        name: newPanelName.trim(),
        color: newPanelColor || null,
      });
      toast.success("Price panel created");
      setNewPanelDialogOpen(false);
      setNewPanelName("");
      setNewPanelColor("");
      await fetchPanels();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to create panel");
    } finally {
      setNewPanelSaving(false);
    }
  };

  const handleEditPanel = async () => {
    if (!shopId || !editPanelTarget) return;
    setEditPanelSaving(true);
    try {
      await api.patch(`/shops/${shopId}/price-panels/${editPanelTarget.id}`, {
        name: editPanelName.trim() || undefined,
        color: editPanelColor || undefined,
      });
      toast.success("Panel updated");
      setEditPanelDialogOpen(false);
      setEditPanelTarget(null);
      await fetchPanels();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to update panel");
    } finally {
      setEditPanelSaving(false);
    }
  };

  const handleDeletePanel = async (panel: PricePanel) => {
    if (!shopId) return;
    if (!window.confirm(`Delete panel "${panel.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/shops/${shopId}/price-panels/${panel.id}`);
      toast.success("Panel deleted");
      if (expandedPanelId === panel.id) setExpandedPanelId(null);
      await fetchPanels();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to delete panel");
    }
  };

  const handleCellBlur = async (panelId: number, productId: number) => {
    if (!shopId) return;
    const rawValue = cellDrafts[panelId]?.[productId] ?? "";
    const trimmed = rawValue.trim();
    const price = trimmed === "" ? null : parseFloat(trimmed);
    if (trimmed !== "" && (isNaN(price!) || price! < 0)) return;
    try {
      await api.patch(`/shops/${shopId}/price-panels/${panelId}/items/${productId}`, { price });
      // Update local state
      setPanelItems((prev) => ({
        ...prev,
        [panelId]: (prev[panelId] ?? []).map((item) =>
          item.product_id === productId ? { ...item, panel_price: price } : item,
        ),
      }));
    } catch {
      toast.error("Failed to save price");
    }
  };

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
          <TabsTrigger value="pricePanels" className="gap-2" onClick={fetchPanels}>
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
                    <span>นำเข้าข้อมูล (.xlsx / .csv)</span>
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
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />กำลังนำเข้า...</>
                        : <>นำเข้าสินค้า (Excel)</>}
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
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />กำลังนำเข้า...</>
                        : <>นำเข้ารับสินค้า (Excel)</>}
                    </Button>
                  </div>

                  <span className="text-xs text-muted-foreground ml-auto">
                    คอลัมน์สินค้า: <code className="bg-muted px-1 rounded text-[11px]">name, barcode, price, cost_price, category, uom, shop_id</code>
                    {" · "}
                    คอลัมน์รับสินค้า: <code className="bg-muted px-1 rounded text-[11px]">shop_id, barcode, quantity, cost_per_unit, notes</code>
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <Inventory lockedShopId={shopId} shopType={shopType} />
        </TabsContent>

        {/* ── Tab: Price Panels ─────────────────────────────────────────── */}
        <TabsContent value="pricePanels" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Named price tiers for this shop. Each panel overrides prices per product.
            </p>
            <Button size="sm" onClick={() => setNewPanelDialogOpen(true)}>
              + New Panel
            </Button>
          </div>

          {panelsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : panels.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No price panels yet. Click "New Panel" to create one.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {panels.map((panel) => (
                <Card key={panel.id}>
                  <CardContent className="p-0">
                    {/* Panel header row */}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleTogglePanel(panel.id)}
                          className="flex items-center gap-2 font-semibold text-sm hover:text-primary transition-colors"
                        >
                          {expandedPanelId === panel.id
                            ? <ChevronUp className="h-4 w-4" />
                            : <ChevronDown className="h-4 w-4" />}
                          {panel.name}
                        </button>
                        {panel.color && (
                          <Badge
                            variant="outline"
                            className={`text-xs ${panelColorBadgeClass[panel.color] ?? ""}`}
                          >
                            {panel.color}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => {
                            setEditPanelTarget(panel);
                            setEditPanelName(panel.name);
                            setEditPanelColor(panel.color ?? "");
                            setEditPanelDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:text-destructive"
                          onClick={() => handleDeletePanel(panel)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Expanded items table */}
                    {expandedPanelId === panel.id && (
                      <div className="border-t">
                        {panelItemsLoading[panel.id] ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : (panelItems[panel.id] ?? []).length === 0 ? (
                          <p className="text-center text-sm text-muted-foreground py-6">
                            No products in this shop.
                          </p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-28">Code</TableHead>
                                <TableHead>Product</TableHead>
                                <TableHead className="w-32 text-right">Ext. Price</TableHead>
                                <TableHead className="w-36 text-right">Panel Price</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(panelItems[panel.id] ?? []).map((item) => {
                                const draftVal = cellDrafts[panel.id]?.[item.product_id] ?? "";
                                const panelFloat = item.panel_price;
                                const differs = panelFloat != null && panelFloat !== item.external_price;
                                return (
                                  <TableRow key={item.product_id}>
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                      {item.product_code}
                                    </TableCell>
                                    <TableCell className="text-sm font-medium">
                                      {item.product_name}
                                    </TableCell>
                                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                                      ฿{item.external_price.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="—"
                                        value={draftVal}
                                        onChange={(e) =>
                                          setCellDrafts((prev) => ({
                                            ...prev,
                                            [panel.id]: {
                                              ...(prev[panel.id] ?? {}),
                                              [item.product_id]: e.target.value,
                                            },
                                          }))
                                        }
                                        onBlur={() => handleCellBlur(panel.id, item.product_id)}
                                        className={`h-7 w-28 text-right text-xs ml-auto ${differs ? "border-yellow-400 bg-yellow-50" : ""}`}
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* New Panel Dialog */}
          <Dialog open={newPanelDialogOpen} onOpenChange={setNewPanelDialogOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>New Price Panel</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Panel Name *</Label>
                  <Input
                    value={newPanelName}
                    onChange={(e) => setNewPanelName(e.target.value)}
                    placeholder="e.g. ราคาทั่วไป"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Color (optional)</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setNewPanelColor("")}
                      className={`rounded-full border-2 px-3 py-1 text-xs transition ${newPanelColor === "" ? "border-foreground font-semibold" : "border-transparent bg-muted"}`}
                    >
                      None
                    </button>
                    {PANEL_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setNewPanelColor(c.value)}
                        className={`rounded-full border-2 px-3 py-1 text-xs text-white transition ${c.class} ${newPanelColor === c.value ? "border-foreground scale-105" : "border-transparent opacity-80 hover:opacity-100"}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewPanelDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreatePanel} disabled={newPanelSaving || !newPanelName.trim()}>
                  {newPanelSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Edit Panel Dialog */}
          <Dialog open={editPanelDialogOpen} onOpenChange={setEditPanelDialogOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Edit Panel</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Panel Name</Label>
                  <Input
                    value={editPanelName}
                    onChange={(e) => setEditPanelName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Color</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setEditPanelColor("")}
                      className={`rounded-full border-2 px-3 py-1 text-xs transition ${editPanelColor === "" ? "border-foreground font-semibold" : "border-transparent bg-muted"}`}
                    >
                      None
                    </button>
                    {PANEL_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setEditPanelColor(c.value)}
                        className={`rounded-full border-2 px-3 py-1 text-xs text-white transition ${c.class} ${editPanelColor === c.value ? "border-foreground scale-105" : "border-transparent opacity-80 hover:opacity-100"}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditPanelDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleEditPanel} disabled={editPanelSaving}>
                  {editPanelSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
