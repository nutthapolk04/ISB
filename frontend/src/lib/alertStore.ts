// Vanilla pub/sub store so alert.* can be called outside React components
// (e.g. from async handlers, sonner shims, services). The CenterAlertHost
// subscribes to render the visible queue.

export type AlertVariant = "error" | "warning" | "success" | "info";

export interface AlertAction {
  label: string;
  onClick?: () => void;
  /** Style hint for the action button. Default = primary. */
  intent?: "primary" | "secondary" | "destructive";
}

export interface AlertItem {
  id: string;
  variant: AlertVariant;
  title: string;
  description?: string;
  /** Auto-dismiss after N ms. 0 / undefined = manual dismiss. */
  autoCloseMs?: number;
  actions?: AlertAction[];
  /** Optional dismiss callback. */
  onDismiss?: () => void;
}

type Listener = (items: AlertItem[]) => void;

const DEFAULT_AUTO_CLOSE: Record<AlertVariant, number | undefined> = {
  success: 1800,
  info: 3200,
  warning: undefined,
  error: undefined,
};

let queue: AlertItem[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

const emit = () => {
  for (const l of listeners) l(queue);
};

export const alertStore = {
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(queue);
    return () => listeners.delete(fn);
  },
  getSnapshot(): AlertItem[] {
    return queue;
  },
  push(item: Omit<AlertItem, "id"> & { id?: string }): string {
    const id = item.id ?? `alert-${nextId++}`;
    const autoCloseMs =
      item.autoCloseMs !== undefined
        ? item.autoCloseMs
        : DEFAULT_AUTO_CLOSE[item.variant];
    const full: AlertItem = { ...item, id, autoCloseMs };
    queue = [...queue, full];
    emit();
    return id;
  },
  dismiss(id: string) {
    const found = queue.find((a) => a.id === id);
    queue = queue.filter((a) => a.id !== id);
    emit();
    found?.onDismiss?.();
  },
  dismissAll() {
    const old = queue;
    queue = [];
    emit();
    old.forEach((a) => a.onDismiss?.());
  },
};
