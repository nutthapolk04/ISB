import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ServerStatusIndicator } from "@/components/ServerStatusIndicator";
import { ReSyncControl } from "@/components/ReSyncControl";
import { AuthProvider, useAuth, UserRole } from "@/contexts/AuthContext";
import { SchoolInfoProvider } from "@/contexts/SchoolInfoContext";
import { RequireModule } from "@/components/guards/RequireModule";
import { Button } from "@/components/ui/button";
import { LogOut, UserIcon, KeyRound, RefreshCcw, Wallet } from "lucide-react";
import { useState } from "react";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { useTranslation } from "react-i18next";
import Store from "./pages/Store";
import Canteen from "./pages/Canteen";
import Returns from "./pages/Returns";
import ReturnHistory from "./pages/ReturnHistory";
import Receipts from "./pages/Receipts";
import Reports from "./pages/Reports";
import Void from "./pages/Void";
import ShopManagement from "./pages/ShopManagement";
import StoreRequisition from "./pages/store/StoreRequisition";
import ShopDetail from "./pages/ShopDetail";
import Login from "./pages/Login";
import HomeHub from "./pages/HomeHub";
import RolePicker from "./pages/RolePicker";
import NotFound from "./pages/NotFound";
import FamilyDashboard from "./pages/parent/FamilyDashboard";
import WalletDetail from "./pages/parent/WalletDetail";
import TransactionHistory from "./pages/parent/TransactionHistory";
import StudentProfile from "./pages/parent/StudentProfile";
import Transfer from "./pages/parent/Transfer";
import FamilyLinks from "./pages/admin/FamilyLinks";
import WalletAdjust from "./pages/admin/WalletAdjust";
import WalletTransfer from "./pages/admin/WalletTransfer";
import DepartmentAdjust from "./pages/admin/DepartmentAdjust";
import CustomerDetail from "./pages/admin/CustomerDetail";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UserManagement from "./pages/admin/users/UserManagement";
import UserDetail from "./pages/admin/users/UserDetail";
import CardManagement from "./pages/admin/CardManagement";
import CanteenMenuPage from "./pages/canteen/CanteenMenuPage";
import CanteenShopDetail from "./pages/canteen/CanteenShopDetail";
import CanteenManagementOverview from "./pages/canteen/CanteenManagementOverview";
import AuditLogList from "./pages/admin/AuditLogList";
import SystemSettings from "./pages/admin/SystemSettings";
import GuidePage from "./pages/GuidePage";

const queryClient = new QueryClient();

