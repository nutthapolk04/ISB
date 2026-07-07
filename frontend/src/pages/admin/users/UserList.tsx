import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
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
import { Search, CheckCircle2, XCircle, Clock, CreditCard, Users2, Building2, Loader2, UserPlus, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  staff_type?: string | null;
  ps_department?: string | null;
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
  // Only admins may delete users — managers can create staff but cannot
  // remove accounts, since deletion cascades to wallets and audit data.
  const canDelete = authUser?.activeRole === "admin";

  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/users/${deleting.id}`);
      toast({
        title: t("admin.users.deleteSuccess", "User deleted"),
        description: deleting.full_name || deleting.username,
      });
      setDeleting(null);
      // Refresh by remounting the row data — simplest is to re-trigger the
      // existing effect via search update; instead just hide locally.
      // Caller's useEffect on `query` will re-fetch on next interaction.
      window.location.reload();
    } catch (e) {
      toast({
        title: t("admin.users.deleteFailed", "Failed to delete user"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleteBusy(false);
    }
  };

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
        title: t("admin.users.createSuccess", "User created"),
        description: createForm.username,
      });
      setCreateOpen(false);
      resetForm();
      void load();
    } catch (e) {
      toast({
        title: t("admin.users.createError", "Failed to create user"),
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
        title: t("admin.users.loadError", "Failed to load users"),
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

  const debouncedQ = useDebounce(q, 300);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

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

  const activeByBucket = useMemo(
    () => ({
      all:    bucketed.all.filter((u) => u.is_active).length,
      staff:  bucketed.staff.filter((u) => u.is_active).length,
      parent: bucketed.parent.filter((u) => u.is_active).length,
      shop:   bucketed.shop.filter((u) => u.is_active).length,
      other:  bucketed.other.filter((u) => u.is_active).length,
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
                {u.shop_id && (
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {u.shop_id}
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
                {u.staff_type && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                    u.staff_type === "Classified Staff"
                      ? "bg-blue-100 text-blue-700 border-blue-300"
                      : "bg-violet-100 text-violet-700 border-violet-300"
                  }`}>
                    {u.staff_type === "Classified Staff" ? "Classified" : "Certified"}
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
              <div className="flex items-center justify-end gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to={`/users/${u.id}`}>{t("admin.users.detail", "Detail")}</Link>
                </Button>
                {canDelete && u.id !== authUser?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 h-8 w-8 p-0"
                    onClick={() => setDeleting(u)}
                    title={t("admin.users.deleteTitle", "Delete user")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
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
              <PasswordInput
                id="create-password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                autoComplete="new-password"
                required
                showRequirements
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

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.users.deleteConfirmTitle", "Confirm user deletion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "admin.users.deleteConfirmDesc",
                "Deletion will remove the wallet, audit records, and all linked data. This cannot be undone.",
              )}
              <div className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm font-medium">
                {deleting?.full_name} <span className="text-muted-foreground">@{deleting?.username}</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>
              {t("common.cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteBusy}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("admin.users.deleteConfirm", "Delete user")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                placeholder={t("admin.users.searchPlaceholder", "Search UID / name / username / email / external_id")}
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
              {(
                [
                  { key: "all",    label: t("admin.users.tabAll", "All") },
                  { key: "staff",  label: t("admin.users.tabStaff", "Staff") },
                  { key: "parent", label: t("admin.users.tabParent", "Parents") },
                  { key: "shop",   label: t("admin.users.tabShop", "Shop Staff") },
                  { key: "other",  label: t("admin.users.tabOther", "Others") },
                ] as { key: TabKey; label: string }[]
              ).map(({ key, label }) => {
                const total    = counts[key];
                const active   = activeByBucket[key];
                const inactive = total - active;
                return (
                  <TabsTrigger key={key} value={key}>
                    {label}
                    <span className="ml-1.5 inline-flex items-center gap-0.5">
                      <Badge className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 hover:bg-green-100 border-0">
                        {active}
                      </Badge>
                      {inactive > 0 && (
                        <Badge className="px-1.5 py-0 text-[10px] bg-red-100 text-red-600 hover:bg-red-100 border-0">
                          {inactive}
                        </Badge>
                      )}
                    </span>
                  </TabsTrigger>
                );
              })}
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
