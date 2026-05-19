import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { toast } from "@/hooks/use-toast";
import {
  Lock, Plus, Search, Trash2, Unlock, Users, UserCircle2, Eye, ChevronDown, ChevronUp,
  ArrowUp, ArrowDown, ArrowUpDown, Loader2,
} from "lucide-react";

interface LinkRow {
  id: number;
  parent_user_id: number;
  parent_username?: string | null;
  parent_full_name?: string | null;
  child_customer_id: number;
  child_name?: string | null;
  child_student_code?: string | null;
  relation: string;
}

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email?: string | null;
  role?: string | null;
  is_superuser?: boolean;
  family_code?: string | null;
  external_id?: string | null;
  customer_type?: string | null;
}

interface StudentRow {
  id: number;
  name: string;
  student_code?: string | null;
  customer_code: string;
  grade?: string | null;
  card_frozen?: boolean;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  photo_url?: string | null;
  family_code?: string | null;
  external_id?: string | null;
}

interface OrphanParent {
  user_id: number;
  username: string;
  full_name: string;
  email?: string | null;
  family_code?: string | null;
  external_id?: string | null;
  customer_type?: string | null;
}

interface OrphanStudent {
  customer_id: number;
  customer_code: string;
  student_code?: string | null;
  name: string;
  grade?: string | null;
  family_code?: string | null;
  external_id?: string | null;
}

interface OrphansResponse {
  parents_no_children: OrphanParent[];
  students_no_parents: OrphanStudent[];
}

interface FamilyChild {
  linkId: number;
  customerId: number;
  name: string;
  studentCode?: string | null;
  grade?: string | null;
  relation: string;
  walletId?: number | null;
  walletBalance: number;
  cardFrozen: boolean;
  photoUrl?: string | null;
}

interface FamilyGroup {
  parentId: number;
  parentUsername: string;
  parentName: string;
  children: FamilyChild[];
  totalBalance: number;
  frozenCount: number;
}

interface TxRow {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description?: string | null;
  shop_name?: string | null;
  created_at: string;
}

type StatusFilter = "all" | "normal" | "all_frozen" | "partial";
type SortKey = "name" | "children" | "balance";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

function familyStatus(f: FamilyGroup): StatusFilter {
  if (f.children.length === 0) return "normal";
  if (f.frozenCount === 0) return "normal";
  if (f.frozenCount === f.children.length) return "all_frozen";
  return "partial";
}

