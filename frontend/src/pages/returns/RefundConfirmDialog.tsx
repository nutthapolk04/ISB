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
import type { Receipt, SelectedItemsMap } from "./returnsTypes";
import { getPaymentMethodLabel, getRefundDestinationPreview } from "./returnsHelpers";

interface RefundConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    viewingReceipt: Receipt | null;
    selectedItems: SelectedItemsMap;
    onConfirm: () => void;
}

/** Refund confirmation — destination derived from original receipt. */
export function RefundConfirmDialog({ open, onOpenChange, viewingReceipt, selectedItems, onConfirm }: RefundConfirmDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('returns.confirmRefund', 'Confirm Refund')}</DialogTitle>
                    <DialogDescription>
                        {t(
                            'returns.confirmRefundDesc',
                            'The refund will be returned to the same payment source used on the original receipt.',
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-6">
                    {viewingReceipt && (() => {
                        const returnTotal = Object.entries(selectedItems)
                            .filter(([_, data]) => data.selected)
                            .reduce((sum, [productCode, data]) => {
                                const item = viewingReceipt?.items.find((i) => i.productCode === productCode);
                                return sum + (item ? item.price * data.returnQty : 0);
                            }, 0);
                        const dest = getRefundDestinationPreview(t, viewingReceipt);

                        return (
                            <div className="space-y-4">
                                <div className="bg-secondary p-4 rounded-lg space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-muted-foreground">
                                            {t('returns.originalPayment', 'Original payment')}:
                                        </span>
                                        <span className="font-semibold uppercase text-xs">
                                            {getPaymentMethodLabel(t, viewingReceipt.paymentMethod)}
                                        </span>
                                    </div>
                                    {viewingReceipt.payer && viewingReceipt.payer.label && (
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-muted-foreground">
                                                {t('returns.paidBy', 'Paid by')}:
                                            </span>
                                            <span className="font-medium text-sm">{viewingReceipt.payer.label}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="bg-primary/10 p-6 rounded-lg">
                                    <div className="text-center">
                                        <p className="text-sm text-muted-foreground mb-2">
                                            {t('returns.refundAmount')}
                                        </p>
                                        <p className="text-4xl font-bold text-primary data-number">
                                            ฿{returnTotal.toFixed(2)}
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-success/10 border border-success/30 p-3 rounded-lg space-y-1">
                                    <p className="text-xs text-muted-foreground">
                                        {t('returns.refundDestination', 'Refund destination')}
                                    </p>
                                    <p className="text-sm font-semibold">{dest.label}</p>
                                    {dest.hint && (
                                        <p className="text-xs text-muted-foreground">{dest.hint}</p>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('returns.cancel')}
                    </Button>
                    <Button onClick={onConfirm}>
                        {t('returns.confirmRefundAction', 'Confirm Refund')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
