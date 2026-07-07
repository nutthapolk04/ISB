import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { IconButton } from "@/components/IconButton";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Package, Plus, Edit, Trash2, X, Layers, Search, Loader2, CheckCircle2, XCircle, Minus, Printer,
} from "lucide-react";
import { PrintBarcodeDialog, type Product as BarcodePrintProduct } from "@/components/PrintBarcodeDialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { useBundles, type Bundle, type BundleCreate, type BundleUpdate, type BundleItemCreate } from "@/hooks/useBundles";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
    id: number;
    product_code: string;
    name: string;
    external_price: number;
    stock: number;
    barcode?: string | null;
}

interface BundlesProps {
    lockedShopId?: string;
}

interface BundleFormData {
    bundle_code: string;
    barcode: string;
    name: string;
    description: string;
    external_price: string;
    internal_price: string;
    color: string;
    items: { product_id: number; quantity: number; product_name: string; product_code: string; unit_price: number }[];
}

const emptyForm: BundleFormData = {
    bundle_code: "",
    barcode: "",
    name: "",
    description: "",
    external_price: "",
    internal_price: "",
    color: "",
    items: [],
};

const COLORS = [
    { value: "__default__", label: "Default" },
    { value: "#FF6B6B", label: "Red" },
    { value: "#4ECDC4", label: "Teal" },
    { value: "#45B7D1", label: "Blue" },
    { value: "#96CEB4", label: "Green" },
    { value: "#FFEAA7", label: "Yellow" },
    { value: "#DDA0DD", label: "Purple" },
    { value: "#F0E68C", label: "Khaki" },
    { value: "#FFB347", label: "Orange" },
];

// ── Component ─────────────────────────────────────────────────────────────────

