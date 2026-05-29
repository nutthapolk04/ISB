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
  CheckCircle2,
  HandHelping,
  Printer,
  Barcode,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import RequisitionDialog from "./store/RequisitionDialog";
import { useUom, type UnitOfMeasure } from "@/hooks/useUom";
import { PrintBarcodeDialog } from "@/components/PrintBarcodeDialog";
import { ManageBarcodesDialog } from "@/components/ManageBarcodesDialog";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SubMerchant {
  id: string;
  name: string;
}

interface ExtraBarcode {
  id: number;
  barcode: string;
  label: string | null;
}

interface Product {
  id: number;
  productCode: string;
  barcode: string;
  name: string;
  category: string;
  subMerchantId: string;
  externalPrice: number;
  internalPrice: number;
  vatPercent: number;
  avgCost: number;
  stock: number;
  minStock: number;
  color?: string | null;
  uomId?: number | null;
  uomCode?: string | null;
  uomName?: string | null;
  extraBarcodes?: ExtraBarcode[];
}

type MovementType = "receive" | "sale" | "adjustment" | "internal_use" | "void" | "exchange";

interface StockMovement {
  id: number;
  date: string;
  productId: number;
  productName: string;
  type: MovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  costPerUnit?: number;
  reference?: string;
  department?: string;
  note?: string;
  reversesId?: number | null;
  reversedById?: number | null;
}

interface BatchItem {
  uid: string;
  productId: string;
  qty: string;
  cost: string;
  po: string;
  invoice: string;
  note: string;
}

interface Category {
  id: string;
  name: string;
}

interface FifoLot {
  id: string;
  productId: number;
  date: string;
  qtyRemaining: number;
  costPerUnit: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SUB_MERCHANTS: SubMerchant[] = [
  { id: "coop",      name: "Coop Shop"   },
  { id: "sports",    name: "Sports Shop" },
  { id: "canteen",   name: "ISB Canteen" },
  { id: "bookstore", name: "Bookstore"   },
];

const ADJUSTMENT_REASONS = [
  "Receive stock",
  "Return from customer",
  "Damage / write-off",
  "Manual adjustment",
  "Stock count correction",
  "Other",
] as const;

const INITIAL_CATEGORIES: Record<string, Category[]> = {
  coop:      [{ id: "bev", name: "Beverages" }, { id: "food", name: "Food" }, { id: "hh", name: "Household" }],
  sports:    [{ id: "sport", name: "Sports" }, { id: "apparel", name: "Apparel" }],
  canteen:   [{ id: "meal", name: "Meal" }],
  bookstore: [{ id: "stat", name: "Stationery" }],
};

const MOVEMENT_VARIANTS: Record<
  MovementType,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  receive:      "success",
  sale:         "secondary",
  adjustment:   "warning",
  internal_use: "default",
  void:         "destructive",
  exchange:     "secondary",
};


// ── Helpers ───────────────────────────────────────────────────────────────────

function calcNewAvgCost(
  currentStock: number,
  currentAvgCost: number,
  newQty: number,
  newCostPerUnit: number,
): number {
  const totalCurrentValue = Math.max(currentStock, 0) * currentAvgCost;
  const totalQty = Math.max(currentStock, 0) + newQty;
  if (totalQty === 0) return newCostPerUnit;
  return (totalCurrentValue + newQty * newCostPerUnit) / totalQty;
}

function calcFifoAvgCost(lots: FifoLot[]): number {
  const totalQty = lots.reduce((s, l) => s + l.qtyRemaining, 0);
  if (totalQty === 0) return 0;
  return lots.reduce((s, l) => s + l.qtyRemaining * l.costPerUnit, 0) / totalQty;
}

/** Deduct qty from oldest lots first; removes fully-depleted lots.
 *  If all lots are exhausted and qty still remains (negative stock scenario),
 *  appends a phantom lot with negative qtyRemaining using the latest lot's
 *  costPerUnit as COGS fallback. */
