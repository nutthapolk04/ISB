import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface CardholderPickerItem {
  entity_type: "user" | "customer" | "department";
  entity_id: number;
  name: string;
  identifier: string;
  family_code: string | null;
  external_id: string | null;
  role: string | null;
}

export interface CardholderPickerValue {
  entity_type: "user" | "customer";
  entity_id: number;
}

interface Props {
  value: CardholderPickerValue | null;
  onChange: (value: CardholderPickerValue | null, item: CardholderPickerItem | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Server-searched combobox over /admin/cardholders — the one endpoint that
 * searches family_code, full_name, external_id, and student_code at once
 * across both students (customers) and parents/staff (users). Excludes
 * departments since callers here filter wallet top-ups, which never belong
 * to a department wallet.
 */
export default function CardholderPicker({ value, onChange, placeholder, disabled, className }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [items, setItems] = useState<CardholderPickerItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<CardholderPickerItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ kind: "all", exclude_kind: "department", page: "1", page_size: "25" });
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    api
      .get<{ items: CardholderPickerItem[] }>(`/admin/cardholders?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : "Failed to search");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch]);

  // The picker only holds ids, not the full item — resolve a label for the
  // current value once, so the button shows a name even before reopening.
  useEffect(() => {
    if (!value) {
      setSelectedItem(null);
      return;
    }
    const match = items.find((i) => i.entity_type === value.entity_type && i.entity_id === value.entity_id);
    if (match) setSelectedItem(match);
  }, [value, items]);

  const buttonLabel = selectedItem
    ? `${selectedItem.name} (${selectedItem.identifier})`
    : (placeholder ?? t("cardholderPicker.select", "Search name, family code, external ID…"));

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen} modal={true}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selectedItem && "text-muted-foreground")}>{buttonLabel}</span>
            <span className="flex items-center gap-1 ml-2 shrink-0">
              {selectedItem && (
                <X
                  className="h-4 w-4 opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItem(null);
                    onChange(null, null);
                  }}
                />
              )}
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={t("cardholderPicker.searchPlaceholder", "Name, family code, external ID, student code…")}
            />
            <CommandList onWheel={(e) => e.stopPropagation()}>
              {loading && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t("cardholderPicker.loading", "Searching…")}
                </div>
              )}
              {!loading && <CommandEmpty>{t("cardholderPicker.noResults", "No match")}</CommandEmpty>}
              <CommandGroup>
                {items.map((i) => (
                  <CommandItem
                    key={`${i.entity_type}-${i.entity_id}`}
                    value={`${i.entity_type}-${i.entity_id}`}
                    onSelect={() => {
                      setSelectedItem(i);
                      onChange({ entity_type: i.entity_type as "user" | "customer", entity_id: i.entity_id }, i);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        value && value.entity_type === i.entity_type && value.entity_id === i.entity_id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm">{i.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {i.identifier}
                        {i.family_code ? ` · FC:${i.family_code}` : ""}
                        {i.external_id ? ` · ${i.external_id}` : ""}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
