import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeftRight, GraduationCap, Lock, UserRound, Wallet as WalletIcon, Receipt, History } from "lucide-react";

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

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {isStudent ? t("parent.dashboard.studentTitle") : t("parent.dashboard.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isStudent ? t("parent.dashboard.studentDescription") : t("parent.dashboard.description")}
          </p>
        </div>
        {/* Transfer between wallets is admin-only — button intentionally removed */}
      </div>

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
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              {studentWallet.photo_url ? (
                <img
                  src={studentWallet.photo_url}
                  alt={studentWallet.name ?? ""}
                  className="h-12 w-12 shrink-0 rounded-full object-cover border border-primary/20 bg-background"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="h-6 w-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg truncate">{studentWallet.name}</CardTitle>
                <Badge variant="secondary" className="text-xs mt-1">
                  {t("roles.student", "Student")}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">{t("parent.dashboard.balance")}</p>
              <p className="text-2xl font-bold">{formatTHB(studentWallet.balance)}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm">
                <Link to={`/parent/wallet/${studentWallet.customer_id}`}>
                  <WalletIcon className="h-4 w-4 mr-1" />
                  {t("parent.dashboard.topUp")}
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm">
                <Link to={`/parent/transactions/${studentWallet.customer_id}`}>
                  <History className="h-4 w-4 mr-1" />
                  {t("parent.dashboard.history")}
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm">
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
        <Card className="overflow-hidden border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              {ownWallet.photo_url ? (
                <img
                  src={ownWallet.photo_url}
                  alt={ownWallet.name ?? ""}
                  className="h-12 w-12 shrink-0 rounded-full object-cover border border-amber-300 bg-background"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900">
                  <WalletIcon className="h-6 w-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg truncate">
                  {t("parent.dashboard.myWallet")}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-900">
                    {t("roles.parent")}
                  </Badge>
                  {ownWallet.name && (
                    <span className="text-xs text-muted-foreground truncate">
                      {ownWallet.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-white/70 p-3 border border-amber-100">
              <p className="text-xs text-muted-foreground">{t("parent.dashboard.balance")}</p>
              <p className="text-2xl font-bold text-amber-900">
                {formatTHB(ownWallet.balance)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm border-amber-300 hover:bg-amber-100">
                <Link to={`/parent/wallet/own`}>
                  <WalletIcon className="h-4 w-4 mr-1" />
                  {t("parent.dashboard.topUp")}
                </Link>
              </Button>
              {/* Transfer button removed — wallet transfers are admin-only */}
              <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm border-amber-300 hover:bg-amber-100">
                <Link to={`/parent/wallet/own?tab=history`}>
                  <History className="h-4 w-4 mr-1" />
                  {t("parent.dashboard.history")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {children.map((child) => (
          <Card key={child.link_id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                {child.photo_url ? (
                  <img
                    src={child.photo_url}
                    alt={child.name}
                    className="h-12 w-12 shrink-0 rounded-full object-cover border border-primary/20 bg-background"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserRound className="h-6 w-6" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-lg truncate">{child.name}</CardTitle>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {child.student_code && (
                      <Badge variant="secondary" className="text-xs">{child.student_code}</Badge>
                    )}
                    {child.grade && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
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
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">{t("parent.dashboard.balance")}</p>
                <p className="text-2xl font-bold">
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
                <Button asChild variant="outline" disabled={!child.wallet_id} className="h-11 px-2 text-xs sm:text-sm">
                  <Link to={`/parent/wallet/${child.customer_id}`}>
                    <WalletIcon className="h-4 w-4 mr-1" />
                    {t("parent.dashboard.topUp")}
                  </Link>
                </Button>
                <Button asChild variant="outline" disabled={!child.wallet_id} className="h-11 px-2 text-xs sm:text-sm">
                  <Link to={`/parent/transactions/${child.customer_id}`}>
                    <History className="h-4 w-4 mr-1" />
                    {t("parent.dashboard.history")}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 px-2 text-xs sm:text-sm">
                  <Link to={`/parent/profile/${child.customer_id}`}>
                    <Receipt className="h-4 w-4 mr-1" />
                    {t("parent.dashboard.profile")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
