import { cn } from "@/lib/utils";
import { CANTEEN_CATEGORIES } from "./canteenImages";

interface CategoryTabsProps {
  active: string;
  onChange: (category: string) => void;
  counts: Record<string, number>;
}

const ALL = "All";

export function CategoryTabs({ active, onChange, counts }: CategoryTabsProps) {
  const tabs = [ALL, ...CANTEEN_CATEGORIES];
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const isActive = tab === active;
        const count = tab === ALL ? totalCount : counts[tab] ?? 0;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={cn(
              "shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition-all",
              "border border-transparent",
              isActive
                ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-300/40"
                : "bg-card/80 text-muted-foreground border-amber-100 hover:bg-amber-50 hover:text-amber-700",
            )}
          >
            {tab}
            <span
              className={cn(
                "ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs",
                isActive ? "bg-white/25" : "bg-muted",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
