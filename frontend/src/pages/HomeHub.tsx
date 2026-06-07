import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, moduleOf, type UserRole } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  ChefHat,
  GraduationCap,
  ShieldCheck,
  Store as StoreIcon,
  UtensilsCrossed,
  Wallet as WalletIcon,
  Users as UsersIcon,
} from "lucide-react";

interface OwnWallet {
  id: number;
  owner_type: "user" | "customer";
  balance: number;
  customer_id?: number | null;
}

interface FamilyChild {
  customer_id: number;
  name: string;
  wallet_balance?: number | null;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

interface Tile {
  key: string;
  title: string;
  status?: string;
  icon: React.ElementType;
  to: string;
  accent: string;
  /** Role this tile belongs to — clicking will switch activeRole to this so
   *  the sidebar + redirects line up with the page the user lands on. */
  switchTo?: UserRole;
}

export default function HomeHub() {
  const { t } = useTranslation();
  const { user, setActiveRole } = useAuth();
  const navigate = useNavigate();

  const allRoles = useMemo<UserRole[]>(
    () => user?.allRoles ?? (user ? [user.role] : []),
    [user],
  );
  // Staff with a shop_id are treated as multi-role: they can both buy (wallet)
  // and sell (POS) — show the Hub rather than redirecting straight to dashboard.
  const staffWithShop = allRoles.includes("staff") && !!user?.shopId;
  const isMulti = allRoles.length > 1 || staffWithShop;

  const hasFamilyRole = allRoles.includes("parent") || allRoles.includes("staff");
  const hasShopRole =
    allRoles.includes("cashier") ||
    allRoles.includes("manager") ||
    allRoles.includes("kitchen") ||
    allRoles.includes("canteen_owner") ||
    staffWithShop;
  const hasAdminRole = allRoles.includes("admin");
  const hasKitchenRole = allRoles.includes("kitchen");

  const [ownWallet, setOwnWallet] = useState<OwnWallet | null>(null);
  const [children, setChildren] = useState<FamilyChild[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isMulti) return;
    let cancelled = false;
    (async () => {
      const tasks: Promise<unknown>[] = [
        api.get<OwnWallet | null>("/wallets/me").catch(() => null),
      ];
      if (hasFamilyRole) {
        tasks.push(api.get<FamilyChild[]>("/family/me").catch(() => []));
      }
      const [w, kids] = await Promise.all(tasks);
      if (cancelled) return;
      setOwnWallet((w as OwnWallet | null) ?? null);
      if (hasFamilyRole) setChildren(((kids as FamilyChild[]) ?? []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isMulti, hasFamilyRole]);

  // Single-role users skip the Hub entirely — preserve direct landing UX
  if (!user) return <Navigate to="/login" replace />;
  if (!isMulti) {
    const role = user.activeRole ?? user.role;
    if (role === "admin") return <Navigate to="/admin" replace />;
    if (role === "parent" || role === "staff") return <Navigate to="/parent/dashboard" replace />;
    const userModule = user.shopModule ?? moduleOf(user.shopId);
    if (userModule === "canteen") return <Navigate to="/canteen" replace />;
    if (userModule === "store") return <Navigate to="/store" replace />;
    // userModule === null: shop not yet assigned — fall through to Hub (shows empty state)
  }

  const tiles: Tile[] = [];

  if (hasFamilyRole) {
    const kidCount = children.length;
    const totalBalance = children.reduce((s, c) => s + (c.wallet_balance ?? 0), 0);
    // Hide the family tile for staff-with-shop who have no children — they don't need it
    const hideFamily = staffWithShop && kidCount === 0;
    if (!hideFamily) {
      tiles.push({
        key: "family",
        title: t("home.tileFamily", "Family"),
        status:
          kidCount > 0
            ? t("home.tileFamilyStatus", {
                count: kidCount,
                balance: formatTHB(totalBalance),
                defaultValue: "{{count}} child(ren) · total {{balance}}",
              })
            : t("home.tileFamilyEmpty", "No children linked"),
        icon: UsersIcon,
        to: "/parent/dashboard",
        accent: "from-pink-50 to-rose-50 border-rose-200",
        switchTo: allRoles.includes("parent") ? "parent" : "staff",
      });
    }
  }

  if (hasShopRole && user.shopId) {
    const userModule = user.shopModule ?? moduleOf(user.shopId);
    const isCanteen = userModule === "canteen";
    const isKitchenOnly = hasKitchenRole && !allRoles.includes("cashier") && !allRoles.includes("manager");
    tiles.push({
      key: "shop",
      title: isKitchenOnly
        ? t("home.tileKitchen", "Kitchen")
        : isCanteen
          ? t("home.tileCanteen", "Canteen — Sell")
          : t("home.tileStore", "Store — Sell"),
      status: user.shopName ?? user.shopId,
      icon: isKitchenOnly ? ChefHat : isCanteen ? UtensilsCrossed : StoreIcon,
      to: isCanteen ? "/canteen" : "/store",
      accent: isCanteen
        ? "from-amber-50 to-orange-50 border-amber-200"
        : "from-emerald-50 to-teal-50 border-emerald-200",
      switchTo: isKitchenOnly
        ? "kitchen"
        : allRoles.includes("manager")
          ? "manager"
          : "cashier",
    });
  }

  // Wallet tile is redundant when the Family tile is already on the page:
  // both lead to /parent/dashboard, which exposes the same My Wallet card
  // with Top up + History actions. Only render the standalone wallet tile
  // for users who don't see Family (e.g. cashier-only without parent role).
  if (ownWallet && ownWallet.owner_type === "user" && !hasFamilyRole) {
    const walletSwitch: UserRole | undefined = allRoles.includes("parent")
      ? "parent"
      : allRoles.includes("staff")
        ? "staff"
        : undefined;
    tiles.push({
      key: "wallet",
      title: t("home.tileWallet", "My Wallet"),
      status: formatTHB(ownWallet.balance),
      icon: WalletIcon,
      to: "/parent/dashboard",
      accent: "from-amber-50 to-yellow-50 border-amber-200",
      switchTo: walletSwitch,
    });
  }

  if (hasAdminRole) {
    tiles.push({
      key: "admin",
      title: t("home.tileAdmin", "Admin"),
      status: t("home.tileAdminStatus", "System dashboard"),
      icon: ShieldCheck,
      to: "/admin",
      accent: "from-violet-50 to-purple-50 border-violet-200",
      switchTo: "admin",
    });
  }

  // Always include "Students linked to me" if user has student role (rare hybrid)
  if (allRoles.includes("student")) {
    tiles.push({
      key: "student",
      title: t("home.tileStudent", "My Account"),
      status: t("home.tileStudentStatus", "View wallet & history"),
      icon: GraduationCap,
      to: "/parent/dashboard",
      accent: "from-blue-50 to-sky-50 border-blue-200",
    });
  }

  return (
    <div className="page-shell max-w-5xl mx-auto">
      <div className="page-header space-y-1">
        <h1 className="page-title">
          {t("home.greeting", { name: user.fullName, defaultValue: "Hi, {{name}}" })}
        </h1>
        <p className="page-description">
          {t("home.subtitle", "Pick a role to get started")}
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {allRoles.map((r) => (
            <Badge key={r} variant="secondary" className="text-xs capitalize">
              {t(`roles.${r}`, r)}
            </Badge>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("home.noShopAssigned", "Your account has not been assigned to a shop yet. Please contact your administrator.")}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={() => {
                if (tile.switchTo && allRoles.includes(tile.switchTo)) {
                  setActiveRole(tile.switchTo);
                }
                navigate(tile.to);
              }}
              className="group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
            >
              <Card
                className={`h-full overflow-hidden border bg-gradient-to-br ${tile.accent} transition group-hover:shadow-md group-hover:-translate-y-0.5`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-md bg-white/70 p-2 shadow-sm">
                      <tile.icon className="h-5 w-5 text-foreground/80" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <CardTitle className="text-lg">{tile.title}</CardTitle>
                  {tile.status && (
                    <p className="text-sm text-muted-foreground tabular-nums truncate">
                      {tile.status}
                    </p>
                  )}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
