import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { History as HistoryIcon } from "lucide-react";
import { fmtDateTime } from "@/lib/dateFormat";
import type { IdentityHistoryItem } from "./userDetailTypes";

interface IdentityHistoryTableProps {
  history: IdentityHistoryItem[];
}

export function IdentityHistoryTable({ history }: IdentityHistoryTableProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <HistoryIcon className="h-5 w-5" /> {t("admin.users.identityHistory")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("admin.users.noIdentityHistory")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.users.colWhen")}</TableHead>
                <TableHead>Old</TableHead>
                <TableHead>New</TableHead>
                <TableHead>{t("admin.users.colReason")}</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{fmtDateTime(h.changed_at)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {h.old_external_id || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {h.new_external_id || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">{h.reason || "—"}</TableCell>
                  <TableCell className="text-xs">{h.changed_by_name || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
