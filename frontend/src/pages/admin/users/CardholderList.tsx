import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  Search,
  Plus,
  RefreshCw,
  GraduationCap,
  Users as UsersIcon,
  UtensilsCrossed,
  Building2,
  UserCircle2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import CreateCardholderDialog from "./CreateCardholderDialog";
import SyncRunDialog from "./SyncRunDialog";

export interface Cardholder {
  key: string;
  kind: "student" | "parent" | "staff" | "department" | "other";
  entity_type: "user" | "customer" | "department";
  entity_id: number;
  name: string;
  identifier: string;
  photo_url?: string | null;
  family_code?: string | null;
  external_id?: string | null;
  card_uid?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  is_active: boolean;
  is_graduated?: boolean;
  role?: string | null;
  shop_id?: string | null;
  grade?: string | null;
  school_type?: string | null;
  allergies?: string | null;
  department_code?: string | null;
  synced_at?: string | null;
}

interface FamilyLink {
  id: number;
  parent_user_id: number;
  parent_username?: string | null;
  parent_full_name?: string | null;
  child_customer_id: number;
  child_name?: string | null;
  child_student_code?: string | null;
  relation: string;
}

type SchoolFilter = "all" | "ES Student" | "MS Student" | "HS Student";

interface ListResponse {
  items: Cardholder[];
  total: number;
}

const KIND_FILTERS: { kind: Cardholder["kind"] | "all"; labelKey: string; icon: any }[] = [
  { kind: "all",        labelKey: "cardholders.kindAll",        icon: UsersIcon },
  { kind: "student",    labelKey: "cardholders.kindStudent",    icon: GraduationCap },
  { kind: "parent",     labelKey: "cardholders.kindParent",     icon: UsersIcon },
  { kind: "staff",      labelKey: "cardholders.kindStaff",      icon: UtensilsCrossed },
  { kind: "department", labelKey: "cardholders.kindDepartment", icon: Building2 },
  { kind: "other",      labelKey: "cardholders.kindOther",      icon: UserCircle2 },
];

const KIND_BADGE: Record<Cardholder["kind"], string> = {
  student:    "bg-blue-100 text-blue-900",
  parent:     "bg-green-100 text-green-900",
  staff:      "bg-amber-100 text-amber-900",
  department: "bg-purple-100 text-purple-900",
  other:      "bg-gray-100 text-gray-700",
};

const KIND_BADGE_KEY: Record<Cardholder["kind"], string> = {
  student:    "cardholders.kindStudent",
  parent:     "cardholders.kindParent",
  staff:      "cardholders.kindStaff",
  department: "cardholders.kindDepartment",
  other:      "cardholders.kindOther",
};

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

const relativeTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

function rowDetailHref(c: Cardholder): string {
  if (c.entity_type === "user") return `/users/${c.entity_id}`;
  if (c.entity_type === "customer") return `/admin/customer/${c.entity_id}`;
  return "#"; // department detail page is out of scope for now
}

