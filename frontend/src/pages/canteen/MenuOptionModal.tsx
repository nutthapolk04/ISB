import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { CanteenProduct } from "@/hooks/useCanteenCart";
import type {
  MenuOptionGroup,
  SelectedOptionGroup,
} from "./menuOptionTypes";

interface Props {
  shopId: string;
  /** Product being customised. `null` closes the modal. */
  product: CanteenProduct | null;
  /** Base price to preview (already respects price mode). */
  basePrice: number;
  onClose: () => void;
  onConfirm: (groups: SelectedOptionGroup[]) => void;
}

type GroupId = number;
type OptionId = number;

type SelectionState = Record<GroupId, Record<OptionId, number>>;

export default function MenuOptionModal({
  shopId,
  product,
  basePrice,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useTranslation();

  const { data: groups = [] } = useQuery({
    queryKey: ["option-groups", shopId, product?.id],
    queryFn: () =>
      api.get<MenuOptionGroup[]>(
        `/shops/${shopId}/products/${product!.id}/option-groups`,
      ),
    enabled: !!product,
  });

  const [selection, setSelection] = useState<SelectionState>({});

  // Reset selection each time a new product opens.
  useEffect(() => {
    setSelection({});
  }, [product?.id]);

  const pickSingle = (groupId: number, optionId: number) => {
    setSelection((prev) => ({ ...prev, [groupId]: { [optionId]: 1 } }));
  };
  const toggleMulti = (groupId: number, optionId: number, max?: number | null) => {
    setSelection((prev) => {
      const current = prev[groupId] ?? {};
      const isOn = (current[optionId] ?? 0) > 0;
      if (isOn) {
        const { [optionId]: _, ...rest } = current;
        return { ...prev, [groupId]: rest };
      }
      if (max != null && Object.values(current).filter((v) => v > 0).length >= max) {
        toast.error(t("canteen.exceedsMax", { max }));
        return prev;
      }
      return { ...prev, [groupId]: { ...current, [optionId]: 1 } };
    });
  };
  const bumpQty = (
    groupId: number,
    optionId: number,
    delta: number,
    max?: number | null,
  ) => {
    setSelection((prev) => {
      const current = prev[groupId] ?? {};
      const next = Math.max(0, (current[optionId] ?? 0) + delta);
      const entries = { ...current, [optionId]: next };
      if (next === 0) delete entries[optionId];
      const totalPicks = Object.values(entries).reduce((s, v) => s + v, 0);
      if (max != null && totalPicks > max) {
        toast.error(t("canteen.exceedsMax", { max }));
        return prev;
      }
      return { ...prev, [groupId]: entries };
    });
  };

  const { valid, firstError, optionsTotal, selectedGroups } = useMemo(() => {
    let err: string | null = null;
    let sum = 0;
    const out: SelectedOptionGroup[] = [];

    for (const g of groups) {
      const picks = selection[g.id] ?? {};
      const picked = g.options
        .map((o) => ({ o, qty: picks[o.id] ?? 0 }))
        .filter(({ qty }) => qty > 0);
      const pickCount =
        g.selection_type === "quantity"
          ? picked.reduce((s, p) => s + p.qty, 0)
          : picked.length;
      if (g.is_required && pickCount < 1) {
        err = err ?? `${t("canteen.pleaseSelect")}: ${g.name}`;
      }
      if (picked.length > 0) {
        out.push({
          groupId: g.id,
          groupName: g.name,
          selectionType: g.selection_type,
          options: picked.map(({ o, qty }) => ({
            id: o.id,
            name: o.name,
            priceDelta: o.price_delta,
            quantity: qty,
          })),
        });
        sum += picked.reduce((s, p) => s + p.o.price_delta * p.qty, 0);
      }
    }
    return {
      valid: err === null,
      firstError: err,
      optionsTotal: sum,
      selectedGroups: out,
    };
  }, [groups, selection, t]);

  const confirm = () => {
    if (!valid) {
      if (firstError) toast.error(firstError);
      return;
    }
    onConfirm(selectedGroups);
  };

  const open = !!product;
  const linePreview = (basePrice + optionsTotal).toFixed(2);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("canteen.customizeOrder")}
            {product && <span className="ml-1.5 text-base font-normal text-muted-foreground">— {product.name}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t("canteen.noOptionGroups")}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-semibold">{g.name}</Label>
                {g.is_required && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t("canteen.isRequired")}
                  </Badge>
                )}
                {g.max_selections != null && g.selection_type !== "single" && (
                  <Badge variant="outline" className="text-[10px]">
                    ≤ {g.max_selections}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5">
                {g.options.map((o) => {
                  const qty = (selection[g.id] ?? {})[o.id] ?? 0;
                  const checked = qty > 0;
                  const label = (
                    <span className="flex-1 flex items-center justify-between">
                      <span className="text-sm">{o.name}</span>
                      {o.price_delta > 0 && (
                        <span className="text-xs text-muted-foreground font-mono">
                          +฿{o.price_delta.toFixed(0)}
                        </span>
                      )}
                    </span>
                  );
                  if (g.selection_type === "single") {
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => pickSingle(g.id, o.id)}
                        className={`flex w-full items-center gap-2 rounded-md border p-2 text-left transition ${
                          checked
                            ? "border-amber-400 bg-amber-50"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <span
                          className={`h-4 w-4 rounded-full border-2 ${
                            checked
                              ? "border-amber-500 bg-amber-500"
                              : "border-muted-foreground"
                          }`}
                        />
                        {label}
                      </button>
                    );
                  }
                  if (g.selection_type === "multi") {
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() =>
                          toggleMulti(g.id, o.id, g.max_selections)
                        }
                        className={`flex w-full items-center gap-2 rounded-md border p-2 text-left transition ${
                          checked
                            ? "border-amber-400 bg-amber-50"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <span
                          className={`h-4 w-4 rounded border-2 ${
                            checked
                              ? "border-amber-500 bg-amber-500"
                              : "border-muted-foreground"
                          }`}
                        />
                        {label}
                      </button>
                    );
                  }
                  // quantity
                  return (
                    <div
                      key={o.id}
                      className="flex w-full items-center gap-2 rounded-md border border-border p-2"
                    >
                      {label}
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() =>
                            bumpQty(g.id, o.id, -1, g.max_selections)
                          }
                          disabled={qty === 0}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-5 text-center text-sm tabular-nums">
                          {qty}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() =>
                            bumpQty(g.id, o.id, 1, g.max_selections)
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>{t("canteen.subtotalBase")}</span>
              <span className="tabular-nums">฿{basePrice.toFixed(2)}</span>
            </div>
            {optionsTotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>{t("canteen.subtotalOptions")}</span>
                <span className="tabular-nums">+฿{optionsTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 font-semibold">
              <span>{t("canteen.lineTotal")}</span>
              <span className="tabular-nums text-amber-700">
                ฿{linePreview}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={confirm}
            disabled={!valid}
            className="bg-amber-500 hover:bg-amber-600"
          >
            {t("canteen.addToCart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
