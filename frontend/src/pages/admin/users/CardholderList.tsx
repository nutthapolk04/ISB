import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { formatCurrency as formatTHB } from "@/lib/format";
import { useDebounce } from "@/hooks/useDebounce";
import { useRfidListener } from "@/hooks/useRfidListener";
import {
  useCardholders,
  useFamilyLinks,
  useDeleteCardholder,
  useLinkStudent,
  useUnlinkFamily,
  type Cardholder,
} from "@/hooks/useCardholders";
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
import { PaginationBar } from "@/components/PaginationBar";
import { toast } from "@/hooks/use-toast";
import {
  Search,
  Plus,
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
import { getFallbackAvatar, resolveAvatarUrl } from "@/lib/avatarFallback";

type SchoolFilter = "all" | "ES Student" | "MS Student" | "HS Student";

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

const PAGE_SIZE = 10;


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
  if (c.entity_type === "department") return `/admin/department/${c.entity_id}`;
  return "#";
}

export default function CardholderList() {
  // Kind / search / sub-filters / page all go to the server — see
  // useCardholders.ts and cardholder_service.ts. A school's combined
  // cardholder count can run into the thousands, so this can never go back to
  // "fetch everything once and filter client-side" (that's exactly what
  // silently dropped whole kinds off the page before).
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?shop=<shopId> from ShopDetail "Manage shop staff" link — pre-filters by shop_id
  const shopFilter = searchParams.get("shop") ?? null;
  const initialKind = (searchParams.get("kind") as Cardholder["kind"] | "all") || (shopFilter ? "staff" : "all");

  const [kind, setKind] = useState<Cardholder["kind"] | "all">(initialKind);
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);

  // Tapping a card fills the search box directly (PC/SC bridge or
  // keyboard-wedge fallback), same as Card Management's search field.
  useRfidListener({
    onCapture: (uid) => setQ(uid),
  });
  const [school, setSchool] = useState<SchoolFilter>("all");
  const [grade, setGrade] = useState<string>("all");
  const [page, setPage] = useState(1);

  const cardholdersQuery = useCardholders({
    kind,
    q: debouncedQ,
    schoolType: kind === "student" && school !== "all" ? school : null,
    grade: kind === "student" && grade !== "all" ? grade : null,
    shopId: shopFilter,
    page,
    pageSize: PAGE_SIZE,
  });
  const familyLinksQuery = useFamilyLinks();
  const deleteCardholder = useDeleteCardholder();
  const linkStudent = useLinkStudent();
  const unlinkFamily = useUnlinkFamily();

  const items = cardholdersQuery.data?.items ?? [];
  const familyLinks = familyLinksQuery.data ?? [];
  const loading = cardholdersQuery.isLoading;

  // Reload both queries after Create / Sync finish.
  const reload = () => {
    cardholdersQuery.refetch();
    familyLinksQuery.refetch();
  };

  // Surface load failures the same way the old imperative fetch did.
  useEffect(() => {
    if (!cardholdersQuery.isError) return;
    const e = cardholdersQuery.error;
    toast({
      title: t("cardholders.loadFailed"),
      description: e instanceof ApiError ? e.detail : t("shopUsers.errorGeneric"),
      variant: "destructive",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardholdersQuery.isError]);

  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [linkStudentFor, setLinkStudentFor] = useState<Cardholder | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const debouncedStudentSearch = useDebounce(studentSearch, 300);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [linkStudentRelation, setLinkStudentRelation] = useState("parent");
  const [unlinkingFamilyId, setUnlinkingFamilyId] = useState<number | null>(null);
  const linkingStudent = linkStudent.isPending;

  // Independent of the main table's kind/page — this dialog must be able to
  // find a student regardless of which tab/page is currently on screen, so it
  // runs its own small server-side search rather than filtering `items`.
  const studentPickerQuery = useCardholders({
    kind: "student",
    q: debouncedStudentSearch,
    pageSize: 20,
    page: 1,
    enabled: !!linkStudentFor && debouncedStudentSearch.trim().length >= 1,
  });
  const studentPickerResults = studentPickerQuery.data?.items ?? [];

  // Delete cardholder (admin only). Customers go through /customers DELETE,
  // user accounts go through /users DELETE. Department cardholders are
  // managed elsewhere and are not shown a delete button here.
  const { user: authUser } = useAuth();
  const canDelete = authUser?.activeRole === "admin";
  const [deleting, setDeleting] = useState<Cardholder | null>(null);
  const deleteBusy = deleteCardholder.isPending;

  const handleDeleteCardholder = () => {
    if (!deleting) return;
    deleteCardholder.mutate(deleting, {
      onSuccess: (result) => {
        const deactivated =
          !!result && typeof result === "object" && (result as { deactivated?: boolean }).deactivated;
        if (deactivated) {
          toast({
            title: t("cardholders.deactivatedInstead", "User deactivated"),
            description: t(
              "cardholders.deactivatedInsteadDesc",
              "This account has transaction/audit history, so it was deactivated instead of deleted.",
            ),
          });
        } else {
          toast({
            title: t("cardholders.deleteSuccess", "User deleted"),
            description: deleting.name,
          });
        }
        setDeleting(null);
      },
      onError: (e) => {
        toast({
          title: t("cardholders.deleteFailed", "Failed to delete user"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      },
    });
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

  // `items` is already exactly the page the server returned — kind, search,
  // school/grade sub-filters, and the shop pre-filter are all applied there.
  const total = cardholdersQuery.data?.total ?? 0;

  // Reset to page 1 whenever any filter changes underneath the user.
  useEffect(() => {
    setPage(1);
  }, [kind, school, grade, shopFilter, debouncedQ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = items;

  // Stats come from the backend's full-set counts (always school-wide,
  // independent of the active kind tab) — a kind-scoped `total` from the main
  // query is not a substitute, since that only reflects whichever tab is
  // currently selected.
  const stats = cardholdersQuery.data?.counts ?? {
    student: 0, parent: 0, staff: 0, department: 0, other: 0,
  };
  const totalAll = Object.values(stats).reduce((sum, n) => sum + n, 0);

  // Student-specific KPIs + grade list — always full-roster from the server,
  // never derived from whatever page happens to be loaded.
  const studentStats = cardholdersQuery.data?.studentStats ?? { total: 0, withCard: 0, noFamilyCode: 0 };
  const grades = cardholdersQuery.data?.grades ?? [];

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

  const handleLinkStudent = () => {
    if (!linkStudentFor || !selectedStudentId) return;
    linkStudent.mutate(
      {
        parent_user_id: linkStudentFor.entity_id,
        child_customer_id: parseInt(selectedStudentId),
        relation: linkStudentRelation,
      },
      {
        onSuccess: () => {
          toast({ title: t("cardholders.studentLinked", "Student linked") });
          setLinkStudentFor(null);
        },
        onError: (e) => {
          toast({ title: t("cardholders.linkFailed", "Link failed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
        },
      },
    );
  };

  const handleUnlinkFamily = (linkId: number) => {
    if (!window.confirm(t("cardholders.unlinkConfirm", "Remove this family link?"))) return;
    setUnlinkingFamilyId(linkId);
    unlinkFamily.mutate(linkId, {
      onSuccess: () => {
        toast({ title: t("cardholders.studentUnlinked", "Family link removed") });
      },
      onError: (e) => {
        toast({ title: t("cardholders.linkFailed", "Link failed"), description: e instanceof ApiError ? e.detail : "Unknown error", variant: "destructive" });
      },
      onSettled: () => {
        setUnlinkingFamilyId(null);
      },
    });
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
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("cardholders.create")}
          </Button>
        </div>
      </div>

      {/* Search — filters the already-loaded list live as you type */}
      <div className="relative max-w-md">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("cardholders.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-8"
        />
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
                <TableHead className="w-12 text-right">{t("common.colNo", "No.")}</TableHead>
                <TableHead className="w-48">{t("cardholders.colName", "Name")}</TableHead>
                <TableHead className="w-24">{t("cardholders.colKind", "Type")}</TableHead>
                <TableHead className="w-44">{t("cardholders.colIdentifier", "ID Number")}</TableHead>
                <TableHead className="w-28">{t("cardholders.colFamily", "Family Code")}</TableHead>
                <TableHead className="w-28">{t("cardholders.colCard", "Card UID")}</TableHead>
                <TableHead className="w-28 text-right">{t("cardholders.colBalance", "Wallet Balance")}</TableHead>
                <TableHead className="w-20">{t("cardholders.colStatus", "Status")}</TableHead>
                <TableHead className="w-24">{t("cardholders.colLastSync", "Last Synced")}</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    {t("common.loading", "Loading…")}
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                    {t("cardholders.noResults")}
                  </TableCell>
                </TableRow>
              )}
              {pagedItems.flatMap((c, idx) => {
                const rowNo = (currentPage - 1) * PAGE_SIZE + idx + 1;
                const isExpandable = (c.kind === "parent" || c.kind === "staff") && c.entity_type === "user";
                const isExpanded = expandedRows.has(c.key);
                // FamilyLink already carries child_name/child_student_code denormalized,
                // so this never needs to cross-reference the (now paginated, not-full)
                // cardholder list to render — the linked child may not even be on the
                // currently loaded page/kind tab.
                const childLinks = isExpandable
                  ? familyLinks.filter((l) => l.parent_user_id === c.entity_id)
                  : [];

                const mainRow = (
                  <TableRow key={c.key} className={isExpanded ? "border-b-0" : ""}>
                    {/* Row number */}
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{rowNo}</TableCell>
                    {/* Name + avatar */}
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={resolveAvatarUrl(c.photo_url, c.name || String(c.entity_id))}
                          alt={c.name}
                          className="h-8 w-8 shrink-0 rounded-full object-cover border border-border bg-muted"
                          onError={(e) => { e.currentTarget.src = getFallbackAvatar(c.name || String(c.entity_id)); }}
                        />
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
                        <Button asChild size="sm" variant="ghost" className="h-7">
                          <Link to={rowDetailHref(c)}>{t("cardholders.view")}</Link>
                        </Button>
                        {canDelete && !(c.entity_type === "user" && c.entity_id === authUser?.id) && (
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
                    <TableCell colSpan={10} className="px-6 pb-4 pt-2">
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
                            {childLinks.map((link) => (
                              <div
                                key={link.id}
                                className="flex items-center justify-between rounded border bg-background px-3 py-2 text-sm"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium">
                                    {link.child_name ?? `#${link.child_customer_id}`}
                                  </span>
                                  {link.child_student_code && (
                                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                                      {link.child_student_code}
                                    </span>
                                  )}
                                  <span className="ml-2 text-xs text-muted-foreground">· {link.relation}</span>
                                </div>
                                <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-xs mr-1">
                                  <Link to={`/admin/customer/${link.child_customer_id}`}>{t("cardholders.view")}</Link>
                                </Button>
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

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {total > 0
            ? t("cardholders.pageInfo", {
                from: (currentPage - 1) * PAGE_SIZE + 1,
                to: Math.min(currentPage * PAGE_SIZE, total),
                total: total.toLocaleString(),
              })
            : t("cardholders.totalCount", { total: total.toLocaleString() })}
        </p>
        <PaginationBar currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
      </div>

      <CreateCardholderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          reload();
        }}
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
                  {studentPickerQuery.isFetching && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1.5" />
                      {t("common.loading", "Loading…")}
                    </p>
                  )}
                  {!studentPickerQuery.isFetching && studentPickerResults.map((c) => (
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
                  {!studentPickerQuery.isFetching && studentPickerResults.length === 0 && (
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
                "If this account has no transaction/audit history it will be permanently deleted; otherwise it will be deactivated instead so existing records stay intact. This cannot be undone.",
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
