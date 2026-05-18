import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Search, CheckCircle2, XCircle, Clock, CreditCard, Users2, Building2, Loader2, UserPlus } from "lucide-react";

interface AdminUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string | null;
  external_id: string | null;
  family_code: string | null;
  photo_url: string | null;
  status: string;
  is_active: boolean;
  last_synced_at: string | null;
  allergies: string | null;
  customer_type: string | null;
  card_uid: string | null;
  has_children: boolean;
  shop_id: string | null;
  shop_name: string | null;
}

const SHOP_ROLES = new Set(["admin", "manager", "cashier"]);
const OTHER_ROLES = new Set(["teacher", "canteen_owner", "student"]);

type TabKey = "all" | "staff" | "parent" | "shop" | "other";

const STATUSES = ["all", "active", "inactive"];

const relativeTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

function bucketOf(u: AdminUser): TabKey {
  const r = u.role || "";
  if (r === "staff") return "staff";
  if (r === "parent") return "parent";
  if (SHOP_ROLES.has(r)) return "shop";
  if (OTHER_ROLES.has(r)) return "other";
  return "other";
}

const ALL_ROLES = ["admin", "manager", "cashier", "parent", "student"] as const;
const MANAGER_ROLES = ["cashier"] as const;

interface CreateForm {
  username: string;
  password: string;
  full_name: string;
  role: string;
  shop_id: string;
}