/** Redirects to /login if not authenticated */
function RequireAuth() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Redirects to / if user lacks the required role */
function RequireRole({ roles }: { roles: UserRole[] }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Legacy redirect: /admin/users/:userId → /users/:userId */
function LegacyUserDetailRedirect() {
  const { userId } = useParams();
  return <Navigate to={`/users/${userId ?? ""}`} replace />;
}

/** Main app shell: sidebar + topbar + page content */
function AppShell() {
  const { user, logout, hasRole } = useAuth();
  const { t } = useTranslation();
  const [pwOpen, setPwOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <main className="flex flex-1 flex-col">
          <header className="app-topbar">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <ServerStatusIndicator />
              <ReSyncControl />
              <LanguageSwitcher />
              {user && (
                <div className="flex items-center gap-2 border-l border-border/60 pl-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <UserIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="hidden sm:inline text-muted-foreground">
                      {user.fullName}
                    </span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary capitalize">
                      {user.activeRole ?? user.role}
                    </span>
                    {user.shopName && (
                      <span className="hidden sm:inline rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {user.shopName}
                      </span>
                    )}
                  </div>
                  {(user.allRoles?.length ?? 1) > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate("/select-role")}
                      title={t("rolePicker.switchRole")}
                      className="h-7 gap-1 text-xs text-muted-foreground px-2"
                    >
                      <RefreshCcw className="h-3 w-3" />
                      <span className="hidden sm:inline">{t("rolePicker.switchRole")}</span>
                    </Button>
                  )}
                  {hasRole("cashier", "manager", "kitchen") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate("/staff/wallet")}
                      title={t("nav.myWallet")}
                    >
                      <Wallet className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPwOpen(true)}
                    title={t("account.changePassword")}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={logout}
                    title={t("account.signOut")}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
            </div>
          </header>
          <div className="flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <SchoolInfoProvider>
          <Routes>
            {/* Public route */}
            <Route path="/login" element={<Login />} />

            {/* Protected layout — all children require auth */}
            <Route element={<RequireAuth />}>
              {/* Role picker — no sidebar/shell */}
              <Route path="/select-role" element={<RolePicker />} />
              <Route element={<AppShell />}>
                {/* Landing — Hub for multi-role users; auto-redirect for single-role */}
                <Route path="/" element={<HomeHub />} />

                {/* Canteen module (admin OR canteen shop) */}
                <Route element={<RequireModule module="canteen" />}>
                  {/* POS — manager/cashier only (admin doesn't operate POS) */}
                  <Route element={<RequireRole roles={["manager", "cashier"]} />}>
                    <Route path="/canteen" element={<Canteen />} />
                  </Route>
                  <Route path="/canteen/receipts" element={<Receipts />} />
                  <Route element={<RequireRole roles={["manager"]} />}>
                    <Route path="/canteen/products" element={<CanteenMenuPage />} />
                  </Route>
                  {/* Legacy redirect — Canteen Users merged into /users */}
                  <Route path="/canteen/users" element={<Navigate to="/users" replace />} />
                  <Route element={<RequireRole roles={["admin", "manager"]} />}>
                    <Route path="/canteen/management" element={<CanteenManagementOverview />} />
                    <Route path="/canteen/management/:shopId" element={<CanteenShopDetail />} />
                    <Route path="/canteen/reports" element={<Reports />} />
                  </Route>
                </Route>

                {/* Store module (admin OR coop/sports/bookstore shop) */}
                <Route element={<RequireModule module="store" />}>
                  {/* POS — manager/cashier only (admin doesn't operate POS) */}
                  <Route element={<RequireRole roles={["manager", "cashier"]} />}>
                    <Route path="/store" element={<Store />} />
                  </Route>
                  <Route path="/store/receipts" element={<Receipts />} />
                  <Route element={<RequireRole roles={["manager", "cashier", "admin"]} />}>
                    <Route path="/store/requisition" element={<StoreRequisition />} />
                  </Route>
                  <Route element={<RequireRole roles={["manager", "admin"]} />}>
                    <Route path="/store/returns" element={<Returns />} />
                    <Route path="/store/return-history" element={<ReturnHistory />} />
                    <Route path="/store/void" element={<Void />} />
                    <Route path="/store/management" element={<ShopManagement />} />
                    <Route path="/store/management/:shopId" element={<ShopDetail />} />
                  </Route>
                  {/* Legacy redirect — Store Users merged into /users */}
                  <Route path="/store/users" element={<Navigate to="/users" replace />} />
                  <Route element={<RequireRole roles={["admin"]} />}>
                    <Route path="/store/reports" element={<Reports />} />
                  </Route>
                </Route>

                {/* Unified User Management — admin (system-wide) + manager (shop-scoped) */}
                <Route element={<RequireRole roles={["admin", "manager"]} />}>
                  <Route path="/users" element={<UserManagement />} />
                  <Route path="/users/:userId" element={<UserDetail />} />
                </Route>
                {/* Legacy redirects */}
                <Route path="/admin/users" element={<Navigate to="/users" replace />} />
                <Route path="/admin/users/:userId" element={<LegacyUserDetailRedirect />} />

                {/* Admin Ops */}
                <Route element={<RequireRole roles={["admin"]} />}>
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin/families" element={<FamilyLinks />} />
                  <Route path="/admin/wallet-adjust" element={<WalletAdjust />} />
                  <Route path="/admin/wallet-transfer" element={<WalletTransfer />} />
                  <Route path="/admin/department-adjust" element={<DepartmentAdjust />} />
                  <Route path="/admin/audit-logs" element={<AuditLogList />} />
                  <Route path="/admin/settings" element={<SystemSettings />} />
                  <Route path="/admin/cards" element={<CardManagement />} />
                  <Route path="/admin/students" element={<Navigate to="/users?kind=student" replace />} />
                  <Route path="/admin/customer/:customerId" element={<CustomerDetail />} />
                  <Route path="/admin/reports" element={<Reports />} />
                </Route>

                {/* Parent + Admin + Student (self-service view + topup) */}
                <Route element={<RequireRole roles={["parent", "staff", "admin", "student"]} />}>
                  <Route path="/parent/dashboard" element={<FamilyDashboard />} />
                  <Route path="/parent/wallet/:customerId" element={<WalletDetail />} />
                  <Route path="/parent/transactions/:customerId" element={<TransactionHistory />} />
                  <Route path="/parent/profile/:customerId" element={<StudentProfile />} />
                </Route>

                {/* Transfer — parent-initiated transfers disabled (admin-only per policy) */}
                <Route element={<RequireRole roles={["staff", "admin"]} />}>
                  <Route path="/parent/transfer" element={<Transfer />} />
                </Route>

                {/* Personal wallet for staff roles (cashier/manager/kitchen) */}
                <Route element={<RequireRole roles={["cashier", "manager", "kitchen", "admin"]} />}>
                  <Route path="/staff/wallet" element={<WalletDetail />} />
                </Route>

                {/* User Guide — accessible to all authenticated roles */}
                <Route path="/guide" element={<GuidePage />} />

                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
          </SchoolInfoProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
