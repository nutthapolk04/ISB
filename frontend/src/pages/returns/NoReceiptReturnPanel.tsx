import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { RefreshCw, Package, Plus, X, Minus } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import type { ReceiptItem, NoReceiptItem, ReturnRequest } from "./returnsTypes";

interface NoReceiptReturnPanelProps {
    currentShopId: string | null;
    onShopChange: (shopId: string) => void;
    onReturnCreated: () => void;
}

/** "Without receipt" return flow — shop pick, product search, manual line items, submit. */
export function NoReceiptReturnPanel({ currentShopId, onShopChange, onReturnCreated }: NoReceiptReturnPanelProps) {
    const { t } = useTranslation();

    const [noReceiptItems, setNoReceiptItems] = useState<NoReceiptItem[]>([]);
    const [noReceiptProductSearch, setNoReceiptProductSearch] = useState("");
    const [noReceiptSearchResults, setNoReceiptSearchResults] = useState<ReceiptItem[]>([]);
    const [noReceiptCustomerName, setNoReceiptCustomerName] = useState("");
    const [noReceiptNotes, setNoReceiptNotes] = useState("");
    const [noReceiptReason, setNoReceiptReason] = useState("");

    const handleNoReceiptProductSearch = async (query: string) => {
        setNoReceiptProductSearch(query);
        if (!query.trim() || !currentShopId) {
            setNoReceiptSearchResults([]);
            return;
        }

        try {
            const params = new URLSearchParams({ inStock: "false" });
            if (currentShopId) params.set("shop_id", currentShopId);
            const data = await api.get<{ productCode: string; productName: string; quantity: number; price: number }[]>(`/exchange/products?${params}`);
            const filtered = data.filter(
                (p) =>
                    p.productCode.toLowerCase().includes(query.toLowerCase()) ||
                    p.productName.toLowerCase().includes(query.toLowerCase())
            ).slice(0, 10);
            setNoReceiptSearchResults(filtered);
        } catch {
            setNoReceiptSearchResults([]);
        }
    };

    const handleAddNoReceiptItem = (product: ReceiptItem) => {
        // Check if already added
        if (noReceiptItems.some((i) => i.productCode === product.productCode)) {
            toast.error(t("returns.itemAlreadyAdded") || "Item already added");
            return;
        }
        setNoReceiptItems([
            ...noReceiptItems,
            {
                productCode: product.productCode,
                productName: product.productName,
                unitPrice: product.price,
                returnQuantity: 1,
                shopId: currentShopId || "",
            },
        ]);
        setNoReceiptProductSearch("");
        setNoReceiptSearchResults([]);
    };

    const handleRemoveNoReceiptItem = (productCode: string) => {
        setNoReceiptItems(noReceiptItems.filter((i) => i.productCode !== productCode));
    };

    const handleNoReceiptQuantityChange = (productCode: string, qty: number) => {
        if (qty < 1) return;
        setNoReceiptItems(
            noReceiptItems.map((i) =>
                i.productCode === productCode ? { ...i, returnQuantity: qty } : i
            )
        );
    };

    const handleSubmitNoReceiptReturn = async () => {
        if (noReceiptItems.length === 0) {
            toast.error(t("returns.errorSelectProducts") || "Please select products to return");
            return;
        }
        if (!noReceiptReason.trim()) {
            toast.error(t("returns.errorEnterReason") || "Please enter a reason");
            return;
        }

        try {
            const created = await api.post<ReturnRequest[] | ReturnRequest>("/returns/create-without-receipt", {
                items: noReceiptItems,
                reason: noReceiptReason.trim(),
                customerName: noReceiptCustomerName.trim() || null,
                notes: noReceiptNotes.trim() || null,
            });
            // Auto-approve immediately
            const ids = Array.isArray(created) ? created.map((r) => r.id) : [created.id];
            await Promise.all(ids.map((id) => api.put(`/returns/${id}`, { status: "approved" }).catch(() => { })));
            toast.success(t("returns.returnSuccess", "คืนสินค้าสำเร็จ"));
            await onReturnCreated();

            // Reset form
            setNoReceiptItems([]);
            setNoReceiptReason("");
            setNoReceiptCustomerName("");
            setNoReceiptNotes("");
        } catch (err: any) {
            toast.error(err?.detail || "Failed to create return");
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center text-xl">
                    <Package className="h-6 w-6 mr-2 text-primary" />
                    {t("returns.returnWithoutReceipt") || "Return Without Receipt"}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Shop selector */}
                <div>
                    <Label className="text-sm font-semibold">{t("returns.selectShop") || "Select Shop"}</Label>
                    <Select
                        value={currentShopId || ""}
                        onValueChange={onShopChange}
                    >
                        <SelectTrigger className="mt-1.5 max-w-xs">
                            <SelectValue placeholder={t("returns.selectShopPlaceholder") || "Select shop..."} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="coop">Coop Shop</SelectItem>
                            <SelectItem value="sports">Sports Shop</SelectItem>
                            <SelectItem value="bookstore">Bookstore</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Product search */}
                {currentShopId && (
                    <div>
                        <Label className="text-sm font-semibold">{t("returns.searchProduct") || "Search Product"}</Label>
                        <div className="relative mt-1.5">
                            <Input
                                placeholder={t("returns.searchProductPlaceholder") || "Search by code or name..."}
                                value={noReceiptProductSearch}
                                onChange={(e) => handleNoReceiptProductSearch(e.target.value)}
                                className="max-w-md"
                            />
                            {noReceiptSearchResults.length > 0 && (
                                <div className="absolute z-10 w-full max-w-md mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
                                    {noReceiptSearchResults.map((p) => (
                                        <div
                                            key={p.productCode}
                                            className="flex items-center justify-between p-3 hover:bg-muted cursor-pointer border-b last:border-b-0"
                                            onClick={() => handleAddNoReceiptItem(p)}
                                        >
                                            <div>
                                                <div className="font-medium">{p.productName}</div>
                                                <div className="text-sm text-muted-foreground">{p.productCode}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono">฿{p.price.toLocaleString()}</span>
                                                <Plus className="h-4 w-4 text-primary" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Selected items table */}
                {noReceiptItems.length > 0 && (
                    <div>
                        <Label className="text-sm font-semibold mb-2 block">{t("returns.itemsToReturn") || "Items to Return"}</Label>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("returns.product")}</TableHead>
                                    <TableHead className="text-center">{t("returns.price")}</TableHead>
                                    <TableHead className="text-center w-32">{t("returns.quantity")}</TableHead>
                                    <TableHead className="text-right">{t("returns.subtotal") || "Subtotal"}</TableHead>
                                    <TableHead className="w-12"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {noReceiptItems.map((item) => (
                                    <TableRow key={item.productCode}>
                                        <TableCell>
                                            <div className="font-medium">{item.productName}</div>
                                            <div className="text-sm text-muted-foreground">{item.productCode}</div>
                                        </TableCell>
                                        <TableCell className="text-center data-number">฿{item.unitPrice.toLocaleString()}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-center gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={() => handleNoReceiptQuantityChange(item.productCode, item.returnQuantity - 1)}
                                                    disabled={item.returnQuantity <= 1}
                                                >
                                                    <Minus className="h-3 w-3" />
                                                </Button>
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    value={item.returnQuantity}
                                                    onChange={(e) =>
                                                        handleNoReceiptQuantityChange(item.productCode, parseInt(e.target.value) || 1)
                                                    }
                                                    className="w-14 h-7 text-center"
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={() => handleNoReceiptQuantityChange(item.productCode, item.returnQuantity + 1)}
                                                >
                                                    <Plus className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right data-number font-medium">
                                            ฿{(item.unitPrice * item.returnQuantity).toLocaleString()}
                                        </TableCell>
                                        <TableCell>
                                            <IconButton
                                                tooltip={t("returns.remove") || "Remove"}
                                                variant="ghost"
                                                onClick={() => handleRemoveNoReceiptItem(item.productCode)}
                                            >
                                                <X className="h-4 w-4" />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        {/* Total */}
                        <div className="flex justify-end mt-4">
                            <div className="text-lg font-semibold">
                                {t("returns.total")}: ฿{noReceiptItems.reduce((sum, i) => sum + i.unitPrice * i.returnQuantity, 0).toLocaleString()}
                            </div>
                        </div>
                    </div>
                )}

                {/* Customer info & reason */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <Label className="text-sm font-semibold">{t("returns.customerName") || "Customer Name"}</Label>
                        <Input
                            placeholder={t("returns.customerNamePlaceholder") || "Optional customer name"}
                            value={noReceiptCustomerName}
                            onChange={(e) => setNoReceiptCustomerName(e.target.value)}
                            className="mt-1.5"
                        />
                    </div>
                    <div>
                        <Label className="text-sm font-semibold">{t("returns.notes") || "Notes"}</Label>
                        <Input
                            placeholder={t("returns.notesPlaceholder") || "Optional notes"}
                            value={noReceiptNotes}
                            onChange={(e) => setNoReceiptNotes(e.target.value)}
                            className="mt-1.5"
                        />
                    </div>
                </div>

                <div>
                    <Label className="text-sm font-semibold">{t("returns.reason")} *</Label>
                    <Textarea
                        placeholder={t("returns.reasonPlaceholder") || "Reason for return"}
                        value={noReceiptReason}
                        onChange={(e) => setNoReceiptReason(e.target.value)}
                        className="mt-1.5"
                        rows={2}
                    />
                </div>

                {/* Submit button */}
                <div className="flex justify-end">
                    <Button
                        onClick={handleSubmitNoReceiptReturn}
                        disabled={noReceiptItems.length === 0 || !noReceiptReason.trim()}
                    >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t("returns.submitReturn") || "Submit Return Request"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
