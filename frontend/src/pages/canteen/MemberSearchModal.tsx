import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  UserCircle2,
  Building2,
  Loader2,
  AlertTriangle,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { StudentLookupResult, DepartmentLookupResult } from "./RfidPaymentModal";

interface MemberSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when a member is selected - returns the student profile */
  onSelect?: (member: StudentLookupResult) => void;
}

export function MemberSearchModal({
  open,
  onOpenChange,
  onSelect,
}: MemberSearchModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentLookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<StudentLookupResult | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setSelectedMember(null);
    }
  }, [open]);

  // Debounced search
  const searchMembers = useCallback(async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Run customer search + department search in parallel
      const [customers, depts] = await Promise.all([
        api.get<StudentLookupResult[]>(
          `/customers/search?q=${encodeURIComponent(q)}&limit=10`
        ).catch(() => [] as StudentLookupResult[]),
        api.get<DepartmentLookupResult[]>(
          `/departments/?q=${encodeURIComponent(q)}&active_only=false`
        ).catch(() => [] as DepartmentLookupResult[]),
      ]);

      // Map departments to StudentLookupResult shape using customer_kind="department"
      const deptResults: StudentLookupResult[] = depts.map((d) => ({
        id: d.id,
        name: d.department_name,
        customer_code: d.department_code,
        student_code: d.department_code,
        customer_kind: "department",
        wallet_balance: d.wallet_balance ?? 0,
        wallet_id: d.wallet_id ?? null,
      }));

      const combined = [...customers, ...deptResults];
      setResults(combined);
      if (combined.length === 0) {
        setError(t("canteen.memberSearch.noResults"));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : t("canteen.memberSearch.error"));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedQuery = useDebounce(query, 300);
  useEffect(() => {
    searchMembers(debouncedQuery);
  }, [debouncedQuery, searchMembers]);

  const handleSelect = async (member: StudentLookupResult) => {
    setSelectedMember(member);
    // Search results don't include spent_today_*. Re-fetch the full profile
    // for customers so the daily limit panel renders with live usage.
    if (member.user_id == null && member.customer_kind !== "department") {
      try {
        const full = await api.get<StudentLookupResult>(`/customers/${member.id}`);
        setSelectedMember(full);
      } catch {
        // Keep partial data — limits will show as 0 / not configured.
      }
    }
  };

  const handleConfirm = () => {
    if (selectedMember && onSelect) {
      onSelect(selectedMember);
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    setSelectedMember(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-amber-500" />
            {t("canteen.memberSearch.title")}
          </DialogTitle>
        </DialogHeader>

        {!selectedMember ? (
          // Search mode
          <div className="space-y-4">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("canteen.memberSearch.placeholder")}
                className="pl-9"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {t("canteen.memberSearch.minChars")}
            </p>

            {/* Results list */}
            {results.length > 0 && (
              <div className="max-h-80 overflow-y-auto space-y-2">
                {results.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => handleSelect(member)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl border p-3 text-left transition",
                      member.card_frozen
                        ? "border-red-200 bg-red-50 opacity-60"
                        : "border-border bg-card hover:border-amber-400 hover:bg-amber-50/50"
                    )}
                  >
                    {/* Photo / icon */}
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted flex items-center justify-center">
                      {member.customer_kind === "department" ? (
                        <Building2 className="h-7 w-7 text-rose-500" />
                      ) : member.photo_url ? (
                        <img
                          src={member.photo_url}
                          alt={member.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <UserCircle2 className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm truncate">
                          {member.name}
                        </span>
                        {member.customer_kind === "department" && (
                          <Badge className="h-4 text-[10px] px-1 bg-rose-100 text-rose-700 border-rose-200">
                            {t("canteen.memberSearch.department")}
                          </Badge>
                        )}
                        {member.grade && member.customer_kind !== "department" && (
                          <Badge variant="secondary" className="h-4 text-[10px] px-1">
                            Grade {member.grade}
                          </Badge>
                        )}
                        {member.user_id != null && (
                          <Badge className="h-4 text-[10px] px-1 bg-blue-100 text-blue-700 border-blue-200">
                            {t(`roles.${member.customer_kind}`, member.customer_kind ?? t("canteen.memberSearch.member"))}
                          </Badge>
                        )}
                        {member.card_frozen && (
                          <Badge variant="destructive" className="h-4 text-[10px] px-1">
                            Frozen
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {member.customer_kind === "department"
                          ? member.customer_code
                          : member.user_id != null ? member.customer_code : (member.student_code ?? member.customer_code)}
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          "text-sm font-bold tabular-nums",
                          (member.wallet_balance ?? 0) < 0
                            ? "text-destructive"
                            : "text-foreground"
                        )}
                      >
                        ฿{(member.wallet_balance ?? 0).toFixed(2)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Error message */}
            {error && !loading && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                {error}
              </div>
            )}

            {/* Empty state */}
            {query.length >= 2 && results.length === 0 && !loading && !error && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                {t("canteen.memberSearch.searching")}
              </div>
            )}
          </div>
        ) : (
          // Selected member detail view
          <div className="space-y-4">
            {/* Member card */}
            <div className="flex gap-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-amber-100 ring-2 ring-amber-300">
                {selectedMember.customer_kind === "department" ? (
                  <div className="flex h-full w-full items-center justify-center text-rose-500">
                    <Building2 className="h-14 w-14" />
                  </div>
                ) : selectedMember.photo_url ? (
                  <img
                    src={selectedMember.photo_url}
                    alt={selectedMember.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-amber-400">
                    <UserCircle2 className="h-16 w-16" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xl font-bold truncate">
                  {selectedMember.name}
                </div>
                <div className="text-sm text-muted-foreground">
                  {selectedMember.student_code ?? selectedMember.customer_code}
                  {selectedMember.grade && ` · Grade ${selectedMember.grade}`}
                </div>
                <div className="mt-2 text-lg font-bold tabular-nums">
                  {t("canteen.memberSearch.balance")}:{" "}
                  <span
                    className={cn(
                      (selectedMember.wallet_balance ?? 0) < 0
                        ? "text-destructive"
                        : "text-emerald-600"
                    )}
                  >
                    ฿{(selectedMember.wallet_balance ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Allergy warning */}
            {selectedMember.allergies && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">Allergies</div>
                  <div className="text-xs">{selectedMember.allergies}</div>
                </div>
              </div>
            )}

            {/* Frozen warning */}
            {selectedMember.card_frozen && (
              <div className="flex items-start gap-2 rounded-lg bg-red-100 p-3 text-sm text-red-800">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">{t("parent.dashboard.cardFrozen")}</div>
                  <div className="text-xs">
                    {t("canteen.memberSearch.cardFrozenDesc")}
                  </div>
                </div>
              </div>
            )}

            {/* Daily Spending Limit — Canteen + Store */}
            {selectedMember.customer_kind !== "department" && (() => {
              const ct = selectedMember.daily_limit_canteen ?? null;
              const ctSpent = selectedMember.spent_today_canteen ?? 0;
              const st = selectedMember.daily_limit_store ?? null;
              const stSpent = selectedMember.spent_today_store ?? 0;
              if (ct == null && st == null) return null;
              const row = (label: string, limit: number | null, spent: number) => {
                if (limit == null) return null;
                const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
                const atLimit = pct >= 100;
                const nearLimit = pct >= 80 && !atLimit;
                const txtColor = atLimit ? "text-red-600" : nearLimit ? "text-amber-600" : "text-emerald-700";
                const barColor = atLimit ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground font-medium">{label}</span>
                      <span className={cn("text-base font-bold tabular-nums", txtColor)}>
                        ฿{spent.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        <span className="text-muted-foreground font-normal"> / </span>
                        ฿{limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              };
              return (
                <div className="rounded-2xl border border-border bg-card p-3 space-y-3 text-sm">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Daily Spending Limit
                  </div>
                  {row("Canteen", ct, ctSpent)}
                  {row("Store", st, stSpent)}
                </div>
              );
            })()}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setSelectedMember(null)}
              >
                <X className="h-4 w-4 mr-1" />
                {t("canteen.memberSearch.searchAgain")}
              </Button>
              {onSelect && (
                <Button
                  className="flex-1 bg-amber-500 hover:bg-amber-600"
                  onClick={handleConfirm}
                  disabled={selectedMember.card_frozen}
                >
                  {t("canteen.memberSearch.selectMember")}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
