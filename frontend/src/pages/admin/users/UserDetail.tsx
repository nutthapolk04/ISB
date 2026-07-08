import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { AdminChangePasswordDialog } from "@/components/AdminChangePasswordDialog";
import type { UserDetailData } from "./userDetailTypes";
import { UserProfileHero } from "./UserProfileHero";
import { BasicProfileCard } from "./BasicProfileCard";
import { HealthProfileCard } from "./HealthProfileCard";
import { UserRoleManager } from "./UserRoleManager";
import { FamilyGroupCard } from "./FamilyGroupCard";
import { LinkedStudentsTable } from "./LinkedStudentsTable";
import { IdentityHistoryTable } from "./IdentityHistoryTable";
import { CardBindingDialog } from "./CardBindingDialog";
import { LinkStudentDialog } from "./LinkStudentDialog";

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

  const [cardOpen, setCardOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

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

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> {t("admin.users.back")}
        </Button>

        <UserProfileHero
          user={user}
          onBindCard={() => setCardOpen(true)}
          onChangePassword={() => setChangePwOpen(true)}
        />

        <div className="grid gap-6 md:grid-cols-2">
          <BasicProfileCard
            user={user}
            form={form}
            onFormChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            editing={editingBasic}
            onStartEdit={() => setEditingBasic(true)}
            onCancelEdit={() => { setEditingBasic(false); load(); setExtIdReason(""); }}
            saving={saving}
            onSave={save}
            extIdReason={extIdReason}
            onExtIdReasonChange={setExtIdReason}
          />

          <HealthProfileCard
            allergies={user.allergies}
            formAllergies={form.allergies || ""}
            onFormAllergiesChange={(v) => setForm((prev) => ({ ...prev, allergies: v }))}
            editing={editingHealth}
            onStartEdit={() => setEditingHealth(true)}
            onCancelEdit={() => { setEditingHealth(false); setForm((prev) => ({ ...prev, allergies: user.allergies ?? "" })); }}
            saving={savingHealth}
            onSave={saveHealth}
          />
        </div>

        <UserRoleManager userId={userId!} primaryRole={user.role} />

        {user.family_code && (
          <FamilyGroupCard
            familyCode={user.family_code}
            members={user.family_members}
            familyProfile={user.family_profile}
            onProfileUpdated={(profile) => setUser({ ...user, family_profile: profile })}
          />
        )}

        {(user.role === "parent" || (user.role === "staff" && user.has_children)) && (
          <LinkedStudentsTable
            members={user.family_members}
            onAddLink={() => setLinkOpen(true)}
            onUnlink={unlinkStudent}
          />
        )}

        <IdentityHistoryTable history={user.identity_history} />

        <LinkStudentDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          userId={user.id}
          userFullName={user.full_name}
          onLinked={load}
        />

        <CardBindingDialog
          open={cardOpen}
          onOpenChange={setCardOpen}
          userId={user.id}
          initialCardUid={user.card_uid}
          onSaved={setUser}
        />

        <AdminChangePasswordDialog
          open={changePwOpen}
          onOpenChange={setChangePwOpen}
          userId={user.id}
          userName={user.full_name}
        />
      </div>
    </div>
  );
}
