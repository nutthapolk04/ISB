import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { formatCurrency as formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { toast } from "@/hooks/use-toast";
import { fmtDateTime as fmtDateTimeShared } from "@/lib/dateFormat";
import { resolveAvatarUrl } from "@/lib/avatarFallback";
import { useRfidListener } from "@/hooks/useRfidListener";
import {
  ArrowLeft, Camera, CreditCard, GraduationCap, Lock, Unlock, Upload, User as UserIcon,
  AlertTriangle, Edit3, Save, X, ShieldAlert, Plus, Trash2, Loader2,
} from "lucide-react";

interface StudentProfile {
  id: number;
  customer_code: string;
  student_code?: string | null;
  customer_kind?: string | null;
  name: string;
  grade?: string | null;
  school_type?: string | null;
  enroll_date?: string | null;
  withdraw_date?: string | null;
  photo_url?: string | null;
  email?: string | null;
  phone?: string | null;
  allergies?: string | null;
  dietary_notes?: string | null;
  allergy_override_note?: string | null;
  card_uid?: string | null;
  card_frozen: boolean;
  is_active?: boolean;
  daily_limit?: number | null;
  negative_credit_limit?: number | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
}

interface Transaction {
  id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description?: string | null;
  shop_name?: string | null;
  created_at: string;
}

interface FamilyLink {
  id: number;
  parent_user_id: number;
  parent_username?: string | null;
  parent_full_name?: string | null;
  child_customer_id: number;
  child_name?: string | null;
  child_student_code?: string | null;
  child_is_active?: boolean | null;
  relation: string;
}

interface ParentUser {
  id: number;
  username: string;
  full_name?: string | null;
}

const formatDate = (iso: string, _lang: string) => fmtDateTimeShared(iso);

export default function CustomerDetail() {
  const { t, i18n } = useTranslation();
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allLinks, setAllLinks] = useState<FamilyLink[]>([]);
  const [loading, setLoading] = useState(true);

  // Basic info editor
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicDraft, setBasicDraft] = useState({ name: "", grade: "", school_type: "", email: "", phone: "", is_active: true });
  const [savingBasic, setSavingBasic] = useState(false);

  // Allergy editor
  const [editingAllergy, setEditingAllergy] = useState(false);
  const [allergyDraft, setAllergyDraft] = useState({ allergies: "", dietary_notes: "", allergy_override_note: "" });
  const [savingAllergy, setSavingAllergy] = useState(false);

  // Card binding dialog
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [cardUidDraft, setCardUidDraft] = useState("");
  const [bindingCard, setBindingCard] = useState(false);

  // Daily limit editor
  const [dailyLimitDraft, setDailyLimitDraft] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState(false);

  // Negative credit limit editor
  const [negLimitDraft, setNegLimitDraft] = useState<string>("");
  const [savingNegLimit, setSavingNegLimit] = useState(false);

  // Photo upload
  const [uploading, setUploading] = useState(false);

  // Graduation dialog
  const [gradDialogOpen, setGradDialogOpen] = useState(false);
  const [gradTargetId, setGradTargetId] = useState<string>("");
  const [graduating, setGraduating] = useState(false);

  // Freeze toggle
  const [togglingFreeze, setTogglingFreeze] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  // Link parent dialog
  const [linkParentOpen, setLinkParentOpen] = useState(false);
  const [parentUsers, setParentUsers] = useState<ParentUser[]>([]);
  const [parentSearch, setParentSearch] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<string>("");
  const [linkRelation, setLinkRelation] = useState("parent");
  const [linkingParent, setLinkingParent] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);

  const loadAll = async () => {
    if (!customerId) return;
    try {
      const p = await api.get<StudentProfile>(`/customers/${customerId}`);
      setProfile(p);
      setBasicDraft({
        name: p.name ?? "",
        grade: p.grade ?? "",
        school_type: p.school_type ?? "",
        email: p.email ?? "",
        phone: p.phone ?? "",
        is_active: p.is_active !== false,
      });
      setAllergyDraft({
        allergies: p.allergies ?? "",
        dietary_notes: p.dietary_notes ?? "",
        allergy_override_note: p.allergy_override_note ?? "",
      });
      setDailyLimitDraft(p.daily_limit != null ? String(p.daily_limit) : "");
      setNegLimitDraft(p.negative_credit_limit != null ? String(p.negative_credit_limit) : "");
      setCardUidDraft(p.card_uid ?? "");
      if (p.wallet_id) {
        const txs = await api.get<Transaction[]>(`/wallets/${p.wallet_id}/transactions`);
        setTransactions(txs.slice(0, 10));
      }
      const links = await api.get<FamilyLink[]>("/family/links");
      setAllLinks(links);
    } catch (e) {
      toast({
        title: t("admin.customer.loadError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [customerId]);

  // Parent user_ids linked to this customer
  const parentIdsForThisChild = useMemo(() => {
    if (!profile) return new Set<number>();
    return new Set(
      allLinks.filter((l) => l.child_customer_id === profile.id).map((l) => l.parent_user_id),
    );
  }, [allLinks, profile]);

  // Siblings = other children linked to the same parent(s)
  const siblings = useMemo(() => {
    if (!profile) return [] as { id: number; name: string; student_code?: string | null }[];
    const sibMap = new Map<number, { id: number; name: string; student_code?: string | null }>();
    for (const l of allLinks) {
      if (
        parentIdsForThisChild.has(l.parent_user_id) &&
        l.child_customer_id !== profile.id &&
        l.child_is_active !== false
      ) {
        sibMap.set(l.child_customer_id, {
          id: l.child_customer_id,
          name: l.child_name || `#${l.child_customer_id}`,
          student_code: l.child_student_code,
        });
      }
    }
    return Array.from(sibMap.values());
  }, [allLinks, parentIdsForThisChild, profile]);

  const parents = useMemo(() => {
    if (!profile) return [] as FamilyLink[];
    return allLinks.filter((l) => l.child_customer_id === profile.id);
  }, [allLinks, profile]);

  const handleSaveBasic = async () => {
    if (!profile) return;
    setSavingBasic(true);
    try {
      const { is_active, ...textFields } = basicDraft;
      const payload: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(textFields)) {
        payload[k] = v.trim() === "" ? null : v.trim();
      }
      await api.patch(`/customers/${profile.id}`, payload);
      if (is_active !== (profile.is_active !== false)) {
        await api.patch(`/customers/${profile.id}/active`, { active: is_active });
      }
      toast({ title: t("admin.customer.basicSaved") });
      setEditingBasic(false);
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.basicSaveError"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setSavingBasic(false);
    }
  };

  const handleSaveAllergy = async () => {
    if (!profile) return;
    setSavingAllergy(true);
    try {
      await api.patch(`/customers/${profile.id}/allergies`, allergyDraft);
      toast({ title: t("admin.customer.allergySaved") });
      setEditingAllergy(false);
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.allergySaveError"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setSavingAllergy(false);
    }
  };

  const handleBindCard = async () => {
    if (!profile) return;
    setBindingCard(true);
    try {
      await api.patch(`/customers/${profile.id}/card`, { card_uid: cardUidDraft.trim() || null });
      toast({ title: cardUidDraft ? t("admin.customer.cardBound") : t("admin.customer.cardUnboundToast") });
      setCardDialogOpen(false);
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.actionFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setBindingCard(false);
    }
  };

  // Tapping a real card while the bind dialog is open fills the field
  // directly from the reader (PC/SC bridge or keyboard-wedge fallback).
  useRfidListener({
    onCapture: (uid) => {
      if (!cardDialogOpen) return;
      setCardUidDraft(uid.toUpperCase());
    },
  });

  const handleSaveDailyLimit = async () => {
    if (!profile) return;
    setSavingLimit(true);
    try {
      const v = dailyLimitDraft.trim() === "" ? null : parseFloat(dailyLimitDraft);
      await api.patch(`/customers/${profile.id}/limit`, { daily_limit: v });
      toast({ title: t("admin.customer.dailyLimitSaved") });
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.allergySaveError"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setSavingLimit(false);
    }
  };

  const handleSaveNegLimit = async () => {
    if (!profile) return;
    setSavingNegLimit(true);
    try {
      const v = negLimitDraft.trim() === "" ? null : parseFloat(negLimitDraft);
      await api.patch(`/customers/${profile.id}/negative-limit`, { negative_credit_limit: v });
      toast({ title: t("admin.customer.negLimitSaved") });
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.allergySaveError"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setSavingNegLimit(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.postFormData(`/customers/${profile.id}/photo`, form);
      toast({ title: t("admin.customer.photoUploaded") });
      loadAll();
    } catch (err) {
      toast({ title: t("admin.customer.photoUploadFailed"), description: err instanceof ApiError ? err.detail : "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openLinkParentDialog = async () => {
    setLinkParentOpen(true);
    setSelectedParentId("");
    setParentSearch("");
    setLinkRelation("parent");
    if (parentUsers.length === 0) {
      try {
        const users = await api.get<ParentUser[]>("/users-admin/?role=parent&limit=500");
        setParentUsers(users);
      } catch {
        // non-critical — user can still type to search
      }
    }
  };

  const handleLinkParent = async () => {
    if (!profile || !selectedParentId) return;
    setLinkingParent(true);
    try {
      await api.post("/family/links", {
        parent_user_id: parseInt(selectedParentId),
        child_customer_id: profile.id,
        relation: linkRelation,
      });
      toast({ title: t("admin.customer.parentLinked", "Parent linked successfully") });
      setLinkParentOpen(false);
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.actionFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setLinkingParent(false);
    }
  };

  const handleUnlinkParent = async (linkId: number) => {
    if (!window.confirm(t("admin.customer.unlinkConfirm", "Remove this parent link?"))) return;
    setUnlinkingId(linkId);
    try {
      await api.delete(`/family/links/${linkId}`);
      toast({ title: t("admin.customer.parentUnlinked", "Parent unlinked") });
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.actionFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setUnlinkingId(null);
    }
  };

  const handleToggleFreeze = async () => {
    if (!profile) return;
    setTogglingFreeze(true);
    try {
      await api.post(`/customers/${profile.id}/freeze`, { frozen: !profile.card_frozen });
      toast({ title: profile.card_frozen ? t("admin.customer.cardUnfrozen") : t("admin.customer.cardFrozen") });
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.actionFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setTogglingFreeze(false);
    }
  };

  const handleToggleActive = async () => {
    if (!profile) return;
    setTogglingActive(true);
    try {
      await api.patch(`/customers/${profile.id}/active`, { active: !profile.is_active });
      toast({ title: profile.is_active ? t("admin.customer.setInactive", "Set to Inactive") : t("admin.customer.setActive", "Set to Active") });
      loadAll();
    } catch (e) {
      toast({ title: t("admin.customer.actionFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setTogglingActive(false);
    }
  };

  const handleGraduate = async () => {
    if (!profile) return;
    if (!window.confirm(t("admin.customer.gradConfirmOne", { name: profile.name }))) return;
    setGraduating(true);
    try {
      const resp = await api.post<{
        message: string; transferred_amount: number; transferred_to_customer_id?: number | null;
      }>(`/customers/${profile.id}/graduate`, {
        transfer_to_customer_id: gradTargetId ? parseInt(gradTargetId) : null,
      });
      toast({
        title: t("admin.customer.gradDone"),
        description: resp.message,
      });
      setGradDialogOpen(false);
      navigate(-1);
    } catch (e) {
      toast({ title: t("admin.customer.actionFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setGraduating(false);
    }
  };

  if (loading) {
    return <div className="page-shell text-muted-foreground">{t("admin.customer.loading")}</div>;
  }
  if (!profile) {
    return <div className="page-shell text-destructive">{t("admin.customer.notFound")}</div>;
  }

  const initials = profile.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const isStudent = profile.customer_kind === "student";

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link to="#" onClick={(e) => { e.preventDefault(); navigate(-1); }}><ArrowLeft className="h-4 w-4 mr-1" /> {t("admin.customer.back")}</Link>
      </Button>

      {/* Header card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src={resolveAvatarUrl(profile.photo_url, profile.name || String(profile.id))} alt={profile.name} />
                <AvatarFallback className="text-xl">{initials}</AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 rounded-full bg-primary text-primary-foreground p-1.5 shadow"
                title={t("admin.customer.uploadPhoto")}
              >
                {uploading ? <Upload className="h-3.5 w-3.5 animate-pulse" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <h1 className="text-2xl font-bold">{profile.name}</h1>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {profile.student_code && <Badge variant="secondary">{profile.student_code}</Badge>}
                  <Badge variant="outline">{profile.customer_code}</Badge>
                  {profile.grade && <Badge variant="outline"><GraduationCap className="h-3 w-3 mr-0.5" />{profile.grade}</Badge>}
                  {profile.school_type && <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">{profile.school_type}</Badge>}
                  <Badge className={`border-0 ${profile.is_active === false ? "bg-red-100 text-red-600 hover:bg-red-100" : "bg-green-100 text-green-700 hover:bg-green-100"}`}>
                    {profile.is_active === false ? "Inactive" : "Active"}
                  </Badge>
                  {profile.card_frozen && (
                    <Badge variant="destructive"><Lock className="h-3 w-3 mr-0.5" />{t("admin.customer.frozenBadge")}</Badge>
                  )}
                </div>
              </div>

              <div className="rounded-md bg-primary/5 p-4">
                <p className="text-xs text-muted-foreground">{t("admin.customer.balance")}</p>
                <p className={`text-3xl font-bold font-mono ${(profile.wallet_balance ?? 0) < 0 ? "text-destructive" : "text-primary"}`}>
                  {formatTHB(profile.wallet_balance ?? 0)}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 w-full sm:w-auto">
              <Button
                variant={profile.card_frozen ? "outline" : "destructive"}
                size="sm"
                onClick={handleToggleFreeze}
                disabled={togglingFreeze}
              >
                {profile.card_frozen ? <Unlock className="h-4 w-4 mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
                {profile.card_frozen ? t("admin.customer.unfreezeCard") : t("admin.customer.freezeCard")}
              </Button>
{isStudent && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGradDialogOpen(true)}
              >
                <GraduationCap className="h-4 w-4 mr-1" /> {t("admin.customer.markGraduated")}
              </Button>
            )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Basic Information */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserIcon className="h-4 w-4" /> {t("admin.customer.basicInfoTitle")}
            </CardTitle>
            {!editingBasic ? (
              <Button variant="ghost" size="sm" onClick={() => setEditingBasic(true)}>
                <Edit3 className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex gap-1">
                <IconButton
                  tooltip={t("admin.customer.tooltip.cancelEdit")}
                  onClick={() => {
                    setEditingBasic(false);
                    setBasicDraft({
                      name: profile.name ?? "",
                      grade: profile.grade ?? "",
                      school_type: profile.school_type ?? "",
                      email: profile.email ?? "",
                      phone: profile.phone ?? "",
                      is_active: profile.is_active !== false,
                    });
                  }}
                >
                  <X className="h-4 w-4" />
                </IconButton>
                <IconButton
                  tooltip={t("admin.customer.tooltip.saveEdit")}
                  onClick={handleSaveBasic}
                  disabled={savingBasic}
                >
                  <Save className="h-4 w-4" />
                </IconButton>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {editingBasic ? (
              <>
                <div>
                  <Label className="text-xs">{t("admin.customer.basicName")}</Label>
                  <Input value={basicDraft.name} onChange={(e) => setBasicDraft({ ...basicDraft, name: e.target.value })} />
                </div>
                {isStudent && (
                  <div>
                    <Label className="text-xs">{t("admin.customer.basicGrade")}</Label>
                    <Input value={basicDraft.grade} onChange={(e) => setBasicDraft({ ...basicDraft, grade: e.target.value })} placeholder={t("admin.customer.basicGradePlaceholder")} />
                  </div>
                )}
                {isStudent && (
                  <div>
                    <Label className="text-xs">{t("admin.customer.basicSchoolType")}</Label>
                    <Select value={basicDraft.school_type} onValueChange={(v) => setBasicDraft({ ...basicDraft, school_type: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("admin.customer.basicSchoolTypePlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ES Student">ES Student</SelectItem>
                        <SelectItem value="MS Student">MS Student</SelectItem>
                        <SelectItem value="HS Student">HS Student</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs">{t("admin.customer.basicEmail")}</Label>
                  <Input type="email" value={basicDraft.email} onChange={(e) => setBasicDraft({ ...basicDraft, email: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t("admin.customer.basicPhone")}</Label>
                  <Input value={basicDraft.phone} onChange={(e) => setBasicDraft({ ...basicDraft, phone: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={basicDraft.is_active ? "active" : "inactive"} onValueChange={(v) => setBasicDraft({ ...basicDraft, is_active: v === "active" })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active" className="text-green-700">Active</SelectItem>
                      <SelectItem value="inactive" className="text-red-600">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.customer.basicName")}</p>
                  <p className="text-sm font-medium">{profile.name}</p>
                </div>
                {isStudent && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("admin.customer.basicGrade")}</p>
                    <p className="text-sm">{profile.grade || <span className="text-muted-foreground italic">{t("admin.customer.noData")}</span>}</p>
                  </div>
                )}
                {isStudent && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("admin.customer.basicSchoolType")}</p>
                    <p className="text-sm">{profile.school_type || <span className="text-muted-foreground italic">{t("admin.customer.noData")}</span>}</p>
                  </div>
                )}
                {isStudent && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("admin.customer.enrollDate", "Enroll date")}</p>
                    <p className="text-sm">{profile.enroll_date ? formatDate(profile.enroll_date, i18n.language) : <span className="text-muted-foreground italic">{t("admin.customer.noData")}</span>}</p>
                  </div>
                )}
                {isStudent && profile.withdraw_date && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("admin.customer.withdrawDate", "Withdraw date")}</p>
                    <p className="text-sm text-destructive font-medium">{formatDate(profile.withdraw_date, i18n.language)}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.customer.basicEmail")}</p>
                  <p className="text-sm">{profile.email || <span className="text-muted-foreground italic">{t("admin.customer.noData")}</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.customer.basicPhone")}</p>
                  <p className="text-sm">{profile.phone || <span className="text-muted-foreground italic">{t("admin.customer.noData")}</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge className={`border-0 mt-0.5 ${profile.is_active === false ? "bg-red-100 text-red-600 hover:bg-red-100" : "bg-green-100 text-green-700 hover:bg-green-100"}`}>
                    {profile.is_active === false ? "Inactive" : "Active"}
                  </Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Allergy info */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> {t("admin.customer.allergyTitle")}
            </CardTitle>
            {!editingAllergy ? (
              <Button variant="ghost" size="sm" onClick={() => setEditingAllergy(true)}>
                <Edit3 className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex gap-1">
                <IconButton
                  tooltip={t("admin.customer.tooltip.cancelEdit")}
                  onClick={() => { setEditingAllergy(false); setAllergyDraft({ allergies: profile.allergies ?? "", dietary_notes: profile.dietary_notes ?? "", allergy_override_note: profile.allergy_override_note ?? "" }); }}
                >
                  <X className="h-4 w-4" />
                </IconButton>
                <IconButton
                  tooltip={t("admin.customer.tooltip.saveEdit")}
                  onClick={handleSaveAllergy}
                  disabled={savingAllergy}
                >
                  <Save className="h-4 w-4" />
                </IconButton>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {editingAllergy ? (
              <>
                <div>
                  <Label className="text-xs">{t("admin.customer.allergiesLabel")}</Label>
                  <Textarea rows={2} value={allergyDraft.allergies} onChange={(e) => setAllergyDraft({ ...allergyDraft, allergies: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t("admin.customer.dietaryNotes")}</Label>
                  <Textarea rows={2} value={allergyDraft.dietary_notes} onChange={(e) => setAllergyDraft({ ...allergyDraft, dietary_notes: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs text-destructive font-semibold flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {t("admin.customer.overrideNote")}
                  </Label>
                  <InfoCallout
                    id="customer.allergyOverride"
                    variant="warn"
                    title={t("admin.customer.info.allergyOverride.title")}
                    className="my-2"
                  >
                    {t("admin.customer.info.allergyOverride.body")}
                  </InfoCallout>
                  <Textarea rows={2} value={allergyDraft.allergy_override_note} onChange={(e) => setAllergyDraft({ ...allergyDraft, allergy_override_note: e.target.value })} placeholder={t("admin.customer.overridePlaceholder")} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.customer.allergiesHeading")}</p>
                  <p className="text-sm">{profile.allergies || <span className="text-muted-foreground italic">{t("admin.customer.noData")}</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.customer.dietaryNotes")}</p>
                  <p className="text-sm">{profile.dietary_notes || <span className="text-muted-foreground italic">{t("admin.customer.noData")}</span>}</p>
                </div>
                {profile.allergy_override_note && (
                  <div className="rounded-md border-2 border-destructive bg-destructive/10 p-2">
                    <p className="text-xs text-destructive font-bold flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {t("admin.customer.overrideBadge")}
                    </p>
                    <p className="text-sm text-destructive">{profile.allergy_override_note}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Card & limits */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> {t("admin.customer.cardLimitsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{t("admin.customer.cardUid")}</p>
                <p className="font-mono text-sm">{profile.card_uid || <span className="text-muted-foreground italic">{t("admin.customer.cardNotBound")}</span>}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setCardDialogOpen(true)}>
                <CreditCard className="h-4 w-4 mr-1" /> {profile.card_uid ? t("admin.customer.changeCard") : t("admin.customer.bindCardBtn")}
              </Button>
            </div>

            <Separator />

            <InfoCallout
              id="customer.limits"
              variant="info"
              title={t("admin.customer.info.limits.title")}
            >
              {t("admin.customer.info.limits.body")}
            </InfoCallout>

            <div>
              <Label className="text-xs">{t("admin.customer.dailyLimit")}</Label>
              <div className="flex gap-2 mt-1">
                <Input type="number" min="0" step="0.01" value={dailyLimitDraft} onChange={(e) => setDailyLimitDraft(e.target.value)} placeholder={t("admin.customer.dailyLimitPlaceholder")} />
                <Button size="sm" onClick={handleSaveDailyLimit} disabled={savingLimit}>{t("admin.customer.save")}</Button>
              </div>
            </div>

            <div>
              <Label className="text-xs">{t("admin.customer.negativeLimit")}</Label>
              <div className="flex gap-2 mt-1">
                <Input type="number" min="0" step="0.01" value={negLimitDraft} onChange={(e) => setNegLimitDraft(e.target.value)} placeholder={t("admin.customer.negativeLimitPlaceholder")} />
                <Button size="sm" onClick={handleSaveNegLimit} disabled={savingNegLimit}>{t("admin.customer.save")}</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Family links — students only */}
        {isStudent && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4" /> {t("admin.customer.familyTitle")}
                </span>
                <Button variant="outline" size="sm" onClick={openLinkParentDialog} className="h-7 px-2 text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t("admin.customer.linkParent", "Link Parent")}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {parents.length === 0 && <p className="text-sm text-muted-foreground italic">{t("admin.customer.noParents")}</p>}
              {parents.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <div>
                    <p className="font-medium">{l.parent_full_name || l.parent_username}</p>
                    <p className="text-xs text-muted-foreground">@{l.parent_username} · {l.relation}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleUnlinkParent(l.id)}
                    disabled={unlinkingId === l.id}
                    title={t("admin.customer.unlinkParent", "Unlink parent")}
                  >
                    {unlinkingId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
              {siblings.length > 0 && (
                <>
                  <Separator className="my-2" />
                  <p className="text-xs text-muted-foreground">{t("admin.customer.siblingsCount", { count: siblings.length })}</p>
                  {siblings.map((s) => (
                    <Link key={s.id} to={`/admin/customer/${s.id}`} className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-muted/50">
                      <div>
                        <p className="font-medium">{s.name}</p>
                        {s.student_code && <p className="text-xs text-muted-foreground">{s.student_code}</p>}
                      </div>
                    </Link>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Recent transactions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("admin.customer.recentTransactions")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">{t("admin.customer.noTransactions")}</p>
            ) : (
              transactions.map((tx) => {
                const isCredit = ["TOPUP", "REFUND"].includes(tx.transaction_type) || (tx.transaction_type === "ADJUSTMENT" && tx.balance_after > tx.balance_before);
                return (
                  <div key={tx.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{tx.description || tx.transaction_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(tx.created_at, i18n.language)}
                        {tx.shop_name && <> · {tx.shop_name}</>}
                      </p>
                    </div>
                    <p className={`font-mono text-sm font-semibold shrink-0 ml-2 ${isCredit ? "text-green-600" : "text-destructive"}`}>
                      {isCredit ? "+" : "-"}{formatTHB(Math.abs(tx.amount))}
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Card bind dialog */}
      <Dialog open={cardDialogOpen} onOpenChange={setCardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.customer.bindDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.customer.bindDialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("admin.customer.cardUid")}</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={cardUidDraft}
                  onChange={(e) => setCardUidDraft(e.target.value.toUpperCase())}
                  placeholder={t("admin.customer.bindPlaceholder")}
                  className="font-mono"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("admin.customer.cardUidTapHint", "หรือแตะบัตรที่เครื่องอ่านเพื่อเติมอัตโนมัติ")}
              </p>
            </div>
            {profile.card_uid && (
              <div className="rounded-md bg-muted p-2 text-xs">
                <span className="text-muted-foreground">{t("admin.customer.currentUid")}</span>
                <span className="font-mono">{profile.card_uid}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            {profile.card_uid && (
              <Button variant="outline" onClick={() => { setCardUidDraft(""); handleBindCard(); }} disabled={bindingCard}>
                {t("admin.customer.unbindButton")}
              </Button>
            )}
            <Button onClick={handleBindCard} disabled={bindingCard}>
              {bindingCard ? t("admin.customer.saving") : t("admin.customer.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link parent dialog */}
      <Dialog open={linkParentOpen} onOpenChange={setLinkParentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.customer.linkParentTitle", "Link Parent")}</DialogTitle>
            <DialogDescription>
              {t("admin.customer.linkParentDesc", "Search for a parent account and link them to this student.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("admin.customer.parentSearch", "Parent account")}</Label>
              <Input
                className="mt-1"
                placeholder={t("admin.customer.parentSearchPlaceholder", "Search by name or username…")}
                value={parentSearch}
                onChange={(e) => { setParentSearch(e.target.value); setSelectedParentId(""); }}
              />
              {parentSearch.trim().length >= 1 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-sm">
                  {parentUsers
                    .filter((u) => {
                      const q = parentSearch.toLowerCase();
                      return u.username.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q);
                    })
                    .slice(0, 20)
                    .map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${selectedParentId === String(u.id) ? "bg-primary/10 font-medium" : ""}`}
                        onClick={() => { setSelectedParentId(String(u.id)); setParentSearch(u.full_name || u.username); }}
                      >
                        <span className="font-medium">{u.full_name || u.username}</span>
                        <span className="text-xs text-muted-foreground ml-1">@{u.username}</span>
                      </button>
                    ))}
                  {parentUsers.filter((u) => {
                    const q = parentSearch.toLowerCase();
                    return u.username.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q);
                  }).length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">{t("admin.customer.parentNotFound", "No matching parent accounts")}</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>{t("admin.customer.relation", "Relation")}</Label>
              <Select value={linkRelation} onValueChange={setLinkRelation}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">{t("relation.parent", "Parent")}</SelectItem>
                  <SelectItem value="guardian">{t("relation.guardian", "Guardian")}</SelectItem>
                  <SelectItem value="grandparent">{t("relation.grandparent", "Grandparent")}</SelectItem>
                  <SelectItem value="other">{t("relation.other", "Other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkParentOpen(false)} disabled={linkingParent}>
              {t("admin.customer.cancel")}
            </Button>
            <Button onClick={handleLinkParent} disabled={!selectedParentId || linkingParent}>
              {linkingParent ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t("admin.customer.linkParentConfirm", "Link")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Graduation dialog */}
      <Dialog open={gradDialogOpen} onOpenChange={setGradDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.customer.gradDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.customer.gradDialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("admin.customer.gradBalanceToTransfer")}</span>
                <span className="font-mono font-semibold">{formatTHB(profile.wallet_balance ?? 0)}</span>
              </div>
            </div>
            {siblings.length > 0 ? (
              <div>
                <Label>{t("admin.customer.gradTransferTo")}</Label>
                <Select value={gradTargetId} onValueChange={setGradTargetId}>
                  <SelectTrigger><SelectValue placeholder={siblings.length === 1 ? `${siblings[0].name} (auto)` : t("admin.customer.gradSelectDest")} /></SelectTrigger>
                  <SelectContent>
                    {siblings.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} {s.student_code ? `(${s.student_code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {siblings.length === 1 && (
                  <p className="text-xs text-muted-foreground mt-1">{t("admin.customer.gradSingleSiblingHint")}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{t("admin.customer.gradNoSiblings")}</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGradDialogOpen(false)} disabled={graduating}>
              {t("admin.customer.cancel")}
            </Button>
            <Button onClick={handleGraduate} disabled={graduating}>
              {graduating ? t("admin.customer.gradRunning") : t("admin.customer.gradConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