export default function UserList() {
  const { t } = useTranslation();
  const { user: authUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    username: "",
    password: "",
    full_name: "",
    role: "",
    shop_id: "",
  });
  const [creating, setCreating] = useState(false);

  const canCreate = authUser?.activeRole === "admin" || authUser?.activeRole === "manager";
  const isManager = authUser?.activeRole === "manager";
  const availableRoles = isManager ? MANAGER_ROLES : ALL_ROLES;

  const resetForm = () => {
    setCreateForm({
      username: "",
      password: "",
      full_name: "",
      role: isManager ? "cashier" : "",
      shop_id: isManager ? (authUser?.shopId ?? "") : "",
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const body: Record<string, string> = {
        username: createForm.username,
        password: createForm.password,
        full_name: createForm.full_name,
        role: createForm.role,
      };
      if (createForm.shop_id.trim()) {
        body.shop_id = createForm.shop_id.trim();
      }
      await api.post("/users", body);
      toast({
        title: t("admin.users.createSuccess", "สร้างผู้ใช้สำเร็จ"),
        description: createForm.username,
      });
      setCreateOpen(false);
      resetForm();
      void load();
    } catch (e) {
      toast({
        title: t("admin.users.createError", "สร้างผู้ใช้ไม่สำเร็จ"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (q.trim()) params.set("q", q.trim());
      const qs = params.toString();
      const data = await api.get<AdminUser[]>(`/users-admin/${qs ? `?${qs}` : ""}`);
      setUsers(data);
    } catch (e) {
      toast({
        title: t("admin.users.loadError", "โหลดข้อมูลไม่สำเร็จ"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const h = setTimeout(() => void load(), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const bucketed = useMemo(() => {
    const map: Record<TabKey, AdminUser[]> = {
      all: users,
      staff: [],
      parent: [],
      shop: [],
      other: [],
    };
    for (const u of users) {
      map[bucketOf(u)].push(u);
    }
    return map;
  }, [users]);

  const counts = useMemo(
    () => ({
      all: bucketed.all.length,
      staff: bucketed.staff.length,
      parent: bucketed.parent.length,
      shop: bucketed.shop.length,
      other: bucketed.other.length,
    }),
    [bucketed],
  );

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.is_active).length,
      synced: users.filter((u) => u.last_synced_at).length,
      missing: users.filter((u) => !u.external_id).length,
    }),
    [users],
  );

  const renderTable = (rows: AdminUser[], key: TabKey) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("admin.users.colName", "Name")}</TableHead>
          <TableHead>{t("admin.users.colRole", "Role")}</TableHead>
          <TableHead>{t("admin.users.colExternalId", "External ID")}</TableHead>
          <TableHead>{t("admin.users.colCardUid", "Card UID")}</TableHead>
          <TableHead>{t("admin.users.colFamily", "Family")}</TableHead>
          <TableHead>{t("admin.users.colStatus", "Status")}</TableHead>
          <TableHead>{t("admin.users.colSynced", "Last synced")}</TableHead>
          <TableHead className="text-right">{t("admin.users.colActions", "Actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
              {t(`admin.users.emptyTab.${key}`, "ไม่พบผู้ใช้")}
            </TableCell>
          </TableRow>
        )}
        {rows.map((u) => (
          <TableRow key={u.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                {u.photo_url ? (
                  <img src={u.photo_url} alt="" className="h-8 w-8 rounded-full object-cover border" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted grid place-items-center text-xs font-semibold text-muted-foreground">
                    {(u.full_name || u.username).slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="font-medium">{u.full_name}</div>
                  <div className="text-xs text-muted-foreground">@{u.username}</div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-1">
                <Badge variant="outline" className="capitalize w-fit">{u.role || "—"}</Badge>
                {u.shop_name && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Building2 className="h-2.5 w-2.5" />
                    {u.shop_name}
                  </span>
                )}
                {u.customer_type && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    PS: {u.customer_type}
                    {u.has_children && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-primary">
                        <Users2 className="h-2.5 w-2.5" />kids
                      </span>
                    )}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {u.external_id || <span className="text-muted-foreground">not linked</span>}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {u.card_uid ? (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                  <CreditCard className="h-3 w-3 text-muted-foreground" />
                  {u.card_uid}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {u.family_code ? (
                <Badge variant="secondary">{u.family_code}</Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {u.is_active ? (
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1">
                  <CheckCircle2 className="h-3 w-3" /> active
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" /> inactive
                </Badge>
              )}
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> {relativeTime(u.last_synced_at)}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <Button asChild size="sm" variant="outline">
                <Link to={`/users/${u.id}`}>{t("admin.users.detail", "Detail")}</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" />
            {t("admin.users.addUser", "+ Add User")}
          </Button>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("admin.users.createTitle", "Create New User")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-full-name">{t("admin.users.fieldFullName", "Full Name")}</Label>
              <Input
                id="create-full-name"
                value={createForm.full_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-username">{t("admin.users.fieldUsername", "Username")}</Label>
              <Input
                id="create-username"
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-password">{t("admin.users.fieldPassword", "Password")}</Label>
              <Input
                id="create-password"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-role">{t("admin.users.fieldRole", "Role")}</Label>
              <Select
                value={createForm.role}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v }))}
                disabled={isManager}
                required
              >
                <SelectTrigger id="create-role">
                  <SelectValue placeholder={t("admin.users.selectRole", "Select role…")} />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-shop">{t("admin.users.fieldShop", "Shop ID (optional)")}</Label>
              <Input
                id="create-shop"
                value={createForm.shop_id}
                onChange={(e) => setCreateForm((f) => ({ ...f, shop_id: e.target.value }))}
                readOnly={isManager}
                className={isManager ? "bg-muted text-muted-foreground" : ""}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button type="submit" disabled={creating || !createForm.role}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("admin.users.createSubmit", "Create User")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.users.statsTotal", "Total users")}</div><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.users.statsActive", "Active")}</div><div className="text-2xl font-bold text-green-600">{stats.active}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.users.statsSynced", "Synced from PS")}</div><div className="text-2xl font-bold">{stats.synced}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.users.statsMissing", "Missing external_id")}</div><div className={`text-2xl font-bold ${stats.missing ? "text-amber-600" : ""}`}>{stats.missing}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("admin.users.searchPlaceholder", "ค้นหา UID / ชื่อ / username / email / external_id")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all"
                      ? t("admin.users.statusAll", "All status")
                      : t(`admin.users.status.${s}`, s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList className="w-full flex-wrap justify-start h-auto sm:w-fit">
              <TabsTrigger value="all">
                {t("admin.users.tabAll", "All")}
                <Badge variant="secondary" className="ml-1.5 px-1.5">{counts.all}</Badge>
              </TabsTrigger>
              <TabsTrigger value="staff">
                {t("admin.users.tabStaff", "Staff")}
                <Badge variant="secondary" className="ml-1.5 px-1.5">{counts.staff}</Badge>
              </TabsTrigger>
              <TabsTrigger value="parent">
                {t("admin.users.tabParent", "Parents")}
                <Badge variant="secondary" className="ml-1.5 px-1.5">{counts.parent}</Badge>
              </TabsTrigger>
              <TabsTrigger value="shop">
                {t("admin.users.tabShop", "Shop Staff")}
                <Badge variant="secondary" className="ml-1.5 px-1.5">{counts.shop}</Badge>
              </TabsTrigger>
              <TabsTrigger value="other">
                {t("admin.users.tabOther", "Others")}
                <Badge variant="secondary" className="ml-1.5 px-1.5">{counts.other}</Badge>
              </TabsTrigger>
            </TabsList>

            {(["all", "staff", "parent", "shop", "other"] as TabKey[]).map((k) => (
              <TabsContent key={k} value={k} className="mt-4">
                {loading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  renderTable(bucketed[k], k)
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
