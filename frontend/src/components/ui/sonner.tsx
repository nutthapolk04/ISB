// Shim that adapts the sonner-style `toast.success(...)` API onto our
// CenterAlert system. Both the original `Toaster` and `toast` are kept as
// named exports so existing call sites work without code changes.
import { alert } from "@/lib/alertApi";

type ToastOptions = {
  description?: string;
  duration?: number;
  id?: string;
  action?: { label: string; onClick?: () => void };
};

// Default auto-dismiss timings — success/info are non-blocking confirmations
// (matches sonner's original behavior of a transient toast), error/warning
// stay open until the user acknowledges so a failure can't be missed.
const DEFAULT_AUTO_CLOSE: Record<"success" | "error" | "warning" | "info", number | undefined> = {
  success: 2500,
  info: 2500,
  warning: undefined,
  error: undefined,
};

const adapt =
  (variant: "success" | "error" | "warning" | "info") =>
  (title: unknown, opts: ToastOptions = {}) => {
    const text = typeof title === "string" ? title : String(title ?? "");
    const description =
      typeof opts.description === "string" ? opts.description : undefined;
    return alert[variant](text, {
      description,
      autoCloseMs: opts.duration ?? DEFAULT_AUTO_CLOSE[variant],
      id: opts.id,
      actions: opts.action
        ? [{ label: opts.action.label, onClick: opts.action.onClick }]
        : undefined,
    });
  };

const baseToast = (title: unknown, opts: ToastOptions = {}) =>
  adapt("info")(title, opts);

export const toast = Object.assign(baseToast, {
  success: adapt("success"),
  error: adapt("error"),
  warning: adapt("warning"),
  info: adapt("info"),
  message: adapt("info"),
  dismiss: (id?: string) => (id ? alert.dismiss(id) : alert.dismissAll()),
});

// The CenterAlertHost is mounted in App.tsx. This stub exists only so
// the existing `<Toaster />` and `<Sonner />` JSX in App.tsx keeps compiling.
export const Toaster = () => null;
