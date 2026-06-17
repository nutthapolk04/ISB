import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AlertCircle, ChevronLeft, ChevronRight, GraduationCap, Lock, UserRound, Wallet as WalletIcon, History, RefreshCw, Receipt } from "lucide-react";

interface GroupUsage {
  spending_group_id: number;
  code: string;
  name_en: string;
  name_th: string;
  daily_limit: number;
  spent_today: number;
  remaining: number;
}

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

  const formatTHB = (n: number) =>
    "฿" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

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
                {t("parent.dashboard.todaySpentVsLimit", { spent: formatTHB(g.spent_today), limit: formatTHB(g.daily_limit) })}
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
  parent_rank?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  photo_url?: string | null;
  username?: string | null;
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

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

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

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, offsetWidth } = scrollRef.current;
    const idx = Math.round(scrollLeft / offsetWidth);
    setActiveIdx(Math.max(0, Math.min(idx, cards.length - 1)));
  };

  const scrollTo = (idx: number) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ left: idx * scrollRef.current.offsetWidth, behavior: "smooth" });
    setActiveIdx(idx);
  };

  const now = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const dateStr = new Date().toLocaleDateString(i18n.language === "th" ? "th-TH" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const activeCard = cards[activeIdx] ?? null;

  if (isStudent && studentWallet) {
    return (
      <div className="page-shell">
        <p className="text-sm text-slate-400 mb-4">{dateStr}</p>
        <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 p-5 shadow-lg relative overflow-hidden">
          <div className="absolute right-16 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />
          <div className="flex items-start justify-between relative z-10">
            <div className="flex-1 min-w-0">
              <p className="text-xl font-bold text-white truncate">{studentWallet.name}</p>
              <p className="text-xs text-blue-200 mt-1">{t("parent.dashboard.balance", "Balance")}</p>
              <p className="text-3xl font-extrabold text-white mt-1 tabular-nums">{formatTHB(studentWallet.balance)}</p>
              {studentWallet.username && <p className="text-xs text-blue-200 mt-2">{studentWallet.username}</p>}
              <p className="text-xs text-blue-300 mt-0.5 flex items-center gap-1">
                <RefreshCw className="h-2.5 w-2.5" />Updated at {now}
              </p>
              <span className="mt-2 inline-block bg-white/20 text-white text-xs rounded-full px-2.5 py-0.5">
                {t("roles.student", "นักเรียน")}
              </span>
            </div>
            <div className="ml-4 shrink-0 flex h-16 w-16 items-center justify-center rounded-full bg-blue-400/40 border-2 border-white/20">
              <UserRound className="h-8 w-8 text-white/60" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Button asChild variant="outline" className="h-11">
            <Link to={`/parent/wallet/${studentWallet.customer_id}`}><WalletIcon className="h-4 w-4 mr-1.5" />Top up</Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to={`/parent/transactions/${studentWallet.customer_id}`}><History className="h-4 w-4 mr-1.5" />History</Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to={`/parent/profile/${studentWallet.customer_id}`}><Receipt className="h-4 w-4 mr-1.5" />Profile</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <p className="text-sm text-slate-400 mb-4">{dateStr}</p>

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 p-4 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="h-44 rounded-2xl bg-blue-200 animate-pulse" />
      )}

      {!loading && !error && cards.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t("parent.dashboard.noChildren")}
          </CardContent>
        </Card>
      )}

      {!loading && !error && cards.length > 0 && (
        <>
          {/* Carousel — arrows overlaid inside the card so they never clip */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex items-start overflow-x-auto"
            style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
          >
            {cards.map((card, idx) => (
              <div
                key={idx}
                className="shrink-0 w-full rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 p-5 shadow-lg relative overflow-hidden"
                style={{ scrollSnapAlign: "center" }}
              >
                {/* Decorative circles */}
                <div className="absolute right-16 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />

                {/* Nav arrows — inside card so they're always in bounds */}
                {idx === activeIdx && activeIdx > 0 && (
                  <button
                    onClick={() => scrollTo(activeIdx - 1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-white/25 text-white hover:bg-white/40 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                {idx === activeIdx && activeIdx < cards.length - 1 && (
                  <button
                    onClick={() => scrollTo(activeIdx + 1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-white/25 text-white hover:bg-white/40 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}

                <div className="flex items-start justify-between relative z-10">
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="text-xl font-bold text-white truncate pr-6">{card.name}</p>
                    {card.cardFrozen && (
                      <span className="inline-flex items-center gap-1 text-xs text-red-300 mt-0.5">
                        <Lock className="h-3 w-3" /> Card Frozen
                      </span>
                    )}
                    <p className="text-xs text-blue-200 mt-2">{t("parent.dashboard.balance", "Balance")}</p>
                    <p className="text-3xl font-extrabold text-white mt-1 tabular-nums">
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
                    <span className="mt-2 inline-block bg-white/20 text-white text-xs rounded-full px-2.5 py-0.5">
                      {card.role}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {card.photoUrl ? (
                      <img
                        src={card.photoUrl}
                        alt={card.name}
                        className="h-16 w-16 rounded-full object-cover border-2 border-white/30"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-400/40 border-2 border-white/20">
                        <UserRound className="h-8 w-8 text-white/60" />
                      </div>
                    )}
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
            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                {activeCard.kind === "self" && (
                  <>
                    <Button asChild variant="outline" className="h-11 flex-1">
                      <Link to="/parent/wallet/own"><WalletIcon className="h-4 w-4 mr-1.5" />Top up</Link>
                    </Button>
                    <Button asChild variant="outline" className="h-11 flex-1">
                      <Link to="/parent/wallet/own?tab=history"><History className="h-4 w-4 mr-1.5" />History</Link>
                    </Button>
                  </>
                )}
                {activeCard.kind === "coparent" && (
                  <>
                    <Button asChild variant="outline" className="h-11 flex-1" disabled={!activeCard.walletId}>
                      <Link to={`/parent/wallet/wallet-${activeCard.walletId}`}><WalletIcon className="h-4 w-4 mr-1.5" />Top up</Link>
                    </Button>
                    <Button asChild variant="outline" className="h-11 flex-1" disabled={!activeCard.walletId}>
                      <Link to={`/parent/wallet/wallet-${activeCard.walletId}?tab=history`}><History className="h-4 w-4 mr-1.5" />History</Link>
                    </Button>
                  </>
                )}
                {activeCard.kind === "child" && (
                  <>
                    <Button asChild variant="outline" className="h-11 flex-1" disabled={!activeCard.walletId}>
                      <Link to={`/parent/wallet/${activeCard.customerId}`}><WalletIcon className="h-4 w-4 mr-1.5" />Top up</Link>
                    </Button>
                    <Button asChild variant="outline" className="h-11 flex-1" disabled={!activeCard.walletId}>
                      <Link to={`/parent/transactions/${activeCard.customerId}`}><History className="h-4 w-4 mr-1.5" />History</Link>
                    </Button>
                  </>
                )}
              </div>
              {activeCard.kind === "child" && (
                <Button asChild variant="outline" className="h-11 w-full">
                  <Link to={`/parent/profile/${activeCard.customerId}`}><Receipt className="h-4 w-4 mr-1.5" />Profile</Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
