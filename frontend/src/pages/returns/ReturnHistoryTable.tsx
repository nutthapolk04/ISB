import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Eye, Edit, Trash2 } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import type { ReturnRequest } from "./returnsTypes";

interface ReturnHistoryTableProps {
    returns: ReturnRequest[];
    onViewReceipt: (receiptId: string) => void;
    onEditReturn: (item: ReturnRequest) => void;
    onDeleteReturn: (item: ReturnRequest) => void;
}

/** Returns history table with its own search box. */
export function ReturnHistoryTable({ returns, onViewReceipt, onEditReturn, onDeleteReturn }: ReturnHistoryTableProps) {
    const { t } = useTranslation();
    const [historySearchTerm, setHistorySearchTerm] = useState("");

    const filteredReturns = returns.filter(
        (item) =>
            item.receiptId.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
            item.productName.toLowerCase().includes(historySearchTerm.toLowerCase())
    );

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle>{t('returns.history')}</CardTitle>
                    <div className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={t('returns.searchReceiptOrProduct')}
                            value={historySearchTerm}
                            onChange={(e) => setHistorySearchTerm(e.target.value)}
                            className="w-full sm:max-w-xs"
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('returns.date')}</TableHead>
                            <TableHead>{t('returns.receiptId')}</TableHead>
                            <TableHead>{t("returns.buyer")}</TableHead>
                            <TableHead>{t('returns.type')}</TableHead>
                            <TableHead>{t('returns.paymentMethod')}</TableHead>
                            <TableHead className="text-center">{t('returns.returnStatus')}</TableHead>
                            <TableHead className="text-center">{t('returns.status')}</TableHead>
                            <TableHead className="text-center">{t('returns.manage')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredReturns.map((item) => {
                            return (
                                <TableRow key={item.id}>
                                    <TableCell>{item.date}</TableCell>
                                    <TableCell className="font-medium">{item.receiptId}</TableCell>
                                    <TableCell>
                                        <span className="text-sm">{item.productName}</span>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={item.priceType === "internal" ? "default" : "secondary"}>
                                            {item.priceType === "internal" ? t('returns.internalUse') : t('returns.normalPrice')}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline">
                                            {item.receiptId}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge
                                            variant={
                                                item.returnStatus === "full-return" ? "default" :
                                                    item.returnStatus === "partial-return" ? "secondary" :
                                                        "outline"
                                            }
                                        >
                                            {item.returnStatus === "full-return" ? t('returns.fullReturn') :
                                                item.returnStatus === "partial-return" ? t('returns.partialReturn') :
                                                    t('returns.noReturn')}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge variant={item.status === "rejected" ? "destructive" : "success"}>
                                            {item.status === "rejected" ? t('returns.rejected', 'ปฏิเสธ') : t('returns.returned', 'คืนแล้ว')}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <div className="flex gap-2 justify-center">
                                            <IconButton
                                                size="sm"
                                                tooltip={t('returns.viewDetails')}
                                                onClick={() => onViewReceipt(item.receiptId)}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </IconButton>
                                            <IconButton
                                                size="sm"
                                                tooltip={t('returns.edit')}
                                                onClick={() => onEditReturn(item)}
                                            >
                                                <Edit className="h-4 w-4 text-primary" />
                                            </IconButton>
                                            <IconButton
                                                size="sm"
                                                tooltip={t('returns.delete')}
                                                onClick={() => onDeleteReturn(item)}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </IconButton>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
