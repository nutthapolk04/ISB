import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import ShopPicker from "@/components/ShopPicker";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  Edit3,
  History as HistoryIcon,
  Users,
  AlertTriangle,
  Save,
  Trash2,
  Link2,
  X,
  CreditCard,
  Mail,
  Users2,
  Crown,
  UserCircle2,
  Building2,
  ShieldCheck,
  Plus,
} from "lucide-react";

interface FamilyMember {
  entity_type: "user" | "customer";
  id: number;
  name: string;
  role: string | null;
  external_id: string | null;
  grade: string | null;
  photo_url: string | null;
  student_code: string | null;
  customer_code: string | null;
  customer_type: string | null;
  school_type: string | null;
  card_uid: string | null;
  parent_rank: string | null;
}

interface IdentityHistoryItem {
  id: number;
  entity_type: string;
  old_external_id: string | null;
  new_external_id: string | null;
  reason: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

interface FamilyProfileData {
  family_code: string;
  notification_emails: string[];
  login_ids: string[];
  last_synced_at: string | null;
}

interface UserDetailData {
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
  family_profile: FamilyProfileData | null;
  family_members: FamilyMember[];
  identity_history: IdentityHistoryItem[];
  shop_id: string | null;
  shop_name: string | null;
  staff_type?: string | null;
  ps_department?: string | null;
}

interface StudentOption {
  id: number;
  name: string;
  student_code: string | null;
  grade: string | null;
  family_code: string | null;
  external_id: string | null;
  school_type: string | null;
  card_uid: string | null;
}

export default function UserDetail() {
  const { t } = useTranslation();
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<UserDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingBasic, setEditingBasic] = useState(false);
  const [editingHealth, setEditingHealth] = useState(false);
  const [form, setForm] = useState<Partial<UserDetailData>>({});
  const [extIdReason, setExtIdReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingHealth, setSavingHealth] = useState(false);

  // RFID bind dialog
  const [cardOpen, setCardOpen] = useState(false);
  const [cardInput, setCardInput] = useState("");
  const [savingCard, setSavingCard] = useState(false);

  // Notification emails editor
  const [notifDraft, setNotifDraft] = useState("");
  const [savingNotif, setSavingNotif] = useState(false);

  // Additional roles (secondary roles on top of user.role) — manager+parent
  // hybrids, staff+teacher, etc. Backed by /auth/users/{id}/roles.
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  const [extraRolesLoading, setExtraRolesLoading] = useState(false);
  const [roleToAdd, setRoleToAdd] = useState<string>("");
  const ALL_ROLES = ["admin", "manager", "cashier", "parent", "staff", "teacher", "student", "kitchen"];

