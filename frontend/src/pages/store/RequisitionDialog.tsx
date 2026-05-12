import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import UserPicker from "@/components/UserPicker";
import type { DepartmentOption } from "./DepartmentPaymentModal";

interface RequisitionTarget {
  id: number;
  name: string;
  stock: number;
  shopId: string;
}

interface Props {
  target: RequisitionTarget | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type PayMode = "free" | "department" | "wallet";

export default function RequisitionDialog({ target, onOpenChange, onSuccess }: Props) {
  const { t } = useTranslation();
  const open = !!target;

  const [qty, setQty] = useState("1");
  const [requesterId, setRequesterId] = useState<number | null>(null);
  const [payMode, setPayMode] = useState<PayMode>("free");
  const [deptId, setDeptId] = useState<number | null>(null);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQty("1");
      setRequesterId(null);
      setPayMode("free");
      setDeptId(null);
      setNotes("");
      api
        .get<DepartmentOption[]>("/departments/")
        .then(setDepartments)
        .catch(() => setDepartments([]));
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!target) return;
    const parsedQty = parseInt(qty, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      toast.error(t("requisition.errorQty", "Quantity must be greater than 0"));
      return;
    }
    if (!requesterId) {
      toast.error(t("requisition.errorRequester", "Please select a requester"));
      return;
    }
    if (payMode === "department" && !deptId) {
      toast.error(t("requisition.errorDept", "Please select a department"));
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/shops/${target.shopId}/requisition`, {
        items: [{ product_id: target.id, qty: parsedQty }],
        requester_user_id: requesterId,
        pay_mode: payMode,
        payer_department_id: payMode === "department" ? deptId : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(t("requisition.success", "Requisition recorded"));
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      const detail = err instanceof ApiError ? err.detail : err?.message || "Failed";
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("requisition.title", "Issue to staff")}</DialogTitle>
          <DialogDescription>
            {target?.name} — {t("requisition.currentStock", "Current stock")}: {target?.stock}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t("requisition.qty", "Quantity")} *</Label>
            <Input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <Label>{t("requisition.requester", "Requester")} *</Label>
            <UserPicker value={requesterId} onChange={(id) => setRequesterId(id)} />
          </div>

          <div>
            <Label>{t("requisition.payMode", "Payment mode")} *</Label>
            <Select value={payMode} onValueChange={(v) => setPayMode(v as PayMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">{t("requisition.payFree", "Free (stock-only audit)")}</SelectItem>
                <SelectItem value="department">{t("requisition.payDept", "Charge department")}</SelectItem>
                <SelectItem value="wallet">{t("requisition.payWallet", "Charge requester wallet")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {payMode === "department" && (
            <div>
              <Label>{t("requisition.dept", "Department")} *</Label>
              <Select
                value={deptId ? String(deptId) : ""}
                onValueChange={(v) => setDeptId(parseInt(v, 10))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("requisition.selectDept", "Select department")} />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.department_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>{t("requisition.notes", "Notes")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("requisition.notesPlaceholder", "Reason / context (optional)")}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("requisition.cancel", "Cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t("requisition.submitting", "Submitting…") : t("requisition.submit", "Issue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
