import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Edit2, Trash2, Upload, X as XIcon, GripVertical } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api, ApiError } from "@/lib/api";
import { formatBahtAmount } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCanteenImage,
  getCanteenFallback,
  CANTEEN_CATEGORIES,
} from "./canteenImages";
import type { ShopCategory } from "./CanteenCategories";
import MenuOptionGroupEditor from "./MenuOptionGroupEditor";

interface ShopProduct {
  id: number;
  product_code: string;
  name: string;
  category: string;
  external_price: number;
  internal_price: number;
  is_active?: boolean;
  photo_url?: string | null;
  color?: string | null;
  has_options?: boolean;
  sort_order?: number;
}

const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5 MB

// Drag-handle row wrapper. Disabled when the table is filtered/searched
// (sort_order is global, so partial-list reordering would be ambiguous).
function SortableProductRow({
  id,
  disabled,
  children,
}: {
  id: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <TableRow ref={setNodeRef} style={style} {...attributes}>
      <TableCell className="w-10 px-1">
        {!disabled ? (
          <button
            type="button"
            {...listeners}
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <span className="inline-block h-6 w-6" aria-hidden />
        )}
      </TableCell>
      {children}
    </TableRow>
  );
}

async function uploadProductPhoto(
  shopId: string,
  productId: number,
  file: File,
): Promise<ShopProduct> {
  const form = new FormData();
  form.append("file", file);
  return api.postFormData<ShopProduct>(
    `/shops/${shopId}/products/${productId}/photo`,
    form,
  );
}

