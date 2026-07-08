import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Crown, Plus, ShieldCheck, X } from "lucide-react";

interface RoleRow { id: number; name: string; description?: string | null }

const ALL_ROLES = ["admin", "manager", "cashier", "parent", "staff", "teacher", "student", "kitchen"];

interface UserRoleManagerProps {
  userId: string;
  primaryRole: string | null;
}

export function UserRoleManager({ userId, primaryRole }: UserRoleManagerProps) {
  const { t } = useTranslation();
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  const [extraRolesLoading, setExtraRolesLoading] = useState(false);
  const [roleToAdd, setRoleToAdd] = useState<string>("");

  const loadExtraRoles = async () => {
    if (!userId) return;
    setExtraRolesLoading(true);
    try {
      const rows = await api.get<RoleRow[]>(`/auth/users/${userId}/roles`);
      setExtraRoles(rows.map((r) => r.name));
    } catch {
      setExtraRoles([]);
    } finally {
      setExtraRolesLoading(false);
    }
  };

  useEffect(() => { loadExtraRoles(); /* eslint-disable-next-line */ }, [userId]);

  const addExtraRole = async (name: string) => {
    if (!userId || !name) return;
    try {
      const rows = await api.post<RoleRow[]>(`/auth/users/${userId}/roles`, { role_name: name });
      setExtraRoles(rows.map((r) => r.name));
      setRoleToAdd("");
      toast({ title: t("admin.users.roleAdded", "Role added") });
    } catch (e) {
      toast({
        title: t("admin.users.roleAddFailed", "Could not add role"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const removeExtraRole = async (name: string) => {
    if (!userId) return;
    try {
      const rows = await api.delete<RoleRow[]>(`/auth/users/${userId}/roles/${encodeURIComponent(name)}`);
      setExtraRoles(rows.map((r) => r.name));
      toast({ title: t("admin.users.roleRemoved", "Role removed") });
    } catch (e) {
      toast({
        title: t("admin.users.roleRemoveFailed", "Could not remove role"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          {t("admin.users.extraRolesTitle", "Additional roles")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t(
            "admin.users.extraRolesHint",
            "Add more roles on top of the primary role above. Lets a single account act as e.g. manager + parent — at login they pick which role to use.",
          )}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Primary role chip — informative, not removable. */}
          {primaryRole && (
            <Badge variant="secondary" className="capitalize gap-1">
              <Crown className="h-3 w-3" />
              {primaryRole}
              <span className="text-[10px] opacity-70 ml-0.5">{t("admin.users.primaryRole", "primary")}</span>
            </Badge>
          )}

          {extraRolesLoading && (
            <span className="text-xs text-muted-foreground">…</span>
          )}

          {!extraRolesLoading && extraRoles
            .filter((r) => r !== primaryRole)
            .map((r) => (
              <span
                key={r}
                className="inline-flex items-center text-xs rounded-md border bg-emerald-50/60 border-emerald-200 pl-2 pr-1 py-1 capitalize"
              >
                {r}
                <button
                  type="button"
                  onClick={() => removeExtraRole(r)}
                  className="ml-1 rounded-full hover:bg-emerald-200/60 p-0.5"
                  title={t("admin.users.removeRole", "Remove role")}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

          {!extraRolesLoading && extraRoles.filter((r) => r !== primaryRole).length === 0 && (
            <span className="text-xs text-muted-foreground italic">
              {t("admin.users.noExtraRoles", "No additional roles yet")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={roleToAdd} onValueChange={setRoleToAdd}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t("admin.users.selectRoleToAdd", "Choose role to add")} />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROLES
                .filter((r) => r !== primaryRole && !extraRoles.includes(r))
                .map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => addExtraRole(roleToAdd)}
            disabled={!roleToAdd}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("admin.users.addRoleBtn", "Add role")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
