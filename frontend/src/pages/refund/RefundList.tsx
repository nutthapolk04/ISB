import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GraduationCap,
  Loader2,
  Users as UsersIcon,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useRefundCandidates, type RefundCandidate } from "@/hooks/useRefund";
import { fmtDate } from "@/lib/dateFormat";
import { RefundDialog } from "@/components/refund/RefundDialog";
import { FamilyLookupCard } from "@/components/refund/FamilyLookupCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

const formatDate = (iso: string | null): string => fmtDate(iso);

interface FamilyGroup {
  familyCode: string | null; // null => "no family" bucket
  members: RefundCandidate[];
  totalBalance: number;
  familyTotalCount: number | null;
  familyActiveCount: number | null;
  // Derived: every refund-listed member is graduated AND no active siblings
  // in the broader family. Surface to refund officer as "safe to pay out".
  allGraduated: boolean;
}

function groupByFamily(candidates: RefundCandidate[]): FamilyGroup[] {
  const buckets = new Map<string, RefundCandidate[]>();
  for (const c of candidates) {
    const key = c.family_code ?? "__nofamily__";
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  const groups: FamilyGroup[] = [];
  for (const [key, members] of buckets.entries()) {
    const familyCode = key === "__nofamily__" ? null : key;
    const first = members[0];
    const familyTotalCount = first.family_total_count;
    const familyActiveCount = first.family_active_count;
    const totalBalance = members.reduce((s, m) => s + m.wallet_balance, 0);
    const everyListedGraduated = members.every((m) => m.is_graduated);
    const noActiveSiblings = familyActiveCount === null
      ? everyListedGraduated
      : familyActiveCount === 0;
    groups.push({
      familyCode,
      members,
      totalBalance,
      familyTotalCount,
      familyActiveCount,
      allGraduated: everyListedGraduated && noActiveSiblings,
    });
  }
  // Sort: "all graduated" families first (refund-ready), then by family code.
  groups.sort((a, b) => {
    if (a.allGraduated !== b.allGraduated) return a.allGraduated ? -1 : 1;
    const ak = a.familyCode ?? "zzz";
    const bk = b.familyCode ?? "zzz";
    return ak.localeCompare(bk);
  });
  return groups;
}

export default function RefundList() {
  const { t } = useTranslation();
  const { data: candidates = [], isLoading } = useRefundCandidates();
  const [selectedCandidate, setSelectedCandidate] =
    useState<RefundCandidate | null>(null);
  const filtered = candidates;

  const groups = useMemo(() => groupByFamily(filtered), [filtered]);

  const totalAllGraduated = groups.filter((g) => g.allGraduated).length;
  const totalHasActive = groups.length - totalAllGraduated;

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <GraduationCap className="h-7 w-7 text-primary" aria-hidden="true" />
          {t("refund.pageTitle")}
        </h1>
        <p className="page-description">{t("refund.pageDescription")}</p>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        <Badge variant="outline" className="gap-1">
          <UsersIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {t("refund.summary.families", "Families")}: {groups.length}
        </Badge>
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("refund.summary.allGraduated", "All graduated")}: {totalAllGraduated}
        </Badge>
        {totalHasActive > 0 && (
          <Badge variant="secondary" className="gap-1 border-amber-300 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {t("refund.summary.hasActive", "Has active students")}: {totalHasActive}
          </Badge>
        )}
      </div>

      {/* Pre-refund family lookup — works even when no candidates are loaded
          (e.g. while waiting for PowerSchool sync). */}
      <FamilyLookupCard onRefundClick={setSelectedCandidate} />


      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("refund.pageTitle")}</span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const familyLabel = g.familyCode
              ? g.familyCode
              : t("refund.family.noFamily", "(No family code)");
            return (
              <Card
                key={g.familyCode ?? "__nofamily__"}
                className={cn(
                  "overflow-hidden",
                  g.allGraduated
                    ? "border-emerald-200"
                    : "border-amber-200",
                )}
              >
                <CardHeader
                  className={cn(
                    "py-3 px-4 border-b flex flex-row items-center justify-between gap-3",
                    g.allGraduated ? "bg-emerald-50" : "bg-amber-50",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UsersIcon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        g.allGraduated ? "text-emerald-700" : "text-amber-700",
                      )}
                      aria-hidden="true"
                    />
                    <CardTitle className="text-sm font-semibold truncate">
                      {t("refund.family.label", "Family")}{" "}
                      <span className="font-mono">{familyLabel}</span>
                    </CardTitle>
                    {g.allGraduated ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        {t("refund.family.statusReady", "All graduated — refund OK")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1 border-amber-400 bg-amber-100 text-amber-900">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        {t("refund.family.statusBlocked", "Has active student(s) — review before refund")}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {g.familyTotalCount !== null && (
                      <span>
                        {t("refund.family.members", "Members")}: {g.familyTotalCount}
                        {" · "}
                        {t("refund.family.activeCount", "active")}: {g.familyActiveCount ?? 0}
                      </span>
                    )}
                    <span className="ml-3 font-semibold tabular-nums text-foreground">
                      {t("refund.family.totalBalance", "Total balance")}: {formatTHB(g.totalBalance)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">{t("refund.col.name")}</TableHead>
                        <TableHead scope="col">{t("refund.col.studentCode")}</TableHead>
                        <TableHead scope="col" className="w-32">
                          {t("refund.col.status")}
                        </TableHead>
                        <TableHead scope="col" className="w-36">
                          {t("refund.col.enrollDate", "Enroll date")}
                        </TableHead>
                        <TableHead scope="col" className="w-36">
                          {t("refund.col.withdrawDate", "Withdraw date")}
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          {t("refund.col.balance")}
                        </TableHead>
                        <TableHead scope="col" className="w-32 text-right">
                          {t("refund.col.actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.members.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {c.student_code ?? "—"}
                          </TableCell>
                          <TableCell>
                            {c.is_graduated ? (
                              <Badge variant="success">
                                {t("refund.status.graduated")}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                {t("refund.status.active")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(c.enroll_date)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(c.withdraw_date)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatTHB(c.wallet_balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={g.allGraduated ? "default" : "outline"}
                              onClick={() => setSelectedCandidate(c)}
                              aria-label={t("refund.refundForCustomer", { name: c.name })}
                            >
                              {t("refund.action.refund")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RefundDialog
        candidate={selectedCandidate}
        open={!!selectedCandidate}
        onClose={() => setSelectedCandidate(null)}
      />
    </div>
  );
}
