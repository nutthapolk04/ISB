import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useRfidListener } from "@/hooks/useRfidListener";
import { expandCardUidCandidates, toCanonicalCardUid } from "@/lib/cardUid";
import { fmtDateTime } from "@/lib/dateFormat";
import { formatCurrency as formatTHB } from "@/lib/format";
import { getPaginationRange } from "@/lib/pagination";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { toast } from "@/hooks/use-toast";
import {
  Lock, Plus, Search, Trash2, Unlock, Users,
  ChevronDown, ChevronUp, ChevronRight,
  ArrowUp, ArrowDown, ArrowUpDown, Loader2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

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
  card_uid?: string | null;
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
  card_uid?: string | null;
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

interface FamilyParent {
  userId: number;
  username: string;
  name: string;
}

interface FamilyChildLink {
  linkId: number;
  parentUserId: number;
  parentName: string;
  relation: string;
}

interface FamilyChild {
  customerId: number;
  name: string;
  studentCode?: string | null;
  grade?: string | null;
  walletId?: number | null;
  walletBalance: number;
  cardFrozen: boolean;
  photoUrl?: string | null;
  links: FamilyChildLink[];
}

interface FamilyUnit {
  familyCode: string;
  parents: FamilyParent[];
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

function unitStatus(u: FamilyUnit): StatusFilter {
  if (u.children.length === 0) return "normal";
  if (u.frozenCount === 0) return "normal";
  if (u.frozenCount === u.children.length) return "all_frozen";
  return "partial";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FamilyLinks() {
  const { t } = useTranslation();
  const [orphans, setOrphans] = useState<OrphansResponse>({ parents_no_children: [], students_no_parents: [] });
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [parents, setParents] = useState<UserRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");

  // Tapping a card fills the search box directly (PC/SC bridge or
  // keyboard-wedge fallback), same as Card Management / Cardholder list.
  // Readers can emit the same physical card as decimal or hex depending on
  // mode — convert to the canonical (byte-reversed hex) form the DB stores
  // so the box always shows a consistent, matchable value.
  useRfidListener({
    onCapture: (uid) => setSearch(toCanonicalCardUid(uid)),
  });
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
  const [deleteLinkTarget, setDeleteLinkTarget] = useState<{ linkId: number; childName: string; parentName: string } | null>(null);

  // Accordion + per-child state
  const [expandedFamilyCode, setExpandedFamilyCode] = useState<string | null>(null);
  const [expandedChild, setExpandedChild] = useState<number | null>(null);
  const [childTxs, setChildTxs] = useState<Record<number, TxRow[]>>({});
  const [loadingTxs, setLoadingTxs] = useState<number | null>(null);
  const [freezingChild, setFreezingChild] = useState<number | null>(null);
  const [freezingFamily, setFreezingFamily] = useState<string | null>(null);

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

  useEffect(() => { load(); }, []);

  const studentById = useMemo(() => {
    const map = new Map<number, StudentRow>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  const parentById = useMemo(() => {
    const map = new Map<number, UserRow>();
    for (const p of parents) map.set(p.id, p);
    return map;
  }, [parents]);

  // Group links into family units (one unit per family_code)
  const familyUnits: FamilyUnit[] = useMemo(() => {
    const unitMap = new Map<string, FamilyUnit>();

    for (const l of links) {
      const parent = parentById.get(l.parent_user_id);
      const fcode = parent?.family_code ?? `_pid_${l.parent_user_id}`;

      if (!unitMap.has(fcode)) {
        unitMap.set(fcode, { familyCode: fcode, parents: [], children: [], totalBalance: 0, frozenCount: 0 });
      }
      const unit = unitMap.get(fcode)!;

      if (!unit.parents.find((p) => p.userId === l.parent_user_id)) {
        unit.parents.push({
          userId: l.parent_user_id,
          username: l.parent_username ?? "",
          name: l.parent_full_name || l.parent_username || `user#${l.parent_user_id}`,
        });
      }

      const existing = unit.children.find((c) => c.customerId === l.child_customer_id);
      if (existing) {
        existing.links.push({
          linkId: l.id,
          parentUserId: l.parent_user_id,
          parentName: l.parent_full_name || l.parent_username || `user#${l.parent_user_id}`,
          relation: l.relation,
        });
      } else {
        const s = studentById.get(l.child_customer_id);
        const balance = s?.wallet_balance ?? 0;
        const frozen = !!s?.card_frozen;
        unit.children.push({
          customerId: l.child_customer_id,
          name: l.child_name || s?.name || `#${l.child_customer_id}`,
          studentCode: l.child_student_code ?? s?.student_code,
          grade: s?.grade,
          walletId: s?.wallet_id ?? null,
          walletBalance: balance,
          cardFrozen: frozen,
          photoUrl: s?.photo_url,
          links: [{
            linkId: l.id,
            parentUserId: l.parent_user_id,
            parentName: l.parent_full_name || l.parent_username || `user#${l.parent_user_id}`,
            relation: l.relation,
          }],
        });
        unit.totalBalance += balance;
        if (frozen) unit.frozenCount += 1;
      }
    }
    return Array.from(unitMap.values());
  }, [links, studentById, parentById]);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    // A scanned card can reach this box in whatever format the reader
    // emitted (hex, byte-reversed hex, or decimal) — expand it to every
    // equivalent form so a scan always matches the stored uid regardless of
    // which format it came in as.
    const uidCandidates = search.trim()
      ? expandCardUidCandidates(search.trim()).map((c) => c.toLowerCase())
      : [];
    const uidMatches = (uid: string | null | undefined) => {
      const lower = (uid ?? "").toLowerCase();
      return lower.length > 0 && uidCandidates.some((cand) => lower === cand);
    };
    return familyUnits.filter((u) => {
      if (q) {
        const match =
          u.familyCode.toLowerCase().includes(q) ||
          u.parents.some((p) =>
            p.name.toLowerCase().includes(q) ||
            p.username.toLowerCase().includes(q) ||
            (parentById.get(p.userId)?.card_uid ?? "").toLowerCase().includes(q) ||
            uidMatches(parentById.get(p.userId)?.card_uid)
          ) ||
          u.children.some((c) =>
            c.name.toLowerCase().includes(q) ||
            (c.studentCode ?? "").toLowerCase().includes(q) ||
            (studentById.get(c.customerId)?.card_uid ?? "").toLowerCase().includes(q) ||
            uidMatches(studentById.get(c.customerId)?.card_uid)
          );
        if (!match) return false;
      }
      if (statusFilter !== "all" && unitStatus(u) !== statusFilter) return false;
      return true;
    });
  }, [familyUnits, search, statusFilter, parentById, studentById]);

  const sortedUnits = useMemo(() => {
    const arr = [...filteredUnits];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === "children") return (a.children.length - b.children.length) * dir;
      if (sortKey === "balance") return (a.totalBalance - b.totalBalance) * dir;
      return (a.parents[0]?.name ?? a.familyCode).localeCompare(b.parents[0]?.name ?? b.familyCode) * dir;
    });
    return arr;
  }, [filteredUnits, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedUnits.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedUnits = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedUnits.slice(start, start + pageSize);
  }, [sortedUnits, currentPage, pageSize]);

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "balance" || key === "children" ? "desc" : "asc");
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

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
      setParentId(""); setChildId(""); setRelation("guardian");
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

  const handleConfirmDeleteLink = async () => {
    if (!deleteLinkTarget) return;
    try {
      await api.delete(`/family/links/${deleteLinkTarget.linkId}`);
      toast({ title: t("admin.families.deleteSuccess") });
      load();
    } catch (e) {
      toast({
        title: t("admin.families.deleteError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleteLinkTarget(null);
    }
  };

  const handleToggleUnitFreeze = async (unit: FamilyUnit, freeze: boolean) => {
    const confirmMsg = freeze
      ? t("admin.families.freezeAllConfirm", { name: unit.familyCode })
      : t("admin.families.unfreezeAllConfirm", { name: unit.familyCode });
    if (!window.confirm(confirmMsg)) return;
    setFreezingFamily(unit.familyCode);
    try {
      let totalAffected = 0;
      for (const parent of unit.parents) {
        const resp = await api.post<{ affected_count: number }>(`/family/freeze-all`, {
          parent_user_id: parent.userId,
          frozen: freeze,
        });
        totalAffected += resp.affected_count;
      }
      toast({
        title: freeze ? t("admin.families.freezeAllSuccess") : t("admin.families.unfreezeAllSuccess"),
        description: t("admin.families.affectedCount", { count: totalAffected }),
      });
      load();
    } catch (e) {
      toast({
        title: t("admin.families.freezeAllError"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setFreezingFamily(null);
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
      toast({ title: next ? t("admin.families.freezeOneSuccess") : t("admin.families.unfreezeOneSuccess") });
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
    if (expandedChild === child.customerId) { setExpandedChild(null); return; }
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

  // ── Sort header helper ────────────────────────────────────────────────────

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const statusBadge = (u: FamilyUnit) => {
    const s = unitStatus(u);
    if (s === "all_frozen") return (
      <Badge variant="destructive" className="gap-1 text-[11px]">
        <Lock className="h-2.5 w-2.5" /> {t("admin.families.statusAllFrozen")}
      </Badge>
    );
    if (s === "partial") return (
      <Badge variant="outline" className="gap-1 text-[11px] border-amber-400 text-amber-700">
        <Lock className="h-2.5 w-2.5" /> {t("admin.families.statusPartial", { frozen: u.frozenCount, total: u.children.length })}
      </Badge>
    );
    return null;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      {/* Page header */}
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users className="h-6 w-6" /> {t("admin.families.title")}
          </h1>
          <p className="page-description">{t("admin.families.description")}</p>
        </div>

        {/* Add link dialog */}
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
                  const others = fc ? students.filter((s) => s.family_code !== fc) : students;
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
                            {s.name} {s.student_code ? `(${s.student_code})` : `(${s.customer_code})`} · ✓
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

      <InfoCallout id="families.scope" variant="tip" title={t("admin.families.info.scope.title")}>
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

        {/* Sort controls */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-muted-foreground mr-1">Sort:</span>
          {(["name", "children", "balance"] as SortKey[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={sortKey === key ? "secondary" : "ghost"}
              className="h-8 gap-1 text-xs"
              onClick={() => toggleSort(key)}
            >
              {key === "name" ? "Name" : key === "children" ? "Children" : "Balance"}
              <SortIcon col={key} />
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("admin.families.pageSize")}</Label>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v))}>
            <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Family list */}
      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("admin.families.loading")}</CardContent></Card>
      ) : sortedUnits.length === 0 ? (
        links.length === 0 && orphans.parents_no_children.length === 0 && orphans.students_no_parents.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">{t("admin.families.noLinks")}</CardContent></Card>
        ) : null
      ) : (
        <>
          <div className="space-y-2">
            {pagedUnits.map((unit) => {
              const isExpanded = expandedFamilyCode === unit.familyCode;
              const allFrozen = unit.frozenCount === unit.children.length && unit.children.length > 0;
              const status = unitStatus(unit);

              return (
                <div key={unit.familyCode} className="rounded-lg border bg-card shadow-sm">
                  {/* Family header row */}
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors rounded-lg"
                    onClick={() => {
                      setExpandedFamilyCode(isExpanded ? null : unit.familyCode);
                      setExpandedChild(null);
                    }}
                  >
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-150", isExpanded && "rotate-90")} />

                    {/* Family code */}
                    <Badge variant="outline" className="font-mono text-[11px] shrink-0 hidden sm:inline-flex">
                      {unit.familyCode.startsWith("_pid_") ? "—" : unit.familyCode}
                    </Badge>

                    {/* Parents */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {unit.parents.map((p, i) => (
                          <span key={p.userId} className="text-sm font-medium flex items-center gap-1">
                            {i > 0 && <span className="text-muted-foreground text-xs">·</span>}
                            {p.name}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0 mt-0.5">
                        {unit.parents.map((p) => (
                          <span key={p.userId} className="text-xs text-muted-foreground font-mono">@{p.username}</span>
                        ))}
                      </div>
                    </div>

                    {/* Stats + status */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {unit.children.length} {unit.children.length === 1 ? "child" : "children"}
                      </span>
                      <span className="text-sm font-mono tabular-nums font-medium">{formatTHB(unit.totalBalance)}</span>
                      {status !== "normal" && statusBadge(unit)}
                    </div>

                    {/* Actions — stop propagation so click doesn't toggle expand */}
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {allFrozen ? (
                        <IconButton
                          tooltip={t("admin.families.unfreezeAllCards")}
                          size="sm" variant="outline"
                          disabled={freezingFamily === unit.familyCode}
                          onClick={() => handleToggleUnitFreeze(unit, false)}
                        >
                          {freezingFamily === unit.familyCode
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Unlock className="h-4 w-4" />}
                        </IconButton>
                      ) : (
                        <IconButton
                          tooltip={t("admin.families.freezeAllCards")}
                          size="sm" variant="destructive"
                          disabled={freezingFamily === unit.familyCode || unit.children.length === 0}
                          onClick={() => handleToggleUnitFreeze(unit, true)}
                        >
                          {freezingFamily === unit.familyCode
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Lock className="h-4 w-4" />}
                        </IconButton>
                      )}
                    </div>
                  </button>

                  {/* Expanded children panel */}
                  {isExpanded && (
                    <div className="border-t bg-muted/20 px-4 pb-4 pt-3 space-y-2 rounded-b-lg">
                      {/* Parent detail links */}
                      <div className="flex flex-wrap gap-2 pb-1">
                        {unit.parents.map((p) => (
                          <Link
                            key={p.userId}
                            to={`/admin/users/${p.userId}`}
                            className="text-xs text-primary underline-offset-2 hover:underline font-mono"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View {p.name} →
                          </Link>
                        ))}
                      </div>

                      {unit.children.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2 text-center">No children linked.</p>
                      ) : (
                        unit.children.map((child) => {
                          const isChildExpanded = expandedChild === child.customerId;
                          const txs = child.walletId ? childTxs[child.walletId] : undefined;
                          const isLoadingTxs = child.walletId === loadingTxs;

                          return (
                            <div key={child.customerId} className="rounded-md border bg-background">
                              <div className="flex items-center gap-3 px-3 py-2.5">
                                {/* Avatar */}
                                <img
                                  src={resolveAvatarUrl(child.photoUrl, child.name || String(child.customerId))}
                                  alt={child.name}
                                  className="h-9 w-9 rounded-full object-cover shrink-0 border"
                                  onError={(e) => { e.currentTarget.src = getFallbackAvatar(child.name || String(child.customerId)); }}
                                />

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium text-sm">{child.name}</span>
                                    {child.studentCode && (
                                      <Badge variant="secondary" className="text-[10px]">{child.studentCode}</Badge>
                                    )}
                                    {child.grade && (
                                      <Badge variant="outline" className="text-[10px]">{child.grade}</Badge>
                                    )}
                                    {child.cardFrozen && (
                                      <Badge variant="destructive" className="text-[10px] gap-0.5">
                                        <Lock className="h-2.5 w-2.5" /> {t("admin.families.frozenBadge")}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className={cn(
                                      "text-sm font-mono tabular-nums font-semibold",
                                      child.walletBalance < 0 ? "text-destructive" : "text-muted-foreground",
                                    )}>
                                      {formatTHB(child.walletBalance)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      via {child.links.map((l) => l.parentName).join(", ")}
                                    </span>
                                  </div>
                                </div>

                                {/* Child actions */}
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    size="sm" variant="ghost"
                                    className="h-8 text-xs gap-1 text-muted-foreground"
                                    disabled={!child.walletId}
                                    onClick={() => handleToggleTxs(child)}
                                  >
                                    {isChildExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    Txs
                                  </Button>
                                  <IconButton
                                    tooltip={child.cardFrozen ? t("admin.families.unfreezeThisCard") : t("admin.families.freezeThisCard")}
                                    size="sm"
                                    variant={child.cardFrozen ? "outline" : "ghost"}
                                    disabled={freezingChild === child.customerId}
                                    onClick={() => handleToggleChildFreeze(child)}
                                  >
                                    {freezingChild === child.customerId
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : child.cardFrozen
                                        ? <Unlock className="h-3.5 w-3.5" />
                                        : <Lock className="h-3.5 w-3.5" />}
                                  </IconButton>
                                  {child.links.map((link) => (
                                    <IconButton
                                      key={link.linkId}
                                      tooltip={`Unlink from ${link.parentName}`}
                                      size="sm" variant="ghost"
                                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => setDeleteLinkTarget({
                                        linkId: link.linkId,
                                        childName: child.name,
                                        parentName: link.parentName,
                                      })}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </IconButton>
                                  ))}
                                </div>
                              </div>

                              {/* Inline transaction history */}
                              {isChildExpanded && (
                                <div className="border-t px-3 pb-3 pt-2">
                                  {isLoadingTxs ? (
                                    <div className="flex items-center justify-center py-4">
                                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    </div>
                                  ) : !child.walletId ? (
                                    <p className="text-xs text-muted-foreground text-center py-3">{t("admin.families.noWallet")}</p>
                                  ) : txs && txs.length > 0 ? (
                                    <div className="space-y-0.5">
                                      {txs.map((tx) => (
                                        <div key={tx.id} className="flex items-center justify-between text-xs py-1.5 border-b last:border-b-0">
                                          <div className="min-w-0 flex-1">
                                            <p className="font-medium truncate">{tx.description || tx.transaction_type}</p>
                                            <p className="text-muted-foreground">
                                              {fmtDateTime(tx.created_at)}{tx.shop_name ? ` · ${tx.shop_name}` : ""}
                                            </p>
                                          </div>
                                          <div className="text-right shrink-0 ml-3">
                                            <p className={cn("font-mono tabular-nums font-medium", tx.amount < 0 ? "text-destructive" : "text-emerald-600")}>
                                              {tx.amount >= 0 ? "+" : ""}{formatTHB(tx.amount)}
                                            </p>
                                            <p className="text-muted-foreground tabular-nums">{formatTHB(tx.balance_after)}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground text-center py-3">{t("admin.families.noTransactions")}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              {t("admin.families.pageInfo", {
                from: (currentPage - 1) * pageSize + 1,
                to: Math.min(currentPage * pageSize, sortedUnits.length),
                total: sortedUnits.length,
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
                  {getPaginationRange(currentPage, totalPages).map((p, idx) =>
                    p === "ellipsis" ? (
                      <span key={`e-${idx}`} className="px-2 text-muted-foreground">…</span>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink isActive={p === currentPage} className="cursor-pointer" onClick={() => setPage(p)}>
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
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
            <p className="text-xs text-muted-foreground">{t("admin.families.reconciliation.description")}</p>

            {orphans.parents_no_children.length > 0 && (
              <div>
                <p className="font-semibold mb-2">
                  {t("admin.families.reconciliation.parentsHeader", { count: orphans.parents_no_children.length })}
                </p>
                <div className="space-y-1.5">
                  {orphans.parents_no_children.map((p) => {
                    const matchCount = p.family_code ? students.filter((s) => s.family_code === p.family_code).length : 0;
                    const usernameLooksLikeEmail = p.username.includes("@");
                    return (
                      <div key={p.user_id} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{p.full_name}</span>
                            <Badge variant="outline" className="text-[10px]">{p.customer_type || "Parent"}</Badge>
                          </div>
                          {p.email && p.email !== p.username && (
                            <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                          )}
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                            <span className="truncate">{usernameLooksLikeEmail ? p.username : `@${p.username}`}</span>
                            {p.external_id && <span className="font-mono">#{p.external_id}</span>}
                            {p.family_code && <span className="font-mono">family {p.family_code}</span>}
                          </div>
                        </div>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => {
                            setParentId(String(p.user_id));
                            if (matchCount === 1 && p.family_code) {
                              const only = students.find((s) => s.family_code === p.family_code);
                              if (only) setChildId(String(only.id));
                            } else { setChildId(""); }
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
                    const matchCount = s.family_code ? parents.filter((p) => p.family_code === s.family_code).length : 0;
                    return (
                      <div key={s.customer_id} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{s.name}</span>
                            <Badge variant="outline" className="text-[10px]">Student</Badge>
                            {!s.family_code && (
                              <Badge variant="destructive" className="text-[10px]">
                                {t("admin.families.reconciliation.noFamilyCode")}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                            {s.student_code && <span className="font-mono">#{s.student_code}</span>}
                            {s.customer_code && s.customer_code !== s.student_code && <span className="font-mono">{s.customer_code}</span>}
                            {s.grade && <span>{s.grade}</span>}
                            {s.family_code && <span className="font-mono">family {s.family_code}</span>}
                          </div>
                        </div>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => {
                            setChildId(String(s.customer_id));
                            if (matchCount === 1 && s.family_code) {
                              const only = parents.find((p) => p.family_code === s.family_code);
                              if (only) setParentId(String(only.id));
                            } else { setParentId(""); }
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

      {/* Unlink confirmation */}
      <AlertDialog open={!!deleteLinkTarget} onOpenChange={(open) => !open && setDeleteLinkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.families.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.families.confirmDeleteDesc", {
                child: deleteLinkTarget?.childName ?? "",
                parent: deleteLinkTarget?.parentName ?? "",
                defaultValue: `Remove {{child}} from {{parent}}'s family group. The student will no longer share spending limits with this family. Wallet balances are not affected.`,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDeleteLink}
            >
              {t("admin.families.unlink", "Unlink")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
