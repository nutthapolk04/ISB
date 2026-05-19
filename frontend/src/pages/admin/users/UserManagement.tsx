import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Activity, ListChecks, IdCard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ShopUserManagement } from "@/components/ShopUserManagement";
import CardholderList from "./CardholderList";
import UserList from "./UserList";
import SyncDashboard from "./SyncDashboard";
import SyncLog from "./SyncLog";

export default function UserManagement() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState("cardholders");

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
        <TabsList>
          <TabsTrigger value="cardholders" className="gap-2">
            <IdCard className="h-4 w-4" /> Cardholders
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" /> {t("admin.users.tabUsers")}
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-2">
            <Activity className="h-4 w-4" /> {t("admin.users.tabSyncDashboard")}
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-2">
            <ListChecks className="h-4 w-4" /> {t("admin.users.tabSyncLog")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cardholders" className="space-y-4">
          <CardholderList />
        </TabsContent>
        <TabsContent value="users" className="space-y-4">
          <UserList />
        </TabsContent>
        <TabsContent value="dashboard" className="space-y-4">
          <SyncDashboard />
        </TabsContent>
        <TabsContent value="log" className="space-y-4">
          <SyncLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
