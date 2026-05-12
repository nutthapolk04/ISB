import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CreditCard,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  UserCircle2,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface StudentLookupResult {
  id: number;
  name: string;
  grade?: string | null;
  photo_url?: string | null;
  allergies?: string | null;
  dietary_notes?: string | null;
  allergy_override_note?: string | null;
  card_frozen?: boolean;
  daily_limit?: number | null;
  negative_credit_limit?: number | null;
  wallet_balance?: number | null;
  customer_code: string;
  student_code?: string | null;
}

export interface UserPayerLookup {
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  photo_url?: string | null;
  wallet_id: number;
  wallet_balance: number;
  is_active: boolean;
}

// Discriminated union — one place that captures whichever wallet kind paid.
export type WalletPayer =
  | { kind: "customer"; student: StudentLookupResult }
  | { kind: "user"; user: UserPayerLookup };

interface RfidPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  onBack: () => void;
  onConfirm: (payer: WalletPayer) => Promise<void>;
  confirming: boolean;
}

type Stage = "detect" | "identity";
type PayerKind = "customer" | "user";

export function RfidPaymentModal({
  open,
  onOpenChange,
  total,
  onBack,
  onConfirm,
  confirming,
}: RfidPaymentModalProps) {
  const [stage, setStage] = useState<Stage>("detect");
  const [payerKind, setPayerKind] = useState<PayerKind>("customer");
  const [cardInput, setCardInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentLookupResult | null>(null);
  const [userPayer, setUserPayer] = useState<UserPayerLookup | null>(null);

  useEffect(() => {
    if (open) {
      setStage("detect");
      setPayerKind("customer");
      setCardInput("");
      setLookupError(null);
      setStudent(null);
      setUserPayer(null);
    }
  }, [open]);

  const lookup = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      if (payerKind === "user") {
        // Try card UID first; fall back to username (mirrors student behavior)
        let result: UserPayerLookup;
        try {
          result = await api.get<UserPayerLookup>(
            `/users/by-card/${encodeURIComponent(q)}`,
          );
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            result = await api.get<UserPayerLookup>(
              `/users/by-username/${encodeURIComponent(q)}`,
            );
          } else {
            throw e;
          }
        }
        setUserPayer(result);
        setStudent(null);
      } else {
        // Try card UID first; fall back to student code
        let result: StudentLookupResult;
        try {
          result = await api.get<StudentLookupResult>(
            `/customers/by-card/${encodeURIComponent(q)}`,
          );
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            result = await api.get<StudentLookupResult>(
              `/customers/by-code/${encodeURIComponent(q)}`,
            );
          } else {
            throw e;
          }
        }
        setStudent(result);
        setUserPayer(null);
      }
      setStage("identity");
    } catch (e) {
      setLookupError(
        e instanceof ApiError
          ? e.detail
          : payerKind === "user"
            ? "User not found"
            : "Card not recognized",
      );
    } finally {
      setLookupLoading(false);
    }
  };

  // Unified balance/remaining math across both payer kinds.
  const balance =
    payerKind === "user"
      ? Number(userPayer?.wallet_balance ?? 0)
      : Number(student?.wallet_balance ?? 0);
  const remaining = balance - total;
  const negLimit = student?.negative_credit_limit ?? null;
  const allowedFloor = negLimit !== null ? -Number(negLimit) : null;
  const isFrozen = payerKind === "customer" && student?.card_frozen === true;
  const dailyLimitVal =
    payerKind === "customer" && student?.daily_limit
      ? Number(student.daily_limit)
      : null;

  // User wallet has no overdraft cap or daily limit (UI-only — backend may
  // tighten this later). We still surface a "going negative" hint below 0.
  const overLimit =
    payerKind === "customer" &&
    allowedFloor !== null &&
    remaining < allowedFloor &&
    !isFrozen;
  const goingNegative = !overLimit && remaining < 0 && !isFrozen;

  const hasPayer = payerKind === "user" ? !!userPayer : !!student;
  const confirmDisabled = !hasPayer || isFrozen || overLimit || confirming;

  const handleConfirm = async () => {
    if (payerKind === "user" && userPayer) {
      await onConfirm({ kind: "user", user: userPayer });
      return;
    }
    if (payerKind === "customer" && student) {
      await onConfirm({ kind: "customer", student });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!confirming) onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg canteen-modal-pop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stage === "identity" && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setStage("detect");
                  setStudent(null);
                  setUserPayer(null);
                  setCardInput("");
                }}
                aria-label="Back to card detection"
                className="-ml-2 h-7 w-7"
                disabled={confirming}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {stage === "detect"
              ? payerKind === "user"
                ? "พนักงาน / ผู้ปกครอง"
                : "Tap Student Card"
              : "Verify Identity"}
          </DialogTitle>
        </DialogHeader>

        {stage === "detect" && (
          <div className="flex flex-col items-center gap-4 py-4">
            {/* Payer kind toggle */}
            <div className="grid w-full grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPayerKind("customer");
                  setCardInput("");
                  setLookupError(null);
                }}
                className={cn(
                  "rounded-md border-2 px-3 py-2 text-sm font-semibold transition",
                  payerKind === "customer"
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-input bg-background text-muted-foreground hover:border-muted-foreground",
                )}
              >
                นักเรียน
              </button>
              <button
                type="button"
                onClick={() => {
                  setPayerKind("user");
                  setCardInput("");
                  setLookupError(null);
                }}
                className={cn(
                  "rounded-md border-2 px-3 py-2 text-sm font-semibold transition",
                  payerKind === "user"
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-input bg-background text-muted-foreground hover:border-muted-foreground",
                )}
              >
                พนักงาน / ผู้ปกครอง
              </button>
            </div>

            {payerKind === "customer" && (
              <>
                <div className="canteen-rfid-ring">
                  <CreditCard className="h-16 w-16" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Waiting for card…
                </p>
              </>
            )}
            <div className="w-full space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {payerKind === "user"
                  ? "Username หรือ Badge code"
                  : "Or enter card UID / student code"}
              </label>
              <div className="flex gap-2">
                <Input
                  value={cardInput}
                  onChange={(e) => setCardInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") lookup(cardInput);
                  }}
                  placeholder={
                    payerKind === "user"
                      ? "เช่น manager_canteen_thai"
                      : "e.g. RFID-0001 or 85001"
                  }
                  autoFocus
                  disabled={lookupLoading}
                />
                <Button
                  onClick={() => lookup(cardInput)}
                  disabled={lookupLoading || !cardInput.trim()}
                >
                  {lookupLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Look up"
                  )}
                </Button>
              </div>
              {lookupError && (
                <p className="text-xs text-destructive">{lookupError}</p>
              )}
            </div>
            <Button variant="ghost" onClick={onBack} className="mt-2">
              Change payment method
            </Button>
          </div>
        )}

        {stage === "identity" && hasPayer && (
          <div className="space-y-4">
            {/* Identity card — student or user */}
            <div className="flex gap-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-amber-100 ring-2 ring-amber-300">
                {(payerKind === "user" ? userPayer?.photo_url : student?.photo_url) ? (
                  <img
                    src={(payerKind === "user" ? userPayer?.photo_url : student?.photo_url) ?? undefined}
                    alt={payerKind === "user" ? userPayer?.full_name ?? "" : student?.name ?? ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-amber-400">
                    <UserCircle2 className="h-14 w-14" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-bold">
                  {payerKind === "user" ? userPayer?.full_name : student?.name}
                </div>
                {payerKind === "user" ? (
                  <div className="text-xs text-muted-foreground capitalize">
                    @{userPayer?.username} · {userPayer?.role}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {student?.student_code ?? student?.customer_code}
                    {student?.grade ? ` · Grade ${student.grade}` : ""}
                  </div>
                )}
                {payerKind === "customer" && student?.allergies && (
                  <div className="mt-2 flex items-start gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>Allergies: {student.allergies}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Frozen / limit banners */}
            {isFrozen && (
              <div className="flex items-start gap-2 rounded-lg bg-red-100 p-3 text-sm text-red-800">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">Card is frozen</div>
                  <div className="text-xs">
                    Ask parent/admin to unfreeze before charging.
                  </div>
                </div>
              </div>
            )}

            {/* Balance forecast */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current balance</span>
                <span className="tabular-nums font-semibold">
                  ฿{balance.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order total</span>
                <span className="tabular-nums font-semibold">
                  −฿{total.toFixed(2)}
                </span>
              </div>
              <div className="my-1 border-t border-dashed border-border" />
              <div className="flex justify-between text-base font-bold">
                <span>After payment</span>
                <span
                  className={cn(
                    "tabular-nums",
                    overLimit
                      ? "text-destructive"
                      : goingNegative
                        ? "text-amber-600"
                        : "text-emerald-600",
                  )}
                >
                  ฿{remaining.toFixed(2)}
                </span>
              </div>
              {dailyLimitVal && (
                <div className="pt-1 text-[11px] text-muted-foreground">
                  Daily limit: ฿{dailyLimitVal.toFixed(2)}
                </div>
              )}
            </div>

            {/* Warning banners */}
            {overLimit && (
              <div className="flex items-start gap-2 rounded-lg bg-red-100 p-3 text-sm text-red-800">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">Exceeds overdraft limit</div>
                  <div className="text-xs">
                    Balance would go ฿{Math.abs(remaining).toFixed(2)} negative,
                    but the overdraft cap is ฿{Number(negLimit).toFixed(2)}.
                  </div>
                </div>
              </div>
            )}
            {goingNegative && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">Balance will go negative</div>
                  <div className="text-xs">
                    Within allowed overdraft. Student will owe ฿
                    {Math.abs(remaining).toFixed(2)}.
                  </div>
                </div>
              </div>
            )}
            {!overLimit && !goingNegative && !isFrozen && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <div className="font-semibold">
                  Sufficient balance — ready to charge
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setStage("detect");
                  setStudent(null);
                  setUserPayer(null);
                }}
                disabled={confirming}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-600 font-semibold"
                onClick={handleConfirm}
                disabled={confirmDisabled}
              >
                {confirming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Charging…
                  </>
                ) : (
                  `Confirm ฿${total.toFixed(2)}`
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
