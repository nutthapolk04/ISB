declare const __APP_VERSION__: string;

import {
    Store,
    Receipt,
    History,
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
    BookOpen,
    Monitor,
    ClipboardList,
    Layers,
    HandCoins,
    BellRing,
    HomeIcon,
    Wifi,
} from "lucide-react";
declare const __BUILD_TIME__: string;
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, UserRole, moduleOf, type AppModule } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";

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
        labelKey: "nav.groupAdmin",
        module: null,
        items: [
            { titleKey: "nav.adminDashboard", url: "/admin", icon: LayoutDashboard, roles: ["admin"] },
            { titleKey: "nav.adminAuditLogs", url: "/admin/audit-logs", icon: History, roles: ["admin"] },
            { titleKey: "nav.adminKioskMonitoring", url: "/admin/kiosk-monitoring", icon: Wifi, roles: ["admin"] },
        ],
    },
    {
        labelKey: "nav.groupReports",
        module: null,
        items: [
            { titleKey: "nav.adminReports", url: "/admin/reports", icon: BarChart3, roles: ["admin", "finance"] },
        ],
    },
    {
        labelKey: "nav.groupUsers",
        module: null,
        items: [
            // Managers see this link too — the Users page renders a shop-scoped
            // ShopUserManagement view for non-admins (see UserManagement.tsx),
            // so a canteen manager can create cashiers in their own shop only.
            { titleKey: "nav.users", url: "/users", icon: UserCog, roles: ["admin", "manager"], matchPrefix: true },
        ],
    },
    {
        labelKey: "nav.groupWalletOps",
        module: null,
        items: [
            { titleKey: "nav.adminWalletAdjust", url: "/admin/wallet-adjust", icon: SlidersHorizontal, roles: ["admin"] },
            { titleKey: "nav.adminWalletTransfer", url: "/admin/wallet-transfer", icon: ArrowLeftRight, roles: ["admin"] },
            { titleKey: "nav.adminDeptAdjust", url: "/admin/department-adjust", icon: Building2, roles: ["admin"] },
            { titleKey: "nav.refund", url: "/refund", icon: HandCoins, roles: ["admin"] },
        ],
    },
    {
        labelKey: "nav.groupCanteen",
        module: "canteen",
        items: [
            { titleKey: "nav.shopDashboard", url: "/shop-dashboard", icon: LayoutDashboard, roles: ["manager"] },
            { titleKey: "nav.canteenPos", url: "/canteen", icon: UtensilsCrossed, roles: ["manager", "cashier"] },
            { titleKey: "nav.canteenReceipts", url: "/canteen/receipts", icon: Receipt, roles: ["manager", "cashier", "admin"] },
            { titleKey: "nav.canteenProducts", url: "/canteen/products", icon: Package, roles: ["manager"] },
            { titleKey: "nav.canteenReports", url: "/canteen/reports", icon: BarChart3, roles: ["admin", "manager", "finance"] },
        ],
    },
    {
        labelKey: "nav.groupCanteenManagement",
        module: null,
        items: [
            { titleKey: "nav.canteenManagement", url: "/canteen/management", icon: Building2, roles: ["admin"], matchPrefix: true },
        ],
    },
    {
        labelKey: "nav.groupStore",
        module: "store",
        items: [
            { titleKey: "nav.shopDashboard", url: "/shop-dashboard", icon: LayoutDashboard, roles: ["manager"] },
            { titleKey: "nav.storePos", url: "/store", icon: Store, roles: ["manager", "cashier"] },
            { titleKey: "nav.storeRequisition", url: "/store/requisition", icon: HandHelping, roles: ["manager", "cashier", "admin"] },
            { titleKey: "nav.storeReceipts", url: "/store/receipts", icon: Receipt, roles: ["manager", "cashier", "admin"] },
            // { titleKey: "nav.storeReturns",    url: "/store/returns",        icon: RefreshCw,   roles: ["manager", "cashier", "admin"] },
            // { titleKey: "nav.storeReturnHist", url: "/store/return-history", icon: History,     roles: ["manager", "cashier", "admin"] },
            { titleKey: "nav.storeReports", url: "/store/reports", icon: BarChart3, roles: ["admin", "manager", "cashier", "finance"] },
            { titleKey: "nav.storeBalanceFile", url: "/store/balance-file", icon: BookOpen, roles: ["admin"] },
        ],
    },
    {
        labelKey: "nav.groupShopManagement",
        module: "store",
        items: [
            { titleKey: "nav.storeManagement", url: "/store/management", icon: Building2, roles: ["manager", "admin"], matchPrefix: true },
        ],
    },
    {
        labelKey: "nav.groupSystem",
        module: null,
        items: [
            { titleKey: "nav.adminCustomerDisplay", url: "/admin/customer-display", icon: Monitor, roles: ["admin"] },
            { titleKey: "nav.adminSpendingGroups", url: "/admin/spending-groups", icon: Layers, roles: ["admin"] },
            { titleKey: "nav.adminLowBalanceAlert", url: "/admin/low-balance-alert", icon: BellRing, roles: ["admin"] },
            { titleKey: "nav.adminSettings", url: "/admin/settings", icon: SettingsIcon, roles: ["admin"] },
        ],
    },
    {
        labelKey: "nav.groupParent",
        module: null,
        items: [
            { titleKey: "nav.familyDashboard", url: "/parent/dashboard", icon: HomeIcon, roles: ["parent", "staff", "teacher", "student"] },
        ],
    },
];

