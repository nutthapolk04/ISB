import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import type { StudentOption } from "./userDetailTypes";

interface LinkStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  userFullName: string;
  onLinked: () => void;
}

export function LinkStudentDialog({ open, onOpenChange, userId, userFullName, onLinked }: LinkStudentDialogProps) {
  const { t } = useTranslation();
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentQ, setStudentQ] = useState("");
  const [studentId, setStudentId] = useState<string>("");
  const [relation, setRelation] = useState("guardian");
  const [parentRank, setParentRank] = useState<string>("main");
  const [linking, setLinking] = useState(false);

  const loadStudents = async () => {
    try {
      const qs = studentQ.trim() ? `?q=${encodeURIComponent(studentQ.trim())}` : "";
      const data = await api.get<StudentOption[]>(`/users-admin/students${qs}`);
      setStudentOptions(data);
    } catch {
      /* ignore */
    }
  };

  const debouncedStudentQ = useDebounce(studentQ, 250);
  useEffect(() => {
    if (!open) return;
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedStudentQ, open]);

  const linkStudent = async () => {
    if (!studentId) return;
    setLinking(true);
    try {
      await api.post(`/users-admin/${userId}/link-student`, {
        child_customer_id: Number(studentId),
        relation,
        parent_rank: parentRank || null,
      });
      toast({ title: t("admin.users.linkSuccess") });
      onOpenChange(false);
      setStudentId("");
      setStudentQ("");
      onLinked();
    } catch (e) {
      toast({
        title: t("admin.users.linkError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.users.linkStudentTitle", { name: userFullName })}</DialogTitle>
          <DialogDescription>
            {t("admin.users.linkStudentDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("admin.users.searchStudent")}</Label>
            <Input
              placeholder={t("admin.users.searchStudentPlaceholder")}
              value={studentQ}
              onChange={(e) => setStudentQ(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("admin.users.student")}</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {studentOptions.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} {s.student_code && `(${s.student_code})`} {s.grade && `— ${s.grade}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("admin.users.relation")}</Label>
              <Select value={relation} onValueChange={setRelation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="father">father</SelectItem>
                  <SelectItem value="mother">mother</SelectItem>
                  <SelectItem value="guardian">guardian</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.users.parentRank")}</Label>
              <Select value={parentRank} onValueChange={setParentRank}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">main</SelectItem>
                  <SelectItem value="secondary">secondary</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={linking}>
            <X className="h-4 w-4 mr-1" /> {t("admin.users.cancel")}
          </Button>
          <Button onClick={linkStudent} disabled={linking || !studentId}>
            {linking ? t("admin.users.saving") : t("admin.families.createLink")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
