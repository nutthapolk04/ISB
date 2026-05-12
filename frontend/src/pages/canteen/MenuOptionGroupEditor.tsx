import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, ApiError } from "@/lib/api";
import type {
  MenuOptionGroup,
  OptionSelectionType,
} from "./menuOptionTypes";

interface Props {
  shopId: string;
  productId: number;
}

export default function MenuOptionGroupEditor({ shopId, productId }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["option-groups", shopId, productId];

  const { data: groups = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<MenuOptionGroup[]>(
        `/shops/${shopId}/products/${productId}/option-groups`,
      ),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MenuOptionGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MenuOptionGroup | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const deleteMut = useMutation({
    mutationFn: (groupId: number) =>
      api.delete(
        `/shops/${shopId}/products/${productId}/option-groups/${groupId}`,
      ),
    onSuccess: () => {
      invalidate();
      toast.success(t("canteen.optionGroupDeleted"));
      setDeleteTarget(null);
    },
    onError: (e) => {
      toast.error(
        e instanceof ApiError ? e.detail : t("canteen.optionGroupDeleteError"),
      );
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {t("canteen.optionGroupsTitle")}
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({t("canteen.optionGroupsCount", { count: groups.length })})
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t("canteen.addOptionGroup")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t("canteen.loading")}</p>
      ) : groups.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          {t("canteen.noOptionGroups")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              onEdit={() => setEditTarget(g)}
              onDelete={() => setDeleteTarget(g)}
            />
          ))}
        </div>
      )}

      <GroupFormDialog
        shopId={shopId}
        productId={productId}
        open={addOpen}
        target={null}
        onOpenChange={setAddOpen}
        onSaved={() => {
          invalidate();
          setAddOpen(false);
        }}
      />
      <GroupFormDialog
        shopId={shopId}
        productId={productId}
        target={editTarget}
        onOpenChange={(v) => !v && setEditTarget(null)}
        onSaved={() => {
          invalidate();
          setEditTarget(null);
        }}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("canteen.deleteOptionGroupConfirm", {
                name: deleteTarget?.name ?? "",
              })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupRow({
  group,
  onEdit,
  onDelete,
}: {
  group: MenuOptionGroup;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const typeLabel: Record<OptionSelectionType, string> = {
    single: t("canteen.selectionSingle"),
    multi: t("canteen.selectionMulti"),
    quantity: t("canteen.selectionQuantity"),
  };

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          className="text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "collapse" : "expand"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{group.name}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {typeLabel[group.selection_type]}
            </Badge>
            {group.is_required && (
              <Badge variant="secondary" className="text-[10px]">
                {t("canteen.isRequired")}
              </Badge>
            )}
            <span>·</span>
            <span>{group.options.length} {t("canteen.options")}</span>
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
          {t("common.edit")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          aria-label={t("canteen.deleteOptionGroup")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {expanded && group.options.length > 0 && (
        <div className="border-t bg-background/50 px-2 py-1.5 space-y-1">
          {group.options.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between text-xs"
            >
              <span>{o.name}</span>
              <span className="font-mono text-muted-foreground">
                {o.price_delta > 0 ? `+฿${o.price_delta.toFixed(0)}` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Group Form Dialog ───────────────────────────────────────────────────────

interface OptionDraft {
  name: string;
  price_delta: string; // text for controlled input
}

interface GroupFormDialogProps {
  shopId: string;
  productId: number;
  target: MenuOptionGroup | null;
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function GroupFormDialog({
  shopId,
  productId,
  target,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: GroupFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!target;
  const open = isEdit ? !!target : !!controlledOpen;

  const [name, setName] = useState("");
  const [selectionType, setSelectionType] = useState<OptionSelectionType>("single");
  const [isRequired, setIsRequired] = useState(false);
  const [maxSelections, setMaxSelections] = useState("");
  const [options, setOptions] = useState<OptionDraft[]>([{ name: "", price_delta: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setSelectionType(target.selection_type);
      setIsRequired(target.is_required);
      setMaxSelections(
        target.max_selections != null ? String(target.max_selections) : "",
      );
      setOptions(
        target.options.length > 0
          ? target.options.map((o) => ({
              name: o.name,
              price_delta: String(o.price_delta),
            }))
          : [{ name: "", price_delta: "" }],
      );
    } else if (controlledOpen) {
      setName("");
      setSelectionType("single");
      setIsRequired(false);
      setMaxSelections("");
      setOptions([{ name: "", price_delta: "" }]);
    }
  }, [target, controlledOpen]);

  const updateOption = (idx: number, patch: Partial<OptionDraft>) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    );
  };

  const addOption = () =>
    setOptions((prev) => [...prev, { name: "", price_delta: "" }]);

  const removeOption = (idx: number) =>
    setOptions((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("canteen.groupName"));
      return;
    }
    const cleanedOptions = options
      .map((o) => ({
        name: o.name.trim(),
        price_delta: parseFloat(o.price_delta) || 0,
      }))
      .filter((o) => o.name.length > 0);
    if (cleanedOptions.length === 0) {
      toast.error(t("canteen.needOneOption"));
      return;
    }
    const body = {
      name: trimmed,
      selection_type: selectionType,
      is_required: isRequired,
      max_selections:
        maxSelections.trim() === "" ? null : parseInt(maxSelections) || null,
      sort_order: target?.sort_order ?? 0,
      options: cleanedOptions,
    };
    setSaving(true);
    try {
      if (isEdit && target) {
        await api.patch(
          `/shops/${shopId}/products/${productId}/option-groups/${target.id}`,
          body,
        );
      } else {
        await api.post(
          `/shops/${shopId}/products/${productId}/option-groups`,
          body,
        );
      }
      toast.success(t("canteen.optionGroupSaved"));
      onSaved();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.detail : t("canteen.optionGroupSaveError"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("canteen.editOptionGroup") : t("canteen.addOptionGroup")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t("canteen.groupName")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("canteen.groupNamePlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("canteen.selectionType")}</Label>
              <Select
                value={selectionType}
                onValueChange={(v) => setSelectionType(v as OptionSelectionType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">
                    {t("canteen.selectionSingle")}
                  </SelectItem>
                  <SelectItem value="multi">
                    {t("canteen.selectionMulti")}
                  </SelectItem>
                  <SelectItem value="quantity">
                    {t("canteen.selectionQuantity")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("canteen.maxSelections")}</Label>
              <Input
                type="number"
                min="1"
                value={maxSelections}
                onChange={(e) => setMaxSelections(e.target.value)}
                placeholder={t("canteen.maxUnlimited")}
                disabled={selectionType === "single"}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={isRequired} onCheckedChange={setIsRequired} />
            <Label>{t("canteen.isRequired")}</Label>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{t("canteen.options")}</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={addOption}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("canteen.addOption")}
              </Button>
            </div>
            <div className="space-y-1.5">
              {options.map((o, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={o.name}
                    onChange={(e) => updateOption(idx, { name: e.target.value })}
                    placeholder={t("canteen.optionNamePlaceholder")}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min="0"
                    value={o.price_delta}
                    onChange={(e) =>
                      updateOption(idx, { price_delta: e.target.value })
                    }
                    placeholder="0"
                    className="w-20"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeOption(idx)}
                    disabled={options.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600"
          >
            {saving ? t("canteen.saving") : t("canteen.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
