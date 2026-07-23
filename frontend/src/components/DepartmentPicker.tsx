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

export interface DepartmentPickerValue {
  id: number;
  department_code: string;
  department_name: string;
}

interface Props {
  value: DepartmentPickerValue | null;
  onChange: (value: DepartmentPickerValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Server-searched combobox over /departments/ — mirrors CardholderPicker.tsx's
 * shape/behavior for department entities, which that component explicitly
 * excludes. */
export default function DepartmentPicker({ value, onChange, placeholder, disabled, className }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [items, setItems] = useState<DepartmentPickerValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ active_only: "false" });
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    api
      .get<DepartmentPickerValue[]>(`/departments/?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setItems(data);
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

  const buttonLabel = value
    ? `${value.department_name} (${value.department_code})`
    : (placeholder ?? t("departmentPicker.select", "Search department…"));

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
            <span className={cn("truncate", !value && "text-muted-foreground")}>{buttonLabel}</span>
            <span className="flex items-center gap-1 ml-2 shrink-0">
              {value && (
                // Button's base styles set `[&_svg]:pointer-events-none` on
                // every svg, so a click here would fall through to the button
                // (opening the popover) before the svg's own handler fired.
                // Wrapping in a span (unaffected by that svg-only selector)
                // gives the clear action a real hit target.
                <span
                  className="h-4 w-4 flex items-center justify-center opacity-50 hover:opacity-100 pointer-events-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </span>
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
              placeholder={t("departmentPicker.searchPlaceholder", "Department code or name…")}
            />
            <CommandList onWheel={(e) => e.stopPropagation()}>
              {loading && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t("departmentPicker.loading", "Searching…")}
                </div>
              )}
              {!loading && <CommandEmpty>{t("departmentPicker.noResults", "No match")}</CommandEmpty>}
              <CommandGroup>
                {items.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={String(d.id)}
                    onSelect={() => {
                      onChange(d);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn("h-4 w-4 shrink-0", value?.id === d.id ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm">{d.department_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.department_code}</p>
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
