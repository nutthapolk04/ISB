/**
 * VoidDialog — Module 4 (Void/Cancel Transaction)
 *
 * Spec requirements implemented:
 *  - Mandatory cancellation reason (Module 4: "Audit: Log cancellation reason")
 *  - Manager authorization: tap manager card OR 4-digit PIN
 *  - On confirm: callback to caller (caller restores stock, clears cart)
 *  - Audit log (mock — Module 5: AuditLogs)
 *  - Success state inside same dialog
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { XCircle, CreditCard, CheckCircle2, ChevronLeft, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoidCartItem {
  id: number;
  name: string;
  barcode: string;
  quantity: number;
  /** Unit price already resolved by priceMode (retail or internal) */
  unitPrice: number;
}

interface VoidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: VoidCartItem[];
  total: number;
  onConfirmed: (reason: string, notes: string) => void;
}

// ---------------------------------------------------------------------------
// Mock audit log helper (Module 5 stub)
// ---------------------------------------------------------------------------

function logVoidAudit(reason: string, notes: string, itemCount: number, total: number) {
  // TODO: replace with real AuditLog API call (Module 5)
  console.info("[AuditLog] void", {
    entity_type: "transaction",
    action: "cancel",
    changes_json: { reason, notes, itemCount, total },
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Step = "review" | "auth" | "success";

// Mock manager PIN — in production this would be verified server-side
const MOCK_MANAGER_PIN = "1234";

const REASON_KEYS = [
  "customer_changed_mind",
  "incorrect_items",
  "payment_issue",
  "price_dispute",
  "test_transaction",
  "other",
] as const;

export function VoidDialog({
  open,
  onOpenChange,
  items,
  total,
  onConfirmed,
}: VoidDialogProps) {
  const { t } = useTranslation();

  const [step,          setStep]          = useState<Step>("review");
  const [reason,        setReason]        = useState("");
  const [notes,         setNotes]         = useState("");
  const [pin,           setPin]           = useState("");
  const [pinError,      setPinError]      = useState(false);
  const [cardTapped,    setCardTapped]    = useState(false);
  const [authError,     setAuthError]     = useState(false);

  // ---- Reset on close ----
  const handleOpenChange = (val: boolean) => {
    if (!val) {
      // Delay reset so the close animation finishes
      setTimeout(() => {
        setStep("review");
        setReason("");
        setNotes("");
        setPin("");
        setPinError(false);
        setCardTapped(false);
        setAuthError(false);
      }, 300);
    }
    onOpenChange(val);
  };

  // ---- Step: Review → Auth ----
  const handleProceedToAuth = () => {
    if (!reason) {
      // shake effect handled by authError reuse — just highlight select
      return;
    }
    setStep("auth");
    setPin("");
    setPinError(false);
    setCardTapped(false);
    setAuthError(false);
  };

  // ---- Step: Auth — tap card ----
  const handleTapManagerCard = () => {
    setCardTapped(true);
    setAuthError(false);
  };

  // ---- Step: Auth — confirm with PIN or card ----
  const handleConfirmVoid = () => {
    // Card tap path
    if (cardTapped) {
      finalizeVoid();
      return;
    }
    // PIN path
    if (pin === MOCK_MANAGER_PIN) {
      finalizeVoid();
    } else {
      setPinError(true);
      setAuthError(false);
    }
  };

  const finalizeVoid = () => {
    logVoidAudit(reason, notes, items.reduce((s, i) => s + i.quantity, 0), total);
    setStep("success");
  };

  // ---- Step: Success — close and notify caller ----
  const handleSuccessClose = () => {
    onConfirmed(reason, notes);
    handleOpenChange(false);
  };

  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderReview = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-destructive" />
          {t("store.void.title")}
        </DialogTitle>
        <DialogDescription>{t("store.void.description")}</DialogDescription>
      </DialogHeader>

      {/* Items summary */}
      <div className="rounded-lg border border-border/80 bg-muted/40 overflow-hidden">
        <div className="px-3 py-2 bg-muted/60 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("store.void.itemsHeader")} · {itemCount} {t("store.pieces")}
        </div>
        <div className="divide-y divide-border/40 max-h-40 overflow-auto">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{item.barcode}</p>
              </div>
              <div className="text-right ml-3 shrink-0 tabular-nums">
                <p className="font-bold text-destructive">
                  ฿{(item.unitPrice * item.quantity).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.quantity} × ฿{item.unitPrice.toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-3 py-2 bg-destructive/5 border-t border-destructive/20">
          <span className="text-sm font-semibold">{t("store.tableTotal")}</span>
          <span className="font-bold text-destructive tabular-nums text-lg">
            ฿{total.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Reason */}
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold">
          {t("store.void.reasonLabel")}
          <span className="text-destructive ml-1">*</span>
        </Label>
        <Select value={reason} onValueChange={(v) => { setReason(v); }}>
          <SelectTrigger className={!reason && step === "review" ? "" : ""}>
            <SelectValue placeholder={t("store.void.reasonPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {REASON_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`store.void.reasons.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold">{t("store.void.notesLabel")}</Label>
        <Textarea
          placeholder={t("store.void.notesPlaceholder")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="resize-none"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => handleOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          disabled={!reason}
          onClick={handleProceedToAuth}
        >
          {t("store.void.proceedToAuth")}
        </Button>
      </div>
    </>
  );

  const renderAuth = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          {t("store.void.authTitle")}
        </DialogTitle>
        <DialogDescription>{t("store.void.authDescription")}</DialogDescription>
      </DialogHeader>

      {/* Tap manager card */}
      {!cardTapped ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <div
            className="w-24 h-24 bg-muted border-4 border-dashed rounded-lg flex items-center justify-center animate-pulse cursor-pointer hover:bg-primary/5 transition"
            onClick={handleTapManagerCard}
          >
            <CreditCard className="h-12 w-12 text-muted-foreground" />
          </div>
          <p className="text-sm text-center text-muted-foreground">
            {t("store.void.tapManagerCardDesc")}
          </p>
          <Button variant="outline" className="w-full" onClick={handleTapManagerCard}>
            <CreditCard className="h-4 w-4 mr-2" />
            {t("store.void.tapManagerCard")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="w-24 h-24 bg-success/10 border-4 border-success/40 rounded-lg flex items-center justify-center">
            <CreditCard className="h-12 w-12 text-success" />
          </div>
          <p className="text-sm font-semibold text-success">{t("store.void.cardVerified")}</p>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">{t("common.or")}</span>
        <Separator className="flex-1" />
      </div>

      {/* PIN */}
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold">{t("store.void.pinLabel")}</Label>
        <Input
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder={t("store.void.pinPlaceholder")}
          value={pin}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 4);
            setPin(v);
            setPinError(false);
            if (v.length > 0) setCardTapped(false);
          }}
          className={pinError ? "border-destructive focus-visible:ring-destructive" : ""}
        />
        {pinError && (
          <p className="text-xs text-destructive">{t("store.void.pinError")}</p>
        )}
        {authError && (
          <p className="text-xs text-destructive">{t("store.void.errorAuthRequired")}</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => { setStep("review"); setCardTapped(false); setPin(""); setPinError(false); }}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t("store.void.backButton")}
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          disabled={!cardTapped && pin.length < 4}
          onClick={handleConfirmVoid}
        >
          {t("store.void.confirmVoid")}
        </Button>
      </div>
    </>
  );

  const renderSuccess = () => (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center">
        <CheckCircle2 className="h-12 w-12 text-success" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-xl font-bold">{t("store.void.successTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("store.void.successDescription")}</p>
      </div>
      <Button onClick={handleSuccessClose} className="w-full">
        {t("store.void.close")}
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={step === "success" ? handleSuccessClose : handleOpenChange}>
      <DialogContent className="max-w-sm">
        {step === "review"  && renderReview()}
        {step === "auth"    && renderAuth()}
        {step === "success" && renderSuccess()}
      </DialogContent>
    </Dialog>
  );
}
