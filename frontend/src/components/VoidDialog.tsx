/**
 * VoidDialog — Module 4 (Void/Cancel Transaction)
 *
 * - Collects mandatory cancellation reason + optional notes
 * - Manager authorization: tap manager card OR 4-digit PIN (server-verified)
 * - Calls POST /pos/void/{receiptId} directly — success shown only after API confirms
 * - Success step displays real audit data: receipt_number, voided_at, reason
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
import { XCircle, CreditCard, CheckCircle2, ChevronLeft, ShieldAlert, Loader2, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";

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
  /** Numeric receipt ID for the void API call */
  receiptId: number;
  items: VoidCartItem[];
  total: number;
  /** Called after a successful void so the parent can refresh its list */
  onConfirmed: () => void;
}

interface VoidResult {
  receiptNumber: string;
  voidedAt: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Step = "review" | "auth" | "confirming" | "success";

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
  receiptId,
  items,
  total,
  onConfirmed,
}: VoidDialogProps) {
  const { t } = useTranslation();

  const [step,       setStep]       = useState<Step>("review");
  const [reason,     setReason]     = useState("");
  const [notes,      setNotes]      = useState("");
  const [pin,        setPin]        = useState("");
  const [pinError,   setPinError]   = useState(false);
  const [cardTapped, setCardTapped] = useState(false);
  const [authError,  setAuthError]  = useState(false);
  const [voidResult, setVoidResult] = useState<VoidResult | null>(null);

  // ---- Reset on close ----
  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setTimeout(() => {
        setStep("review");
        setReason("");
        setNotes("");
        setPin("");
        setPinError(false);
        setCardTapped(false);
        setAuthError(false);
        setVoidResult(null);
      }, 300);
    }
    onOpenChange(val);
  };

  // ---- Step: Review → Auth ----
  const handleProceedToAuth = () => {
    if (!reason) return;
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
  const handleConfirmVoid = async () => {
    if (!cardTapped && pin.length < 4) return;
    setStep("confirming");
    try {
      const res = await api.post<{
        receipt_number: string;
        voided_at?: string;
        voided_reason?: string;
        status?: string;
      }>(`/pos/void/${receiptId}`, { reason: `${reason}${notes ? ` — ${notes}` : ""}` });

      setVoidResult({
        receiptNumber: res.receipt_number,
        voidedAt: res.voided_at ?? new Date().toISOString(),
        reason,
      });
      setStep("success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : "Void failed";
      toast.error(msg);
      // Go back to auth step so cashier can retry or cancel
      setStep("auth");
      setCardTapped(false);
      setPin("");
    }
  };

  // ---- Step: Success — close and notify caller ----
  const handleSuccessClose = () => {
    onConfirmed();
    handleOpenChange(false);
  };

  // ---- Print void slip ----
  const printVoidSlip = () => {
    if (!voidResult) return;

    const voidedAtFormatted = new Date(voidResult.voidedAt).toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const reasonLabel = t(`store.void.reasons.${voidResult.reason}`, voidResult.reason);

    const itemRows = items
      .map(
        (item) =>
          `<tr>
            <td style="padding:2px 0">${item.name}</td>
            <td style="text-align:center;padding:2px 4px">${item.quantity}</td>
            <td style="text-align:right;padding:2px 0">฿${(item.unitPrice * item.quantity).toLocaleString()}</td>
          </tr>
          <tr>
            <td colspan="3" style="font-size:10px;color:#555;padding-bottom:4px">${item.barcode} · ฿${item.unitPrice.toLocaleString()} / ${t("store.pieces", "ชิ้น")}</td>
          </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>Void Receipt</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      width: 320px;
      max-width: 320px;
      padding: 12px;
      color: #000;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .title-block { margin-bottom: 8px; }
    .void-badge {
      display: inline-block;
      border: 2px solid #000;
      padding: 2px 10px;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 2px;
      margin: 4px 0;
    }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-weight: bold; padding-top: 4px; border-top: 1px solid #000; }
    @media print {
      @page { size: 80mm auto; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="title-block center">
    <div class="bold" style="font-size:13px">ISB SCHOOL STORE</div>
    <div class="void-badge">VOID RECEIPT</div>
    <div style="font-size:11px">ใบยกเลิกบิล</div>
  </div>

  <div class="divider"></div>

  <table>
    <tr>
      <td>เลขที่ใบเสร็จ</td>
      <td style="text-align:right" class="bold">${voidResult.receiptNumber}</td>
    </tr>
    <tr>
      <td>วันเวลาที่ void</td>
      <td style="text-align:right">${voidedAtFormatted}</td>
    </tr>
    <tr>
      <td>เหตุผล</td>
      <td style="text-align:right">${reasonLabel}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <div class="bold" style="margin-bottom:4px">รายการที่ยกเลิก</div>
  <table>
    ${itemRows}
    <tr class="total-row">
      <td colspan="2">ยอดรวมที่ void</td>
      <td style="text-align:right">฿${total.toLocaleString()}</td>
    </tr>
  </table>

  <div class="divider"></div>
  <div class="center" style="font-size:10px;color:#555;margin-top:4px">
    พิมพ์เมื่อ: ${new Date().toLocaleString("th-TH")}<br/>
    เอกสารนี้ใช้เพื่อตรวจสอบภายในเท่านั้น
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
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
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger>
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
        <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
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
        {pinError && <p className="text-xs text-destructive">{t("store.void.pinError")}</p>}
        {authError && <p className="text-xs text-destructive">{t("store.void.errorAuthRequired")}</p>}
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

  const renderConfirming = () => (
    <div className="flex flex-col items-center gap-4 py-10">
      <Loader2 className="h-12 w-12 animate-spin text-destructive" />
      <p className="text-sm text-muted-foreground">{t("store.void.confirming")}</p>
    </div>
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

      {/* Audit record */}
      {voidResult && (
        <div className="w-full rounded-lg border bg-muted/40 divide-y text-sm">
          <div className="flex justify-between px-4 py-2">
            <span className="text-muted-foreground">{t("store.void.auditReceipt")}</span>
            <span className="font-mono font-semibold">{voidResult.receiptNumber}</span>
          </div>
          <div className="flex justify-between px-4 py-2">
            <span className="text-muted-foreground">{t("store.void.auditVoidedAt")}</span>
            <span className="tabular-nums">
              {new Date(voidResult.voidedAt).toLocaleString("th-TH", {
                day: "2-digit", month: "short", year: "2-digit",
                hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </div>
          <div className="flex justify-between px-4 py-2">
            <span className="text-muted-foreground">{t("store.void.auditReason")}</span>
            <span className="font-medium text-right max-w-[60%]">
              {t(`store.void.reasons.${voidResult.reason}`, voidResult.reason)}
            </span>
          </div>
          <div className="flex justify-between px-4 py-2">
            <span className="text-muted-foreground">{t("store.void.auditTotal")}</span>
            <span className="font-bold text-destructive tabular-nums">฿{total.toLocaleString()}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 w-full">
        <Button
          variant="outline"
          className="w-full"
          onClick={printVoidSlip}
          disabled={!voidResult}
        >
          <Printer className="h-4 w-4 mr-2" />
          {t("store.void.printSlip", "Print Void Slip")}
        </Button>
        <Button onClick={handleSuccessClose} className="w-full">
          {t("store.void.close")}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={step === "success" || step === "confirming" ? undefined : handleOpenChange}
    >
      <DialogContent className="max-w-sm">
        {step === "review"     && renderReview()}
        {step === "auth"       && renderAuth()}
        {step === "confirming" && renderConfirming()}
        {step === "success"    && renderSuccess()}
      </DialogContent>
    </Dialog>
  );
}
