import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Bell } from "lucide-react";

interface SettingsResponse {
  low_balance_alert_enabled?: boolean;
  low_balance_threshold?: number;
  low_balance_alert_send_time?: string;
  [key: string]: unknown;
}

export default function LowBalanceAlert() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState("100");
  const [sendTime, setSendTime] = useState("19:00");

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<SettingsResponse>("/admin/settings/");
        setAlertEnabled(!!data.low_balance_alert_enabled);
        setAlertThreshold(String(data.low_balance_threshold ?? 100));
        setSendTime(data.low_balance_alert_send_time ?? "19:00");
      } catch (e) {
        toast({
          title: t("admin.settings.loadFailed", "Failed to load settings"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    const threshold = parseFloat(alertThreshold);
    if (isNaN(threshold) || threshold < 0) {
      toast({ title: t("admin.settings.invalidThreshold", "Enter a valid amount ≥ 0"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await Promise.all([
        api.put("/admin/settings/low_balance_alert_enabled", { value: alertEnabled }),
        api.put("/admin/settings/low_balance_threshold", { value: threshold }),
        api.put("/admin/settings/low_balance_alert_send_time", { value: sendTime }),
      ]);
      toast({ title: t("admin.settings.saved", "Setting saved") });
    } catch (e) {
      toast({
        title: t("admin.settings.saveFailed", "Failed to save"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">
        <div className="page-header flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" />
          <div>
            <h1 className="page-title">
              {t("admin.lowBalanceAlert.title", "Low Balance Alert")}
            </h1>
            <p className="page-description">
              {t("admin.lowBalanceAlert.subtitle", "Notify parents when a student's wallet balance falls below a threshold")}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("admin.lowBalanceAlert.configTitle", "Notification Settings")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  {t("admin.settings.lowBalanceEnabled", "Enable low balance notification")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("admin.settings.lowBalanceEnabledHint", "Notify parents when a student's wallet balance falls below the threshold.")}
                </p>
              </div>
              <Switch
                checked={alertEnabled}
                disabled={loading || saving}
                onCheckedChange={setAlertEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="alert-threshold">
                {t("admin.settings.lowBalanceThreshold", "Alert threshold (฿)")}
              </Label>
              <div className="flex items-center gap-2 max-w-xs">
                <span className="text-sm text-muted-foreground font-medium">฿</span>
                <Input
                  id="alert-threshold"
                  type="number"
                  min={0}
                  step={10}
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                  disabled={!alertEnabled || loading || saving}
                  placeholder="100"
                  className="w-32"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.lowBalanceThresholdHint", "Parents will be alerted when their child's balance drops below this amount.")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="send-time">
                {t("admin.lowBalanceAlert.sendTime", "Daily send time (Bangkok time)")}
              </Label>
              <Input
                id="send-time"
                type="time"
                value={sendTime}
                onChange={(e) => setSendTime(e.target.value)}
                disabled={!alertEnabled || loading || saving}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.lowBalanceAlert.sendTimeHint", "Alerts queued during the day will be sent to parents at this time.")}
              </p>
            </div>

            <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">{t("admin.lowBalanceAlert.howItWorks", "How it works")}</p>
              <ul className="list-disc list-inside space-y-0.5 text-blue-700">
                <li>{t("admin.lowBalanceAlert.hint1", "Balance is checked after each purchase at POS")}</li>
                <li>{t("admin.lowBalanceAlert.hint2", "If below threshold, alert is queued — not sent immediately")}</li>
                <li>{t("admin.lowBalanceAlert.hint3", "All queued alerts are sent to parents at the configured daily time")}</li>
                <li>{t("admin.lowBalanceAlert.hint4", "Cooldown: one alert per parent–student pair per 24 hours")}</li>
              </ul>
            </div>

            <Button onClick={save} disabled={loading || saving}>
              {saving ? t("admin.settings.saving", "Saving…") : t("common.save", "Save")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
