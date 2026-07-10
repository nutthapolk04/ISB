import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Search, Printer, Plus, Minus, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import JsBarcode from "jsbarcode";

export interface ExtraBarcode {
    id: number;
    barcode: string;
    label: string | null;
}

export interface Product {
    id: number;
    productCode: string;
    barcode: string;         // primary barcode
    name: string;
    externalPrice: number;
    category?: string;
    extraBarcodes?: ExtraBarcode[];
}

interface PrintItem {
    key: string;             // `${productId}-${barcodeValue}`
    product: Product;
    barcodeValue: string;
    barcodeLabel: string;    // "Primary" | label | barcode value
    quantity: number;
}

interface PrintBarcodeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    products: Product[];
    selectedProduct?: Product | null;
}

type LabelSize = "small" | "medium" | "large" | "sticker_a10";

const LABEL_SIZES: { value: LabelSize; label: string; width: string; height: string }[] = [
    { value: "small", label: "Small (30x20mm)", width: "30mm", height: "20mm" },
    { value: "medium", label: "Medium (50x30mm)", width: "50mm", height: "30mm" },
    { value: "large", label: "Large (70x40mm)", width: "70mm", height: "40mm" },
    { value: "sticker_a10", label: "Sticker Sheet A10 (25x50mm, 4x11, A4)", width: "50mm", height: "25mm" },
];

// A10 sticker sheet: A4 page, 4 columns x 11 rows, 25mm x 50mm per sticker,
// 44 stickers per sheet. Grid fits exactly inside A4 (210x297mm) with
// 5mm side margins and 11mm top/bottom margins — no gaps between cells,
// matching pre-cut commercial A10 label sheets.
const STICKER_A10 = {
    page: { width: "210mm", height: "297mm" },
    margin: { x: "5mm", y: "11mm" },
    cell: { width: "50mm", height: "25mm" },
    columns: 4,
    rows: 11,
    perSheet: 44,
};

