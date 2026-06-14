import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Pencil, Trash2, Store, Building2, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface SpendingGroup {
  id: number;
  code: string;
  name_en: string;
  name_th: string;
  daily_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  linked_shop_count: number;
}

interface BlockingShop {
  id: string;
  name: string;
}

interface FormState {
  code: string;
  name_en: string;
  name_th: string;
  daily_limit: string;
  is_active: boolean;
}

const emptyForm = (): FormState => ({
  code: "",
  name_en: "",
  name_th: "",
  daily_limit: "",
  is_active: true,
});

const formatTHB = (n: number) =>
  "฿" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function SpendingGroups() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<SpendingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SpendingGroup | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SpendingGroup | null>(null);
  const [blockingShops, setBlockingShops] = useState<BlockingShop[] | null>(null);
  const [assignTarget, setAssignTarget] = useState<SpendingGroup | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<SpendingGroup[]>("/spending-groups/");
      setGroups(data);
    } catch {
      toast({ title: "Failed to load spending groups", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditTarget(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (g: SpendingGroup) => {
    setEditTarget(g);
    setForm({
      code: g.code,
      name_en: g.name_en,
      name_th: g.name_th,
      daily_limit: String(g.daily_limit),
      is_active: g.is_active,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const limitNum = parseFloat(form.daily_limit);
    if (!form.code || !form.name_en || !form.name_th || isNaN(limitNum) || limitNum <= 0) {
      toast({ title: "Please fill in all required fields with valid values", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editTarget) {
        await api.patch(`/spending-groups/${editTarget.id}`, {
          name_en: form.name_en,
          name_th: form.name_th,
          daily_limit: limitNum,
          is_active: form.is_active,
        });
        if (!editTarget.is_active && form.is_active) {
          // No toast needed for activation toggle
        }
        toast({ title: t("spendingGroup.edit") + " saved" });
      } else {
        await api.post("/spending-groups/", {
          code: form.code,
          name_en: form.name_en,
          name_th: form.name_th,
          daily_limit: limitNum,
          is_active: form.is_active,
        });
        toast({ title: t("spendingGroup.create") + " saved" });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast({ title: t("spendingGroup.duplicateCode"), variant: "destructive" });
      } else {
        toast({ title: e instanceof ApiError ? e.detail : "Save failed", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEnforceToggle = async (g: SpendingGroup, checked: boolean) => {
    try {
      await api.patch(`/spending-groups/${g.id}`, { is_active: checked });
      await load();
    } catch {
      toast({ title: "Failed to update enforcement", variant: "destructive" });
    }
  };

  const confirmDelete = (g: SpendingGroup) => {
    setBlockingShops(null);
    setDeleteTarget(g);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/spending-groups/${deleteTarget.id}`);
      toast({ title: t("spendingGroup.delete") + " complete" });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { blocking_shops?: BlockingShop[]; message?: string } | undefined;
        setBlockingShops(body?.blocking_shops ?? []);
      } else {
        toast({ title: e instanceof ApiError ? e.detail : "Delete failed", variant: "destructive" });
        setDeleteTarget(null);
      }
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back link */}
      <div className="flex items-center gap-2">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Admin
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Store className="h-5 w-5" />
                {t("spendingGroup.title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{t("spendingGroup.subtitle")}</p>
            </div>
            <Button onClick={openCreate} className="gap-1">
              <Plus className="h-4 w-4" />
              {t("spendingGroup.create")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">No spending groups yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">{t("spendingGroup.code")}</th>
                    <th className="pb-2 pr-4">{t("spendingGroup.nameEn")}</th>
                    <th className="pb-2 pr-4">{t("spendingGroup.nameTh")}</th>
                    <th className="pb-2 pr-4">{t("spendingGroup.dailyLimit")}</th>
                    <th className="pb-2 pr-4">{t("spendingGroup.linkedShops")}</th>
                    <th className="pb-2 pr-4">{t("spendingGroup.enforce")}</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-b hover:bg-muted/30">
                      <td className="py-3 pr-4 font-mono text-xs">{g.code}</td>
                      <td className="py-3 pr-4">{g.name_en}</td>
                      <td className="py-3 pr-4">{g.name_th}</td>
                      <td className="py-3 pr-4 font-medium">{formatTHB(g.daily_limit)}</td>
                      <td className="py-3 pr-4">
                        <button
                          onClick={() => setAssignTarget(g)}
                          className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded px-2 py-0.5 hover:bg-primary/20 cursor-pointer"
                          title={t("spendingGroup.manageShops")}
                        >
                          <Building2 className="h-3 w-3" />
                          {g.linked_shop_count}
                        </button>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={g.is_active}
                            onCheckedChange={(v) => void handleEnforceToggle(g, v)}
                          />
                          <span className="text-xs text-muted-foreground">
                            {g.is_active ? t("spendingGroup.enforce") : t("spendingGroup.dontEnforce")}
                          </span>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(g)} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => confirmDelete(g)}
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? t("spendingGroup.edit") : t("spendingGroup.create")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{t("spendingGroup.code")}</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="e.g. canteen"
                disabled={!!editTarget}
              />
              {!editTarget && (
                <p className="text-xs text-muted-foreground">{t("spendingGroup.codeHint")}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>{t("spendingGroup.nameEn")}</Label>
              <Input
                value={form.name_en}
                onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
                placeholder="Canteen"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("spendingGroup.nameTh")}</Label>
              <Input
                value={form.name_th}
                onChange={(e) => setForm((f) => ({ ...f, name_th: e.target.value }))}
                placeholder="โรงอาหาร"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("spendingGroup.dailyLimit")}</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={form.daily_limit}
                onChange={(e) => setForm((f) => ({ ...f, daily_limit: e.target.value }))}
                placeholder="500"
              />
              <p className="text-xs text-muted-foreground">{t("spendingGroup.dailyLimitHint")}</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label>
                {form.is_active ? t("spendingGroup.enforce") : t("spendingGroup.dontEnforce")}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setBlockingShops(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("spendingGroup.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {blockingShops ? (
                <span>
                  {t("spendingGroup.deleteBlockedByShops", { count: blockingShops.length })}
                  <ul className="mt-2 space-y-1">
                    {blockingShops.map((s) => (
                      <li key={s.id} className="text-destructive font-medium">{s.name} ({s.id})</li>
                    ))}
                  </ul>
                </span>
              ) : (
                t("spendingGroup.deleteConfirm")
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteTarget(null); setBlockingShops(null); }}>
              Cancel
            </AlertDialogCancel>
            {!blockingShops && (
              <AlertDialogAction
                onClick={() => void handleDelete()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AssignShopsModal
        group={assignTarget}
        onClose={() => setAssignTarget(null)}
        onSaved={() => { setAssignTarget(null); void load(); }}
      />
    </div>
  );
}

interface AssignableShop {
  id: string;
  name: string;
  module: string;
  is_active: boolean;
  linked: boolean;
}

function AssignShopsModal({
  group,
  onClose,
  onSaved,
}: {
  group: SpendingGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [shops, setShops] = useState<AssignableShop[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!group) { setShops(null); return; }
    setShops(null);
    api.get<AssignableShop[]>(`/spending-groups/${group.id}/shops`)
      .then((data) => {
        setShops(data);
        setSelected(new Set(data.filter((s) => s.linked).map((s) => s.id)));
      })
      .catch(() => {
        toast({ title: "Failed to load shops", variant: "destructive" });
        onClose();
      });
  }, [group?.id]);

  const toggle = (shopId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId); else next.add(shopId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!group) return;
    setSaving(true);
    try {
      const result = await api.patch<{ linked: number; unlinked: number }>(
        `/spending-groups/${group.id}/shops`,
        { shop_ids: Array.from(selected) },
      );
      toast({
        title: t("spendingGroup.shopsSaved", { defaultValue: "Shops updated" }),
        description: `+${result.linked} / −${result.unlinked}`,
      });
      onSaved();
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const byModule: Record<string, AssignableShop[]> = {};
  for (const s of shops ?? []) {
    (byModule[s.module] ??= []).push(s);
  }

  return (
    <Dialog open={!!group} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("spendingGroup.manageShopsFor", { defaultValue: "Manage shops" })} — {group?.name_en}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
          {shops === null ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading…
            </div>
          ) : shops.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No shops found.
            </p>
          ) : (
            Object.entries(byModule).map(([module, list]) => (
              <div key={module} className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {module}
                </p>
                {list.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(s.id)}
                      onCheckedChange={() => toggle(s.id)}
                    />
                    <span className={`flex-1 text-sm ${s.is_active ? "" : "text-muted-foreground line-through"}`}>
                      {s.name}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">{s.id}</span>
                  </label>
                ))}
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || shops === null}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("common.save", { defaultValue: "Save" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

