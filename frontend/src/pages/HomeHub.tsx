import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, moduleOf, type UserRole } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import {
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
    <div className="page-shell max-w-4xl mx-auto">
      <div className="text-center space-y-3 mb-16 pt-8">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground/70">
          {t("home.welcome", "Welcome back")}
        </p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-foreground">
          {user.fullName}
        </h1>
        <div className="w-10 h-px bg-border/70 mx-auto !mt-6" />
      </div>

      {loading ? (
        <div className="grid gap-10 sm:grid-cols-2 max-w-2xl mx-auto">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-2xl" />
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm">
          {t("home.noShopAssigned", "Your account has not been assigned to a shop yet. Please contact your administrator.")}
        </p>
      ) : (
        <div className="grid gap-10 sm:grid-cols-2 max-w-2xl mx-auto">
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
              className="group flex flex-col items-center gap-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
            >
              <div className="w-full aspect-square max-w-[220px] rounded-2xl bg-muted/40 group-hover:bg-muted/70 flex items-center justify-center transition-all duration-300 group-hover:scale-[1.03]">
                <tile.icon className="h-14 w-14 text-foreground/70" strokeWidth={1.3} />
              </div>
              <div className="text-center space-y-1">
                <h2 className="text-xl font-medium tracking-tight">{tile.title}</h2>
                {tile.status && (
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {tile.status}
                  </p>
                )}
                {tile.switchTo && (
                  <p className="text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground/60 pt-2">
                    {t(`roles.${tile.switchTo}`, tile.switchTo)}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
