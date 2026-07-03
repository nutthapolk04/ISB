import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { exportToPDF, exportToExcel } from "@/lib/reportExport";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  ArrowRight,
  GraduationCap,
  Lock,
  Search,
  UserRound,
  Wallet as WalletIcon,
  ArrowLeftRight,
  CheckCircle2,
  Users,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  History,
} from "lucide-react";

// ── Transfer history types ────────────────────────────────────────────────────

interface TransferHistoryRow {
  id: number;
  created_at: string;
  from_name: string;
  from_code: string;
  to_name: string;
  to_code: string;
  amount: number;
  note: string | null;
  transferred_by: string;
}

interface TransferHistoryResponse {
  items: TransferHistoryRow[];
  total: number;
  page: number;
  pages: number;
}

const TX_COLUMNS = [
  { header: "Date / Time", key: "created_at",    format: "datetime" as const, width: 18 },
  { header: "From",        key: "from_name",     format: "text" as const,     width: 22 },
  { header: "From Code",   key: "from_code",     format: "text" as const,     width: 14 },
  { header: "To",          key: "to_name",       format: "text" as const,     width: 22 },
  { header: "To Code",     key: "to_code",       format: "text" as const,     width: 14 },
  { header: "Amount (฿)",  key: "amount",        format: "currency" as const, width: 14, align: "right" as const },
  { header: "Note",        key: "note",          format: "text" as const,     width: 24 },
  { header: "By",          key: "transferred_by",format: "text" as const,     width: 18 },
];

const formatDT = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const formatTHBTx = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

interface ParentInfo {
  user_id: number;
  username: string;
  full_name: string | null;
  role: string;
  photo_url: string | null;
  wallet_id: number;
  wallet_balance: number;
  is_active: boolean;
}

interface ChildSummary {
  link_id: number;
  relation: string;
  customer_id: number;
  customer_code: string;
  student_code?: string | null;
  name: string;
  grade?: string | null;
  photo_url?: string | null;
  allergies?: string | null;
  card_frozen: boolean;
  wallet_id?: number | null;
  wallet_balance?: number | null;
}

interface TransferTarget {
  child: ChildSummary;
  direction: "parent_to_child" | "child_to_parent";
}

interface ParentSummary {
  user_id: number;
  username: string;
  full_name: string | null;
  role: string;
  photo_url: string | null;
  wallet_id: number | null;
  wallet_balance: number | null;
  relation: string;
}

