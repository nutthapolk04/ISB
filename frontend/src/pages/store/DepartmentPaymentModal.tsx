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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronLeft, Loader2, Nfc, CheckCircle2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatCurrency as formatTHB } from "@/lib/format";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";

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

interface VerifiedEmployee {
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  photo_url?: string | null;
  department_id?: number | null;
  department_code?: string | null;
  department_name?: string | null;
}


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
  const [empInput, setEmpInput] = useState("");
  const [empLoading, setEmpLoading] = useState(false);
  const [empError, setEmpError] = useState<string | null>(null);
  const [verifiedEmployee, setVerifiedEmployee] = useState<VerifiedEmployee | null>(null);
  const empInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSelectedId("");
      setEmpInput("");
      setEmpError(null);
      setVerifiedEmployee(null);
    }
  }, [open]);

  const selected = departments.find((d) => String(d.id) === selectedId);
  const canConfirm = !!selected && !!verifiedEmployee && !confirming;
  const balanceAfter = selected && selected.wallet_balance !== null
    ? selected.wallet_balance - total
    : null;

  const lookupEmployee = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setEmpLoading(true);
    setEmpError(null);
    setVerifiedEmployee(null);
    try {
      // Try card UID first, then username
      let data: VerifiedEmployee;
      try {
        data = await api.get<VerifiedEmployee>(`/users/by-card/${encodeURIComponent(q)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          data = await api.get<VerifiedEmployee>(`/users/by-username/${encodeURIComponent(q)}`);
        } else {
          throw e;
        }
      }
      setVerifiedEmployee(data);
      // Auto-select department if user is linked to one
      if (data.department_id) {
        const match = departments.find((d) => d.id === data.department_id);
        if (match) setSelectedId(String(match.id));
      }
    } catch (e) {
      setEmpError(e instanceof ApiError ? e.detail : t("storePos.empNotFound"));
    } finally {
      setEmpLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!selected) return;
    await onConfirm(selected.id, verifiedEmployee?.username ?? null);
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
              <div className="rounded-md border border-border bg-muted/40 p-2.5 space-y-1.5 text-xs tabular-nums">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("storePos.deptBalance", "Current balance")}</span>
                  <span className={(selected.wallet_balance ?? 0) < 0 ? "text-destructive font-semibold" : "font-semibold"}>
                    {selected.wallet_balance !== null ? formatTHB(selected.wallet_balance) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("storePos.thisCharge", "This charge")}</span>
                  <span className="font-semibold">−{formatTHB(total)}</span>
                </div>
                <div className="border-t border-dashed border-border pt-1 flex justify-between">
                  <span className="font-medium">{t("storePos.balanceAfter", "Balance after")}</span>
                  <span className={balanceAfter !== null && balanceAfter < 0 ? "text-amber-600 font-bold" : "font-bold text-emerald-700"}>
                    {balanceAfter !== null ? formatTHB(balanceAfter) : "—"}
                  </span>
                </div>
                <p className="text-muted-foreground/70">{t("storePos.deptNegativeOk", "negative balance allowed")}</p>
              </div>
            )}
          </div>

          {/* Employee verification — tap card or type username */}
          <div className="space-y-1.5">
            <Label>{t("storePos.deptEmpVerify", "Verify employee (tap card or enter username)")}</Label>

            {verifiedEmployee ? (
              /* Verified employee card */
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-emerald-100 flex items-center justify-center">
                  <img
                    src={resolveAvatarUrl(verifiedEmployee.photo_url, verifiedEmployee.username || verifiedEmployee.full_name)}
                    alt={verifiedEmployee.full_name}
                    className="h-full w-full object-cover"
                    onError={(e) => { e.currentTarget.src = getFallbackAvatar(verifiedEmployee.username || verifiedEmployee.full_name); }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{verifiedEmployee.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    @{verifiedEmployee.username} · <span className="capitalize">{verifiedEmployee.role}</span>
                  </div>
                  {verifiedEmployee.department_name && (
                    <div className="text-[11px] text-rose-700 font-medium">
                      {verifiedEmployee.department_name}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className="gap-1 bg-emerald-100 text-emerald-800 text-[10px]">
                    <CheckCircle2 className="h-3 w-3" />
                    Verified
                  </Badge>
                  <button
                    type="button"
                    onClick={() => { setVerifiedEmployee(null); setEmpInput(""); }}
                    className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-0.5"
                  >
                    <X className="h-3 w-3" /> {t("storePos.change")}
                  </button>
                </div>
              </div>
            ) : (
              /* Lookup input */
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    ref={empInputRef}
                    value={empInput}
                    onChange={(e) => setEmpInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") lookupEmployee(empInput); }}
                    placeholder={t("storePos.deptEmpPlaceholder", "แตะบัตรพนักงาน หรือพิมพ์ username…")}
                    autoComplete="off"
                    disabled={empLoading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => lookupEmployee(empInput)}
                    disabled={empLoading || !empInput.trim()}
                    className="shrink-0"
                    title="Tap / Scan"
                  >
                    {empLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Nfc className="h-4 w-4" />}
                  </Button>
                </div>
                {empError && (
                  <p className="text-xs text-destructive">{empError}</p>
                )}
              </div>
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
