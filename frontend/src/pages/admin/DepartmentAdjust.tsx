import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Building2, ArrowDownCircle, ArrowUpCircle, History, Loader2 } from "lucide-react";

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
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_type?: string | null;
  reference_id?: number | null;
  description?: string | null;
  created_at: string;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

const QUICK_REASONS = [
  "เคลียร์บิลรายเดือน",
  "เติมเครดิตประจำเดือน",
  "ปรับยอดผิดพลาด",
  "คืนเครดิตพิเศษ",
];

export default function DepartmentAdjust() {
  const { t } = useTranslation();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [reason, setReason] = useState("");
  const [referenceTicket, setReferenceTicket] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  const loadDepartments = async () => {
    setLoading(true);
    try {
      const data = await api.get<Department[]>("/departments/?active_only=false");
      setDepartments(data);
      if (data.length > 0 && selectedId == null) setSelectedId(data[0].id);
    } catch (e) {
      toast({
        title: "โหลด departments ไม่สำเร็จ",
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async (deptId: number) => {
    setTxLoading(true);
    try {
      const res = await api.get<{ items: WalletTransaction[] }>(
        `/admin/departments/${deptId}/transactions?limit=20`,
      );
      setTransactions(res.items);
    } catch {
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => {
    loadDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId != null) loadTransactions(selectedId);
  }, [selectedId]);

  const selected = useMemo(
    () => departments.find((d) => d.id === selectedId) ?? null,
    [departments, selectedId],
  );

  const amountNum = parseFloat(amount) || 0;
  const signedAmount = direction === "credit" ? amountNum : -amountNum;
  const projectedBalance = (selected?.wallet_balance ?? 0) + signedAmount;
  const canSubmit =
    !!selected && amountNum > 0 && reason.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.post(`/admin/departments/${selected.id}/adjust`, {
        amount: signedAmount,
        reason: reason.trim(),
        reference_ticket: referenceTicket.trim() || undefined,
      });
      toast({
        title: "ปรับยอดสำเร็จ",
        description: `${selected.department_name} ${direction === "credit" ? "+" : "−"}${formatTHB(amountNum)}`,
      });
      setAmount("");
      setReason("");
      setReferenceTicket("");
      await loadDepartments();
      await loadTransactions(selected.id);
    } catch (e) {
      toast({
        title: "ปรับยอดไม่สำเร็จ",
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="max-w-6xl space-y-4">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Building2 className="h-6 w-6" /> {t("cardholders.deptAdjust.title")}
        </h1>
        <p className="page-description">
          {t("cardholders.deptAdjust.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Department picker */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">แผนก</CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-1">
            {loading && (
              <p className="text-center text-xs text-muted-foreground py-3">
                <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                กำลังโหลด
              </p>
            )}
            {!loading && departments.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-3">ไม่มีแผนก</p>
            )}
            {departments.map((d) => {
              const balance = Number(d.wallet_balance ?? 0);
              const isNeg = balance < 0;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left rounded-md p-2 transition ${
                    selectedId === d.id
                      ? "bg-primary/10 border-2 border-primary"
                      : "hover:bg-muted border-2 border-transparent"
                  }`}
                >
                  <div className="text-sm font-medium truncate">{d.department_name}</div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono text-[10px] text-muted-foreground">{d.department_code}</span>
                    <span className={`text-sm font-semibold tabular-nums ${isNeg ? "text-red-600" : "text-emerald-700"}`}>
                      {formatTHB(balance)}
                    </span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Adjust panel */}
        <div className="space-y-4">
          {selected ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{selected.department_name}</CardTitle>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{selected.department_code}</p>
                    </div>
                    <Badge variant={(selected.wallet_balance ?? 0) < 0 ? "destructive" : "secondary"}>
                      {formatTHB(Number(selected.wallet_balance ?? 0))}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDirection("credit")}
                      className={`flex items-center justify-center gap-2 rounded-md border-2 p-2.5 text-sm font-semibold transition ${
                        direction === "credit"
                          ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                          : "border-input bg-background text-muted-foreground"
                      }`}
                    >
                      <ArrowUpCircle className="h-4 w-4" />
                      Credit (+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirection("debit")}
                      className={`flex items-center justify-center gap-2 rounded-md border-2 p-2.5 text-sm font-semibold transition ${
                        direction === "debit"
                          ? "border-red-500 bg-red-50 text-red-900"
                          : "border-input bg-background text-muted-foreground"
                      }`}
                    >
                      <ArrowDownCircle className="h-4 w-4" />
                      Debit (−)
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="amount">จำนวน (THB)</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="text-lg tabular-nums"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reason">เหตุผล *</Label>
                    <Textarea
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="เช่น เคลียร์บิลเดือน เม.ย."
                      rows={2}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_REASONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setReason(r)}
                          className="text-xs rounded-full border bg-background px-2 py-0.5 hover:bg-muted"
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ref">Reference ticket (optional)</Label>
                    <Input
                      id="ref"
                      value={referenceTicket}
                      onChange={(e) => setReferenceTicket(e.target.value)}
                      placeholder="JIRA-123 / SLACK link"
                    />
                  </div>

                  {amountNum > 0 && (
                    <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ยอดปัจจุบัน</span>
                        <span className="tabular-nums">{formatTHB(Number(selected.wallet_balance ?? 0))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{direction === "credit" ? "เครดิต" : "หัก"}</span>
                        <span className={`tabular-nums ${direction === "credit" ? "text-emerald-700" : "text-red-700"}`}>
                          {direction === "credit" ? "+" : "−"}{formatTHB(amountNum)}
                        </span>
                      </div>
                      <div className="flex justify-between border-t pt-1 font-semibold">
                        <span>หลังปรับ</span>
                        <span className={`tabular-nums ${projectedBalance < 0 ? "text-red-600" : ""}`}>
                          {formatTHB(projectedBalance)}
                        </span>
                      </div>
                    </div>
                  )}

                  <Button onClick={submit} disabled={!canSubmit} className="w-full">
                    {submitting ? "กำลังบันทึก..." : "ยืนยันการปรับยอด"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" /> ประวัติรายการ
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>วันที่</TableHead>
                        <TableHead>ประเภท</TableHead>
                        <TableHead>คำอธิบาย</TableHead>
                        <TableHead className="text-right">จำนวน</TableHead>
                        <TableHead className="text-right">คงเหลือ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txLoading && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                            <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                            กำลังโหลด
                          </TableCell>
                        </TableRow>
                      )}
                      {!txLoading && transactions.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                            ยังไม่มีรายการ
                          </TableCell>
                        </TableRow>
                      )}
                      {transactions.map((tx) => {
                        const isCredit = tx.balance_after >= tx.balance_before;
                        return (
                          <TableRow key={tx.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(tx.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                            </TableCell>
                            <TableCell className="text-xs capitalize">{tx.transaction_type}</TableCell>
                            <TableCell className="text-xs max-w-xs truncate">{tx.description ?? "—"}</TableCell>
                            <TableCell className={`text-right tabular-nums text-sm font-semibold ${isCredit ? "text-emerald-700" : "text-red-700"}`}>
                              {isCredit ? "+" : "−"}{formatTHB(Math.abs(tx.amount))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm">
                              {formatTHB(tx.balance_after)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                เลือกแผนกจากแถบด้านซ้ายเพื่อเริ่มปรับยอด
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
