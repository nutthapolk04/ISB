import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, History, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditLogEntry {
  id: number;
  created_at: string;
  entity_type: string;
  entity_id: number | null;
  entity_name: string | null;
  shop_id: string | null;
  action: string;
  user_id: number;
  user_username: string | null;
  user_full_name: string | null;
  changes: unknown;
  ip_address: string | null;
}

interface ListResponse {
  items: AuditLogEntry[];
  total: number;
}

const ACTION_BADGE: Record<string, string> = {
  create: "bg-green-100 text-green-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-red-100 text-red-800",
  void: "bg-amber-100 text-amber-800",
  return: "bg-purple-100 text-purple-800",
  exchange: "bg-purple-100 text-purple-800",
  approve: "bg-emerald-100 text-emerald-800",
  reject: "bg-rose-100 text-rose-800",
  cancel: "bg-gray-100 text-gray-700",
  reprint: "bg-sky-100 text-sky-800",
};

const PAGE_SIZE = 50;

export default function AuditLogList() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(PAGE_SIZE));
      if (entityType !== "all") params.set("entity_type", entityType);
      if (action !== "all") params.set("action", action);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const data = await api.get<ListResponse>(`/admin/audit-logs?${params.toString()}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      toast({
        title: t("audit.loadFailed"),
        description: err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const formatChanges = (changes: unknown) => {
    if (!changes) return null;
    try {
      return JSON.stringify(changes, null, 2);
    } catch {
      return String(changes);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <History className="h-7 w-7 text-primary" />
          {t("audit.title")}
        </h1>
        <p className="page-description">{t("audit.description")}</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label>{t("audit.filterEntity")}</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("audit.filterAll")}</SelectItem>
                  <SelectItem value="receipt">receipt</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="shop">shop</SelectItem>
                  <SelectItem value="product">product</SelectItem>
                  <SelectItem value="wallet">wallet</SelectItem>
                  <SelectItem value="return">return</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("audit.filterAction")}</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("audit.filterAll")}</SelectItem>
                  {Object.keys(ACTION_BADGE).map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("audit.filterDateFrom")}</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("audit.filterDateTo")}</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => { setPage(1); load(); }} disabled={loading} className="w-full">
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {t("audit.applyFilters")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("audit.colDate")}</TableHead>
                <TableHead>{t("audit.colUser")}</TableHead>
                <TableHead>{t("audit.colEntity")}</TableHead>
                <TableHead>{t("audit.colAction")}</TableHead>
                <TableHead>{t("audit.colChanges")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    {t("shopUsers.loading")}
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {t("audit.noResults")}
                  </TableCell>
                </TableRow>
              )}
              {items.map((row) => {
                const badgeClass = ACTION_BADGE[row.action] ?? "bg-gray-100 text-gray-700";
                const hasChanges = row.changes && Object.keys(row.changes as object).length > 0;
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {new Date(row.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{row.user_full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">@{row.user_username ?? row.user_id}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">
                        {row.entity_type}
                        {row.entity_id !== null && (
                          <span className="text-muted-foreground"> #{row.entity_id}</span>
                        )}
                      </div>
                      {row.entity_name && (
                        <div className="text-xs text-muted-foreground truncate max-w-[160px]">{row.entity_name}</div>
                      )}
                      {row.shop_id && (
                        <div className="text-[11px] text-muted-foreground/60">{row.shop_id}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[11px] font-medium uppercase", badgeClass)}>
                        {row.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {hasChanges ? (
                        <Collapsible open={openId === row.id} onOpenChange={(o) => setOpenId(o ? row.id : null)}>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 -ml-2">
                              <ChevronDown className={cn("h-4 w-4 mr-1 transition", openId === row.id && "rotate-180")} />
                              {t("audit.viewChanges")}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto max-w-2xl">
                              {formatChanges(row.changes)}
                            </pre>
                          </CollapsibleContent>
                        </Collapsible>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <p className="text-muted-foreground">
          {t("audit.totalCount", { total })}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("audit.prev")}
          </Button>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("audit.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
