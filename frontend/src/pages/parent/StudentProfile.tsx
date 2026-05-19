import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, AlertCircle, IdCard, Lock, Save, Unlock } from "lucide-react";

interface StudentProfile {
  id: number;
  customer_code: string;
  student_code?: string | null;
  name: string;
  grade?: string | null;
  photo_url?: string | null;
  email?: string | null;
  phone?: string | null;
  allergies?: string | null;
  dietary_notes?: string | null;
  card_uid?: string | null;
  card_frozen: boolean;
  daily_limit?: number | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function StudentProfile() {
  const { customerId } = useParams<{ customerId: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const isStudent = user?.role === "student";
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingLimit, setSavingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState<string>("");

  const load = async () => {
    if (!customerId) return;
    try {
      const p = await api.get<StudentProfile>(`/customers/${customerId}`);
      setProfile(p);
      setLimitInput(p.daily_limit !== null && p.daily_limit !== undefined ? String(p.daily_limit) : "");
    } catch (e) {
      toast({
        title: t("parent.studentProfile.loadFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [customerId]);

  const toggleFreeze = async (frozen: boolean) => {
    if (!profile) return;
    try {
      const updated = await api.post<StudentProfile>(
        `/customers/${profile.id}/freeze`,
        { frozen },
      );
      setProfile(updated);
      toast({
        title: frozen ? t("parent.studentProfile.freezeSuccess") : t("parent.studentProfile.unfreezeSuccess"),
      });
    } catch (e) {
      toast({
        title: t("parent.studentProfile.actionFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const saveDailyLimit = async () => {
    if (!profile) return;
    const val = limitInput.trim();
    const daily_limit = val === "" ? null : parseFloat(val);
    if (daily_limit !== null && (isNaN(daily_limit) || daily_limit < 0)) {
      toast({ title: t("parent.studentProfile.invalidLimit"), variant: "destructive" });
      return;
    }
    setSavingLimit(true);
    try {
      const updated = await api.patch<StudentProfile>(
        `/customers/${profile.id}/limit`,
        { daily_limit },
      );
      setProfile(updated);
      toast({ title: t("parent.studentProfile.limitSaved") });
    } catch (e) {
      toast({
        title: t("parent.studentProfile.actionFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingLimit(false);
    }
  };

  if (loading) return <div className="page-shell text-muted-foreground">{t("parent.common.loading")}</div>;
  if (!profile) return <div className="page-shell text-destructive">{t("parent.common.notFound")}</div>;

  return (
    <div className="page-shell">
      <div className="max-w-3xl space-y-4 sm:space-y-6">
      <div className="page-header flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-10">
          <Link to="/parent/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-xl sm:text-2xl break-words">{profile.name}</CardTitle>
              <div className="flex flex-wrap gap-2 mt-2">
                {profile.student_code && <Badge variant="secondary">{profile.student_code}</Badge>}
                {profile.grade && <Badge variant="outline">{profile.grade}</Badge>}
                {profile.card_frozen && (
                  <Badge variant="destructive">{t("parent.studentProfile.cardFrozen")}</Badge>
                )}
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-xs text-muted-foreground">{t("parent.studentProfile.balance")}</p>
              <p className="text-xl font-bold text-primary tabular-nums">
                {formatTHB(profile.wallet_balance ?? 0)}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">{t("parent.studentProfile.customerCode")}</p>
            <p>{profile.customer_code}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("parent.studentProfile.email")}</p>
            <p>{profile.email || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("parent.studentProfile.phone")}</p>
            <p>{profile.phone || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs flex items-center gap-1">
              <IdCard className="h-3 w-3" /> {t("parent.studentProfile.nfcCard")}
            </p>
            <p className="font-mono">{profile.card_uid || "-"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Allergies */}
      <Card className={profile.allergies ? "border-destructive" : ""}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            {t("parent.studentProfile.allergyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("parent.studentProfile.allergiesLabel")}</p>
            <div className="rounded-md border bg-muted/40 p-3">
              {profile.allergies || <span className="text-muted-foreground">{t("parent.studentProfile.noData")}</span>}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("parent.studentProfile.dietaryLabel")}</p>
            <div className="rounded-md border bg-muted/40 p-3">
              {profile.dietary_notes || <span className="text-muted-foreground">{t("parent.studentProfile.noData")}</span>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("parent.studentProfile.allergyNote")}
          </p>
        </CardContent>
      </Card>

      {/* Card Controls — hidden for students (read-only view of own profile) */}
      {!isStudent && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("parent.studentProfile.cardControlTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-medium flex items-center gap-2">
                {profile.card_frozen ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                {t("parent.studentProfile.freezeLabel")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("parent.studentProfile.freezeHint")}
              </p>
            </div>
            <Switch
              checked={profile.card_frozen}
              onCheckedChange={toggleFreeze}
            />
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <div>
              <Label htmlFor="dailyLimit">{t("parent.studentProfile.dailyLimitLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("parent.studentProfile.dailyLimitHint")}</p>
            </div>
            <div className="flex gap-2">
              <Input
                id="dailyLimit"
                type="number"
                min="0"
                step="10"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                placeholder="150"
              />
              <Button onClick={saveDailyLimit} disabled={savingLimit}>
                <Save className="h-4 w-4 mr-1" />
                {savingLimit ? t("parent.studentProfile.saving") : t("parent.studentProfile.save")}
              </Button>
            </div>
            {profile.daily_limit !== null && profile.daily_limit !== undefined && (
              <p className="text-xs text-muted-foreground">
                {t("parent.studentProfile.currentLimit", { amount: formatTHB(profile.daily_limit) })}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      )}
      </div>
    </div>
  );
}
