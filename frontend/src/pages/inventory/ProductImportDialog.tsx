import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import { toast } from "@/components/ui/sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoCallout } from "@/components/InfoCallout";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";

interface ProductImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetShopId: string | null;
  embedded: boolean;
  lockedShopId?: string;
}

export function ProductImportDialog({ open, onOpenChange, targetShopId, embedded, lockedShopId }: ProductImportDialogProps) {
  const { t } = useTranslation();
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

  const resetState = () => {
    setImportResult(null);
    setCsvText("");
    setImportPreview([]);
    setImportParseError(null);
  };

  // Reset form state every time the dialog opens (mirrors the toolbar
  // button's inline reset in the original single-file version).
  useEffect(() => {
    if (open) resetState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    if (!targetShopId) {
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
      }>(`/shops/${targetShopId}/products/batch`, { items });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
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
  );
}
