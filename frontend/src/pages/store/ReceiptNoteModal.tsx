import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ReceiptNoteModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialNote: string;
    onSave: (note: string) => void;
}

/** Optional cashier memo attached to the receipt, edited via a draft field. */
export function ReceiptNoteModal({ open, onOpenChange, initialNote, onSave }: ReceiptNoteModalProps) {
    const { t } = useTranslation();
    const [localNote, setLocalNote] = useState("");

    useEffect(() => {
        if (open) setLocalNote(initialNote);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t("store.receiptNoteLabel", "Note")}</DialogTitle>
                </DialogHeader>
                <Textarea
                    placeholder={t("store.receiptNote", "Add a note to this receipt (optional)")}
                    value={localNote}
                    onChange={(e) => setLocalNote(e.target.value)}
                    rows={4}
                    maxLength={200}
                    autoFocus
                />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.cancel", "Cancel")}
                    </Button>
                    <Button onClick={() => { onSave(localNote); onOpenChange(false); }}>
                        {t("common.save", "Save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
