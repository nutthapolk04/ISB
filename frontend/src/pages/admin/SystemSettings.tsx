import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Settings as SettingsIcon } from "lucide-react";

interface SettingsResponse {
  allow_negative_user_wallet?: boolean;
  allow_negative_customer_wallet?: boolean;
  [key: string]: unknown;
}

export default function SystemSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [allowUserNeg, setAllowUserNeg] = useState(false);
  const [allowCustomerNeg, setAllowCustomerNeg] = useState(false);

  // School info state
  const [schoolName, setSchoolName] = useState("");
  const [schoolAddress, setSchoolAddress] = useState("");
  const [schoolTaxId, setSchoolTaxId] = useState("");
  const [schoolPhone, setSchoolPhone] = useState("");
  const [schoolLogoUrl, setSchoolLogoUrl] = useState("");
  const [schoolCoverUrl, setSchoolCoverUrl] = useState("");
  // Free-form footer line printed at the bottom of every receipt. Empty
  // string means the localized "Thank you" fallback in the template wins.
  const [schoolReceiptFooter, setSchoolReceiptFooter] = useState("");
  const [schoolSaving, setSchoolSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const loadSchool = async () => {
    try {
      const data = await api.get<Record<string, string>>("/admin/settings/school");
      setSchoolName(data.school_name ?? "");
      setSchoolAddress(data.school_address ?? "");
      setSchoolTaxId(data.school_tax_id ?? "");
      setSchoolPhone(data.school_phone ?? "");
      setSchoolLogoUrl(data.school_logo_url ?? "");
      setSchoolCoverUrl(data.school_cover_url ?? "");
      setSchoolReceiptFooter(data.school_receipt_footer ?? "");
    } catch { /* silent */ }
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<SettingsResponse>("/admin/settings/");
      setAllowUserNeg(!!data.allow_negative_user_wallet);
      setAllowCustomerNeg(!!data.allow_negative_customer_wallet);
    } catch (e) {
      toast({
        title: t("admin.settings.loadFailed", "Failed to load settings"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadSchool();
  }, []);

  const update = async (key: string, value: boolean, setter: (v: boolean) => void) => {
    const previous = key === "allow_negative_user_wallet" ? allowUserNeg : allowCustomerNeg;
    setter(value);
    setSavingKey(key);
    try {
      await api.put(`/admin/settings/${key}`, { value });
      toast({ title: t("admin.settings.saved", "Setting saved") });
    } catch (e) {
      setter(previous);
      toast({
        title: t("admin.settings.saveFailed", "Failed to save"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSchoolLogoUrl(ev.target?.result as string ?? "");
    reader.readAsDataURL(file);
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSchoolCoverUrl(ev.target?.result as string ?? "");
    reader.readAsDataURL(file);
  };

  const saveSchool = async () => {
    setSchoolSaving(true);
    try {
      await api.put("/admin/settings/school", {
        school_name: schoolName,
        school_address: schoolAddress,
        school_tax_id: schoolTaxId,
        school_phone: schoolPhone,
        school_logo_url: schoolLogoUrl,
        school_cover_url: schoolCoverUrl,
        school_receipt_footer: schoolReceiptFooter,
      });
      toast({ title: t("admin.settings.schoolSaved") });
    } catch (e) {
      toast({ title: t("admin.settings.saveFailed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setSchoolSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="space-y-4 sm:space-y-6">
      <div className="page-header flex items-center gap-3">
        <SettingsIcon className="h-7 w-7 text-primary" />
        <div>
          <h1 className="page-title">
            {t("admin.settings.title", "System Settings")}
          </h1>
          <p className="page-description">
            {t("admin.settings.subtitle", "Runtime feature flags for the whole system")}
          </p>
        </div>
      </div>

      {/* School Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.settings.schoolInfoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="school-name">{t("admin.settings.schoolName")}</Label>
            <Input
              id="school-name"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="International School Bangkok"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="school-address">{t("admin.settings.schoolAddress")}</Label>
            <Input
              id="school-address"
              value={schoolAddress}
              onChange={(e) => setSchoolAddress(e.target.value)}
              placeholder={t("admin.settings.schoolAddressPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="school-tax-id">{t("admin.settings.taxId")}</Label>
            <Input
              id="school-tax-id"
              value={schoolTaxId}
              onChange={(e) => setSchoolTaxId(e.target.value)}
              placeholder="0000000000000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="school-phone">{t("admin.settings.phone")}</Label>
            <Input
              id="school-phone"
              value={schoolPhone}
              onChange={(e) => setSchoolPhone(e.target.value)}
              placeholder="02-000-0000"
            />
          </div>
          {/* Receipt footer */}
          <div className="space-y-2">
            <Label htmlFor="school-receipt-footer">{t("admin.settings.receiptFooter", "Receipt footer")}</Label>
            <Input
              id="school-receipt-footer"
              value={schoolReceiptFooter}
              onChange={(e) => setSchoolReceiptFooter(e.target.value)}
              placeholder={t("admin.settings.receiptFooterPlaceholder", "e.g. Thank you for shopping with us")}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin.settings.receiptFooterHint", "Printed at the bottom of every receipt. Leave blank to use the default \"Thank you\" message.")}
            </p>
          </div>
          {/* Logo */}
          <div className="space-y-2">
            <Label>{t("admin.settings.logo")}</Label>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                {t("admin.settings.selectImageFile")}
              </Button>
              {schoolLogoUrl && (
                <Button type="button" variant="ghost" size="sm"
                  onClick={() => { setSchoolLogoUrl(""); if (logoInputRef.current) logoInputRef.current.value = ""; }}>
                  {t("admin.settings.deleteLogo")}
                </Button>
              )}
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
            {schoolLogoUrl && (
              <img src={schoolLogoUrl} alt="School logo preview" className="h-16 w-16 object-contain rounded border" />
            )}
          </div>

          {/* Cover image */}
          <div className="space-y-2">
            <Label>{t("admin.settings.coverImage")}</Label>
            <p className="text-xs text-muted-foreground">{t("admin.settings.coverImageHint")}</p>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => coverInputRef.current?.click()}>
                {t("admin.settings.selectCover")}
              </Button>
              {schoolCoverUrl && (
                <Button type="button" variant="ghost" size="sm"
                  onClick={() => { setSchoolCoverUrl(""); if (coverInputRef.current) coverInputRef.current.value = ""; }}>
                  {t("admin.settings.deleteCover")}
                </Button>
              )}
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
            {schoolCoverUrl ? (
              <div className="relative overflow-hidden rounded-lg border w-full aspect-video bg-muted">
                <img src={schoolCoverUrl} alt="Cover preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-end p-3 bg-gradient-to-t from-black/50 to-transparent">
                  <span className="text-xs text-white/80">{t("admin.settings.coverPreview")}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed w-full aspect-video bg-muted/40 text-muted-foreground text-sm">
                {t("admin.settings.noCover")}
              </div>
            )}
          </div>

          <Separator />
          <Button onClick={saveSchool} disabled={schoolSaving}>
            {schoolSaving ? t("admin.settings.saving") : t("admin.settings.saveSchool")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("admin.settings.negativePolicyTitle", "Wallet Negative Balance Policy")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {t("admin.settings.allowUserNeg", "Allow User wallet to go negative")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  "admin.settings.allowUserNegHint",
                  "Staff and parent personal wallets can go below 0 when this is ON.",
                )}
              </p>
            </div>
            <Switch
              checked={allowUserNeg}
              disabled={loading || savingKey === "allow_negative_user_wallet"}
              onCheckedChange={(v) => update("allow_negative_user_wallet", v, setAllowUserNeg)}
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {t("admin.settings.allowCustomerNeg", "Allow Customer wallet to go negative")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  "admin.settings.allowCustomerNegHint",
                  "Student/visitor wallets can go below 0 when this is ON. When OFF, admin can still grant per-customer overdraft via 'negative credit limit'.",
                )}
              </p>
            </div>
            <Switch
              checked={allowCustomerNeg}
              disabled={loading || savingKey === "allow_negative_customer_wallet"}
              onCheckedChange={(v) =>
                update("allow_negative_customer_wallet", v, setAllowCustomerNeg)
              }
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              {t(
                "admin.settings.deptNote",
                "Department wallets always allow negative balance — this policy does not apply to them. Admin manual adjustments also bypass these flags (they have their own audit trail).",
              )}
            </p>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
