// Shim that adapts the sonner-style `toast.success(...)` API onto our
// CenterAlert system. Both the original `Toaster` and `toast` are kept as
// named exports so existing call sites work without code changes.
import { alert } from "@/components/CenterAlert/api";

type ToastOptions = {
  description?: string;
  duration?: number;
  id?: string;
  action?: { label: string; onClick?: () => void };
};

const adapt =
  (variant: "success" | "error" | "warning" | "info") =>
  (title: unknown, opts: ToastOptions = {}) => {
    const text = typeof title === "string" ? title : String(title ?? "");
    const description =
      typeof opts.description === "string" ? opts.description : undefined;
    return alert[variant](text, {
      description,
      autoCloseMs: opts.duration,
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
