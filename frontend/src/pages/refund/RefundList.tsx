import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap, Loader2, Inbox } from "lucide-react";
import { useRefundCandidates, type RefundCandidate } from "@/hooks/useRefund";
import { RefundDialog } from "@/components/refund/RefundDialog";
import { Card, CardContent } from "@/components/ui/card";
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

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function RefundList() {
  const { t } = useTranslation();
  const { data: candidates = [], isLoading } = useRefundCandidates();
  const [selectedCandidate, setSelectedCandidate] =
    useState<RefundCandidate | null>(null);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <GraduationCap className="h-7 w-7 text-primary" aria-hidden="true" />
          {t("refund.pageTitle")}
        </h1>
        <p className="page-description">{t("refund.pageDescription")}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div
              className="flex items-center justify-center py-12"
              role="status"
              aria-live="polite"
            >
              <Loader2
                className="h-6 w-6 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <span className="sr-only">{t("refund.pageTitle")}</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Inbox className="h-10 w-10 mb-3" aria-hidden="true" />
              <p>{t("refund.tableEmpty")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("refund.col.name")}</TableHead>
                  <TableHead scope="col">{t("refund.col.studentCode")}</TableHead>
                  <TableHead scope="col">{t("refund.col.familyCode")}</TableHead>
                  <TableHead scope="col" className="w-32">
                    {t("refund.col.status")}
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
                {candidates.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.student_code ?? "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.family_code ?? "-"}
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
                    <TableCell className="text-right font-mono font-semibold">
                      {formatTHB(c.wallet_balance)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => setSelectedCandidate(c)}
                        aria-label={t("refund.refundForCustomer", {
                          name: c.name,
                        })}
                      >
                        {t("refund.action.refund")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RefundDialog
        candidate={selectedCandidate}
        open={!!selectedCandidate}
        onClose={() => setSelectedCandidate(null)}
      />
    </div>
  );
}
