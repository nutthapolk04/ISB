/**
 * Family Lookup card for the Graduation Refund page.
 *
 * Lets a refund officer search the full customer/user dataset (not just refund
 * candidates) by famcode / student / parent identifiers, browse the entire
 * family roster — active, graduated, withdrawn — and trigger a refund on any
 * member with a positive wallet balance.
 *
 * Falls back to existing RefundCandidate shape when triggering the refund
 * dialog so we reuse the existing RefundDialog without duplicating logic.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Users as UsersIcon,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import {
  useRefundFamilySearch,
  useRefundFamilyRoster,
  type FamilyMatch,
  type FamilyMemberDetail,
} from "@/hooks/useRefundFamilyLookup";
import type { RefundCandidate } from "@/hooks/useRefund";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/dateFormat";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCurrency as formatTHB } from "@/lib/format";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";

interface FamilyLookupCardProps {
  /** Called when the user clicks "Refund" on a family member. */
  onRefundClick: (candidate: RefundCandidate) => void;
}

const formatDate = (iso: string | null): string => fmtDate(iso);

/** Map a FamilyMemberDetail (customer-typed) to the shared RefundCandidate
 * shape consumed by the existing RefundDialog. Returns null when the member
 * cannot be refunded (parent/staff entry, missing wallet, zero balance). */
function toRefundCandidate(m: FamilyMemberDetail): RefundCandidate | null {
  if (m.entity_type !== "customer") return null;
  if (m.wallet_id == null) return null;
  if (!(Number(m.wallet_balance) > 0)) return null;
  return {
    id: m.id,
    name: m.name,
    student_code: m.student_code,
    family_code: m.family_code,
    is_graduated: m.is_graduated,
    wallet_id: m.wallet_id,
    wallet_balance: Number(m.wallet_balance),
    enroll_date: m.enroll_date,
    withdraw_date: m.withdraw_date,
  };
}

function MemberAvatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  return (
    <img
      src={resolveAvatarUrl(photoUrl, name)}
      alt={name}
      className="h-8 w-8 rounded-full object-cover"
      onError={(e) => { e.currentTarget.src = getFallbackAvatar(name); }}
    />
  );
}

function StatusBadge({ member }: { member: FamilyMemberDetail }) {
  const { t } = useTranslation();
  if (member.is_active) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        {t("refund.familyLookup.status.active", "Active")}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 border-amber-300 bg-amber-50 text-amber-900">
      <XCircle className="h-3 w-3" aria-hidden="true" />
      {t("refund.familyLookup.status.inactive", "Inactive")}
    </Badge>
  );
}

