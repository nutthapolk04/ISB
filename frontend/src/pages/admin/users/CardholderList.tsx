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
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  role?: string | null;
  shop_id?: string | null;
  grade?: string | null;
  school_type?: string | null;
  allergies?: string | null;
  department_code?: string | null;
  synced_at?: string | null;
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
  const initialKind = (searchParams.get("kind") as Cardholder["kind"] | "all") || "all";
  const [allItems, setAllItems] = useState<Cardholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Cardholder["kind"] | "all">(initialKind);
  const [q, setQ] = useState("");
  const [school, setSchool] = useState<SchoolFilter>("all");
  const [grade, setGrade] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

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
      const data = await api.get<ListResponse>(
        `/admin/cardholders?${params.toString()}`,
      );
      setAllItems(data.items);
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
    return rows;
  }, [allItems, kind, school, grade]);
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
              <TableRow>
                <TableHead>{t("cardholders.colName")}</TableHead>
                <TableHead>{t("cardholders.colKind")}</TableHead>
                <TableHead>{t("cardholders.colIdentifier")}</TableHead>
                <TableHead>{t("cardholders.colFamily")}</TableHead>
                <TableHead>{t("cardholders.colCard")}</TableHead>
                <TableHead className="text-right">{t("cardholders.colBalance")}</TableHead>
                <TableHead>{t("cardholders.colLastSync")}</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    {t("common.loading", "Loading…")}
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                    {t("cardholders.noResults")}
                  </TableCell>
                </TableRow>
              )}
              {items.map((c) => (
                <TableRow key={c.key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {c.photo_url ? (
                        <img
                          src={c.photo_url}
                          alt={c.name}
                          className="h-8 w-8 rounded-full object-cover border border-border bg-background"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <UserCircle2 className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm truncate">{c.name}</span>
                          {c.allergies && (
                            <span title={c.allergies} className="text-amber-600">
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                        {c.role && (
                          <div className="text-xs text-muted-foreground capitalize">{c.role}</div>
                        )}
                        {c.grade && (
                          <div className="text-xs text-muted-foreground">
                            {c.grade}{c.school_type ? ` · ${c.school_type}` : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-[10px] font-medium", KIND_BADGE[c.kind])}>
                      {t(KIND_BADGE_KEY[c.kind])}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.identifier}</TableCell>
                  <TableCell className="font-mono text-xs">{c.family_code ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.card_uid ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.wallet_id ? formatTHB(Number(c.wallet_balance ?? 0)) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {relativeTime(c.synced_at)}
                  </TableCell>
                  <TableCell>
                    {c.entity_type !== "department" ? (
                      <Button asChild size="sm" variant="ghost" className="h-7">
                        <Link to={rowDetailHref(c)}>{t("cardholders.view")}</Link>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
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
    </div>
  );
}
