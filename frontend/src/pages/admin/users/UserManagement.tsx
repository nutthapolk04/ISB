import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Activity, ListChecks, IdCard, CreditCard, Link2, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ShopUserManagement } from "@/components/ShopUserManagement";
import CardholderList from "./CardholderList";
import SyncDashboard from "./SyncDashboard";
import SyncLog from "./SyncLog";
import ManualSyncPanel from "./ManualSyncPanel";

const CardManagement = lazy(() => import("@/pages/admin/CardManagement"));
const FamilyLinks = lazy(() => import("@/pages/admin/FamilyLinks"));

export default function UserManagement() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") ?? "cardholders";
  const [tab, setTab] = useState(defaultTab);

  const activeRole = user?.activeRole ?? user?.role;
  const isAdmin = activeRole === "admin";

  // Manager view: shop-scoped single tab
  if (!isAdmin) {
    if (!user?.shopId) {
      return (
        <div className="page-shell text-muted-foreground">
          <p className="text-sm text-muted-foreground">
            {t("shopUsers.noShopAssigned", "Manager has no shop assignment")}
          </p>
        </div>
      );
    }
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1 className="page-title flex items-center gap-2">
            <Users className="h-6 w-6" /> {t("admin.users.title")}
          </h1>
          <p className="page-description">
            {t("users.tabMyTeamDesc", "Manage staff in your shop")}
          </p>
        </div>
        <ShopUserManagement shopId={user.shopId} shopName={user.shopName ?? user.shopId} />
      </div>
    );
  }

  // Admin view: full 4-tab system-wide
  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Users className="h-6 w-6" /> {t("admin.users.title")}
        </h1>
        <p className="page-description">
          {t("admin.users.description")}
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="cardholders" className="gap-2">
            <IdCard className="h-4 w-4" /> Users
          </TabsTrigger>
          <TabsTrigger value="cards" className="gap-2">
            <CreditCard className="h-4 w-4" /> Card Management
          </TabsTrigger>
          <TabsTrigger value="families" className="gap-2">
            <Link2 className="h-4 w-4" /> Family Links
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-2">
            <Activity className="h-4 w-4" /> {t("admin.users.tabSyncDashboard")}
          </TabsTrigger>
          <TabsTrigger value="manualSync" className="gap-2">
            <RefreshCw className="h-4 w-4" /> {t("admin.users.tabManualSync", "Manual Sync")}
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-2">
            <ListChecks className="h-4 w-4" /> {t("admin.users.tabSyncLog")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cardholders" className="space-y-4">
          <CardholderList />
        </TabsContent>
        <TabsContent value="cards">
          <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
            <CardManagement />
          </Suspense>
        </TabsContent>
        <TabsContent value="families">
          <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
            <FamilyLinks />
          </Suspense>
        </TabsContent>
        <TabsContent value="dashboard" className="space-y-4">
          <SyncDashboard />
        </TabsContent>
        <TabsContent value="manualSync" className="space-y-4">
          <ManualSyncPanel />
        </TabsContent>
        <TabsContent value="log" className="space-y-4">
          <SyncLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
