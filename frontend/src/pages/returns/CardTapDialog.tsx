import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard } from "lucide-react";

interface CardTapDialogProps {
    open: boolean;
    cardTapStep: "input" | "processing" | "success";
    transactionType: "refund" | "exchange";
    cardInputRef: RefObject<HTMLInputElement>;
    cardUidInput: string;
    onCardInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
    onCardInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    cardLookupError: string | null;
    onDismissLookupError: () => void;
    onConfirmTap: () => void;
    verifiedCardholder: { full_name: string; customer_code?: string } | null;
}

/** Card-tap verify + confirm dialog for the exchange transaction flow. */
export function CardTapDialog({
    open,
    cardTapStep,
    transactionType,
    cardInputRef,
    cardUidInput,
    onCardInputChange,
    onCardInputKeyDown,
    cardLookupError,
    onDismissLookupError,
    onConfirmTap,
    verifiedCardholder,
}: CardTapDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog open={open}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-center">
                        {cardTapStep === "success" ? t('returns.success') : t('returns.tapCard')}
                    </DialogTitle>
                    {cardTapStep !== "success" && (
                        <DialogDescription className="text-center font-semibold text-base">
                            {transactionType === "refund" ? t('returns.refundTransaction') : t('returns.exchangeTransaction')}
                        </DialogDescription>
                    )}
                </DialogHeader>

                <div className="flex flex-col items-center justify-center py-6">
                    {cardTapStep !== "success" ? (
                        <>
                            <div className="w-24 h-24 mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                                <CreditCard className={`w-12 h-12 text-primary ${cardTapStep === "processing" ? "animate-pulse" : ""}`} />
                            </div>
                            <p className="text-center text-sm text-muted-foreground mb-3">
                                {t("returns.tapCardPrompt", "Tap the student card, or type the UID / student code")}
                            </p>
                            <input
                                ref={cardInputRef}
                                type="text"
                                autoFocus
                                value={cardUidInput}
                                onChange={(e) => {
                                    onCardInputChange(e);
                                    if (cardLookupError) onDismissLookupError();
                                }}
                                onKeyDown={onCardInputKeyDown}
                                placeholder={t("returns.tapCardPlaceholder", "Tap card / 85001 / RFID-xxxx")}
                                disabled={cardTapStep === "processing"}
                                className="w-full mb-2 px-3 py-2 border rounded-md text-center font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                            />
                            {cardLookupError && (
                                <p className="text-xs text-destructive text-center mb-2">{cardLookupError}</p>
                            )}
                            <Button
                                onClick={onConfirmTap}
                                size="lg"
                                className="w-full"
                                disabled={cardTapStep === "processing" || !cardUidInput.trim()}
                            >
                                {cardTapStep === "processing" ? t("returns.verifying", "Verifying…") : t('returns.confirmTap')}
                            </Button>
                        </>
                    ) : (
                        <>
                            <div className="w-32 h-32 mb-6 rounded-full bg-success/10 flex items-center justify-center">
                                <svg
                                    className="w-16 h-16 text-success"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M5 13l4 4L19 7"
                                    />
                                </svg>
                            </div>
                            <p className="text-center text-lg font-semibold text-success">
                                {t('returns.dataSaved')}
                            </p>
                            {verifiedCardholder && (
                                <p className="text-center text-sm text-muted-foreground mt-2">
                                    {verifiedCardholder.full_name}
                                    {verifiedCardholder.customer_code && ` · ${verifiedCardholder.customer_code}`}
                                </p>
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