function deductFifoLots(lots: FifoLot[], qty: number): FifoLot[] {
  const sorted = [...lots].sort((a, b) => a.date.localeCompare(b.date));
  let remaining = Math.abs(qty);
  const result = sorted
    .map((lot) => {
      if (remaining <= 0) return lot;
      const deduct = Math.min(lot.qtyRemaining, remaining);
      remaining -= deduct;
      return { ...lot, qtyRemaining: lot.qtyRemaining - deduct };
    })
    .filter((lot) => lot.qtyRemaining > 0);

  // Phantom lot: when stock goes negative, record the overshoot with latest lot's cost
  if (remaining > 0) {
    const latestLot = sorted[sorted.length - 1];
    result.push({
      id: `phantom-${Date.now()}`,
      productId: latestLot?.productId ?? 0,
      date: new Date().toISOString().slice(0, 10),
      qtyRemaining: -remaining,
      costPerUnit: latestLot?.costPerUnit ?? 0,
    });
  }

  return result;
}


const emptyForm = {
  productCode: "", barcode: "", name: "", category: "",
  subMerchantId: "coop", externalPrice: "", internalPrice: "",
  vatPercent: "7", avgCost: "", stock: "", minStock: "", color: "",
  uomId: "" as string | number,
};


// ── Component ─────────────────────────────────────────────────────────────────

interface InventoryProps {
  /** When set, scopes the view to one shop (embedded inside ShopDetail) */
  lockedShopId?: string;
  /** Costing method for this shop; defaults to avg_cost */
  shopType?: "avg_cost" | "fifo";
}

