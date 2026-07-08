import type { RefObject, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanBarcode, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "./storeTypes";

interface ProductSearchDropdownProps {
    dropdownRef: RefObject<HTMLDivElement>;
    searchInputRef: RefObject<HTMLInputElement>;
    searchTerm: string;
    onSearchTermChange: (v: string) => void;
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    onFocus: () => void;
    dropdownOpen: boolean;
    highlightedIndex: number;
    onHighlight: (i: number) => void;
    suggestions: Product[];
    onCommit: (p: Product) => void;
    priceMode: "retail" | "internal";
    getPrice: (p: Product) => number;
}

/** POS search box + barcode/name suggestion dropdown. */
export function ProductSearchDropdown({
    dropdownRef,
    searchInputRef,
    searchTerm,
    onSearchTermChange,
    onKeyDown,
    onFocus,
    dropdownOpen,
    highlightedIndex,
    onHighlight,
    suggestions,
    onCommit,
    priceMode,
    getPrice,
}: ProductSearchDropdownProps) {
    const { t } = useTranslation();

    return (
        <div ref={dropdownRef} className="relative flex-1 min-w-48">
            <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-500 pointer-events-none z-10" />
            <Input
                ref={searchInputRef}
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={onFocus}
                placeholder={t("store.searchPlaceholder")}
                className="pl-9 font-mono text-sm h-11 text-amber-500 placeholder:text-amber-400/70"
                autoComplete="off"
            />

            {dropdownOpen && suggestions.length > 0 && (
                <div
                    role="listbox"
                    className="absolute top-full left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
                >
                    {suggestions.map((p, i) => (
                        <div
                            key={p.id}
                            role="option"
                            aria-selected={i === highlightedIndex}
                            onMouseEnter={() => onHighlight(i)}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onCommit(p);
                            }}
                            className={cn(
                                "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
                                i === highlightedIndex
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-accent/50",
                            )}
                        >
                            {p.photoUrl ? (
                                <img
                                    src={p.photoUrl}
                                    alt=""
                                    className="h-10 w-10 rounded-md object-cover border shrink-0"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="h-10 w-10 rounded-md bg-muted border flex items-center justify-center shrink-0">
                                    <Package className="h-5 w-5 text-muted-foreground/60" />
                                </div>
                            )}
                            <div className="flex flex-col min-w-0 flex-1">
                                <span className="font-medium text-sm truncate">{p.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">{p.barcode}</span>
                            </div>
                            <div className="text-right ml-2 shrink-0">
                                <p className="font-bold text-primary text-sm tabular-nums">
                                    ฿{(priceMode === "internal"
                                        ? p.internalPrice ?? p.price
                                        : getPrice(p)
                                    ).toLocaleString()}
                                </p>
                                <Badge variant="outline" className="text-xs">{p.category}</Badge>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {dropdownOpen && searchTerm.trim() && suggestions.length === 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-lg">
                    {t("store.productNotFound")}
                </div>
            )}
        </div>
    );
}