  // Link student dialog
  const [linkOpen, setLinkOpen] = useState(false);
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentQ, setStudentQ] = useState("");
  const [studentId, setStudentId] = useState<string>("");
  const [relation, setRelation] = useState("guardian");
  const [parentRank, setParentRank] = useState<string>("main");
  const [linking, setLinking] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await api.get<UserDetailData>(`/users-admin/${userId}`);
      setUser(data);
      setForm({
        full_name: data.full_name,
        email: data.email,
        role: data.role,
        external_id: data.external_id,
        family_code: data.family_code,
        status: data.status,
        allergies: data.allergies,
        shop_id: data.shop_id,
      });
      setCardInput(data.card_uid || "");
    } catch (e) {
      toast({
        title: t("admin.users.loadError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const save = async () => {
    if (!user) return;
    const extIdChanged = (form.external_id || null) !== (user.external_id || null);
    if (extIdChanged && !extIdReason.trim()) {
      toast({ title: t("admin.users.externalIdReasonRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        external_id: form.external_id || null,
        family_code: form.family_code || null,
        status: form.status,
        shop_id: form.shop_id || null,
      };
      if (extIdChanged) body.external_id_change_reason = extIdReason.trim();
      const updated = await api.patch<UserDetailData>(`/users-admin/${user.id}`, body);
      setUser(updated);
      setEditingBasic(false);
      setExtIdReason("");
      toast({ title: t("admin.users.saveSuccess") });
    } catch (e) {
      toast({
        title: t("admin.users.saveError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveHealth = async () => {
    if (!user) return;
    setSavingHealth(true);
    try {
      const updated = await api.patch<UserDetailData>(`/users-admin/${user.id}`, {
        allergies: form.allergies || null,
      });
      setUser(updated);
      setEditingHealth(false);
      toast({ title: t("admin.users.saveSuccess") });
    } catch (e) {
      toast({
        title: t("admin.users.saveError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingHealth(false);
    }
  };

  // ── Extra roles (multi-role support) ────────────────────────────────────
  interface RoleRow { id: number; name: string; description?: string | null }

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

  useEffect(() => { loadExtraRoles(); /* eslint-disable-next-line */ }, [userId]);

  const loadStudents = async () => {
    try {
      const qs = studentQ.trim() ? `?q=${encodeURIComponent(studentQ.trim())}` : "";
      const data = await api.get<StudentOption[]>(`/users-admin/students${qs}`);
      setStudentOptions(data);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!linkOpen) return;
    const h = setTimeout(loadStudents, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentQ, linkOpen]);

  const linkStudent = async () => {
    if (!user || !studentId) return;
    setLinking(true);
    try {
      await api.post(`/users-admin/${user.id}/link-student`, {
        child_customer_id: Number(studentId),
        relation,
        parent_rank: parentRank || null,
      });
      toast({ title: t("admin.users.linkSuccess") });
      setLinkOpen(false);
      setStudentId("");
      setStudentQ("");
      load();
    } catch (e) {
      toast({
        title: t("admin.users.linkError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLinking(false);
    }
  };

  const saveCardUid = async () => {
    if (!user) return;
    const cleaned = cardInput.trim().toUpperCase() || null;
    setSavingCard(true);
    try {
      const updated = await api.patch<UserDetailData>(`/users-admin/${user.id}`, {
        card_uid: cleaned,
      });
      setUser(updated);
      setCardOpen(false);
      toast({ title: cleaned ? t("admin.users.cardUidSaved") : t("admin.users.cardUidRemoved") });
    } catch (e) {
      toast({
        title: t("admin.users.cardUidError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingCard(false);
    }
  };

  const addNotifEmail = async () => {
    if (!user || !user.family_code) return;
    const raw = notifDraft.trim().toLowerCase();
    if (!raw) return;
    const current = user.family_profile?.notification_emails || [];
    if (current.includes(raw)) {
      setNotifDraft("");
      return;
    }
    setSavingNotif(true);
    try {
      const updated = await api.patch<FamilyProfileData>(
        `/users-admin/family-profile/${user.family_code}`,
        { notification_emails: [...current, raw] },
      );
      setUser({ ...user, family_profile: updated });
      setNotifDraft("");
    } catch (e) {
      toast({
        title: t("admin.users.addEmailError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingNotif(false);
    }
  };

  const removeNotifEmail = async (email: string) => {
    if (!user || !user.family_code) return;
    const current = user.family_profile?.notification_emails || [];
    setSavingNotif(true);
    try {
      const updated = await api.patch<FamilyProfileData>(
        `/users-admin/family-profile/${user.family_code}`,
        { notification_emails: current.filter((e) => e !== email) },
      );
      setUser({ ...user, family_profile: updated });
    } catch (e) {
      toast({
        title: t("admin.users.removeEmailError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingNotif(false);
    }
  };

  const unlinkStudent = async (customerId: number) => {
    if (!user) return;
    if (!confirm(t("admin.families.confirmDeleteTitle"))) return;
    try {
      await api.delete(`/users-admin/${user.id}/link-student/${customerId}`);
      toast({ title: t("admin.users.removeLinkSuccess") });
      load();
    } catch (e) {
      toast({
        title: t("admin.users.removeLinkError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    }
  };

  if (loading) return <div className="page-shell"><p className="text-muted-foreground">{t("admin.users.loading")}</p></div>;
  if (!user) return <div className="page-shell"><p className="text-destructive">{t("admin.users.notFound")}</p></div>;

  const initials = user.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const extIdChanged = editingBasic && (form.external_id || null) !== (user.external_id || null);

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-1" /> {t("admin.users.back")}
      </Button>

      {/* ── Hero card ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <Avatar className="h-24 w-24 shrink-0">
              {user.photo_url && <AvatarImage src={user.photo_url} alt={user.full_name} />}
              <AvatarFallback className="text-xl">{initials}</AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <h1 className="text-2xl font-bold">{user.full_name}</h1>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {user.role && <Badge variant="outline" className="capitalize">{user.role}</Badge>}
                  <Badge className={`border-0 ${user.is_active ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-red-100 text-red-600 hover:bg-red-100"}`}>
                    {user.is_active ? "Active" : "Inactive"}
                  </Badge>
                  {user.customer_type && (
                    <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 gap-1">
                      <UserCircle2 className="h-3 w-3" /> PS: {user.customer_type}
                    </Badge>
                  )}
                  {user.staff_type && (
                    <Badge className={`border ${user.staff_type === "Classified Staff" ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-violet-100 text-violet-700 border-violet-300"}`}>
                      {user.staff_type === "Classified Staff" ? "Classified" : "Certified"}
                    </Badge>
                  )}
                  {user.has_children && (
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">
                      <Users2 className="h-3 w-3" /> {t("admin.users.hasChildren")}
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1">@{user.username}</div>
                {user.ps_department && <div className="text-xs text-muted-foreground">{user.ps_department}</div>}
                <div className="text-xs text-muted-foreground">
                  {t("admin.users.lastSynced", "Last synced")}: {user.last_synced_at ? new Date(user.last_synced_at).toLocaleString() : "never"}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setCardInput(user.card_uid || ""); setCardOpen(true); }}
              >
                <CreditCard className="h-4 w-4 mr-1" />
                {user.card_uid ? t("admin.users.rebind") : t("admin.users.bindCard")}
              </Button>
              {user.card_uid && (
                <p className="text-xs text-muted-foreground font-mono text-center">{user.card_uid}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 2-col info cards ─────────────────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Basic Information */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> {t("admin.users.profileTitle")}
            </CardTitle>
            {!editingBasic ? (
              <Button variant="ghost" size="sm" onClick={() => setEditingBasic(true)}>
                <Edit3 className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setEditingBasic(false); load(); setExtIdReason(""); }}>
                  <X className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" /> {saving ? t("admin.users.saving") : t("admin.users.save")}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("admin.users.fullName")}</p>
                {editingBasic ? (
                  <Input value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                ) : (
                  <p className="text-sm">{user.full_name}</p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("admin.users.email")}</p>
                {editingBasic ? (
                  <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                ) : (
                  <p className="text-sm">{user.email || <span className="text-muted-foreground italic">—</span>}</p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("admin.users.role")}</p>
                {editingBasic ? (
                  <Select value={form.role || ""} onValueChange={(v) => setForm({ ...form, role: v })}>
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
                {editingBasic ? (
                  <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
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
                {editingBasic ? (
                  <Input
                    value={form.external_id || ""}
                    onChange={(e) => setForm({ ...form, external_id: e.target.value })}
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
                {editingBasic ? (
                  <Input
                    value={form.family_code || ""}
                    onChange={(e) => setForm({ ...form, family_code: e.target.value })}
                    placeholder="FAM-SMITH"
                    className="font-mono"
                  />
                ) : (
                  user.family_code
                    ? <Badge variant="secondary" className="w-fit font-mono">{user.family_code}</Badge>
                    : <p className="text-sm text-muted-foreground italic">—</p>
                )}
              </div>

              <div className="space-y-1 sm:col-span-2">
                <p className="text-xs text-muted-foreground">{t("admin.users.shopAssignment")}</p>
                {editingBasic ? (
                  <ShopPicker value={form.shop_id || null} onChange={(id) => setForm({ ...form, shop_id: id })} allowNone />
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
                  onChange={(e) => setExtIdReason(e.target.value)}
                  placeholder={t("admin.users.extIdReasonPlaceholder", "e.g. PowerSchool renumbered during annual rollover")}
                  rows={2}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Health / Allergy */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> {t("admin.users.healthProfile")}
            </CardTitle>
            {!editingHealth ? (
              <Button variant="ghost" size="sm" onClick={() => setEditingHealth(true)}>
                <Edit3 className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setEditingHealth(false); setForm({ ...form, allergies: user.allergies ?? "" }); }}>
                  <X className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={saveHealth} disabled={savingHealth}>
                  <Save className="h-4 w-4 mr-1" /> {savingHealth ? t("admin.users.saving") : t("admin.users.save")}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("admin.users.allergiesSynced")}</p>
              {editingHealth ? (
                <Textarea
                  value={form.allergies || ""}
                  onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                  placeholder="peanut, dairy, ..."
                  rows={4}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">
                  {user.allergies || <span className="text-muted-foreground italic">{t("admin.users.noAllergies")}</span>}
                </p>
              )}
              {!editingHealth && (
                <p className="text-xs text-muted-foreground">{t("admin.users.allergyOverrideHint")}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Additional roles (multi-role) */}
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
            {user.role && (
              <Badge variant="secondary" className="capitalize gap-1">
                <Crown className="h-3 w-3" />
                {user.role}
                <span className="text-[10px] opacity-70 ml-0.5">{t("admin.users.primaryRole", "primary")}</span>
              </Badge>
            )}

            {extraRolesLoading && (
              <span className="text-xs text-muted-foreground">…</span>
            )}

            {!extraRolesLoading && extraRoles
              .filter((r) => r !== user.role)
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

            {!extraRolesLoading && extraRoles.filter((r) => r !== user.role).length === 0 && (
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
                  .filter((r) => r !== user.role && !extraRoles.includes(r))
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

      {/* Family members + notification emails */}
      {user.family_code && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-lg">{t("admin.users.familyGroupLabel")}<span className="font-mono text-base">{user.family_code}</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {user.family_members.map((m) => (
                <div key={`${m.entity_type}-${m.id}`} className="flex items-start gap-3 rounded-md border p-3">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt="" className="h-12 w-12 rounded-full object-cover border" />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-muted grid place-items-center text-xs font-semibold text-muted-foreground">
                      {m.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 font-medium truncate">
                      {m.parent_rank === "main" && (
                        <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Main parent" />
                      )}
                      <span className="truncate">{m.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-1 mt-0.5">
                      <Badge variant="outline" className="text-xs capitalize">{m.role}</Badge>
                      {m.customer_type && (
                        <Badge variant="secondary" className="text-xs">{m.customer_type}</Badge>
                      )}
                      {m.school_type && (
                        <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 text-[10px]">
                          {m.school_type.replace(" Student", "")}
                        </Badge>
                      )}
                      {m.grade && <Badge variant="secondary" className="text-xs">G{m.grade.replace(/^G/i, "")}</Badge>}
                      {m.parent_rank && (
                        <Badge className="text-[10px] bg-amber-100 text-amber-900 hover:bg-amber-100">
                          {m.parent_rank}
                        </Badge>
                      )}
                    </div>
                    {m.external_id && <div className="text-xs font-mono text-muted-foreground mt-1">ext: {m.external_id}</div>}
                    {m.card_uid && (
                      <div className="text-xs font-mono text-muted-foreground mt-0.5 flex items-center gap-1">
                        <CreditCard className="h-3 w-3" /> {m.card_uid}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Notification emails editor */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {t("admin.users.notificationEmails")}
                <span className="text-xs text-muted-foreground">(PowerSchool family-level contacts)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(user.family_profile?.notification_emails || []).length === 0 && (
                  <span className="text-xs text-muted-foreground">{t("admin.users.noNotifEmails")}</span>
                )}
                {(user.family_profile?.notification_emails || []).map((email) => (
                  <Badge key={email} variant="secondary" className="gap-1 pl-2 pr-1 py-1 font-normal">
                    {email}
                    <button
                      className="ml-1 h-4 w-4 rounded hover:bg-background disabled:opacity-50"
                      onClick={() => removeNotifEmail(email)}
                      disabled={savingNotif}
                      aria-label={`Remove ${email}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={notifDraft}
                  onChange={(e) => setNotifDraft(e.target.value)}
                  placeholder="parent@example.com"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addNotifEmail(); }
                  }}
                  className="h-8 text-sm"
                />
                <Button size="sm" onClick={addNotifEmail} disabled={savingNotif || !notifDraft.trim()}>
                  Add
                </Button>
              </div>
              {user.family_profile?.login_ids && user.family_profile.login_ids.length > 0 && (
                <div className="pt-2 border-t text-xs">
                  <span className="text-muted-foreground">Login IDs (PS):</span>{" "}
                  <span className="font-mono">{user.family_profile.login_ids.join(", ")}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked students (explicit parent_child_links) — parents + staff-parents */}
      {(user.role === "parent" || (user.role === "staff" && user.has_children)) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Link2 className="h-5 w-5" /> {t("admin.users.linkedStudents")}
            </CardTitle>
            <Button size="sm" onClick={() => setLinkOpen(true)}>
              <Link2 className="h-4 w-4 mr-1" /> {t("admin.families.addLink")}
            </Button>
          </CardHeader>
          <CardContent>
            {user.family_members.filter((m) => m.entity_type === "customer").length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t("admin.users.noLinkedStudents")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.users.colName")}</TableHead>
                    <TableHead>{t("admin.users.colStudentCode")}</TableHead>
                    <TableHead>{t("admin.users.colGrade")}</TableHead>
                    <TableHead>{t("admin.users.colSchool")}</TableHead>
                    <TableHead>Card UID</TableHead>
                    <TableHead className="text-right">{t("admin.users.colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {user.family_members.filter((m) => m.entity_type === "customer").map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="font-mono text-xs">{m.student_code || m.customer_code}</TableCell>
                      <TableCell>{m.grade || "—"}</TableCell>
                      <TableCell>
                        {m.school_type ? (
                          <Badge variant="outline" className="text-xs">{m.school_type.replace(" Student", "")}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.card_uid || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => unlinkStudent(m.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Identity history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <HistoryIcon className="h-5 w-5" /> {t("admin.users.identityHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {user.identity_history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t("admin.users.noIdentityHistory")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.users.colWhen")}</TableHead>
                  <TableHead>Old</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>{t("admin.users.colReason")}</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.identity_history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs">{new Date(h.changed_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {h.old_external_id || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {h.new_external_id || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{h.reason || "—"}</TableCell>
                    <TableCell className="text-xs">{h.changed_by_name || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Link student dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.users.linkStudentTitle", { name: user.full_name })}</DialogTitle>
            <DialogDescription>
              {t("admin.users.linkStudentDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("admin.users.searchStudent")}</Label>
              <Input
                placeholder={t("admin.users.searchStudentPlaceholder")}
                value={studentQ}
                onChange={(e) => setStudentQ(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.users.student")}</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {studentOptions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} {s.student_code && `(${s.student_code})`} {s.grade && `— ${s.grade}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("admin.users.relation")}</Label>
                <Select value={relation} onValueChange={setRelation}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="father">father</SelectItem>
                    <SelectItem value="mother">mother</SelectItem>
                    <SelectItem value="guardian">guardian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("admin.users.parentRank")}</Label>
                <Select value={parentRank} onValueChange={setParentRank}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">main</SelectItem>
                    <SelectItem value="secondary">secondary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)} disabled={linking}>
              <X className="h-4 w-4 mr-1" /> {t("admin.users.cancel")}
            </Button>
            <Button onClick={linkStudent} disabled={linking || !studentId}>
              {linking ? t("admin.users.saving") : t("admin.families.createLink")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RFID Card bind dialog */}
      <Dialog open={cardOpen} onOpenChange={setCardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> {t("admin.users.bindCard")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.users.bindCardDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("admin.users.cardUidHex")}</Label>
              <Input
                value={cardInput}
                onChange={(e) => setCardInput(e.target.value.toUpperCase())}
                placeholder="D7F8F836"
                className="font-mono"
                maxLength={20}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.users.clearToUnbind")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCardOpen(false)} disabled={savingCard}>
              <X className="h-4 w-4 mr-1" /> {t("admin.users.cancel")}
            </Button>
            <Button onClick={saveCardUid} disabled={savingCard}>
              {savingCard ? t("admin.users.saving") : t("admin.users.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
