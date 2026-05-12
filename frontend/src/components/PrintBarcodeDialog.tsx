import { useState, useRef, useCallback, useEffect } from "react";
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
import { toast } from "sonner";
import JsBarcode from "jsbarcode";

interface Product {
  id: number;
  productCode: string;
  barcode: string;
  name: string;
  externalPrice: number;
}

interface PrintItem {
  product: Product;
  quantity: number;
}

interface PrintBarcodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  selectedProduct?: Product | null;
}

type LabelSize = "small" | "medium" | "large";

const LABEL_SIZES: { value: LabelSize; label: string; width: string; height: string }[] = [
  { value: "small", label: "Small (30x20mm)", width: "30mm", height: "20mm" },
  { value: "medium", label: "Medium (50x30mm)", width: "50mm", height: "30mm" },
  { value: "large", label: "Large (70x40mm)", width: "70mm", height: "40mm" },
];

export function PrintBarcodeDialog({
  open,
  onOpenChange,
  products,
  selectedProduct,
}: PrintBarcodeDialogProps) {
  const { t } = useTranslation();
  const printRef = useRef<HTMLDivElement>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [printItems, setPrintItems] = useState<PrintItem[]>([]);
  const [labelSize, setLabelSize] = useState<LabelSize>("medium");
  const [showPrice, setShowPrice] = useState(true);
  const [showProductCode, setShowProductCode] = useState(true);

  // Initialize with selected product if provided
  useEffect(() => {
    if (open && selectedProduct) {
      const barcodeToUse = selectedProduct.barcode || selectedProduct.productCode;
      if (barcodeToUse) {
        setPrintItems([{ product: selectedProduct, quantity: 1 }]);
      }
    }
  }, [open, selectedProduct]);

  // Filter products by search
  const filteredProducts = searchTerm.trim()
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.productCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.barcode?.toLowerCase().includes(searchTerm.toLowerCase())
      ).slice(0, 10)
    : [];

  const addProduct = (product: Product) => {
    const barcodeToUse = product.barcode || product.productCode;
    if (!barcodeToUse) {
      toast.error(t("barcode.noBarcode") || "Product has no barcode");
      return;
    }

    const existing = printItems.find((i) => i.product.id === product.id);
    if (existing) {
      setPrintItems(
        printItems.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      );
    } else {
      setPrintItems([...printItems, { product, quantity: 1 }]);
    }
    setSearchTerm("");
  };

  const updateQuantity = (productId: number, delta: number) => {
    setPrintItems(
      printItems
        .map((i) =>
          i.product.id === productId
            ? { ...i, quantity: Math.max(0, i.quantity + delta) }
            : i
        )
        .filter((i) => i.quantity > 0)
    );
  };

  const removeItem = (productId: number) => {
    setPrintItems(printItems.filter((i) => i.product.id !== productId));
  };

  const handlePrint = useCallback(() => {
    if (printItems.length === 0) {
      toast.error(t("barcode.noItems") || "No items to print");
      return;
    }

    // Generate barcodes
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error(t("barcode.popupBlocked") || "Popup blocked. Please allow popups.");
      return;
    }

    const sizeConfig = LABEL_SIZES.find((s) => s.value === labelSize) || LABEL_SIZES[1];

    // Build HTML for print
    let labelsHtml = "";
    printItems.forEach((item) => {
      const barcodeValue = item.product.barcode || item.product.productCode;
      for (let i = 0; i < item.quantity; i++) {
        const canvas = document.createElement("canvas");
        try {
          JsBarcode(canvas, barcodeValue, {
            format: "CODE128",
            width: labelSize === "small" ? 1 : labelSize === "medium" ? 1.5 : 2,
            height: labelSize === "small" ? 30 : labelSize === "medium" ? 40 : 50,
            displayValue: false,
            margin: 2,
          });
          const barcodeImg = canvas.toDataURL("image/png");

          labelsHtml += `
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
            ">
              <div style="font-size: ${labelSize === "small" ? "6pt" : labelSize === "medium" ? "8pt" : "10pt"}; font-weight: bold; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${item.product.name}
              </div>
              <img src="${barcodeImg}" style="max-width: 90%; height: auto;" />
              <div style="font-size: ${labelSize === "small" ? "5pt" : labelSize === "medium" ? "7pt" : "9pt"}; font-family: monospace;">
                ${barcodeValue}
              </div>
              ${showPrice ? `<div style="font-size: ${labelSize === "small" ? "6pt" : labelSize === "medium" ? "8pt" : "10pt"}; font-weight: bold;">฿${item.product.externalPrice.toLocaleString()}</div>` : ""}
              ${showProductCode && item.product.barcode ? `<div style="font-size: ${labelSize === "small" ? "5pt" : "6pt"}; color: #666;">${item.product.productCode}</div>` : ""}
            </div>
          `;
        } catch (e) {
          console.error("Failed to generate barcode for:", barcodeValue, e);
        }
      }
    });

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Barcodes</title>
        <style>
          @media print {
            @page { margin: 5mm; }
            body { margin: 0; }
          }
          body {
            font-family: Arial, sans-serif;
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-start;
            align-content: flex-start;
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
        <script>
          window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
          };
        </script>
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
          {/* Search products */}
          <div className="relative">
            <Label>{t("barcode.searchProducts") || "Search Products"}</Label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t("barcode.searchPlaceholder") || "Search by name, code, or barcode..."}
                className="pl-10"
              />
            </div>
            {filteredProducts.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {filteredProducts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 hover:bg-muted cursor-pointer border-b last:border-b-0"
                    onClick={() => addProduct(p)}
                  >
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {p.productCode} {p.barcode && `· ${p.barcode}`}
                      </div>
                    </div>
                    <Plus className="h-4 w-4 text-primary" />
                  </div>
                ))}
              </div>
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
                    <TableHead className="text-center w-32">{t("barcode.copies") || "Copies"}</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {printItems.map((item) => (
                    <TableRow key={item.product.id}>
                      <TableCell>
                        <div className="font-medium">{item.product.name}</div>
                        <div className="text-sm text-muted-foreground font-mono">
                          {item.product.barcode || item.product.productCode}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.product.id, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-mono">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.product.id, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => removeItem(item.product.id)}
                        >
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
                    <SelectItem key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3 pt-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="showPrice"
                  checked={showPrice}
                  onCheckedChange={(c) => setShowPrice(c as boolean)}
                />
                <label htmlFor="showPrice" className="text-sm">
                  {t("barcode.showPrice") || "Show price on label"}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="showProductCode"
                  checked={showProductCode}
                  onCheckedChange={(c) => setShowProductCode(c as boolean)}
                />
                <label htmlFor="showProductCode" className="text-sm">
                  {t("barcode.showProductCode") || "Show product code"}
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel") || "Cancel"}
          </Button>
          <Button onClick={handlePrint} disabled={printItems.length === 0}>
            <Printer className="h-4 w-4 mr-2" />
            {t("barcode.print") || "Print"} ({totalLabels})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
