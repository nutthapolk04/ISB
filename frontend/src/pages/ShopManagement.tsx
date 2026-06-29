import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast as sonnerToast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Plus, Edit, Trash2, Package, Loader2, Store as StoreIcon, ChevronRight, BarChart3 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

type ShopModule = "canteen" | "store";

interface SpendingGroupOption {
  id: number;
  code: string;
  name_en: string;
  name_th: string;
}

interface ShopApiResponse {
  id: string;
  name: string;
  shop_type: "avg_cost" | "fifo";
  description: string | null;
  is_active: boolean;
  created_at: string;
  module: ShopModule;
  allow_department_charge: boolean;
  spending_group_id: number | null;
  shop_number: number | null;
}

interface ShopStats {
  total_products: number;
  low_stock_count: number;
  total_value: number;
}

interface Shop {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  productCount: number;
  shopType: "avg_cost" | "fifo";
  module: ShopModule;
  allowDepartmentCharge: boolean;
  spendingGroupId: number | null;
  shopNumber: number | null;
}

const emptyShopForm = {
  id: "",
  name: "",
  description: "",
  isActive: "active" as "active" | "inactive",
  shopType: "fifo" as "avg_cost" | "fifo",
  module: "store" as ShopModule,
  allowDepartmentCharge: true,
  spendingGroupId: "" as string,
  shopNumber: "" as string,
};

// ── Component ─────────────────────────────────────────────────────────────────