export default function FamilyLinks() {
  const { t } = useTranslation();
  const [orphans, setOrphans] = useState<OrphansResponse>({ parents_no_children: [], students_no_parents: [] });
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [parents, setParents] = useState<UserRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  // Add-link dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parentId, setParentId] = useState<string>("");
  const [childId, setChildId] = useState<string>("");
  const [relation, setRelation] = useState<string>("guardian");
  const [creating, setCreating] = useState(false);

  // Bulk freeze
  const [freezingParent, setFreezingParent] = useState<number | null>(null);

  // Detail drawer
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [expandedChild, setExpandedChild] = useState<number | null>(null);
  const [childTxs, setChildTxs] = useState<Record<number, TxRow[]>>({});
  const [loadingTxs, setLoadingTxs] = useState<number | null>(null);
  const [freezingChild, setFreezingChild] = useState<number | null>(null);

  const load = async () => {
    try {
      const [l, u, s, orphansData] = await Promise.all([
        api.get<LinkRow[]>("/family/links"),
        api.get<UserRow[]>("/users-admin/?role=parent"),
        api.get<StudentRow[]>("/customers/"),
        api.get<OrphansResponse>("/family/orphans").catch(() => ({ parents_no_children: [], students_no_parents: [] })),
      ]);
      setLinks(l);
      setParents(u);
      setStudents(s);
      setOrphans(orphansData);
    } catch (e) {
      toast({
        title: t("admin.families.loadError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const studentById = useMemo(() => {
    const map = new Map<number, StudentRow>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  const families: FamilyGroup[] = useMemo(() => {
    const map = new Map<number, FamilyGroup>();
    for (const l of links) {
      if (!map.has(l.parent_user_id)) {
        map.set(l.parent_user_id, {
          parentId: l.parent_user_id,
          parentUsername: l.parent_username || "",
          parentName: l.parent_full_name || l.parent_username || `user#${l.parent_user_id}`,
          children: [],
          totalBalance: 0,
          frozenCount: 0,
        });
      }
      const group = map.get(l.parent_user_id)!;
      const s = studentById.get(l.child_customer_id);
      const balance = s?.wallet_balance ?? 0;
      const frozen = !!s?.card_frozen;
      group.children.push({
        linkId: l.id,
        customerId: l.child_customer_id,
        name: l.child_name || s?.name || `#${l.child_customer_id}`,
        studentCode: l.child_student_code ?? s?.student_code,
        grade: s?.grade,
        relation: l.relation,
        walletId: s?.wallet_id ?? null,
        walletBalance: balance,
        cardFrozen: frozen,
        photoUrl: s?.photo_url,
      });
      group.totalBalance += balance;
      if (frozen) group.frozenCount += 1;
    }
    return Array.from(map.values());
  }, [links, studentById]);

  const filteredFamilies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return families.filter((f) => {
      if (q) {
        const match =
          f.parentName.toLowerCase().includes(q) ||
          f.parentUsername.toLowerCase().includes(q) ||
          f.children.some((c) =>
            c.name.toLowerCase().includes(q) ||
            (c.studentCode || "").toLowerCase().includes(q),
          );
        if (!match) return false;
      }
      if (statusFilter !== "all" && familyStatus(f) !== statusFilter) return false;
      return true;
    });
  }, [families, search, statusFilter]);

  const sortedFamilies = useMemo(() => {
    const arr = [...filteredFamilies];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === "children") return (a.children.length - b.children.length) * dir;
      if (sortKey === "balance") return (a.totalBalance - b.totalBalance) * dir;
      return a.parentName.localeCompare(b.parentName) * dir;
    });
    return arr;
  }, [filteredFamilies, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedFamilies.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedFamilies = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedFamilies.slice(start, start + pageSize);
  }, [sortedFamilies, currentPage, pageSize]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize, sortKey, sortDir]);

  const selectedFamily = useMemo(
    () => families.find((f) => f.parentId === selectedParentId) ?? null,
    [families, selectedParentId],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "balance" || key === "children" ? "desc" : "asc");
    }
  };

  const handleCreate = async () => {
    if (!parentId || !childId) {
      toast({ title: t("admin.families.selectParentChild"), variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await api.post("/family/links", {
        parent_user_id: parseInt(parentId),
        child_customer_id: parseInt(childId),
        relation: relation || "guardian",
      });
      toast({ title: t("admin.families.linkSuccess") });
      setDialogOpen(false);
      setParentId("");
      setChildId("");
      setRelation("guardian");
      load();
    } catch (e) {
      toast({
        title: t("admin.families.linkError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t("admin.families.confirmDeleteTitle"))) return;
    try {
      await api.delete(`/family/links/${id}`);
      toast({ title: t("admin.families.deleteSuccess") });
      load();
    } catch (e) {
      toast({
        title: t("admin.families.deleteError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleToggleFamilyFreeze = async (family: FamilyGroup, freeze: boolean) => {
    const confirmMsg = freeze
      ? t("admin.families.freezeAllConfirm", { name: family.parentName })
      : t("admin.families.unfreezeAllConfirm", { name: family.parentName });
    if (!window.confirm(confirmMsg)) return;
    setFreezingParent(family.parentId);
    try {
      const resp = await api.post<{ affected_count: number }>(`/family/freeze-all`, {
        parent_user_id: family.parentId,
        frozen: freeze,
      });
      toast({
        title: freeze
          ? t("admin.families.freezeAllSuccess")
          : t("admin.families.unfreezeAllSuccess"),
        description: t("admin.families.affectedCount", { count: resp.affected_count }),
      });
      load();
    } catch (e) {
      toast({
        title: t("admin.families.freezeAllError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setFreezingParent(null);
    }
  };

  const handleToggleChildFreeze = async (child: FamilyChild) => {
    const next = !child.cardFrozen;
    const confirmMsg = next
      ? t("admin.families.freezeOneConfirm", { name: child.name })
      : t("admin.families.unfreezeOneConfirm", { name: child.name });
    if (!window.confirm(confirmMsg)) return;
    setFreezingChild(child.customerId);
    try {
      await api.post(`/customers/${child.customerId}/freeze`, { frozen: next });
      toast({
        title: next ? t("admin.families.freezeOneSuccess") : t("admin.families.unfreezeOneSuccess"),
      });
      await load();
    } catch (e) {
      toast({
        title: t("admin.families.freezeAllError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setFreezingChild(null);
    }
  };

  const handleToggleTxs = async (child: FamilyChild) => {
    if (expandedChild === child.customerId) {
      setExpandedChild(null);
      return;
    }
    setExpandedChild(child.customerId);
    if (child.walletId && !childTxs[child.walletId]) {
      setLoadingTxs(child.walletId);
      try {
        const txs = await api.get<TxRow[]>(`/wallets/${child.walletId}/transactions`);
        setChildTxs((prev) => ({ ...prev, [child.walletId!]: txs.slice(0, 10) }));
      } catch (e) {
        toast({
          title: t("admin.families.txLoadError"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoadingTxs(null);
      }
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3.5 w-3.5" />
      : <ArrowDown className="h-3.5 w-3.5" />;
  };

  const statusBadge = (f: FamilyGroup) => {
    const status = familyStatus(f);
    if (status === "all_frozen") {
      return <Badge variant="destructive" className="gap-1"><Lock className="h-3 w-3" /> {t("admin.families.statusAllFrozen")}</Badge>;
    }
    if (status === "partial") {
      return <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600"><Lock className="h-3 w-3" /> {t("admin.families.statusPartial", { frozen: f.frozenCount, total: f.children.length })}</Badge>;
    }
    return <Badge variant="secondary">{t("admin.families.statusNormal")}</Badge>;
  };

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users className="h-6 w-6" /> {t("admin.families.title")}
          </h1>
          <p className="page-description">{t("admin.families.description")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> {t("admin.families.addLink")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("admin.families.addLinkTitle")}</DialogTitle>
              <DialogDescription>{t("admin.families.addLinkDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t("admin.families.parent")}</Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger><SelectValue placeholder={t("admin.families.selectParentPlaceholder")} /></SelectTrigger>
                  <SelectContent>
                    {parents.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.full_name} ({p.username})
                        {p.family_code ? ` · family ${p.family_code}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("admin.families.child")}</Label>
                {(() => {
                  const selectedParent = parents.find((p) => String(p.id) === parentId);
                  const fc = selectedParent?.family_code ?? null;
                  const suggested = fc ? students.filter((s) => s.family_code === fc) : [];
                  const others = fc
                    ? students.filter((s) => s.family_code !== fc)
                    : students;
                  return (
                    <Select value={childId} onValueChange={setChildId}>
                      <SelectTrigger><SelectValue placeholder={t("admin.families.selectChildPlaceholder")} /></SelectTrigger>
                      <SelectContent>
                        {fc && suggested.length > 0 && (
                          <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-primary font-semibold">
                            {t("admin.families.suggestedByFamilyCode", { code: fc })}
                          </div>
                        )}
                        {suggested.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name} {s.student_code ? `(${s.student_code})` : `(${s.customer_code})`}
                            {" · "}✓
                          </SelectItem>
                        ))}
                        {fc && suggested.length > 0 && others.length > 0 && (
                          <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mt-1 border-t">
                            {t("admin.families.otherStudents")}
                          </div>
                        )}
                        {others.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name} {s.student_code ? `(${s.student_code})` : `(${s.customer_code})`}
                            {s.family_code ? ` · family ${s.family_code}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </div>
              <div>
                <Label>{t("admin.families.relation")}</Label>
                <Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder={t("admin.families.relationPlaceholder")} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("admin.families.cancel")}</Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? t("admin.families.saving") : t("admin.families.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <InfoCallout
        id="families.scope"
        variant="tip"
        title={t("admin.families.info.scope.title")}
      >
        {t("admin.families.info.scope.body")}
      </InfoCallout>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("admin.families.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("admin.families.filterStatus")}</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("admin.families.filterAll")}</SelectItem>
              <SelectItem value="normal">{t("admin.families.statusNormal")}</SelectItem>
              <SelectItem value="all_frozen">{t("admin.families.statusAllFrozen")}</SelectItem>
              <SelectItem value="partial">{t("admin.families.statusPartialShort")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("admin.families.pageSize")}</Label>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("admin.families.loading")}</CardContent></Card>
      ) : sortedFamilies.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          {links.length === 0 ? t("admin.families.noLinks") : t("admin.families.noLinksSearch")}
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("name")}>
                      {t("admin.families.colParent")} <SortIcon col="name" />
                    </button>
                  </TableHead>
                  <TableHead className="w-28">@username</TableHead>
                  <TableHead className="w-24 text-center">
                    <button className="flex items-center gap-1 mx-auto hover:text-foreground" onClick={() => toggleSort("children")}>
                      {t("admin.families.colChildren")} <SortIcon col="children" />
                    </button>
                  </TableHead>
                  <TableHead className="w-36 text-right">
                    <button className="flex items-center gap-1 ml-auto hover:text-foreground" onClick={() => toggleSort("balance")}>
                      {t("admin.families.colTotal")} <SortIcon col="balance" />
                    </button>
                  </TableHead>
                  <TableHead className="w-48">{t("admin.families.colStatus")}</TableHead>
                  <TableHead className="w-56 text-right">{t("admin.families.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedFamilies.map((family) => {
                  const allFrozen = family.frozenCount === family.children.length && family.children.length > 0;
                  return (
                    <TableRow key={family.parentId}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <UserCircle2 className="h-5 w-5 text-muted-foreground shrink-0" />
                          {family.parentName}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">@{family.parentUsername}</TableCell>
                      <TableCell className="text-center">{family.children.length}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatTHB(family.totalBalance)}</TableCell>
                      <TableCell>{statusBadge(family)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setSelectedParentId(family.parentId); setExpandedChild(null); }}
                          >
                            <Eye className="h-4 w-4 mr-1" /> {t("admin.families.viewDetails")}
                          </Button>
                          {allFrozen ? (
                            <IconButton
                              tooltip={t("admin.families.unfreezeAllCards")}
                              size="sm"
                              variant="outline"
                              disabled={freezingParent === family.parentId}
                              onClick={() => handleToggleFamilyFreeze(family, false)}
                            >
                              <Unlock className="h-4 w-4" />
                            </IconButton>
                          ) : (
                            <IconButton
                              tooltip={t("admin.families.freezeAllCards")}
                              size="sm"
                              variant="destructive"
                              disabled={freezingParent === family.parentId || family.children.length === 0}
                              onClick={() => handleToggleFamilyFreeze(family, true)}
                            >
                              <Lock className="h-4 w-4" />
                            </IconButton>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              {t("admin.families.pageInfo", {
                from: (currentPage - 1) * pageSize + 1,
                to: Math.min(currentPage * pageSize, sortedFamilies.length),
                total: sortedFamilies.length,
              })}
            </div>
            {totalPages > 1 && (
              <Pagination className="mx-0 justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      className={currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      onClick={() => currentPage > 1 && setPage(currentPage - 1)}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, idx, arr) => {
                      const prev = arr[idx - 1];
                      const showEllipsis = prev && p - prev > 1;
                      return (
                        <span key={p} className="flex items-center">
                          {showEllipsis && <span className="px-2 text-muted-foreground">…</span>}
                          <PaginationItem>
                            <PaginationLink
                              isActive={p === currentPage}
                              className="cursor-pointer"
                              onClick={() => setPage(p)}
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        </span>
                      );
                    })}
                  <PaginationItem>
                    <PaginationNext
                      className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      onClick={() => currentPage < totalPages && setPage(currentPage + 1)}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </>
      )}

      {/* Reconciliation / Orphans */}
      {(orphans.parents_no_children.length > 0 || orphans.students_no_parents.length > 0) && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-amber-600" />
              {t("admin.families.reconciliation.title", {
                parents: orphans.parents_no_children.length,
                students: orphans.students_no_parents.length,
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">
              {t("admin.families.reconciliation.description")}
            </p>

            {orphans.parents_no_children.length > 0 && (
              <div>
                <p className="font-semibold mb-2">
                  {t("admin.families.reconciliation.parentsHeader", { count: orphans.parents_no_children.length })}
                </p>
                <div className="space-y-1.5">
                  {orphans.parents_no_children.map((p) => {
                    const matchCount = p.family_code
                      ? students.filter((s) => s.family_code === p.family_code).length
                      : 0;
                    return (
                      <div
                        key={p.user_id}
                        className="flex items-center justify-between gap-3 rounded-md border bg-background p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{p.full_name}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                            <span>@{p.username}</span>
                            {p.family_code && <span className="font-mono">family {p.family_code}</span>}
                            {p.customer_type && <Badge variant="outline" className="text-[10px]">{p.customer_type}</Badge>}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setParentId(String(p.user_id));
                            if (matchCount === 1 && p.family_code) {
                              const only = students.find((s) => s.family_code === p.family_code);
                              if (only) setChildId(String(only.id));
                            } else {
                              setChildId("");
                            }
                            setDialogOpen(true);
                          }}
                        >
                          {matchCount > 0
                            ? t("admin.families.reconciliation.linkSuggestion", { count: matchCount })
                            : t("admin.families.reconciliation.linkManual")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {orphans.students_no_parents.length > 0 && (
              <div>
                <p className="font-semibold mb-2">
                  {t("admin.families.reconciliation.studentsHeader", { count: orphans.students_no_parents.length })}
                </p>
                <div className="space-y-1.5">
                  {orphans.students_no_parents.map((s) => {
                    const matchCount = s.family_code
                      ? parents.filter((p) => p.family_code === s.family_code).length
                      : 0;
                    return (
                      <div
                        key={s.customer_id}
                        className="flex items-center justify-between gap-3 rounded-md border bg-background p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{s.name}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                            {s.student_code && <span>#{s.student_code}</span>}
                            {s.grade && <span>{s.grade}</span>}
                            {s.family_code ? (
                              <span className="font-mono">family {s.family_code}</span>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">
                                {t("admin.families.reconciliation.noFamilyCode")}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setChildId(String(s.customer_id));
                            if (matchCount === 1 && s.family_code) {
                              const only = parents.find((p) => p.family_code === s.family_code);
                              if (only) setParentId(String(only.id));
                            } else {
                              setParentId("");
                            }
                            setDialogOpen(true);
                          }}
                        >
                          {matchCount > 0
                            ? t("admin.families.reconciliation.linkSuggestion", { count: matchCount })
                            : t("admin.families.reconciliation.linkManual")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Detail drawer */}
      <Sheet open={selectedFamily !== null} onOpenChange={(o) => !o && setSelectedParentId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedFamily && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <UserCircle2 className="h-6 w-6 text-muted-foreground" />
                  {selectedFamily.parentName}
                </SheetTitle>
                <SheetDescription>
                  @{selectedFamily.parentUsername} · parent_id={selectedFamily.parentId}
                  {" · "}{t("admin.families.childrenCount", { count: selectedFamily.children.length })}
                  {" · "}{t("admin.families.totalBalance", { amount: formatTHB(selectedFamily.totalBalance) })}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-3">
                {selectedFamily.children.map((c) => {
                  const isExpanded = expandedChild === c.customerId;
                  const txs = c.walletId ? childTxs[c.walletId] : undefined;
                  const isLoadingTxs = c.walletId === loadingTxs;
                  return (
                    <Card key={c.linkId} className="p-3 space-y-3">
                      <div className="flex items-start gap-3">
                        {c.photoUrl ? (
                          <img src={c.photoUrl} alt={c.name} className="h-12 w-12 rounded-full object-cover" />
                        ) : (
                          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                            <UserCircle2 className="h-7 w-7 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold">{c.name}</span>
                            {c.studentCode && <Badge variant="secondary" className="text-xs">{c.studentCode}</Badge>}
                            {c.grade && <Badge variant="outline" className="text-xs">{c.grade}</Badge>}
                            {c.cardFrozen && (
                              <Badge variant="destructive" className="text-xs gap-0.5">
                                <Lock className="h-3 w-3" /> {t("admin.families.frozenBadge")}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.relation}</p>
                          <p className={`text-2xl font-bold tabular-nums mt-1 ${c.walletBalance < 0 ? "text-destructive" : ""}`}>
                            {formatTHB(c.walletBalance)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggleTxs(c)}
                          disabled={!c.walletId}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                          {t("admin.families.viewTransactions")}
                        </Button>
                        <Button
                          size="sm"
                          variant={c.cardFrozen ? "outline" : "destructive"}
                          disabled={freezingChild === c.customerId}
                          onClick={() => handleToggleChildFreeze(c)}
                        >
                          {c.cardFrozen ? <Unlock className="h-4 w-4 mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
                          {c.cardFrozen ? t("admin.families.unfreezeThisCard") : t("admin.families.freezeThisCard")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(c.linkId)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          {t("admin.families.unlink")}
                        </Button>
                      </div>

                      {isExpanded && (
                        <div className="border-t pt-3">
                          {isLoadingTxs ? (
                            <div className="flex items-center justify-center py-6">
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                          ) : !c.walletId ? (
                            <p className="text-sm text-muted-foreground text-center py-4">{t("admin.families.noWallet")}</p>
                          ) : txs && txs.length > 0 ? (
                            <div className="space-y-1.5">
                              {txs.map((tx) => (
                                <div key={tx.id} className="flex items-center justify-between text-xs border-b last:border-b-0 py-1.5">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium truncate">{tx.description || tx.transaction_type}</p>
                                    <p className="text-muted-foreground">
                                      {new Date(tx.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                                      {tx.shop_name ? ` · ${tx.shop_name}` : ""}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0 ml-2">
                                    <p className={`font-mono tabular-nums font-medium ${tx.amount < 0 ? "text-destructive" : "text-emerald-600"}`}>
                                      {tx.amount >= 0 ? "+" : ""}{formatTHB(tx.amount)}
                                    </p>
                                    <p className="text-muted-foreground tabular-nums">{formatTHB(tx.balance_after)}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">{t("admin.families.noTransactions")}</p>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
