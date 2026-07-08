import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fmtDateTime } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Building2, Edit3, Save, Users, X } from "lucide-react";
import ShopPicker from "@/components/ShopPicker";
import type { UserDetailData } from "./userDetailTypes";

interface BasicProfileCardProps {
  user: UserDetailData;
  form: Partial<UserDetailData>;
  onFormChange: (patch: Partial<UserDetailData>) => void;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  saving: boolean;
  onSave: () => void;
  extIdReason: string;
  onExtIdReasonChange: (v: string) => void;
}

export function BasicProfileCard({
  user, form, onFormChange, editing, onStartEdit, onCancelEdit, saving, onSave,
  extIdReason, onExtIdReasonChange,
}: BasicProfileCardProps) {
  const { t } = useTranslation();
  const extIdChanged = editing && (form.external_id || null) !== (user.external_id || null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> {t("admin.users.profileTitle")}
        </CardTitle>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={onStartEdit}>
            <Edit3 className="h-4 w-4" />
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={onCancelEdit}>
              <X className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? t("admin.users.saving") : t("admin.users.save")}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.fullName")}</p>
            {editing ? (
              <Input value={form.full_name || ""} onChange={(e) => onFormChange({ full_name: e.target.value })} />
            ) : (
              <p className="text-sm">{user.full_name}</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.email")}</p>
            {editing ? (
              <Input type="email" value={form.email || ""} onChange={(e) => onFormChange({ email: e.target.value })} />
            ) : (
              <div className="space-y-0.5">
                <p className="text-sm">{user.email || <span className="text-muted-foreground italic">—</span>}</p>
                {(user.family_profile?.notification_emails ?? []).map((e) => (
                  <p key={e} className="text-sm text-muted-foreground">{e}</p>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.role")}</p>
            {editing ? (
              <Select value={form.role || ""} onValueChange={(v) => onFormChange({ role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["admin", "manager", "cashier", "staff", "teacher", "parent"].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className="capitalize w-fit">{user.role || "—"}</Badge>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.status")}</p>
            {editing ? (
              <Select value={form.status || "active"} onValueChange={(v) => onFormChange({ status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge className={`w-fit capitalize border-0 ${user.is_active ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-red-100 text-red-600 hover:bg-red-100"}`}>
                {user.status}
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.externalId")}</p>
            {editing ? (
              <Input
                value={form.external_id || ""}
                onChange={(e) => onFormChange({ external_id: e.target.value })}
                placeholder="PSPA-00301"
                className="font-mono"
              />
            ) : (
              <p className="text-sm font-mono">
                {user.external_id || <span className="text-muted-foreground italic">not linked</span>}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.familyCode")}</p>
            {editing ? (
              <Input
                value={form.family_code || ""}
                onChange={(e) => onFormChange({ family_code: e.target.value })}
                placeholder="FAM-SMITH"
                className="font-mono"
              />
            ) : (
              user.family_code
                ? <Badge variant="secondary" className="w-fit font-mono">{user.family_code}</Badge>
                : <p className="text-sm text-muted-foreground italic">—</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.username", "Username")}</p>
            <p className="text-sm font-mono">@{user.username}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("admin.users.lastSynced", "Last synced")}</p>
            <p className="text-sm text-muted-foreground">
              {user.last_synced_at ? fmtDateTime(user.last_synced_at) : "never"}
            </p>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <p className="text-xs text-muted-foreground">{t("admin.users.shopAssignment")}</p>
            {editing ? (
              <ShopPicker value={form.shop_id || null} onChange={(id) => onFormChange({ shop_id: id })} allowNone />
            ) : (
              user.shop_id ? (
                <Link to={`/store/management/${user.shop_id}`}>
                  <Badge variant="secondary" className="w-fit hover:bg-secondary/80 cursor-pointer gap-1">
                    <Building2 className="h-3 w-3" />
                    {user.shop_name || user.shop_id}
                  </Badge>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground italic">— {t("admin.users.noShop")} —</p>
              )
            )}
          </div>
        </div>

        {extIdChanged && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <AlertTriangle className="h-4 w-4" /> {t("admin.users.extIdChangeWarning")}
            </div>
            <Textarea
              value={extIdReason}
              onChange={(e) => onExtIdReasonChange(e.target.value)}
              placeholder={t("admin.users.extIdReasonPlaceholder", "e.g. PowerSchool renumbered during annual rollover")}
              rows={2}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