export default function CanteenProducts({ shopId: propShopId, embedded }: { shopId?: string; embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const shopId = propShopId ?? user?.shopId ?? "canteen";
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<ShopProduct | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["canteen-products", shopId],
    queryFn: () =>
      api.get<ShopProduct[]>(
        `/shops/${shopId}/products?include_inactive=true`,
      ),
  });

  const { data: remoteCategories = [] } = useQuery({
    queryKey: ["shop-categories", shopId],
    queryFn: () => api.get<ShopCategory[]>(`/shops/${shopId}/categories`),
  });

  // Per-shop pricing model (true = Retail / Internal, false = single price).
  // Falls back to `true` so the form keeps working before the backend rolls out.
  const { data: shopMeta } = useQuery({
    queryKey: ["shop-meta", shopId],
    queryFn: () =>
      api.get<{ uses_dual_pricing?: boolean; products_order_version?: number }>(
        `/shops/${shopId}`,
      ),
  });
  const usesDualPricing = shopMeta?.uses_dual_pricing ?? true;
  const orderVersion = shopMeta?.products_order_version ?? 1;

  // Local optimistic order — used while a drag is mid-flight so the row jumps
  // visually right away. Cleared on every successful reload.
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);

  // Drag-and-drop reorder mutation. On 409 we toast + force-reload so the
  // user sees the latest order. (Day 3 will replace this with a diff modal.)
  const reorderMut = useMutation({
    mutationFn: async (sortMap: Record<number, number>) =>
      api.post<{ version: number; updated: number }>(
        `/shops/${shopId}/products/reorder`,
        { version: orderVersion, sort_map: sortMap, source: "admin" },
      ),
    onSuccess: () => {
      toast.success(t("canteen.orderSaved", "บันทึกลำดับแล้ว"));
      setLocalOrder(null);
      qc.invalidateQueries({ queryKey: ["shop-meta", shopId] });
      qc.invalidateQueries({ queryKey: ["canteen-products", shopId] });
    },
    onError: (e) => {
      setLocalOrder(null);
      qc.invalidateQueries({ queryKey: ["shop-meta", shopId] });
      qc.invalidateQueries({ queryKey: ["canteen-products", shopId] });
      if (e instanceof ApiError && e.status === 409) {
        toast.warning(t("canteen.reorder.conflict"));
      } else {
        toast.error(
          e instanceof ApiError ? e.detail : t("canteen.orderSaveFailed", "บันทึกลำดับไม่สำเร็จ"),
        );
      }
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = (localOrder ?? products.map((p) => p.id)).slice();
    const oldIdx = ids.indexOf(Number(active.id));
    const newIdx = ids.indexOf(Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(ids, oldIdx, newIdx);
    setLocalOrder(next);
    const sortMap: Record<number, number> = {};
    next.forEach((id, idx) => {
      sortMap[id] = idx + 1;
    });
    reorderMut.mutate(sortMap);
  };

  const categoryNames: string[] =
    remoteCategories.length > 0
      ? remoteCategories.map((c) => c.name)
      : [...CANTEEN_CATEGORIES];

  // Apply optimistic local reorder before filtering so a drag is reflected
  // in the rendered list immediately even while the API call is in flight.
  const orderedProducts: ShopProduct[] = (() => {
    if (!localOrder) return products;
    const byId = new Map(products.map((p) => [p.id, p] as const));
    return localOrder.map((id) => byId.get(id)).filter((p): p is ShopProduct => Boolean(p));
  })();

  const filtered = orderedProducts.filter((p) => {
    if (categoryFilter !== "All" && p.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !p.name.toLowerCase().includes(q) &&
        !p.product_code.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  // Drag-and-drop is only active in the unfiltered, full-list view. When
  // filtering or searching, sort_order would be ambiguous so we hide the
  // handles and disable the listeners.
  const canReorder = categoryFilter === "All" && !search.trim();

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.patch(`/shops/${shopId}/products/${id}`, {
        is_active: isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canteen-products", shopId] });
      toast.success(t("canteen.availabilityUpdated"));
    },
    onError: (e) => {
      toast.error(
        e instanceof ApiError ? e.detail : t("canteen.updateFailed"),
      );
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      api.delete(`/shops/${shopId}/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canteen-products", shopId] });
      toast.success(t("canteen.itemRemoved"));
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.deleteFailed"));
    },
  });

  return (
    <div className={embedded ? "space-y-4" : "page-shell"}>
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        {!embedded && (
          <div>
            <h1 className="page-title">{t("canteen.menuTitle")}</h1>
            <p className="page-description">{t("canteen.menuDescription")}</p>
          </div>
        )}
        <Button
          onClick={() => setAddOpen(true)}
          className="bg-amber-500 hover:bg-amber-600"
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("canteen.addItem")}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
        <Input
          placeholder={t("canteen.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-sm"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">{t("canteen.allCategories")}</SelectItem>
            {categoryNames.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-1" aria-label="Reorder" />
                  <TableHead className="w-16"></TableHead>
                  <TableHead>{t("canteen.colProductCode", "Product Code")}</TableHead>
                  <TableHead>{t("canteen.colName")}</TableHead>
                  <TableHead>{t("canteen.colCategory")}</TableHead>
                  <TableHead className="text-right">
                    {usesDualPricing ? t("canteen.colRetail") : t("canteen.colPrice", "ราคา")}
                  </TableHead>
                  {usesDualPricing && (
                    <TableHead className="text-right">{t("canteen.colInternal")}</TableHead>
                  )}
                  <TableHead className="text-center">{t("canteen.colAvailable")}</TableHead>
                  <TableHead className="text-right">{t("canteen.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <SortableContext
                items={filtered.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={usesDualPricing ? 9 : 8}
                        className="py-6 text-center text-muted-foreground"
                      >
                        {t("canteen.loading")}
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={usesDualPricing ? 9 : 8}
                        className="py-6 text-center text-muted-foreground"
                      >
                        {t("canteen.noMenuItems")}
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((p) => {
                    const img = p.photo_url ?? getCanteenImage(p.product_code);
                    const fb = getCanteenFallback(p.category);
                    const FallbackIcon = fb.Icon;
                    const available = p.is_active ?? true;
                    return (
                      <SortableProductRow key={p.id} id={p.id} disabled={!canReorder}>
                        <TableCell>
                      <div
                        className={
                          "h-10 w-10 overflow-hidden rounded-lg bg-gradient-to-br " +
                          fb.gradient
                        }
                      >
                        {img ? (
                          <img
                            src={img}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-amber-900/70">
                            <FallbackIcon className="h-5 w-5" aria-hidden />
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.product_code}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ฿{formatBahtAmount(Number(p.external_price))}
                    </TableCell>
                    {usesDualPricing && (
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        ฿{formatBahtAmount(Number(p.internal_price))}
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <Switch
                        checked={available}
                        onCheckedChange={(checked) =>
                          toggleMut.mutate({ id: p.id, isActive: checked })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditTarget(p)}
                        aria-label="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("canteen.removeTitle", { name: p.name })}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("canteen.removeDescription")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMut.mutate(p.id)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              {t("common.delete")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                      </SortableProductRow>
                );
              })}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
        </CardContent>
      </Card>

      <EditDialog
        shopId={shopId}
        product={editTarget}
        categoryNames={categoryNames}
        usesDualPricing={usesDualPricing}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["canteen-products", shopId] });
          setEditTarget(null);
        }}
      />
      <AddDialog
        shopId={shopId}
        open={addOpen}
        categoryNames={categoryNames}
        usesDualPricing={usesDualPricing}
        onOpenChange={setAddOpen}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["canteen-products", shopId] });
          setAddOpen(false);
        }}
      />
    </div>
  );
}

// ── Add Dialog ──────────────────────────────────────────────────────────────

interface AddDialogProps {
  shopId: string;
  open: boolean;
  categoryNames: string[];
  usesDualPricing: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function AddDialog({ shopId, open, categoryNames, usesDualPricing, onOpenChange, onSaved }: AddDialogProps) {
  const { t } = useTranslation();
  const defaultCategory = categoryNames[0] ?? CANTEEN_CATEGORIES[0];
  const [form, setForm] = useState({
    product_code: "",
    name: "",
    category: defaultCategory,
    external_price: "",
    internal_price: "",
    color: "",
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setForm({
      product_code: "",
      name: "",
      category: defaultCategory,
      external_price: "",
      internal_price: "",
      color: "",
    });
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("canteen.invalidImageType"));
      e.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      toast.error(t("canteen.photoTooLarge"));
      e.target.value = "";
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    const retail = parseFloat(form.external_price);
    const internal = parseFloat(form.internal_price);
    if (!form.product_code.trim() || !form.name.trim() || isNaN(retail)) {
      toast.error(t("canteen.fillRequired"));
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<ShopProduct>(`/shops/${shopId}/products`, {
        product_code: form.product_code.trim(),
        name: form.name.trim(),
        category: form.category,
        external_price: retail,
        internal_price: isNaN(internal) ? retail : internal,
        vat_percent: 0,
        color: form.color || null,
      });
      if (photoFile) {
        try {
          await uploadProductPhoto(shopId, created.id, photoFile);
        } catch (e) {
          toast.error(e instanceof ApiError ? e.detail : t("canteen.uploadFailed"));
        }
      }
      toast.success(t("canteen.itemAdded"));
      reset();
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.addFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("canteen.addMenuTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t("canteen.productCode")}</Label>
            <Input
              value={form.product_code}
              onChange={(e) =>
                setForm({ ...form, product_code: e.target.value })
              }
              placeholder="CT-THAI-05"
            />
          </div>
          <div>
            <Label>{t("canteen.itemName")}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Tom Kha Gai"
            />
          </div>
          <div>
            <Label>{t("canteen.category")}</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm({ ...form, category: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryNames.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={usesDualPricing ? "grid grid-cols-2 gap-3" : ""}>
            <div>
              <Label>
                {usesDualPricing ? t("canteen.retailPrice") : t("canteen.colPrice", "ราคา")}
              </Label>
              <Input
                type="number"
                value={form.external_price}
                onChange={(e) =>
                  setForm({ ...form, external_price: e.target.value })
                }
              />
            </div>
            {usesDualPricing && (
              <div>
                <Label>{t("canteen.internalPrice")}</Label>
                <Input
                  type="number"
                  value={form.internal_price}
                  onChange={(e) =>
                    setForm({ ...form, internal_price: e.target.value })
                  }
                />
              </div>
            )}
          </div>
          <div>
            <Label>{t("canteen.photoLabel")}</Label>
            <div className="mt-1 flex items-center gap-3">
              {photoPreview ? (
                <div className="relative h-20 w-20 rounded-md overflow-hidden border">
                  <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 shadow"
                    aria-label={t("canteen.removePhoto")}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-20 w-20 rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:bg-muted"
                >
                  <Upload className="h-5 w-5" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickPhoto}
              />
              <div className="flex-1 text-xs text-muted-foreground">
                {t("canteen.photoHint")}
              </div>
            </div>
          </div>
          <div>
            <Label>{t("canteen.products.colorLabel")}</Label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={form.color || "#e2e8f0"}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border p-0.5"
              />
              <Input
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                placeholder="#e2e8f0"
                className="font-mono text-sm"
              />
              {form.color && (
                <Button variant="ghost" size="sm" type="button" onClick={() => setForm({ ...form, color: "" })}>
                  {t("canteen.products.colorClear")}
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("canteen.products.colorHint")}</p>
          </div>
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
            {saving ? t("canteen.saving") : t("canteen.addItem")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Dialog ─────────────────────────────────────────────────────────────

interface EditDialogProps {
  shopId: string;
  product: ShopProduct | null;
  categoryNames: string[];
  usesDualPricing: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function EditDialog({ shopId, product, categoryNames, usesDualPricing, onClose, onSaved }: EditDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(categoryNames[0] ?? CANTEEN_CATEGORIES[0]);
  const [retail, setRetail] = useState("");
  const [internal, setInternal] = useState("");
  const [color, setColor] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const open = !!product;

  useEffect(() => {
    if (product) {
      setName(product.name);
      setCategory(product.category);
      setRetail(String(product.external_price));
      setInternal(String(product.internal_price));
      setColor(product.color ?? "");
      setPhotoUrl(product.photo_url ?? null);
      setPendingPhoto(null);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
      setEditError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("canteen.invalidImageType"));
      e.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      toast.error(t("canteen.photoTooLarge"));
      e.target.value = "";
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPhoto(file);
    setPendingPreview(URL.createObjectURL(file));
  };

  const removePhoto = async () => {
    if (!product) return;
    setUploading(true);
    try {
      await api.patch(`/shops/${shopId}/products/${product.id}`, {
        photo_url: null,
      });
      setPhotoUrl(null);
      toast.success(t("canteen.removePhoto"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.updateFailed"));
    } finally {
      setUploading(false);
    }
  };

  const uploadPending = async () => {
    if (!product || !pendingPhoto) return;
    setUploading(true);
    try {
      const updated = await uploadProductPhoto(shopId, product.id, pendingPhoto);
      setPhotoUrl(updated.photo_url ?? null);
      setPendingPhoto(null);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success(t("canteen.uploadSuccess"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!product) return;
    const r = parseFloat(retail);
    const i = parseFloat(internal);
    if (!name.trim() || isNaN(r)) {
      setEditError(t("canteen.nameRetailRequired"));
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await api.patch(`/shops/${shopId}/products/${product.id}`, {
        name: name.trim(),
        category,
        external_price: r,
        internal_price: isNaN(i) ? r : i,
        color: color || null,
      });
      if (pendingPhoto) {
        try {
          await uploadProductPhoto(shopId, product.id, pendingPhoto);
        } catch (e) {
          toast.error(e instanceof ApiError ? e.detail : t("canteen.uploadFailed"));
        }
      }
      toast.success(t("canteen.itemUpdated"));
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : t("canteen.updateFailed");
      setEditError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setEditError(null); onClose(); } }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("canteen.editMenuTitle", { name: product?.name })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t("canteen.productCode")}</Label>
            <Input value={product?.product_code ?? ""} disabled />
          </div>
          <div>
            <Label>{t("canteen.itemName")}</Label>
            <Input value={name} onChange={(e) => { setName(e.target.value); setEditError(null); }} />
          </div>
          <div>
            <Label>{t("canteen.category")}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryNames.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={usesDualPricing ? "grid grid-cols-2 gap-3" : ""}>
            <div>
              <Label>
                {usesDualPricing ? t("canteen.retailPrice") : t("canteen.colPrice", "ราคา")}
              </Label>
              <Input
                type="number"
                value={retail}
                onChange={(e) => { setRetail(e.target.value); setEditError(null); }}
              />
            </div>
            {usesDualPricing && (
              <div>
                <Label>{t("canteen.internalPrice")}</Label>
                <Input
                  type="number"
                  value={internal}
                  onChange={(e) => { setInternal(e.target.value); setEditError(null); }}
                />
              </div>
            )}
          </div>
          <div>
            <Label>{t("canteen.photoLabel")}</Label>
            <div className="mt-1 flex items-start gap-3">
              <div className="h-20 w-20 shrink-0 rounded-md overflow-hidden border bg-muted grid place-items-center">
                {pendingPreview ? (
                  <img src={pendingPreview} alt="" className="h-full w-full object-cover" />
                ) : photoUrl ? (
                  <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Upload className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickPhoto}
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {photoUrl || pendingPreview ? t("canteen.changePhoto") : t("canteen.uploadPhoto")}
                  </Button>
                  {pendingPhoto && (
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={uploadPending}
                      disabled={uploading}
                    >
                      {uploading ? t("canteen.uploadingPhoto") : t("canteen.uploadBtn")}
                    </Button>
                  )}
                  {photoUrl && !pendingPhoto && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={removePhoto}
                      disabled={uploading}
                    >
                      {t("canteen.removePhoto")}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("canteen.photoHint")}</p>
              </div>
            </div>
          </div>
          <div>
            <Label>{t("canteen.products.colorLabel")}</Label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={color || "#e2e8f0"}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border p-0.5"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#e2e8f0"
                className="font-mono text-sm"
              />
              {color && (
                <Button variant="ghost" size="sm" type="button" onClick={() => setColor("")}>
                  {t("canteen.products.colorClear")}
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("canteen.products.colorHint")}</p>
          </div>

          {product && (
            <div className="border-t pt-3">
              <MenuOptionGroupEditor shopId={shopId} productId={product.id} />
            </div>
          )}
        </div>
        <AlertDialog open={!!editError} onOpenChange={(v) => { if (!v) setEditError(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-destructive">
                {t("canteen.products.editErrorTitle", "แก้ไขไม่ได้")}
              </AlertDialogTitle>
              <AlertDialogDescription className="whitespace-pre-wrap">
                {editError}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setEditError(null)}>
                {t("common.close", "ปิด")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600"
          >
            {saving ? t("canteen.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
