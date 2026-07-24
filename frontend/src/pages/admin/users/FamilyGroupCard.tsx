import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Crown } from "lucide-react";
import { getFallbackAvatar, resolveAvatarUrl } from "@/lib/avatarFallback";
import { NotificationEmailsEditor } from "./NotificationEmailsEditor";
import type { FamilyMember, FamilyProfileData } from "./userDetailTypes";

interface FamilyGroupCardProps {
  familyCode: string;
  members: FamilyMember[];
  familyProfile: FamilyProfileData | null;
  onProfileUpdated: (updated: FamilyProfileData) => void;
}

export function FamilyGroupCard({ familyCode, members, familyProfile, onProfileUpdated }: FamilyGroupCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-lg">{t("admin.users.familyGroupLabel")}<span className="font-mono text-base">{familyCode}</span></CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <div key={`${m.entity_type}-${m.id}`} className="flex items-start gap-3 rounded-md border p-3">
              <img
                src={resolveAvatarUrl(m.photo_url, m.name || `${m.entity_type}-${m.id}`)}
                alt=""
                className="h-12 w-12 rounded-full object-cover border bg-muted"
                onError={(e) => { e.currentTarget.src = getFallbackAvatar(m.name || `${m.entity_type}-${m.id}`); }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 font-medium truncate">
                  {m.parent_rank === "main" && (
                    <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Main parent" />
                  )}
                  <span className="truncate">{m.name}</span>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-1 mt-0.5">
                  <Badge variant="outline" className="text-xs capitalize">{m.role}</Badge>
                  {m.customer_type && (
                    <Badge variant="secondary" className="text-xs">{m.customer_type}</Badge>
                  )}
                  {m.school_type && (
                    <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 text-[10px]">
                      {m.school_type.replace(" Student", "")}
                    </Badge>
                  )}
                  {m.grade && <Badge variant="secondary" className="text-xs">G{m.grade.replace(/^G/i, "")}</Badge>}
                  {m.parent_rank && (
                    <Badge className="text-[10px] bg-amber-100 text-amber-900 hover:bg-amber-100">
                      {m.parent_rank}
                    </Badge>
                  )}
                </div>
                {m.external_id && <div className="text-xs font-mono text-muted-foreground mt-1">ext: {m.external_id}</div>}
                {m.card_uid && (
                  <div className="text-xs font-mono text-muted-foreground mt-0.5 flex items-center gap-1">
                    <CreditCard className="h-3 w-3" /> {m.card_uid}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <NotificationEmailsEditor
          familyCode={familyCode}
          syncedEmails={familyProfile?.notification_emails || []}
          adminEmails={familyProfile?.admin_notification_emails || []}
          loginIds={familyProfile?.login_ids || []}
          onUpdated={onProfileUpdated}
        />
      </CardContent>
    </Card>
  );
}
