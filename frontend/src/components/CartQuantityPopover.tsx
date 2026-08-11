import { useState, type ReactNode } from "react";
import { Delete } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

const NUMPAD_ROWS = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
];

/** Longest quantity a cashier could plausibly type by hand at a POS. */
const MAX_DIGITS = 4;

interface CartQuantityPopoverProps {
    quantity: number;
    onConfirm: (qty: number) => void;
    /** The clickable trigger — normally the qty number already shown in the row. */
    children: ReactNode;
}

/**
 * On-screen numpad anchored to a cart row's quantity, for setting an exact
 * value in one shot instead of tapping the ±1 buttons repeatedly. Opens right
 * where the cashier tapped rather than as a centered dialog, and reuses a
 * physical numpad's layout since that's faster to hit on a POS touchscreen
 * than a text field that pops the OS keyboard.
 */
export function CartQuantityPopover({ quantity, onConfirm, children }: CartQuantityPopoverProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(String(quantity));

    const handleOpenChange = (next: boolean) => {
        if (next) setValue(String(quantity));
        setOpen(next);
    };

    const pressDigit = (d: string) => {
        setValue((v) => {
            const next = v === "0" ? d : v + d;
            return next.length > MAX_DIGITS ? v : next;
        });
    };
    const pressBackspace = () => setValue((v) => (v.length <= 1 ? "0" : v.slice(0, -1)));

    const parsed = parseInt(value, 10);
    const valid = Number.isInteger(parsed) && parsed >= 1;

    const confirm = () => {
        if (!valid) return;
        onConfirm(parsed);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent
                className="w-60 p-3 space-y-2.5"
                // Every button here must not bubble to the cart row underneath —
                // same reasoning as the color-editor popover on the product grid.
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                side="top"
                align="center"
            >
                <div className="rounded-md bg-muted py-2 text-center text-3xl font-bold tabular-nums">
                    {value}
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {NUMPAD_ROWS.flat().map((d) => (
                        <Button
                            key={d}
                            type="button"
                            variant="outline"
                            className="h-14 text-lg"
                            onClick={() => pressDigit(d)}
                        >
                            {d}
                        </Button>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        className="h-14 text-lg text-muted-foreground"
                        onClick={() => setValue("0")}
                    >
                        {t("common.clear", "C")}
                    </Button>
                    <Button type="button" variant="outline" className="h-14 text-lg" onClick={() => pressDigit("0")}>
                        0
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className="h-14"
                        onClick={pressBackspace}
                        aria-label={t("common.backspace", "Backspace")}
                    >
                        <Delete className="h-5 w-5" />
                    </Button>
                </div>
                <Button
                    type="button"
                    className="h-12 w-full text-base bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                    disabled={!valid}
                    onClick={confirm}
                >
                    {t("common.confirm", "OK")}
                </Button>
            </PopoverContent>
        </Popover>
    );
}
