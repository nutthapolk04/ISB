import {
  Store,
  RefreshCw,
  Receipt,
  History,
  XCircle,
  Building2,
  Users,
  SlidersHorizontal,
  UserCog,
  UtensilsCrossed,
  Package,
  BarChart3,
  LayoutDashboard,
  CreditCard,
  HandHelping,
  Home,
  Settings as SettingsIcon,
  ArrowLeftRight,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, UserRole, moduleOf, type AppModule } from "@/contexts/AuthContext";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

interface MenuItem {
  titleKey: string;
  url: string;
  icon: React.ElementType;
  roles?: UserRole[];
  matchPrefix?: boolean;
}

interface MenuGroup {
  labelKey: string;
  /** null = no module gating (admin/parent groups) */
  module: AppModule | null;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    labelKey: "nav.groupCanteen",
    module: "canteen",
    items: [
      { titleKey: "nav.canteenPos",       url: "/canteen",           icon: UtensilsCrossed, roles: ["manager", "cashier"] },
      { titleKey: "nav.canteenReceipts",  url: "/canteen/receipts",  icon: Receipt,         roles: ["manager", "cashier", "admin"] },
      { titleKey: "nav.canteenProducts",  url: "/canteen/products",  icon: Package,         roles: ["manager"] },
      { titleKey: "nav.canteenReports",   url: "/canteen/reports",   icon: BarChart3,       roles: ["admin", "manager"] },
    ],
  },
  {
    labelKey: "nav.groupCanteenManagement",
    module: "canteen",
    items: [
      { titleKey: "nav.canteenManagement", url: "/canteen/management", icon: Building2, roles: ["manager", "admin"], matchPrefix: true },
    ],
  },
  {
    labelKey: "nav.groupStore",
    module: "store",
    items: [
      { titleKey: "nav.storePos",         url: "/store",                icon: Store,       roles: ["manager", "cashier"] },
      { titleKey: "nav.storeRequisition", url: "/store/requisition",    icon: HandHelping, roles: ["manager", "cashier", "admin"] },
      { titleKey: "nav.storeReceipts",    url: "/store/receipts",       icon: Receipt,     roles: ["manager", "cashier", "admin"] },
      { titleKey: "nav.storeVoid",        url: "/store/void",           icon: XCircle,     roles: ["manager", "admin"] },
      { titleKey: "nav.storeReturns",     url: "/store/returns",        icon: RefreshCw,   roles: ["manager", "admin"] },
      { titleKey: "nav.storeReturnHist",  url: "/store/return-history", icon: History,     roles: ["manager", "admin"] },
      { titleKey: "nav.storeReports",     url: "/store/reports",        icon: BarChart3,   roles: ["admin"] },
    ],
  },
  {
    labelKey: "nav.groupShopManagement",
    module: "store",
    items: [
      { titleKey: "nav.storeManagement",  url: "/store/management",     icon: Building2,   roles: ["manager", "admin"], matchPrefix: true },
    ],
  },
  {
    labelKey: "nav.groupUsers",
    module: null,
    items: [
      { titleKey: "nav.users",            url: "/users",                icon: UserCog,     roles: ["manager", "admin"], matchPrefix: true },
    ],
  },
  {
    labelKey: "nav.groupAdmin",
    module: null,
    items: [
      { titleKey: "nav.adminDashboard",    url: "/admin",                icon: LayoutDashboard,   roles: ["admin"] },
      { titleKey: "nav.adminCards",        url: "/admin/cards",          icon: CreditCard,        roles: ["admin"] },
      { titleKey: "nav.adminFamilies",     url: "/admin/families",       icon: Users,             roles: ["admin"] },
      { titleKey: "nav.adminWalletAdjust",    url: "/admin/wallet-adjust",    icon: SlidersHorizontal, roles: ["admin"] },
      { titleKey: "nav.adminWalletTransfer", url: "/admin/wallet-transfer",  icon: ArrowLeftRight,    roles: ["admin"] },
      { titleKey: "nav.adminDeptAdjust",   url: "/admin/department-adjust", icon: Building2,        roles: ["admin"] },
      { titleKey: "nav.adminAuditLogs",    url: "/admin/audit-logs",     icon: History,           roles: ["admin"] },
      { titleKey: "nav.adminSettings",     url: "/admin/settings",       icon: SettingsIcon,      roles: ["admin"] },
    ],
  },
  {
    labelKey: "nav.groupParent",
    module: null,
    items: [
      { titleKey: "nav.familyDashboard", url: "/parent/dashboard", icon: Users, roles: ["parent"] },
    ],
  },
];

export function AppSidebar() {
  const { open } = useSidebar();
  const location = useLocation();
  const { t } = useTranslation();
  const { hasRole, user } = useAuth();

  const isActive = (item: MenuItem) =>
    item.matchPrefix
      ? location.pathname.startsWith(item.url)
      : location.pathname === item.url;

  /** Group visibility: admin sees everything non-parent; otherwise filter by module */
  const groupVisible = (g: MenuGroup): boolean => {
    if (g.module === null) return true; // gated at per-item role level
    if (!user) return false;
    if (user.role === "admin") return true;
    return (user.shopModule ?? moduleOf(user.shopId)) === g.module;
  };

  return (
    <Sidebar className={open ? "w-64" : "w-16"} collapsible="icon">
      <SidebarContent>
        {/* Logo / title */}
        <SidebarGroup>
          <SidebarGroupLabel className="h-auto px-4 py-4">
            {open && (
              <div className="flex items-center gap-3">
                <img
                  src="/isb-logo.svg"
                  alt="ISB logo"
                  className="h-11 w-11 shrink-0 rounded-md object-contain"
                />
                <span className="text-sidebar-foreground text-[1.518rem] font-bold">
                  {t("nav.systemTitle")}
                </span>
              </div>
            )}
          </SidebarGroupLabel>
        </SidebarGroup>

        {/* Home Hub — visible only for multi-role users */}
        {user && (user.allRoles?.length ?? 1) > 1 && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-0">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={t("nav.home")}
                    isActive={location.pathname === "/"}
                    className="text-base p-3 h-auto"
                  >
                    <NavLink to="/" className="h-auto min-h-fit">
                      <Home className="h-5 w-5" />
                      <span>{t("nav.home")}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Nav groups */}
        {menuGroups.map((group) => {
          if (!groupVisible(group)) return null;

          const visibleItems = group.items.filter(
            (item) => !item.roles || hasRole(...item.roles),
          );
          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={group.labelKey}>
              {open && (
                <SidebarGroupLabel className="px-4 pb-1 text-xs uppercase tracking-wider text-muted-foreground/60">
                  {t(group.labelKey)}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="space-y-0">
                  {visibleItems.map((item) => (
                    <SidebarMenuItem key={item.titleKey}>
                      <SidebarMenuButton
                        asChild
                        tooltip={t(item.titleKey)}
                        isActive={isActive(item)}
                        className="text-base p-3 h-auto"
                      >
                        <NavLink to={item.url} className="h-auto min-h-fit">
                          <item.icon className="h-5 w-5" />
                          <span>{t(item.titleKey)}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
