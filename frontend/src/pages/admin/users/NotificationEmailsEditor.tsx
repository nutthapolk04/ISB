import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mail, X } from "lucide-react";
import type { FamilyProfileData } from "./userDetailTypes";

interface NotificationEmailsEditorProps {
  familyCode: string;
  emails: string[];
  loginIds: string[];
  onUpdated: (updated: FamilyProfileData) => void;
}

export function NotificationEmailsEditor({ familyCode, emails, loginIds, onUpdated }: NotificationEmailsEditorProps) {
  const { t } = useTranslation();
  const [notifDraft, setNotifDraft] = useState("");
  const [savingNotif, setSavingNotif] = useState(false);

  const addNotifEmail = async () => {
    const raw = notifDraft.trim().toLowerCase();
    if (!raw) return;
    if (emails.includes(raw)) {
      setNotifDraft("");
      return;
    }
    setSavingNotif(true);
    try {
      const updated = await api.patch<FamilyProfileData>(
        `/users-admin/family-profile/${familyCode}`,
        { notification_emails: [...emails, raw] },
      );
      onUpdated(updated);
      setNotifDraft("");
    } catch (e) {
      toast({
        title: t("admin.users.addEmailError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingNotif(false);
    }
  };

  const removeNotifEmail = async (email: string) => {
    setSavingNotif(true);
    try {
      const updated = await api.patch<FamilyProfileData>(
        `/users-admin/family-profile/${familyCode}`,
        { notification_emails: emails.filter((e) => e !== email) },
      );
      onUpdated(updated);
    } catch (e) {
      toast({
        title: t("admin.users.removeEmailError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingNotif(false);
    }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Mail className="h-4 w-4 text-muted-foreground" />
        {t("admin.users.notificationEmails")}
        <span className="text-xs text-muted-foreground">(PowerSchool family-level contacts)</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {emails.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("admin.users.noNotifEmails")}</span>
        )}
        {emails.map((email) => (
          <Badge key={email} variant="secondary" className="gap-1 pl-2 pr-1 py-1 font-normal">
            {email}
            <button
              className="ml-1 h-4 w-4 rounded hover:bg-background disabled:opacity-50"
              onClick={() => removeNotifEmail(email)}
              disabled={savingNotif}
              aria-label={`Remove ${email}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          type="email"
          value={notifDraft}
          onChange={(e) => setNotifDraft(e.target.value)}
          placeholder="parent@example.com"
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addNotifEmail(); }
          }}
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={addNotifEmail} disabled={savingNotif || !notifDraft.trim()}>
          Add
        </Button>
      </div>
      {loginIds.length > 0 && (
        <div className="pt-2 border-t text-xs">
          <span className="text-muted-foreground">Login IDs (PS):</span>{" "}
          <span className="font-mono">{loginIds.join(", ")}</span>
        </div>
      )}
    </div>
  );
}
