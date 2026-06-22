import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Bell, BellOff } from "lucide-react";
import { BackButton } from "@/components/BackButton";

interface AlertConfig {
  child_customer_id: number;
  enabled: boolean;
  threshold: number | null;
  last_alert_at: string | null;
}

interface CustomerInfo {
  id: number;
  name: string;
  student_code?: string | null;
}

export default function AlertSettings() {
  const { customerId } = useParams<{ customerId: string }>();
  const { t } = useTranslation();
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [threshold, setThreshold] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    (async () => {
      try {
        const [cfg, cust] = await Promise.all([
          api.get<AlertConfig>(`/family/me/children/${customerId}/low-balance-alert`),
          api.get<CustomerInfo>(`/customers/${customerId}`),
        ]);
        setConfig(cfg);
        setCustomer(cust);
        setEnabled(cfg.enabled);
        setThreshold(cfg.threshold != null ? String(cfg.threshold) : "");
      } catch (e) {
        setError(e instanceof ApiError ? e.detail : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [customerId]);

  const handleSave = async () => {
    if (!customerId) return;
    const thresholdNum = threshold ? Number(threshold) : null;
    if (enabled && (thresholdNum === null || isNaN(thresholdNum) || thresholdNum <= 0)) {
      toast({
        title: t("parent.lowBalanceAlert.invalidThreshold", "Enter a balance threshold to alert on"),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await api.put(`/family/me/children/${customerId}/low-balance-alert`, {
        enabled,
        threshold: thresholdNum,
      });
      toast({ title: t("parent.lowBalanceAlert.saved", "Notification settings saved") });
    } catch (e) {
      toast({
        title: t("parent.lowBalanceAlert.saveFailed", "Failed to save"),
        description: e instanceof ApiError ? e.detail : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell space-y-4">
      <div className="rounded-2xl px-6 py-5 shadow-lg text-white relative"
        style={{ background: "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)" }}>
        <div className="absolute top-3 right-3 z-10">
          <BackButton to="/parent/dashboard" />
        </div>
        <div className="pr-24">
          <h1 className="text-2xl font-bold tracking-tight drop-shadow-sm">
            {t("parent.dashboard.alerts", "Alerts")}
          </h1>
          {customer && (
            <span className="mt-2 inline-block rounded-full bg-white/25 px-3 py-0.5 text-sm font-medium text-white">
              {customer.name}
            </span>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-destructive mb-4">
          <CardContent className="p-4 text-destructive text-sm">{error}</CardContent>
        </Card>
      )}

      {loading && <div className="h-48 rounded-2xl bg-slate-100 animate-pulse" />}

      {!loading && !error && config && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {enabled ? <Bell className="h-4 w-4 text-blue-500" /> : <BellOff className="h-4 w-4 text-slate-400" />}
                {t("parent.lowBalanceAlert.title", "Low-balance email alerts")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-700 flex-1">
                  {t("parent.lowBalanceAlert.toggleLabel", "Email me when the balance drops below the threshold")}
                </p>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              {enabled && (
                <div className="space-y-1.5">
                  <Label htmlFor="threshold" className="text-sm font-medium text-slate-700">
                    {t("parent.lowBalanceAlert.thresholdLabel", "Alert when balance is below (THB)")}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">฿</span>
                    <Input
                      id="threshold"
                      type="number"
                      min="0"
                      step="50"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      placeholder="200"
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-slate-400">
                    {t("parent.lowBalanceAlert.cooldownNote", "Repeat alerts are sent at most every 4 hours to avoid spam.")}
                  </p>
                </div>
              )}

              {config.last_alert_at && (
                <p className="text-xs text-slate-400">
                  {t("parent.lowBalanceAlert.lastSent", "Last alert sent")}: {fmtDateTime(config.last_alert_at)}
                </p>
              )}
            </CardContent>
          </Card>

          <Button onClick={handleSave} disabled={saving} className="w-full h-11">
            {saving ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </Button>
        </div>
      )}
    </div>
  );
}
