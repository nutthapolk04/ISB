import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DateTimeSortDir } from "@/lib/dateTimeSort";

interface Props {
  label: string;
  sortDir: DateTimeSortDir;
  onToggle: () => void;
  className?: string;
  /** When true, render only the button (for use inside shadcn TableHead). */
  inline?: boolean;
}

export function SortableDateTimeHeader({ label, sortDir, onToggle, className, inline }: Props) {
  const button = (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1 font-medium hover:text-foreground text-muted-foreground"
    >
      {label}
      {sortDir === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );

  if (inline) return button;

  return (
    <th className={cn("px-2 py-2 text-left", className)}>
      {button}
    </th>
  );
}
