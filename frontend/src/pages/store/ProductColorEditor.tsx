import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";

const SWATCHES = ["#f87171", "#fb923c", "#fbbf24", "#4ade80", "#34d399", "#60a5fa", "#a78bfa", "#f472b6", "#94a3b8"];

interface ProductColorEditorProps {
    color: string | null | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    value: string;
    onValueChange: (v: string) => void;
    recentColors: string[];
    saving: boolean;
    onClear: () => void;
    onSave: () => void;
}

/** Quick-edit palette popover on a POS product card. */
export function ProductColorEditor({ color, open, onOpenChange, value, onValueChange, recentColors, saving, onClear, onSave }: ProductColorEditorProps) {
    const { t } = useTranslation();

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        "rounded p-0.5 transition",
                        color ? "hover:bg-black/10" : "hover:bg-muted",
                    )}
                    title={t("store.cardColorTitle")}
                >
                    <Palette
                        className={cn(
                            "h-3.5 w-3.5",
                            color ? "text-zinc-900" : "text-muted-foreground",
                        )}
                    />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3 space-y-3" onClick={(e) => e.stopPropagation()} side="top" align="end">
                <p className="text-xs font-semibold">{t("store.cardColorLabel")}</p>
                <div className="flex items-center gap-2">
                    <input type="color" value={value} onChange={(e) => onValueChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border p-0.5 shrink-0" />
                    <input type="text" value={value} onChange={(e) => onValueChange(e.target.value)} className="w-full rounded border border-border px-2 py-1 text-xs font-mono bg-background" placeholder="#4ade80" />
                </div>
                {recentColors.length > 0 && (
                    <div>
                        <p className="text-[10px] text-muted-foreground mb-1">{t("store.recentColors", "Recent")}</p>
                        <div className="flex gap-1.5 flex-wrap">
                            {recentColors.map((c) => (
                                <button key={c} type="button" onClick={() => onValueChange(c)}
                                    className={cn("h-6 w-6 rounded-full border-2 transition", value === c ? "border-foreground scale-110" : "border-transparent hover:scale-105")}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </div>
                )}
                <div className="flex gap-1.5 flex-wrap">
                    {SWATCHES.map((c) => (
                        <button key={c} type="button" onClick={() => onValueChange(c)}
                            className={cn("h-6 w-6 rounded-full border-2 transition", value === c ? "border-foreground scale-110" : "border-transparent hover:scale-105")}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={onClear} disabled={saving} className="flex-1 rounded-md border border-border bg-background py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition">{t("store.clearColor")}</button>
                    <button type="button" onClick={onSave} disabled={saving} className="flex-1 rounded-md bg-primary py-1.5 text-[11px] text-primary-foreground font-semibold hover:bg-primary/90 transition">{saving ? "…" : t("store.saveColor")}</button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
