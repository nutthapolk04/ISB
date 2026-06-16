import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { fmtDateTime } from "@/lib/dateFormat";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { InfoCallout } from "@/components/InfoCallout";
import CanteenProducts from "./CanteenProducts";
import CanteenCategories from "./CanteenCategories";

interface AuditLogEntry {
  id: number;
  entity_type: string;
  entity_id: number | null;
  entity_name: string | null;
  action: string;
  changes: Record<string, unknown> | null;
  created_at: string;
  user_username: string | null;
  user_full_name: string | null;
}

/**
 * Manager-facing canteen menu page (/canteen/products).
 * Wraps CanteenProducts in tabs so managers can also manage categories + view audit log.
 */
export default function CanteenMenuPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const shopId = user?.shopId ?? "canteen";

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Shared product query (same key as CanteenProducts — react-query dedupes).
  // Used to compute per-category item counts for the Categories tab.
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

  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await api.get<AuditLogEntry[]>(`/shops/${shopId}/audit-logs`);
      setAuditLogs(data);
    } catch {
      /* silently ignore */
    } finally {
      setAuditLoading(false);
    }
  }, [shopId]);

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
          <TabsTrigger value="audit" onClick={fetchAuditLogs}>{t("auditLog.title")}</TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="mt-4">
          <CanteenProducts shopId={shopId} embedded />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <CanteenCategories shopId={shopId} itemCounts={categoryItemCounts} />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {auditLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  {(() => {
                    const hasDetail = auditLogs.some(
                      (log) => log.changes && (log.action === "UPDATE_PRICE" || log.action === "DELETE_PRODUCT"),
                    );
                    return (
                      <>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("auditLog.date")}</TableHead>
                            <TableHead>{t("auditLog.user")}</TableHead>
                            <TableHead>{t("auditLog.action")}</TableHead>
                            <TableHead>{t("auditLog.product")}</TableHead>
                            {hasDetail && <TableHead>{t("auditLog.detail")}</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {auditLogs.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={hasDetail ? 5 : 4} className="h-24 text-center text-muted-foreground">
                                {t("auditLog.noLogs")}
                              </TableCell>
                            </TableRow>
                          ) : (
                            auditLogs.map((log) => (
                              <TableRow key={log.id}>
                                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                  {log.created_at ? fmtDateTime(log.created_at) : "-"}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {log.user_full_name || log.user_username || "-"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={log.action === "DELETE_PRODUCT" ? "destructive" : "secondary"}
                                    className="text-xs"
                                  >
                                    {log.action === "UPDATE_PRICE"
                                      ? t("auditLog.actionUpdatePrice")
                                      : log.action === "DELETE_PRODUCT"
                                      ? t("auditLog.actionDeleteProduct")
                                      : log.action}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-medium">{log.entity_name || "-"}</TableCell>
                                {hasDetail && (
                                  <TableCell className="text-sm text-muted-foreground">
                                    {log.action === "UPDATE_PRICE" && log.changes ? (
                                      <span>
                                        {t("auditLog.oldPrice")}: ฿{(log.changes as {old: {external_price: number}}).old?.external_price ?? "-"}
                                        {" → "}
                                        {t("auditLog.newPrice")}: ฿{(log.changes as {new: {external_price: number}}).new?.external_price ?? "-"}
                                      </span>
                                    ) : log.action === "DELETE_PRODUCT" && log.changes ? (
                                      <span>฿{(log.changes as {snapshot: {external_price: number}}).snapshot?.external_price ?? "-"}</span>
                                    ) : "-"}
                                  </TableCell>
                                )}
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </>
                    );
                  })()}
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
