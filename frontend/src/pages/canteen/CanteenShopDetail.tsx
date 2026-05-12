import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowUpRight, UtensilsCrossed, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import CanteenProducts from "./CanteenProducts";
import CanteenCategories from "./CanteenCategories";

interface Shop {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  module: string;
}

export default function CanteenShopDetail() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const { data: shop, isLoading } = useQuery({
    queryKey: ["shop", shopId],
    queryFn: () => api.get<Shop>(`/shops/${shopId}`),
    enabled: !!shopId,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (shop) {
      setName(shop.name);
      setDescription(shop.description ?? "");
      setIsActive(shop.is_active);
    }
  }, [shop]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.patch(`/shops/${shopId}`, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop", shopId] });
      qc.invalidateQueries({ queryKey: ["shops"] });
      toast.success(t("canteen.shopUpdated"));
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.shopUpdateFailed"));
    },
  });

  if (isLoading) {
    return (
      <div className="page-shell">
        <p className="text-muted-foreground">{t("canteen.loading")}</p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header flex flex-wrap items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/store/management")}
          className="-ml-2 shrink-0"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("canteen.backToManagement")}
        </Button>
        <div>
          <h1 className="page-title flex items-center gap-2">
            <UtensilsCrossed className="h-6 w-6 text-amber-500" />
            {shop?.name ?? shopId}
          </h1>
          <p className="page-description">{t("canteen.canteenLabel")}</p>
        </div>
        <div className="ml-auto">
          <Button asChild variant="outline" size="sm">
            <Link to={`/users?shop=${shopId}`}>
              <Users className="h-4 w-4 mr-1.5" />
              {t("shopUsers.manageStaffLink")}
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="menu">
        <TabsList>
          <TabsTrigger value="menu">{t("canteen.tabMenu")}</TabsTrigger>
          <TabsTrigger value="categories">{t("canteen.tabCategories")}</TabsTrigger>
          <TabsTrigger value="info">{t("canteen.tabInfo")}</TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="mt-4">
          <CanteenProducts shopId={shopId} embedded />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          {shopId && <CanteenCategories shopId={shopId} />}
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>{t("canteen.tabInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("canteen.shopName")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("canteen.shopDescription")}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("canteen.descriptionPlaceholder")}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <Label>{isActive ? t("canteen.statusActive") : t("canteen.statusInactive")}</Label>
              </div>
              <Button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="bg-amber-500 hover:bg-amber-600"
              >
                {saveMut.isPending ? t("canteen.saving") : t("canteen.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
