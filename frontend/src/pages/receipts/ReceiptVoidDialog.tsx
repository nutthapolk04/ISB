import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import type { ReceiptApi, ModuleScope } from "./receiptTypes";

interface ReceiptVoidDialogProps {
  receipt: ReceiptApi | null;
  onOpenChange: (open: boolean) => void;
  onVoided: (updated: ReceiptApi) => void;
  moduleScope: ModuleScope;
  pickedCanteenShop: string;
  pickedStoreShop: string;
}

export function ReceiptVoidDialog({
  receipt, onOpenChange, onVoided, moduleScope, pickedCanteenShop, pickedStoreShop,
}: ReceiptVoidDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);
  // Per-shop custom reason shortcuts. Cashier sees them, manager/admin edit.
  const [customShortcuts, setCustomShortcuts] = useState<string[]>([]);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [newShortcutText, setNewShortcutText] = useState("");

  // Reset local state whenever a new receipt is targeted (or the dialog closes).
  useEffect(() => {
    setVoidReason("");
  }, [receipt]);

  // Effective shop for shortcut management: own shopId > picked filter shop
  const effectiveShortcutShopId = user?.shopId
    ?? (moduleScope === "canteen" && pickedCanteenShop !== "all" ? pickedCanteenShop : null)
    ?? (moduleScope === "store" && pickedStoreShop !== "all" ? pickedStoreShop : null);

  const canEditShortcuts =
    !!effectiveShortcutShopId && (user?.role === "manager" || user?.role === "admin");

  useEffect(() => {
    if (!effectiveShortcutShopId) {
      setCustomShortcuts([]);
      return;
    }
    api.get<{ void_shortcuts?: string[] }>(`/shops/${effectiveShortcutShopId}`)
      .then((s) => setCustomShortcuts(Array.isArray(s.void_shortcuts) ? s.void_shortcuts : []))
      .catch(() => setCustomShortcuts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveShortcutShopId]);

  const saveCustomShortcuts = async (next: string[]) => {
    if (!effectiveShortcutShopId) return;
    const prev = customShortcuts;
    setCustomShortcuts(next);
    try {
      const res = await api.put<{ void_shortcuts?: string[] }>(
        `/shops/${effectiveShortcutShopId}/void-shortcuts`,
        { shortcuts: next },
      );
      if (Array.isArray(res.void_shortcuts)) setCustomShortcuts(res.void_shortcuts);
    } catch (e) {
      setCustomShortcuts(prev);
      toast.error(
        e instanceof ApiError
          ? e.detail
          : t("receipts.voidDialog.shortcutSaveFailed", "Could not save shortcut"),
      );
    }
  };

  const addCustomShortcut = async () => {
    const text = newShortcutText.trim();
    setShortcutDialogOpen(false);
    setNewShortcutText("");
    if (!text || customShortcuts.includes(text)) return;
    await saveCustomShortcuts([...customShortcuts, text]);
  };

  const removeCustomShortcut = async (text: string) => {
    await saveCustomShortcuts(customShortcuts.filter((s) => s !== text));
  };

  const handleVoidConfirm = async () => {
    if (!receipt) return;
    const targetId = receipt.id;
    const targetNumber = receipt.receipt_number;
    setVoidLoading(true);
    try {
      const updated = await api.post<ReceiptApi>(`/pos/void/${targetId}`, {
        reason: voidReason.trim() || null,
      });
      onVoided(updated);
      toast.success(t("receipts.voidDialog.successToast", { number: targetNumber }));
      onOpenChange(false);
    } catch (e) {
      // If backend says the receipt is ALREADY voided, treat it as success:
      // an earlier request did succeed at the DB level but the response
      // never made it back (e.g. transient 500 during the postgres-js bug).
      // Refetch the row so the UI reflects the real voided state.
      const isAlreadyVoided =
        e instanceof ApiError &&
        typeof e.detail === "string" &&
        /already.*voided/i.test(e.detail);
      if (isAlreadyVoided) {
        try {
          const refreshed = await api.get<ReceiptApi>(`/pos/receipt/${targetId}`);
          onVoided(refreshed);
        } catch {
          // If refetch also fails, fall back to a soft local mark so the
          // cashier doesn't keep re-trying. They can hard-refresh later.
          onVoided({ ...receipt, status: "voided" });
        }
        toast.success(t("receipts.voidDialog.successToast", { number: targetNumber }));
        onOpenChange(false);
      } else {
        toast.error(e instanceof ApiError ? e.detail : t("receipts.voidDialog.failToast"));
      }
    } finally {
      setVoidLoading(false);
    }
  };

  return (
    <>
      <Dialog open={!!receipt} onOpenChange={(v) => { if (!v && !voidLoading) onOpenChange(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              {t("receipts.voidDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {receipt?.receipt_number} · ฿{receipt?.total.toLocaleString()}
              {" "}— {t("receipts.voidDialog.walletRefundNote")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">{t("receipts.voidDialog.reasonLabel")}</label>
              {/* Preset reason chips + per-shop custom chips */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {([
                  "incorrect_transaction",
                  "customer_changed_mind",
                  "out_of_stock",
                  "incorrect_price",
                  "duplicate_payment",
                  "test_transaction",
                ] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={voidLoading}
                    onClick={() => setVoidReason(t(`receipts.voidDialog.reasons.${key}`))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      voidReason === t(`receipts.voidDialog.reasons.${key}`)
                        ? "border-destructive bg-destructive/10 text-destructive font-semibold"
                        : "border-border bg-muted/50 text-muted-foreground hover:border-destructive/50 hover:text-foreground",
                    )}
                  >
                    {t(`receipts.voidDialog.reasons.${key}`)}
                  </button>
                ))}
                {customShortcuts.map((text) => (
                  <span key={text} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={voidLoading}
                      onClick={() => setVoidReason(text)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition",
                        voidReason === text
                          ? "border-destructive bg-destructive/10 text-destructive font-semibold"
                          : "border-border bg-muted/50 text-muted-foreground hover:border-destructive/50 hover:text-foreground",
                      )}
                    >
                      {text}
                    </button>
                    {canEditShortcuts && (
                      <button
                        type="button"
                        disabled={voidLoading}
                        aria-label={t("receipts.voidDialog.removeShortcut", "Remove shortcut")}
                        onClick={() => removeCustomShortcut(text)}
                        className="rounded-full border border-border bg-muted/50 px-1.5 py-1 text-xs text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {canEditShortcuts && customShortcuts.length < 24 && (
                  <button
                    type="button"
                    disabled={voidLoading}
                    onClick={() => setShortcutDialogOpen(true)}
                    className="rounded-full border border-dashed border-orange-400 px-3 py-1 text-xs text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                  >
                    + {t("receipts.voidDialog.addShortcut", "Add")}
                  </button>
                )}
              </div>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={t("receipts.voidDialog.reasonPlaceholder")}
                rows={2}
                className="mt-2 resize-none"
                disabled={voidLoading}
              />
            </div>
            {!voidReason.trim() && (
              <p className="text-xs text-destructive font-medium">
                {t("receipts.voidDialog.reasonRequired")}
              </p>
            )}
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {t("receipts.voidDialog.irreversible")}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={voidLoading}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleVoidConfirm}
              disabled={voidLoading || !voidReason.trim()}
            >
              {voidLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("receipts.voidDialog.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add custom shortcut dialog */}
      <Dialog
        open={shortcutDialogOpen}
        onOpenChange={(v) => {
          setShortcutDialogOpen(v);
          if (!v) setNewShortcutText("");
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("receipts.voidDialog.addShortcutTitle", "Add reason shortcut")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "receipts.voidDialog.addShortcutDesc",
                "Manager-only. Shared with all cashiers in this shop.",
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newShortcutText}
            onChange={(e) => setNewShortcutText(e.target.value)}
            placeholder={t("receipts.voidDialog.shortcutPlaceholder", "e.g. Wrong department")}
            maxLength={60}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newShortcutText.trim()) addCustomShortcut();
            }}
          />
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShortcutDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="flex-1"
              onClick={addCustomShortcut}
              disabled={!newShortcutText.trim()}
            >
              {t("common.save", "Save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
