import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Link2, Trash2 } from "lucide-react";
import type { FamilyMember } from "./userDetailTypes";

interface LinkedStudentsTableProps {
  members: FamilyMember[];
  onAddLink: () => void;
  onUnlink: (customerId: number) => void;
}

export function LinkedStudentsTable({ members, onAddLink, onUnlink }: LinkedStudentsTableProps) {
  const { t } = useTranslation();
  const students = members.filter((m) => m.entity_type === "customer");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Link2 className="h-5 w-5" /> {t("admin.users.linkedStudents")}
        </CardTitle>
        <Button size="sm" onClick={onAddLink}>
          <Link2 className="h-4 w-4 mr-1" /> {t("admin.families.addLink")}
        </Button>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {t("admin.users.noLinkedStudents")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.users.colName")}</TableHead>
                <TableHead>{t("admin.users.colStudentCode")}</TableHead>
                <TableHead>{t("admin.users.colGrade")}</TableHead>
                <TableHead>{t("admin.users.colSchool")}</TableHead>
                <TableHead>Card UID</TableHead>
                <TableHead className="text-right">{t("admin.users.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="font-mono text-xs">{m.student_code || m.customer_code}</TableCell>
                  <TableCell>{m.grade || "—"}</TableCell>
                  <TableCell>
                    {m.school_type ? (
                      <Badge variant="outline" className="text-xs">{m.school_type.replace(" Student", "")}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{m.card_uid || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => onUnlink(m.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
