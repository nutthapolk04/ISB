import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fmtDate, fmtTime } from "@/lib/dateFormat";
import {
  AlertCircle, ArrowUpCircle, ArrowDownCircle, Bell,
  ChevronRight, GraduationCap, Lock, RefreshCw,
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
  role: string | null;
  photo_url: string | null;
}

interface CoParentSummary {
  user_id: number;
  full_name: string;
  relation?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  photo_url?: string | null;
  username?: string | null;
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
  role: string;
  photoUrl: string | null;
  walletId: number | null;
  customerId?: number | null;
  cardFrozen?: boolean;
  allergies?: string | null;
  grade?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

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
      "flex items-center gap-3 rounded-2xl border bg-white p-3.5 transition-colors",
      disabled ? "opacity-40 pointer-events-none" : "hover:bg-slate-50 active:bg-slate-100",
    )}>
      <div className="shrink-0">{icon}</div>
      <span className="flex-1 text-sm font-medium text-slate-700">{label}</span>
      <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
    </div>
  );
  if (disabled) return inner;
  return <Link to={to}>{inner}</Link>;
}

function TxIcon({ isCredit }: { isCredit: boolean }) {
  return isCredit
    ? <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100"><ArrowUpCircle className="h-5 w-5 text-green-600" /></div>
    : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100"><ArrowDownCircle className="h-5 w-5 text-orange-500" /></div>;
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
  const [activeIdx, setActiveIdx] = useState(0);
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

  const cards: FamilyCard[] = [
    ...(ownWallet
      ? [{
          kind: "self" as const,
          name: ownWallet.name ?? user?.username ?? "",
          balance: ownWallet.balance,
          code: ownWallet.username ?? "",
          role: t("roles.parent", "Parent / Guardian"),
          photoUrl: ownWallet.photo_url,
          walletId: ownWallet.id,
        }]
      : []),
    ...coParents.map((cp) => ({
      kind: "coparent" as const,
      name: cp.full_name,
      balance: cp.wallet_balance ?? 0,
      code: cp.username ?? "",
      role: t("roles.parent", "Parent / Guardian"),
      photoUrl: cp.photo_url ?? null,
      walletId: cp.wallet_id ?? null,
    })),
    ...children.map((ch) => ({
      kind: "child" as const,
      name: ch.name,
      balance: ch.wallet_balance ?? 0,
      code: ch.student_code ?? ch.customer_code,
      role: t("roles.student", "Student"),
      photoUrl: ch.photo_url ?? null,
      walletId: ch.wallet_id ?? null,
      customerId: ch.customer_id,
      cardFrozen: ch.card_frozen,
      allergies: ch.allergies,
      grade: ch.grade,
    })),
  ];

  // Fetch transactions for active card
  useEffect(() => {
    const card = cards[activeIdx];
    if (!card?.walletId) { setTxs([]); return; }
    setTxLoading(true);
    api.get<WalletTransaction[]>(`/wallets/${card.walletId}/transactions?limit=5`)
      .then((data) => setTxs(data.slice(0, 5)))
      .catch(() => setTxs([]))
      .finally(() => setTxLoading(false));
    // cards array rebuilt every render; use walletId + activeIdx as key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, loading]);

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

  const now = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const dateStr = new Date().toLocaleDateString(i18n.language === "th" ? "th-TH" : "en-US", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
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

        <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 p-5 shadow-lg relative overflow-hidden">
          <div className="absolute right-16 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold text-white truncate">{studentWallet.name}</p>
              </div>
              <div className="shrink-0 flex h-16 w-16 items-center justify-center rounded-full bg-blue-400/40 border-2 border-white/20">
                <UserRound className="h-8 w-8 text-white/60" />
              </div>
            </div>
            <p className="text-xs text-blue-200 mt-3">{t("parent.dashboard.balance", "ยอดเงินคงเหลือ")} (บาท)</p>
            <p className="text-3xl font-extrabold text-white mt-0.5 tabular-nums">{formatTHB(studentWallet.balance)}</p>
            {studentWallet.username && <p className="text-xs text-blue-200 mt-2">{studentWallet.username}</p>}
            <p className="text-xs text-blue-300 mt-0.5 flex items-center gap-1">
              <RefreshCw className="h-2.5 w-2.5" />Updated at {now}
            </p>
            <div className="flex justify-end mt-2">
              <span className="bg-white/20 text-white text-xs rounded-full px-2.5 py-0.5">{t("roles.student", "นักเรียน")}</span>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-700 mb-3">{t("parent.dashboard.actions", "การดำเนินการ")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <ActionButton
              icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100"><WalletIcon className="h-5 w-5 text-blue-600" /></div>}
              label={t("parent.dashboard.topup", "เติมเงิน")}
              to={`/parent/wallet/${studentWallet.customer_id}`}
            />
            <ActionButton
              icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100"><GraduationCap className="h-5 w-5 text-green-600" /></div>}
              label={t("parent.dashboard.profile", "โปรไฟล์")}
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
          {/* Peek carousel */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="-mx-4 flex gap-3 overflow-x-auto px-4"
            style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
          >
            {cards.map((card, idx) => (
              <div
                key={idx}
                className="shrink-0 min-w-[calc(100%-2.5rem)] rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 p-5 shadow-lg relative overflow-hidden"
                style={{ scrollSnapAlign: "start" }}
              >
                <div className="absolute right-16 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />

                <div className="relative z-10">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-bold text-white truncate">{card.name}</p>
                      {card.cardFrozen && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-300 mt-0.5">
                          <Lock className="h-3 w-3" /> Card Frozen
                        </span>
                      )}
                    </div>
                    <div className="shrink-0">
                      {card.photoUrl ? (
                        <img src={card.photoUrl} alt={card.name} className="h-16 w-16 rounded-full object-cover border-2 border-white/30" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-400/40 border-2 border-white/20">
                          <UserRound className="h-8 w-8 text-white/60" />
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-blue-200 mt-3">{t("parent.dashboard.balance", "ยอดเงินคงเหลือ")} (บาท)</p>
                  <p className="text-3xl font-extrabold text-white mt-0.5 tabular-nums">
                    {card.balance !== null ? formatTHB(card.balance) : "—"}
                  </p>
                  {card.code && <p className="text-xs text-blue-200 mt-2">{card.code}</p>}
                  {card.grade && (
                    <p className="text-xs text-blue-300 mt-0.5 flex items-center gap-1">
                      <GraduationCap className="h-2.5 w-2.5" />{card.grade}
                    </p>
                  )}
                  <p className="text-xs text-blue-300 mt-0.5 flex items-center gap-1">
                    <RefreshCw className="h-2.5 w-2.5" />Updated at {now}
                  </p>
                  <div className="flex justify-end mt-2">
                    <span className="bg-white/20 text-white text-xs rounded-full px-2.5 py-0.5">{card.role}</span>
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
              <p className="text-sm font-semibold text-slate-700 mb-3">{t("parent.dashboard.actions", "การดำเนินการ")}</p>
              <div className="grid grid-cols-2 gap-2.5">
                {/* เติมเงิน — all card types */}
                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100"><WalletIcon className="h-5 w-5 text-blue-600" /></div>}
                  label={t("parent.dashboard.topup", "เติมเงิน")}
                  to={
                    activeCard.kind === "self" ? "/parent/wallet/own" :
                    activeCard.kind === "coparent" ? `/parent/wallet/wallet-${activeCard.walletId}` :
                    `/parent/wallet/${activeCard.customerId}`
                  }
                  disabled={activeCard.kind !== "self" && !activeCard.walletId}
                />

                {/* โปรไฟล์ (child) / ประวัติ (self/coparent) */}
                {activeCard.kind === "child" ? (
                  <ActionButton
                    icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100"><GraduationCap className="h-5 w-5 text-green-600" /></div>}
                    label={t("parent.dashboard.profile", "โปรไฟล์")}
                    to={`/parent/profile/${activeCard.customerId}`}
                  />
                ) : (
                  <ActionButton
                    icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100"><GraduationCap className="h-5 w-5 text-green-600" /></div>}
                    label={t("parent.dashboard.history", "ประวัติ")}
                    to={
                      activeCard.kind === "self" ? "/parent/wallet/own?tab=history" :
                      `/parent/wallet/wallet-${activeCard.walletId}?tab=history`
                    }
                    disabled={activeCard.kind !== "self" && !activeCard.walletId}
                  />
                )}

                {/* แจ้งเตือน (child only) */}
                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100"><Bell className="h-5 w-5 text-purple-600" /></div>}
                  label={t("parent.dashboard.alerts", "แจ้งเตือน")}
                  to={activeCard.kind === "child" ? `/parent/alerts/${activeCard.customerId}` : "#"}
                  disabled={activeCard.kind !== "child"}
                />

                {/* ตั้งค่า (child only — leads to StudentProfile which has card freeze) */}
                <ActionButton
                  icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100"><Settings className="h-5 w-5 text-orange-500" /></div>}
                  label={t("parent.dashboard.settings", "ตั้งค่า")}
                  to={activeCard.kind === "child" ? `/parent/profile/${activeCard.customerId}` : "#"}
                  disabled={activeCard.kind !== "child"}
                />
              </div>
            </div>
          )}

          {/* Recent transactions */}
          {activeCard?.walletId && (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-700">{t("parent.dashboard.recentTx", "รายการล่าสุด")}</p>
                {activeCard.kind === "child" && activeCard.customerId && (
                  <Link to={`/parent/transactions/${activeCard.customerId}`} className="text-sm text-blue-600">
                    {t("parent.dashboard.viewAll", "ดูทั้งหมด")}
                  </Link>
                )}
                {activeCard.kind === "self" && (
                  <Link to="/parent/wallet/own?tab=history" className="text-sm text-blue-600">
                    {t("parent.dashboard.viewAll", "ดูทั้งหมด")}
                  </Link>
                )}
                {activeCard.kind === "coparent" && activeCard.walletId && (
                  <Link to={`/parent/wallet/wallet-${activeCard.walletId}?tab=history`} className="text-sm text-blue-600">
                    {t("parent.dashboard.viewAll", "ดูทั้งหมด")}
                  </Link>
                )}
              </div>

              <Card>
                <CardContent className="p-0">
                  {txLoading && (
                    <div className="space-y-px">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-3">
                          <div className="h-9 w-9 rounded-full bg-slate-100 animate-pulse shrink-0" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3.5 w-24 rounded bg-slate-100 animate-pulse" />
                            <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
                          </div>
                          <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
                        </div>
                      ))}
                    </div>
                  )}

                  {!txLoading && txs.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-slate-400">
                      {t("parent.dashboard.noTx", "ยังไม่มีรายการ")}
                    </p>
                  )}

                  {!txLoading && txs.map((tx, i) => {
                    const isCredit = tx.balance_after > tx.balance_before;
                    const typeLabel = tx.transaction_type === "topup" || isCredit
                      ? t("parent.transactions.txTopup", "top-up")
                      : tx.transaction_type === "refund"
                      ? t("parent.transactions.txRefund", "refund")
                      : t("parent.transactions.txDeduction", "purchase");
                    const shopLabel = tx.shop_name ?? tx.description ?? typeLabel;
                    return (
                      <div
                        key={tx.id}
                        className={cn("flex items-center gap-3 px-4 py-3", i < txs.length - 1 && "border-b border-slate-100")}
                      >
                        <TxIcon isCredit={isCredit} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{shopLabel}</p>
                          <p className="text-xs text-slate-400">{fmtDate(tx.created_at)} · {fmtTime(tx.created_at)}</p>
                        </div>
                        <p className={cn("text-sm font-semibold tabular-nums shrink-0", isCredit ? "text-green-600" : "text-red-500")}>
                          {isCredit ? "+" : ""}{formatTHB(Math.abs(tx.amount))}
                        </p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
