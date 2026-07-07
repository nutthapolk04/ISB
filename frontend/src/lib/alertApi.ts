import { alertStore, type AlertAction, type AlertVariant } from "./store";

interface AlertOptions {
  description?: string;
  autoCloseMs?: number;
  actions?: AlertAction[];
  id?: string;
  onDismiss?: () => void;
}

const make = (variant: AlertVariant) =>
  (title: string, opts: AlertOptions = {}) =>
    alertStore.push({ variant, title, ...opts });

export const alert = {
  error: make("error"),
  warning: make("warning"),
  success: make("success"),
  info: make("info"),
  dismiss: alertStore.dismiss,
  dismissAll: alertStore.dismissAll,
};

export type Alert = typeof alert;
