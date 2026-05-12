import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronLeft, Loader2, Nfc, CheckCircle2 } from "lucide-react";

export interface DepartmentOption {
  id: number;
  department_code: string;
  department_name: string;
  wallet_balance: number | null;
}

interface DepartmentPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  departments: DepartmentOption[];
  onBack: () => void;
  onConfirm: (deptId: number, employeeCode: string | null) => Promise<void>;
  confirming: boolean;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export function DepartmentPaymentModal({
  open,
  onOpenChange,
  total,
  departments,
  onBack,
  onConfirm,
  confirming,
}: DepartmentPaymentModalProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [tapped, setTapped] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedId("");
      setEmployeeCode("");
      setTapped(false);
    }
  }, [open]);

  const selected = departments.find((d) => String(d.id) === selectedId);
  const codeValid = /^\d{4,6}$/.test(employeeCode.trim());
  const verified = tapped || codeValid;
  const canConfirm = !!selected && verified && !confirming;

  const handleTap = () => {
    // Mock card tap — in production, this is wired to RFID reader
    setTapped(true);
    setEmployeeCode(""); // tap supersedes manual code
  };

  const handleConfirm = async () => {
    if (!selected) return;
    await onConfirm(selected.id, codeValid ? employeeCode.trim() : null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md canteen-modal-pop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-6 w-6 text-rose-500" />
            {t("storePos.deptModalTitle", "Charge to Department")} — {" "}
            <span className="text-rose-600 tabular-nums">฿{total.toFixed(2)}</span>
          </DialogTitle>
          <DialogDescription>
            {t("storePos.deptModalDesc", "Pick a department then verify with employee code or card tap.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("storePos.deptLabel", "Department")}</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger>
                <SelectValue placeholder={t("storePos.deptPlaceholder", "Select department...")} />
              </SelectTrigger>
              <SelectContent>
                {departments.length === 0 && (
                  <SelectItem value="__none" disabled>
                    {t("storePos.deptNoOptions", "No departments available")}
                  </SelectItem>
                )}
                {departments.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.department_name} ({d.department_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("storePos.deptBalance", "Current balance")}:{" "}
                <span
                  className={
                    (selected.wallet_balance ?? 0) < 0
                      ? "text-destructive font-medium"
                      : "font-medium"
                  }
                >
                  {selected.wallet_balance !== null
                    ? formatTHB(selected.wallet_balance)
                    : "—"}
                </span>{" "}
                · {t("storePos.deptNegativeOk", "negative balance allowed")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="emp-code">{t("storePos.deptEmpCode", "Employee code (4-6 digits)")}</Label>
            <Input
              id="emp-code"
              value={employeeCode}
              onChange={(e) => {
                setEmployeeCode(e.target.value);
                if (e.target.value) setTapped(false);
              }}
              placeholder="e.g. 12345"
              inputMode="numeric"
              autoComplete="off"
              disabled={tapped}
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTap}
                disabled={tapped || !selected}
                className="gap-1.5"
              >
                <Nfc className="h-4 w-4" />
                {tapped
                  ? t("storePos.deptTapped", "Card tapped")
                  : t("storePos.deptTapButton", "Tap Employee Card")}
              </Button>
              {verified && (
                <Badge className="gap-1 bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("storePos.deptVerified", "Verified")}
                </Badge>
              )}
            </div>
            {employeeCode.length > 0 && !codeValid && !tapped && (
              <p className="text-xs text-destructive">
                {t("storePos.deptCodeInvalid", "Employee code must be 4-6 digits")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onBack} disabled={confirming}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t("storePos.back", "Back")}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm} className="bg-rose-600 hover:bg-rose-700 text-white">
            {confirming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("storePos.confirmCharge", "Confirm charge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
