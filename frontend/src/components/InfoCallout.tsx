import { useEffect, useState } from "react";
import { Info, Lightbulb, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "info" | "tip" | "warn";

interface Props {
  id: string;
  variant?: Variant;
  title?: string;
  children: React.ReactNode;
  dismissible?: boolean;
  className?: string;
}

const STORAGE_PREFIX = "hint-dismissed:";

const VARIANT_STYLES: Record<Variant, { box: string; icon: string; Icon: React.ElementType }> = {
  info: {
    box: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-sky-100",
    icon: "text-sky-600 dark:text-sky-400",
    Icon: Info,
  },
  tip: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-100",
    icon: "text-emerald-600 dark:text-emerald-400",
    Icon: Lightbulb,
  },
  warn: {
    box: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100",
    icon: "text-amber-600 dark:text-amber-400",
    Icon: AlertTriangle,
  },
};

/**
 * Dismissible help/info message. Dismiss state persisted in localStorage by `id`.
 * Use unique ids per page/topic, e.g. `store.pricing`, `wallet.topupFlow`.
 */
export function InfoCallout({
  id,
  variant = "info",
  title,
  children,
  dismissible = true,
  className,
}: Props) {
  const key = STORAGE_PREFIX + id;
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setHidden(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  if (hidden) return null;

  const { box, icon, Icon } = VARIANT_STYLES[variant];

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* ignore storage errors */
    }
    setHidden(true);
  };

  return (
    <div
      role="note"
      className={cn(
        "relative flex gap-3 rounded-lg border px-4 py-3 text-sm",
        box,
        dismissible && "pr-10",
        className,
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", icon)} aria-hidden />
      <div className="flex-1 min-w-0 space-y-0.5">
        {title && <p className="font-semibold leading-tight">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
