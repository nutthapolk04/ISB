import { GoogleOAuthProvider } from "@react-oauth/google";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { CenterAlertHost } from "@/components/CenterAlert";
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
import { LogOut, UserIcon, KeyRound, RefreshCcw, Wallet, Monitor } from "lucide-react";
import { useState } from "react";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { useTranslation } from "react-i18next";
import Store from "./pages/Store";
import Canteen from "./pages/Canteen";
import Returns from "./pages/Returns";
import ReturnHistory from "./pages/ReturnHistory";
import Receipts from "./pages/Receipts";
import Reports from "./pages/Reports";
import ShopManagement from "./pages/ShopManagement";
import StoreRequisition from "./pages/store/StoreRequisition";
import ShopDetail from "./pages/ShopDetail";
import Login from "./pages/Login";
import HomeHub from "./pages/HomeHub";
import RolePicker from "./pages/RolePicker";
import {
  MockBayPaymentForm,
  MockBayPaymentSuccess,
  MockBayPaymentCancel,
} from "./pages/payment/MockBayGateway";
import NotFound from "./pages/NotFound";
import FamilyDashboard from "./pages/parent/FamilyDashboard";
import WalletDetail from "./pages/parent/WalletDetail";
import TransactionHistory from "./pages/parent/TransactionHistory";
import StudentProfile from "./pages/parent/StudentProfile";
import Transfer from "./pages/parent/Transfer";
import WalletAdjust from "./pages/admin/WalletAdjust";
import WalletTransfer from "./pages/admin/WalletTransfer";
import DepartmentAdjust from "./pages/admin/DepartmentAdjust";
import CustomerDetail from "./pages/admin/CustomerDetail";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UserManagement from "./pages/admin/users/UserManagement";
import UserDetail from "./pages/admin/users/UserDetail";
import CanteenMenuPage from "./pages/canteen/CanteenMenuPage";
import CanteenShopDetail from "./pages/canteen/CanteenShopDetail";
import CanteenManagementOverview from "./pages/canteen/CanteenManagementOverview";
import AuditLogList from "./pages/admin/AuditLogList";
import SystemSettings from "./pages/admin/SystemSettings";
import CustomerDisplaySettings from "./pages/admin/CustomerDisplaySettings";
import CustomerDisplay from "./pages/CustomerDisplay";
import { openCustomerDisplayWindow } from "@/lib/customerDisplayWindow";
import GuidePage from "./pages/GuidePage";
import ShopDashboard from "./pages/ShopDashboard";

const queryClient = new QueryClient();

/** Redirects to /login if not authenticated */
function RequireAuth() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Redirects to / if user lacks the required role.
 *  Special case: staff with a shop_id assigned can access POS routes
 *  without needing the cashier role explicitly. */
function RequireRole({ roles }: { roles: UserRole[] }) {
  const { hasRole, user } = useAuth();
  const staffWithShop = user?.role === "staff" && !!user?.shopId;
  if (!hasRole(...roles) && !staffWithShop) return <Navigate to="/" replace />;
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
                  {hasRole("cashier", "manager") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void openCustomerDisplayWindow()}
                      title={t("customerDisplay.openWindow", "Open Customer Display")}
                      aria-label="Open Customer Display"
                    >
                      <Monitor className="h-4 w-4" />
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

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

// GoogleOAuthProvider throws "Missing required parameter client_id" the moment
// it mounts with an empty clientId, which crashed the entire /login page on
// any environment where VITE_GOOGLE_CLIENT_ID isn't set. Feed the provider a
// sentinel string when the real id is missing — the provider mounts fine, the
// useGoogleLogin hook inside Login.tsx still wires up, and Login.tsx hides
// the Google button via the same env check so the placeholder is never used.
const GOOGLE_PROVIDER_ID = GOOGLE_CLIENT_ID || "google-oauth-disabled.invalid";

// Customer-display popup is a separate-monitor window that runs without
// auth, school info, OAuth, or any of the heavy providers. Mounting those
// providers on the popup window did pointless API calls (e.g. SchoolInfo
// → /admin/settings/school → 401 → reload loop) and even the Google
// Identity client script for no reason. Render the popup with a minimal
// app shell instead — TooltipProvider, Toaster, and the router are enough
// for the screens it renders.
const CustomerDisplayStandalone = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <CustomerDisplay />
    </TooltipProvider>
  </QueryClientProvider>
);

const App = () => {
  // Detect the popup early — before any provider mounts — so we never even
  // construct the auth/school/oauth context for that window.
  if (
    typeof window !== "undefined" &&
    window.location.pathname === "/customer-display"
  ) {
    return <CustomerDisplayStandalone />;
  }
  return (
  <GoogleOAuthProvider clientId={GOOGLE_PROVIDER_ID}>
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <CenterAlertHost />
      <BrowserRouter>
        <AuthProvider>
          <SchoolInfoProvider>
          <Routes>
            {/* Public route */}
            <Route path="/login" element={<Login />} />
            {/* Customer-facing second-monitor display — no auth, no shell */}
            <Route path="/customer-display" element={<CustomerDisplay />} />

            {/* Protected layout — all children require auth */}
            <Route element={<RequireAuth />}>
              {/* Role picker — no sidebar/shell */}
              <Route path="/select-role" element={<RolePicker />} />

              {/* Mock BAY EASYPay redirect pages — rendered standalone so
                   they feel like leaving the merchant site for the bank's
                   hosted gateway. Auth is still required (the success
                   landing calls /wallets/topup/{ref}/parent-confirm). */}
              <Route path="/payment/bay/form" element={<MockBayPaymentForm />} />
              <Route path="/payment/bay/success" element={<MockBayPaymentSuccess />} />
              <Route path="/payment/bay/cancel" element={<MockBayPaymentCancel />} />
              <Route path="/payment/bay/fail" element={<MockBayPaymentCancel />} />

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
                  <Route element={<RequireRole roles={["manager", "cashier", "admin"]} />}>
                    <Route path="/store/returns" element={<Returns />} />
                    <Route path="/store/return-history" element={<ReturnHistory />} />
                    <Route path="/store/management" element={<ShopManagement />} />
                    <Route path="/store/management/:shopId" element={<ShopDetail />} />
                  </Route>
                  {/* Legacy redirect — Store Users merged into /users */}
                  <Route path="/store/users" element={<Navigate to="/users" replace />} />
                  <Route element={<RequireRole roles={["admin", "manager", "cashier"]} />}>
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
                  <Route path="/admin/families" element={<Navigate to="/users?tab=families" replace />} />
                  <Route path="/admin/wallet-adjust" element={<WalletAdjust />} />
                  <Route path="/admin/wallet-transfer" element={<WalletTransfer />} />
                  <Route path="/admin/department-adjust" element={<DepartmentAdjust />} />
                  <Route path="/admin/audit-logs" element={<AuditLogList />} />
                  <Route path="/admin/settings" element={<SystemSettings />} />
                  <Route path="/admin/customer-display" element={<CustomerDisplaySettings />} />
                  <Route path="/admin/cards" element={<Navigate to="/users?tab=cards" replace />} />
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

                {/* Shop Dashboard — manager (own shop) + admin (any shop) */}
                <Route element={<RequireRole roles={["manager", "admin"]} />}>
                  <Route path="/shop-dashboard" element={<ShopDashboard />} />
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
  </GoogleOAuthProvider>
  );
};

export default App;