export function FamilyLookupCard({ onRefundClick }: FamilyLookupCardProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);

  // 300ms debounce on the search input — avoids flooding the backend.
  const debounced = useDebounce(input.trim(), 300);

  const search = useRefundFamilySearch(debounced);
  const roster = useRefundFamilyRoster(selectedFamily);

  const matches = search.data?.items ?? [];
  const showDropdown =
    debounced.length >= 2 &&
    selectedFamily === null &&
    (search.isLoading || matches.length > 0 || search.isFetched);

  const handleSelectFamily = (fc: string) => {
    setSelectedFamily(fc);
    setInput(fc);
  };

  const handleClear = () => {
    setSelectedFamily(null);
    setInput("");
  };

  const totals = useMemo(() => {
    const members = roster.data?.members ?? [];
    return {
      total: members.length,
      active: members.filter((m) => m.entity_type === "customer" && m.is_active && !m.is_graduated).length,
      graduated: members.filter((m) => m.is_graduated).length,
      withdrawn: members.filter((m) => m.entity_type === "customer" && !m.is_active).length,
      totalBalance: members.reduce((s, m) => s + Number(m.wallet_balance ?? 0), 0),
    };
  }, [roster.data]);

  return (
    <Card className="mb-4 border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("refund.familyLookup.title", "Family Lookup")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(
            "refund.familyLookup.subtitle",
            "Verify a family before issuing a refund — search by family code, student name/code, or parent username/email.",
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Label htmlFor="family-lookup-search" className="text-xs text-muted-foreground">
            {t("refund.familyLookup.searchLabel", "Search")}
          </Label>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="family-lookup-search"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSelectedFamily(null);
              }}
              placeholder={t(
                "refund.familyLookup.searchPlaceholder",
                "Family code, student name, code, parent username or email",
              )}
              className="pl-8 pr-20"
              autoComplete="off"
            />
            {(input || selectedFamily) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 text-xs"
              >
                {t("refund.familyLookup.clear", "Clear")}
              </Button>
            )}
          </div>

          {/* Search results dropdown */}
          {showDropdown && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-80 overflow-auto">
              {search.isLoading ? (
                <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("refund.familyLookup.searching", "Searching…")}
                </div>
              ) : matches.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {t("refund.familyLookup.noMatches", "No families match this query.")}
                </div>
              ) : (
                <ul role="listbox" className="py-1">
                  {matches.map((m: FamilyMatch) => (
                    <li key={m.family_code}>
                      <button
                        type="button"
                        onClick={() => handleSelectFamily(m.family_code)}
                        className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-sm font-semibold truncate">
                            {m.family_code}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {m.sample_names.join(", ")}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 text-xs">
                          <Badge variant="outline">
                            {t("refund.familyLookup.match.members", "Members")}: {m.member_count}
                          </Badge>
                          {m.graduated_count > 0 && (
                            <Badge variant="success">
                              {t("refund.familyLookup.match.graduated", "Grad")}: {m.graduated_count}
                            </Badge>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Family roster */}
        {selectedFamily && (
          <div className="rounded-md border">
            <div
              className={cn(
                "px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <UsersIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-sm font-semibold">
                  {t("refund.familyLookup.roster.familyLabel", "Family")}{" "}
                  <span className="font-mono">{selectedFamily}</span>
                </span>
                {roster.isLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              {roster.data && (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <Badge variant="outline" className="gap-1">
                    {t("refund.familyLookup.roster.total", "Total")}: {totals.total}
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    {t("refund.familyLookup.roster.activeCount", "Active")}: {totals.active}
                  </Badge>
                  {totals.graduated > 0 && (
                    <Badge variant="success" className="gap-1">
                      {t("refund.familyLookup.roster.graduatedCount", "Graduated")}: {totals.graduated}
                    </Badge>
                  )}
                  {totals.withdrawn > 0 && (
                    <Badge variant="secondary" className="gap-1 border-amber-300 bg-amber-50 text-amber-900">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {t("refund.familyLookup.roster.withdrawnCount", "Withdrawn / inactive")}: {totals.withdrawn}
                    </Badge>
                  )}
                  <span className="ml-1 font-semibold tabular-nums">
                    {t("refund.familyLookup.roster.totalBalance", "Total balance")}: {formatTHB(totals.totalBalance)}
                  </span>
                </div>
              )}
            </div>

            {roster.isLoading ? (
              <div className="p-6 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </div>
            ) : roster.isError ? (
              <div className="p-6 text-sm text-destructive">
                {t("refund.familyLookup.roster.error", "Failed to load family roster.")}
              </div>
            ) : roster.data && roster.data.members.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="w-12" />
                    <TableHead scope="col">
                      {t("refund.familyLookup.col.name", "Name")}
                    </TableHead>
                    <TableHead scope="col">
                      {t("refund.familyLookup.col.identifier", "ID Number")}
                    </TableHead>
                    <TableHead scope="col" className="w-28">
                      {t("refund.familyLookup.col.type", "Type")}
                    </TableHead>
                    <TableHead scope="col" className="w-32">
                      {t("refund.familyLookup.col.status", "Status")}
                    </TableHead>
                    <TableHead scope="col" className="w-28">
                      {t("refund.familyLookup.col.enrollDate", "Enroll Date")}
                    </TableHead>
                    <TableHead scope="col" className="w-28">
                      {t("refund.familyLookup.col.withdrawDate", "Withdraw Date")}
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      {t("refund.familyLookup.col.balance", "Wallet")}
                    </TableHead>
                    <TableHead scope="col" className="w-28 text-right">
                      {t("refund.familyLookup.col.actions", "Actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.data.members.map((m) => {
                    const candidate = toRefundCandidate(m);
                    const refundable = candidate !== null;
                    const balance = Number(m.wallet_balance ?? 0);
                    return (
                      <TableRow key={`${m.entity_type}-${m.id}`}>
                        <TableCell>
                          <MemberAvatar photoUrl={m.photo_url} name={m.name} />
                        </TableCell>
                        <TableCell className="font-medium">
                          {m.name}
                          {m.grade && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {m.grade}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {m.entity_type === "customer"
                            ? m.student_code ?? m.customer_code ?? "—"
                            : m.username ?? m.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {m.entity_type === "customer"
                            ? t("refund.familyLookup.type.student", "Student")
                            : m.entity_type === "department"
                              ? t("refund.familyLookup.type.department", "Department")
                              : t("refund.familyLookup.type.parent", "Parent")}
                        </TableCell>
                        <TableCell>
                          <StatusBadge member={m} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {m.entity_type === "customer" ? formatDate(m.enroll_date) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {m.entity_type === "customer" && m.withdraw_date ? formatDate(m.withdraw_date) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {m.wallet_id == null
                            ? "—"
                            : formatTHB(balance)}
                        </TableCell>
                        <TableCell className="text-right">
                          {refundable ? (
                            <Button
                              size="sm"
                              onClick={() => onRefundClick(candidate!)}
                            >
                              {t("refund.familyLookup.action.refund", "Refund")}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {m.entity_type !== "customer"
                                ? t("refund.familyLookup.action.notRefundable", "—")
                                : m.wallet_id == null
                                  ? t("refund.familyLookup.action.noWallet", "No wallet")
                                  : t("refund.familyLookup.action.zeroBalance", "Zero balance")}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                {t("refund.familyLookup.roster.empty", "This family has no members.")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
