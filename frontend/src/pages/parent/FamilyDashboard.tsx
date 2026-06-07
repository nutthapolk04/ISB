import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, GraduationCap, Lock, UserRound, Wallet as WalletIcon, Receipt, History } from "lucide-react";

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

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function FamilyDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isStudent = user?.role === "student";
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [ownWallet, setOwnWallet] = useState<OwnWallet | null>(null);
  const [studentWallet, setStudentWallet] = useState<OwnWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (isStudent) {
          const mine = await api.get<OwnWallet | null>("/wallets/me").catch(() => null);
          if (mine) setStudentWallet(mine);
        } else {
          const [data, mine] = await Promise.all([
            api.get<ChildSummary[]>("/family/me"),
            api.get<OwnWallet | null>("/wallets/me").catch(() => null),
          ]);
          setChildren(data);
          if (mine && mine.owner_type === "user") setOwnWallet(mine);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.detail : "Failed to load family");
      } finally {
        setLoading(false);
      }
    })();
  }, [isStudent]);

  const childThemes = [
    {
      card: "from-blue-50 to-indigo-50 border-blue-200",
      avatar: "bg-blue-100 text-blue-600",
      avatarBorder: "border-blue-200",
      balance: "bg-blue-100/60 border-blue-200",
      balanceText: "text-blue-900",
      badge: "bg-blue-100 text-blue-800",
      button: "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-400",
    },
    {
      card: "from-emerald-50 to-teal-50 border-emerald-200",
      avatar: "bg-emerald-100 text-emerald-600",
      avatarBorder: "border-emerald-200",
      balance: "bg-emerald-100/60 border-emerald-200",
      balanceText: "text-emerald-900",
      badge: "bg-emerald-100 text-emerald-800",
      button: "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400",
    },
    {
      card: "from-purple-50 to-violet-50 border-purple-200",
      avatar: "bg-purple-100 text-purple-600",
      avatarBorder: "border-purple-200",
      balance: "bg-purple-100/60 border-purple-200",
      balanceText: "text-purple-900",
      badge: "bg-purple-100 text-purple-800",
      button: "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:border-purple-400",
    },
    {
      card: "from-pink-50 to-rose-50 border-pink-200",
      avatar: "bg-pink-100 text-pink-600",
      avatarBorder: "border-pink-200",
      balance: "bg-pink-100/60 border-pink-200",
      balanceText: "text-pink-900",
      badge: "bg-pink-100 text-pink-800",
      button: "border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100 hover:border-pink-400",
    },
  ];

  return (
    <div className="page-shell">
      {/* Header banner */}
      <div className="rounded-2xl bg-amber-50/60 border border-amber-200/60 p-6 mb-2 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              {isStudent ? (
                <GraduationCap className="h-6 w-6" />
              ) : (
                <UserRound className="h-6 w-6" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {isStudent ? t("parent.dashboard.studentTitle") : t("parent.dashboard.title")}
              </h1>
              <p className="text-sm text-slate-600">
                {isStudent ? t("parent.dashboard.studentDescription") : t("parent.dashboard.description")}
              </p>
            </div>
          </div>
        </div>
      </div>
      {/* Transfer between wallets is admin-only — button intentionally removed */}
      <div />

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
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

      {!loading && !error && !isStudent && children.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t("parent.dashboard.noChildren")}
          </CardContent>
        </Card>
      )}

      {!loading && isStudent && studentWallet && studentWallet.customer_id && (
        <Card className="overflow-hidden border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              {studentWallet.photo_url ? (
                <img
                  src={studentWallet.photo_url}
                  alt={studentWallet.name ?? ""}
                  className="h-12 w-12 shrink-0 rounded-full object-cover border-2 border-blue-200"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <UserRound className="h-6 w-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg truncate">{studentWallet.name}</CardTitle>
                <Badge variant="secondary" className="text-xs mt-1 bg-blue-100 text-blue-800">
                  {t("roles.student", "Student")}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-blue-100/60 p-3 border border-blue-200">
              <p className="text-xs text-blue-700">{t("parent.dashboard.balance")}</p>
              <p className="text-3xl font-extrabold text-blue-900 tracking-tight">{formatTHB(studentWallet.balance)}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">
                <Link to={`/parent/wallet/${studentWallet.customer_id}`}>
                  <WalletIcon className="h-4 w-4 mr-1" />
                  {t("parent.dashboard.topUp")}
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">
                <Link to={`/parent/transactions/${studentWallet.customer_id}`}>
                  <History className="h-4 w-4 mr-1" />
                  {t("parent.dashboard.history")}
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">
                <Link to={`/parent/profile/${studentWallet.customer_id}`}>
                  <Receipt className="h-4 w-4 mr-1" />
                  {t("parent.dashboard.profile")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && ownWallet && (
        <Card className="overflow-hidden border border-amber-200/60 shadow-sm bg-white">
          <div className="p-5">
            <div className="flex items-start gap-3">
              {ownWallet.photo_url ? (
                <img
                  src={ownWallet.photo_url}
                  alt={ownWallet.name ?? ""}
                  className="h-14 w-14 shrink-0 rounded-full object-cover border-2 border-amber-200 shadow-sm"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                  <WalletIcon className="h-7 w-7" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-500">{t("parent.dashboard.myWallet")}</p>
                <p className="text-xl font-bold text-slate-900 truncate">
                  {ownWallet.name ?? t(`roles.${user?.role ?? "parent"}`, user?.role ?? "Parent / Guardian")}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {t(`roles.${user?.role ?? "parent"}`, user?.role ?? "Parent / Guardian")}
                  </span>
                  {ownWallet.username && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">
                      {ownWallet.username}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-amber-50/70 border border-amber-200/60 px-4 py-3">
              <p className="text-xs text-amber-700">{t("parent.dashboard.balance")}</p>
              <p className="text-3xl font-extrabold text-slate-900 tracking-tight">
                {formatTHB(ownWallet.balance)}
              </p>
            </div>
          </div>
          <CardContent className="pt-4 pb-4 bg-slate-50/40 border-t border-slate-200 space-y-0">
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm border-amber-300 bg-white text-amber-700 hover:bg-amber-50">
                <Link to={`/parent/wallet/own`}>
                  <WalletIcon className="h-4 w-4 mr-1.5" />
                  {t("parent.dashboard.topUp")}
                </Link>
              </Button>
              {/* Transfer button removed — wallet transfers are admin-only */}
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm border-amber-300 bg-white text-amber-700 hover:bg-amber-50">
                <Link to={`/parent/wallet/own?tab=history`}>
                  <History className="h-4 w-4 mr-1.5" />
                  {t("parent.dashboard.history")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {children.map((child, idx) => {
          const theme = childThemes[Math.min(idx, childThemes.length - 1)];
          return (
            <Card key={child.link_id} className={`overflow-hidden bg-gradient-to-br border shadow-md ${theme.card}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  {child.photo_url ? (
                    <img
                      src={child.photo_url}
                      alt={child.name}
                      className={`h-12 w-12 shrink-0 rounded-full object-cover border-2 ${theme.avatarBorder}`}
                    />
                  ) : (
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${theme.avatar}`}>
                      <UserRound className="h-6 w-6" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">{child.name}</CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {child.student_code && (
                        <Badge variant="secondary" className={`text-xs ${theme.badge}`}>{child.student_code}</Badge>
                      )}
                      {child.grade && (
                        <span className={`text-xs flex items-center gap-1 ${theme.balanceText} opacity-70`}>
                          <GraduationCap className="h-3 w-3" />
                          {child.grade}
                        </span>
                      )}
                      {child.card_frozen && (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <Lock className="h-3 w-3" /> {t("parent.dashboard.cardFrozen")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className={`rounded-md p-3 border ${theme.balance}`}>
                  <p className={`text-xs ${theme.balanceText} opacity-70`}>{t("parent.dashboard.balance")}</p>
                  <p className={`text-3xl font-extrabold tracking-tight ${theme.balanceText}`}>
                    {child.wallet_balance !== null && child.wallet_balance !== undefined
                      ? formatTHB(child.wallet_balance)
                      : "-"}
                  </p>
                </div>

                {child.allergies && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="font-medium">{t("parent.dashboard.allergies", { items: child.allergies })}</span>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <Button asChild variant="outline" disabled={!child.wallet_id} className={`h-11 px-2 text-xs sm:text-sm ${theme.button}`}>
                    <Link to={`/parent/wallet/${child.customer_id}`}>
                      <WalletIcon className="h-4 w-4 mr-1" />
                      {t("parent.dashboard.topUp")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" disabled={!child.wallet_id} className={`h-11 px-2 text-xs sm:text-sm ${theme.button}`}>
                    <Link to={`/parent/transactions/${child.customer_id}`}>
                      <History className="h-4 w-4 mr-1" />
                      {t("parent.dashboard.history")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className={`h-11 px-2 text-xs sm:text-sm ${theme.button}`}>
                    <Link to={`/parent/profile/${child.customer_id}`}>
                      <Receipt className="h-4 w-4 mr-1" />
                      {t("parent.dashboard.profile")}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
