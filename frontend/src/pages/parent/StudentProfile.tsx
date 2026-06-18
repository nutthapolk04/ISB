import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { AlertCircle, IdCard } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { getRoleStyle, getRoleLabel } from "@/lib/roleStyles";

interface StudentProfileData {
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
  wallet_balance?: number | null;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function StudentProfile() {
  const { customerId } = useParams<{ customerId: string }>();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<StudentProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customerId) return;
    api.get<StudentProfileData>(`/customers/${customerId}`)
      .then(setProfile)
      .catch((e) => {
        toast({
          title: t("parent.studentProfile.loadFailed"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading) return <div className="page-shell text-muted-foreground">{t("parent.common.loading")}</div>;
  if (!profile) return <div className="page-shell text-destructive">{t("parent.common.notFound")}</div>;

  return (
    <div className="page-shell min-h-screen bg-slate-50">
      <div className="space-y-4 sm:space-y-6">

        {/* Hero card — back button inside gradient (top-right absolute) */}
        <div className="rounded-2xl overflow-hidden shadow-md relative" style={getRoleStyle("student")}>
          <div className="absolute top-3 right-3 z-10">
            <BackButton to="/parent/dashboard" />
          </div>
          <div className="px-6 py-6 pr-28">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="shrink-0">
                {profile.photo_url ? (
                  <img src={profile.photo_url} alt={profile.name} className="h-20 w-20 rounded-full object-cover border-2 border-white/70 shadow-lg" />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-white/15 border-2 border-white/70 shadow-lg flex items-center justify-center text-white text-2xl font-bold">
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl sm:text-2xl font-bold text-white break-words">{profile.name}</h1>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white border border-white/30">
                    {getRoleLabel("student")}
                  </span>
                  {profile.student_code && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white border border-white/30">
                      {profile.student_code}
                    </span>
                  )}
                  {profile.grade && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white border border-white/30">
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
              <div className="sm:text-right bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/25 self-start sm:self-center">
                <p className="text-xs text-white/85 font-medium">{t("parent.studentProfile.balance")}</p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {formatTHB(profile.wallet_balance ?? 0)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Identity info */}
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

        {/* Allergy info — read-only, always shown */}
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
            <p className="text-xs text-gray-500 italic">{t("parent.studentProfile.allergyNote")}</p>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