export function AppSidebar() {
    const { open } = useSidebar();
    const location = useLocation();
    const { t } = useTranslation();
    const { hasRole, user } = useAuth();
    const school = useSchoolInfo();

    const isActive = (item: MenuItem) =>
        item.matchPrefix
            ? location.pathname.startsWith(item.url)
            : location.pathname === item.url;

    /** Refund-only mode: when a single-role refund_officer is signed in, show
     *  ONLY the Refund menu item — hide POS, Store, Canteen, Admin, etc. */
    const activeRole = user?.activeRole ?? user?.role;
    const allRoles = user?.allRoles ?? (user ? [user.role] : []);
    const isRefundOnlyMode = activeRole === "refund_officer" && allRoles.length === 1;
    // Parent-like: pure parent OR staff/teacher who has a family_code (linked children)
    // Also catches staff with explicit "parent" in allRoles (RBAC path)
    const isParentLike =
        activeRole === "parent" ||
        (["staff", "teacher"].includes(activeRole ?? "") && (allRoles.includes("parent") || !!user?.familyCode));
    const isAdmin = activeRole === "admin";

    /** Group visibility: admin sees everything non-parent; otherwise filter by module */
    const groupVisible = (g: MenuGroup): boolean => {
        // Multi-role hub: hide all nav until user selects a role from hub tiles
        if (location.pathname === "/" && allRoles.length > 1) return false;
        if (g.module === null) return true; // gated at per-item role level
        if (!user) return false;
        // finance is a read-only, school-wide reporting role with no shop of
        // its own — bypass module-gating like admin (the per-item roles
        // list below still limits it to just the Reports item in each group).
        if (activeRole === "admin" || activeRole === "finance") return true;
        // Hide shop/canteen nav when user is on Hub or parent/wallet pages
        if (location.pathname === "/" || location.pathname.startsWith("/parent")) return false;
        return (user.shopModule ?? moduleOf(user.shopId)) === g.module;
    };

    return (
        <Sidebar className={open ? "w-64" : "w-16"} collapsible="icon">
            <SidebarContent>
                {/* Logo / title */}
                <SidebarGroup>
                    <SidebarGroupLabel className="h-auto px-4 py-4">
                        {open && (
                            <div className="flex flex-col items-center gap-4">
                                {school.logoUrl ? (
                                    <img
                                        src={school.logoUrl}
                                        alt="school logo"
                                        className="h-14 w-14 shrink-0 rounded-md object-contain"
                                    />
                                ) : (
                                    <img
                                        src="/isb-logo.svg"
                                        alt="ISB logo"
                                        className="h-14 w-14 shrink-0 rounded-md object-contain"
                                    />
                                )}
                                <span className="text-sidebar-foreground text-sm font-bold -mt-5">
                                    {school.name || t("nav.systemTitle")}
                                </span>
                            </div>
                        )}
                    </SidebarGroupLabel>
                </SidebarGroup>

                {/* Refund-only mode: single-role refund_officer sees only the Refund menu */}
                {isRefundOnlyMode && (
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu className="space-y-0">
                                <SidebarMenuItem>
                                    <SidebarMenuButton
                                        asChild
                                        tooltip={t("nav.refund")}
                                        isActive={location.pathname === "/refund"}
                                        className="text-base p-3 h-auto"
                                    >
                                        <NavLink to="/refund" className="h-auto min-h-fit">
                                            <HandCoins className="h-5 w-5" />
                                            <span>{t("nav.refund")}</span>
                                        </NavLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                )}


                {/* Nav groups */}
                {!isRefundOnlyMode && menuGroups.map((group) => {
                    if (!groupVisible(group)) return null;

                    // staff with a shop_id can access POS + receipts (cashier/manager-level items only)
                    const staffWithShop = user?.role === "staff" && !!user?.shopId;
                    const visibleItems = group.items.filter((item) => {
                        if (!item.roles) return true;
                        // For multi-role users, only show menu items that match the currently active role.
                        // Single-role users: activeRole === allRoles[0], so behaviour is unchanged.
                        if (item.roles.includes(activeRole as UserRole)) return true;
                        // staff+shopId bypasses role check only for module-specific POS groups (canteen/store), not Users/Admin
                        if (staffWithShop && group.module !== null && item.roles.some((r) => (["cashier", "manager"] as string[]).includes(r))) return true;
                        // staff who also has parent role (isParentLike) should see parent nav items
                        if (isParentLike && item.roles.includes("parent")) return true;
                        return false;
                    });
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
                {/* User Guide — visible to all roles */}
                <SidebarGroup className="mt-auto">
                    <SidebarGroupContent>
                        <SidebarMenu className="space-y-0">
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    asChild
                                    tooltip={t("nav.guide")}
                                    isActive={location.pathname === "/guide"}
                                    className="text-base p-3 h-auto"
                                >
                                    <NavLink to="/guide" className="h-auto min-h-fit">
                                        <BookOpen className="h-5 w-5" />
                                        <span>{t("nav.guide")}</span>
                                    </NavLink>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                    {open && (
                        <p className="px-4 pb-3 pt-1 text-[0.7rem] text-red-500 select-none">
                            V{__APP_VERSION__} {__BUILD_TIME__}
                        </p>
                    )}
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
}