const Bundles = ({ lockedShopId }: BundlesProps) => {
    const { t } = useTranslation();
    const shopId = lockedShopId ?? null;

    const { bundles, loading, refetch, createBundle, updateBundle, deleteBundle } = useBundles(shopId);

    // ── State ─────────────────────────────────────────────────────────────────
    const [search, setSearch] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [formData, setFormData] = useState<BundleFormData>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletingBundle, setDeletingBundle] = useState<Bundle | null>(null);
    const [printBarcodeOpen, setPrintBarcodeOpen] = useState(false);
    const [selectedBundleForBarcode, setSelectedBundleForBarcode] = useState<BarcodePrintProduct | null>(null);

    // Product search for adding items to bundle
    const [products, setProducts] = useState<Product[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [loadingProducts, setLoadingProducts] = useState(false);

    // ── Fetch products for bundle items ────────────────────────────────────────
    // Backend returns List[ShopProductResponse] directly (not wrapped), and
    // already filters by name / product_code / barcode when `search` is set.
    const fetchProducts = async (query = "") => {
        if (!shopId) return;
        setLoadingProducts(true);
        try {
            const params = query ? `?search=${encodeURIComponent(query)}` : "";
            const data = await api.get<Product[]>(`/shops/${shopId}/products${params}`);
            setProducts(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error("Failed to fetch products:", e);
            setProducts([]);
        } finally {
            setLoadingProducts(false);
        }
    };

    useEffect(() => {
        if (dialogOpen && shopId) {
            fetchProducts();
        }
    }, [dialogOpen, shopId]);

    // Debounce the search input so we don't hammer the backend on every keystroke.
    // Empty query resets to the default (first-page) listing.
    useEffect(() => {
        if (!dialogOpen || !shopId) return;
        const timer = setTimeout(() => {
            fetchProducts(productSearch.trim());
        }, 250);
        return () => clearTimeout(timer);
        // fetchProducts is stable enough — depends only on shopId, captured in the closure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productSearch, dialogOpen, shopId]);

    // ── Filtered bundles ──────────────────────────────────────────────────────
    const filteredBundles = useMemo(() => {
        if (!search) return bundles;
        const q = search.toLowerCase();
        return bundles.filter(
            (b) =>
                b.bundle_code.toLowerCase().includes(q) ||
                b.name.toLowerCase().includes(q)
        );
    }, [bundles, search]);

    // ── Form handlers ──────────────────────────────────────────────────────────
    // Reset form state whenever the dialog transitions to closed so a stale
    // create attempt (e.g. blocked by the 'fill required fields' alert) doesn't
    // leak partially-typed data into the next open. Deferred so the close
    // animation finishes before fields visibly clear.
    useEffect(() => {
        if (dialogOpen) return;
        const id = setTimeout(() => {
            setFormData(emptyForm);
            setEditingId(null);
            setProductSearch("");
        }, 200);
        return () => clearTimeout(id);
    }, [dialogOpen]);

    const openCreateDialog = () => {
        setFormData(emptyForm);
        setIsEditing(false);
        setEditingId(null);
        setDialogOpen(true);
    };

    const openEditDialog = (bundle: Bundle) => {
        setFormData({
            bundle_code: bundle.bundle_code,
            barcode: bundle.barcode || "",
            name: bundle.name,
            description: bundle.description || "",
            external_price: bundle.external_price.toString(),
            internal_price: bundle.internal_price.toString(),
            color: bundle.color || "",
            items: bundle.items.map((i) => ({
                product_id: i.product_id,
                quantity: i.quantity,
                product_name: i.product_name,
                product_code: i.product_code,
                unit_price: i.unit_price,
            })),
        });
        setIsEditing(true);
        setEditingId(bundle.id);
        setDialogOpen(true);
    };

    const handleAddItem = (product: Product) => {
        // Check if already added
        if (formData.items.some((i) => i.product_id === product.id)) {
            toast.error(t("bundles.itemAlreadyAdded") || "Product already added to bundle");
            return;
        }
        setFormData({
            ...formData,
            items: [
                ...formData.items,
                {
                    product_id: product.id,
                    quantity: 1,
                    product_name: product.name,
                    product_code: product.product_code,
                    unit_price: product.external_price,
                },
            ],
        });
        setProductSearch("");
    };

    const handleRemoveItem = (productId: number) => {
        setFormData({
            ...formData,
            items: formData.items.filter((i) => i.product_id !== productId),
        });
    };

    const handleItemQuantityChange = (productId: number, qty: number) => {
        if (qty < 1) return;
        setFormData({
            ...formData,
            items: formData.items.map((i) =>
                i.product_id === productId ? { ...i, quantity: qty } : i
            ),
        });
    };

    const calculateTotalValue = () => {
        return formData.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    };

    const handleSave = async () => {
        if (!formData.bundle_code.trim()) {
            toast.error(t("bundles.errorCodeRequired") || "Bundle code is required");
            return;
        }
        if (!formData.name.trim()) {
            toast.error(t("bundles.errorNameRequired") || "Bundle name is required");
            return;
        }
        if (formData.items.length === 0) {
            toast.error(t("bundles.errorItemsRequired") || "At least one item is required");
            return;
        }
        const externalPrice = parseFloat(formData.external_price);
        if (isNaN(externalPrice) || externalPrice < 0) {
            toast.error(t("bundles.errorPriceInvalid") || "Invalid price");
            return;
        }

        setSaving(true);
        try {
            const bundleItems: BundleItemCreate[] = formData.items.map((i) => ({
                product_id: i.product_id,
                quantity: i.quantity,
            }));

            if (isEditing && editingId) {
                const updateData: BundleUpdate = {
                    bundle_code: formData.bundle_code.trim(),
                    barcode: formData.barcode.trim() || null,
                    name: formData.name.trim(),
                    description: formData.description.trim() || null,
                    external_price: externalPrice,
                    internal_price: formData.internal_price ? parseFloat(formData.internal_price) : externalPrice,
                    color: formData.color || null,
                    items: bundleItems,
                };
                await updateBundle(editingId, updateData);
                toast.success(t("bundles.updated") || "Bundle updated");
            } else {
                const createData: BundleCreate = {
                    bundle_code: formData.bundle_code.trim(),
                    barcode: formData.barcode.trim() || null,
                    name: formData.name.trim(),
                    description: formData.description.trim() || null,
                    external_price: externalPrice,
                    internal_price: formData.internal_price ? parseFloat(formData.internal_price) : undefined,
                    color: formData.color || null,
                    items: bundleItems,
                };
                await createBundle(createData);
                toast.success(t("bundles.created") || "Bundle created");
            }
            setDialogOpen(false);
        } catch (e: any) {
            toast.error(e?.detail || e?.message || "Failed to save bundle");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingBundle) return;
        try {
            await deleteBundle(deletingBundle.id);
            toast.success(t("bundles.deleted") || "Bundle deactivated");
            setDeleteDialogOpen(false);
            setDeletingBundle(null);
        } catch (e: any) {
            toast.error(e?.detail || "Failed to delete bundle");
        }
    };

    // Backend already filters by name / product_code / barcode when `search`
    // is set. Slice to 10 to keep the dropdown short.
    const filteredProducts = useMemo(() => products.slice(0, 10), [products]);

    // ── Render ─────────────────────────────────────────────────────────────────
    if (!shopId) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                    {t("bundles.noShopSelected") || "No shop selected"}
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2">
                        <Layers className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold">{t("bundles.title") || "Product Bundles"}</h2>
                        <p className="text-sm text-muted-foreground">
                            {t("bundles.description") || "Create sets of products to sell together (e.g. Grade supply sets)"}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setSelectedBundleForBarcode(null); setPrintBarcodeOpen(true); }}>
                        <Printer className="h-4 w-4 mr-2" />
                        {t("bundles.printBarcodes", "Print Barcodes")}
                    </Button>
                    <Button onClick={openCreateDialog}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t("bundles.create") || "Create Bundle"}
                    </Button>
                </div>
            </div>

            {/* Search */}
            <Card>
                <CardContent className="pt-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t("bundles.searchPlaceholder") || "Search bundles..."}
                            className="pl-10"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Bundles Table */}
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredBundles.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground">
                            {bundles.length === 0
                                ? (t("bundles.empty") || "No bundles created yet")
                                : (t("bundles.noResults") || "No bundles match your search")}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("bundles.code") || "Code"}</TableHead>
                                    <TableHead>{t("bundles.name") || "Name"}</TableHead>
                                    <TableHead className="text-center">{t("bundles.items") || "Items"}</TableHead>
                                    <TableHead className="text-right">{t("bundles.itemsValue") || "Items Value"}</TableHead>
                                    <TableHead className="text-right">{t("bundles.price") || "Bundle Price"}</TableHead>
                                    <TableHead className="text-right">{t("bundles.savings") || "Savings"}</TableHead>
                                    <TableHead className="text-center">{t("bundles.status") || "Status"}</TableHead>
                                    <TableHead className="text-right">{t("bundles.actions") || "Actions"}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredBundles.map((bundle) => (
                                    <TableRow key={bundle.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {bundle.color && (
                                                    <div
                                                        className="w-3 h-3 rounded-full shrink-0"
                                                        style={{ backgroundColor: bundle.color }}
                                                    />
                                                )}
                                                <span className="font-mono text-sm">{bundle.bundle_code}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div>
                                                <div className="font-medium">{bundle.name}</div>
                                                {bundle.description && (
                                                    <div className="text-sm text-muted-foreground truncate max-w-xs">
                                                        {bundle.description}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="secondary">
                                                {bundle.items.length} {t("bundles.products") || "products"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {bundle.total_items_value.toLocaleString("th-TH", {
                                                minimumFractionDigits: 2,
                                            })}
                                        </TableCell>
                                        <TableCell className="text-right font-medium font-mono">
                                            {bundle.external_price.toLocaleString("th-TH", {
                                                minimumFractionDigits: 2,
                                            })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {bundle.savings > 0 ? (
                                                <Badge variant="success" className="font-mono">
                                                    -{bundle.savings.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                                </Badge>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {bundle.is_active ? (
                                                <Badge variant="success">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                                    {t("bundles.active") || "Active"}
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">
                                                    <XCircle className="h-3 w-3 mr-1" />
                                                    {t("bundles.inactive") || "Inactive"}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <IconButton
                                                    tooltip={t("bundles.printBarcode", "Print Barcode")}
                                                    onClick={() => {
                                                        setSelectedBundleForBarcode({
                                                            id: bundle.id,
                                                            productCode: bundle.bundle_code,
                                                            // Prefer the explicit barcode column when set;
                                                            // fall back to bundle_code so legacy bundles
                                                            // without a saved barcode still print.
                                                            barcode: bundle.barcode || bundle.bundle_code,
                                                            name: bundle.name,
                                                            externalPrice: bundle.external_price,
                                                        });
                                                        setPrintBarcodeOpen(true);
                                                    }}
                                                >
                                                    <Printer className="h-4 w-4" />
                                                </IconButton>
                                                <IconButton
                                                    tooltip={t("bundles.edit") || "Edit"}
                                                    onClick={() => openEditDialog(bundle)}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </IconButton>
                                                <IconButton
                                                    tooltip={t("bundles.delete") || "Deactivate"}
                                                    variant="destructive"
                                                    onClick={() => {
                                                        setDeletingBundle(bundle);
                                                        setDeleteDialogOpen(true);
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </IconButton>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent
                    className="max-w-2xl max-h-[90vh] overflow-y-auto"
                    onInteractOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {isEditing
                                ? (t("bundles.editTitle") || "Edit Bundle")
                                : (t("bundles.createTitle") || "Create Bundle")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("bundles.dialogDescription") || "Create a set of products to sell together at a bundle price."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {/* Basic Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>{t("bundles.bundleCode") || "Bundle Code"} *</Label>
                                <Input
                                    value={formData.bundle_code}
                                    onChange={(e) => setFormData({ ...formData, bundle_code: e.target.value })}
                                    placeholder="e.g. GRADE1-SET"
                                />
                            </div>
                            <div>
                                <Label>{t("bundles.bundleName") || "Name"} *</Label>
                                <Input
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder={t("bundles.namePlaceholder") || "e.g. Grade 1 Supply Set"}
                                />
                            </div>
                        </div>

                        <div>
                            <Label>{t("bundles.bundleDescription") || "Description"}</Label>
                            <Textarea
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder={t("bundles.descriptionPlaceholder") || "Optional description..."}
                                rows={2}
                            />
                        </div>

                        <div>
                            <Label>{t("bundles.barcode") || "Barcode"}</Label>
                            <Input
                                value={formData.barcode}
                                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                placeholder={t("bundles.barcodePlaceholder") || "Scan or type a barcode (optional)"}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                {t("bundles.barcodeHint") || "Leave blank to use the Bundle Code as the scannable value."}
                            </p>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <Label>{t("bundles.externalPrice") || "Retail Price"} *</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formData.external_price}
                                    onChange={(e) => setFormData({ ...formData, external_price: e.target.value })}
                                    placeholder="0.00"
                                />
                            </div>
                            <div>
                                <Label>{t("bundles.internalPrice") || "Staff Price"}</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formData.internal_price}
                                    onChange={(e) => setFormData({ ...formData, internal_price: e.target.value })}
                                    placeholder={t("bundles.sameAsRetail") || "Same as retail"}
                                />
                            </div>
                            <div>
                                <Label>{t("bundles.color") || "Card Color"}</Label>
                                <Select
                                    value={formData.color || "__default__"}
                                    onValueChange={(v) => setFormData({ ...formData, color: v === "__default__" ? "" : v })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t("bundles.selectColor") || "Select color"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {COLORS.map((c) => (
                                            <SelectItem key={c.value} value={c.value}>
                                                <div className="flex items-center gap-2">
                                                    {c.value !== "__default__" && (
                                                        <div
                                                            className="w-4 h-4 rounded border"
                                                            style={{ backgroundColor: c.value }}
                                                        />
                                                    )}
                                                    <span>{c.label}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Bundle Items */}
                        <div className="border rounded-lg p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <Label className="text-base font-medium">
                                    {t("bundles.bundleItems") || "Bundle Items"} *
                                </Label>
                                {formData.items.length > 0 && (
                                    <div className="text-sm text-muted-foreground">
                                        {t("bundles.totalValue") || "Total value"}:{" "}
                                        <span className="font-mono font-medium">
                                            {calculateTotalValue().toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Add Product Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    placeholder={t("bundles.searchProductsHint", "Search by code, name, or barcode…")}
                                    className="pl-10 h-9 text-sm"
                                />
                            </div>

                            {/* Product Search Results */}
                            {productSearch && (
                                <div className="border rounded-md max-h-40 overflow-y-auto">
                                    {loadingProducts ? (
                                        <div className="p-4 text-center">
                                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                                        </div>
                                    ) : filteredProducts.length === 0 ? (
                                        <div className="p-4 text-center text-muted-foreground text-sm">
                                            {t("bundles.noProductsFound") || "No products found"}
                                        </div>
                                    ) : (
                                        filteredProducts.map((p) => (
                                            <div
                                                key={p.id}
                                                className="flex items-center justify-between p-2 hover:bg-muted cursor-pointer border-b last:border-b-0"
                                                onClick={() => handleAddItem(p)}
                                            >
                                                <div>
                                                    <div className="text-sm font-medium">{p.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {p.product_code} · Stock: {p.stock}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-mono">
                                                        {p.external_price.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                                    </span>
                                                    <Plus className="h-4 w-4 text-primary" />
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Selected Items */}
                            {formData.items.length === 0 ? (
                                <div className="text-center text-muted-foreground py-8 border rounded-md">
                                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p>{t("bundles.noItemsYet") || "No items added yet"}</p>
                                    <p className="text-sm">{t("bundles.searchToAdd") || "Search for products above to add them"}</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t("bundles.product") || "Product"}</TableHead>
                                            <TableHead className="text-center w-32">{t("bundles.quantity") || "Qty"}</TableHead>
                                            <TableHead className="text-right">{t("bundles.unitPrice") || "Unit Price"}</TableHead>
                                            <TableHead className="text-right">{t("bundles.subtotal") || "Subtotal"}</TableHead>
                                            <TableHead className="w-12"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {formData.items.map((item) => (
                                            <TableRow key={item.product_id}>
                                                <TableCell>
                                                    <div className="font-medium">{item.product_name}</div>
                                                    <div className="text-sm text-muted-foreground">{item.product_code}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            className="h-7 w-7"
                                                            onClick={() => handleItemQuantityChange(item.product_id, item.quantity - 1)}
                                                            disabled={item.quantity <= 1}
                                                        >
                                                            <Minus className="h-3 w-3" />
                                                        </Button>
                                                        <Input
                                                            type="number"
                                                            min="1"
                                                            value={item.quantity}
                                                            onChange={(e) =>
                                                                handleItemQuantityChange(item.product_id, parseInt(e.target.value) || 1)
                                                            }
                                                            className="w-14 h-7 text-center"
                                                        />
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            className="h-7 w-7"
                                                            onClick={() => handleItemQuantityChange(item.product_id, item.quantity + 1)}
                                                        >
                                                            <Plus className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {item.unit_price.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-medium">
                                                    {(item.unit_price * item.quantity).toLocaleString("th-TH", {
                                                        minimumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell>
                                                    <IconButton
                                                        tooltip={t("bundles.removeItem") || "Remove"}
                                                        variant="ghost"
                                                        onClick={() => handleRemoveItem(item.product_id)}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}

                            {/* Savings Preview */}
                            {formData.items.length > 0 && formData.external_price && (
                                <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                                    <span className="text-sm font-medium">
                                        {t("bundles.savingsPreview") || "Customer Savings"}:
                                    </span>
                                    <span className="font-mono font-semibold text-green-600">
                                        {(calculateTotalValue() - parseFloat(formData.external_price || "0")).toLocaleString(
                                            "th-TH",
                                            { minimumFractionDigits: 2 }
                                        )}
                                        {" "}
                                        ({(
                                            ((calculateTotalValue() - parseFloat(formData.external_price || "0")) /
                                                calculateTotalValue()) *
                                            100
                                        ).toFixed(1)}
                                        %)
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            {t("common.cancel") || "Cancel"}
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {isEditing ? (t("common.save") || "Save") : (t("bundles.create") || "Create")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("bundles.deleteTitle") || "Deactivate Bundle?"}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("bundles.deleteDescription") ||
                                `This will deactivate the bundle "${deletingBundle?.name}". It will no longer appear in POS but can be reactivated later.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel") || "Cancel"}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>
                            {t("bundles.deactivate") || "Deactivate"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Print Barcode Dialog — prefer the explicit barcode column when set,
          otherwise fall back to bundle_code so legacy bundles still print. */}
            <PrintBarcodeDialog
                open={printBarcodeOpen}
                onOpenChange={setPrintBarcodeOpen}
                products={(bundles ?? []).map((b) => ({
                    id: b.id,
                    productCode: b.bundle_code,
                    barcode: b.barcode || b.bundle_code,
                    name: b.name,
                    externalPrice: b.external_price,
                }))}
                selectedProduct={selectedBundleForBarcode}
            />
        </div>
    );
};

export default Bundles;
