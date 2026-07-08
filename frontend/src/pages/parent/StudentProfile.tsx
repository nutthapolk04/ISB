import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { IdCard } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { getRoleStyle, getRoleLabel } from "@/lib/roleStyles";
import { formatCurrency as formatTHB } from "@/lib/format";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";

interface StudentProfileData {
  id: number;
  customer_code: string;
  student_code?: string | null;
  name: string;
  grade?: string | null;
  photo_url?: string | null;
  email?: string | null;
  phone?: string | null;
  card_uid?: string | null;
  card_frozen: boolean;
  wallet_balance?: number | null;
}


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

        {/* Hero card — credit-card layout matching FamilyDashboard */}
        <div className="rounded-2xl p-4 shadow-lg relative overflow-hidden" style={getRoleStyle("student")}>
          <div className="absolute top-3 right-3 z-20">
            <BackButton to="/parent/dashboard" />
          </div>
          <div className="absolute right-10 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/15 pointer-events-none" />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/15 pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-start gap-3 pr-24">
              <div className="shrink-0">
                <img
                  src={resolveAvatarUrl(profile.photo_url, profile.name || String(profile.id))}
                  alt={profile.name}
                  className="h-12 w-12 rounded-full object-cover border-2 border-white/40 shadow-md"
                  onError={(e) => { e.currentTarget.src = getFallbackAvatar(profile.name || String(profile.id)); }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-white truncate">{profile.name}</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="inline-block bg-white/25 border border-white/40 text-white text-[0.6rem] font-bold uppercase tracking-wider rounded-full px-2 py-0">
                    {getRoleLabel("student")}
                  </span>
                  {profile.student_code && (
                    <span className="inline-block bg-white/25 border border-white/40 text-white text-[0.6rem] font-bold tracking-wider rounded-full px-2 py-0">
                      {profile.student_code}
                    </span>
                  )}
                  {profile.grade && (
                    <span className="inline-block bg-white/25 border border-white/40 text-white text-[0.6rem] font-bold tracking-wider rounded-full px-2 py-0">
                      {profile.grade}
                    </span>
                  )}
                  {profile.card_frozen && (
                    <span className="inline-block bg-red-600 border border-red-700 text-white text-[0.6rem] font-bold uppercase tracking-wider rounded-full px-2 py-0">
                      {t("parent.studentProfile.cardFrozen")}
                    </span>
                  )}
                </div>
                <p className="text-[0.7rem] text-white/80 mt-1">{t("parent.dashboard.balanceUnit", "Current Balance (Baht)")}</p>
              </div>
            </div>

            <div className="text-center my-3">
              <span className="text-3xl font-extrabold text-white tabular-nums">
                {formatTHB(profile.wallet_balance ?? 0)}
              </span>
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

      </div>
    </div>
  );
}