export default function CardholderList() {
  // Single source of truth — fetch unfiltered list from server, filter by kind
  // on the client. This keeps the chip counts accurate regardless of which
  // filter is active (otherwise selecting "ผู้ปกครอง" zeros out other counts).
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?shop=<shopId> from ShopDetail "Manage shop staff" link — pre-filters by shop_id
  const shopFilter = searchParams.get("shop") ?? null;
  const initialKind = (searchParams.get("kind") as Cardholder["kind"] | "all") || (shopFilter ? "staff" : "all");
  const [allItems, setAllItems] = useState<Cardholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Cardholder["kind"] | "all">(initialKind);
  const [q, setQ] = useState("");
  const [school, setSchool] = useState<SchoolFilter>("all");
  const [grade, setGrade] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [familyLinks, setFamilyLinks] = useState<FamilyLink[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [linkStudentFor, setLinkStudentFor] = useState<Cardholder | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [linkStudentRelation, setLinkStudentRelation] = useState("parent");
  const [linkingStudent, setLinkingStudent] = useState(false);
  const [unlinkingFamilyId, setUnlinkingFamilyId] = useState<number | null>(null);

  // Delete cardholder (admin only). Customers go through /customers DELETE,
  // user accounts go through /users DELETE. Department cardholders are
  // managed elsewhere and are not shown a delete button here.
  const { user: authUser } = useAuth();
  const canDelete = authUser?.activeRole === "admin";
  const [deleting, setDeleting] = useState<Cardholder | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleDeleteCardholder = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const path =
        deleting.entity_type === "user"
          ? `/users/${deleting.entity_id}`
          : deleting.entity_type === "customer"
            ? `/customers/${deleting.entity_id}`
            : null;
      if (!path) throw new Error("Unsupported entity type");
      await api.delete(path);
      toast({
        title: t("cardholders.deleteSuccess", "User deleted"),
        description: deleting.name,
      });
      setAllItems((items) => items.filter((c) => c.key !== deleting.key));
      setDeleting(null);
    } catch (e) {
      toast({
        title: t("cardholders.deleteFailed", "Failed to delete user"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  // Keep URL in sync when chip changes (so /users?kind=student is shareable).
  const setKindAndUrl = (k: Cardholder["kind"] | "all") => {
    setKind(k);
    const next = new URLSearchParams(searchParams);
    if (k === "all") next.delete("kind");
    else next.set("kind", k);
    setSearchParams(next, { replace: true });
    // Reset student-only sub-filters when leaving student kind.
    if (k !== "student") {
      setSchool("all");
      setGrade("all");
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("page_size", "500");
      const [data, links] = await Promise.all([
        api.get<ListResponse>(`/admin/cardholders?${params.toString()}`),
        api.get<FamilyLink[]>("/family/links"),
      ]);
      setAllItems(data.items);
      setFamilyLinks(links);
    } catch (e) {
      toast({
        title: t("cardholders.loadFailed"),
        description: e instanceof ApiError ? e.detail : t("shopUsers.errorGeneric"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Initial load + reload after Create / Sync finish (search reload happens
  // on Enter / button click below).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Display list filtered by chip selection (and student sub-filters when active).
  const items = useMemo(() => {
    let rows = kind === "all" ? allItems : allItems.filter((c) => c.kind === kind);
    if (kind === "student") {
      if (school !== "all") rows = rows.filter((c) => c.school_type === school);
      if (grade !== "all") rows = rows.filter((c) => c.grade === grade);
    }
    if (shopFilter) rows = rows.filter((c) => c.shop_id === shopFilter);
    return rows;
  }, [allItems, kind, school, grade, shopFilter]);
  const total = items.length;

  // Stats always count the full unfiltered list so chip badges stay correct.
  const stats = useMemo(() => {
    const counts: Record<string, number> = {
      student: 0, parent: 0, staff: 0, department: 0, other: 0,
    };
    for (const c of allItems) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    return counts;
  }, [allItems]);
  const totalAll = allItems.length;

  // Student-specific KPIs + grade list — only computed when relevant.
  const studentRows = useMemo(
    () => allItems.filter((c) => c.kind === "student"),
    [allItems],
  );
  const studentStats = useMemo(
    () => ({
      total: studentRows.length,
      withCard: studentRows.filter((c) => c.card_uid).length,
      noFamilyCode: studentRows.filter((c) => !c.family_code).length,
    }),
    [studentRows],
  );
  const grades = useMemo(() => {
    const set = new Set<string>();
    for (const c of studentRows) if (c.grade) set.add(c.grade);
    return Array.from(set).sort();
  }, [studentRows]);

  const toggleExpand = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const openLinkStudent = (c: Cardholder) => {
    setLinkStudentFor(c);
    setStudentSearch("");
    setSelectedStudentId("");
    setLinkStudentRelation("parent");
  };

  const handleLinkStudent = async () => {
    if (!linkStudentFor || !selectedStudentId) return;
    setLinkingStudent(true);
    try {
      await api.post("/family/links", {
        parent_user_id: linkStudentFor.entity_id,
        child_customer_id: parseInt(selectedStudentId),
        relation: linkStudentRelation,
      });
      toast({ title: t("cardholders.studentLinked", "Student linked") });
      setLinkStudentFor(null);
      load();
    } catch (e) {
      toast({ title: t("cardholders.linkFailed", "Link failed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setLinkingStudent(false);
    }
  };

  const handleUnlinkFamily = async (linkId: number) => {
    if (!window.confirm(t("cardholders.unlinkConfirm", "Remove this family link?"))) return;
    setUnlinkingFamilyId(linkId);
    try {
      await api.delete(`/family/links/${linkId}`);
      toast({ title: t("cardholders.studentUnlinked", "Family link removed") });
      load();
    } catch (e) {
      toast({ title: t("cardholders.linkFailed", "Link failed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
    } finally {
      setUnlinkingFamilyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {KIND_FILTERS.map(({ kind: k, labelKey, icon: Icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindAndUrl(k)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                kind === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-background text-muted-foreground hover:border-muted-foreground",
              )}
            >
              <Icon className="h-3 w-3" />
              {t(labelKey)}
              <span className="rounded-full bg-background/60 px-1 text-[10px] tabular-nums">
                {k === "all" ? totalAll : (stats[k] ?? 0)}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            {t("cardholders.syncNow")}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("cardholders.create")}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("cardholders.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
            className="pl-8"
          />
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("cardholders.search")}
        </Button>
      </div>

      {/* Student-only KPIs + sub-filters (school / grade) */}
      {kind === "student" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("cardholders.kpiStudentTotal")}</p>
              <p className="text-2xl font-bold">{studentStats.total}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("cardholders.kpiWithCard")}</p>
              <p className="text-2xl font-bold">{studentStats.withCard}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("cardholders.kpiNoFamily")}</p>
              <p className={cn("text-2xl font-bold", studentStats.noFamilyCode && "text-amber-600")}>
                {studentStats.noFamilyCode}
              </p>
            </CardContent></Card>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={school} onValueChange={(v) => setSchool(v as SchoolFilter)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("cardholders.filterAllSchools")}</SelectItem>
                <SelectItem value="ES Student">ES Student</SelectItem>
                <SelectItem value="MS Student">MS Student</SelectItem>
                <SelectItem value="HS Student">HS Student</SelectItem>
              </SelectContent>
            </Select>
            <Select value={grade} onValueChange={setGrade}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("cardholders.filterAllGrades")}</SelectItem>
                {grades.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="min-w-[160px]">Name</TableHead>
                <TableHead className="w-24">Type</TableHead>
                <TableHead className="w-44">ID Number</TableHead>
                <TableHead className="w-28">Family Code</TableHead>
                <TableHead className="w-28">Card UID</TableHead>
                <TableHead className="w-28 text-right">Wallet Balance</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="w-24">Last Synced</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    {t("common.loading", "Loading…")}
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                    {t("cardholders.noResults")}
                  </TableCell>
                </TableRow>
              )}
              {items.flatMap((c) => {
                const isExpandable = (c.kind === "parent" || c.kind === "staff") && c.entity_type === "user";
                const isExpanded = expandedRows.has(c.key);
                const childLinks = isExpandable
                  ? familyLinks
                      .filter((l) => l.parent_user_id === c.entity_id)
                      .map((l) => ({
                        link: l,
                        child: allItems.find((a) => a.entity_type === "customer" && a.entity_id === l.child_customer_id) ?? null,
                      }))
                  : [];

                const mainRow = (
                  <TableRow key={c.key} className={isExpanded ? "border-b-0" : ""}>
                    {/* Name + avatar */}
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        {c.photo_url ? (
                          <img
                            src={c.photo_url}
                            alt={c.name}
                            className="h-8 w-8 shrink-0 rounded-full object-cover border border-border bg-muted"
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <UserCircle2 className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-sm leading-tight truncate block max-w-[180px]">{c.name}</span>
                            {c.allergies && (
                              <span title={c.allergies} className="shrink-0 text-amber-600">
                                <AlertTriangle className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            {c.role && <span className="capitalize">{c.role}</span>}
                            {c.grade && <span>{c.grade}{c.school_type ? ` · ${c.school_type}` : ""}</span>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    {/* Type badge */}
                    <TableCell>
                      <Badge className={cn("text-[10px] font-medium whitespace-nowrap", KIND_BADGE[c.kind])}>
                        {t(KIND_BADGE_KEY[c.kind])}
                      </Badge>
                    </TableCell>
                    {/* Username / Code */}
                    <TableCell className="font-mono text-xs max-w-[176px]">
                      <span className="block truncate" title={c.identifier}>{c.identifier}</span>
                    </TableCell>
                    {/* Family Code */}
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.family_code ?? "—"}
                    </TableCell>
                    {/* Card UID */}
                    <TableCell className="font-mono text-xs">
                      {c.card_uid
                        ? <span className="tracking-wide">{c.card_uid}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    {/* Wallet Balance */}
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {c.wallet_id
                        ? <span className={Number(c.wallet_balance ?? 0) === 0 ? "text-muted-foreground" : ""}>{formatTHB(Number(c.wallet_balance ?? 0))}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    {/* Status */}
                    <TableCell>
                      {c.is_active
                        ? <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50">Active</Badge>
                        : c.is_graduated
                          ? <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-300 bg-blue-50">Graduated</Badge>
                          : <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
                    </TableCell>
                    {/* Last Synced */}
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {relativeTime(c.synced_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {c.entity_type !== "department" ? (
                          <Button asChild size="sm" variant="ghost" className="h-7">
                            <Link to={rowDetailHref(c)}>{t("cardholders.view")}</Link>
                          </Button>
                        ) : null}
                        {canDelete && c.entity_type !== "department" && c.entity_id !== authUser?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setDeleting(c)}
                            title={t("cardholders.delete", "Delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {isExpandable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={() => toggleExpand(c.key)}
                            title={isExpanded ? t("cardholders.collapseFamily", "Collapse") : t("cardholders.expandFamily", "Show linked students")}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );

                if (!isExpandable || !isExpanded) return [mainRow];

                const expandRow = (
                  <TableRow key={`${c.key}-exp`} className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={9} className="px-6 pb-4 pt-2">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {t("cardholders.linkedStudents", "Linked Students")}
                            {childLinks.length > 0 && <span className="ml-1.5 font-normal">({childLinks.length})</span>}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => openLinkStudent(c)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {t("cardholders.linkStudent", "Link Student")}
                          </Button>
                        </div>
                        {childLinks.length === 0 ? (
                          <p className="text-sm italic text-muted-foreground">
                            {t("cardholders.noLinkedStudents", "No linked students")}
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {childLinks.map(({ link, child }) => (
                              <div
                                key={link.id}
                                className="flex items-center justify-between rounded border bg-background px-3 py-2 text-sm"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium">
                                    {child?.name ?? link.child_name ?? `#${link.child_customer_id}`}
                                  </span>
                                  {child?.grade && (
                                    <span className="ml-2 text-xs text-muted-foreground">{child.grade}</span>
                                  )}
                                  {(link.child_student_code || child?.identifier) && (
                                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                                      {link.child_student_code ?? child?.identifier}
                                    </span>
                                  )}
                                  <span className="ml-2 text-xs text-muted-foreground">· {link.relation}</span>
                                </div>
                                {child?.wallet_balance != null && (
                                  <span className="mr-3 font-mono text-xs tabular-nums">
                                    {formatTHB(Number(child.wallet_balance))}
                                  </span>
                                )}
                                {child?.entity_type === "customer" && (
                                  <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-xs mr-1">
                                    <Link to={`/admin/customer/${child.entity_id}`}>{t("cardholders.view")}</Link>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive hover:bg-destructive/10"
                                  onClick={() => handleUnlinkFamily(link.id)}
                                  disabled={unlinkingFamilyId === link.id}
                                  title={t("cardholders.unlinkStudent", "Unlink")}
                                >
                                  {unlinkingFamilyId === link.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <Trash2 className="h-3 w-3" />}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );

                return [mainRow, expandRow];
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("cardholders.totalCount", { total: total.toLocaleString() })}</p>

      <CreateCardholderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <SyncRunDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onFinished={() => load()}
      />

      {/* Link student dialog */}
      <Dialog open={!!linkStudentFor} onOpenChange={(o) => { if (!o) setLinkStudentFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cardholders.linkStudentTitle", "Link Student")}</DialogTitle>
            <DialogDescription>
              {t("cardholders.linkStudentDesc", "Select a student to link to")} {linkStudentFor?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("cardholders.studentLabel", "Student")}</Label>
              <Input
                className="mt-1"
                placeholder={t("cardholders.studentSearchPlaceholder", "Search by name or student code…")}
                value={studentSearch}
                onChange={(e) => { setStudentSearch(e.target.value); setSelectedStudentId(""); }}
              />
              {studentSearch.trim().length >= 1 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-sm">
                  {allItems
                    .filter((c) => c.kind === "student" && c.entity_type === "customer")
                    .filter((c) => {
                      const q = studentSearch.toLowerCase();
                      return c.name.toLowerCase().includes(q) || (c.identifier ?? "").toLowerCase().includes(q);
                    })
                    .slice(0, 20)
                    .map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted",
                          selectedStudentId === String(c.entity_id) ? "bg-primary/10 font-medium" : "",
                        )}
                        onClick={() => { setSelectedStudentId(String(c.entity_id)); setStudentSearch(c.name); }}
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.grade && <span className="ml-1.5 text-xs text-muted-foreground">{c.grade}</span>}
                        {c.identifier && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{c.identifier}</span>}
                      </button>
                    ))}
                  {allItems.filter((c) => {
                    if (c.kind !== "student" || c.entity_type !== "customer") return false;
                    const q = studentSearch.toLowerCase();
                    return c.name.toLowerCase().includes(q) || (c.identifier ?? "").toLowerCase().includes(q);
                  }).length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {t("cardholders.studentNotFound", "No matching students")}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>{t("cardholders.relation", "Relation")}</Label>
              <Select value={linkStudentRelation} onValueChange={setLinkStudentRelation}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">{t("relation.parent", "Parent")}</SelectItem>
                  <SelectItem value="guardian">{t("relation.guardian", "Guardian")}</SelectItem>
                  <SelectItem value="grandparent">{t("relation.grandparent", "Grandparent")}</SelectItem>
                  <SelectItem value="other">{t("relation.other", "Other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkStudentFor(null)} disabled={linkingStudent}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={handleLinkStudent} disabled={!selectedStudentId || linkingStudent}>
              {linkingStudent && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {t("cardholders.linkConfirm", "Link")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("cardholders.deleteTitle", "Confirm deletion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "cardholders.deleteDesc",
                "Deletion will remove the wallet, audit records, and all linked data. This cannot be undone.",
              )}
              <div className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm font-medium">
                {deleting?.name} <span className="text-muted-foreground">· {deleting?.identifier}</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>
              {t("common.cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCardholder}
              disabled={deleteBusy}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("cardholders.deleteConfirm", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
