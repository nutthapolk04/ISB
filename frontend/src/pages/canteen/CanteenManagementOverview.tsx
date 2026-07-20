import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  UtensilsCrossed, ChevronRight, Package, BarChart3,
  Loader2, Plus, Edit, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Checkbox } from "@/components/ui/checkbox";

interface SpendingGroupOption {
  id: number;
  code: string;
  name_en: string;
  name_th: string;
}

interface AssignableGroup {
  id: number;
  code: string;
  name_en: string;
  name_th: string;
  is_active: boolean;
  linked: boolean;
}

interface ShopApiResponse {
  id: string;
  name: string;
  shop_type: "avg_cost" | "fifo";
  description: string | null;
  is_active: boolean;
  module: string;
  shop_number: number | null;
}

interface ShopStats {
  total_products: number;
}

interface Shop {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  productCount: number;
  shopType: "avg_cost" | "fifo";
  shopNumber: number | null;
}

const emptyForm = {
  id: "",
  name: "",
  description: "",
  isActive: "active" as "active" | "inactive",
  shopType: "avg_cost" as "avg_cost" | "fifo",
  shopNumber: "" as string,
};

export default function CanteenManagementOverview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

  const [shops, setShops] = useState<Shop[]>([]);
  const [spendingGroups, setSpendingGroups] = useState<SpendingGroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);

  const [editTarget, setEditTarget] = useState<Shop | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const [deleteTarget, setDeleteTarget] = useState<Shop | null>(null);

  // Spending-group membership is many-to-many (shop_spending_groups) —
  // managed as its own multi-select, separate from the shop id/name form.
  const [addGroupIds, setAddGroupIds] = useState<Set<number>>(new Set());
  const [editGroupIds, setEditGroupIds] = useState<Set<number>>(new Set());
  const [initialEditGroupIds, setInitialEditGroupIds] = useState<Set<number>>(new Set());
  const [editGroupsLoading, setEditGroupsLoading] = useState(false);

  const fetchShops = useCallback(async () => {
    setLoading(true);
    try {
      const [data, groups] = await Promise.all([
        api.get<ShopApiResponse[]>("/shops/?active_only=false&module=canteen"),
        api.get<SpendingGroupOption[]>("/spending-groups/").catch(() => [] as SpendingGroupOption[]),
      ]);
      setSpendingGroups(groups);
      const mapped: Shop[] = await Promise.all(
        data
          .filter((s) => s.module === "canteen")
          .map(async (s) => {
            let stats: ShopStats = { total_products: 0 };
            try { stats = await api.get<ShopStats>(`/shops/${s.id}/stats`); } catch { /* ok */ }
            return {
              id: s.id,
              name: s.name,
              description: s.description ?? "",
              isActive: s.is_active,
              productCount: stats.total_products,
              shopType: s.shop_type,
              shopNumber: s.shop_number ?? null,
            };
          }),
      );
      // Manager sees only their own shop
      const filtered = hasRole("admin")
        ? mapped
        : user?.shopId
          ? mapped.filter((s) => s.id === user.shopId)
          : mapped;
      setShops(filtered);
    } catch {
      toast.error(t("management.fetchError", "Failed to load shops"));
    } finally {
      setLoading(false);
    }
  }, [hasRole, user?.shopId, t]);

  useEffect(() => { fetchShops(); }, [fetchShops]);

  // ── Add ────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!addForm.name.trim() || !addForm.id.trim()) {
      toast.error(t("management.fillAllRequired"));
      return;
    }
    const idTrimmed = addForm.id.trim();
    if (idTrimmed.length !== 5) {
      toast.error(t("management.shopIdMustBe5", "Shop ID must be exactly 5 characters"));
      return;
    }
    setSaving(true);
    try {
      const newId = addForm.id.trim().toLowerCase().replace(/\s+/g, "_");
      await api.post("/shops/", {
        id: newId,
        name: addForm.name.trim(),
        description: addForm.description.trim() || null,
        shop_type: addForm.shopType,
        module: "canteen",
        shop_number: addForm.shopNumber ? parseInt(addForm.shopNumber) : null,
      });
      if (addGroupIds.size > 0) {
        await api.patch(`/shops/${newId}/spending-groups`, {
          spending_group_ids: Array.from(addGroupIds),
        });
      }
      toast.success(t("management.shopAdded"));
      setAddOpen(false);
      setAddForm(emptyForm);
      setAddGroupIds(new Set());
      await fetchShops();
    } catch (err: any) {
      toast.error(err?.detail ?? t("management.addError", "Failed to add shop"));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit ───────────────────────────────────────────────────────────────

  const openEdit = (shop: Shop) => {
    setEditTarget(shop);
    setEditForm({
      id: shop.id,
      name: shop.name,
      description: shop.description,
      isActive: shop.isActive ? "active" : "inactive",
      shopType: shop.shopType,
      shopNumber: shop.shopNumber ? String(shop.shopNumber) : "",
    });
    setEditGroupIds(new Set());
    setInitialEditGroupIds(new Set());
    setEditGroupsLoading(true);
    api.get<AssignableGroup[]>(`/shops/${shop.id}/spending-groups`)
      .then((groups) => {
        const linked = new Set(groups.filter((g) => g.linked).map((g) => g.id));
        setEditGroupIds(linked);
        setInitialEditGroupIds(linked);
      })
      .catch(() => { /* leave empty — shop may predate this feature */ })
      .finally(() => setEditGroupsLoading(false));
  };

  const handleEdit = async () => {
    if (!editTarget || !editForm.name.trim()) {
      toast.error(t("management.fillAllRequired"));
      return;
    }
    const groupsChanged =
      editGroupIds.size !== initialEditGroupIds.size ||
      [...editGroupIds].some((id) => !initialEditGroupIds.has(id));
    setSaving(true);
    try {
      await api.patch(`/shops/${editTarget.id}`, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        is_active: editForm.isActive === "active",
        shop_number: editForm.shopNumber ? parseInt(editForm.shopNumber) : null,
      });
      if (groupsChanged) {
        await api.patch(`/shops/${editTarget.id}/spending-groups`, {
          spending_group_ids: Array.from(editGroupIds),
        });
        toast(t("spendingGroup.changeWarning"));
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

  // ── Delete ─────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const result = await api.delete<{ status: "deleted" | "deactivated"; receipts_preserved: number }>(
        `/shops/${deleteTarget.id}`,
      );
      if (result.status === "deactivated") {
        toast.success(t("management.shopDeactivated", { name: deleteTarget.name, count: result.receipts_preserved }));
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

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      <div className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">{t("canteenMgmt.title")}</h1>
          <p className="page-description">{t("canteenMgmt.description")}</p>
        </div>
        {hasRole("admin") && (
          <Button onClick={() => { setAddForm(emptyForm); setAddGroupIds(new Set()); setAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t("canteenMgmt.addStall", "+ Add Canteen Stall")}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t("common.loading")}</span>
        </div>
      ) : shops.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <UtensilsCrossed className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>{t("canteenMgmt.noStalls")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {shops.map((shop) => (
            <Card
              key={shop.id}
              className={`hover:shadow-md transition-shadow cursor-pointer ${!shop.isActive ? "opacity-60" : ""}`}
              onClick={() => navigate(`/canteen/management/${shop.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                      <UtensilsCrossed className="h-5 w-5" />
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

                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
                  <Package className="h-3.5 w-3.5" />
                  <span>{shop.productCount} {t("management.products", "products")}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/canteen/management/${shop.id}?tab=products`); }}
                    >
                      <Package className="h-3.5 w-3.5 mr-1" />
                      {t("canteenMgmt.menu")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); navigate("/canteen/reports"); }}
                    >
                      <BarChart3 className="h-3.5 w-3.5 mr-1" />
                      {t("canteenMgmt.reports")}
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    {hasRole("admin") && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => { e.stopPropagation(); openEdit(shop); }}
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
          ))}
        </div>
      )}

      {/* ── Add Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4" />
              {t("canteenMgmt.addStall", "Add Canteen Stall")}
            </DialogTitle>
            <DialogDescription>
              {t("management.addShopCanteenDesc", "Create a new canteen stall with its own menu and settings.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("management.shopId", "Shop ID")} *</Label>
              <Input
                value={addForm.id}
                maxLength={5}
                onChange={(e) => setAddForm({ ...addForm, id: e.target.value.slice(0, 5) })}
                placeholder="e.g. ct001"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("management.shopIdHint", "Exactly 5 characters — letters + digits, lowercase")}
              </p>
            </div>
            <div>
              <Label>{t("management.shopName", "Name")} *</Label>
              <Input
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                placeholder={t("management.shopNamePlaceholder", "e.g. Thai Kitchen")}
              />
            </div>
            <div>
              <Label>{t("management.shopDescription", "Description")}</Label>
              <Input
                value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                placeholder={t("management.shopDescPlaceholder", "Optional description")}
              />
            </div>
            <div>
              <Label>{t("spendingGroup.title", "Spending Group")}</Label>
              <p className="text-xs text-muted-foreground mb-1">
                {t("spendingGroup.multiHint", "A shop can belong to more than one group.")}
              </p>
              {spendingGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No spending groups yet</p>
              ) : (
                <div className="flex flex-col gap-1 rounded border bg-muted/30 p-2 max-h-40 overflow-y-auto">
                  <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-background cursor-pointer text-xs font-medium border-b border-border/60 mb-1 pb-1.5">
                    <Checkbox
                      checked={addGroupIds.size === spendingGroups.length}
                      onCheckedChange={() => {
                        setAddGroupIds(
                          addGroupIds.size === spendingGroups.length
                            ? new Set()
                            : new Set(spendingGroups.map((g) => g.id)),
                        );
                      }}
                    />
                    <span className="flex-1">{t("common.selectAll", "Select all")}</span>
                  </label>
                  {spendingGroups.map((g) => {
                    const checked = addGroupIds.has(g.id);
                    return (
                      <label
                        key={g.id}
                        className="flex items-center gap-2 px-1 py-1 rounded hover:bg-background cursor-pointer text-xs"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            setAddGroupIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.id)) next.delete(g.id);
                              else next.add(g.id);
                              return next;
                            });
                          }}
                        />
                        <span className="flex-1">{g.name_en} ({g.code})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("management.editShop", "Edit Shop")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("management.shopName", "Name")} *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("management.shopDescription", "Description")}</Label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("management.shopStatus", "Status")}</Label>
              <Select
                value={editForm.isActive}
                onValueChange={(v) => setEditForm({ ...editForm, isActive: v as "active" | "inactive" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("management.statusActive", "Active")}</SelectItem>
                  <SelectItem value="inactive">{t("management.statusInactive", "Inactive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("spendingGroup.title", "Spending Group")}</Label>
              <p className="text-xs text-muted-foreground mb-1">
                {t("spendingGroup.multiHint", "A shop can belong to more than one group.")}
              </p>
              {editGroupsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </div>
              ) : spendingGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No spending groups yet</p>
              ) : (
                <div className="flex flex-col gap-1 rounded border bg-muted/30 p-2 max-h-40 overflow-y-auto">
                  <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-background cursor-pointer text-xs font-medium border-b border-border/60 mb-1 pb-1.5">
                    <Checkbox
                      checked={editGroupIds.size === spendingGroups.length}
                      onCheckedChange={() => {
                        setEditGroupIds(
                          editGroupIds.size === spendingGroups.length
                            ? new Set()
                            : new Set(spendingGroups.map((g) => g.id)),
                        );
                      }}
                    />
                    <span className="flex-1">{t("common.selectAll", "Select all")}</span>
                  </label>
                  {spendingGroups.map((g) => {
                    const checked = editGroupIds.has(g.id);
                    return (
                      <label
                        key={g.id}
                        className="flex items-center gap-2 px-1 py-1 rounded hover:bg-background cursor-pointer text-xs"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            setEditGroupIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.id)) next.delete(g.id);
                              else next.add(g.id);
                              return next;
                            });
                          }}
                        />
                        <span className="flex-1">{g.name_en} ({g.code})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("management.saveShop", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("management.deleteDialogTitle", { name: deleteTarget?.name ?? "" })}
            </AlertDialogTitle>
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
              onClick={handleDelete}
              disabled={saving}
            >
              {saving ? t("management.deleting") : t("management.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
