import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Plus, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import type { Receipt, ReceiptItem, ReturnRequest, SelectedItemsMap, ExchangeItemsMap } from "./returnsTypes";
import { itemKey } from "./returnsHelpers";

interface EditReturnDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingReturn: ReturnRequest | null;
    viewingReceipt: Receipt | null;
    selectedItems: SelectedItemsMap;
    setSelectedItems: Dispatch<SetStateAction<SelectedItemsMap>>;
    exchangeItems: ExchangeItemsMap;
    setExchangeItems: Dispatch<SetStateAction<ExchangeItemsMap>>;
    selectedExchangeProduct: string;
    setSelectedExchangeProduct: (v: string) => void;
    selectedExchangeQuantity: string;
    setSelectedExchangeQuantity: (v: string) => void;
    availableProducts: ReceiptItem[];
    editReason: string;
    setEditReason: (v: string) => void;
    onItemSelect: (item: ReceiptItem, isSelected: boolean, maxQty: number) => void;
    onQuantityChange: (item: ReceiptItem, qty: number, maxQty: number) => void;
    onCancel: () => void;
    onRequestRefund: () => void;
    onRequestExchange: () => void;
}

/** Edit an existing return — item selection + exchange product picker + price-diff summary. */
export function EditReturnDialog({
    open,
    onOpenChange,
    editingReturn,
    viewingReceipt,
    selectedItems,
    setSelectedItems,
    exchangeItems,
    setExchangeItems,
    selectedExchangeProduct,
    setSelectedExchangeProduct,
    selectedExchangeQuantity,
    setSelectedExchangeQuantity,
    availableProducts,
    editReason,
    setEditReason,
    onItemSelect,
    onQuantityChange,
    onCancel,
    onRequestRefund,
    onRequestExchange,
}: EditReturnDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('returns.editReturn')}</DialogTitle>
                    <DialogDescription>
                        {t('returns.editReturnDesc')}
                    </DialogDescription>
                </DialogHeader>
                {editingReturn && viewingReceipt && (
                    <div className="space-y-4">
                        <div className="bg-secondary p-4 rounded-lg space-y-2">
                            <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">{t('returns.receiptId')}:</span>
                                <span className="font-semibold">{editingReturn.receiptId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">{t('returns.date')}:</span>
                                <span className="font-semibold">{viewingReceipt.date}</span>
                            </div>
                        </div>

                        <Separator />

                        {/* Items Selection Table */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <Label className="text-base font-semibold">{t('returns.selectItems')}</Label>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const allSelected: SelectedItemsMap = {};
                                            viewingReceipt?.items.forEach((item) => {
                                                allSelected[itemKey(item)] = {
                                                    selected: true,
                                                    returnQty: item.quantity,
                                                    productCode: item.productCode,
                                                    bundleId: item.bundleId ?? null,
                                                };
                                            });
                                            setSelectedItems(allSelected);
                                            toast.success(t('returns.allSelected'));
                                        }}
                                    >
                                        {t('returns.selectAll')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const allDeselected: SelectedItemsMap = {};
                                            viewingReceipt?.items.forEach((item) => {
                                                allDeselected[itemKey(item)] = {
                                                    selected: false,
                                                    returnQty: 1,
                                                    productCode: item.productCode,
                                                    bundleId: item.bundleId ?? null,
                                                };
                                            });
                                            setSelectedItems(allDeselected);
                                            setExchangeItems({});
                                            toast.success(t('returns.allDeselected'));
                                        }}
                                    >
                                        {t('returns.cancelAll')}
                                    </Button>
                                </div>
                            </div>
                            <div className="border rounded-lg">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-12"></TableHead>
                                            <TableHead>{t('returns.product')}</TableHead>
                                            <TableHead className="text-center">{t('returns.price')}</TableHead>
                                            <TableHead className="text-center">{t('returns.quantityPurchased')}</TableHead>
                                            <TableHead className="text-center">{t('returns.quantityReturn')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {viewingReceipt.items.map((item) => {
                                            const k = itemKey(item);
                                            const isSelected = selectedItems[k]?.selected || false;
                                            const returnQty = selectedItems[k]?.returnQty || 1;

                                            return (
                                                <>
                                                    <TableRow key={k}>
                                                        <TableCell>
                                                            <Checkbox
                                                                checked={isSelected}
                                                                onCheckedChange={(checked) =>
                                                                    onItemSelect(item, checked as boolean, item.quantity)
                                                                }
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <div>
                                                                <p className="font-medium">{item.productName}</p>
                                                                <p className="text-xs text-muted-foreground">{t('returns.code')}: {item.productCode}</p>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-center data-number">฿{item.price}</TableCell>
                                                        <TableCell className="text-center data-number">{item.quantity}</TableCell>
                                                        <TableCell className="text-center">
                                                            {isSelected ? (
                                                                <Select
                                                                    value={returnQty.toString()}
                                                                    onValueChange={(value) =>
                                                                        onQuantityChange(item, parseInt(value), item.quantity)
                                                                    }
                                                                >
                                                                    <SelectTrigger className="w-24 mx-auto">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {Array.from({ length: item.quantity }, (_, i) => i + 1).map((num) => (
                                                                            <SelectItem key={num} value={num.toString()}>
                                                                                {num}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            ) : (
                                                                <span className="text-muted-foreground">-</span>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>

                                                    {/* Exchange Products Section - Show under selected item */}
                                                    {isSelected && (
                                                        <TableRow key={`${item.productCode}-exchange`} className="bg-secondary/10">
                                                            <TableCell colSpan={5} className="p-4">
                                                                <div className="space-y-3">
                                                                    <Label className="text-sm font-semibold text-muted-foreground">
                                                                        {t('returns.selectExchange')}
                                                                    </Label>

                                                                    {/* Add exchange product form */}
                                                                    <div className="flex gap-2">
                                                                        <div className="flex-1">
                                                                            <Select
                                                                                value={selectedExchangeProduct}
                                                                                onValueChange={setSelectedExchangeProduct}
                                                                            >
                                                                                <SelectTrigger>
                                                                                    <SelectValue placeholder={t('common.selectProduct')} />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    {availableProducts.map((product) => (
                                                                                        <SelectItem key={product.productCode} value={product.productCode}>
                                                                                            <span className="data-number">{product.productName} (฿{product.price}) - {t('store.stock')} {product.quantity}</span>
                                                                                        </SelectItem>
                                                                                    ))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </div>
                                                                        <div className="w-24">
                                                                            <Select
                                                                                value={selectedExchangeQuantity}
                                                                                onValueChange={setSelectedExchangeQuantity}
                                                                                disabled={!selectedExchangeProduct}
                                                                            >
                                                                                <SelectTrigger>
                                                                                    <SelectValue placeholder={t('common.quantity')} />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    {selectedExchangeProduct && (() => {
                                                                                        const product = availableProducts.find(p => p.productCode === selectedExchangeProduct);
                                                                                        const maxQty = Math.min(product?.quantity || 0, 20);
                                                                                        return Array.from({ length: maxQty }, (_, i) => i + 1).map((num) => (
                                                                                            <SelectItem key={num} value={num.toString()}>
                                                                                                {num}
                                                                                            </SelectItem>
                                                                                        ));
                                                                                    })()}
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </div>
                                                                        <Button
                                                                            type="button"
                                                                            size="icon"
                                                                            disabled={!selectedExchangeProduct}
                                                                            onClick={() => {
                                                                                if (selectedExchangeProduct) {
                                                                                    setExchangeItems({
                                                                                        ...exchangeItems,
                                                                                        [selectedExchangeProduct]: {
                                                                                            productCode: selectedExchangeProduct,
                                                                                            quantity: parseInt(selectedExchangeQuantity),
                                                                                        },
                                                                                    });
                                                                                    setSelectedExchangeProduct("");
                                                                                    setSelectedExchangeQuantity("1");
                                                                                    toast.success(t('returns.addProduct'));
                                                                                }
                                                                            }}
                                                                        >
                                                                            <Plus className="h-4 w-4" />
                                                                        </Button>
                                                                    </div>

                                                                    {/* List of selected exchange products */}
                                                                    {Object.keys(exchangeItems).length > 0 && (
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs text-muted-foreground">{t('returns.selectedProducts')}:</Label>
                                                                            {Object.entries(exchangeItems).map(([productCode, data]) => {
                                                                                const product = availableProducts.find(p => p.productCode === productCode);
                                                                                if (!product) return null;
                                                                                return (
                                                                                    <div key={productCode} className="flex items-center justify-between p-2 border rounded-lg bg-background">
                                                                                        <div className="flex-1">
                                                                                            <p className="text-sm font-medium">{product.productName}</p>
                                                                                            <p className="text-xs text-muted-foreground">
                                                                                                <span className="data-number">{t('common.quantity')}: {data.quantity} × ฿{product.price} = ฿{(data.quantity * product.price).toFixed(2)}</span>
                                                                                            </p>
                                                                                        </div>
                                                                                        <Button
                                                                                            type="button"
                                                                                            variant="ghost"
                                                                                            size="icon"
                                                                                            className="h-8 w-8"
                                                                                            onClick={() => {
                                                                                                const newExchangeItems = { ...exchangeItems };
                                                                                                delete newExchangeItems[productCode];
                                                                                                setExchangeItems(newExchangeItems);
                                                                                                toast.success(t('returns.removeProduct'));
                                                                                            }}
                                                                                        >
                                                                                            <X className="h-3 w-3" />
                                                                                        </Button>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>

                        {/* Price Difference Calculation - Only show if there are selected return items */}
                        {Object.values(selectedItems).some(item => item.selected) && <Separator />}
                        {Object.values(selectedItems).some(item => item.selected) && (() => {
                            const returnTotal = Object.entries(selectedItems)
                                .filter(([_, data]) => data.selected)
                                .reduce((sum, [productCode, data]) => {
                                    const item = viewingReceipt?.items.find((i) => i.productCode === productCode);
                                    return sum + (item ? item.price * data.returnQty : 0);
                                }, 0);

                            const exchangeTotal = Object.entries(exchangeItems).reduce((sum, [productCode, data]) => {
                                const product = availableProducts.find((p) => p.productCode === productCode);
                                return sum + (product ? product.price * data.quantity : 0);
                            }, 0);

                            const difference = exchangeTotal - returnTotal;

                            return (
                                <div className="bg-secondary p-4 rounded-lg space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">{t('returns.returnValue')}:</span>
                                        <span className="font-semibold data-number">฿{returnTotal.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">{t('returns.exchangeValue')}:</span>
                                        <span className="font-semibold data-number">฿{exchangeTotal.toFixed(2)}</span>
                                    </div>
                                    <Separator />
                                    <div className="flex justify-between text-lg font-bold">
                                        <span>
                                            {difference > 0 ? t('returns.customerPay') + ":" : difference < 0 ? t('returns.refundCustomer') + ":" : t('returns.noDifference') + ":"}
                                        </span>
                                        <span className={`data-number ${difference > 0 ? "text-destructive" : difference < 0 ? "text-success" : "text-primary"}`}>
                                            ฿{Math.abs(difference).toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}

                        {Object.values(selectedItems).some(item => item.selected) && <Separator />}

                        <div>
                            <Label htmlFor="editReason">{t('returns.reason')}</Label>
                            <Textarea
                                id="editReason"
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                                rows={4}
                                className="mt-1.5"
                                placeholder={t('returns.enterReason')}
                            />
                        </div>
                    </div>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        {t('returns.cancel')}
                    </Button>
                    <Button onClick={onRequestRefund} variant="secondary">
                        {t('returns.requestRefund')}
                    </Button>
                    <Button onClick={onRequestExchange}>
                        {t('returns.saveExchange')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
