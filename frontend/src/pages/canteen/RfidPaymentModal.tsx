import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Building2,
  CreditCard,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  UserCircle2,
  Loader2,
  ArrowLeft,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  wallet_id?: number | null;
  customer_code: string;
  student_code?: string | null;
  family_code?: string | null;
  customer_kind?: string | null;
  /** Set when this result is a User-based payer (parent/staff/teacher). */
  user_id?: number | null;
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
  // Department auto-fill (set when user is a staff member linked to a dept)
  department_id?: number | null;
  department_code?: string | null;
  department_name?: string | null;
}

export interface DepartmentLookupResult {
  id: number;
  department_code: string;
  department_name: string;
  is_active: boolean;
  wallet_id?: number | null;
  wallet_balance?: number | null;
}

// Discriminated union — one place that captures whichever wallet kind paid.
export type WalletPayer =
  | { kind: "customer"; student: StudentLookupResult }
  | { kind: "user"; user: UserPayerLookup }
  | { kind: "department"; department: DepartmentLookupResult };

interface RfidPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  onBack: () => void;
  onConfirm: (payer: WalletPayer) => Promise<void>;
  confirming: boolean;
  /** Pre-selected member from search (skips to identity stage) */
  preSelectedMember?: StudentLookupResult | null;
  /** Clear the pre-selected member after use */
  onClearPreSelected?: () => void;
}

type Stage = "detect" | "identity" | "family";
type PayerKind = "customer" | "user" | "family" | "department";

interface FamilyMember {
  entity_type: "user" | "customer";
  id: number;
  name: string;
  role?: string | null;
  grade?: string | null;
  photo_url?: string | null;
  allergies?: string | null;
  card_frozen?: boolean;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  customer_code?: string | null;
  student_code?: string | null;
  username?: string | null;
}

interface FamilyLookupResult {
  family_code?: string | null;
  members: FamilyMember[];
}

