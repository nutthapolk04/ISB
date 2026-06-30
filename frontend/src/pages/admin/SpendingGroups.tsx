import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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
import { Plus, Pencil, Trash2, Layers, Building2, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface AssignableShop {
    id: string;
    name: string;
    module: string;
    is_active: boolean;
    linked: boolean;
}

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
    // Shop assignment state, merged into the Create/Edit dialog so the user
    // can pick group fields + linked shops in one place.
    const [editShops, setEditShops] = useState<AssignableShop[] | null>(null);
    const [editShopSelected, setEditShopSelected] = useState<Set<string>>(new Set());

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
        setEditShops(null);
        setEditShopSelected(new Set());
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
        setEditShops(null);
        setEditShopSelected(new Set());
        setModalOpen(true);
        // Fetch shops + pre-select currently linked ones
        api.get<AssignableShop[]>(`/spending-groups/${g.id}/shops`)
            .then((data) => {
                setEditShops(data);
                setEditShopSelected(new Set(data.filter((s) => s.linked).map((s) => s.id)));
            })
            .catch(() => setEditShops([]));
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
                // Save shop membership (only if the list was loaded — avoid
                // overwriting with an empty set when network was slow).
                if (editShops !== null) {
                    await api.patch(`/spending-groups/${editTarget.id}/shops`, {
                        shop_ids: Array.from(editShopSelected),
                    });
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
                const detail = (e.body as { detail?: { blocking_shops?: BlockingShop[] } } | undefined)?.detail;
                setBlockingShops(detail?.blocking_shops ?? []);
            } else {
                toast({ title: e instanceof ApiError ? e.detail : "Delete failed", variant: "destructive" });
                setDeleteTarget(null);
            }
        }
    };

    return (
        <div className="page-shell">
            {/* Page header */}
            <div className="page-header flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Layers className="h-7 w-7 text-primary" />
                    <div>
                        <h1 className="page-title">{t("spendingGroup.title")}</h1>
                        <p className="page-description">{t("spendingGroup.subtitle")}</p>
                    </div>
                </div>
                <Button onClick={openCreate} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    {t("spendingGroup.create")}
                </Button>
            </div>

            {/* Content */}
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            Loading…
                        </div>
                    ) : groups.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                            <Layers className="h-8 w-8 opacity-30" />
                            <p className="text-sm">No spending groups yet.</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("spendingGroup.code")}</TableHead>
                                    <TableHead>{t("spendingGroup.nameEn")}</TableHead>
                                    <TableHead>{t("spendingGroup.nameTh")}</TableHead>
                                    <TableHead>{t("spendingGroup.dailyLimit")}</TableHead>
                                    <TableHead>{t("spendingGroup.linkedShops")}</TableHead>
                                    <TableHead>{t("spendingGroup.enforce")}</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {groups.map((g) => (
                                    <TableRow key={g.id}>
                                        <TableCell className="font-mono text-xs">{g.code}</TableCell>
                                        <TableCell>{g.name_en}</TableCell>
                                        <TableCell>{g.name_th}</TableCell>
                                        <TableCell className="font-medium">{formatTHB(g.daily_limit)}</TableCell>
                                        <TableCell>
                                            <button
                                                onClick={() => setAssignTarget(g)}
                                                className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded px-2 py-0.5 hover:bg-primary/20"
                                                title={t("spendingGroup.manageShops")}
                                            >
                                                <Building2 className="h-3 w-3" />
                                                {g.linked_shop_count}
                                            </button>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    checked={g.is_active}
                                                    onCheckedChange={(v) => void handleEnforceToggle(g, v)}
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                    {g.is_active ? t("spendingGroup.enforce") : t("spendingGroup.dontEnforce")}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 justify-end">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)}>
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                                    onClick={() => confirmDelete(g)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Create / Edit modal */}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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

                        {/* Shop assignment — only on edit (need a group id to PATCH against) */}
                        {editTarget && (
                            <div className="space-y-2 pt-3 border-t">
                                <Label className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4" />
                                    {t("spendingGroup.linkedShops", { defaultValue: "Linked Shops" })}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {t("spendingGroup.linkedShopsHint", {
                                        defaultValue: "Tick the shops that belong to this group. Daily limit applies across all ticked shops.",
                                    })}
                                </p>
                                <div className="max-h-56 overflow-y-auto rounded border bg-muted/30 p-2 space-y-2">
                                    {editShops === null ? (
                                        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                                            <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                            Loading shops…
                                        </div>
                                    ) : editShops.length === 0 ? (
                                        <p className="text-xs text-muted-foreground py-2 text-center">No shops</p>
                                    ) : (
                                        Object.entries(
                                            editShops.reduce<Record<string, AssignableShop[]>>((acc, s) => {
                                                (acc[s.module] ??= []).push(s);
                                                return acc;
                                            }, {}),
                                        ).map(([module, list]) => (
                                            <div key={module} className="space-y-0.5">
                                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                                                    {module}
                                                </p>
                                                {list.map((s) => (
                                                    <label
                                                        key={s.id}
                                                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-background cursor-pointer text-xs"
                                                    >
                                                        <Checkbox
                                                            checked={editShopSelected.has(s.id)}
                                                            onCheckedChange={() => {
                                                                setEditShopSelected((prev) => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(s.id)) next.delete(s.id);
                                                                    else next.add(s.id);
                                                                    return next;
                                                                });
                                                            }}
                                                        />
                                                        <span className={`flex-1 ${s.is_active ? "" : "text-muted-foreground line-through"}`}>
                                                            {s.name}
                                                        </span>
                                                        <span className="font-mono text-[10px] text-muted-foreground">{s.id}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
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