const Inventory = ({ lockedShopId, shopType = "avg_cost" }: InventoryProps = {}) => {
  const { t } = useTranslation();
  const embedded = lockedShopId !== undefined;
  const { uoms } = useUom();

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
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustCost, setAdjustCost] = useState("");

  // Reverse-adjustment confirm dialog
  const [reverseTarget, setReverseTarget] = useState<StockMovement | null>(null);
  const [reverseSubmitting, setReverseSubmitting] = useState(false);

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

  // Batch queue — persisted in sessionStorage so navigate away/back doesn't lose items
  const BATCH_KEY = "inventory_batch_queue";
  const [batchItems, setBatchItems] = useState<BatchItem[]>(() => {
    try {
      const saved = sessionStorage.getItem(BATCH_KEY);
      return saved ? (JSON.parse(saved) as BatchItem[]) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(BATCH_KEY, JSON.stringify(batchItems)); } catch { /* ignore */ }
  }, [batchItems]);

  // Movement log filters
  const [movTypeFilter, setMovTypeFilter] = useState<MovementType | "all">("all");
  const [movSearch, setMovSearch] = useState("");

  // Categories (per-shop; only active in embedded mode)
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isAddCatOpen, setIsAddCatOpen] = useState(false);

  // ── Batch CSV import (P2.4) ──
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importPreview, setImportPreview] = useState<Array<Record<string, string>>>([]);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    total: number;
    created: number;
    skipped: number;
    errors: Array<{ row: number; product_code?: string; error: string }>;
  } | null>(null);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState("");

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
            uomId: p.uom_id ?? null, uomCode: p.uom_code ?? null, uomName: p.uom_name ?? null,
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
  }, [embedded, lockedShopId]);

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
        type: m.type as MovementType, quantity: m.quantity,
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

  // FIFO lots: productId → array of lots (oldest date = index 0 after sort)
  const [fifoLots, setFifoLots] = useState<Record<number, FifoLot[]>>(
    () => ({}),
  );

  // ── Derived ─────────────────────────────────────────────────────────────────

  const movementLabels = useMemo<Record<MovementType, string>>(
    () => ({
      receive:      t("inventory.movReceive"),
      sale:         t("inventory.movSale"),
      adjustment:   t("inventory.movAdjustment"),
      internal_use: t("inventory.movInternalUse"),
      void:         t("inventory.movVoid"),
      exchange:     t("inventory.movExchange"),
    }),
    [t],
  );

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

  const filteredMovements = useMemo(
    () =>
      movements
        .filter((m) => {
          const matchType = movTypeFilter === "all" || m.type === movTypeFilter;
          const matchSearch =
            movSearch === "" ||
            m.productName.toLowerCase().includes(movSearch.toLowerCase()) ||
            (m.reference ?? "").toLowerCase().includes(movSearch.toLowerCase());
          const matchShop =
            subMerchantFilter === "all" ||
            products.find((p) => p.id === m.productId)?.subMerchantId === subMerchantFilter;
          return matchType && matchSearch && matchShop;
        })
        .sort((a, b) => b.id - a.id),
    [movements, movTypeFilter, movSearch, subMerchantFilter, products],
  );

  const intakeProduct = products.find(
    (p) => p.id === parseInt(intakeProductId),
  );

  /** Unit cost derived from the cost field, accounting for unit vs total mode */
  const intakeUnitCost = useMemo((): number | null => {
    if (!intakeCost || isNaN(parseFloat(intakeCost))) return null;
    if (intakeCostMode === "unit") return parseFloat(intakeCost);
    const qty = parseInt(intakeQty);
    if (!intakeQty || isNaN(qty) || qty <= 0) return null;
    return parseFloat(intakeCost) / qty;
  }, [intakeCost, intakeCostMode, intakeQty]);

  const previewAvgCost = useMemo((): number | null => {
    if (!intakeProduct || !intakeQty || intakeUnitCost === null) return null;
    const qty = parseInt(intakeQty);
    if (isNaN(qty) || qty <= 0) return null;
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

  const addMovement = (movement: Omit<StockMovement, "id">) =>
    setMovements((prev) => [...prev, { ...movement, id: Date.now() + Math.random() }]);

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
        uom_id: newProduct.uomId ? Number(newProduct.uomId) : null,
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
      uomId: product.uomId ?? "",
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
        uom_id: editForm.uomId ? Number(editForm.uomId) : 0,  // 0 to clear
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

  // ── Stock adjustment ────────────────────────────────────────────────────────

  const openAdjustDialog = (product: Product) => {
    setAdjustTarget(product);
    setAdjustQty("");
    setAdjustReason("");
    setAdjustCost("");
  };

  const handleAdjustStock = async () => {
    if (!adjustTarget) return;
    const delta = parseInt(adjustQty);
    if (isNaN(delta) || delta === 0) {
      toast.error(t("inventory.errorNonZeroQty"));
      return;
    }
    if (!adjustReason) {
      toast.error(t("inventory.errorSelectReason"));
      return;
    }
    try {
      await api.post(`/shops/${adjustTarget.subMerchantId}/adjust`, {
        product_id: adjustTarget.id,
        delta,
        reason: adjustReason,
        cost_per_unit: adjustCost ? parseFloat(adjustCost) : undefined,
      });
      const sign = delta > 0 ? "+" : "";
      toast.success(`${adjustTarget.name}: ${sign}${delta}`);
      setAdjustTarget(null);
      await fetchProducts();
      await fetchMovements();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to adjust stock");
    }
  };

  // ── Reverse adjustment ─────────────────────────────────────────────────────

  const handleReverseMovement = async () => {
    if (!reverseTarget) return;
    const sid =
      embedded
        ? lockedShopId
        : products.find((p) => p.id === reverseTarget.productId)?.subMerchantId;
    if (!sid) {
      toast.error(t("inventory.errorReverseFailed", "Cannot determine shop for this movement"));
      return;
    }
    setReverseSubmitting(true);
    try {
      await api.post(
        `/shops/${sid}/movements/${reverseTarget.id}/reverse`,
        {},
      );
      toast.success(
        t("inventory.reverseSuccess", {
          id: reverseTarget.id,
          defaultValue: "Reversed adjustment #{{id}}",
        }),
      );
      setReverseTarget(null);
      await fetchProducts();
      await fetchMovements();
    } catch (err: any) {
      toast.error(
        err?.detail ?? t("inventory.errorReverseFailed", "Reverse failed"),
      );
    } finally {
      setReverseSubmitting(false);
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
    if (parseInt(intakeQty) <= 0 || intakeUnitCost < 0) {
      toast.error(t("inventory.errorIntakeValidation"));
      return;
    }
    setBatchItems((prev) => [
      ...prev,
      {
        uid: `${Date.now()}-${Math.random()}`,
        productId: intakeProductId,
        qty: intakeQty,
        cost: intakeUnitCost.toString(),
        po: intakePO,
        invoice: intakeInvoice,
        note: intakeNote,
      },
    ]);
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

  /** Confirm and process all items in batch queue via API */
  const handleConfirmAll = async () => {
    if (batchItems.length === 0) {
      toast.error(t("inventory.errorBatchEmpty"));
      return;
    }
    // Group batch items by shop
    const itemsByShop: Record<string, { product_id: number; qty: number; cost_per_unit: number; po?: string; invoice?: string; note?: string }[]> = {};
    for (const item of batchItems) {
      const product = products.find((p) => p.id === parseInt(item.productId));
      if (!product) continue;
      const sid = product.subMerchantId;
      if (!itemsByShop[sid]) itemsByShop[sid] = [];
      itemsByShop[sid].push({
        product_id: product.id,
        qty: parseInt(item.qty),
        cost_per_unit: parseFloat(item.cost),
        po: item.po || undefined,
        invoice: item.invoice || undefined,
        note: item.note || undefined,
      });
    }
    try {
      for (const [sid, items] of Object.entries(itemsByShop)) {
        await api.post(`/shops/${sid}/receive`, { items });
      }
      toast.success(t("inventory.confirmAll", { count: batchItems.length }).replace("{{count}}", String(batchItems.length)));
      setBatchItems([]);
      await fetchProducts();
      await fetchMovements();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to receive stock");
    }
  };

  // ── Category handlers ────────────────────────────────────────────────────────

  const handleAddCategory = async () => {
    if (!catForm.trim() || !lockedShopId) { toast.error(t("inventory.fillCategoryName")); return; }
    try {
      await api.post(`/shops/${lockedShopId}/categories`, { name: catForm.trim() });
      toast.success(t("inventory.categoryAdded"));
      setIsAddCatOpen(false);
      setCatForm("");
      await fetchCategories();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to add category");
    }
  };

  const handleEditCategory = async () => {
    if (!editCat || !catForm.trim() || !lockedShopId) { toast.error(t("inventory.fillCategoryName")); return; }
    try {
      await api.patch(`/shops/${lockedShopId}/categories/${editCat.id}`, { name: catForm.trim() });
      toast.success(t("inventory.categoryUpdated"));
      setEditCat(null);
      setCatForm("");
      await fetchCategories();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to update category");
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCat || !lockedShopId) return;
    try {
      await api.delete(`/shops/${lockedShopId}/categories/${deleteCat.id}`);
      toast.success(t("inventory.categoryDeleted"));
      setDeleteCat(null);
      await fetchCategories();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to delete category");
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

  // ── CSV parsing (simple — handles commas, quoted cells, CR/LF) ──
  const parseCsv = (text: string): Array<Record<string, string>> => {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const parseRow = (row: string): string[] => {
      const cells: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (inQuotes) {
          if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') inQuotes = false;
          else cur += ch;
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ",") { cells.push(cur.trim()); cur = ""; }
          else cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    };
    const header = parseRow(lines[0]).map((h) => h.toLowerCase());
    return lines.slice(1).map((line) => {
      const cells = parseRow(line);
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => { obj[h] = cells[idx] ?? ""; });
      return obj;
    });
  };

  const handleCsvPaste = (text: string) => {
    setCsvText(text);
    setImportResult(null);
    if (!text.trim()) {
      setImportPreview([]);
      setImportParseError(null);
      return;
    }
    try {
      const rows = parseCsv(text);
      setImportPreview(rows);
      setImportParseError(rows.length === 0 ? t("inventory.import.noDataAfterHeader", "No data found after the header row") : null);
    } catch (e) {
      setImportParseError(`Parse failed: ${e}`);
      setImportPreview([]);
    }
  };

  const handleCsvFileUpload = async (file: File) => {
    const text = await file.text();
    handleCsvPaste(text);
  };

  const submitImport = async () => {
    const targetShop = lockedShopId ?? (subMerchantFilter !== "all" ? subMerchantFilter : null);
    if (!targetShop) {
      toast.error(t("inventory.import.pickShopFirst", "Select a shop before importing"));
      return;
    }
    const required = ["product_code", "name", "external_price"];
    const first = importPreview[0] ?? {};
    const missing = required.filter((k) => !(k in first));
    if (missing.length) {
      toast.error(t("inventory.import.missingColumns", { cols: missing.join(", "), defaultValue: "Missing columns: {{cols}}" }));
      return;
    }
    const items = importPreview.map((r) => ({
      product_code: r.product_code,
      barcode: r.barcode || null,
      name: r.name,
      category: r.category || t("inventory.defaultCategory", "General"),
      external_price: parseFloat(r.external_price) || 0,
      internal_price: r.internal_price ? parseFloat(r.internal_price) : null,
      vat_percent: r.vat_percent ? parseFloat(r.vat_percent) : 7,
      avg_cost: r.avg_cost ? parseFloat(r.avg_cost) : 0,
      stock: r.stock ? parseInt(r.stock, 10) : 0,
      min_stock: r.min_stock ? parseInt(r.min_stock, 10) : 0,
    }));
    setImporting(true);
    try {
      const result = await api.post<{
        total: number;
        created: number;
        skipped: number;
        errors: Array<{ row: number; product_code?: string; error: string }>;
      }>(`/shops/${targetShop}/products/batch`, { items });
      setImportResult(result);
      if (result.created > 0) {
        toast.success(t("inventory.import.successCount", { created: result.created, total: result.total, defaultValue: "Imported {{created}} of {{total}} items" }));
        // Refresh products list
        if (embedded && lockedShopId) {
          const fresh = await api.get<any[]>(`/shops/${lockedShopId}/products`);
          // fresh update is handled by parent useEffect — just trigger re-render
          void fresh;
        }
      } else {
        toast.error(t("inventory.import.failedSeeErrors", "Import failed — see errors below"));
      }
    } catch (e: any) {
      toast.error(`Import failed: ${e?.message ?? e}`);
    } finally {
      setImporting(false);
    }
  };

  const importButton = (
    <Button variant="outline" onClick={() => {
      setIsImportOpen(true);
      setImportResult(null);
      setCsvText("");
      setImportPreview([]);
      setImportParseError(null);
    }}>
      <FileSpreadsheet className="h-4 w-4 mr-2" />
      Import CSV
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
                  ฿{totalStockValue.toLocaleString("en", { maximumFractionDigits: 0 })}
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
          <TabsTrigger value="movements" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            {t("inventory.tabMovements")}
          </TabsTrigger>
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
                {embedded && <div className="ml-auto flex gap-2">{importButton}{addProductButton}</div>}
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
                                onClick={() => openAdjustDialog(item)}
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
                  {batchItems.length > 0 && (
                    <Badge className="ml-1">{batchItems.length}</Badge>
                  )}
                </CardTitle>
                {batchItems.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setBatchItems([])}
                  >
                    {t("inventory.clearBatch")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {batchItems.length === 0 ? (
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
                      {batchItems.map((item, idx) => {
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
                                onClick={() =>
                                  setBatchItems((prev) =>
                                    prev.filter((b) => b.uid !== item.uid),
                                  )
                                }
                              >
                                <X className="h-4 w-4" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <Button className="w-full" onClick={handleConfirmAll}>
                    <ArrowDownToLine className="h-4 w-4 mr-2" />
                    {t("inventory.confirmAll", { count: batchItems.length })}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Movement Log ─────────────────────────────────────────── */}
        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder={t("inventory.searchMovements")}
                  value={movSearch}
                  onChange={(e) => setMovSearch(e.target.value)}
                  className="w-full sm:max-w-xs"
                />
                <Select
                  value={movTypeFilter}
                  onValueChange={(v) =>
                    setMovTypeFilter(v as MovementType | "all")
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("inventory.allTypes")}</SelectItem>
                    {(Object.keys(movementLabels) as MovementType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {movementLabels[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("inventory.colDate")}</TableHead>
                      <TableHead>{t("inventory.colName")}</TableHead>
                      <TableHead className="text-center">{t("inventory.colType")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colQty")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colBefore")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colAfter")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colCostUnit")}</TableHead>
                      <TableHead>{t("inventory.colReference")}</TableHead>
                      <TableHead>{t("inventory.colNote")}</TableHead>
                      <TableHead className="text-right">{t("inventory.colAction", "Action")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMovements.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="h-24 text-center text-muted-foreground"
                        >
                          {t("inventory.noMovementsFound")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMovements.map((mov) => {
                        const isReversed = mov.reversedById != null;
                        const isReversalEntry = mov.reversesId != null;
                        const canReverse =
                          mov.type === "adjustment" && !isReversed && !isReversalEntry;
                        const rowMuted = isReversed ? "opacity-60" : "";
                        return (
                        <TableRow key={mov.id} className={rowMuted}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {mov.date}
                          </TableCell>
                          <TableCell className="font-medium">
                            <div>{mov.productName}</div>
                            {(isReversed || isReversalEntry) && (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {isReversed && (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-300 bg-amber-50 text-amber-800 text-[10px] font-normal"
                                  >
                                    {t("inventory.reversedBadge", {
                                      id: mov.reversedById,
                                      defaultValue: "Reversed by #{{id}}",
                                    })}
                                  </Badge>
                                )}
                                {isReversalEntry && (
                                  <Badge
                                    variant="outline"
                                    className="border-violet-300 bg-violet-50 text-violet-800 text-[10px] font-normal"
                                  >
                                    {t("inventory.reversalOfBadge", {
                                      id: mov.reversesId,
                                      defaultValue: "Reversal of #{{id}}",
                                    })}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={MOVEMENT_VARIANTS[mov.type]}
                              className="font-normal text-xs"
                            >
                              {movementLabels[mov.type]}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={`text-right data-number font-medium ${
                              isReversed
                                ? "line-through text-muted-foreground"
                                : mov.quantity > 0
                                  ? "text-success"
                                  : "text-destructive"
                            }`}
                          >
                            {mov.quantity > 0 ? `+${mov.quantity}` : mov.quantity}
                          </TableCell>
                          <TableCell className="text-right data-number text-muted-foreground">
                            {mov.stockBefore}
                          </TableCell>
                          <TableCell className="text-right data-number">
                            {mov.stockAfter}
                          </TableCell>
                          <TableCell className="text-right data-number text-muted-foreground">
                            {mov.costPerUnit != null
                              ? `฿${mov.costPerUnit.toFixed(2)}`
                              : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {mov.reference ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {mov.department ? `${mov.department}: ` : ""}
                            {mov.note ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {canReverse ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setReverseTarget(mov)}
                              >
                                {t("inventory.reverseBtn", "Reverse")}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Categories ────────────────────────────────────────────── */}
        {embedded && (
          <TabsContent value="categories" className="space-y-4">
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
          </TabsContent>
        )}
      </Tabs>

      {/* ── Batch CSV Import Dialog (P2.4) ──────────────────────────────────── */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Import products from CSV
            </DialogTitle>
            <DialogDescription>
              Columns: <code className="text-xs">product_code, name, external_price</code> (required) +{" "}
              <code className="text-xs">barcode, category, internal_price, vat_percent, avg_cost, stock, min_stock</code> (optional)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <InfoCallout
              id="inventory.importCsv"
              variant="info"
              title={t("inventory.info.importCsv.title")}
            >
              {t("inventory.info.importCsv.body")}
            </InfoCallout>

            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleCsvFileUpload(f);
                }}
                className="max-w-xs"
              />
              <span className="text-xs text-muted-foreground">{t("inventory.import.orPasteCsv", "Or paste CSV below")}</span>
            </div>

            <Textarea
              placeholder={
                "product_code,name,category,external_price,internal_price,stock,avg_cost\n" +
                "P999,น้ำดื่ม 500ml,เครื่องดื่ม,8,7,100,4.50\n" +
                "P998,ขนมปังโฮลวีท,ขนม/อาหาร,25,22,50,15.00"
              }
              rows={7}
              value={csvText}
              onChange={(e) => handleCsvPaste(e.target.value)}
              className="font-mono text-xs"
            />

            {importParseError && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> {importParseError}
              </p>
            )}

            {importPreview.length > 0 && !importResult && (
              <div className="rounded-md border">
                <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium">
                  Preview: {importPreview.length} rows
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8">code</TableHead>
                        <TableHead className="h-8">name</TableHead>
                        <TableHead className="h-8">cat</TableHead>
                        <TableHead className="h-8 text-right">ext ฿</TableHead>
                        <TableHead className="h-8 text-right">int ฿</TableHead>
                        <TableHead className="h-8 text-right">stock</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.slice(0, 10).map((r, i) => (
                        <TableRow key={i} className="text-xs">
                          <TableCell className="font-mono">{r.product_code}</TableCell>
                          <TableCell>{r.name}</TableCell>
                          <TableCell>{r.category || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.external_price}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.internal_price || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.stock || "0"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {importPreview.length > 10 && (
                    <p className="text-xs text-muted-foreground text-center py-1">
                      ... + {importPreview.length - 10} more rows
                    </p>
                  )}
                </div>
              </div>
            )}

            {importResult && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex gap-4 text-sm font-semibold">
                  <span className="text-green-700 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Created: {importResult.created}
                  </span>
                  {importResult.skipped > 0 && (
                    <span className="text-destructive flex items-center gap-1">
                      <X className="h-4 w-4" /> Skipped: {importResult.skipped}
                    </span>
                  )}
                  <span className="text-muted-foreground">Total: {importResult.total}</span>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="max-h-32 overflow-y-auto rounded border bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8">row</TableHead>
                          <TableHead className="h-8">code</TableHead>
                          <TableHead className="h-8">error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.errors.map((e, i) => (
                          <TableRow key={i} className="text-xs">
                            <TableCell className="tabular-nums">{e.row + 1}</TableCell>
                            <TableCell className="font-mono">{e.product_code || "—"}</TableCell>
                            <TableCell className="text-destructive">{e.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportOpen(false)} disabled={importing}>
              {importResult ? "Close" : "Cancel"}
            </Button>
            {!importResult && (
              <Button
                onClick={submitImport}
                disabled={importing || importPreview.length === 0 || !!importParseError}
              >
                {importing ? t("inventory.import.importing", "Importing…") : t("inventory.import.importCount", { count: importPreview.length, defaultValue: "Import {{count}} items" })}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Product Dialog ──────────────────────────────────────────────── */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("inventory.addProductTitle")}</DialogTitle>
            <DialogDescription>{t("inventory.addProductDesc")}</DialogDescription>
          </DialogHeader>
          <ProductFormFields form={newProduct} setForm={setNewProduct} isEdit={false} shopType={shopType} embedded={embedded} categories={categories} lockedShopId={lockedShopId} uoms={uoms} />
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
          <ProductFormFields form={editForm} setForm={setEditForm} isEdit={true} shopType={shopType} embedded={embedded} categories={categories} lockedShopId={lockedShopId} uoms={uoms} />
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

      {/* ── Reverse Adjustment Confirm ──────────────────────────────────────── */}
      <AlertDialog
        open={!!reverseTarget}
        onOpenChange={(open) => !open && !reverseSubmitting && setReverseTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("inventory.reverseTitle", "Reverse adjustment")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  {t("inventory.reverseDesc", {
                    id: reverseTarget?.id,
                    product: reverseTarget?.productName,
                    defaultValue:
                      "Reverse adjustment #{{id}} for {{product}}? This creates a mirror adjustment with the opposite delta.",
                  })}
                </div>
                {reverseTarget && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div>
                      {t("inventory.reverseOriginalDelta", "Original delta")}:{" "}
                      <span
                        className={
                          reverseTarget.quantity > 0
                            ? "font-semibold text-success"
                            : "font-semibold text-destructive"
                        }
                      >
                        {reverseTarget.quantity > 0
                          ? `+${reverseTarget.quantity}`
                          : reverseTarget.quantity}
                      </span>
                    </div>
                    <div>
                      {t("inventory.reverseNewDelta", "Reversal delta")}:{" "}
                      <span
                        className={
                          -reverseTarget.quantity > 0
                            ? "font-semibold text-success"
                            : "font-semibold text-destructive"
                        }
                      >
                        {-reverseTarget.quantity > 0
                          ? `+${-reverseTarget.quantity}`
                          : -reverseTarget.quantity}
                      </span>
                    </div>
                    {reverseTarget.note && (
                      <div className="text-muted-foreground mt-1">
                        {t("inventory.colNote")}: {reverseTarget.note}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverseSubmitting}>
              {t("inventory.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReverseMovement}
              disabled={reverseSubmitting}
            >
              {reverseSubmitting
                ? t("inventory.reverseSubmitting", "Reversing…")
                : t("inventory.reverseConfirm", "Reverse")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Stock Adjust Dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={!!adjustTarget}
        onOpenChange={(open) => !open && setAdjustTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("inventory.adjustStock")}</DialogTitle>
            <DialogDescription>
              {adjustTarget?.name} — {t("inventory.previewCurrentStock")}:{" "}
              {adjustTarget?.stock}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("inventory.adjustmentQuantity")}</Label>
              {/* Quick shortcut buttons */}
              <div className="flex gap-1.5 mb-2 flex-wrap">
                {[-10, -5, -1, +1, +5, +10].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAdjustQty(String((parseInt(adjustQty) || 0) + v))}
                    className={`h-8 min-w-[2.75rem] rounded-lg border text-xs font-bold transition-colors ${
                      v < 0
                        ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                    }`}
                  >
                    {v > 0 ? `+${v}` : v}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                value={adjustQty}
                onChange={(e) => setAdjustQty(e.target.value)}
                placeholder="+10 or -5"
                autoFocus
              />
              {/* Preview new stock */}
              {adjustQty !== "" && !isNaN(parseInt(adjustQty)) && parseInt(adjustQty) !== 0 && adjustTarget && (
                <p className="text-xs mt-1">
                  <span className="text-muted-foreground">{t("inventory.previewCurrentStock")}: {adjustTarget.stock}</span>
                  {" → "}
                  <span className={`font-semibold ${adjustTarget.stock + parseInt(adjustQty) < 0 ? "text-amber-600" : "text-green-700"}`}>
                    {adjustTarget.stock + parseInt(adjustQty)}
                  </span>
                </p>
              )}
            </div>
            {shopType === "fifo" && parseInt(adjustQty) > 0 && (
              <div>
                <Label>{t("inventory.adjustCostLabel")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustCost}
                  onChange={(e) => setAdjustCost(e.target.value)}
                  placeholder={t("inventory.adjustCostPlaceholder")}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("inventory.adjustCostHint")}
                </p>
              </div>
            )}
            <div>
              <Label>{t("inventory.adjustmentReason")}</Label>
              <Select value={adjustReason} onValueChange={setAdjustReason}>
                <SelectTrigger>
                  <SelectValue placeholder={t("inventory.selectProductPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              {t("inventory.cancel")}
            </Button>
            <Button onClick={handleAdjustStock}>{t("inventory.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  uoms: UnitOfMeasure[];
}

function ProductFormFields({
  form,
  setForm,
  isEdit = false,
  shopType,
  embedded,
  categories,
  lockedShopId,
  uoms,
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
      <div className="grid grid-cols-3 gap-4">
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
        <div>
          <Label>{t("inventory.uom", "หน่วยนับ")}</Label>
          <Select
            value={form.uomId ? String(form.uomId) : "__none__"}
            onValueChange={(v) => setForm({ ...form, uomId: v === "__none__" ? "" : parseInt(v) })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("inventory.selectUom", "เลือกหน่วย")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">-</SelectItem>
              {uoms.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name} ({u.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("inventory.subMerchant")}</Label>
          <Select
            value={form.subMerchantId}
            onValueChange={(v) => !lockedShopId && setForm({ ...form, subMerchantId: v })}
            disabled={!!lockedShopId}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUB_MERCHANTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
