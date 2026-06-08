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
    <div className="page-shell min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50">
      <div className="space-y-4 sm:space-y-6">

        {/* Back button */}
        <div className="page-header flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-10 text-orange-700 hover:text-orange-900 hover:bg-orange-100">
            <Link to="/parent/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}</Link>
          </Button>
        </div>

        {/* Profile Hero Card */}
        <div className="rounded-2xl overflow-hidden shadow-lg">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-400 px-6 pt-6 pb-10 relative">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-white break-words drop-shadow">{profile.name}</h1>
                <div className="flex flex-wrap gap-2 mt-3">
                  {profile.student_code && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/25 text-white border border-white/40">
                      {profile.student_code}
                    </span>
                  )}
                  {profile.grade && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white border border-white/40">
                      {profile.grade}
                    </span>
                  )}
                  {profile.card_frozen && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white border border-red-700">
                      {t("parent.studentProfile.cardFrozen")}
                    </span>
                  )}
                </div>
              </div>
              {/* Balance */}
              <div className="sm:text-right bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/30 self-start">
                <p className="text-xs text-white/80 font-medium">{t("parent.studentProfile.balance")}</p>
                <p className="text-2xl font-bold text-white tabular-nums drop-shadow">
                  {formatTHB(profile.wallet_balance ?? 0)}
                </p>
              </div>
            </div>
          </div>

          {/* Avatar overlapping banner */}
          <div className="bg-white px-6 pt-0 pb-5">
            <div className="-mt-8 mb-4 flex justify-center sm:justify-start">
              {profile.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt={profile.name}
                  className="h-24 w-24 rounded-full object-cover border-4 border-amber-400 shadow-xl"
                />
              ) : (
                <div className="h-24 w-24 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 border-4 border-amber-400 shadow-xl flex items-center justify-center text-white text-3xl font-bold">
                  {profile.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Personal Info Card — blue accent */}
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-400" />
          <CardHeader className="bg-blue-50 border-b border-blue-100 pb-3">
            <CardTitle className="text-base font-semibold text-blue-800 flex items-center gap-2">
              <IdCard className="h-4 w-4 text-blue-600" />
              {t("parent.studentProfile.customerCode")} & {t("parent.studentProfile.nfcCard")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 text-sm pt-4">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">{t("parent.studentProfile.customerCode")}</p>
              <p className="font-semibold text-gray-800">{profile.customer_code}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide flex items-center gap-1">
                <IdCard className="h-3 w-3" /> {t("parent.studentProfile.nfcCard")}
              </p>
              <p className="font-mono font-semibold text-gray-800">{profile.card_uid || "-"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">{t("parent.studentProfile.email")}</p>
              <p className="text-gray-800">{profile.email || "-"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">{t("parent.studentProfile.phone")}</p>
              <p className="text-gray-800">{profile.phone || "-"}</p>
            </div>
          </CardContent>
        </Card>

        {/* Allergies — red accent when has allergy, green when none */}
        <Card className={`border-0 shadow-md overflow-hidden ${profile.allergies ? "ring-2 ring-red-400" : ""}`}>
          <div className={`h-1 ${profile.allergies ? "bg-gradient-to-r from-red-500 to-red-400" : "bg-gradient-to-r from-green-400 to-emerald-400"}`} />
          <CardHeader className={`border-b pb-3 ${profile.allergies ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100"}`}>
            <CardTitle className={`text-base font-semibold flex items-center gap-2 ${profile.allergies ? "text-red-800" : "text-green-800"}`}>
              <AlertCircle className={`h-5 w-5 ${profile.allergies ? "text-red-600" : "text-green-600"}`} />
              {t("parent.studentProfile.allergyTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm pt-4">
            <div>
              <p className="text-xs font-medium text-red-600 uppercase tracking-wide mb-1.5">{t("parent.studentProfile.allergiesLabel")}</p>
              <div className={`rounded-lg border p-3 ${profile.allergies ? "bg-red-50 border-red-200 text-red-900 font-semibold" : "bg-gray-50 border-gray-200"}`}>
                {profile.allergies || <span className="text-gray-400 font-normal">{t("parent.studentProfile.noData")}</span>}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-orange-600 uppercase tracking-wide mb-1.5">{t("parent.studentProfile.dietaryLabel")}</p>
              <div className="rounded-lg border bg-orange-50 border-orange-200 p-3 text-orange-900">
                {profile.dietary_notes || <span className="text-gray-400">{t("parent.studentProfile.noData")}</span>}
              </div>
            </div>
            <p className="text-xs text-gray-500 italic">
              {t("parent.studentProfile.allergyNote")}
            </p>
          </CardContent>
        </Card>

        {/* Card Controls — hidden for students */}
        {!isStudent && (
          <Card className="border-0 shadow-md overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-400" />
            <CardHeader className="bg-amber-50 border-b border-amber-100 pb-3">
              <CardTitle className="text-base font-semibold text-amber-800">{t("parent.studentProfile.cardControlTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {/* Freeze toggle */}
              <div className={`flex items-center justify-between rounded-xl border p-4 transition-colors ${profile.card_frozen ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
                <div>
                  <p className={`font-semibold flex items-center gap-2 ${profile.card_frozen ? "text-red-700" : "text-gray-700"}`}>
                    {profile.card_frozen
                      ? <Lock className="h-4 w-4 text-red-600" />
                      : <Unlock className="h-4 w-4 text-green-600" />}
                    {t("parent.studentProfile.freezeLabel")}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t("parent.studentProfile.freezeHint")}
                  </p>
                </div>
                <Switch
                  checked={profile.card_frozen}
                  onCheckedChange={toggleFreeze}
                />
              </div>

              {/* Daily limit */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                <div>
                  <Label htmlFor="dailyLimit" className="text-amber-900 font-semibold">{t("parent.studentProfile.dailyLimitLabel")}</Label>
                  <p className="text-xs text-amber-700 mt-0.5">{t("parent.studentProfile.dailyLimitHint")}</p>
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
                    className="border-amber-300 focus:ring-amber-400 focus:border-amber-400"
                  />
                  <Button
                    onClick={saveDailyLimit}
                    disabled={savingLimit}
                    className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold shadow-sm border-0 shrink-0"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {savingLimit ? t("parent.studentProfile.saving") : t("parent.studentProfile.save")}
                  </Button>
                </div>
                {profile.daily_limit !== null && profile.daily_limit !== undefined && (
                  <p className="text-xs text-amber-700 font-medium">
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
