import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Edit3, Save, X } from "lucide-react";

interface HealthProfileCardProps {
  allergies: string | null;
  formAllergies: string;
  onFormAllergiesChange: (v: string) => void;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  saving: boolean;
  onSave: () => void;
}

export function HealthProfileCard({
  allergies, formAllergies, onFormAllergiesChange, editing, onStartEdit, onCancelEdit, saving, onSave,
}: HealthProfileCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" /> {t("admin.users.healthProfile")}
        </CardTitle>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={onStartEdit}>
            <Edit3 className="h-4 w-4" />
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={onCancelEdit}>
              <X className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? t("admin.users.saving") : t("admin.users.save")}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("admin.users.allergiesSynced")}</p>
          {editing ? (
            <Textarea
              value={formAllergies}
              onChange={(e) => onFormAllergiesChange(e.target.value)}
              placeholder="peanut, dairy, ..."
              rows={4}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">
              {allergies || <span className="text-muted-foreground italic">{t("admin.users.noAllergies")}</span>}
            </p>
          )}
          {!editing && (
            <p className="text-xs text-muted-foreground">{t("admin.users.allergyOverrideHint")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
