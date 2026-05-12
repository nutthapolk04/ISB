import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { toast } from "@/hooks/use-toast";
import { CreditCard, Search, Loader2, Eye, UserCircle2 } from "lucide-react";

type CardRole = "all" | "staff" | "parent" | "student" | "admin" | "manager" | "cashier" | "visitor";

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email?: string | null;
  role: string;
  customer_type?: string | null;
  card_uid?: string | null;
  external_id?: string | null;
  family_code?: string | null;
  photo_url?: string | null;
}

interface StudentRow {
  id: number;
  name: string;
  student_code?: string | null;
  customer_code: string;
  grade?: string | null;
  family_code?: string | null;
  external_id?: string | null;
  school_type?: string | null;
  card_uid?: string | null;
  photo_url?: string | null;
}

interface BoundCard {
  kind: "user" | "customer";
  id: number;
  uid: string;
  name: string;
  role: string;
  customerType?: string | null;
  identifier?: string | null;
  familyCode?: string | null;
  externalId?: string | null;
  photoUrl?: string | null;
}

export default function CardManagement() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<CardRole>("all");

  const load = async () => {
    setLoading(true);
    try {
      const [u, s] = await Promise.all([
        api.get<UserRow[]>("/users-admin/"),
        api.get<StudentRow[]>("/users-admin/students"),
      ]);
      setUsers(u);
      setStudents(s);
    } catch (e) {
      toast({
        title: t("admin.cards.loadError"),
        description: e instanceof ApiError ? e.detail : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const boundCards: BoundCard[] = useMemo(() => {
    const list: BoundCard[] = [];
    for (const u of users) {
      if (!u.card_uid) continue;
      list.push({
        kind: "user",
        id: u.id,
        uid: u.card_uid,
        name: u.full_name || u.username,
        role: u.role,
        customerType: u.customer_type,
        identifier: u.email || u.username,
        familyCode: u.family_code,
        externalId: u.external_id,
        photoUrl: u.photo_url,
      });
    }
    for (const c of students) {
      if (!c.card_uid) continue;
      list.push({
        kind: "customer",
        id: c.id,
        uid: c.card_uid,
        name: c.name,
        role: "student",
        customerType: c.school_type,
        identifier: c.student_code || c.customer_code,
        familyCode: c.family_code,
        externalId: c.external_id,
        photoUrl: c.photo_url,
      });
    }
    return list.sort((a, b) => a.uid.localeCompare(b.uid));
  }, [users, students]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return boundCards.filter((c) => {
      if (roleFilter !== "all") {
        if (roleFilter === "student") {
          if (c.kind !== "customer") return false;
        } else if (c.role !== roleFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        c.uid.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.identifier ?? "").toLowerCase().includes(q) ||
        (c.familyCode ?? "").toLowerCase().includes(q) ||
        (c.externalId ?? "").toLowerCase().includes(q)
      );
    });
  }, [boundCards, search, roleFilter]);

  const totalCount = boundCards.length;
  const studentCount = boundCards.filter((c) => c.kind === "customer").length;
  const staffCount = boundCards.filter((c) => c.kind === "user" && c.role === "staff").length;
  const parentCount = boundCards.filter((c) => c.kind === "user" && c.role === "parent").length;

  const detailHref = (c: BoundCard) =>
    c.kind === "user" ? `/users/${c.id}` : `/admin/customer/${c.id}`;

  const roleBadge = (c: BoundCard) => {
    if (c.kind === "customer") {
      return (
        <Badge variant="secondary" className="capitalize">
          {c.customerType || t("admin.cards.roleStudent")}
        </Badge>
      );
    }
    const label = t(`admin.cards.role.${c.role}`, { defaultValue: c.role });
    return <Badge variant="outline" className="capitalize">{label}</Badge>;
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <CreditCard className="h-7 w-7 text-primary" />
          {t("admin.cards.title")}
        </h1>
        <p className="page-description">{t("admin.cards.description")}</p>
      </div>

      <InfoCallout
        id="admin.cards.intro"
        variant="tip"
        title={t("admin.cards.info.intro.title")}
      >
        {t("admin.cards.info.intro.body")}
      </InfoCallout>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="kpi-card">
          <CardContent className="pt-5">
            <p className="kpi-label">{t("admin.cards.kpiTotal")}</p>
            <p className="kpi-value">{totalCount}</p>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardContent className="pt-5">
            <p className="kpi-label">{t("admin.cards.kpiStudents")}</p>
            <p className="kpi-value">{studentCount}</p>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardContent className="pt-5">
            <p className="kpi-label">{t("admin.cards.kpiStaff")}</p>
            <p className="kpi-value">{staffCount}</p>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardContent className="pt-5">
            <p className="kpi-label">{t("admin.cards.kpiParents")}</p>
            <p className="kpi-value">{parentCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("admin.cards.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as CardRole)}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.cards.filterAll")}</SelectItem>
            <SelectItem value="student">{t("admin.cards.role.student")}</SelectItem>
            <SelectItem value="staff">{t("admin.cards.role.staff")}</SelectItem>
            <SelectItem value="parent">{t("admin.cards.role.parent")}</SelectItem>
            <SelectItem value="admin">{t("admin.cards.role.admin")}</SelectItem>
            <SelectItem value="manager">{t("admin.cards.role.manager")}</SelectItem>
            <SelectItem value="cashier">{t("admin.cards.role.cashier")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CreditCard className="h-10 w-10 mb-3" />
              <p>{t("admin.cards.empty")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">{t("admin.cards.colUid")}</TableHead>
                  <TableHead>{t("admin.cards.colOwner")}</TableHead>
                  <TableHead className="w-28">{t("admin.cards.colRole")}</TableHead>
                  <TableHead>{t("admin.cards.colIdentifier")}</TableHead>
                  <TableHead className="w-32">{t("admin.cards.colFamilyCode")}</TableHead>
                  <TableHead className="w-32">{t("admin.cards.colExternalId")}</TableHead>
                  <TableHead className="w-20 text-right">{t("admin.cards.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCards.map((c) => (
                  <TableRow key={`${c.kind}-${c.id}`}>
                    <TableCell className="font-mono text-sm">{c.uid}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {c.photoUrl ? (
                          <img
                            src={c.photoUrl}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <UserCircle2 className="h-7 w-7 text-muted-foreground" />
                        )}
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{roleBadge(c)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-56">
                      {c.identifier || "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.familyCode || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.externalId || "-"}</TableCell>
                    <TableCell className="text-right">
                      <IconButton asChild tooltip={t("admin.cards.viewOwner")}>
                        <Link to={detailHref(c)}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