export function RfidPaymentModal({
  open,
  onOpenChange,
  total,
  onBack,
  onConfirm,
  confirming,
  preSelectedMember,
  onClearPreSelected,
}: RfidPaymentModalProps) {
  const { t } = useTranslation();
  const r = (k: string, opts?: Record<string, unknown>) => t(`canteen.rfidModal.${k}`, opts as Parameters<typeof t>[1]);
  const [stage, setStage] = useState<Stage>("detect");
  const [payerKind, setPayerKind] = useState<PayerKind>("customer");
  const [cardInput, setCardInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentLookupResult | null>(null);
  const [userPayer, setUserPayer] = useState<UserPayerLookup | null>(null);
  const [departmentPayer, setDepartmentPayer] = useState<DepartmentLookupResult | null>(null);
  // Family search state
  const [familyQuery, setFamilyQuery] = useState("");
  const [familyResult, setFamilyResult] = useState<FamilyLookupResult | null>(null);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [familyError, setFamilyError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // If we have a pre-selected member, skip to identity stage
      if (preSelectedMember) {
        if (preSelectedMember.user_id != null) {
          // User-based payer (parent / staff / teacher) found via search
          setUserPayer({
            user_id: preSelectedMember.user_id,
            username: preSelectedMember.customer_code,
            full_name: preSelectedMember.name,
            role: preSelectedMember.customer_kind ?? "parent",
            photo_url: preSelectedMember.photo_url ?? null,
            wallet_id: preSelectedMember.wallet_id ?? 0,
            wallet_balance: preSelectedMember.wallet_balance ?? 0,
            is_active: true,
          });
          setStudent(null);
          setPayerKind("user");
        } else {
          setStudent(preSelectedMember);
          setUserPayer(null);
          setPayerKind("customer");
        }
        setStage("identity");
        setCardInput("");
        setLookupError(null);
        setFamilyQuery("");
        setFamilyResult(null);
        setFamilyError(null);
      } else {
        setStage("detect");
        setPayerKind("customer");
        setCardInput("");
        setLookupError(null);
        setStudent(null);
        setUserPayer(null);
        setDepartmentPayer(null);
        setFamilyQuery("");
        setFamilyResult(null);
        setFamilyError(null);
      }
    }
    // Note: Don't clear preSelectedMember when modal closes -
    // it's managed by parent component for the Order panel display
  }, [open, preSelectedMember]);

  /**
   * Auto-detect who owns this card/code — tries all identity types in order:
   *   1. Customer by card UID (student RFID)
   *   2. User by card UID    (staff / parent RFID)
   *   3. Customer by code    (student code fallback)
   *   4. User by username    (employee login fallback)
   * Sets payerKind automatically so no tab pre-selection is needed.
   */
  const lookup = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      // 1. Student/customer card UID
      try {
        const result = await api.get<StudentLookupResult>(
          `/customers/by-card/${encodeURIComponent(q)}`,
        );
        setStudent(result);
        setUserPayer(null);
        setPayerKind("customer");
        setStage("identity");
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      // 2. Staff/parent card UID
      try {
        const result = await api.get<UserPayerLookup>(
          `/users/by-card/${encodeURIComponent(q)}`,
        );
        setUserPayer(result);
        setStudent(null);
        setPayerKind("user");
        setStage("identity");
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      // 3. Customer by student code
      try {
        const result = await api.get<StudentLookupResult>(
          `/customers/by-code/${encodeURIComponent(q)}`,
        );
        setStudent(result);
        setUserPayer(null);
        setPayerKind("customer");
        setStage("identity");
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      // 4. User by username
      try {
        const result = await api.get<UserPayerLookup>(
          `/users/by-username/${encodeURIComponent(q)}`,
        );
        setUserPayer(result);
        setStudent(null);
        setDepartmentPayer(null);
        setPayerKind("user");
        setStage("identity");
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }

      // 5. Department by code (exact match — allow inactive so balance lookup works)
      const depts = await api.get<DepartmentLookupResult[]>(
        `/departments/?q=${encodeURIComponent(q)}&active_only=false`,
      );
      const exactDept = depts.find(
        (d) => d.department_code.toLowerCase() === q.toLowerCase(),
      );
      if (exactDept) {
        setDepartmentPayer(exactDept);
        setStudent(null);
        setUserPayer(null);
        setPayerKind("department");
        setStage("identity");
        return;
      }
      throw new ApiError(404, t("canteen.rfid.notFoundInSystem"), undefined);
    } catch (e) {
      setLookupError(
        e instanceof ApiError
          ? e.detail
          : t("canteen.rfid.notFoundRetry"),
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const lookupFamily = async () => {
    const q = familyQuery.trim();
    if (!q) return;
    setFamilyLoading(true);
    setFamilyError(null);
    setFamilyResult(null);
    try {
      const result = await api.get<FamilyLookupResult>(
        `/users/family-lookup?q=${encodeURIComponent(q)}`,
      );
      setFamilyResult(result);
      setStage("family");
    } catch (e) {
      setFamilyError(
        e instanceof ApiError ? e.detail : t("canteen.rfid.notFound"),
      );
    } finally {
      setFamilyLoading(false);
    }
  };

  const selectFamilyMember = (member: FamilyMember) => {
    if (member.entity_type === "user" && member.wallet_id != null && member.wallet_balance != null) {
      setUserPayer({
        user_id: member.id,
        username: member.username ?? String(member.id),
        full_name: member.name,
        role: member.role ?? "",
        photo_url: member.photo_url ?? null,
        wallet_id: member.wallet_id,
        wallet_balance: member.wallet_balance,
        is_active: true,
      });
      setStudent(null);
      setPayerKind("user");
      setStage("identity");
    } else if (member.entity_type === "customer") {
      setStudent({
        id: member.id,
        name: member.name,
        grade: member.grade ?? null,
        photo_url: member.photo_url ?? null,
        allergies: member.allergies ?? null,
        card_frozen: member.card_frozen ?? false,
        wallet_balance: member.wallet_balance ?? null,
        customer_code: member.customer_code ?? String(member.id),
        student_code: member.student_code ?? null,
      });
      setUserPayer(null);
      setPayerKind("customer");
      setStage("identity");
    }
  };

  // Unified balance/remaining math across all payer kinds.
  const balance =
    payerKind === "user"
      ? Number(userPayer?.wallet_balance ?? 0)
      : payerKind === "department"
        ? Number(departmentPayer?.wallet_balance ?? 0)
        : Number(student?.wallet_balance ?? 0);
  const remaining = balance - total;
  const negLimit = student?.negative_credit_limit ?? null;
  // Backend treats negative_credit_limit=null as zero overdraft (no negative
  // allowed) unless the global allow_negative_customer_wallet flag is on. The
  // frontend was treating null as "unlimited" and confidently telling the
  // cashier "Within allowed overdraft" even when the backend was about to
  // 422 with EXCEEDS_NEGATIVE_CREDIT_LIMIT. Mirror the backend default here.
  const allowedFloor = negLimit !== null ? -Number(negLimit) : 0;
  const isFrozen = payerKind === "customer" && student?.card_frozen === true;
  const dailyLimitVal =
    payerKind === "customer" && student?.daily_limit
      ? Number(student.daily_limit)
      : null;

  // User/department wallet has no overdraft cap or daily limit.
  const overLimit =
    payerKind === "customer" &&
    remaining < allowedFloor &&
    !isFrozen;
  const goingNegative = !overLimit && remaining < 0 && !isFrozen && payerKind !== "department";

  const hasPayer =
    payerKind === "user" ? !!userPayer
    : payerKind === "department" ? !!departmentPayer
    : !!student;
  const confirmDisabled = !hasPayer || isFrozen || overLimit || confirming;

  const handleConfirm = async () => {
    if (payerKind === "user" && userPayer) {
      await onConfirm({ kind: "user", user: userPayer });
      return;
    }
    if (payerKind === "department" && departmentPayer) {
      await onConfirm({ kind: "department", department: departmentPayer });
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
            {(stage === "identity" || stage === "family") && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (stage === "family") {
                    setStage("detect");
                    setFamilyResult(null);
                  } else if (stage === "identity" && familyResult) {
                    // came from family list — go back there
                    setStage("family");
                    setStudent(null);
                    setUserPayer(null);
                  } else {
                    setStage("detect");
                    setStudent(null);
                    setUserPayer(null);
                    setDepartmentPayer(null);
                    setCardInput("");
                  }
                }}
                aria-label="Back"
                className="-ml-2 h-7 w-7"
                disabled={confirming}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {stage === "detect"
              ? r("title")
              : stage === "family"
                ? r("titleFamily")
                : r("titleVerify")}
          </DialogTitle>
        </DialogHeader>

        {stage === "detect" && (
          <div className="flex flex-col items-center gap-4 py-4">
            {/* Unified RFID ring — works for all payer types */}
            <div className="canteen-rfid-ring">
              <CreditCard className="h-16 w-16" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {r("desc")}
              <br />
              <span className="text-xs">{r("descAuto")}</span>
            </p>

            {/* Single unified card / code input */}
            <div className="w-full space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {r("inputLabel")}
              </label>
              <div className="flex gap-2">
                <Input
                  value={cardInput}
                  onChange={(e) => setCardInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") lookup(cardInput);
                  }}
                  placeholder={r("inputPlaceholder")}
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
                    r("searchBtn")
                  )}
                </Button>
              </div>
              {lookupError && (
                <p className="text-xs text-destructive">{lookupError}</p>
              )}
            </div>

            {/* Family search — secondary option for no-card cases */}
            <div className="w-full border-t border-dashed pt-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setPayerKind("family");
                  setCardInput("");
                  setLookupError(null);
                  setFamilyQuery("");
                  setFamilyError(null);
                  setFamilyResult(null);
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
              >
                <Users className="h-3.5 w-3.5" />
                {r("noCard")}
              </button>

              {payerKind === "family" && (
                <div className="space-y-2">
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
                    <strong>{r("noCardTitle")}</strong> — {r("noCardHint")}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={familyQuery}
                      onChange={(e) => setFamilyQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") lookupFamily(); }}
                      placeholder={r("noCardPlaceholder")}
                      autoFocus
                      disabled={familyLoading}
                    />
                    <Button
                      onClick={lookupFamily}
                      disabled={familyLoading || !familyQuery.trim()}
                    >
                      {familyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : r("searchBtn")}
                    </Button>
                  </div>
                  {familyError && (
                    <p className="text-xs text-destructive">{familyError}</p>
                  )}
                </div>
              )}
            </div>

            <Button variant="ghost" onClick={onBack} className="mt-2">
              {r("changePayment")}
            </Button>
          </div>
        )}

        {/* Family member list */}
        {stage === "family" && familyResult && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {r("familyFound", { count: familyResult.members.length })}
              {familyResult.family_code && <> · {r("familyCode")} <code className="font-mono text-xs bg-muted px-1 rounded">{familyResult.family_code}</code></>}
              {" "}— {r("selectPayer")}
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {familyResult.members.map((member) => {
                const isFrozen = member.card_frozen;
                const bal = member.wallet_balance ?? 0;
                const afterPay = bal - total;
                return (
                  <button
                    key={`${member.entity_type}-${member.id}`}
                    type="button"
                    onClick={() => selectFamilyMember(member)}
                    disabled={isFrozen}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl border p-3 text-left transition",
                      isFrozen
                        ? "border-red-200 bg-red-50 opacity-60 cursor-not-allowed"
                        : "border-border bg-card hover:border-amber-400 hover:bg-amber-50/50 cursor-pointer",
                    )}
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted flex items-center justify-center">
                      {member.photo_url ? (
                        <img src={member.photo_url} alt={member.name} className="h-full w-full object-cover" />
                      ) : (
                        <UserCircle2 className="h-7 w-7 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm truncate">{member.name}</span>
                        <Badge variant="secondary" className="h-4 text-[10px] px-1">
                          {member.entity_type === "user" ? (member.role ?? "staff") : r("grade", { grade: member.grade ?? "?" })}
                        </Badge>
                        {isFrozen && <Badge variant="destructive" className="h-4 text-[10px] px-1">{r("frozen")}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {member.entity_type === "user" ? `@${member.username}` : (member.student_code ?? member.customer_code)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn("text-sm font-bold tabular-nums", bal < 0 ? "text-destructive" : "text-foreground")}>
                        ฿{bal.toFixed(2)}
                      </div>
                      <div className={cn("text-[10px] tabular-nums", afterPay < 0 ? "text-amber-600" : "text-emerald-600")}>
                        → ฿{afterPay.toFixed(2)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStage("detect"); setFamilyResult(null); }}
              className="w-full"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> {r("newSearch")}
            </Button>
          </div>
        )}

        {stage === "identity" && hasPayer && (
          <div className="space-y-4">
            {/* Identity card — student, user, or department */}
            <div className={cn(
              "flex gap-4 rounded-2xl border p-4",
              overLimit
                ? "border-red-300 bg-gradient-to-br from-red-50 to-rose-50"
                : "border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50",
            )}>
              <div className={cn(
                "h-20 w-20 shrink-0 overflow-hidden rounded-xl ring-2",
                overLimit ? "bg-red-100 ring-red-400" : "bg-amber-100 ring-amber-300",
              )}>
                {payerKind === "department" ? (
                  <div className="flex h-full w-full items-center justify-center text-rose-500">
                    <Building2 className="h-12 w-12" />
                  </div>
                ) : (payerKind === "user" ? userPayer?.photo_url : student?.photo_url) ? (
                  <img
                    src={(payerKind === "user" ? userPayer?.photo_url : student?.photo_url) ?? undefined}
                    alt={payerKind === "user" ? userPayer?.full_name ?? "" : student?.name ?? ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className={cn("flex h-full w-full items-center justify-center", overLimit ? "text-red-400" : "text-amber-400")}>
                    <UserCircle2 className="h-14 w-14" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-bold">
                  {payerKind === "department"
                    ? departmentPayer?.department_name
                    : payerKind === "user" ? userPayer?.full_name : student?.name}
                </div>
                {payerKind === "department" ? (
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {departmentPayer?.department_code}
                  </div>
                ) : payerKind === "user" ? (
                  <div className="space-y-0.5">
                    <div className="text-xs text-muted-foreground capitalize">
                      @{userPayer?.username} · {userPayer?.role}
                    </div>
                    {userPayer?.department_name && (
                      <div className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] text-rose-700 font-medium">
                        <Building2 className="h-3 w-3" />
                        {userPayer.department_name} ({userPayer.department_code})
                      </div>
                    )}
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
                    <span>{r("allergies")}: {student.allergies}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Frozen / limit banners */}
            {isFrozen && (
              <div className="flex items-start gap-2 rounded-lg bg-red-100 p-3 text-sm text-red-800">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">{r("frozenTitle")}</div>
                  <div className="text-xs">{r("frozenDesc")}</div>
                </div>
              </div>
            )}

            {/* Balance forecast — Sale Total is the hero metric */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {r("balanceOrder")}
                </span>
                <span className="text-3xl font-bold tabular-nums text-foreground">
                  ฿{total.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-border" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">{r("balanceCurrent")}</span>
                <span className="tabular-nums font-semibold">
                  ฿{balance.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span>{r("balanceAfter")}</span>
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
                  {r("dailyLimit")}: ฿{dailyLimitVal.toFixed(2)}
                </div>
              )}
            </div>

            {/* Warning banners */}
            {overLimit && (
              <div className="flex items-start gap-2 rounded-lg bg-red-100 p-3 text-sm text-red-800">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">{r("overLimitTitle")}</div>
                  <div className="text-xs">
                    {r("overLimitDesc", { amount: Math.abs(remaining).toFixed(2), cap: Number(negLimit).toFixed(2) })}
                  </div>
                </div>
              </div>
            )}
            {goingNegative && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">{r("goingNegTitle")}</div>
                  <div className="text-xs">
                    {r("goingNegDesc", { amount: Math.abs(remaining).toFixed(2) })}
                  </div>
                </div>
              </div>
            )}
            {!overLimit && !goingNegative && !isFrozen && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <div className="font-semibold">
                  {r("sufficientBalance")}
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
                  setDepartmentPayer(null);
                }}
                disabled={confirming}
              >
                {r("cancel")}
              </Button>
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-600 font-semibold"
                onClick={handleConfirm}
                disabled={confirmDisabled}
              >
                {confirming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {r("charging")}
                  </>
                ) : (
                  r("confirm", { total: total.toFixed(2) })
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
