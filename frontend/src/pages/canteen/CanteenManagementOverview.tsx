import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { UtensilsCrossed, ChevronRight, Package, BarChart3, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface Shop {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  module: string;
}

export default function CanteenManagementOverview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: allShops = [], isLoading } = useQuery<Shop[]>({
    queryKey: ["canteen-shops"],
    queryFn: () => api.get<Shop[]>("/shops?module=canteen"),
  });

  // Manager sees only their own shop; admin sees all
  const shops =
    user?.role === "admin" ? allShops
    : user?.shopId ? allShops.filter((s) => s.id === user.shopId)
    : allShops;

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title mb-2">{t("canteenMgmt.title")}</h1>
        <p className="page-description">{t("canteenMgmt.description")}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t("common.loading")}</span>
        </div>
      ) : shops.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <UtensilsCrossed className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>{t("canteenMgmt.noStalls")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {shops.map((shop) => (
            <Card key={shop.id} className="interactive-card" onClick={() => navigate(`/canteen/management/${shop.id}`)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                      <UtensilsCrossed className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{shop.name}</CardTitle>
                      <p className="text-xs text-muted-foreground font-mono">{shop.id}</p>
                    </div>
                  </div>
                  <Badge variant={shop.is_active ? "default" : "secondary"} className="text-xs">
                    {shop.is_active ? t("common.active") : t("common.inactive")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {shop.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{shop.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/canteen/management/${shop.id}?tab=products`); }}
                    >
                      <Package className="h-3.5 w-3.5 mr-1" />
                      {t("canteenMgmt.menu")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/canteen/reports`); }}
                    >
                      <BarChart3 className="h-3.5 w-3.5 mr-1" />
                      {t("canteenMgmt.reports")}
                    </Button>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