const ShopManagement = () => {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const activeRole = user?.activeRole ?? user?.role;

  // Manager → redirect immediately to their shop
  useEffect(() => {
    if (activeRole === "manager" && user?.shopId) {
      navigate(`/store/management/${user.shopId}`, { replace: true });
    }
  }, [activeRole, user, navigate]);

  const [shops, setShops] = useState<Shop[]>([]);
  const [spendingGroups, setSpendingGroups] = useState<SpendingGroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Shop | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shop | null>(null);
  const [shopForm, setShopForm] = useState(emptyShopForm);
  const [editForm, setEditForm] = useState(emptyShopForm);
  const [activeTab, setActiveTab] = useState<ShopModule>("store");

  // ── Fetch shops from API ────────────────────────────────────────────────

  const fetchShops = useCallback(async () => {
    try {
      setLoading(true);
      const [data, groups] = await Promise.all([
        api.get<ShopApiResponse[]>("/shops/?active_only=false"),
        api.get<SpendingGroupOption[]>("/spending-groups/").catch(() => [] as SpendingGroupOption[]),
      ]);
      setSpendingGroups(groups);
      const mapped: Shop[] = await Promise.all(
        data.map(async (s) => {
          let stats: ShopStats = { total_products: 0, low_stock_count: 0, total_value: 0 };
          try {
            stats = await api.get<ShopStats>(`/shops/${s.id}/stats`);
          } catch {
            /* stats unavailable */
          }
          return {
            id: s.id,
            name: s.name,
            description: s.description ?? "",
            isActive: s.is_active,
            productCount: stats.total_products,
            shopType: s.shop_type,
            module: s.module ?? "store",
            allowDepartmentCharge: s.allow_department_charge ?? false,
            spendingGroupId: s.spending_group_id ?? null,
            shopNumber: s.shop_number ?? null,
          };
        }),
      );
      setShops(mapped);
    } catch (err) {
      toast.error(t("management.fetchError", "Failed to load shops"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchShops();
  }, [fetchShops]);

  // ── Add shop ────────────────────────────────────────────────────────────

  const handleAddShop = async () => {
    if (!shopForm.name.trim() || !shopForm.id.trim()) {
      toast.error(t("management.fillAllRequired"));
      return;
    }
    try {
      setSaving(true);
      await api.post("/shops/", {
        id: shopForm.id.trim().toLowerCase().replace(/\s+/g, "_"),
        name: shopForm.name.trim(),
        description: shopForm.description.trim() || null,
        shop_type: shopForm.shopType,
        module: shopForm.module,
        allow_department_charge: shopForm.allowDepartmentCharge,
        spending_group_id: shopForm.spendingGroupId ? parseInt(shopForm.spendingGroupId) : null,
        shop_number: shopForm.shopNumber ? parseInt(shopForm.shopNumber) : null,
      });
      toast.success(t("management.shopAdded"));
      setIsAddOpen(false);
      setShopForm(emptyShopForm);
      await fetchShops();
    } catch (err: any) {
      toast.error(err?.detail ?? t("management.addError", "Failed to add shop"));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit shop ───────────────────────────────────────────────────────────

  const openEditShop = (shop: Shop) => {
    setEditTarget(shop);
    setEditForm({
      id: shop.id,
      name: shop.name,
      description: shop.description,
      isActive: shop.isActive ? "active" : "inactive",
      shopType: shop.shopType,
      module: shop.module,
      allowDepartmentCharge: shop.allowDepartmentCharge,
      spendingGroupId: shop.spendingGroupId ? String(shop.spendingGroupId) : "",
      shopNumber: shop.shopNumber ? String(shop.shopNumber) : "",
    });
  };

  const handleEditShop = async () => {
    if (!editTarget || !editForm.name.trim()) {
      toast.error(t("management.fillAllRequired"));
      return;
    }
    const newGroupId = editForm.spendingGroupId ? parseInt(editForm.spendingGroupId) : null;
    const groupChanged = newGroupId !== editTarget.spendingGroupId;
    try {
      setSaving(true);
      await api.patch(`/shops/${editTarget.id}`, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        is_active: editForm.isActive === "active",
        spending_group_id: newGroupId,
        shop_number: editForm.shopNumber ? parseInt(editForm.shopNumber) : null,
      });
      // Warn when spending group changes
      if (groupChanged && editTarget.spendingGroupId !== null) {
        sonnerToast(t("spendingGroup.changeWarning"), { duration: 6000 });
      }
      toast.success(t("management.shopUpdated"));
      setEditTarget(null);
      await fetchShops();
    } catch (err: any) {
      toast.error(err?.detail ?? t("management.updateError", "Failed to update shop"));
    } finally {
      setSaving(false);
    }
  };

  // ── Delete shop (hard if empty, soft if has receipts) ───────────────────

  const handleDeleteShop = async () => {
    if (!deleteTarget) return;
    try {
      setSaving(true);
      const result = await api.delete<{ status: "deleted" | "deactivated"; receipts_preserved: number }>(
        `/shops/${deleteTarget.id}`,
      );
      if (result.status === "deactivated") {
        toast.success(
          t("management.shopDeactivated", {
            name: deleteTarget.name,
            count: result.receipts_preserved,
          }),
        );
      } else {
        toast.success(t("management.shopDeletedDone", { name: deleteTarget.name }));
      }
      setDeleteTarget(null);
      await fetchShops();
    } catch (err: any) {
      toast.error(err?.detail ?? t("management.deleteError", "Failed to delete shop"));
    } finally {
      setSaving(false);
    }
  };

  // ── Add-shop helper (needed before early returns) ──────────────────────

  const openAddForTab = (module: ShopModule) => {
    setShopForm({
      ...emptyShopForm,
      module,
      allowDepartmentCharge: module === "store",
      shopType: module === "canteen" ? "avg_cost" : "fifo",
    });
    setIsAddOpen(true);
  };

  // ── Loading state ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────

  if (!shops.length) {
    return (
      <div className="page-shell">
        <div className="page-header flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="page-title">{t("management.storeTitle", "Store Management")}</h1>
            <p className="page-description">{t("management.storeDescription", "Manage Coop / Retail shops and inventory")}</p>
          </div>
          {hasRole("admin") && (
            <Button onClick={() => openAddForTab("store")}>
              <Plus className="h-4 w-4 mr-2" />
              {t("management.addShopStore", "+ Add Store")}
            </Button>
          )}
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <StoreIcon className="h-12 w-12 mb-4" />
          <p>{t("management.noShopsStore", "No stores found")}</p>
        </div>
        {renderAddDialog()}
      </div>
    );
  }

  // ── Render helpers ──────────────────────────────────────────────────────

  function renderAddDialog() {
    return (
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StoreIcon className="h-4 w-4" />
              {t("management.addShopStore", "+ Add Coop / Retail Shop")}
            </DialogTitle>
            <DialogDescription>
              {t("management.addShopStoreDesc", "Coop/retail shop — retail POS, supports department charge")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("management.shopId", "Shop ID")} *</Label>
              <Input
                value={shopForm.id}
                maxLength={5}
                onChange={(e) => setShopForm({ ...shopForm, id: e.target.value.slice(0, 5) })}
                placeholder="e.g. coop1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("management.shopIdHint", "Unique code, max 5 chars, lowercase")}
              </p>
            </div>
            <div>
              <Label>{t("management.shopName")} *</Label>
              <Input
                value={shopForm.name}
                onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })}
                placeholder={t("management.shopNamePlaceholder")}
              />
            </div>
            <div>
              <Label>{t("management.shopDescription")}</Label>
              <Input
                value={shopForm.description}
                onChange={(e) => setShopForm({ ...shopForm, description: e.target.value })}
                placeholder={t("management.shopDescPlaceholder")}
              />
            </div>
            <div>
              <Label>{t("management.shopType")} *</Label>
              <Select
                value={shopForm.shopType}
                onValueChange={(v) => setShopForm({ ...shopForm, shopType: v as "avg_cost" | "fifo" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="avg_cost">{t("management.shopTypeAvgCost")}</SelectItem>
                  <SelectItem value="fifo">{t("management.shopTypeFifo")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{t("management.shopTypeHint")}</p>
            </div>
            <div>
              <Label>{t("spendingGroup.title")}</Label>
              <Select
                value={shopForm.spendingGroupId || "__none__"}
                onValueChange={(v) => setShopForm({ ...shopForm, spendingGroupId: v === "__none__" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("spendingGroup.title")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {spendingGroups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name_en} ({g.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("management.shopNumber", "Shop Number")}</Label>
              <Input
                type="number"
                min={1}
                max={99999}
                placeholder="00001"
                value={shopForm.shopNumber}
                onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v.length > 5) (e.target as HTMLInputElement).value = v.slice(0, 5); }}
                onChange={(e) => setShopForm({ ...shopForm, shopNumber: e.target.value.slice(0, 5) })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("management.shopNumberHint", "5-digit code used in receipt numbers (e.g. 1 → R-S00001-...)")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleAddShop} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const canteenShops = shops.filter((s) => s.module === "canteen");
  const storeShops   = shops.filter((s) => s.module === "store");

  const renderShopCard = (shop: Shop) => (
    <Card
      key={shop.id}
      className={`hover:shadow-md transition-shadow cursor-pointer ${!shop.isActive ? "opacity-60" : ""}`}
      onClick={() => navigate(`/store/management/${shop.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
              <StoreIcon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{shop.name}</CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{shop.id}</p>
            </div>
          </div>
          <Badge variant={shop.isActive ? "default" : "secondary"} className="text-xs shrink-0">
            {shop.isActive ? t("common.active") : t("common.inactive")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {shop.description && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{shop.description}</p>
        )}
        <div className="flex items-center flex-wrap gap-1.5 text-sm text-muted-foreground mb-3">
          <Package className="h-3.5 w-3.5" />
          <span>{shop.productCount} {t("management.products", "products")}</span>
          <Badge
            className={`ml-1 text-xs ${shop.shopType === "fifo" ? "bg-violet-100 text-violet-800 hover:bg-violet-100" : "bg-slate-100 text-slate-700 hover:bg-slate-100"}`}
          >
            {shop.shopType === "fifo" ? t("management.shopTypeFifo", "FIFO") : t("management.shopTypeAvgCost", "Avg Cost")}
          </Badge>
          {shop.allowDepartmentCharge && (
            <Badge className="text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              {t("management.deptCharge", "Dept charge")}
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); navigate(`/store/management/${shop.id}`); }}
            >
              <Building2 className="h-3.5 w-3.5 mr-1" />
              {t("management.manageShop", "Manage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); navigate("/store/reports"); }}
            >
              <BarChart3 className="h-3.5 w-3.5 mr-1" />
              {t("canteenMgmt.reports", "Reports")}
            </Button>
          </div>
          <div className="flex items-center gap-1">
            {hasRole("admin") && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); openEditShop(shop); }}
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(shop); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">{t("management.storeTitle", "Store Management")}</h1>
          <p className="page-description">{t("management.storeDescription", "Manage Coop / Retail shops and inventory")}</p>
        </div>
        {hasRole("admin") && (
          <Button onClick={() => openAddForTab("store")}>
            <Plus className="h-4 w-4 mr-2" />
            {t("management.addShopStore", "+ Add Coop / Retail Shop")}
          </Button>
        )}
      </div>

      {storeShops.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <StoreIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>{t("management.noShopsStore", "No stores found")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {storeShops.map(renderShopCard)}
        </div>
      )}

      {/* ── Add Shop Dialog ────────────────────────────────────────────────── */}
      {renderAddDialog()}

      {/* ── Edit Shop Dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("management.editShop")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("management.shopName")} *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("management.shopDescription")}</Label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("management.shopStatus")}</Label>
              <Select
                value={editForm.isActive}
                onValueChange={(v) => setEditForm({ ...editForm, isActive: v as "active" | "inactive" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("management.statusActive")}</SelectItem>
                  <SelectItem value="inactive">{t("management.statusInactive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("spendingGroup.title")}</Label>
              <Select
                value={editForm.spendingGroupId || "__none__"}
                onValueChange={(v) => setEditForm({ ...editForm, spendingGroupId: v === "__none__" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("spendingGroup.title")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {spendingGroups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name_en} ({g.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("management.shopNumber", "Shop Number")}</Label>
              <Input
                type="number"
                min={1}
                max={99999}
                placeholder="00001"
                value={editForm.shopNumber}
                onChange={(e) => setEditForm({ ...editForm, shopNumber: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("management.shopNumberHint", "5-digit code used in receipt numbers (e.g. 1 → R-S00001-...)")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleEditShop} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("management.saveShop")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("management.deleteDialogTitle", { name: deleteTarget?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("management.deleteDialogDescPermanent")}
              <br />
              {t("management.deleteDialogDescDeactivate")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteShop}
              disabled={saving}
            >
              {saving ? t("management.deleting") : t("management.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ShopManagement;
