import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Barcode } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

export interface ExtraBarcode {
  id: number;
  barcode: string;
  label: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  productId: number;
  productName: string;
  primaryBarcode: string;
}

export function ManageBarcodesDialog({ open, onOpenChange, shopId, productId, productName, primaryBarcode }: Props) {
  const [barcodes, setBarcodes] = useState<ExtraBarcode[]>([]);
  const [loading, setLoading] = useState(false);
  const [newBarcode, setNewBarcode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExtraBarcode | null>(null);

  const fetchBarcodes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ExtraBarcode[]>(`/shops/${shopId}/products/${productId}/barcodes`);
      setBarcodes(data);
    } catch {
      toast.error("Failed to load barcodes");
    } finally {
      setLoading(false);
    }
  }, [shopId, productId]);

  useEffect(() => {
    if (open) {
      fetchBarcodes();
      setNewBarcode("");
      setNewLabel("");
    }
  }, [open, fetchBarcodes]);

  const handleAdd = async () => {
    if (!newBarcode.trim()) return;
    setSaving(true);
    try {
      const b = await api.post<ExtraBarcode>(`/shops/${shopId}/products/${productId}/barcodes`, {
        barcode: newBarcode.trim(),
        label: newLabel.trim() || null,
      });
      setBarcodes((prev) => [...prev, b]);
      setNewBarcode("");
      setNewLabel("");
      toast.success("Barcode added");
    } catch (err: any) {
      const msg = err?.detail || err?.message || "Failed to add barcode";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/shops/${shopId}/products/${productId}/barcodes/${deleteTarget.id}`);
      setBarcodes((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      toast.success("Barcode removed");
    } catch {
      toast.error("Failed to remove barcode");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode className="h-4 w-4" />
            Manage Barcodes
          </DialogTitle>
          <DialogDescription>{productName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Primary barcode (read-only) */}
          <div>
            <Label className="text-xs text-muted-foreground">Primary barcode</Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-sm bg-muted px-2 py-1 rounded font-mono flex-1">{primaryBarcode || "—"}</code>
              <Badge variant="secondary" className="text-xs">Primary</Badge>
            </div>
          </div>

          {/* Extra barcodes list */}
          <div>
            <Label className="text-xs text-muted-foreground">Additional barcodes</Label>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : barcodes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No additional barcodes yet.</p>
            ) : (
              <div className="mt-1 space-y-1">
                {barcodes.map((b) => (
                  <div key={b.id} className="flex items-center justify-between border rounded px-2 py-1.5">
                    <div>
                      <code className="text-sm font-mono">{b.barcode}</code>
                      {b.label && <span className="text-xs text-muted-foreground ml-2">{b.label}</span>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(b)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add new barcode */}
          <div className="border-t pt-3 space-y-2">
            <Label className="text-xs text-muted-foreground">Add barcode</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Barcode value"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="font-mono text-sm"
              />
              <Input
                placeholder="Label (e.g. Vendor A)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="text-sm"
              />
              <Button onClick={handleAdd} disabled={!newBarcode.trim() || saving} size="icon">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove barcode?</AlertDialogTitle>
          <AlertDialogDescription>
            Barcode <code className="font-mono">{deleteTarget?.barcode}</code> will be permanently removed from <strong>{productName}</strong>.
            Scanners using this barcode will no longer find this product.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleConfirmDelete}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