export function PrintBarcodeDialog({
    open,
    onOpenChange,
    products,
    selectedProduct,
}: PrintBarcodeDialogProps) {
    const { t } = useTranslation();

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [printItems, setPrintItems] = useState<PrintItem[]>([]);
    const [labelSize, setLabelSize] = useState<LabelSize>("sticker_a10");
    const [showPrice, setShowPrice] = useState(true);
    const [showProductCode, setShowProductCode] = useState(true);

    // Initialize with selected product if provided
    useEffect(() => {
        if (open && selectedProduct) {
            const primary = selectedProduct.barcode || selectedProduct.productCode;
            if (primary) {
                const key = `${selectedProduct.id}-${primary}`;
                setPrintItems([{ key, product: selectedProduct, barcodeValue: primary, barcodeLabel: "Primary", quantity: 1 }]);
            }
        }
    }, [open, selectedProduct]);

    // Unique categories derived from products
    const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean) as string[])).sort();

    // Products filtered by category first, then by search term
    const categoryFiltered = selectedCategory === "all"
        ? products
        : products.filter((p) => p.category === selectedCategory);

    const filteredProducts = searchTerm.trim()
        ? categoryFiltered.filter(
            (p) =>
                p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.productCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.barcode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (p.extraBarcodes ?? []).some((b) => b.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
        ).slice(0, 10)
        : [];

    /** Returns all barcode options for a product: primary + extras */
    const getBarcodeOptions = (product: Product) => {
        const opts: { value: string; label: string }[] = [];
        const primary = product.barcode || product.productCode;
        if (primary) opts.push({ value: primary, label: "Primary" });
        for (const b of product.extraBarcodes ?? []) {
            opts.push({ value: b.barcode, label: b.label || b.barcode });
        }
        return opts;
    };

    const addBarcode = (product: Product, barcodeValue: string, barcodeLabel: string) => {
        const key = `${product.id}-${barcodeValue}`;
        const existing = printItems.find((i) => i.key === key);
        if (existing) {
            setPrintItems(printItems.map((i) => i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
        } else {
            setPrintItems([...printItems, { key, product, barcodeValue, barcodeLabel, quantity: 1 }]);
        }
        setSearchTerm("");
    };

    /** Add all barcodes of a product at once */
    const addProduct = (product: Product) => {
        const opts = getBarcodeOptions(product);
        if (opts.length === 0) {
            toast.error(t("barcode.noBarcode") || "Product has no barcode");
            return;
        }
        for (const opt of opts) addBarcode(product, opt.value, opt.label);
    };

    /** Add every product in `pool` (and every barcode they own) to the print list.
     *  Skips items already added. Pass `categoryFiltered` to bulk-add by category,
     *  or `products` for the full catalog. */
    const addAllProducts = (pool: typeof products = products) => {
        const existing = new Set(printItems.map((i) => i.key));
        const additions: PrintItem[] = [];
        for (const p of pool) {
            const opts = getBarcodeOptions(p);
            for (const opt of opts) {
                const key = `${p.id}-${opt.value}`;
                if (existing.has(key)) continue;
                existing.add(key);
                additions.push({ key, product: p, barcodeValue: opt.value, barcodeLabel: opt.label, quantity: 1 });
            }
        }
        if (additions.length === 0) {
            toast.error(t("barcode.allAlreadyAdded") || "All products are already in the list");
            return;
        }
        setPrintItems([...printItems, ...additions]);
        toast.success(
            t("barcode.addedCount", { count: additions.length, defaultValue: "Added {{count}} barcode(s)" }),
        );
    };

    const updateQuantity = (key: string, delta: number) => {
        setPrintItems(
            printItems
                .map((i) => i.key === key ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
                .filter((i) => i.quantity > 0)
        );
    };

    const removeItem = (key: string) => {
        setPrintItems(printItems.filter((i) => i.key !== key));
    };

    const handlePrint = useCallback(() => {
        if (printItems.length === 0) {
            toast.error(t("barcode.noItems") || "No items to print");
            return;
        }

        const printWindow = window.open("", "_blank");
        if (!printWindow) {
            toast.error(t("barcode.popupBlocked") || "Popup blocked. Please allow popups.");
            return;
        }

        const isSticker = labelSize === "sticker_a10";
        const sizeConfig = LABEL_SIZES.find((s) => s.value === labelSize) || LABEL_SIZES[3];
        const fontSize = {
            small: { name: "6pt", code: "5pt", price: "6pt" },
            medium: { name: "8pt", code: "7pt", price: "8pt" },
            large: { name: "10pt", code: "9pt", price: "10pt" },
            sticker_a10: { name: "6.5pt", code: "5.5pt", price: "6.5pt" },
        }[labelSize];

        // Content shared by every layout mode — barcode canvas + text stack.
        // Sticker mode uses a slightly wider barcode (cell is 50x25mm landscape)
        // and skips the dashed border / free-flow margin used by the loose-label modes.
        const labelInner = (item: PrintItem, canvas: HTMLCanvasElement) => `
      <div style="font-size: ${fontSize.name}; font-weight: bold; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${item.product.name}
      </div>
      ${item.barcodeLabel !== "Primary" ? `<div style="font-size: ${fontSize.code}; color: #666; text-align: center;">${item.barcodeLabel}</div>` : ""}
      <img src="${canvas.toDataURL("image/png")}" style="max-width: 90%; height: auto;" />
      <div style="font-size: ${fontSize.code}; font-family: monospace;">${item.barcodeValue}</div>
      ${showPrice ? `<div style="font-size: ${fontSize.price}; font-weight: bold;">฿${item.product.externalPrice.toLocaleString()}</div>` : ""}
      ${showProductCode ? `<div style="font-size: ${fontSize.code}; color: #666;">${item.product.productCode}</div>` : ""}
    `;

        const cells: string[] = [];
        printItems.forEach((item) => {
            for (let i = 0; i < item.quantity; i++) {
                const canvas = document.createElement("canvas");
                try {
                    JsBarcode(canvas, item.barcodeValue, {
                        format: "CODE128",
                        width: labelSize === "small" ? 1 : labelSize === "medium" ? 1.5 : isSticker ? 1.2 : 2,
                        height: labelSize === "small" ? 30 : labelSize === "medium" ? 40 : isSticker ? 25 : 50,
                        displayValue: false,
                        margin: 2,
                    });
                    cells.push(labelInner(item, canvas));
                } catch (e) {
                    console.error("Failed to generate barcode:", item.barcodeValue, e);
                }
            }
        });

        let bodyHtml: string;
        let pageStyle: string;

        if (isSticker) {
            // Chunk into sheets of 44 (4 cols x 11 rows) so each sheet lands
            // exactly on a pre-cut A10 sticker page — no gaps, no dashed borders.
            const sheets: string[][] = [];
            for (let i = 0; i < cells.length; i += STICKER_A10.perSheet) {
                sheets.push(cells.slice(i, i + STICKER_A10.perSheet));
            }
            bodyHtml = sheets
                .map(
                    (sheetCells, idx) => `
        <div class="sheet" style="
          width: ${STICKER_A10.page.width};
          height: ${STICKER_A10.page.height};
          padding: ${STICKER_A10.margin.y} ${STICKER_A10.margin.x};
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(${STICKER_A10.columns}, ${STICKER_A10.cell.width});
          grid-template-rows: repeat(${STICKER_A10.rows}, ${STICKER_A10.cell.height});
          ${idx < sheets.length - 1 ? "page-break-after: always;" : ""}
        ">
          ${sheetCells
                            .map(
                                (inner) => `
            <div class="cell" style="
              width: ${STICKER_A10.cell.width};
              height: ${STICKER_A10.cell.height};
              padding: 1mm 2mm;
              box-sizing: border-box;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            ">${inner}</div>
          `,
                            )
                            .join("")}
        </div>
      `,
                )
                .join("");
            pageStyle = `@page { size: A4; margin: 0; } body { margin: 0; }`;
        } else {
            bodyHtml = cells
                .map(
                    (inner) => `
        <div class="label" style="
          width: ${sizeConfig.width};
          height: ${sizeConfig.height};
          padding: 2mm;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          page-break-inside: avoid;
          border: 1px dashed #ccc;
          margin: 1mm;
        ">${inner}</div>
      `,
                )
                .join("");
            pageStyle = `@media print { @page { margin: 5mm; } body { margin: 0; } } body { display: flex; flex-wrap: wrap; justify-content: flex-start; align-content: flex-start; }`;
        }

        printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Barcodes</title>
        <style>
          body { font-family: Arial, sans-serif; }
          ${pageStyle}
        </style>
      </head>
      <body>
        ${bodyHtml}
        <script>window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; };<\/script>
      </body>
      </html>
    `);
        printWindow.document.close();
        toast.success(t("barcode.printStarted") || "Print dialog opened");
    }, [printItems, labelSize, showPrice, showProductCode, t]);

    const totalLabels = printItems.reduce((sum, i) => sum + i.quantity, 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="h-5 w-5" />
                        {t("barcode.title") || "Print Barcodes"}
                    </DialogTitle>
                    <DialogDescription>
                        {t("barcode.description") || "Select products and configure label settings for printing."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Category + Search */}
                    <div className="relative">
                        <Label>{t("barcode.searchProducts") || "Search Products"}</Label>
                        <div className="flex gap-2 mt-1.5">
                            {categories.length > 0 && (
                                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                                    <SelectTrigger className="w-44 shrink-0">
                                        <SelectValue placeholder="All categories" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All categories</SelectItem>
                                        {categories.map((cat) => (
                                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder={t("barcode.searchPlaceholder") || "Search by name, code, or barcode..."}
                                    className="pl-10"
                                />
                            </div>
                        </div>
                        {filteredProducts.length > 0 && (
                            <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-56 overflow-y-auto">
                                {filteredProducts.map((p) => {
                                    const opts = getBarcodeOptions(p);
                                    return (
                                        <div key={p.id} className="border-b last:border-b-0">
                                            {/* Product header — click adds ALL barcodes */}
                                            <div
                                                className="flex items-center justify-between p-2 hover:bg-muted cursor-pointer"
                                                onClick={() => addProduct(p)}
                                            >
                                                <div>
                                                    <div className="font-medium text-sm">{p.name}</div>
                                                    <div className="text-xs text-muted-foreground">{p.productCode}</div>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {opts.length > 1 && (
                                                        <span className="text-xs text-muted-foreground">{opts.length} barcodes</span>
                                                    )}
                                                    <Plus className="h-4 w-4 text-primary" />
                                                </div>
                                            </div>
                                            {/* Individual barcode rows when product has extras */}
                                            {opts.length > 1 && opts.map((opt) => (
                                                <div
                                                    key={opt.value}
                                                    className="flex items-center justify-between px-4 py-1 hover:bg-muted/60 cursor-pointer text-xs"
                                                    onClick={(e) => { e.stopPropagation(); addBarcode(p, opt.value, opt.label); }}
                                                >
                                                    <span className="font-mono text-muted-foreground">{opt.value}</span>
                                                    <span className="text-muted-foreground">{opt.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Bulk actions */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            {selectedCategory === "all" ? (
                                <Button variant="outline" size="sm" onClick={() => addAllProducts(products)} disabled={products.length === 0}>
                                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                                    {t("barcode.addAll", { count: products.length, defaultValue: "Add all ({{count}})" })}
                                </Button>
                            ) : (
                                <Button variant="outline" size="sm" onClick={() => addAllProducts(categoryFiltered)} disabled={categoryFiltered.length === 0}>
                                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                                    Add all in "{selectedCategory}" ({categoryFiltered.length})
                                </Button>
                            )}
                        </div>
                        {printItems.length > 0 && (
                            <Button variant="ghost" size="sm" onClick={() => setPrintItems([])}>
                                <X className="h-3.5 w-3.5 mr-1.5" />
                                {t("barcode.clearAll", "Clear all")}
                            </Button>
                        )}
                    </div>

                    {/* Selected items */}
                    {printItems.length > 0 && (
                        <div>
                            <Label className="mb-2 block">{t("barcode.selectedItems") || "Selected Items"}</Label>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("barcode.product") || "Product"}</TableHead>
                                        <TableHead className="w-24">Barcode</TableHead>
                                        <TableHead className="text-center w-32">{t("barcode.copies") || "Copies"}</TableHead>
                                        <TableHead className="w-12"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {printItems.map((item) => (
                                        <TableRow key={item.key}>
                                            <TableCell>
                                                <div className="font-medium text-sm">{item.product.name}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{item.barcodeValue}</div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{item.barcodeLabel}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center justify-center gap-1">
                                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.key, -1)}>
                                                        <Minus className="h-3 w-3" />
                                                    </Button>
                                                    <span className="w-8 text-center font-mono">{item.quantity}</span>
                                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.key, 1)}>
                                                        <Plus className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(item.key)}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <div className="text-sm text-muted-foreground mt-2 text-right">
                                {t("barcode.totalLabels") || "Total labels"}: <span className="font-semibold">{totalLabels}</span>
                            </div>
                        </div>
                    )}

                    {/* Label settings */}
                    <div className="grid grid-cols-2 gap-4 border-t pt-4">
                        <div>
                            <Label>{t("barcode.labelSize") || "Label Size"}</Label>
                            <Select value={labelSize} onValueChange={(v) => setLabelSize(v as LabelSize)}>
                                <SelectTrigger className="mt-1.5">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {LABEL_SIZES.map((size) => (
                                        <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-3 pt-6">
                            <div className="flex items-center gap-2">
                                <Checkbox id="showPrice" checked={showPrice} onCheckedChange={(c) => setShowPrice(c as boolean)} />
                                <label htmlFor="showPrice" className="text-sm">{t("barcode.showPrice") || "Show price on label"}</label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Checkbox id="showProductCode" checked={showProductCode} onCheckedChange={(c) => setShowProductCode(c as boolean)} />
                                <label htmlFor="showProductCode" className="text-sm">{t("barcode.showProductCode") || "Show product code"}</label>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel") || "Cancel"}</Button>
                    <Button onClick={handlePrint} disabled={printItems.length === 0}>
                        <Printer className="h-4 w-4 mr-2" />
                        {t("barcode.print") || "Print"} ({totalLabels})
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
