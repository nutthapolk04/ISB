import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Building2, Pencil, Loader2, History, Wallet } from "lucide-react";

interface Department {
  id: number;
  department_code: string;
  department_name: string;
  is_active: boolean;
  wallet_id: number | null;
  wallet_balance: number | null;
}

interface WalletTransaction {
  id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description?: string | null;
  created_at: string;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function DepartmentDetail() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "th-TH";
  const { departmentId } = useParams<{ departmentId: string }>();
  const navigate = useNavigate();

  const [dept, setDept] = useState<Department | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editBusy, setEditBusy] = useState(false);

  async function load() {
    if (!departmentId) return;
    setLoading(true);
    try {
      const list = await api.get<Department[]>("/departments/?active_only=false");
      const found = list.find((d) => d.id === Number(departmentId));
      if (!found) {
        toast({ title: "Department not found", variant: "destructive" });
        navigate("/users?kind=department");
        return;
      }
      setDept(found);
      loadTransactions(found.id);
    } catch (e) {
      toast({ title: "Failed to load department", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadTransactions(id: number) {
    setTxLoading(true);
    try {
      const res = await api.get<{ items: WalletTransaction[] }>(
        `/admin/departments/${id}/transactions?limit=20`,
      );
      setTransactions(res.items ?? []);
    } catch {
      // non-critical
    } finally {
      setTxLoading(false);
    }
  }

  useEffect(() => { load(); }, [departmentId]);

  function openEdit() {
    if (!dept) return;
    setEditName(dept.department_name);
    setEditActive(dept.is_active);
    setEditOpen(true);
  }

  async function handleEditSave() {
    if (!dept) return;
    setEditBusy(true);
    try {
      const updated = await api.patch<Department>(
        `/admin/departments/${dept.id}`,
        { department_name: editName, is_active: editActive },
      );
      setDept(updated);
      setEditOpen(false);
      toast({ title: t("common.saved", "Saved") });
    } catch (e) {
      toast({
        title: t("common.error", "Error"),
        description: e instanceof ApiError ? e.detail : String(e),
        variant: "destructive",
      });
    } finally {
      setEditBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dept) return null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 py-6">
      {/* Back */}
      <Button variant="ghost" size="sm" className="gap-1 -ml-2" onClick={() => navigate("/users?kind=department")}>
        <ArrowLeft className="h-4 w-4" />
        {t("common.back", "Back")}
      </Button>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-100 text-purple-700 shrink-0">
          <Building2 className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{dept.department_name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant="outline" className="bg-purple-50 text-purple-800 border-purple-200">
              {t("cardholders.kindDepartment", "Department")}
            </Badge>
            <Badge variant={dept.is_active ? "default" : "secondary"}>
              {dept.is_active ? t("common.active", "Active") : t("common.inactive", "Inactive")}
            </Badge>
            <span className="text-sm text-muted-foreground font-mono">{dept.department_code}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Profile */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{t("userDetail.profile", "Profile")}</CardTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground text-xs">{t("cardholders.deptCode", "Department Code")}</p>
                <p className="font-mono mt-0.5">{dept.department_code}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t("common.status", "Status")}</p>
                <Badge variant={dept.is_active ? "default" : "secondary"} className="mt-0.5">
                  {dept.is_active ? t("common.active", "Active") : t("common.inactive", "Inactive")}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t("cardholders.deptName", "Department Name")}</p>
              <p className="mt-0.5">{dept.department_name}</p>
            </div>
          </CardContent>
        </Card>

        {/* Wallet */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              {t("cardholders.wallet", "Wallet")}
            </CardTitle>
            <Link to={`/admin/department-adjust?id=${dept.id}`}>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                {t("cardholders.walletAdjust", "Wallet Adjust")}
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="text-sm">
            <div>
              <p className="text-muted-foreground text-xs">{t("cardholders.walletBalance", "Balance")}</p>
              <p className={`text-2xl font-bold mt-1 ${Number(dept.wallet_balance ?? 0) < 0 ? "text-rose-600" : ""}`}>
                {formatTHB(Number(dept.wallet_balance ?? 0))}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transaction history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("cardholders.deptAdjust.txHistory", "Transaction History")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {txLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">
              {t("cardholders.deptAdjust.noTx", "No transactions yet")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.date", "Date")}</TableHead>
                  <TableHead>{t("reports.type", "Type")}</TableHead>
                  <TableHead>{t("reports.description", "Description")}</TableHead>
                  <TableHead className="text-right">{t("reports.amount", "Amount")}</TableHead>
                  <TableHead className="text-right">{t("reports.balance", "Balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {fmtDateTime(tx.created_at, locale)}
                    </TableCell>
                    <TableCell className="text-xs">{tx.transaction_type}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{tx.description ?? "—"}</TableCell>
                    <TableCell className={`text-right text-xs font-medium ${Number(tx.amount) >= 0 ? "text-green-700" : "text-rose-600"}`}>
                      {Number(tx.amount) >= 0 ? "+" : ""}{formatTHB(Number(tx.amount))}
                    </TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(Number(tx.balance_after))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("cardholders.editDept", "Edit Department")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("cardholders.deptName", "Department Name")}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <Label>{t("common.active", "Active")}</Label>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("common.cancel", "Cancel")}</Button>
            <Button onClick={handleEditSave} disabled={editBusy || !editName.trim()}>
              {editBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
