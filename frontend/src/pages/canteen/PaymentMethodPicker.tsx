import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, Banknote, QrCode, Nfc, Building2 } from "lucide-react";

export type CanteenPaymentMethod = "wallet" | "cash" | "qr" | "edc" | "department";

interface PaymentMethodPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  /** Methods to render in this picker. Default = canteen's 4 (no department). */
  methods?: CanteenPaymentMethod[];
  /** Override the wallet method's label (e.g., "บัตรนักเรียน" for store). */
  walletLabel?: string;
  onSelect: (method: CanteenPaymentMethod) => void;
}

const ALL_METHODS: Record<
  CanteenPaymentMethod,
  { label: string; hint: string; Icon: React.ElementType; gradient: string }
> = {
  wallet: {
    label: "Student Wallet",
    hint: "Tap RFID card",
    Icon: CreditCard,
    gradient: "from-amber-400 to-orange-500",
  },
  cash: {
    label: "Cash",
    hint: "Enter tendered amount",
    Icon: Banknote,
    gradient: "from-emerald-400 to-teal-500",
  },
  qr: {
    label: "QR PromptPay",
    hint: "Scan to pay",
    Icon: QrCode,
    gradient: "from-sky-400 to-indigo-500",
  },
  edc: {
    label: "EDC",
    hint: "Credit / Debit card",
    Icon: Nfc,
    gradient: "from-violet-400 to-purple-600",
  },
  department: {
    label: "Department",
    hint: "Charge to department",
    Icon: Building2,
    gradient: "from-rose-400 to-pink-600",
  },
};

const DEFAULT_METHODS: CanteenPaymentMethod[] = ["wallet", "cash", "qr", "edc"];

export function PaymentMethodPicker({
  open,
  onOpenChange,
  total,
  methods = DEFAULT_METHODS,
  walletLabel,
  onSelect,
}: PaymentMethodPickerProps) {
  // 5-method layout uses 5 cols on lg, 3 on smaller; 4-method stays 3-col grid.
  const gridCols = methods.length >= 5 ? "grid-cols-3 lg:grid-cols-5" : "grid-cols-3";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl canteen-modal-pop">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Choose Payment —{" "}
            <span className="text-amber-600 tabular-nums">
              ฿{total.toFixed(2)}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className={`grid ${gridCols} gap-3 pt-1`}>
          {methods.map((key) => {
            const def = ALL_METHODS[key];
            const label = key === "wallet" && walletLabel ? walletLabel : def.label;
            const Icon = def.Icon;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-5 text-center transition-all
                           hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-200/40 hover:border-amber-300 active:scale-[0.98]"
              >
                <div
                  className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${def.gradient} text-white shadow-md`}
                >
                  <Icon className="h-8 w-8" />
                </div>
                <div className="font-semibold">{label}</div>
                <div className="text-xs text-muted-foreground">{def.hint}</div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
