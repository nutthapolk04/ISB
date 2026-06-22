import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { api, ApiError } from "@/lib/api";

export interface ShopCategory {
  id: number;
  shop_id: string;
  name: string;
}

interface ShopProduct {
  id: number;
  category: string | null;
  is_active: boolean;
}

interface Props {
  shopId: string;
}

export default function CanteenCategories({ shopId }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: products = [] } = useQuery({
    queryKey: ["canteen-products", shopId],
    queryFn: () => api.get<ShopProduct[]>(`/shops/${shopId}/products?include_inactive=true`),
  });

  const itemCounts: Record<string, number> = {};
  for (const p of products) {
    if (p.category) itemCounts[p.category] = (itemCounts[p.category] ?? 0) + 1;
  }

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["shop-categories", shopId],
    queryFn: () => api.get<ShopCategory[]>(`/shops/${shopId}/categories`),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ShopCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShopCategory | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shop-categories", shopId] });
    qc.invalidateQueries({ queryKey: ["canteen-products", shopId] });
  };

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/shops/${shopId}/categories/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success(t("canteen.categoryDeleted"));
      setDeleteTarget(null);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.categoryDeleteFailed"));
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => setAddOpen(true)} className="bg-amber-500 hover:bg-amber-600">
          <Plus className="mr-1 h-4 w-4" />
          {t("canteen.addCategory")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("canteen.colCategoryName")}</TableHead>
                <TableHead className="text-right">{t("canteen.colItemsUsing")}</TableHead>
                <TableHead className="text-right">{t("canteen.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    {t("canteen.categoriesLoading")}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    {t("canteen.categoryEmpty")}
                  </TableCell>
                </TableRow>
              )}
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {itemCounts[c.name] ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditTarget(c)}
                      aria-label={t("canteen.editCategory")}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(c)}
                      aria-label={t("canteen.deleteCategory")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CategoryFormDialog
        shopId={shopId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={invalidate}
        existingNames={categories.map((c) => c.name)}
      />
      <CategoryFormDialog
        shopId={shopId}
        target={editTarget}
        onOpenChange={(v) => !v && setEditTarget(null)}
        onSaved={invalidate}
        existingNames={categories.map((c) => c.name)}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("canteen.deleteCategoryTitle", { name: deleteTarget?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("canteen.deleteCategoryDesc", {
                count: deleteTarget ? (itemCounts[deleteTarget.name] ?? 0) : 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormDialogProps {
  shopId: string;
  open?: boolean;
  target?: ShopCategory | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  existingNames?: string[];
}

function CategoryFormDialog({
  shopId,
  open: controlledOpen,
  target,
  onOpenChange,
  onSaved,
  existingNames = [],
}: FormDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const isEdit = !!target;
  const open = isEdit ? !!target : !!controlledOpen;

  useEffect(() => {
    if (target) setName(target.name);
    else if (!controlledOpen) setName("");
  }, [target, controlledOpen]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("canteen.nameRequired"));
      return;
    }
    const isDuplicate = existingNames.some(
      (n) => n.toLowerCase() === trimmed.toLowerCase() && n !== target?.name,
    );
    if (isDuplicate) {
      toast.error(t("canteen.categoryDuplicate", `"${trimmed}" already exists`));
      return;
    }
    setSaving(true);
    try {
      if (isEdit && target) {
        await api.patch(`/shops/${shopId}/categories/${target.id}`, { name: trimmed });
        toast.success(t("canteen.categoryUpdated"));
      } else {
        await api.post(`/shops/${shopId}/categories`, { name: trimmed });
        toast.success(t("canteen.categoryAdded"));
      }
      onSaved();
      onOpenChange(false);
      setName("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.categorySaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setName("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("canteen.editCategory") : t("canteen.addCategory")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t("canteen.categoryName")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("canteen.categoryNamePlaceholder")}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600"
          >
            {saving ? t("canteen.saving") : t("canteen.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
