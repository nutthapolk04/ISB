import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";

export interface ShopOption {
    id: string;
    name: string;
}

interface Props {
    value: string | null;
    onChange: (shopId: string | null, shop: ShopOption | null) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    /** Show "— No shop —" sentinel option at the top. Default true. */
    allowNone?: boolean;
}

const NONE_SENTINEL = "__none__";

export default function ShopPicker({
    value,
    onChange,
    placeholder,
    disabled,
    className,
    allowNone = true,
}: Props) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [shops, setShops] = useState<ShopOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        api
            .get<ShopOption[]>("/shops/?active_only=true")
            .then((rows) => {
                if (!cancelled) setShops(rows);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof ApiError ? err.detail : "Failed to load shops");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const selected = useMemo(() => shops.find((s) => s.id === value) ?? null, [shops, value]);

    const noneLabel = t("shopPicker.noShop", "— All —");
    const buttonLabel = selected
        ? selected.name
        : value === null && allowNone
            ? noneLabel
            : (placeholder ?? t("shopPicker.selectShop", "Select shop…"));

    return (
        <div className={className}>
            <Popover open={open} onOpenChange={setOpen} modal={true}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        disabled={disabled || loading}
                        className="w-full justify-between font-normal"
                    >
                        <span className={cn("truncate", !selected && "text-muted-foreground")}>{buttonLabel}</span>
                        <span className="flex items-center gap-1 ml-2 shrink-0">
                            {selected && (
                                <X
                                    className="h-4 w-4 opacity-50 hover:opacity-100"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onChange(null, null);
                                    }}
                                />
                            )}
                            <ChevronsUpDown className="h-4 w-4 opacity-50" />
                        </span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command
                        filter={(haystack, search) => {
                            if (haystack === NONE_SENTINEL) {
                                return noneLabel.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                            }
                            const s = shops.find((x) => x.id === haystack);
                            if (!s) return 0;
                            const blob = `${s.name} ${s.id}`.toLowerCase();
                            return blob.includes(search.toLowerCase()) ? 1 : 0;
                        }}
                    >
                        <CommandInput placeholder={t("shopPicker.searchPlaceholder", "Search shop…")} />
                        <CommandList onWheel={(e) => e.stopPropagation()}>
                            <CommandEmpty>{t("shopPicker.noResults", "No shop matched")}</CommandEmpty>
                            {allowNone && (
                                <CommandItem
                                    value={NONE_SENTINEL}
                                    onSelect={() => {
                                        onChange(null, null);
                                        setOpen(false);
                                    }}
                                    className="flex items-center gap-2"
                                >
                                    <Check
                                        className={cn("h-4 w-4 shrink-0", value === null ? "opacity-100" : "opacity-0")}
                                    />
                                    <span className="text-sm text-muted-foreground italic">{noneLabel}</span>
                                </CommandItem>
                            )}
                            {shops.map((s) => (
                                <CommandItem
                                    key={s.id}
                                    value={s.id}
                                    onSelect={() => {
                                        onChange(s.id, s);
                                        setOpen(false);
                                    }}
                                    className="flex items-center gap-2"
                                >
                                    <Check
                                        className={cn("h-4 w-4 shrink-0", value === s.id ? "opacity-100" : "opacity-0")}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="truncate text-sm">{s.name}</p>
                                        <p className="truncate text-xs text-muted-foreground">{s.id}</p>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
    );
}
