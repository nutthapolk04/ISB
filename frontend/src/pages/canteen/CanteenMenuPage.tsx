import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { InfoCallout } from "@/components/InfoCallout";
import { PricePanelManager } from "@/components/PricePanelManager";
import { ShopImportPanel } from "@/components/ShopImportPanel";
import CanteenProducts from "./CanteenProducts";
import CanteenCategories from "./CanteenCategories";

interface Shop {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  receipt_header?: string | null;
  receipt_footer?: string | null;
}

export default function CanteenMenuPage() {
  const { user, hasRole } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const shopId = user?.shopId ?? "canteen";

  const { data: products = [] } = useQuery({
    queryKey: ["canteen-products", shopId],
    queryFn: () =>
      api.get<Array<{ category: string | null }>>(
        `/shops/${shopId}/products?include_inactive=true`,
      ),
  });

  const categoryItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      const name = p.category?.trim();
      if (!name) continue;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
  }, [products]);

  const { data: shop } = useQuery({
    queryKey: ["shop", shopId],
    queryFn: () => api.get<Shop>(`/shops/${shopId}`),
    enabled: !!shopId,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [receiptHeader, setReceiptHeader] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");

  useEffect(() => {
    if (shop) {
      setName(shop.name);
      setDescription(shop.description ?? "");
      setIsActive(shop.is_active);
      setReceiptHeader(shop.receipt_header ?? "");
      setReceiptFooter(shop.receipt_footer ?? "");
    }
  }, [shop]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.patch(`/shops/${shopId}`, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
        receipt_header: receiptHeader.trim() || null,
        receipt_footer: receiptFooter.trim() || null,
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

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title">{t("canteen.menuTitle")}</h1>
        <p className="page-description">{t("canteen.menuDescription")}</p>
      </div>

      <InfoCallout
        id="canteen.optionGroups"
        variant="tip"
        title={t("canteen.info.optionGroups.title")}
      >
        {t("canteen.info.optionGroups.body")}
      </InfoCallout>

      <Tabs defaultValue="menu" className="pt-2">
        <TabsList>
          <TabsTrigger value="menu">{t("canteen.tabMenu")}</TabsTrigger>
          <TabsTrigger value="categories">{t("canteen.tabCategories")}</TabsTrigger>
          <TabsTrigger value="panels">{t("canteen.tabPanels", "Tab")}</TabsTrigger>
          <TabsTrigger value="info">{t("canteen.tabInfo")}</TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="mt-4 space-y-4">
          {(hasRole("admin") || hasRole("manager")) && (
            <ShopImportPanel shopId={shopId} showStockReceive={false} />
          )}
          <CanteenProducts shopId={shopId} embedded />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <CanteenCategories shopId={shopId} itemCounts={categoryItemCounts} />
        </TabsContent>

        <TabsContent value="panels" className="mt-4">
          <PricePanelManager shopId={shopId} autoLoad />
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>{t("canteen.tabInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("management.shopId", "Shop ID")}</Label>
                <div className="rounded-md border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                  {shopId}
                </div>
              </div>
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
              <div className="space-y-1.5">
                <Label>{t("management.receiptHeader", "Receipt Header")}</Label>
                <Textarea
                  value={receiptHeader}
                  onChange={(e) => setReceiptHeader(e.target.value)}
                  placeholder={t("management.receiptHeaderPlaceholder", "e.g. Shop Building A, 2nd Floor")}
                  maxLength={200}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">{t("management.receiptHeaderHint", "Shown below shop name on receipt")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("management.receiptFooter", "Receipt Footer")}</Label>
                <Textarea
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                  placeholder={t("management.receiptFooterPlaceholder", "e.g. Thank you for shopping with us!")}
                  maxLength={200}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">{t("management.receiptFooterHint", "Overrides school footer. Leave blank to use school default.")}</p>
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
