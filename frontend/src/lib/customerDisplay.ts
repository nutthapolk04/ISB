/**
 * Helpers that turn POS state (cart lines, selected members, payment
 * method enums) into the DisplayItem / DisplayPayer shapes the
 * customer-display window expects.
 *
 * Kept here (not inside the hook) so unit tests don't need a React
 * component to exercise the mapping.
 */
import type {
  DisplayItem,
  DisplayPayer,
  PaymentMethod,
  SpendingLimitData,
} from "@/hooks/useDisplayBroadcast";

// ── Cart line → DisplayItem ─────────────────────────────────────────────

export interface CartLineLike {
  name: string;
  quantity: number;
  // Effective unit price for this checkout (override → panel → catalog).
  unitPrice: number;
  // Per-line discount in THB already resolved by the caller.
  discount?: number;
}

export function cartToDisplayItems(lines: CartLineLike[]): DisplayItem[] {
  return lines
    .filter((l) => l.quantity !== 0)
    .map((l) => ({
      name: l.name,
      qty: l.quantity,
      price: Math.max(0, l.unitPrice * l.quantity - (l.discount ?? 0)),
    }));
}

// ── Member-like inputs → DisplayPayer ───────────────────────────────────

interface CustomerLike {
  name: string;
  customer_code?: string | null;
  student_code?: string | null;
  grade?: string | null;
  customer_kind?: string | null;
  wallet_balance?: number | null;
  spendingLimit?: SpendingLimitData | null;
}

interface UserLike {
  full_name: string;
  username: string;
  role: string;
  wallet_balance?: number | null;
  spendingLimit?: SpendingLimitData | null;
}

interface DepartmentLike {
  department_name: string;
  department_code?: string | null;
  wallet_balance?: number | null;
}

function formatRoleForCustomer(c: CustomerLike): string {
  const kind = (c.customer_kind ?? "").toLowerCase();
  const label =
    kind === "student" ? "Student" : kind === "department" ? "Department" : "Member";
  return c.grade ? `${label} · Grade ${c.grade}` : label;
}

export function payerForCustomer(
  c: CustomerLike,
  total: number,
): DisplayPayer {
  const before = c.wallet_balance ?? null;
  return {
    kind: "customer",
    name: c.name,
    code: c.student_code ?? c.customer_code ?? null,
    role: formatRoleForCustomer(c),
    balanceBefore: before,
    balanceAfter: before === null ? null : Math.round((before - total) * 100) / 100,
    spendingLimit: c.spendingLimit ?? null,
  };
}

export function payerForUser(u: UserLike, total: number): DisplayPayer {
  const role =
    u.role === "staff"
      ? "Staff"
      : u.role === "parent"
        ? "Parent"
        : u.role.charAt(0).toUpperCase() + u.role.slice(1);
  const before = u.wallet_balance ?? null;
  return {
    kind: "user",
    name: u.full_name,
    code: u.username,
    role,
    balanceBefore: before,
    balanceAfter: before === null ? null : Math.round((before - total) * 100) / 100,
    spendingLimit: u.spendingLimit ?? null,
  };
}

export function payerForDepartment(
  d: DepartmentLike,
  total: number,
): DisplayPayer {
  const before = d.wallet_balance ?? null;
  return {
    kind: "department",
    name: d.department_name,
    code: d.department_code ?? null,
    role: "Department Budget",
    balanceBefore: before,
    balanceAfter: before === null ? null : Math.round((before - total) * 100) / 100,
  };
}

/** Update a DisplayPayer's spending limit after a successful payment. */
export function afterPaymentPayer(payer: DisplayPayer | null, amount: number): DisplayPayer | null {
  if (!payer || !payer.spendingLimit) return payer;
  const sl = payer.spendingLimit;
  return {
    ...payer,
    spendingLimit: {
      ...sl,
      spent_today: sl.spent_today + amount,
      remaining: Math.max(0, sl.remaining - amount),
    },
  };
}

// ── Backend payment_method → display PaymentMethod ──────────────────────

export function paymentMethodForDisplay(method: string): PaymentMethod {
  const m = method.toLowerCase();
  if (m === "cash") return "cash";
  if (m === "wallet" || m === "card_tap") return "wallet";
  if (m === "edc" || m === "credit_card" || m === "debit_card") return "edc";
  if (m === "department") return "department";
  if (m === "qr" || m === "qr_promptpay" || m === "bank_transfer") return "qr";
  return "card";
}
