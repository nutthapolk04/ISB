import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { alertStore, type AlertItem, type AlertVariant } from "./store";

const VARIANT_STYLES: Record<
  AlertVariant,
  { ring: string; bg: string; icon: typeof Info; iconColor: string; iconBg: string }
> = {
  error: {
    ring: "ring-rose-500/20",
    bg: "bg-rose-50/60",
    icon: AlertCircle,
    iconColor: "text-rose-600",
    iconBg: "bg-rose-100",
  },
  warning: {
    ring: "ring-amber-500/20",
    bg: "bg-amber-50/60",
    icon: AlertTriangle,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-100",
  },
  success: {
    ring: "ring-emerald-500/20",
    bg: "bg-emerald-50/60",
    icon: CheckCircle2,
    iconColor: "text-emerald-600",
    iconBg: "bg-emerald-100",
  },
  info: {
    ring: "ring-blue-500/20",
    bg: "bg-blue-50/60",
    icon: Info,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-100",
  },
};

function AlertCard({ item }: { item: AlertItem }) {
  const { t } = useTranslation();
  const style = VARIANT_STYLES[item.variant];
  const Icon = style.icon;

  useEffect(() => {
    if (!item.autoCloseMs) return;
    const timer = setTimeout(() => alertStore.dismiss(item.id), item.autoCloseMs);
    return () => clearTimeout(timer);
  }, [item.id, item.autoCloseMs]);

  const dismiss = () => alertStore.dismiss(item.id);

  const hasCustomActions = !!item.actions && item.actions.length > 0;

  return (
    <div
      role={item.variant === "error" || item.variant === "warning" ? "alertdialog" : "alert"}
      aria-modal="true"
      className={cn(
        "pointer-events-auto relative w-full min-w-[300px] max-w-md",
        "rounded-3xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl",
        "shadow-2xl ring-1 ring-black/5",
        "animate-in fade-in zoom-in-95 duration-200",
        "px-6 pt-6 pb-5",
      )}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close", "Close")}
        className="absolute top-3 right-3 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-col items-center text-center gap-3.5">
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full",
            style.iconBg,
          )}
        >
          <Icon className={cn("h-7 w-7", style.iconColor)} aria-hidden />
        </div>

        <div className="space-y-1">
          <h2 className="text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {item.title}
          </h2>
          {item.description && (
            <p className="text-[14px] leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-2 w-full">
          {hasCustomActions ? (
            <div className="flex flex-col gap-2">
              {item.actions!.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    action.onClick?.();
                    dismiss();
                  }}
                  className={cn(
                    "h-11 w-full rounded-2xl text-[15px] font-semibold transition active:scale-[0.98]",
                    action.intent === "destructive"
                      ? "bg-rose-500 text-white hover:bg-rose-600"
                      : action.intent === "secondary"
                      ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                      : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
                  )}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="h-11 w-full rounded-2xl bg-zinc-900 text-white text-[15px] font-semibold hover:bg-zinc-800 transition active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {t("common.ok", "OK")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CenterAlertHost() {
  const [items, setItems] = useState<AlertItem[]>(alertStore.getSnapshot());

  useEffect(() => alertStore.subscribe(setItems), []);

  if (items.length === 0) return null;

  // Render only the first item as a modal; rest queued behind.
  const active = items[0];
  const queuedCount = items.length - 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4 pointer-events-none"
      aria-live="polite"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-md pointer-events-auto animate-in fade-in duration-200"
        onClick={() => {
          // Only allow backdrop dismiss for auto-close variants (non-blocking).
          if (active.autoCloseMs) alertStore.dismiss(active.id);
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-3">
        <AlertCard item={active} />
        {queuedCount > 0 && (
          <div className="pointer-events-none text-[12px] font-medium text-white/90 drop-shadow-sm tabular-nums">
            +{queuedCount} more
          </div>
        )}
      </div>
    </div>
  );
}
