import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { MovementType, Product, StockMovement } from "./inventoryTypes";

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

interface MovementLogProps {
  movements: StockMovement[];
  products: Product[];
  subMerchantFilter: string;
  embedded: boolean;
  lockedShopId?: string;
  onReversed: () => void;
}

export function MovementLog({ movements, products, subMerchantFilter, embedded, lockedShopId, onReversed }: MovementLogProps) {
  const { t } = useTranslation();

  const [movTypeFilter, setMovTypeFilter] = useState<MovementType | "all">("all");
  const [movSearch, setMovSearch] = useState("");
  const [reverseTarget, setReverseTarget] = useState<StockMovement | null>(null);
  const [reverseSubmitting, setReverseSubmitting] = useState(false);

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
        .sort((a, b) => a.id - b.id),
    [movements, movTypeFilter, movSearch, subMerchantFilter, products],
  );

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
      onReversed();
    } catch (err: any) {
      toast.error(
        err?.detail ?? t("inventory.errorReverseFailed", "Reverse failed"),
      );
    } finally {
      setReverseSubmitting(false);
    }
  };

  return (
    <>
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
    </>
  );
}
