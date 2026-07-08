import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Label } from "@/components/ui/label";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package,
  Plus,
  Edit,
  AlertTriangle,
  Trash2,
  ArrowUpDown,
  TrendingDown,
  DollarSign,
  Layers,
  ClipboardList,
  ArrowDownToLine,
  X,
  Tag,
  FolderOpen,
  ScanLine,
  FileSpreadsheet,
  HandHelping,
  Printer,
  Barcode,
  CalendarCheck,
  BookOpen,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { calcFifoAvgCost, calcNewAvgCost, type FifoLot } from "@/lib/fifo";
import { useBatchQueue } from "@/hooks/useBatchQueue";
import RequisitionDialog from "./store/RequisitionDialog";
import MonthlyStockReport from "./store/MonthlyStockReport";
import BalanceFileReport from "./store/BalanceFileReport";
import { useAuth } from "@/contexts/AuthContext";
import { PrintBarcodeDialog } from "@/components/PrintBarcodeDialog";
import { ManageBarcodesDialog } from "@/components/ManageBarcodesDialog";
import { SUB_MERCHANTS, type Category, type Product, type StockMovement } from "./inventory/inventoryTypes";
import { ProductImportDialog } from "./inventory/ProductImportDialog";
import { CategoryManager } from "./inventory/CategoryManager";
import { MovementLog } from "./inventory/MovementLog";
import { StockAdjustDialog } from "./inventory/StockAdjustDialog";

const emptyForm = {
  productCode: "", barcode: "", name: "", category: "",
  subMerchantId: "coop", externalPrice: "", internalPrice: "",
  vatPercent: "0", avgCost: "", stock: "", minStock: "", color: "",

};


// ── Component ─────────────────────────────────────────────────────────────────

interface InventoryProps {
  /** When set, scopes the view to one shop (embedded inside ShopDetail) */
  lockedShopId?: string;
  /** Costing method for this shop; defaults to avg_cost */
  shopType?: "avg_cost" | "fifo";
  /** Bump this to force a product list refresh (e.g. after bulk import) */
  refreshKey?: number;
}

