/**
 * PricePanelManager — reusable price-panel management UI.
 * Used in both Store (ShopDetail) and Canteen (CanteenShopDetail).
 */
import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown, ChevronUp, GripVertical, Loader2, Pencil, Plus, Search, Tag, Trash2, X,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  arrayMove, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PricePanel {
  id: number;
  shop_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
}

// ── Sortable panel card wrapper ───────────────────────────────────────────────
function SortablePanelCard({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="relative group">
        <button
          {...attributes} {...listeners}
          type="button"
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

interface PricePanelItem {
  kind?: "product" | "bundle";
  product_id: number;
  bundle_id?: number | null;
  product_code: string;
  product_name: string;
  external_price: number;
  panel_price: number | null;
  short_name: string | null;
  included: boolean;
  is_bundle?: boolean;
}

interface BaseProduct {
  id: number;
  product_code: string;
  name: string;
  external_price: number;
  short_name: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PANEL_COLORS = [
  { value: "blue",   label: "Blue",   class: "bg-blue-500" },
  { value: "green",  label: "Green",  class: "bg-green-500" },
  { value: "orange", label: "Orange", class: "bg-orange-500" },
  { value: "red",    label: "Red",    class: "bg-red-500" },
  { value: "purple", label: "Purple", class: "bg-purple-500" },
  { value: "gray",   label: "Gray",   class: "bg-gray-500" },
];

const panelColorBadgeClass: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-700 border-blue-300",
  green:  "bg-green-100 text-green-700 border-green-300",
  orange: "bg-orange-100 text-orange-700 border-orange-300",
  red:    "bg-red-100 text-red-700 border-red-300",
  purple: "bg-purple-100 text-purple-700 border-purple-300",
  gray:   "bg-gray-100 text-gray-700 border-gray-300",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  shopId: string;
  /** If true, auto-loads panels on mount (default: false — load on tab click). */
  autoLoad?: boolean;
}

export function PricePanelManager({ shopId, autoLoad = false }: Props) {
  const { t } = useTranslation();

  // ── DnD sensors ────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── State ──────────────────────────────────────────────────────────────────
  const [loaded, setLoaded] = useState(false);
  const [panels, setPanels] = useState<PricePanel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [expandedPanelId, setExpandedPanelId] = useState<number | null>(null);
  const [panelItems, setPanelItems] = useState<Record<number, PricePanelItem[]>>({});
  const [panelItemsLoading, setPanelItemsLoading] = useState<Record<number, boolean>>({});
  const [panelLoadError, setPanelLoadError] = useState<Record<number, string | null>>({});
  const [panelFilter, setPanelFilter] = useState<Record<number, string>>({});
  const [cellDrafts, setCellDrafts] = useState<Record<number, Record<number, string>>>({});
  const [shortNameDrafts, setShortNameDrafts] = useState<Record<number, Record<number, string>>>({});

  // New panel dialog
  const [newPanelDialogOpen, setNewPanelDialogOpen] = useState(false);
  const [newPanelName, setNewPanelName] = useState("");
  const [newPanelColor, setNewPanelColor] = useState("");
  const [newPanelSaving, setNewPanelSaving] = useState(false);

  // Edit panel dialog
  const [editPanelDialogOpen, setEditPanelDialogOpen] = useState(false);
  const [editPanelTarget, setEditPanelTarget] = useState<PricePanel | null>(null);
  const [editPanelName, setEditPanelName] = useState("");
  const [editPanelColor, setEditPanelColor] = useState("");
  const [editPanelSaving, setEditPanelSaving] = useState(false);

  // Base pseudo-panel
  const [baseExpanded, setBaseExpanded] = useState(false);
  const [deletePanelTarget, setDeletePanelTarget] = useState<PricePanel | null>(null);
  const [baseProducts, setBaseProducts] = useState<BaseProduct[]>([]);
  const [baseProductsLoading, setBaseProductsLoading] = useState(false);
  const [baseShortNameDrafts, setBaseShortNameDrafts] = useState<Record<number, string>>({});

  // ── Data fetchers ──────────────────────────────────────────────────────────

  const fetchPanels = useCallback(async () => {
    setPanelsLoading(true);
    try {
      const data = await api.get<PricePanel[]>(`/shops/${shopId}/price-panels`);
      setPanels(data);
      setLoaded(true);
    } catch {
      toast.error("Failed to load price panels");
    } finally {
      setPanelsLoading(false);
    }
  }, [shopId]);

  // Auto-load on first render if requested
  useState(() => { if (autoLoad) fetchPanels(); });

  const fetchPanelItems = useCallback(async (panelId: number) => {
    setPanelItemsLoading((p) => ({ ...p, [panelId]: true }));
    setPanelLoadError((p) => ({ ...p, [panelId]: null }));
    try {
      const data = await api.get<PricePanelItem[]>(
        `/shops/${shopId}/price-panels/${panelId}/items`,
      );
      setPanelItems((p) => ({ ...p, [panelId]: data }));
      const priceDrafts: Record<number, string> = {};
      const snDrafts: Record<number, string> = {};
      data.forEach((item) => {
        priceDrafts[item.product_id] = item.panel_price != null ? String(item.panel_price) : "";
        snDrafts[item.product_id] = item.short_name ?? "";
      });
      setCellDrafts((p) => ({ ...p, [panelId]: priceDrafts }));
      setShortNameDrafts((p) => ({ ...p, [panelId]: snDrafts }));
    } catch (err: any) {
      const msg = err?.detail ?? err?.message ?? "Failed to load panel items";
      setPanelLoadError((p) => ({ ...p, [panelId]: String(msg) }));
      toast.error(`Failed to load panel items: ${msg}`);
    } finally {
      setPanelItemsLoading((p) => ({ ...p, [panelId]: false }));
    }
  }, [shopId]);

  const fetchBaseProducts = useCallback(async () => {
    setBaseProductsLoading(true);
    try {
      const data = await api.get<BaseProduct[]>(`/shops/${shopId}/products`);
      setBaseProducts(data);
      const drafts: Record<number, string> = {};
      data.forEach((p: BaseProduct) => { drafts[p.id] = p.short_name ?? ""; });
      setBaseShortNameDrafts(drafts);
    } catch {
      toast.error("Failed to load base products");
    } finally {
      setBaseProductsLoading(false);
    }
  }, [shopId]);

  // ── CRUD handlers ──────────────────────────────────────────────────────────

  const itemPatchPath = (panelId: number, rowKey: number) => {
    const row = (panelItems[panelId] ?? []).find((i) => i.product_id === rowKey);
    if (row?.is_bundle) {
      return `/shops/${shopId}/price-panels/${panelId}/bundle-items/${row.bundle_id ?? rowKey}`;
    }
    return `/shops/${shopId}/price-panels/${panelId}/items/${rowKey}`;
  };

  const handleCreatePanel = async () => {
    if (!newPanelName.trim()) return;
    setNewPanelSaving(true);
    try {
      await api.post(`/shops/${shopId}/price-panels`, {
        name: newPanelName.trim(),
        color: newPanelColor || null,
      });
      toast.success("Price panel created");
      setNewPanelDialogOpen(false);
      setNewPanelName("");
      setNewPanelColor("");
      await fetchPanels();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to create panel");
    } finally {
      setNewPanelSaving(false);
    }
  };

  const handleEditPanel = async () => {
    if (!editPanelTarget) return;
    setEditPanelSaving(true);
    try {
      await api.patch(`/shops/${shopId}/price-panels/${editPanelTarget.id}`, {
        name: editPanelName.trim() || undefined,
        color: editPanelColor || undefined,
      });
      toast.success("Panel updated");
      setEditPanelDialogOpen(false);
      setEditPanelTarget(null);
      await fetchPanels();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to update panel");
    } finally {
      setEditPanelSaving(false);
    }
  };

  const handleDeletePanel = (panel: PricePanel) => {
    setDeletePanelTarget(panel);
  };

  const handleConfirmDeletePanel = async () => {
    if (!deletePanelTarget) return;
    try {
      await api.delete(`/shops/${shopId}/price-panels/${deletePanelTarget.id}`);
      toast.success("Panel deleted");
      if (expandedPanelId === deletePanelTarget.id) setExpandedPanelId(null);
      await fetchPanels();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to delete panel");
    } finally {
      setDeletePanelTarget(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = panels.findIndex((p) => p.id === active.id);
    const newIdx = panels.findIndex((p) => p.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(panels, oldIdx, newIdx);
    setPanels(reordered);
    // Persist new sort_order for each panel
    await Promise.all(
      reordered.map((panel, idx) =>
        api.patch(`/shops/${shopId}/price-panels/${panel.id}`, { sort_order: idx + 1 }).catch(() => {}),
      ),
    );
  };

  const handleTogglePanel = (panelId: number) => {
    if (expandedPanelId === panelId) {
      setExpandedPanelId(null);
    } else {
      setExpandedPanelId(panelId);
      if (!panelItems[panelId]) fetchPanelItems(panelId);
    }
  };

  const handleCellBlur = async (panelId: number, productId: number) => {
    const raw = cellDrafts[panelId]?.[productId] ?? "";
    const trimmed = raw.trim();
    const price = trimmed === "" ? null : parseFloat(trimmed);
    if (trimmed !== "" && (isNaN(price!) || price! < 0)) return;
    try {
      await api.patch(itemPatchPath(panelId, productId), { price });
      setPanelItems((p) => ({
        ...p,
        [panelId]: (p[panelId] ?? []).map((item) =>
          item.product_id === productId ? { ...item, panel_price: price } : item,
        ),
      }));
    } catch {
      toast.error("Failed to save price");
    }
  };

  const handleShortNameBlur = async (panelId: number, productId: number) => {
    const val = shortNameDrafts[panelId]?.[productId] ?? "";
    try {
      await api.patch(itemPatchPath(panelId, productId), { short_name: val.trim() || null });
      setPanelItems((p) => ({
        ...p,
        [panelId]: (p[panelId] ?? []).map((item) =>
          item.product_id === productId ? { ...item, short_name: val.trim() || null } : item,
        ),
      }));
    } catch {
      toast.error("Failed to save short name");
    }
  };

  const handleInclusionToggle = async (panelId: number, productId: number, currentIncluded: boolean) => {
    const newVal = !currentIncluded;
    try {
      await api.patch(itemPatchPath(panelId, productId), { included: newVal });
      setPanelItems((p) => ({
        ...p,
        [panelId]: (p[panelId] ?? []).map((item) =>
          item.product_id === productId ? { ...item, included: newVal } : item,
        ),
      }));
    } catch (err: any) {
      toast.error(String(err?.detail ?? err?.message ?? "Failed to update inclusion"));
    }
  };

  const handleBaseShortNameBlur = async (productId: number) => {
    const val = baseShortNameDrafts[productId] ?? "";
    try {
      await api.patch(`/shops/${shopId}/products/${productId}`, { short_name: val.trim() || null });
      setBaseProducts((p) =>
        p.map((prod) => prod.id === productId ? { ...prod, short_name: val.trim() || null } : prod),
      );
    } catch {
      toast.error("Failed to save short name");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loaded && !panelsLoading) {
    return (
      <div className="py-12 text-center space-y-3">
        <Tag className="h-8 w-8 mx-auto text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">Price panels not loaded yet.</p>
        <Button size="sm" onClick={fetchPanels}>Load Panels</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Named price tiers for this shop. Each panel overrides prices per product.
        </p>
        <Button size="sm" onClick={() => setNewPanelDialogOpen(true)}>
          + New Panel
        </Button>
      </div>

      {panelsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : panels.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No price panels yet. Click "New Panel" to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Base price pseudo-panel */}
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !baseExpanded;
                      setBaseExpanded(next);
                      if (next && baseProducts.length === 0) fetchBaseProducts();
                    }}
                    className="flex items-center gap-2 font-semibold text-sm hover:text-primary transition-colors"
                  >
                    {baseExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Base Price
                  </button>
                  <Badge variant="outline" className="text-xs text-muted-foreground">Base</Badge>
                </div>
              </div>
              {baseExpanded && (
                <div className="border-t">
                  {baseProductsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : baseProducts.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-6">No products in this shop.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28">Code</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="w-36">Short Name</TableHead>
                          <TableHead className="w-32 text-right">Base Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {baseProducts.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{p.product_code}</TableCell>
                            <TableCell className="text-sm font-medium">{p.name}</TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                placeholder="—"
                                value={baseShortNameDrafts[p.id] ?? ""}
                                onChange={(e) =>
                                  setBaseShortNameDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                onBlur={() => handleBaseShortNameBlur(p.id)}
                                className="h-7 w-32 text-xs"
                              />
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                              ฿{p.external_price.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Custom panels — draggable to reorder */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={panels.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {panels.map((panel) => (
            <SortablePanelCard key={panel.id} id={panel.id}>
            <Card>
              <CardContent className="p-0">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleTogglePanel(panel.id)}
                      className="flex items-center gap-2 font-semibold text-sm hover:text-primary transition-colors"
                    >
                      {expandedPanelId === panel.id
                        ? <ChevronUp className="h-4 w-4" />
                        : <ChevronDown className="h-4 w-4" />}
                      {panel.name}
                    </button>
                    {panel.color && (
                      <Badge variant="outline" className={`text-xs ${panelColorBadgeClass[panel.color] ?? ""}`}>
                        {panel.color}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="sm" className="h-7 px-2"
                      onClick={() => {
                        setEditPanelTarget(panel);
                        setEditPanelName(panel.name);
                        setEditPanelColor(panel.color ?? "");
                        setEditPanelDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => handleDeletePanel(panel)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Expanded panel items */}
                {expandedPanelId === panel.id && (
                  <div className="border-t">
                    {panelItemsLoading[panel.id] ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : panelLoadError[panel.id] ? (
                      <div className="px-4 py-6 text-center text-sm space-y-3">
                        <p className="text-destructive font-medium">{panelLoadError[panel.id]}</p>
                        <Button variant="outline" size="sm" onClick={() => fetchPanelItems(panel.id)}>
                          Retry
                        </Button>
                      </div>
                    ) : (() => {
                      const allItems = panelItems[panel.id] ?? [];
                      const included = allItems.filter((it) => it.included);
                      const excluded = allItems.filter((it) => !it.included);
                      const filterQ = (panelFilter[panel.id] ?? "").trim().toLowerCase();
                      const visible = filterQ
                        ? included.filter((it) =>
                            it.product_code.toLowerCase().includes(filterQ) ||
                            it.product_name.toLowerCase().includes(filterQ))
                        : included;
                      const catalogMatches = filterQ
                        ? excluded.filter((it) =>
                            it.product_code.toLowerCase().includes(filterQ) ||
                            it.product_name.toLowerCase().includes(filterQ))
                        : [];
                      return (
                        <>
                          <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
                            <div className="relative w-full max-w-sm">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                placeholder="Search products by code or name…"
                                value={panelFilter[panel.id] ?? ""}
                                onChange={(e) =>
                                  setPanelFilter((p) => ({ ...p, [panel.id]: e.target.value }))
                                }
                                className="h-8 pl-7 text-sm"
                              />
                            </div>
                          </div>

                          {filterQ && catalogMatches.length > 0 && (
                            <div className="border-b bg-amber-50/40">
                              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Add from catalogue ({catalogMatches.length})
                              </p>
                              <ul className="divide-y">
                                {catalogMatches.map((it) => (
                                  <li key={`add-${it.is_bundle ? "b" : "p"}-${it.product_id}`}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleInclusionToggle(panel.id, it.product_id, false);
                                        setPanelFilter((p) => ({ ...p, [panel.id]: "" }));
                                      }}
                                      className="w-full flex items-center justify-between gap-3 px-4 py-2 text-left hover:bg-amber-100/60 transition"
                                    >
                                      <span className="flex items-center gap-2 min-w-0">
                                        <Plus className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                        <span className="flex flex-col min-w-0">
                                          <span className="flex items-center gap-1.5">
                                            <span className="text-sm font-medium truncate">{it.product_name}</span>
                                            {it.is_bundle && (
                                              <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-bold text-violet-700 border border-violet-300 shrink-0">SET</span>
                                            )}
                                          </span>
                                          <span className="text-xs font-mono text-muted-foreground">{it.product_code}</span>
                                        </span>
                                      </span>
                                      <span className="text-xs tabular-nums text-muted-foreground">
                                        ฿{it.external_price.toLocaleString()}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {included.length === 0 ? (
                            <p className="text-center text-sm text-muted-foreground py-8">
                              {filterQ
                                ? (catalogMatches.length > 0
                                    ? "Click a product above to add it to this panel."
                                    : `No products match "${filterQ}".`)
                                : 'No products in this panel yet. Search above to add some.'}
                            </p>
                          ) : visible.length === 0 ? (
                            <p className="text-center text-sm text-muted-foreground py-8">
                              {catalogMatches.length > 0
                                ? "No products in this panel match — click a catalogue match above to add it."
                                : `No products match "${filterQ}".`}
                            </p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-28">Code</TableHead>
                                  <TableHead>Product</TableHead>
                                  <TableHead className="w-36">Short Name</TableHead>
                                  <TableHead className="w-32 text-right">Ext. Price</TableHead>
                                  <TableHead className="w-36 text-right">Panel Price</TableHead>
                                  <TableHead className="w-16 text-center">Remove</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {visible.map((item) => {
                                  const draftVal = cellDrafts[panel.id]?.[item.product_id] ?? "";
                                  const differs = item.panel_price != null && item.panel_price !== item.external_price;
                                  const snDraft = shortNameDrafts[panel.id]?.[item.product_id] ?? "";
                                  return (
                                    <TableRow key={`${item.is_bundle ? "b" : "p"}-${item.product_id}`}>
                                      <TableCell className="font-mono text-xs text-muted-foreground">{item.product_code}</TableCell>
                                      <TableCell className="text-sm font-medium">
                                        <span className="inline-flex items-center gap-1.5">
                                          {item.product_name}
                                          {item.is_bundle && (
                                            <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-bold text-violet-700 border border-violet-300 shrink-0">SET</span>
                                          )}
                                        </span>
                                      </TableCell>
                                      <TableCell>
                                        <Input
                                          type="text" placeholder="—" value={snDraft}
                                          onChange={(e) =>
                                            setShortNameDrafts((p) => ({
                                              ...p,
                                              [panel.id]: { ...(p[panel.id] ?? {}), [item.product_id]: e.target.value },
                                            }))
                                          }
                                          onBlur={() => handleShortNameBlur(panel.id, item.product_id)}
                                          className="h-7 w-32 text-xs"
                                        />
                                      </TableCell>
                                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                                        ฿{item.external_price.toLocaleString()}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <Input
                                          type="number" min="0" step="0.01" placeholder="—"
                                          value={draftVal}
                                          onChange={(e) =>
                                            setCellDrafts((p) => ({
                                              ...p,
                                              [panel.id]: { ...(p[panel.id] ?? {}), [item.product_id]: e.target.value },
                                            }))
                                          }
                                          onBlur={() => handleCellBlur(panel.id, item.product_id)}
                                          className={`h-7 w-28 text-right text-xs ml-auto ${differs ? "border-yellow-400 bg-yellow-50" : ""}`}
                                        />
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Button
                                          variant="ghost" size="sm"
                                          className="h-7 px-2 text-destructive hover:text-destructive"
                                          onClick={() => handleInclusionToggle(panel.id, item.product_id, true)}
                                          title="Remove from panel"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
            </SortablePanelCard>
          ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* New Panel Dialog */}
      <Dialog open={newPanelDialogOpen} onOpenChange={setNewPanelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>New Price Panel</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Panel Name *</Label>
              <Input
                value={newPanelName}
                onChange={(e) => setNewPanelName(e.target.value)}
                placeholder={t("shopDetail.panelNamePlaceholder", "e.g. Standard price")}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Color (optional)</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button" onClick={() => setNewPanelColor("")}
                  className={`rounded-full border-2 px-3 py-1 text-xs transition ${newPanelColor === "" ? "border-foreground font-semibold" : "border-transparent bg-muted"}`}
                >None</button>
                {PANEL_COLORS.map((c) => (
                  <button
                    key={c.value} type="button" onClick={() => setNewPanelColor(c.value)}
                    className={`rounded-full border-2 px-3 py-1 text-xs text-white transition ${c.class} ${newPanelColor === c.value ? "border-foreground scale-105" : "border-transparent opacity-80 hover:opacity-100"}`}
                  >{c.label}</button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPanelDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreatePanel} disabled={newPanelSaving || !newPanelName.trim()}>
              {newPanelSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Panel Dialog */}
      <Dialog open={editPanelDialogOpen} onOpenChange={setEditPanelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit Panel</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Panel Name</Label>
              <Input value={editPanelName} onChange={(e) => setEditPanelName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button" onClick={() => setEditPanelColor("")}
                  className={`rounded-full border-2 px-3 py-1 text-xs transition ${editPanelColor === "" ? "border-foreground font-semibold" : "border-transparent bg-muted"}`}
                >None</button>
                {PANEL_COLORS.map((c) => (
                  <button
                    key={c.value} type="button" onClick={() => setEditPanelColor(c.value)}
                    className={`rounded-full border-2 px-3 py-1 text-xs text-white transition ${c.class} ${editPanelColor === c.value ? "border-foreground scale-105" : "border-transparent opacity-80 hover:opacity-100"}`}
                  >{c.label}</button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPanelDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditPanel} disabled={editPanelSaving}>
              {editPanelSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePanelTarget} onOpenChange={(open) => !open && setDeletePanelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete price panel?</AlertDialogTitle>
            <AlertDialogDescription>
              Panel <strong>"{deletePanelTarget?.name}"</strong> and all its price overrides will be permanently deleted.
              Products will revert to their base price. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDeletePanel}
            >
              Delete panel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
