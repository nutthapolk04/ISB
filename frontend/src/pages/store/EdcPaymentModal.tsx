import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, Loader2, Nfc, Wifi } from "lucide-react";

interface EdcRefs {
  approval_code: string;
  terminal_ref?: string;
  masked_card?: string;
}

interface EdcPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  onBack: () => void;
  onConfirm: (refs: EdcRefs) => Promise<void>;
  confirming: boolean;
}

const FETCH_DELAY_MS = 1800;

const generateMockApproval = () => {
  const random = () => Math.floor(Math.random() * 10).toString();
  return `AUTH${random()}${random()}${random()}${random()}${random()}${random()}`;
};

const generateMockMaskedCard = () => {
  const last4 = Math.floor(1000 + Math.random() * 9000).toString();
  return `**** **** **** ${last4}`;
};

const generateMockTerminalRef = () => {
  const random = () => Math.floor(Math.random() * 10).toString();
  return `TXN${Date.now().toString().slice(-8)}${random()}${random()}`;
};

export function EdcPaymentModal({
  open,
  onOpenChange,
  total,
  onBack,
  onConfirm,
  confirming,
}: EdcPaymentModalProps) {
  const { t } = useTranslation();
  const [approvalCode, setApprovalCode] = useState("");
  const [terminalRef, setTerminalRef] = useState("");
  const [maskedCard, setMaskedCard] = useState("");
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) {
      setApprovalCode("");
      setTerminalRef("");
      setMaskedCard("");
      setFetching(false);
    }
  }, [open]);

  const handleFetch = () => {
    setFetching(true);
    // Mock terminal fetch — in production this calls EDC SDK
    setTimeout(() => {
      setApprovalCode(generateMockApproval());
      setMaskedCard(generateMockMaskedCard());
      setTerminalRef(generateMockTerminalRef());
      setFetching(false);
    }, FETCH_DELAY_MS);
  };

  const canConfirm = approvalCode.trim().length > 0 && !confirming;

  const pendingRef = useRef(false);
  const handleConfirm = async () => {
    if (pendingRef.current || !canConfirm) return;
    pendingRef.current = true;
    try {
      await onConfirm({
        approval_code: approvalCode.trim(),
        terminal_ref: terminalRef.trim() || undefined,
        masked_card: maskedCard.trim() || undefined,
      });
    } finally {
      pendingRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md canteen-modal-pop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Nfc className="h-6 w-6 text-violet-500" />
            {t("storePos.edcModalTitle", "EDC — Credit / Debit Card")} —{" "}
            <span className="text-violet-600 tabular-nums">฿{total.toFixed(2)}</span>
          </DialogTitle>
          <DialogDescription>
            {t(
              "storePos.edcModalDesc",
              "Tap card on the terminal then click Fetch — or enter approval code manually.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleFetch}
            disabled={fetching || confirming}
            className="w-full gap-2 h-12"
          >
            {fetching ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Wifi className="h-5 w-5" />
            )}
            {fetching
              ? t("storePos.edcFetching", "Reading terminal...")
              : t("storePos.edcFetchButton", "Fetch from terminal (mock)")}
          </Button>

          <div className="space-y-1.5">
            <Label htmlFor="edc-approval">
              {t("storePos.edcApproval", "Approval code")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edc-approval"
              value={approvalCode}
              onChange={(e) => setApprovalCode(e.target.value)}
              placeholder="AUTH123456"
              autoComplete="off"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edc-terminal">
              {t("storePos.edcTerminalRef", "Terminal reference")}{" "}
              <span className="text-muted-foreground text-xs">({t("storePos.optional", "optional")})</span>
            </Label>
            <Input
              id="edc-terminal"
              value={terminalRef}
              onChange={(e) => setTerminalRef(e.target.value)}
              placeholder="TXN12345678"
              autoComplete="off"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edc-card">
              {t("storePos.edcMaskedCard", "Masked card")}{" "}
              <span className="text-muted-foreground text-xs">({t("storePos.optional", "optional")})</span>
            </Label>
            <Input
              id="edc-card"
              value={maskedCard}
              onChange={(e) => setMaskedCard(e.target.value)}
              placeholder="**** **** **** 1234"
              autoComplete="off"
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onBack} disabled={confirming || fetching}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t("storePos.back", "Back")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {confirming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("storePos.confirmCharge", "Confirm charge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
