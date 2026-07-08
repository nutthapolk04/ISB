import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconButton } from "@/components/IconButton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Edit, Plus, Trash2 } from "lucide-react";
import type { Category } from "./inventoryTypes";

interface CategoryManagerProps {
  shopId: string;
  categories: Category[];
  onChanged: () => void;
}

export function CategoryManager({ shopId, categories, onChanged }: CategoryManagerProps) {
  const { t } = useTranslation();
  const [isAddCatOpen, setIsAddCatOpen] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState("");

  const handleAddCategory = async () => {
    if (!catForm.trim()) { toast.error(t("inventory.fillCategoryName")); return; }
    const trimmed = catForm.trim();
    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(t("inventory.categoryDuplicate", `"${trimmed}" already exists`));
      return;
    }
    try {
      await api.post(`/shops/${shopId}/categories`, { name: trimmed });
      toast.success(t("inventory.categoryAdded"));
      setIsAddCatOpen(false);
      setCatForm("");
      onChanged();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to add category");
    }
  };

  const handleEditCategory = async () => {
    if (!editCat || !catForm.trim()) { toast.error(t("inventory.fillCategoryName")); return; }
    const trimmed = catForm.trim();
    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase() && c.id !== editCat.id)) {
      toast.error(t("inventory.categoryDuplicate", `"${trimmed}" already exists`));
      return;
    }
    try {
      await api.patch(`/shops/${shopId}/categories/${editCat.id}`, { name: trimmed });
      toast.success(t("inventory.categoryUpdated"));
      setEditCat(null);
      setCatForm("");
      onChanged();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to update category");
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCat) return;
    try {
      await api.delete(`/shops/${shopId}/categories/${deleteCat.id}`);
      toast.success(t("inventory.categoryDeleted"));
      setDeleteCat(null);
      onChanged();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to delete category");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setCatForm(""); setIsAddCatOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          {t("inventory.addCategory")}
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("inventory.categoryName")}</TableHead>
                <TableHead className="text-center">{t("inventory.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                    {t("inventory.noCategories")}
                  </TableCell>
                </TableRow>
              ) : (
                categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <IconButton
                          tooltip={t("inventory.tooltip.editCategory")}
                          onClick={() => { setEditCat(cat); setCatForm(cat.name); }}
                        >
                          <Edit className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          tooltip={t("inventory.tooltip.deleteCategory")}
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteCat(cat)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Add Category Dialog ──────────────────────────────────────────────── */}
      <Dialog open={isAddCatOpen} onOpenChange={setIsAddCatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("inventory.addCategory")}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>{t("inventory.categoryName")} *</Label>
            <Input
              value={catForm}
              onChange={(e) => setCatForm(e.target.value)}
              placeholder={t("inventory.categoryNamePlaceholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddCatOpen(false)}>{t("inventory.cancel")}</Button>
            <Button onClick={handleAddCategory}>{t("inventory.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Category Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!editCat} onOpenChange={(open) => !open && setEditCat(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("inventory.editCategory")}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>{t("inventory.categoryName")} *</Label>
            <Input
              value={catForm}
              onChange={(e) => setCatForm(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCat(null)}>{t("inventory.cancel")}</Button>
            <Button onClick={handleEditCategory}>{t("inventory.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Category Confirm ───────────────────────────────────────────── */}
      <AlertDialog open={!!deleteCat} onOpenChange={(open) => !open && setDeleteCat(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inventory.deleteCategory")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("inventory.deleteCategoryDesc", { name: deleteCat?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("inventory.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteCategory}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
