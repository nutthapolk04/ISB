import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Settings, TrendingUp } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { getRoleStyle, getRoleLabel } from "@/lib/roleStyles";

interface ChildProfile {
  id: number;
  customer_code: string;
  student_code?: string | null;
  name: string;
  grade?: string | null;
  photo_url?: string | null;
  daily_limit_canteen?: number | null;
  daily_limit_store?: number | null;
  spent_today_canteen?: number | null;
  spent_today_store?: number | null;
}

export default function ChildSettings() {
  const { customerId } = useParams<{ customerId: string }>();
  const { t } = useTranslation();

  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state — empty string means "unlimited" (null on save)
  const [canteenLimit, setCanteenLimit] = useState("");
  const [storeLimit, setStoreLimit] = useState("");

  useEffect(() => {
    if (!customerId) return;
    api.get<ChildProfile>(`/customers/${customerId}`)
      .then((p) => {
        setProfile(p);
        setCanteenLimit(p.daily_limit_canteen != null ? String(p.daily_limit_canteen) : "");
        setStoreLimit(p.daily_limit_store != null ? String(p.daily_limit_store) : "");
      })
      .catch((e) => {
        toast({
          title: t("parent.childSettings.loadFailed", "Failed to load data"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, [customerId]);

  const handleSave = async () => {
    if (!customerId) return;
    const parseLimit = (v: string): number | null => {
      const n = parseFloat(v);
      return v.trim() === "" || isNaN(n) || n < 0 ? null : n;
    };
    const canteen = parseLimit(canteenLimit);
    const store = parseLimit(storeLimit);

    setSaving(true);
    try {
      await api.patch(`/customers/${customerId}/limit`, {
        daily_limit_canteen: canteen,
        daily_limit_store: store,
      });
      toast({ title: t("parent.childSettings.saveSuccess", "Limits saved") });
      await load();
    } catch (e) {
      toast({
        title: t("parent.childSettings.saveFailed", "Failed to save"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

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
          <div className="px-6 py-5 pr-28">
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                {profile.photo_url ? (
                  <img src={profile.photo_url} alt={profile.name} className="h-14 w-14 rounded-full object-cover border-2 border-white/70 shadow-lg" />
                ) : (
                  <div className="h-14 w-14 rounded-full bg-white/15 border-2 border-white/70 shadow-lg flex items-center justify-center text-white text-xl font-bold">
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg sm:text-xl font-bold text-white break-words">{profile.name}</h1>
                <div className="flex flex-wrap gap-2 mt-1.5">
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
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Today's spending */}
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-blue-500 to-cyan-400" />
          <CardHeader className="bg-blue-50 border-b border-blue-100 pb-3">
            <CardTitle className="text-base font-semibold text-blue-800 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              {t("parent.childSettings.todayTitle", "Today's Spending")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {(["canteen", "store"] as const).map((module) => {
              const spent = module === "canteen" ? (profile.spent_today_canteen ?? 0) : (profile.spent_today_store ?? 0);
              const limit = module === "canteen" ? profile.daily_limit_canteen : profile.daily_limit_store;
              const pct = limit && limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
              const atLimit = limit != null && spent >= limit;
              const nearLimit = !atLimit && limit != null && pct >= 80;
              return (
                <div key={module} className="space-y-1.5">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium text-gray-700 capitalize">
                      {module === "canteen"
                        ? t("parent.childSettings.canteenLabel", "Canteen")
                        : t("parent.childSettings.storeLabel", "Store")}
                    </span>
                    <span className={`font-mono tabular-nums text-xs ${atLimit ? "text-red-600 font-bold" : nearLimit ? "text-amber-600 font-semibold" : "text-gray-500"}`}>
                      ฿{spent.toLocaleString("th-TH", { minimumFractionDigits: 0 })}
                      {limit != null && ` / ฿${limit.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`}
                    </span>
                  </div>
                  {limit != null && limit > 0 && (
                    <Progress
                      value={pct}
                      className={`h-2 ${atLimit ? "[&>div]:bg-red-500" : nearLimit ? "[&>div]:bg-amber-400" : "[&>div]:bg-blue-400"}`}
                    />
                  )}
                  {limit == null && (
                    <p className="text-xs text-gray-400">{t("parent.childSettings.noLimit", "No limit set")}</p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Daily spending limits */}
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-orange-500 to-amber-400" />
          <CardHeader className="bg-orange-50 border-b border-orange-100 pb-3">
            <CardTitle className="text-base font-semibold text-orange-800 flex items-center gap-2">
              <Settings className="h-4 w-4 text-orange-600" />
              {t("parent.childSettings.title", "Daily Spending Limits")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">

            {/* Canteen limit */}
            <div className="space-y-1.5">
              <Label htmlFor="canteen-limit" className="text-sm font-medium text-gray-700">
                {t("parent.childSettings.canteenLabel", "Canteen daily limit")}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500 select-none">฿</span>
                <Input
                  id="canteen-limit"
                  type="number"
                  min={0}
                  step={1}
                  placeholder={t("parent.childSettings.unlimitedPlaceholder", "Unlimited")}
                  value={canteenLimit}
                  onChange={(e) => setCanteenLimit(e.target.value)}
                  className="pl-7 h-11"
                />
              </div>
              <p className="text-xs text-gray-400">{t("parent.childSettings.unlimitedHint", "Leave empty for unlimited")}</p>
            </div>

            {/* Store limit */}
            <div className="space-y-1.5">
              <Label htmlFor="store-limit" className="text-sm font-medium text-gray-700">
                {t("parent.childSettings.storeLabel", "Store daily limit")}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500 select-none">฿</span>
                <Input
                  id="store-limit"
                  type="number"
                  min={0}
                  step={1}
                  placeholder={t("parent.childSettings.unlimitedPlaceholder", "Unlimited")}
                  value={storeLimit}
                  onChange={(e) => setStoreLimit(e.target.value)}
                  className="pl-7 h-11"
                />
              </div>
              <p className="text-xs text-gray-400">{t("parent.childSettings.unlimitedHint", "Leave empty for unlimited")}</p>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-11"
            >
              {saving
                ? t("parent.childSettings.saving", "Saving...")
                : t("parent.childSettings.save", "Save limits")}
            </Button>

          </CardContent>
        </Card>

      </div>
    </div>
  );
}
