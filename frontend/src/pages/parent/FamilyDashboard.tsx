import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, Bell, ChevronLeft, ChevronRight, GraduationCap, Lock, Save, Unlock, UserRound, Wallet as WalletIcon, History, RefreshCw, Receipt } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

function ChildControls({ customerId, userEmail, onFreezeChange }: { customerId: number; userEmail?: string; onFreezeChange?: (frozen: boolean) => void }) {
  const { t } = useTranslation();

  // Profile state
  const [cardFrozen, setCardFrozen] = useState(false);
  const [canteenInput, setCanteenInput] = useState("");
  const [storeInput, setStoreInput] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);

  // Alert state
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertLastSent, setAlertLastSent] = useState<string | null>(null);
  const [savingAlert, setSavingAlert] = useState(false);

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ card_frozen: boolean; daily_limit_canteen?: number | null; daily_limit_store?: number | null }>(`/customers/${customerId}`),
      api.get<{ enabled: boolean; threshold: number | null; last_alert_at: string | null }>(`/family/me/children/${customerId}/low-balance-alert`).catch(() => null),
    ]).then(([p, alert]) => {
      setCardFrozen(p.card_frozen);
      setCanteenInput(p.daily_limit_canteen != null ? String(p.daily_limit_canteen) : "");
      setStoreInput(p.daily_limit_store != null ? String(p.daily_limit_store) : "");
      if (alert) {
        setAlertEnabled(alert.enabled);
        setAlertThreshold(alert.threshold != null ? String(alert.threshold) : "");
        setAlertLastSent(alert.last_alert_at);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [customerId]);

  const toggleFreeze = async (frozen: boolean) => {
    try {
      await api.post(`/customers/${customerId}/freeze`, { frozen });
      setCardFrozen(frozen);
      onFreezeChange?.(frozen);
      toast({ title: frozen ? t("parent.studentProfile.freezeSuccess") : t("parent.studentProfile.unfreezeSuccess") });
    } catch (e) {
      toast({ title: t("parent.studentProfile.actionFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    }
  };

  const saveLimits = async () => {
    const parse = (s: string) => { const v = s.trim(); if (v === "") return null; const n = parseFloat(v); return isNaN(n) || n < 0 ? undefined : n; };
    const canteen = parse(canteenInput);
    const store = parse(storeInput);
    if (canteen === undefined || store === undefined) {
      toast({ title: t("parent.studentProfile.invalidLimit", "Invalid limit value"), variant: "destructive" }); return;
    }
    setSavingLimit(true);
    try {
      await api.patch(`/customers/${customerId}/limit`, { daily_limit_canteen: canteen, daily_limit_store: store });
      toast({ title: t("parent.studentProfile.limitSaved", "Saved") });
    } catch (e) {
      toast({ title: t("parent.studentProfile.actionFailed", "Failed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally { setSavingLimit(false); }
  };

  const saveAlert = async () => {
    const thresholdNum = alertThreshold.trim() ? parseFloat(alertThreshold) : null;
    if (alertEnabled && (thresholdNum === null || thresholdNum <= 0 || Number.isNaN(thresholdNum))) {
      toast({ title: t("parent.lowBalanceAlert.invalidThreshold", "Enter a balance threshold"), variant: "destructive" }); return;
    }
    setSavingAlert(true);
    try {
      const updated = await api.put<{ enabled: boolean; threshold: number | null; last_alert_at: string | null }>(
        `/family/me/children/${customerId}/low-balance-alert`, { enabled: alertEnabled, threshold: thresholdNum }
      );
      setAlertEnabled(updated.enabled);
      setAlertThreshold(updated.threshold != null ? String(updated.threshold) : "");
      setAlertLastSent(updated.last_alert_at);
      toast({ title: t("parent.lowBalanceAlert.saved", "Notification settings saved") });
    } catch (e) {
      toast({ title: t("parent.lowBalanceAlert.saveFailed", "Failed to save"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally { setSavingAlert(false); }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-3">
      {/* Freeze */}
      <div className={`flex items-center justify-between rounded-xl border p-3 transition-colors ${cardFrozen ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
        <div>
          <p className={`text-sm font-semibold flex items-center gap-1.5 ${cardFrozen ? "text-red-700" : "text-gray-700"}`}>
            {cardFrozen ? <Lock className="h-3.5 w-3.5 text-red-600" /> : <Unlock className="h-3.5 w-3.5 text-green-600" />}
            {t("parent.dashboard.blockCard", "Block Card")}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{t("parent.studentProfile.freezeHint")}</p>
        </div>
        <Switch checked={cardFrozen} onCheckedChange={toggleFreeze} />
      </div>

      {/* Daily limits */}
      <div className={`rounded-xl border p-3 space-y-3 transition-opacity ${cardFrozen ? "opacity-40 pointer-events-none border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50"}`}>
        <div>
          <p className="text-xs font-semibold text-amber-900">{t("parent.studentProfile.dailyLimitLabel", "Daily spending limit (THB)")}</p>
          <p className="text-[0.65rem] text-amber-700 mt-0.5">{t("parent.studentProfile.dailyLimitHint", "Leave blank to use system default")}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[0.65rem] font-semibold text-amber-800 uppercase tracking-wide">
              {t("parent.studentProfile.canteenLimitLabel", "โรงอาหาร")}
            </Label>
            <Input type="number" min="0" step="10" value={canteenInput} onChange={(e) => setCanteenInput(e.target.value)} placeholder={t("parent.studentProfile.canteenLimitPlaceholder", "default 500")} disabled={cardFrozen} className="h-8 text-sm border-amber-300" />
          </div>
          <div className="space-y-1">
            <Label className="text-[0.65rem] font-semibold text-amber-800 uppercase tracking-wide">
              {t("parent.studentProfile.storeLimitLabel", "ร้านค้า")}
            </Label>
            <Input type="number" min="0" step="100" value={storeInput} onChange={(e) => setStoreInput(e.target.value)} placeholder={t("parent.studentProfile.storeLimitPlaceholder", "default 25,000")} disabled={cardFrozen} className="h-8 text-sm border-amber-300" />
          </div>
        </div>
        <Button onClick={saveLimits} disabled={savingLimit || cardFrozen} size="sm" className="w-full bg-amber-500 hover:bg-amber-600 text-white border-0">
          <Save className="h-3.5 w-3.5 mr-1" />
          {savingLimit ? t("parent.studentProfile.saving", "Saving…") : t("parent.studentProfile.save", "Save")}
        </Button>
      </div>

      {/* Low-balance alert */}
      <div className={`rounded-xl border p-3 space-y-3 transition-opacity ${cardFrozen ? "opacity-40 pointer-events-none border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50/60"}`}>
        <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
          <Bell className="h-3.5 w-3.5" />
          {t("parent.lowBalanceAlert.title", "Low-balance email alerts")}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-xs text-amber-900">{t("parent.lowBalanceAlert.toggleLabel", "Email me when balance drops below threshold")}</p>
          <Switch checked={alertEnabled} onCheckedChange={setAlertEnabled} disabled={savingAlert || cardFrozen} />
        </div>
        <div className="flex gap-2">
          <Input
            type="number" inputMode="decimal" min={1} step="0.01"
            value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)}
            placeholder="200" disabled={!alertEnabled || savingAlert || cardFrozen}
            className="h-8 text-sm border-amber-300 flex-1"
          />
          <Button onClick={saveAlert} disabled={savingAlert || cardFrozen} size="sm" className="bg-amber-500 hover:bg-amber-600 text-white border-0 shrink-0">
            <Save className="h-3.5 w-3.5 mr-1" />
            {savingAlert ? t("parent.studentProfile.saving", "Saving…") : t("parent.studentProfile.save", "Save")}
          </Button>
        </div>
        <div className="text-[0.65rem] text-amber-700 space-y-0.5">
          {userEmail && <p>{t("parent.lowBalanceAlert.sendTo", "Send to")}: <span className="font-medium">{userEmail}</span></p>}
          <p>{t("parent.lowBalanceAlert.lastSent", "Last alert sent")}: <span className="font-medium">{alertLastSent ? new Date(alertLastSent).toLocaleString() : t("parent.lowBalanceAlert.neverSent", "Never")}</span></p>
        </div>
      </div>
    </div>
  );
}

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
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2 flex-wrap pr-6">
                <p className="text-xl font-bold text-white truncate">{studentWallet.name}</p>
                <span className="shrink-0 bg-white/20 text-white text-[0.65rem] font-semibold rounded-full px-2 py-0.5">
                  {t("roles.student", "Student")}
                </span>
              </div>
              {studentWallet.username && (
                <p className="text-xs text-blue-200 mt-1">{studentWallet.username}</p>
              )}
              <p className="text-[0.65rem] text-blue-300 mt-3 uppercase tracking-wide">{t("parent.dashboard.balance", "Balance")}</p>
              <p className="text-3xl font-extrabold text-white tabular-nums leading-tight">{formatTHB(studentWallet.balance)}</p>
              <p className="text-[0.65rem] text-blue-300/70 mt-2 flex items-center gap-1">
                <RefreshCw className="h-2.5 w-2.5" />{t("parent.dashboard.updatedAt", "Updated at")} {now}
              </p>
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
                  <div className="flex-1 min-w-0 pr-3">
                    {/* Row 1: Name + Role badge */}
                    <div className="flex items-center gap-2 flex-wrap pr-6">
                      <p className="text-xl font-bold text-white truncate">{card.name}</p>
                      <span className="shrink-0 bg-white/20 text-white text-[0.65rem] font-semibold rounded-full px-2 py-0.5">
                        {card.role}
                      </span>
                    </div>
                    {/* Row 2: Code · Grade · Block Card */}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {card.code && <span className="text-xs text-blue-200">{card.code}</span>}
                      {card.grade && (
                        <>
                          <span className="text-blue-300/50 text-xs">·</span>
                          <span className="text-xs text-blue-200 flex items-center gap-1">
                            <GraduationCap className="h-3 w-3" />{card.grade}
                          </span>
                        </>
                      )}
                      {card.cardFrozen && (
                        <>
                          <span className="text-blue-300/50 text-xs">·</span>
                          <span className="inline-flex items-center gap-1 text-xs text-red-300 font-semibold">
                            <Lock className="h-3 w-3" />{t("parent.dashboard.blockCard", "Block Card")}
                          </span>
                        </>
                      )}
                    </div>
                    {/* Row 3: Balance */}
                    <p className="text-[0.65rem] text-blue-300 mt-3 uppercase tracking-wide">{t("parent.dashboard.balance", "Balance")}</p>
                    <p className="text-3xl font-extrabold text-white tabular-nums leading-tight">
                      {card.balance !== null ? formatTHB(card.balance) : "—"}
                    </p>
                    {/* Row 4: Updated at */}
                    <p className="text-[0.65rem] text-blue-300/70 mt-2 flex items-center gap-1">
                      <RefreshCw className="h-2.5 w-2.5" />{t("parent.dashboard.updatedAt", "Updated at")} {now}
                    </p>
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
              {activeCard.kind === "child" && activeCard.customerId && (
                <>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider pt-1">
                    {t("parent.dashboard.cardSettings", "Card settings")}
                  </p>
                  <ChildControls
                    customerId={activeCard.customerId}
                    userEmail={user?.email ?? undefined}
                    onFreezeChange={(frozen) =>
                      setChildren((prev) =>
                        prev.map((c) =>
                          c.customer_id === activeCard.customerId ? { ...c, card_frozen: frozen } : c,
                        ),
                      )
                    }
                  />
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
