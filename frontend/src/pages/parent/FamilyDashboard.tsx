import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fmtDate, fmtTime } from "@/lib/dateFormat";
import { formatCurrency as formatTHB } from "@/lib/format";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
import {
  AlertCircle, ArrowLeftRight, ArrowUpCircle, ArrowDownCircle, Bell,
  ChevronLeft, ChevronRight, GraduationCap, Lock,
  Settings, UserRound, Wallet as WalletIcon,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GroupUsage {
  spending_group_id: number;
  code: string;
  name_en: string;
  name_th: string;
  daily_limit: number;
  spent_today: number;
  remaining: number;
}

interface ChildSummary {
  link_id: number;
  relation: string;
  customer_id: number;
  customer_code: string;
  student_code?: string | null;
  card_uid?: string | null;
  name: string;
  grade?: string | null;
  photo_url?: string | null;
  allergies?: string | null;
  card_frozen: boolean;
  wallet_id?: number | null;
  wallet_balance?: number | null;
}

interface OwnWallet {
  id: number;
  owner_type: "user" | "customer";
  user_id: number | null;
  customer_id?: number | null;
  balance: number;
  name: string | null;
  username: string | null;
  customer_code: string | null;
  student_code: string | null;
  card_uid: string | null;
  role: string | null;
  photo_url: string | null;
}

interface CoParentSummary {
  user_id: number;
  full_name: string;
  relation?: string | null;
  role?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  photo_url?: string | null;
  username?: string | null;
  card_uid?: string | null;
}

interface WalletTransaction {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description?: string | null;
  shop_name?: string | null;
  created_at: string;
}

type CardKind = "self" | "coparent" | "child";

interface FamilyCard {
  kind: CardKind;
  name: string;
  balance: number | null;
  code: string;
  cardUid?: string | null;
  role: string;          // display label e.g. "Parent / Guardian"
  userRole: string;      // raw role for color lookup: parent/staff/student/admin
  photoUrl: string | null;
  walletId: number | null;
  customerId?: number | null;
  cardFrozen?: boolean;
  allergies?: string | null;
  grade?: string | null;
}


// Role-based card colors — single source of truth: users.role
// parent → purple, staff → teal, student → orange, fallback → teal
const ROLE_STYLES: Record<string, React.CSSProperties> = {
  parent: { background: "linear-gradient(135deg, #3b1f7e 0%, #6b3fa0 50%, #9b6fcf 100%)" },
  staff: { background: "linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #2dd4bf 100%)" },
  student: { background: "linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)" },
};
const getRoleStyle = (role: string | null | undefined): React.CSSProperties =>
  ROLE_STYLES[role || ""] ?? ROLE_STYLES.staff;

const maskData = (s: string | null | undefined): string => {
  if (!s) return "****";
  const str = String(s);
  if (str.length <= 4) return str;
  return "****" + str.slice(-4);
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ChildTodayActivity({ customerId }: { customerId: number }) {
  const { t, i18n } = useTranslation();
  const [groups, setGroups] = useState<GroupUsage[] | null>(null);

  useEffect(() => {
    api
      .get<GroupUsage[]>(`/spending-groups/usage-today/by-child?customer_id=${customerId}`)
      .then((data) => setGroups(data))
      .catch(() => setGroups([]));
  }, [customerId]);

  if (groups === null || groups.length === 0) return null;
  if (groups.every((g) => g.spent_today === 0)) return null;

  const fmt = (n: number) => "฿" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="rounded-md border bg-white/10 p-2.5 space-y-2 mt-3">
      <p className="text-xs font-semibold text-blue-200">{t("parent.dashboard.todayActivity")}</p>
      {groups.map((g) => {
        const pct = g.daily_limit > 0 ? (g.spent_today / g.daily_limit) * 100 : 0;
        const atLimit = pct >= 100;
        const nearLimit = pct >= 80 && !atLimit;
        const name = i18n.language === "th" ? g.name_th : g.name_en;
        return (
          <div key={g.spending_group_id} className="space-y-0.5">
            <div className="flex items-center justify-between text-[0.7rem]">
              <span className="font-medium truncate text-white/80">{name}</span>
              <span className={cn("font-mono tabular-nums shrink-0 ml-2 text-white/80", atLimit && "text-red-300 font-bold", nearLimit && "text-amber-300")}>
                {t("parent.dashboard.todaySpentVsLimit", { spent: fmt(g.spent_today), limit: fmt(g.daily_limit) })}
              </span>
            </div>
            <Progress
              value={Math.min(pct, 100)}
              className={cn("h-1.5 bg-white/20", atLimit ? "[&>div]:bg-red-400" : nearLimit ? "[&>div]:bg-amber-400" : "[&>div]:bg-white/70")}
            />
          </div>
        );
      })}
    </div>
  );
}

function ActionButton({ icon, label, to, disabled = false }: { icon: React.ReactNode; label: string; to: string; disabled?: boolean }) {
  const inner = (
    <div className={cn(
      "flex items-center gap-3 rounded-2xl border bg-white p-4 transition-colors",
      disabled ? "opacity-40 pointer-events-none" : "hover:bg-slate-50 active:bg-slate-100",
    )}>
      <div className="shrink-0">{icon}</div>
      <span className="flex-1 text-base font-bold text-slate-800">{label}</span>
      <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
    </div>
  );
  if (disabled) return inner;
  return <Link to={to}>{inner}</Link>;
}

function TxIcon({ isCredit }: { isCredit: boolean }) {
  return isCredit
    ? <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 shadow-sm"><ArrowUpCircle className="h-5 w-5 text-green-600" /></div>
    : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 shadow-sm"><ArrowDownCircle className="h-5 w-5 text-orange-500" /></div>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FamilyDashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isStudent = user?.role === "student";

  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [ownWallet, setOwnWallet] = useState<OwnWallet | null>(null);
  const [studentWallet, setStudentWallet] = useState<OwnWallet | null>(null);
  const [coParents, setCoParents] = useState<CoParentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Persist active card index across navigation (e.g., user opens wallet,
  // navigates back — should land on the same card, not card #1).
  const FAMILY_ACTIVE_IDX_KEY = "isb:family-dashboard:activeIdx";
  const [activeIdx, setActiveIdx] = useState(() => {
    if (typeof window === "undefined") return 0;
    const raw = sessionStorage.getItem(FAMILY_ACTIVE_IDX_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  useEffect(() => {
    sessionStorage.setItem(FAMILY_ACTIVE_IDX_KEY, String(activeIdx));
  }, [activeIdx]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recent transactions for the active card
  const [txs, setTxs] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (isStudent) {
          const mine = await api.get<OwnWallet | null>("/wallets/me").catch(() => null);
          if (mine) setStudentWallet(mine);
        } else {
          const [data, mine, coParentData] = await Promise.all([
            api.get<ChildSummary[]>("/family/me"),
            api.get<OwnWallet | null>("/wallets/me").catch(() => null),
            api.get<CoParentSummary[]>("/family/me/coparents").catch(() => []),
          ]);
          setChildren(data);
          if (mine && mine.owner_type === "user") setOwnWallet(mine);
          setCoParents(coParentData);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.detail : "Failed to load family");
      } finally {
        setLoading(false);
      }
    })();
  }, [isStudent]);

  const roleLabel = (r: string | null | undefined): string => {
    if (r === "student") return t("roles.student", "Student");
    if (r === "staff") return t("roles.staff", "Staff");
    if (r === "admin") return t("roles.admin", "Admin");
    if (r === "manager") return t("roles.manager", "Manager");
    if (r === "cashier") return t("roles.cashier", "Cashier");
    if (r === "kitchen") return t("roles.kitchen", "Kitchen");
    return t("roles.parent", "Parent / Guardian");
  };

  const cards: FamilyCard[] = [
    ...(ownWallet
      ? [{
          kind: "self" as const,
          name: ownWallet.name ?? user?.username ?? "",
          balance: ownWallet.balance,
          code: ownWallet.student_code ?? ownWallet.customer_code ?? ownWallet.username ?? "",
          cardUid: ownWallet.card_uid,
          role: roleLabel(user?.role),
          userRole: user?.role ?? "parent",
          photoUrl: ownWallet.photo_url,
          walletId: ownWallet.id,
        }]
      : []),
    ...coParents.map((cp) => ({
      kind: "coparent" as const,
      name: cp.full_name,
      balance: cp.wallet_balance ?? 0,
      code: cp.username ?? "",
      cardUid: cp.card_uid ?? undefined,
      role: roleLabel(cp.role),
      userRole: cp.role ?? "parent",
      photoUrl: cp.photo_url ?? null,
      walletId: cp.wallet_id ?? null,
    })),
    ...children.map((ch) => ({
      kind: "child" as const,
      name: ch.name,
      balance: ch.wallet_balance ?? 0,
      code: ch.student_code ?? ch.customer_code,
      cardUid: ch.card_uid,
      role: t("roles.student", "Student"),
      userRole: "student",
      photoUrl: ch.photo_url ?? null,
      walletId: ch.wallet_id ?? null,
      customerId: ch.customer_id,
      cardFrozen: ch.card_frozen,
      allergies: ch.allergies,
      grade: ch.grade,
    })),
  ];

  // Clamp activeIdx if cards shrinks (e.g. coparent unlinked mid-session).
  // CRITICAL: skip while loading — cards starts at length 0 and a saved
  // activeIdx from sessionStorage would get wiped to 0 before the real
  // cards array arrives, defeating the persistence.
  useEffect(() => {
    if (loading || cards.length === 0) return;
    if (activeIdx >= cards.length) {
      setActiveIdx(cards.length - 1);
    }
  }, [loading, cards.length, activeIdx]);

  // Scroll carousel to restored activeIdx once cards have rendered (one-shot on mount/load).
  useEffect(() => {
    if (loading || cards.length === 0 || activeIdx === 0) return;
    if (!scrollRef.current?.firstElementChild) return;
    const cardW = (scrollRef.current.firstElementChild as HTMLElement).offsetWidth + 12;
    scrollRef.current.scrollTo({ left: activeIdx * cardW, behavior: "auto" });
    // run once after first render with data; subsequent scrolls are handled by user input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cards.length]);

  // Fetch transactions for active card
  useEffect(() => {
    const card = cards[activeIdx];
    if (!card?.walletId) { setTxs([]); return; }
    setTxLoading(true);
    api.get<WalletTransaction[]>(`/wallets/${card.walletId}/transactions?limit=5`)
      .then((data) => setTxs(data.slice(0, 5)))
      .catch(() => setTxs([]))
      .finally(() => setTxLoading(false));
    // cards array rebuilt every render; depend on walletId + activeIdx instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, cards[activeIdx]?.walletId]);

  const getCardWidth = () => {
    if (!scrollRef.current || !scrollRef.current.firstElementChild) return scrollRef.current?.offsetWidth ?? 0;
    return (scrollRef.current.firstElementChild as HTMLElement).offsetWidth + 12;
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const cardW = getCardWidth();
    if (!cardW) return;
    const idx = Math.round(scrollRef.current.scrollLeft / cardW);
    setActiveIdx(Math.max(0, Math.min(idx, cards.length - 1)));
  };

  const scrollTo = (idx: number) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ left: idx * getCardWidth(), behavior: "smooth" });
    setActiveIdx(idx);
  };

  const dateStr = new Date().toLocaleDateString(i18n.language === "th" ? "th-TH" : "en-US", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", calendar: "gregory",
  });

  const displayName = ownWallet?.name ?? studentWallet?.name ?? user?.username ?? "";
  const activeCard = cards[activeIdx] ?? null;

  // ── Student view ────────────────────────────────────────────────────────────
  if (isStudent && studentWallet) {
    return (
      <div className="page-shell">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-800">{studentWallet.name ?? user?.username}</h2>
          <p className="text-sm text-slate-500">{dateStr}</p>
        </div>

        <div className="rounded-2xl p-4 shadow-lg relative overflow-hidden" style={getRoleStyle("student")}>
          <span className="absolute top-3 right-3 z-20 bg-white/25 border border-white/40 text-white text-[0.6rem] font-bold uppercase tracking-wider rounded-full px-2.5 py-0.5">
            {t("parent.dashboard.typeChild", "Child's")}
          </span>
          <div className="absolute right-10 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/15 pointer-events-none" />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/15 pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-start gap-3 pr-20">
              <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-full bg-white/25 border-2 border-white/40 shadow-md">
                <UserRound className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-white truncate">{studentWallet.name}</p>
                <span className="inline-block bg-white/25 border border-white/40 text-white text-[0.6rem] font-bold uppercase tracking-wider rounded-full px-2 py-0 mt-1">
                  {t("roles.student", "Student")}
                </span>
                <p className="text-[0.7rem] text-white/80 mt-1">{t("parent.dashboard.balanceUnit", "Current Balance (Baht)")}</p>
              </div>
            </div>
            <div className="text-center my-3">
              <span className="text-3xl font-extrabold text-white tabular-nums">{formatTHB(studentWallet.balance)}</span>
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="bg-white/20 text-white/90 text-[0.65rem] rounded-full px-2.5 py-0.5">
                {t("parent.dashboard.idNumber", "ID Number")}: {studentWallet.student_code ?? studentWallet.customer_code ?? "—"}
              </span>
              <span className="bg-white/20 text-white/90 text-[0.65rem] rounded-full px-2.5 py-0.5">
                {t("parent.dashboard.idCard", "ID Card")}: {studentWallet.card_uid ?? "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-base font-semibold text-slate-800 mb-3">{t("parent.dashboard.actions", "Actions")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <ActionButton
              icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100"><WalletIcon className="h-5 w-5 text-blue-600" /></div>}
              label={t("parent.dashboard.topUp", "Top up")}
              to={`/parent/wallet/${studentWallet.customer_id}`}
            />
            <ActionButton
              icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100"><GraduationCap className="h-5 w-5 text-green-600" /></div>}
              label={t("parent.dashboard.profile", "Profile")}
              to={`/parent/profile/${studentWallet.customer_id}`}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Parent view ─────────────────────────────────────────────────────────────
  return (
    <div className="page-shell">
      {/* Header: user name + date */}
      {loading ? (
        <div className="mb-5">
          <div className="h-7 w-40 rounded-md bg-slate-200 animate-pulse mb-1.5" />
          <div className="h-4 w-56 rounded-md bg-slate-100 animate-pulse" />
        </div>
      ) : (
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-800">{displayName}</h2>
          <p className="text-sm text-slate-500">{dateStr}</p>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 p-4 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {loading && <div className="h-44 rounded-2xl bg-blue-200 animate-pulse" />}

      {!loading && !error && cards.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t("parent.dashboard.noChildren")}
          </CardContent>
        </Card>
      )}

      {!loading && !error && cards.length > 0 && (
        <>
          {/* Peek carousel — overflow-hidden wrapper prevents page-width blowout */}
          <div className="relative overflow-hidden">
          {cards.length > 1 && activeIdx > 0 && (
            <button
              type="button"
              onClick={() => scrollTo(activeIdx - 1)}
              aria-label={t("parent.dashboard.prevCard", "Previous card")}
              className="absolute left-1 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 shadow-md backdrop-blur hover:bg-white"
            >
              <ChevronLeft className="h-5 w-5 text-slate-700" />
            </button>
          )}
          {cards.length > 1 && activeIdx < cards.length - 1 && (
            <button
              type="button"
              onClick={() => scrollTo(activeIdx + 1)}
              aria-label={t("parent.dashboard.nextCard", "Next card")}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 shadow-md backdrop-blur hover:bg-white"
            >
              <ChevronRight className="h-5 w-5 text-slate-700" />
            </button>
          )}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex gap-3 overflow-x-auto"
            style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
          >
            {cards.map((card, idx) => (
              <div
                key={idx}
                className="shrink-0 min-w-[calc(100%-3rem)] rounded-2xl p-4 shadow-lg relative overflow-hidden"
                style={{ scrollSnapAlign: "start", ...getRoleStyle(card.userRole) }}
              >
                <span className="absolute top-3 right-3 z-20 bg-white/25 border border-white/40 text-white text-[0.6rem] font-bold uppercase tracking-wider rounded-full px-2.5 py-0.5">
                  {card.kind === "child" ? t("parent.dashboard.typeChild", "Child's") : t("parent.dashboard.typePersonal", "Personal")}
                </span>
                <div className="absolute right-10 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/15 pointer-events-none" />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/15 pointer-events-none" />

                <div className="relative z-10">
                  <div className="flex items-start gap-3 pr-20">
                    <div className="shrink-0">
                      <img
                        src={resolveAvatarUrl(card.photoUrl, card.name || card.code)}
                        alt={card.name}
                        className="h-12 w-12 rounded-full object-cover border-2 border-white/30"
                        onError={(e) => { e.currentTarget.src = getFallbackAvatar(card.name || card.code); }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-white truncate">{card.name}</p>
                      <span className="inline-block bg-white/25 border border-white/40 text-white text-[0.6rem] font-bold uppercase tracking-wider rounded-full px-2 py-0 mt-1">
                        {card.role}
                      </span>
                      <p className="text-[0.7rem] text-white/80 mt-1">{t("parent.dashboard.balanceUnit", "Current Balance (Baht)")}</p>
                      {card.cardFrozen && (
                        <span className="inline-flex items-center gap-1 text-[0.7rem] text-red-200 mt-1">
                          <Lock className="h-3 w-3" /> {t("parent.dashboard.cardFrozen", "Card frozen")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-center my-3">
                    <span className="text-3xl font-extrabold text-white tabular-nums">
                      {card.balance !== null ? formatTHB(card.balance) : "—"}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span className="bg-white/20 text-white/90 text-[0.65rem] rounded-full px-2.5 py-0.5">
                      {t("parent.dashboard.idNumber", "ID Number")}: {card.code || "—"}
                    </span>
                    <span className="bg-white/20 text-white/90 text-[0.65rem] rounded-full px-2.5 py-0.5">
                      {t("parent.dashboard.idCard", "ID Card")}: {card.cardUid ?? "—"}
                    </span>
                  </div>
                </div>

                {card.kind === "child" && card.customerId && (
                  <ChildTodayActivity customerId={card.customerId} />
                )}

                {card.allergies && (
                  <div className="flex items-start gap-2 rounded-md bg-red-900/30 border border-red-400/30 p-2 text-xs text-red-200 mt-3 relative z-10">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-300" />
                    <span>{t("parent.dashboard.allergies", { items: card.allergies })}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          </div>{/* end overflow-hidden wrapper */}

          {/* Dots */}
          {cards.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-3">
              {cards.map((_, i) => (
                <button
                  key={i}
                  onClick={() => scrollTo(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === activeIdx ? "w-5 bg-blue-600" : "w-1.5 bg-slate-300",
                  )}
                />
              ))}
            </div>
          )}

          {/* Action buttons */}
          {activeCard && (
            <div className="mt-5">
              <p className="text-base font-semibold text-slate-800 mb-3">{t("parent.dashboard.actions", "Actions")}</p>
              <div className="grid grid-cols-2 gap-2.5">
                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100"><WalletIcon className="h-5 w-5 text-blue-600" /></div>}
                  label={t("parent.dashboard.topUp", "Top up")}
                  to={
                    activeCard.kind === "self" ? "/parent/wallet/own" :
                    activeCard.kind === "coparent" ? `/parent/wallet/wallet-${activeCard.walletId}` :
                    `/parent/wallet/${activeCard.customerId}`
                  }
                  disabled={activeCard.kind === "child" && !activeCard.walletId}
                />

                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100"><ArrowLeftRight className="h-5 w-5 text-indigo-600" /></div>}
                  label={t("parent.dashboard.transfer", "Transfer")}
                  to="/parent/transfer"
                />

                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100"><GraduationCap className="h-5 w-5 text-green-600" /></div>}
                  label={t("parent.dashboard.history", "History")}
                  to={
                    activeCard.kind === "self" ? "/parent/transactions/own" :
                    activeCard.kind === "child" && activeCard.walletId ? `/parent/transactions/wallet-${activeCard.walletId}` :
                    `/parent/transactions/wallet-${activeCard.walletId}`
                  }
                  disabled={activeCard.kind !== "self" && !activeCard.walletId}
                />

                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100"><Bell className="h-5 w-5 text-purple-600" /></div>}
                  label={t("parent.dashboard.alerts", "Alerts")}
                  to={activeCard.kind === "child" ? `/parent/alerts/${activeCard.customerId}` : "#"}
                  disabled={activeCard.kind !== "child"}
                />

                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100"><Settings className="h-5 w-5 text-orange-500" /></div>}
                  label={t("parent.dashboard.settings", "Settings")}
                  to={activeCard.kind === "child" ? `/parent/settings/${activeCard.customerId}` : "#"}
                  disabled={activeCard.kind !== "child"}
                />

                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100"><GraduationCap className="h-5 w-5 text-green-600" /></div>}
                  label={t("parent.dashboard.profile", "Profile")}
                  to={activeCard.kind === "child" ? `/parent/profile/${activeCard.customerId}` : "#"}
                  disabled={activeCard.kind !== "child"}
                />
              </div>
            </div>
          )}

          {/* Recent transactions */}
          {activeCard?.walletId && (
            <div className="mt-5">
              <div className="mb-3">
                <p className="text-base font-semibold text-slate-800">{t("parent.dashboard.recentActivity", "Recent activity")}</p>
              </div>

              <div className="space-y-2.5">
                {txLoading && (
                  [...Array(3)].map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-slate-100 animate-pulse shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 w-24 rounded bg-slate-100 animate-pulse" />
                        <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
                      </div>
                      <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
                    </div>
                  ))
                )}

                {!txLoading && txs.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-400">
                    {t("parent.dashboard.noTx", "No transactions yet")}
                  </p>
                )}

                {!txLoading && txs.map((tx) => {
                  const isCredit = tx.balance_after > tx.balance_before;
                  const typeLabel = tx.transaction_type === "topup" || isCredit
                    ? t("parent.transactions.txTopup", "Top up")
                    : tx.transaction_type === "refund"
                    ? t("parent.transactions.txRefund", "Refund")
                    : t("parent.transactions.txDeduction", "Purchase");
                  const shopName = tx.shop_name;
                  const desc = tx.description;
                  const time = fmtTime(tx.created_at);
                  return (
                    <div
                      key={tx.id}
                      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4"
                    >
                      <div className="flex items-start gap-3">
                        <TxIcon isCredit={isCredit} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-bold text-gray-900 leading-tight">
                              {typeLabel}
                              {shopName && <span className="font-normal text-gray-400"> — {shopName}</span>}
                            </p>
                            <span className={cn("text-base font-bold tabular-nums shrink-0 leading-tight", isCredit ? "text-emerald-600" : "text-red-500")}>
                              {isCredit ? "+" : "-"}฿{Math.abs(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          {desc && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{desc}</p>}
                          <p className="text-xs text-gray-400 mt-1">{time}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