const Inventory = ({ lockedShopId, shopType = "avg_cost", refreshKey }: InventoryProps = {}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const embedded = lockedShopId !== undefined;
  const canSeeBalanceFile = user?.role !== "admin";

  // ── State ───────────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  // Products tab filters
  const [searchTerm, setSearchTerm] = useState("");
  const [subMerchantFilter, setSubMerchantFilter] = useState(lockedShopId ?? "all");

  // Add / Edit dialogs
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isPrintBarcodeOpen, setIsPrintBarcodeOpen] = useState(false);
  const [selectedProductForBarcode, setSelectedProductForBarcode] = useState<Product | null>(null);
  const [manageBarcodeProduct, setManageBarcodeProduct] = useState<Product | null>(null);
  const [newProduct, setNewProduct] = useState({
    ...emptyForm,
    subMerchantId: lockedShopId ?? emptyForm.subMerchantId,
  });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  // Stock adjustment dialog
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);

  // Staff requisition dialog
  const [requisitionTarget, setRequisitionTarget] = useState<Product | null>(null);

  // Receive stock — single intake form
  const [intakeProductId, setIntakeProductId] = useState("");
  const [intakeQty, setIntakeQty] = useState("");
  const [intakeCost, setIntakeCost] = useState("");
  const [intakePO, setIntakePO] = useState("");
  const [intakeInvoice, setIntakeInvoice] = useState("");
  const [intakeNote, setIntakeNote] = useState("");
  const [intakeSearch, setIntakeSearch] = useState("");
  const [intakeCostMode, setIntakeCostMode] = useState<"unit" | "total">("unit");

  // Categories (per-shop; only active in embedded mode)
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");

  // ── Batch CSV import ──
  const [isImportOpen, setIsImportOpen] = useState(false);

  // ── API data loading ─────────────────────────────────────────────────────
  const activeShopId = lockedShopId ?? subMerchantFilter;

  const fetchProducts = useCallback(async () => {
    if (!embedded) {
      // Standalone: load from all shops
      const shopIds = SUB_MERCHANTS.map((s) => s.id);
      const allProducts: Product[] = [];
      for (const sid of shopIds) {
        try {
          const data = await api.get<any[]>(`/shops/${sid}/products`);
          allProducts.push(...data.map((p: any) => ({
            id: p.id, productCode: p.product_code, barcode: p.barcode ?? "",
            name: p.name, category: p.category, subMerchantId: p.shop_id,
            externalPrice: p.external_price, internalPrice: p.internal_price,
            vatPercent: p.vat_percent, avgCost: p.avg_cost, stock: p.stock, minStock: p.min_stock,
            color: p.color ?? null,
            extraBarcodes: p.extra_barcodes ?? [],
          })));
        } catch { /* skip unavailable shop */ }
      }
      setProducts(allProducts);
    } else {
      try {
        const data = await api.get<any[]>(`/shops/${lockedShopId}/products`);
        setProducts(data.map((p: any) => ({
          id: p.id, productCode: p.product_code, barcode: p.barcode ?? "",
          name: p.name, category: p.category, subMerchantId: p.shop_id,
          externalPrice: p.external_price, internalPrice: p.internal_price,
          vatPercent: p.vat_percent, avgCost: p.avg_cost, stock: p.stock, minStock: p.min_stock,
          color: p.color ?? null,
          uomId: p.uom_id ?? null, uomCode: p.uom_code ?? null, uomName: p.uom_name ?? null,
          extraBarcodes: p.extra_barcodes ?? [],
        })));
      } catch { /* ignore */ }
    }
  }, [embedded, lockedShopId, refreshKey]);

  const fetchCategories = useCallback(async () => {
    if (!lockedShopId) return;
    try {
      const data = await api.get<any[]>(`/shops/${lockedShopId}/categories`);
      setCategories(data.map((c: any) => ({ id: c.id, name: c.name })));
    } catch { /* ignore */ }
  }, [lockedShopId]);

  const fetchMovements = useCallback(async () => {
    const sid = embedded ? lockedShopId : (subMerchantFilter !== "all" ? subMerchantFilter : null);
    if (!sid) { setMovements([]); return; }
    try {
      const data = await api.get<any[]>(`/shops/${sid}/movements?limit=200`);
      setMovements(data.map((m: any) => ({
        id: m.id, date: m.date, productId: m.product_id, productName: m.product_name,
        type: m.type as StockMovement["type"], quantity: m.quantity,
        stockBefore: m.stock_before, stockAfter: m.stock_after,
        costPerUnit: m.cost_per_unit, reference: m.reference, note: m.note,
        reversesId: m.reverses_id ?? null,
        reversedById: m.reversed_by_id ?? null,
      })));
    } catch { /* ignore */ }
  }, [embedded, lockedShopId, subMerchantFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => { fetchMovements(); }, [fetchMovements]);

  const refreshAfterMutation = useCallback(() => {
    fetchProducts();
    fetchMovements();
  }, [fetchProducts, fetchMovements]);

  const batchQueue = useBatchQueue(products, refreshAfterMutation);

  // FIFO lots: productId → array of lots (oldest date = index 0 after sort)
  const [fifoLots] = useState<Record<number, FifoLot[]>>(
    () => ({}),
  );

  // ── Derived ─────────────────────────────────────────────────────────────────

  /** Products restricted to the currently selected shop (ignores search term) */
  const shopFilteredProducts = useMemo(
    () =>
      subMerchantFilter === "all"
        ? products
        : products.filter((p) => p.subMerchantId === subMerchantFilter),
    [products, subMerchantFilter],
  );

  const filteredProducts = useMemo(
    () =>
      shopFilteredProducts.filter((p) => {
        const q = searchTerm.toLowerCase();
        const matchSearch =
          p.name.toLowerCase().includes(q) ||
          p.productCode.toLowerCase().includes(q) ||
          p.barcode.includes(q) ||
          p.category.toLowerCase().includes(q);
        const matchCategory = categoryFilter === "all" || p.category === categoryFilter;
        return matchSearch && matchCategory;
      }),
    [shopFilteredProducts, searchTerm, categoryFilter],
  );

  const lowStockItems = useMemo(
    () => shopFilteredProducts.filter((p) => p.minStock > 0 && p.stock < p.minStock),
    [shopFilteredProducts],
  );

  const totalStockValue = useMemo(
    () => shopFilteredProducts.reduce((sum, p) => sum + Math.max(p.stock, 0) * p.avgCost, 0),
    [shopFilteredProducts],
  );

  const intakeProduct = products.find(
    (p) => p.id === parseInt(intakeProductId),
  );

  /** Unit cost derived from the cost field, accounting for unit vs total mode */
  const intakeUnitCost = useMemo((): number | null => {
    if (!intakeCost || isNaN(parseFloat(intakeCost))) return null;
    if (intakeCostMode === "unit") return parseFloat(intakeCost);
    const qty = parseInt(intakeQty);
    if (!intakeQty || isNaN(qty) || qty === 0) return null;
    return parseFloat(intakeCost) / Math.abs(qty);
  }, [intakeCost, intakeCostMode, intakeQty]);

  const previewAvgCost = useMemo((): number | null => {
    if (!intakeProduct || !intakeQty || intakeUnitCost === null) return null;
    const qty = parseInt(intakeQty);
    if (isNaN(qty) || qty === 0) return null;
    if (shopType === "fifo") {
      const existingLots = fifoLots[intakeProduct.id] ?? [];
      const simulatedLots: FifoLot[] = [
        ...existingLots,
        {
          id: "preview",
          productId: intakeProduct.id,
          date: new Date().toISOString().slice(0, 10),
          qtyRemaining: qty,
          costPerUnit: intakeUnitCost,
        },
      ];
      return calcFifoAvgCost(simulatedLots);
    }
    return calcNewAvgCost(intakeProduct.stock, intakeProduct.avgCost, qty, intakeUnitCost);
  }, [intakeProduct, intakeQty, intakeUnitCost, shopType, fifoLots]);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const subMerchantName = (id: string) =>
    SUB_MERCHANTS.find((s) => s.id === id)?.name ?? id;

  const stockBadge = (stock: number, minStock: number) => {
    if (stock < 0) return <Badge variant="destructive">{t("inventory.statusNegative")}</Badge>;
    if (minStock > 0 && stock < minStock) return <Badge variant="destructive">{t("inventory.statusLow")}</Badge>;
    if (minStock > 0 && stock < minStock * 1.5) return <Badge variant="warning">{t("inventory.statusWarning")}</Badge>;
    return <Badge variant="success">{t("inventory.statusNormal")}</Badge>;
  };

  // ── Product handlers ────────────────────────────────────────────────────────

  const handleAddProduct = async () => {
    if (!newProduct.productCode || !newProduct.name || !newProduct.externalPrice || !newProduct.stock) {
      toast.error(t("inventory.fillAllRequired"));
      return;
    }
    const shopId = newProduct.subMerchantId;
    try {
      await api.post(`/shops/${shopId}/products`, {
        product_code: newProduct.productCode,
        barcode: newProduct.barcode || null,
        name: newProduct.name,
        category: newProduct.category || t("inventory.defaultCategory", "General"),
        external_price: parseFloat(newProduct.externalPrice),
        internal_price: newProduct.internalPrice ? parseFloat(newProduct.internalPrice) : parseFloat(newProduct.externalPrice),
        vat_percent: parseFloat(newProduct.vatPercent) || 0,
        avg_cost: newProduct.avgCost ? parseFloat(newProduct.avgCost) : 0,
        stock: parseInt(newProduct.stock),
        min_stock: parseInt(newProduct.minStock) || 0,
        color: newProduct.color || null,
      });
      toast.success(t("inventory.productAdded"));
      setIsAddOpen(false);
      setNewProduct({ ...emptyForm, subMerchantId: lockedShopId ?? emptyForm.subMerchantId });
      await fetchProducts();
      await fetchMovements();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to add product");
    }
  };

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      productCode: product.productCode,
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      subMerchantId: product.subMerchantId,
      externalPrice: product.externalPrice.toString(),
      internalPrice: product.internalPrice.toString(),
      vatPercent: product.vatPercent.toString(),
      avgCost: product.avgCost.toString(),
      stock: product.stock.toString(),
      minStock: product.minStock.toString(),
      color: product.color ?? "",
    });
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;
    if (!editForm.productCode || !editForm.name || !editForm.externalPrice) {
      toast.error(t("inventory.fillAllRequired"));
      return;
    }
    try {
      await api.patch(`/shops/${editingProduct.subMerchantId}/products/${editingProduct.id}`, {
        product_code: editForm.productCode,
        barcode: editForm.barcode || null,
        name: editForm.name,
        category: editForm.category || t("inventory.defaultCategory", "General"),
        external_price: parseFloat(editForm.externalPrice),
        internal_price: editForm.internalPrice ? parseFloat(editForm.internalPrice) : parseFloat(editForm.externalPrice),
        vat_percent: parseFloat(editForm.vatPercent) || 0,
        min_stock: parseInt(editForm.minStock) || 0,
        color: editForm.color || null,
      });
      toast.success(t("inventory.productUpdated"));
      setEditingProduct(null);
      await fetchProducts();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to update product");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/shops/${deleteTarget.subMerchantId}/products/${deleteTarget.id}`);
      toast.success(t("inventory.productDeleted", { name: deleteTarget.name }));
      setDeleteTarget(null);
      await fetchProducts();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to delete product");
    }
  };

  // ── Receive stock (single) ──────────────────────────────────────────────────

  const clearIntakeForm = () => {
    setIntakeProductId("");
    setIntakeQty("");
    setIntakeCost("");
    setIntakePO("");
    setIntakeInvoice("");
    setIntakeNote("");
    setIntakeSearch("");
  };

  /** Add current form values to the batch queue (does NOT process yet) */
  const handleAddToBatch = () => {
    if (!intakeProductId || !intakeQty || !intakeCost || intakeUnitCost === null) {
      toast.error(t("inventory.errorFillIntake"));
      return;
    }
    if (parseInt(intakeQty) === 0 || intakeUnitCost < 0) {
      toast.error(t("inventory.errorIntakeValidation"));
      return;
    }
    batchQueue.addItem({
      productId: intakeProductId,
      qty: intakeQty,
      cost: intakeUnitCost.toString(),
      po: intakePO,
      invoice: intakeInvoice,
      note: intakeNote,
    });
    toast.success(t("inventory.batchAdded"));
    clearIntakeForm();
  };

  /** Barcode-scan / search Enter handler: auto-selects matching product */
  const handleIntakeSearchEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const raw = intakeSearch.trim();
    if (!raw) return;
    const q = raw.toLowerCase();
    const scopedProducts = lockedShopId
      ? products.filter((p) => p.subMerchantId === lockedShopId)
      : products;
    // 1. Exact barcode match
    let found = scopedProducts.find((p) => p.barcode === raw);
    // 2. Exact product code match
    if (!found) found = scopedProducts.find((p) => p.productCode.toLowerCase() === q);
    // 3. Single partial name/code match
    if (!found) {
      const matches = scopedProducts.filter(
        (p) => p.name.toLowerCase().includes(q) || p.productCode.toLowerCase().includes(q),
      );
      if (matches.length === 1) found = matches[0];
    }
    if (found) {
      setIntakeProductId(found.id.toString());
      setIntakeSearch("");
    } else {
      toast.error(t("inventory.intakeProductNotFound", { q: raw }));
    }
  };

  // ProductFormFields is defined OUTSIDE the component to prevent re-mount on every render.
  // See ProductFormFields below the Inventory component.

  // ── Render ────────────────────────────────────────────────────────────────

  const addProductButton = (
    <Button onClick={() => setIsAddOpen(true)}>
      <Plus className="h-4 w-4 mr-2" />
      {t("inventory.addProductTitle")}
    </Button>
  );

  const importButton = (
    <Button variant="outline" onClick={() => setIsImportOpen(true)}>
      <FileSpreadsheet className="h-4 w-4 mr-2" />
      Import CSV
    </Button>
  );

  // Export Barcodes — opens the Print Barcode dialog with the full shop
  // product list. Cashiers can then search, select individual items (or
  // Select All) and print labels. Replaces the standalone "Import CSV"
  // button in the embedded Products toolbar (shop-level imports remain
  // available via the ShopImportPanel at the top of the page).
  const exportBarcodesButton = (
    <Button variant="outline" onClick={() => {
      setSelectedProductForBarcode(null);
      setIsPrintBarcodeOpen(true);
    }}>
      <Printer className="h-4 w-4 mr-2" />
      {t("inventory.exportBarcodes", "Export Barcodes")}
    </Button>
  );

  return (
    <div className={embedded ? "space-y-4" : "page-shell"}>
      {/* Page header — hidden when embedded (ShopDetail provides its own header) */}
      {!embedded && (
        <div className="page-header flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="page-title">{t("inventory.title")}</h1>
            <p className="page-description">{t("inventory.description")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsPrintBarcodeOpen(true)}>
              <Printer className="h-4 w-4 mr-2" />
              {t("inventory.printBarcode") || "Print Barcode"}
            </Button>
            {importButton}
            {addProductButton}
          </div>
        </div>
      )}

      {!embedded && (
        <InfoCallout
          id="inventory.stockWorkflow"
          variant="tip"
          title={t("inventory.info.stockWorkflow.title")}
        >
          {t("inventory.info.stockWorkflow.body")}
        </InfoCallout>
      )}

      {/* KPI Cards */}
      <div className={`grid gap-4 ${embedded ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-4"}`}>
        <Card className="kpi-card">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="kpi-label">{t("inventory.kpiTotalSkus")}</p>
                <p className="kpi-value">{shopFilteredProducts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-destructive/10 p-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="kpi-label">{t("inventory.kpiLowStock")}</p>
                <p className="kpi-value text-destructive">{lowStockItems.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-success/10 p-2">
                <DollarSign className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="kpi-label">{t("inventory.kpiStockValue")}</p>
                <p className="kpi-value">
                  ฿{totalStockValue.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        {!embedded && (
          <Card className="kpi-card">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Layers className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="kpi-label">{t("inventory.kpiSubMerchants")}</p>
                  <p className="kpi-value">{SUB_MERCHANTS.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t("inventory.lowStockAlert")} —{" "}
              {t("inventory.lowStockAlertCount", { count: lowStockItems.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lowStockItems.map((item) => (
                <Badge key={item.id} variant="destructive" className="font-normal">
                  {item.name} ({item.stock}/{item.minStock})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="products">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="products" className="gap-2">
            <Package className="h-4 w-4" />
            {t("inventory.tabProducts")}
          </TabsTrigger>
          <TabsTrigger value="receive" className="gap-2">
            <ArrowDownToLine className="h-4 w-4" />
            {t("inventory.tabReceive")}
          </TabsTrigger>
          {embedded && canSeeBalanceFile && (
            <TabsTrigger value="balance-file" className="gap-2">
              <BookOpen className="h-4 w-4" />
              Balance File
            </TabsTrigger>
          )}
          <TabsTrigger value="movements" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            {t("inventory.tabMovements")}
          </TabsTrigger>
          {embedded && (
            <TabsTrigger value="monthly-report" className="gap-2">
              <CalendarCheck className="h-4 w-4" />
              Monthly Report
            </TabsTrigger>
          )}
          {embedded && (
            <TabsTrigger value="categories" className="gap-2">
              <Tag className="h-4 w-4" />
              {t("inventory.tabCategories")}
            </TabsTrigger>
          )}
        </TabsList>

        {/* FIFO badge — shown when shop uses FIFO costing */}
        {embedded && shopType === "fifo" && (
          <div className="mt-2">
            <Badge variant="default" className="gap-1.5 bg-violet-600 hover:bg-violet-600">
              <FolderOpen className="h-3.5 w-3.5" />
              {t("inventory.shopTypeFifo")}
            </Badge>
          </div>
        )}

        {/* ── Tab: Products ─────────────────────────────────────────────── */}
        <TabsContent value="products" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder={t("inventory.searchProducts")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full sm:max-w-xs"
                />
                {!embedded && (
                  <Select value={subMerchantFilter} onValueChange={setSubMerchantFilter}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("inventory.allShops")}</SelectItem>
                      {SUB_MERCHANTS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {embedded && categories.length > 0 && (
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("inventory.allCategories")}</SelectItem>
                      {categories.filter((c) => c.name).map((c) => (
                        <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {embedded && <div className="ml-auto flex gap-2">{exportBarcodesButton}{addProductButton}</div>}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("inventory.colCode")}</TableHead>
                      <TableHead>{t("inventory.colName")}</TableHead>
                      <TableHead>{t("inventory.colShop")}</TableHead>
                      <TableHead>{t("inventory.category")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colExtPrice")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colIntPrice")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colVat")}</TableHead>
                      <TableHead className="text-right">{t("inventory.avgCost")}</TableHead>
                      <TableHead className="text-center">{t("inventory.stock")}</TableHead>
                      <TableHead className="text-center">{t("inventory.status")}</TableHead>
                      <TableHead className="text-center">{t("inventory.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={11}
                          className="h-24 text-center text-muted-foreground"
                        >
                          {t("inventory.noProductsFound")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredProducts.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-sm">
                            {item.productCode}
                          </TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-normal text-xs">
                              {subMerchantName(item.subMerchantId)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {item.category}
                          </TableCell>
                          <TableCell className="text-right data-number">
                            ฿{item.externalPrice.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right data-number text-muted-foreground">
                            ฿{item.internalPrice.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right data-number text-muted-foreground">
                            {item.vatPercent}%
                          </TableCell>
                          <TableCell className="text-right data-number text-muted-foreground">
                            ฿{item.avgCost.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center data-number font-medium">
                            {item.stock}
                          </TableCell>
                          <TableCell className="text-center">
                            {stockBadge(item.stock, item.minStock)}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <IconButton
                                tooltip={t("inventory.adjustStock")}
                                onClick={() => setAdjustTarget(item)}
                              >
                                <ArrowUpDown className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                tooltip={t("requisition.title", "Issue to staff")}
                                onClick={() => setRequisitionTarget(item)}
                              >
                                <HandHelping className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                tooltip="Manage barcodes"
                                onClick={() => setManageBarcodeProduct(item)}
                              >
                                <Barcode className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                tooltip={t("inventory.editProduct")}
                                onClick={() => openEditDialog(item)}
                              >
                                <Edit className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                tooltip={t("inventory.deleteProduct")}
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(item)}
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
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Receive Stock ────────────────────────────────────────── */}
        <TabsContent value="receive" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── Intake form ──────────────────────────────────────────── */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowDownToLine className="h-5 w-5 text-primary" />
                  {t("inventory.receiveStock")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* 1 ── Product Search / Barcode Scan */}
                <div className="space-y-1.5">
                  <Label>{t("inventory.productName")} *</Label>
                  <div className="relative">
                    <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      className="pl-10 font-mono"
                      value={intakeSearch}
                      onChange={(e) => setIntakeSearch(e.target.value)}
                      onKeyDown={handleIntakeSearchEnter}
                      placeholder={t("inventory.intakeSearchPlaceholder")}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("inventory.intakeScanHint")}</p>
                  {/* Manual dropdown fallback */}
                  <Select
                    value={intakeProductId}
                    onValueChange={(v) => { setIntakeProductId(v); setIntakeSearch(""); }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("inventory.selectProductPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(lockedShopId
                        ? products.filter((p) => p.subMerchantId === lockedShopId)
                        : products
                      ).map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>
                          [{p.productCode}] {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 2 ── Current Status (shown once a product is selected) */}
                {intakeProduct && (
                  <div className="rounded-lg border bg-muted/30 px-4 py-3">
                    <div className="flex items-center justify-between mb-2.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("inventory.currentStatus")}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground"
                        onClick={() => { setIntakeProductId(""); setIntakeSearch(""); }}
                      >
                        <X className="h-3 w-3 mr-1" />
                        {t("inventory.intakeClearProduct")}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{intakeProduct.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{intakeProduct.productCode}</p>
                      </div>
                      <div className="flex gap-6 shrink-0 text-right">
                        <div>
                          <p className="text-xs text-muted-foreground">{t("inventory.previewCurrentStock")}</p>
                          <p className="font-mono font-semibold text-xl leading-tight">{intakeProduct.stock}</p>
                          <p className="text-xs text-muted-foreground">{t("inventory.intakeUnits")}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("inventory.previewCurrentAvg")}</p>
                          <p className="font-mono font-semibold text-xl leading-tight">฿{intakeProduct.avgCost.toFixed(2)}</p>
                          <p className="text-xs text-muted-foreground">{t("inventory.intakePerUnit")}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3 ── Qty + Cost (with unit/total toggle) */}
                <div className="grid grid-cols-2 gap-4 items-end">
                  <div>
                    <Label>{t("inventory.adjustmentQuantity")} *</Label>
                    <Input
                      type="number"
                      min="1"
                      value={intakeQty}
                      onChange={(e) => setIntakeQty(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label>
                        {intakeCostMode === "unit"
                          ? t("inventory.intakeCostModeUnit")
                          : t("inventory.intakeCostModeTotal")}
                        {" "}(฿) *
                      </Label>
                      {/* Cost mode toggle — shadcn Button */}
                      <div className="flex rounded-md border overflow-hidden">
                        <Button
                          type="button"
                          variant={intakeCostMode === "unit" ? "default" : "ghost"}
                          size="sm"
                          className="rounded-none h-7 px-2.5 text-xs"
                          onClick={() => setIntakeCostMode("unit")}
                        >
                          {t("inventory.intakeCostModeUnit")}
                        </Button>
                        <Button
                          type="button"
                          variant={intakeCostMode === "total" ? "default" : "ghost"}
                          size="sm"
                          className="rounded-none h-7 px-2.5 text-xs border-l"
                          onClick={() => setIntakeCostMode("total")}
                        >
                          {t("inventory.intakeCostModeTotal")}
                        </Button>
                      </div>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={intakeCost}
                      onChange={(e) => setIntakeCost(e.target.value)}
                      placeholder="0.00"
                    />
                    {/* Computed helper */}
                    {intakeCost && intakeQty && parseInt(intakeQty) > 0 && parseFloat(intakeCost) >= 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {intakeCostMode === "total"
                          ? t("inventory.intakeUnitCostFromTotal", { v: (parseFloat(intakeCost) / parseInt(intakeQty)).toFixed(2) })
                          : t("inventory.intakeTotalFromUnit", { v: (parseFloat(intakeCost) * parseInt(intakeQty)).toFixed(2) })}
                      </p>
                    )}
                  </div>
                </div>

                {/* 4 ── PO Ref / Invoice (optional) */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t("inventory.poNumber")}</Label>
                    <Input
                      value={intakePO}
                      onChange={(e) => setIntakePO(e.target.value)}
                      placeholder="PO-2026-001"
                    />
                  </div>
                  <div>
                    <Label>{t("inventory.invoiceNumber")}</Label>
                    <Input
                      value={intakeInvoice}
                      onChange={(e) => setIntakeInvoice(e.target.value)}
                      placeholder="INV-2026-001"
                    />
                  </div>
                </div>
                <div>
                  <Label>{t("inventory.colNote")}</Label>
                  <Input
                    value={intakeNote}
                    onChange={(e) => setIntakeNote(e.target.value)}
                    placeholder={t("inventory.optionalNote")}
                  />
                </div>

                {/* 5 ── Add to Batch (primary CTA) */}
                <Button className="w-full" onClick={handleAddToBatch}>
                  <ArrowDownToLine className="h-4 w-4 mr-2" />
                  {t("inventory.addToBatch")}
                </Button>
              </CardContent>
            </Card>

            {/* ── Smart Preview ─────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("inventory.avgCostPreview")}</CardTitle>
              </CardHeader>
              <CardContent>
                {intakeProduct ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-md bg-muted p-3 space-y-0.5">
                      <p className="font-medium">{intakeProduct.name}</p>
                      <p className="text-muted-foreground font-mono text-xs">{intakeProduct.productCode}</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("inventory.previewCurrentStock")}</span>
                        <span className="font-mono">{intakeProduct.stock}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("inventory.previewCurrentAvg")}</span>
                        <span className="font-mono">฿{intakeProduct.avgCost.toFixed(2)}</span>
                      </div>
                      {intakeQty && intakeUnitCost !== null && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("inventory.previewReceiving")}</span>
                            <span className="font-mono">+{intakeQty} @ ฿{intakeUnitCost.toFixed(2)}</span>
                          </div>
                          {/* ── New avg cost prominent callout (spec: CRITICAL) ── */}
                          <div className="rounded-md border border-primary/25 bg-primary/8 px-3 py-2.5 text-center">
                            <p className="text-xs text-muted-foreground mb-0.5">
                              {shopType === "fifo"
                                ? t("inventory.previewFifoNewAvg")
                                : t("inventory.previewNewAvg")}
                            </p>
                            <p className="font-mono font-bold text-2xl text-primary leading-tight">
                              ฿{previewAvgCost?.toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {t("inventory.previewNewTotal")}:{" "}
                              <span className="font-mono font-medium">
                                {intakeProduct.stock + parseInt(intakeQty || "0")}
                              </span>{" "}
                              {t("inventory.intakeUnits")}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                    <TrendingDown className="h-8 w-8 mb-2 opacity-30" />
                    <p className="text-sm">{t("inventory.previewEmpty")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Batch queue */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  {t("inventory.batchQueue")}
                  {batchQueue.batchItems.length > 0 && (
                    <Badge className="ml-1">{batchQueue.batchItems.length}</Badge>
                  )}
                </CardTitle>
                {batchQueue.batchItems.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={batchQueue.clearBatch}
                  >
                    {t("inventory.clearBatch")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {batchQueue.batchItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {t("inventory.batchEmpty")}
                </p>
              ) : (
                <div className="space-y-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>{t("inventory.productName")}</TableHead>
                        <TableHead className="text-right">{t("inventory.adjustmentQuantity")}</TableHead>
                        <TableHead className="text-right">{t("inventory.costPerUnit")}</TableHead>
                        <TableHead>{t("inventory.poNumber")}</TableHead>
                        <TableHead>{t("inventory.invoiceNumber")}</TableHead>
                        <TableHead>{t("inventory.colNote")}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batchQueue.batchItems.map((item, idx) => {
                        const product = products.find(
                          (p) => p.id === parseInt(item.productId),
                        );
                        return (
                          <TableRow key={item.uid}>
                            <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium">
                              {product?.name ?? "—"}
                              <span className="ml-1 font-mono text-xs text-muted-foreground">
                                [{product?.productCode}]
                              </span>
                            </TableCell>
                            <TableCell className="text-right data-number text-success font-medium">
                              +{item.qty}
                            </TableCell>
                            <TableCell className="text-right data-number text-muted-foreground">
                              ฿{parseFloat(item.cost).toFixed(2)}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {item.po || "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {item.invoice || "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {item.note || "—"}
                            </TableCell>
                            <TableCell>
                              <IconButton
                                tooltip={t("inventory.tooltip.removeBatchItem")}
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => batchQueue.removeItem(item.uid)}
                              >
                                <X className="h-4 w-4" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <Button className="w-full" onClick={batchQueue.confirmAll}>
                    <ArrowDownToLine className="h-4 w-4 mr-2" />
                    {t("inventory.confirmAll", { count: batchQueue.batchItems.length })}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Monthly Stock Report ──────────────────────────────────── */}
        <TabsContent value="monthly-report">
          {embedded && lockedShopId && (
            <MonthlyStockReport shopId={lockedShopId} />
          )}
        </TabsContent>

        {/* ── Tab: Balance File (Average Cost) ───────────────────────────── */}
        <TabsContent value="balance-file">
          {embedded && lockedShopId && canSeeBalanceFile && (
            <BalanceFileReport lockedShopId={lockedShopId} />
          )}
        </TabsContent>

        {/* ── Tab: Movement Log ─────────────────────────────────────────── */}
        <TabsContent value="movements">
          <MovementLog
            movements={movements}
            products={products}
            subMerchantFilter={subMerchantFilter}
            embedded={embedded}
            lockedShopId={lockedShopId}
            onReversed={refreshAfterMutation}
          />
        </TabsContent>

        {/* ── Tab: Categories ────────────────────────────────────────────── */}
        {embedded && (
          <TabsContent value="categories" className="space-y-4">
            <CategoryManager shopId={lockedShopId!} categories={categories} onChanged={fetchCategories} />
          </TabsContent>
        )}
      </Tabs>

      {/* ── Batch CSV Import Dialog ──────────────────────────────────────────── */}
      <ProductImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        targetShopId={activeShopId !== "all" ? activeShopId : null}
        embedded={embedded}
        lockedShopId={lockedShopId}
      />

      {/* ── Add Product Dialog ──────────────────────────────────────────────── */}
      <Dialog
        open={isAddOpen}
        onOpenChange={(open) => {
          setIsAddOpen(open);
          // Reset form state whenever the dialog closes (Cancel, ESC, click
          // outside, success). Without this the next opening still shows the
          // previously typed values, which confused cashiers who hit the
          // required-field guard, dismissed the toast, then re-opened the
          // dialog expecting a blank form.
          if (!open) {
            setNewProduct({ ...emptyForm, subMerchantId: lockedShopId ?? emptyForm.subMerchantId });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("inventory.addProductTitle")}</DialogTitle>
            <DialogDescription>{t("inventory.addProductDesc")}</DialogDescription>
          </DialogHeader>
          <ProductFormFields form={newProduct} setForm={setNewProduct} isEdit={false} shopType={shopType} embedded={embedded} categories={categories} lockedShopId={lockedShopId} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              {t("inventory.cancel")}
            </Button>
            <Button onClick={handleAddProduct}>{t("inventory.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ─────────────────────────────────────────────────────── */}
      <Dialog
        open={!!editingProduct}
        onOpenChange={(open) => !open && setEditingProduct(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("inventory.editProduct")}</DialogTitle>
            <DialogDescription>{t("inventory.editProductDesc")}</DialogDescription>
          </DialogHeader>
          <ProductFormFields form={editForm} setForm={setEditForm} isEdit={true} shopType={shopType} embedded={embedded} categories={categories} lockedShopId={lockedShopId} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProduct(null)}>
              {t("inventory.cancel")}
            </Button>
            <Button onClick={handleUpdateProduct}>{t("inventory.saveChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ──────────────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inventory.deleteProduct")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("inventory.deleteProductDesc", { name: deleteTarget?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("inventory.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Stock Adjust Dialog ─────────────────────────────────────────────── */}
      <StockAdjustDialog
        product={adjustTarget}
        onOpenChange={(open) => !open && setAdjustTarget(null)}
        shopType={shopType}
        onAdjusted={refreshAfterMutation}
      />

      {/* ── Staff Requisition Dialog ─────────────────────────────────────────── */}
      <RequisitionDialog
        target={
          requisitionTarget
            ? {
                id: requisitionTarget.id,
                name: requisitionTarget.name,
                stock: requisitionTarget.stock,
                shopId: requisitionTarget.subMerchantId,
              }
            : null
        }
        onOpenChange={(open) => !open && setRequisitionTarget(null)}
        onSuccess={() => {
          fetchProducts();
          fetchMovements();
        }}
      />

      {/* Print Barcode Dialog */}
      <PrintBarcodeDialog
        open={isPrintBarcodeOpen}
        onOpenChange={setIsPrintBarcodeOpen}
        products={shopFilteredProducts}
        selectedProduct={selectedProductForBarcode}
      />

      {/* Manage Barcodes Dialog */}
      {manageBarcodeProduct && (
        <ManageBarcodesDialog
          open={!!manageBarcodeProduct}
          onOpenChange={(o) => { if (!o) setManageBarcodeProduct(null); }}
          shopId={manageBarcodeProduct.subMerchantId}
          productId={manageBarcodeProduct.id}
          productName={manageBarcodeProduct.name}
          primaryBarcode={manageBarcodeProduct.barcode}
        />
      )}
    </div>
  );
};

export default Inventory;

// ── ProductFormFields (defined outside Inventory to prevent re-mount) ────────

interface ProductFormFieldsProps {
  form: typeof emptyForm;
  setForm: (v: typeof emptyForm) => void;
  isEdit?: boolean;
  shopType: "avg_cost" | "fifo";
  embedded: boolean;
  categories: { id: string; name: string }[];
  lockedShopId?: string;
}

function ProductFormFields({
  form,
  setForm,
  isEdit = false,
  shopType,
  embedded,
  categories,
}: ProductFormFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("inventory.productCode")} *</Label>
          <Input
            value={form.productCode}
            onChange={(e) => setForm({ ...form, productCode: e.target.value })}
            placeholder="P001"
          />
        </div>
        <div>
          <Label>{t("inventory.barcode")}</Label>
          <Input
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            placeholder="EAN-13"
            className="font-mono"
          />
        </div>
      </div>
      <div>
        <Label>{t("inventory.productName")} *</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div>
        <Label>{t("inventory.category")}</Label>
        {embedded && categories.length > 0 ? (
          <Select
            value={form.category}
            onValueChange={(v) => setForm({ ...form, category: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("inventory.selectCategory")} />
            </SelectTrigger>
            <SelectContent>
              {categories.filter((c) => c.name).map((c) => (
                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-4 items-end">
        <div>
          <Label>{t("inventory.externalPrice")} (฿) *</Label>
          <Input
            type="number"
            value={form.externalPrice}
            onChange={(e) => setForm({ ...form, externalPrice: e.target.value })}
          />
        </div>
        <div>
          <Label>{t("inventory.internalPrice")} (฿)</Label>
          <Input
            type="number"
            value={form.internalPrice}
            onChange={(e) => setForm({ ...form, internalPrice: e.target.value })}
          />
        </div>
        <div>
          <Label>{t("inventory.vatPercent")} (%)</Label>
          <Input
            type="number"
            value={form.vatPercent}
            onChange={(e) => setForm({ ...form, vatPercent: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1 items-end">
        <div className="pb-0">
          {shopType === "fifo" ? (
            <>
              <Label className="leading-snug">
                {isEdit
                  ? t("inventory.fifoAvgCostReadonly")
                  : t("inventory.fifoInitialLotCost")}{" "}
                (฿)
              </Label>
              <Input
                type="number"
                value={form.avgCost}
                onChange={(e) => !isEdit && setForm({ ...form, avgCost: e.target.value })}
                placeholder="0.00"
                readOnly={isEdit}
                className={isEdit ? "bg-muted cursor-not-allowed" : undefined}
              />
            </>
          ) : (
            <>
              <Label>{t("inventory.avgCost")} (฿)</Label>
              <Input
                type="number"
                value={form.avgCost}
                onChange={(e) => setForm({ ...form, avgCost: e.target.value })}
                placeholder="0.00"
              />
            </>
          )}
        </div>
        <div>
          <Label>{t("inventory.stock")} *</Label>
          <Input
            type="number"
            value={form.stock}
            onChange={(e) => setForm({ ...form, stock: e.target.value })}
          />
        </div>
        <div>
          <Label>{t("inventory.minStock")}</Label>
          <Input
            type="number"
            value={form.minStock}
            onChange={(e) => setForm({ ...form, minStock: e.target.value })}
          />
        </div>
      </div>
      {shopType === "fifo" && (
        <p className="text-xs text-muted-foreground -mt-2">
          {isEdit
            ? t("inventory.fifoAvgCostReadonlyHint")
            : t("inventory.fifoInitialLotCostHint")}
        </p>
      )}
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
  );
}
