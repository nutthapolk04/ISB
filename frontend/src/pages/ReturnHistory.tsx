import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { History, Search, Eye, Loader2 } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

interface ReturnHistoryItem {
  id: string;
  date: string;
  receiptId: string;
  studentId: string;
  studentName: string;
  returnedItems: string[];
  exchangedItems: string[];
  returnValue: number;
  exchangeValue: number;
  difference: number;
  status: "approved" | "rejected" | "pending";
  reason: string;
}

const ReturnHistory = () => {
  const { t } = useTranslation();
  const [history, setHistory] = useState<ReturnHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedReturn, setSelectedReturn] = useState<ReturnHistoryItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<ReturnHistoryItem[]>("/return-history");
      setHistory(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const filteredHistory = history.filter(
    (item) =>
      item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.receiptId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.reason.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleViewDetails = (item: ReturnHistoryItem) => {
    setSelectedReturn(item);
    setIsDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title mb-2">{t("returnHistory.title", "ประวัติการเปลี่ยนสินค้า")}</h1>
        <p className="page-description">{t("returnHistory.description", "ดูประวัติการเปลี่ยนและคืนสินค้าทั้งหมด")}</p>
      </div>

      <InfoCallout
        id="returnHistory.readonly"
        variant="info"
        title={t("returnHistory.info.readonly.title", "มุมมองย้อนหลัง (Read-only)")}
      >
        {t("returnHistory.info.readonly.body", "หน้านี้ใช้ดูประวัติการคืน/เปลี่ยนสินค้าทั้งหมด ไม่สามารถแก้ไขได้ · ค่า 'มูลค่าคืน' ติดลบ (สีแดง) = ร้านจ่ายคืนให้ลูกค้า · 'มูลค่าเปลี่ยน' บวก = ลูกค้าจ่ายเพิ่ม")}
      </InfoCallout>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center">
              <History className="h-6 w-6 mr-2 text-primary" />
              <CardTitle>{t("returnHistory.allItems", "รายการทั้งหมด")}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("returnHistory.searchPlaceholder", "ค้นหาเลขที่ใบเสร็จ, เหตุผล...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:max-w-md"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <History className="h-10 w-10 mb-3" />
              <p>{t("returnHistory.noData", "ไม่มีประวัติการคืน/เปลี่ยนสินค้า")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("returnHistory.colId", "รหัส")}</TableHead>
                  <TableHead>{t("returnHistory.colDate", "วันที่")}</TableHead>
                  <TableHead>{t("returnHistory.colReceipt", "เลขที่ใบเสร็จ")}</TableHead>
                  <TableHead>{t("returnHistory.colItems", "สินค้าที่คืน")}</TableHead>
                  <TableHead>{t("returnHistory.colStatus", "สถานะ")}</TableHead>
                  <TableHead className="text-right">{t("returnHistory.colReturnValue", "มูลค่าคืน")}</TableHead>
                  <TableHead className="text-right">{t("returnHistory.colExchangeValue", "มูลค่าเปลี่ยน")}</TableHead>
                  <TableHead className="text-center">{t("returnHistory.colActions", "จัดการ")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">{item.id}</TableCell>
                    <TableCell>{item.date}</TableCell>
                    <TableCell className="font-medium">{item.receiptId}</TableCell>
                    <TableCell className="text-sm">{item.returnedItems.join(", ")}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === "approved" ? "success" : item.status === "rejected" ? "destructive" : "secondary"}>
                        {item.status === "approved" ? t("returns.approved", "อนุมัติ") : item.status === "rejected" ? t("returns.rejected", "ปฏิเสธ") : t("returns.pending", "รอ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-destructive font-semibold data-number">
                      ฿{item.returnValue.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-success font-semibold data-number">
                      ฿{item.exchangeValue.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <IconButton
                        tooltip={t("returnHistory.tooltip.view", "ดูรายละเอียด")}
                        onClick={() => handleViewDetails(item)}
                      >
                        <Eye className="h-4 w-4" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              {t("returnHistory.detailTitle", "รายละเอียดการเปลี่ยนสินค้า")}
            </DialogTitle>
            <DialogDescription>{t("returnHistory.colId", "รหัส")}: {selectedReturn?.id}</DialogDescription>
          </DialogHeader>
          {selectedReturn && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("returnHistory.colReceipt", "เลขที่ใบเสร็จ")}:</span>
                  <span className="text-sm font-medium">{selectedReturn.receiptId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("returnHistory.colDate", "วันที่")}:</span>
                  <span className="text-sm font-medium">{selectedReturn.date}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("returnHistory.colStatus", "สถานะ")}:</span>
                  <Badge variant={selectedReturn.status === "approved" ? "success" : "destructive"}>
                    {selectedReturn.status === "approved" ? t("returns.approved", "อนุมัติ") : t("returns.rejected", "ปฏิเสธ")}
                  </Badge>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <h4 className="font-semibold">{t("returnHistory.returnedItems", "สินค้าที่คืน")}:</h4>
                {selectedReturn.returnedItems.map((item, index) => (
                  <p key={index} className="text-sm text-muted-foreground">• {item}</p>
                ))}
              </div>
              {selectedReturn.exchangedItems.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-semibold">{t("returnHistory.exchangedItems", "สินค้าที่เปลี่ยน")}:</h4>
                    {selectedReturn.exchangedItems.map((item, index) => (
                      <p key={index} className="text-sm text-muted-foreground">• {item}</p>
                    ))}
                  </div>
                </>
              )}
              <Separator />
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">{t("returnHistory.colReturnValue", "มูลค่าคืน")}:</span>
                  <span className="text-sm font-semibold text-destructive data-number">฿{selectedReturn.returnValue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">{t("returnHistory.colExchangeValue", "มูลค่าเปลี่ยน")}:</span>
                  <span className="text-sm font-semibold text-success data-number">฿{selectedReturn.exchangeValue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>{t("returnHistory.difference", "ส่วนต่าง")}:</span>
                  <span className={`data-number ${selectedReturn.difference < 0 ? "text-destructive" : "text-success"}`}>
                    {selectedReturn.difference < 0 ? "-" : "+"}฿{Math.abs(selectedReturn.difference).toLocaleString()}
                  </span>
                </div>
              </div>
              <Separator />
              <div>
                <h4 className="font-semibold mb-2">{t("returnHistory.reason", "เหตุผล")}:</h4>
                <p className="text-sm text-muted-foreground">{selectedReturn.reason}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReturnHistory;