interface StudentFamilyContext {
  student_customer_id: number;
  parents: ParentSummary[];
  siblings: ChildSummary[];
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function WalletTransfer() {
  const { t } = useTranslation();
  const schoolInfo = useSchoolInfo();

  // ── Transfer history state ────────────────────────────────────────────────
  const [txHistory, setTxHistory] = useState<TransferHistoryRow[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txPage, setTxPage] = useState(1);
  const [txPages, setTxPages] = useState(1);
  const [txLoading, setTxLoading] = useState(false);
  const [txDateFrom, setTxDateFrom] = useState("");
  const [txDateTo, setTxDateTo] = useState("");

  const loadHistory = async (page = 1) => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "20" });
      if (txDateFrom) params.set("date_from", txDateFrom);
      if (txDateTo) params.set("date_to", txDateTo);
      const data = await api.get<TransferHistoryResponse>(
        `/wallets/admin/transfer-report?${params.toString()}`
      );
      setTxHistory(data.items);
      setTxTotal(data.total);
      setTxPage(data.page);
      setTxPages(data.pages);
    } catch {
      /* silently ignore — not critical */
    } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => { loadHistory(1); }, []);

  const handleTxExcel = () => {
    const today = new Date().toISOString().slice(0, 10);
    exportToExcel(
      { meta: { title: "Wallet Transfer Report", schoolName: schoolInfo?.name ?? "ISB", filters: [`All transfers — page ${txPage}`] }, columns: TX_COLUMNS, rows: txHistory.map((r) => ({ ...r, note: r.note ?? "" })), totals: { from_name: `${txTotal} records`, amount: txHistory.reduce((s, r) => s + r.amount, 0) } },
      `WalletTransfers_${today}`,
    );
  };

  const handleTxPdf = () => {
    const today = new Date().toISOString().slice(0, 10);
    exportToPDF(
      { meta: { title: "Wallet Transfer Report", schoolName: schoolInfo?.name ?? "ISB", schoolLogoUrl: schoolInfo?.logoUrl || undefined, filters: [`All transfers — page ${txPage}`] }, columns: TX_COLUMNS, rows: txHistory.map((r) => ({ ...r, note: r.note ?? "" })), totals: { from_name: `${txTotal} records`, amount: txHistory.reduce((s, r) => s + r.amount, 0) } },
      `WalletTransfers_${today}.pdf`,
    );
  };

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Loaded parent data
  const [parent, setParent] = useState<ParentInfo | null>(null);
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(false);

  // Student family context (when found user is a student)
  const [studentContext, setStudentContext] = useState<StudentFamilyContext | null>(null);

  // When searching by student and clicking a parent, we snapshot the student
  // so we can build a ChildSummary for them in the transfer panel.
  const [studentSnapshot, setStudentSnapshot] = useState<ParentInfo | null>(null);

  // Transfer panel state
  const [target, setTarget] = useState<TransferTarget | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [transferring, setTransferring] = useState(false);

  const handleSearch = async () => {
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setParent(null);
    setChildren([]);
    setTarget(null);
    setStudentContext(null);
    setStudentSnapshot(null);
    try {
      const p = await api.get<ParentInfo>(`/users/by-username/${encodeURIComponent(q)}`);
      setParent(p);

      if (p.role === "student") {
        // Student: fetch parent(s) + siblings
        setLoadingChildren(true);
        try {
          const ctx = await api.get<StudentFamilyContext>(`/family/context/${encodeURIComponent(q)}`);
          setStudentContext(ctx);
        } catch {
          // No family linked — fine, just show empty
        } finally {
          setLoadingChildren(false);
        }
      } else {
        // Parent/staff: fetch their children
        setLoadingChildren(true);
        try {
          const { children: ch } = await api.get<{ children: ChildSummary[]; coparents: unknown[] }>(`/family/by-user/${p.user_id}`);
          setChildren(ch);
        } finally {
          setLoadingChildren(false);
        }
      }
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.detail : t("admin.walletTransfer.lookupFailed"));
    } finally {
      setSearching(false);
    }
  };

  // Called when admin finds a student and clicks one of the linked parents.
  // Swaps "parent" state to the clicked parent and builds a ChildSummary for
  // the student so the existing transfer panel works without any other changes.
  const handleSelectParentFromStudentView = (par: ParentSummary) => {
    if (!par.wallet_id || !parent) return;
    setStudentSnapshot(parent); // keep student data for display
    const studentChild: ChildSummary = {
      link_id: 0,
      relation: "student",
      customer_id: studentContext?.student_customer_id ?? 0,
      customer_code: parent.username,
      student_code: parent.username,
      name: parent.full_name ?? parent.username,
      photo_url: parent.photo_url,
      card_frozen: false,
      wallet_id: parent.wallet_id,
      wallet_balance: parent.wallet_balance,
    };
    setParent({
      user_id: par.user_id,
      username: par.username,
      full_name: par.full_name,
      role: par.role,
      photo_url: par.photo_url,
      wallet_id: par.wallet_id!,
      wallet_balance: par.wallet_balance ?? 0,
      is_active: true,
    });
    setStudentContext(null);
    setTarget({ child: studentChild, direction: "parent_to_child" });
    setAmount("");
    setNote("");
  };

  const handleTransfer = async () => {
    if (!parent || !target || !target.child.wallet_id) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;

    const fromWalletId =
      target.direction === "parent_to_child" ? parent.wallet_id : target.child.wallet_id;
    const toWalletId =
      target.direction === "parent_to_child" ? target.child.wallet_id : parent.wallet_id;

    setTransferring(true);
    try {
      await api.post("/wallets/transfer", {
        from_wallet_id: fromWalletId,
        to_wallet_id: toWalletId,
        amount: amt,
        note: note.trim() || undefined,
      });

      toast({
        title: t("admin.walletTransfer.success"),
        description: t("admin.walletTransfer.successDesc", {
          amount: formatTHB(amt),
          from:
            target.direction === "parent_to_child"
              ? (parent.full_name ?? parent.username)
              : target.child.name,
          to:
            target.direction === "parent_to_child"
              ? target.child.name
              : (parent.full_name ?? parent.username),
        }),
      });

      // Re-fetch updated balances
      const [updatedParent, updatedChildren] = await Promise.all([
        api.get<ParentInfo>(`/users/by-username/${encodeURIComponent(parent.username)}`),
        api.get<{ children: ChildSummary[]; coparents: unknown[] }>(`/family/by-user/${parent.user_id}`),
      ]);
      setParent(updatedParent);
      setChildren(updatedChildren.children);
      setTarget(null);
      setAmount("");
      setNote("");
    } catch (e) {
      toast({
        title: t("admin.walletTransfer.failed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setTransferring(false);
    }
  };

  const amt = parseFloat(amount) || 0;
  const fromBalance =
    target?.direction === "parent_to_child"
      ? parent?.wallet_balance ?? 0
      : target?.child.wallet_balance ?? 0;
  const toBalance =
    target?.direction === "parent_to_child"
      ? target?.child.wallet_balance ?? 0
      : parent?.wallet_balance ?? 0;
  const willGoNegative = fromBalance - amt < 0;
  const canTransfer =
    target !== null &&
    target.child.wallet_id != null &&
    amt > 0 &&
    !transferring;

  return (
    <div className="page-shell">
      <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6" />
          {t("admin.walletTransfer.title")}
        </h1>
        <p className="page-description">
          {t("admin.walletTransfer.description")}
        </p>
      </div>

      {/* Search */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("admin.walletTransfer.searchTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder={t("admin.walletTransfer.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={searching || !searchInput.trim()}>
              <Search className="h-4 w-4 mr-1" />
              {searching ? t("admin.walletTransfer.searching") : t("admin.walletTransfer.search")}
            </Button>
          </div>
          {searchError && (
            <p className="mt-2 text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {searchError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Student context banner — shown after selecting a parent from student view */}
      {studentSnapshot && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex items-center gap-3 text-sm">
          <GraduationCap className="h-4 w-4 text-primary shrink-0" />
          <span className="text-muted-foreground">
            {t("admin.walletTransfer.transferringForStudent", "Transferring for student")}:{" "}
            <span className="font-medium text-foreground">{studentSnapshot.full_name ?? studentSnapshot.username}</span>
          </span>
        </div>
      )}

      {/* Parent info card */}
      {parent && (
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <img
                src={resolveAvatarUrl(parent.photo_url, parent.username || parent.full_name)}
                alt={parent.full_name ?? parent.username}
                className="h-14 w-14 shrink-0 rounded-full object-cover border-2 border-amber-300"
                onError={(e) => { e.currentTarget.src = getFallbackAvatar(parent.username || parent.full_name); }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-lg truncate">
                  {parent.full_name ?? parent.username}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <Badge variant="outline" className="text-xs font-mono bg-white">
                    {parent.username}
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-900 capitalize">
                    {parent.role}
                  </Badge>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">{t("admin.walletTransfer.balance")}</p>
                <p className="text-xl font-bold text-amber-900">{formatTHB(parent.wallet_balance)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Student family context */}
      {parent?.role === "student" && (
        <div className="space-y-4">
          {loadingChildren && (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          )}

          {!loadingChildren && studentContext && (
            <>
              {/* Parents */}
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5" />
                  {t("admin.walletTransfer.studentParents", "ผู้ปกครอง")}
                </h2>
                {studentContext.parents.length === 0 ? (
                  <Card>
                    <CardContent className="py-4 text-center text-muted-foreground text-sm">
                      {t("admin.walletTransfer.noParents", "ไม่มีผู้ปกครองที่เชื่อมกับบัญชีนี้")}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {studentContext.parents.map((par) => (
                      <Card
                        key={par.user_id}
                        className={`border-amber-200 bg-amber-50/50 transition-all ${
                          par.wallet_id
                            ? "cursor-pointer hover:ring-2 hover:ring-amber-400 hover:border-amber-400"
                            : "opacity-60"
                        }`}
                        onClick={() => par.wallet_id && handleSelectParentFromStudentView(par)}
                      >
                        <CardContent className="pt-3 pb-3">
                          <div className="flex items-center gap-3">
                            <img
                              src={resolveAvatarUrl(par.photo_url, par.username || par.full_name)}
                              alt={par.full_name ?? par.username}
                              className="h-10 w-10 shrink-0 rounded-full object-cover border-2 border-amber-300"
                              onError={(e) => { e.currentTarget.src = getFallbackAvatar(par.username || par.full_name); }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{par.full_name ?? par.username}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <Badge variant="outline" className="text-xs font-mono bg-white">{par.username}</Badge>
                                <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-900 capitalize">{par.relation}</Badge>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs text-muted-foreground">{t("admin.walletTransfer.balance")}</p>
                              <p className="font-bold text-sm text-amber-900">
                                {par.wallet_balance != null ? formatTHB(par.wallet_balance) : "—"}
                              </p>
                              {par.wallet_id && (
                                <p className="text-[10px] text-amber-600 mt-0.5">
                                  {t("admin.walletTransfer.tapToTransfer", "Tap to transfer")}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Siblings */}
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {t("admin.walletTransfer.studentSiblings", "พี่น้อง")}
                </h2>
                {studentContext.siblings.length === 0 ? (
                  <Card>
                    <CardContent className="py-4 text-center text-muted-foreground text-sm">
                      {t("admin.walletTransfer.noSiblings", "ไม่มีพี่น้องที่เชื่อมกับครอบครัวนี้")}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {studentContext.siblings.map((sib) => (
                      <Card key={sib.customer_id} className="border-muted">
                        <CardContent className="pt-3 pb-3">
                          <div className="flex items-center gap-3">
                            <img
                              src={resolveAvatarUrl(sib.photo_url, sib.name || String(sib.customer_id))}
                              alt={sib.name}
                              className="h-10 w-10 shrink-0 rounded-full object-cover border border-primary/20"
                              onError={(e) => { e.currentTarget.src = getFallbackAvatar(sib.name || String(sib.customer_id)); }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{sib.name}</p>
                              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                {sib.student_code && (
                                  <Badge variant="secondary" className="text-xs">{sib.student_code}</Badge>
                                )}
                                {sib.grade && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                    <GraduationCap className="h-3 w-3" />{sib.grade}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs text-muted-foreground">{t("admin.walletTransfer.balance")}</p>
                              <p className="font-bold text-sm">
                                {sib.wallet_balance != null ? formatTHB(sib.wallet_balance) : "—"}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Children */}
      {parent && parent.role !== "student" && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {t("admin.walletTransfer.linkedChildren")}
          </h2>

          {loadingChildren && (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          )}

          {!loadingChildren && children.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground text-sm">
                {t("admin.walletTransfer.noChildren")}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {children.map((child) => {
              const isSelected = target?.child.customer_id === child.customer_id;
              return (
                <Card
                  key={child.customer_id}
                  className={`cursor-pointer transition-all ${
                    isSelected
                      ? "ring-2 ring-primary border-primary"
                      : "hover:border-primary/40"
                  }`}
                  onClick={() => {
                    if (isSelected) {
                      setTarget(null);
                    } else {
                      setTarget({ child, direction: "parent_to_child" });
                      setAmount("");
                      setNote("");
                    }
                  }}
                >
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start gap-3">
                      <img
                        src={resolveAvatarUrl(child.photo_url, child.name || String(child.customer_id))}
                        alt={child.name}
                        className="h-10 w-10 shrink-0 rounded-full object-cover border border-primary/20"
                        onError={(e) => { e.currentTarget.src = getFallbackAvatar(child.name || String(child.customer_id)); }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{child.name}</p>
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          {child.student_code && (
                            <Badge variant="secondary" className="text-xs">{child.student_code}</Badge>
                          )}
                          {child.grade && (
                            <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                              <GraduationCap className="h-3 w-3" />{child.grade}
                            </span>
                          )}
                          {child.card_frozen && (
                            <Badge variant="destructive" className="text-xs gap-0.5">
                              <Lock className="h-3 w-3" /> Frozen
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">{t("admin.walletTransfer.balance")}</p>
                        <p className="font-bold text-sm">
                          {child.wallet_balance != null ? formatTHB(child.wallet_balance) : "—"}
                        </p>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("admin.walletTransfer.selected")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Transfer panel */}
      {target && parent && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              {t("admin.walletTransfer.transferTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Direction toggle */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={target.direction === "parent_to_child" ? "default" : "outline"}
                className="h-auto py-2 px-3 flex flex-col items-start gap-0.5 text-left"
                onClick={() => setTarget({ ...target, direction: "parent_to_child" })}
              >
                <span className="text-xs opacity-70">{t("admin.walletTransfer.from")}</span>
                <span className="font-medium text-sm truncate w-full">
                  {parent.full_name ?? parent.username}
                </span>
                <ArrowRight className="h-3.5 w-3.5 self-center opacity-60" />
                <span className="text-xs opacity-70">{t("admin.walletTransfer.to")}</span>
                <span className="font-medium text-sm truncate w-full">{target.child.name}</span>
              </Button>
              <Button
                variant={target.direction === "child_to_parent" ? "default" : "outline"}
                className="h-auto py-2 px-3 flex flex-col items-start gap-0.5 text-left"
                onClick={() => setTarget({ ...target, direction: "child_to_parent" })}
              >
                <span className="text-xs opacity-70">{t("admin.walletTransfer.from")}</span>
                <span className="font-medium text-sm truncate w-full">{target.child.name}</span>
                <ArrowRight className="h-3.5 w-3.5 self-center opacity-60" />
                <span className="text-xs opacity-70">{t("admin.walletTransfer.to")}</span>
                <span className="font-medium text-sm truncate w-full">
                  {parent.full_name ?? parent.username}
                </span>
              </Button>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label>{t("admin.walletTransfer.amountLabel")}</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100.00"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {[500, 1000, 2000, 5000, 10000, 20000, 50000].map((v) => (
                  <Button
                    key={v}
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(String(v))}
                    className="h-8 tabular-nums"
                  >
                    ฿{v.toLocaleString()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label>{t("admin.walletTransfer.noteLabel")}</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("admin.walletTransfer.notePlaceholder")}
              />
            </div>

            {/* Preview */}
            {amt > 0 && (
              <div className="rounded-md bg-muted p-3 space-y-2 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("admin.walletTransfer.preview")}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {target.direction === "parent_to_child"
                      ? (parent.full_name ?? parent.username)
                      : target.child.name}
                  </span>
                  <span className="font-mono">
                    {formatTHB(fromBalance)} →{" "}
                    <span className={willGoNegative ? "text-destructive font-semibold" : "font-semibold"}>
                      {formatTHB(fromBalance - amt)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {target.direction === "parent_to_child"
                      ? target.child.name
                      : (parent.full_name ?? parent.username)}
                  </span>
                  <span className="font-mono">
                    {formatTHB(toBalance)} →{" "}
                    <span className="font-semibold text-green-600">{formatTHB(toBalance + amt)}</span>
                  </span>
                </div>
                {willGoNegative && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {t("admin.walletTransfer.negativeWarning")}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="outline"
                onClick={() => { setTarget(null); setAmount(""); setNote(""); }}
                disabled={transferring}
              >
                {t("admin.walletTransfer.cancel")}
              </Button>
              <Button
                onClick={handleTransfer}
                disabled={!canTransfer}
              >
                <WalletIcon className="h-4 w-4 mr-1" />
                {transferring ? t("admin.walletTransfer.transferring") : t("admin.walletTransfer.confirm")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {/* ── Transfer History ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("admin.walletTransfer.historyTitle", "Transfer History")}
            {txTotal > 0 && <span className="text-sm text-muted-foreground font-normal">({txTotal} total)</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm">{t("adjustmentReport.dateFrom", "From")}</Label>
            <Input type="date" value={txDateFrom} onChange={(e) => setTxDateFrom(e.target.value)} className="w-36 h-8 text-sm" />
            <Label className="text-sm">{t("adjustmentReport.dateTo", "To")}</Label>
            <Input type="date" value={txDateTo} onChange={(e) => setTxDateTo(e.target.value)} className="w-36 h-8 text-sm" />
            <Button size="sm" onClick={() => loadHistory(1)} disabled={txLoading} className="gap-1.5 h-8">
              <Search className="h-3.5 w-3.5" />
              {txLoading ? "…" : t("adjustmentReport.search", "Search")}
            </Button>
            {txHistory.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={handleTxExcel} className="gap-1.5 h-8">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-green-700" />Excel
                </Button>
                <Button variant="outline" size="sm" onClick={handleTxPdf} className="gap-1.5 h-8">
                  <FileText className="h-3.5 w-3.5 text-red-600" />PDF
                </Button>
              </>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {txLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : txHistory.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("admin.walletTransfer.noHistory", "No transfers yet.")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Date / Time</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txHistory.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap text-xs font-mono">{formatDT(tx.created_at)}</TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{tx.from_name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{tx.from_code}</p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{tx.to_name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{tx.to_code}</p>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-green-700">
                          {formatTHBTx(tx.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                          {tx.note || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{tx.transferred_by}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {txPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {txPage} of {txPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => { loadHistory(txPage - 1); }} disabled={txPage === 1}>
                    <ChevronLeft className="h-4 w-4" />{t("common.prev", "Prev")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { loadHistory(txPage + 1); }} disabled={txPage === txPages}>
                    {t("common.next", "Next")}<ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
