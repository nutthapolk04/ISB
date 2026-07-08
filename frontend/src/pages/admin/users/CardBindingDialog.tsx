import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, X } from "lucide-react";
import type { UserDetailData } from "./userDetailTypes";

interface CardBindingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  initialCardUid: string | null;
  onSaved: (updated: UserDetailData) => void;
}

export function CardBindingDialog({ open, onOpenChange, userId, initialCardUid, onSaved }: CardBindingDialogProps) {
  const { t } = useTranslation();
  const [cardInput, setCardInput] = useState("");
  const [savingCard, setSavingCard] = useState(false);

  useEffect(() => {
    if (open) setCardInput(initialCardUid || "");
  }, [open, initialCardUid]);

  const saveCardUid = async () => {
    const cleaned = cardInput.trim().toUpperCase() || null;
    setSavingCard(true);
    try {
      const updated = await api.patch<UserDetailData>(`/users-admin/${userId}`, {
        card_uid: cleaned,
      });
      onSaved(updated);
      onOpenChange(false);
      toast({ title: cleaned ? t("admin.users.cardUidSaved") : t("admin.users.cardUidRemoved") });
    } catch (e) {
      toast({
        title: t("admin.users.cardUidError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingCard(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> {t("admin.users.bindCard")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.users.bindCardDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("admin.users.cardUidHex")}</Label>
            <Input
              value={cardInput}
              onChange={(e) => setCardInput(e.target.value.toUpperCase())}
              placeholder="D7F8F836"
              className="font-mono"
              maxLength={20}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin.users.clearToUnbind")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={savingCard}>
            <X className="h-4 w-4 mr-1" /> {t("admin.users.cancel")}
          </Button>
          <Button onClick={saveCardUid} disabled={savingCard}>
            {savingCard ? t("admin.users.saving") : t("admin.users.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
