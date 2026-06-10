/**
 * ShopUserManagement — shared shop-scoped user management component.
 *
 * Mounted under /users (manager view) — shop-scoped to manager's shop. Provides three tabs:
 *   1. Directory     — search existing users and (re)assign them to this shop.
 *   2. Create New    — create a brand-new cashier (or manager, admin-only).
 *   3. Current Team  — list/edit/unassign/delete users attached to this shop.
 *
 * Uses the shop-scoped backend at /api/v1/users (Stream 1A).
 * Styled with the amber/orange ISB theme via Tailwind/shadcn primitives.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus,
  Search,
  UsersRound,
  UserCheck,
  Pencil,
  UserX,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { isPasswordValid } from "@/lib/passwordRules";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserResponse {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  role: string | null;
  is_active: boolean;
  is_superuser: boolean;
  shop_id: string | null;
  shop_name: string | null;
  external_id: string | null;
  family_code: string | null;
  status: string | null;
  created_at: string | null;
}

interface UserListResponse {
  items: UserResponse[];
  total: number;
}

export interface ShopUserManagementProps {
  shopId: string;
  shopName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function originBadge(externalId: string | null, t: TFunction) {
  if (externalId) {
    return (
      <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100 border border-sky-200">
        {t("shopUsers.originPowerschool")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50">
      {t("shopUsers.originManual")}
    </Badge>
  );
}

function statusBadge(isActive: boolean, t: TFunction) {
  return isActive ? (
    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1 border border-green-200">
      <CheckCircle2 className="h-3 w-3" /> {t("shopUsers.statusActive")}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" /> {t("shopUsers.statusInactive")}
    </Badge>
  );
}

function roleLabel(role: string | null | undefined, t: TFunction): string {
  if (!role) return "—";
  const key = `shopUsers.role${role.charAt(0).toUpperCase()}${role.slice(1).toLowerCase()}`;
  // i18next returns the key itself when missing — fall back to capitalised raw role.
  const translated = t(key);
  if (translated === key) return role.charAt(0).toUpperCase() + role.slice(1);
  return translated;
}

function extractDetail(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error) return e.message;
  return fallback;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ShopUserManagement({ shopId, shopName }: ShopUserManagementProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState("team");

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-amber-900">
            <UsersRound className="h-6 w-6 text-amber-600" />
            {shopName} — {t("shopUsers.titleSuffix")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("shopUsers.description", { shopName })}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-amber-50/70 border border-amber-200/80">
          <TabsTrigger value="team" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-amber-900">
            <UsersRound className="h-4 w-4" /> {t("shopUsers.tabCurrentTeam")}
          </TabsTrigger>
          <TabsTrigger value="directory" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-amber-900">
            <Search className="h-4 w-4" /> {t("shopUsers.tabDirectory")}
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-2 data-[state=active]:bg-white data-[state=active]:text-amber-900">
            <UserPlus className="h-4 w-4" /> {t("shopUsers.tabCreateNew")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="space-y-4">
          <CurrentTeamTab shopId={shopId} shopName={shopName} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="directory" className="space-y-4">
          <DirectoryTab shopId={shopId} shopName={shopName} />
        </TabsContent>
        <TabsContent value="create" className="space-y-4">
          <CreateUserTab shopId={shopId} shopName={shopName} isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ShopUserManagement;

// ===========================================================================
// Tab 1 — Current Team
// ===========================================================================

interface TabProps {
  shopId: string;
  shopName: string;
}

function CurrentTeamTab({
  shopId,
  shopName,
  isAdmin,
}: TabProps & { isAdmin: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<UserResponse | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<UserResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserResponse | null>(null);

  const teamQuery = useQuery({
    queryKey: ["users", shopId],
    queryFn: () =>
      api.get<UserListResponse>(
        `/users/?shop_id=${encodeURIComponent(shopId)}&page=1&page_size=200`,
      ),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch<UserResponse>(`/users/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", shopId] });
      queryClient.invalidateQueries({ queryKey: ["users-directory"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<void>(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", shopId] });
      queryClient.invalidateQueries({ queryKey: ["users-directory"] });
    },
  });

  const items = teamQuery.data?.items ?? [];

  const handleUnassign = (u: UserResponse) => {
    patchMutation.mutate(
      { id: u.id, body: { shop_id: null } },
      {
        onSuccess: () => {
          toast({
            title: t("shopUsers.toastUnassigned"),
            description: t("shopUsers.toastUnassignedDesc", { name: u.full_name, shopName }),
          });
          setUnassignTarget(null);
        },
        onError: (e) => {
          toast({
            title: t("shopUsers.toastUnassignFailed"),
            description: extractDetail(e, t("shopUsers.errorGeneric")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleDelete = (u: UserResponse) => {
    deleteMutation.mutate(u.id, {
      onSuccess: () => {
        toast({
          title: t("shopUsers.toastDeleted"),
          description: t("shopUsers.toastDeletedDesc", { name: u.full_name }),
        });
        setDeleteTarget(null);
      },
      onError: (e) => {
        toast({
          title: t("shopUsers.toastDeleteFailed"),
          description: extractDetail(e, t("shopUsers.errorGeneric")),
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Card className="border-amber-200/80">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UsersRound className="h-5 w-5 text-amber-600" />
          {t("shopUsers.teamHeading", { shopName })}
          {teamQuery.data && (
            <span className="text-sm font-normal text-muted-foreground">
              ({teamQuery.data.total})
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {t("shopUsers.teamSubhead", { shopName })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {teamQuery.isLoading ? (
          <div className="py-12 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : teamQuery.isError ? (
          <p className="text-sm text-destructive py-8 text-center">
            {extractDetail(teamQuery.error, t("shopUsers.errorLoad"))}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shopUsers.colName")}</TableHead>
                <TableHead>{t("shopUsers.colUsername")}</TableHead>
                <TableHead>{t("shopUsers.colRole")}</TableHead>
                <TableHead>{t("shopUsers.colOrigin")}</TableHead>
                <TableHead>{t("shopUsers.colStatus")}</TableHead>
                <TableHead className="text-right">{t("shopUsers.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    {t("shopUsers.emptyTeam")}
                  </TableCell>
                </TableRow>
              )}
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.full_name}</div>
                    {u.email && (
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">@{u.username}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {roleLabel(u.role, t)}
                    </Badge>
                  </TableCell>
                  <TableCell>{originBadge(u.external_id, t)}</TableCell>
                  <TableCell>{statusBadge(u.is_active, t)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => setEditing(u)}
                      >
                        <Pencil className="h-3.5 w-3.5" /> {t("shopUsers.actionEdit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                        onClick={() => setUnassignTarget(u)}
                      >
                        <UserX className="h-3.5 w-3.5" /> {t("shopUsers.actionUnassign")}
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t("shopUsers.actionDelete")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit dialog */}
      <EditUserDialog
        open={!!editing}
        user={editing}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={(body) => {
          if (!editing) return;
          patchMutation.mutate(
            { id: editing.id, body },
            {
              onSuccess: () => {
                toast({
                  title: t("shopUsers.toastUpdated"),
                  description: t("shopUsers.toastUpdatedDesc", { name: editing.full_name }),
                });
                setEditing(null);
              },
              onError: (e) => {
                toast({
                  title: t("shopUsers.toastUpdateFailed"),
                  description: extractDetail(e, t("shopUsers.errorGeneric")),
                  variant: "destructive",
                });
              },
            },
          );
        }}
        saving={patchMutation.isPending}
      />

      {/* Unassign confirmation */}
      <AlertDialog
        open={!!unassignTarget}
        onOpenChange={(open) => !open && setUnassignTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("shopUsers.unassignTitle", { shopName })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("shopUsers.unassignBody", { shopName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("shopUsers.btnCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (unassignTarget) handleUnassign(unassignTarget);
              }}
              disabled={patchMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {patchMutation.isPending ? t("shopUsers.btnSaving") : t("shopUsers.actionUnassign")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation (admin) */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("shopUsers.deleteTitle", { name: deleteTarget?.full_name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("shopUsers.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("shopUsers.btnCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) handleDelete(deleteTarget);
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleteMutation.isPending ? t("shopUsers.btnSaving") : t("shopUsers.actionDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

interface EditUserDialogProps {
  open: boolean;
  user: UserResponse | null;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (body: Record<string, unknown>) => void;
  saving: boolean;
}

function EditUserDialog({ open, user, isAdmin, onOpenChange, onSave, saving }: EditUserDialogProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("cashier");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name);
      setEmail(user.email ?? "");
      setRole(user.role ?? "cashier");
      setIsActive(user.is_active);
    }
  }, [user]);

  const canSubmit = fullName.trim().length >= 1 && !saving;

  const handleSubmit = () => {
    const body: Record<string, unknown> = {
      full_name: fullName.trim(),
      email: email.trim() || null,
      is_active: isActive,
    };
    if (isAdmin) {
      body.role = role;
    }
    onSave(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shopUsers.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("shopUsers.editSubhead", { username: user?.username ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-fullname">{t("shopUsers.fieldFullName")}</Label>
            <Input
              id="edit-fullname"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-email">{t("shopUsers.colEmail")}</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
          {isAdmin && (
            <div className="space-y-1.5">
              <Label>{t("shopUsers.fieldRole")}</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">{t("shopUsers.roleCashier")}</SelectItem>
                  <SelectItem value="manager">{t("shopUsers.roleManager")}</SelectItem>
                  <SelectItem value="admin">{t("shopUsers.roleAdmin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center justify-between rounded-md border border-amber-200/60 bg-amber-50/40 p-3">
            <div>
              <Label className="cursor-pointer" htmlFor="edit-active">
                {t("shopUsers.fieldAccountActive")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("shopUsers.fieldAccountActiveHint")}
              </p>
            </div>
            <Switch id="edit-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("shopUsers.btnCancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {saving ? t("shopUsers.btnSaving") : t("shopUsers.btnSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Tab 2 — Directory (search + assign)
// ===========================================================================

function DirectoryTab({ shopId, shopName }: TabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(h);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["users-directory", debounced],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debounced.length > 0) params.set("q", debounced);
      params.set("page", "1");
      params.set("page_size", "30");
      return api.get<UserListResponse>(`/users/?${params.toString()}`);
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, reassign }: { id: number; reassign: boolean }) =>
      api.patch<UserResponse>(`/users/${id}`, {
        shop_id: shopId,
        role: reassign ? undefined : "cashier",
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["users", shopId] });
      queryClient.invalidateQueries({ queryKey: ["users-directory"] });
      toast({
        title: vars.reassign ? t("shopUsers.toastReassigned") : t("shopUsers.toastAssigned"),
        description: t("shopUsers.toastAssignedDesc", { shopName }),
      });
    },
    onError: (e) => {
      toast({
        title: t("shopUsers.toastAssignFailed"),
        description: extractDetail(e, t("shopUsers.errorGeneric")),
        variant: "destructive",
      });
    },
  });

  const items = searchQuery.data?.items ?? [];
  // Filter out users already on this shop (they belong in Current Team tab)
  const available = useMemo(
    () => items.filter((u) => u.shop_id !== shopId),
    [items, shopId],
  );

  return (
    <Card className="border-amber-200/80">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="h-5 w-5 text-amber-600" />
          {t("shopUsers.directorySearchTitle")}
        </CardTitle>
        <CardDescription>
          {t("shopUsers.directorySearchHint", { shopName })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("shopUsers.directorySearchPlaceholder")}
            className="pl-9"
          />
        </div>

        {searchQuery.isLoading ? (
          <div className="py-10 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : searchQuery.isError ? (
          <p className="text-sm text-destructive py-6 text-center">
            {extractDetail(searchQuery.error, t("shopUsers.directorySearchFailed"))}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shopUsers.colName")}</TableHead>
                <TableHead>{t("shopUsers.colEmail")}</TableHead>
                <TableHead>{t("shopUsers.colOrigin")}</TableHead>
                <TableHead>{t("shopUsers.colCurrentlyAt")}</TableHead>
                <TableHead className="text-right">{t("shopUsers.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {available.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    {t("shopUsers.directorySearchNoResults")}
                  </TableCell>
                </TableRow>
              )}
              {available.map((u) => {
                const alreadyAssigned = !!u.shop_id;
                const reassign = alreadyAssigned;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.full_name}</div>
                      <div className="text-xs text-muted-foreground">@{u.username}</div>
                    </TableCell>
                    <TableCell className="text-sm">{u.email ?? "—"}</TableCell>
                    <TableCell>{originBadge(u.external_id, t)}</TableCell>
                    <TableCell>
                      {u.shop_id ? (
                        <Badge variant="secondary">{u.shop_name ?? u.shop_id}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("shopUsers.directoryUnassigned")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700 text-white gap-1"
                        disabled={assignMutation.isPending}
                        onClick={() =>
                          assignMutation.mutate({ id: u.id, reassign })
                        }
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        {reassign ? t("shopUsers.actionReassign") : t("shopUsers.actionAssign")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Tab 3 — Create New
// ===========================================================================

function CreateUserTab({
  shopId,
  shopName,
  isAdmin,
}: TabProps & { isAdmin: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("cashier");
  // Optional family group code so admins can tie staff/manager/cashier
  // accounts to a parent's family for unified portal access.
  const [familyCode, setFamilyCode] = useState("");

  const reset = () => {
    setUsername("");
    setPassword("");
    setFullName("");
    setEmail("");
    setRole("cashier");
    setFamilyCode("");
  };

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<UserResponse>("/users/", body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["users", shopId] });
      queryClient.invalidateQueries({ queryKey: ["users-directory"] });
      toast({
        title: t("shopUsers.toastCreated"),
        description: t("shopUsers.toastCreatedDesc", { name: data.full_name, shopName }),
      });
      reset();
    },
    onError: (e) => {
      let desc = extractDetail(e, t("shopUsers.errorGeneric"));
      if (e instanceof ApiError && e.status === 422) desc = e.detail || desc;
      toast({ title: t("shopUsers.toastCreateFailed"), description: desc, variant: "destructive" });
    },
  });

  const usernameValid = username.trim().length >= 3;
  const passwordValid = isPasswordValid(password);
  const fullNameValid = fullName.trim().length >= 1;
  const canSubmit =
    usernameValid && passwordValid && fullNameValid && !createMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const body: Record<string, unknown> = {
      username: username.trim(),
      password,
      full_name: fullName.trim(),
      role,
      shop_id: shopId,
    };
    if (email.trim()) body.email = email.trim();
    if (familyCode.trim()) body.family_code = familyCode.trim();
    createMutation.mutate(body);
  };

  return (
    <Card className="border-amber-200/80">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-amber-600" />
          {t("shopUsers.createTitle", { role: roleLabel(role, t), shopName })}
        </CardTitle>
        <CardDescription>
          {t("shopUsers.createSubhead", { shopName })} {t("shopUsers.createHint")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-username">{t("shopUsers.fieldUsername")}</Label>
              <Input
                id="new-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("shopUsers.fieldUsernamePlaceholder")}
                autoComplete="off"
              />
              {username.length > 0 && !usernameValid && (
                <p className="text-xs text-destructive">
                  {t("shopUsers.fieldUsernameMin")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t("shopUsers.fieldPassword")}</Label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                showRequirements
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-fullname">{t("shopUsers.fieldFullName")}</Label>
            <Input
              id="new-fullname"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-email">{t("shopUsers.fieldEmail")}</Label>
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("shopUsers.fieldRole")}</Label>
            <Select value={role} onValueChange={setRole} disabled={!isAdmin}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cashier">{t("shopUsers.roleCashier")}</SelectItem>
                {isAdmin && <SelectItem value="manager">{t("shopUsers.roleManager")}</SelectItem>}
              </SelectContent>
            </Select>
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">
                {t("shopUsers.fieldRoleManagerHint")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-family-code">
              {t("shopUsers.fieldFamilyCode", "Family code")}
            </Label>
            <Input
              id="new-family-code"
              value={familyCode}
              onChange={(e) => setFamilyCode(e.target.value)}
              placeholder="FAM-SMITH"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "shopUsers.fieldFamilyCodeHint",
                "Optional. Links this user to other family members (parents, children) sharing the same code.",
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-1"
            >
              <UserPlus className="h-4 w-4" />
              {createMutation.isPending ? t("shopUsers.btnCreating") : t("shopUsers.btnCreate")}
            </Button>
            <Button type="button" variant="outline" onClick={reset} disabled={createMutation.isPending}>
              {t("shopUsers.btnCancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
