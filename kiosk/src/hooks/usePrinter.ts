import { ref } from 'vue';
import { Hardware } from 'capacitor-hardware';
import { buildReceipt, type ReceiptData } from '../lib/escpos';

/**
 * 80mm USB thermal receipt printer (RMC800 / ESC-POS). Enumerates as a USB device
 * (e.g. /dev/bus/usb/001/004); the native plugin auto-detects the printer-class device
 * and handles USB permission, so no port/baud is needed here.
 */
const printerReady = ref(false);
const lastPrinterError = ref<string | null>(null);

/** Connect to the printer. Safe to call repeatedly; failures are non-fatal. */
export async function connectPrinter(): Promise<boolean> {
    try {
        const res = await Hardware.connectPrinter();
        printerReady.value = res.connected;
        lastPrinterError.value = null;
        return res.connected;
    } catch (e) {
        printerReady.value = false;
        lastPrinterError.value = e instanceof Error ? e.message : String(e);
        console.warn('[Printer] connect failed:', e);
        return false;
    }
}

/** Ensure a connection before printing — recovers if the boot-time connect failed. */
async function ensureConnected(): Promise<boolean> {
    if (printerReady.value) return true;
    return connectPrinter();
}

export function usePrinter() {
    async function printReceipt(data: ReceiptData): Promise<void> {
        if (!(await ensureConnected())) {
            throw new Error(lastPrinterError.value ?? 'Printer not connected');
        }
        const payload = await buildReceipt(data);
        try {
            await Hardware.printRaw({ data: payload });
        } catch (e) {
            // A stale handle (e.g. USB re-enumerated) — reconnect once and retry.
            printerReady.value = false;
            if (await ensureConnected()) {
                await Hardware.printRaw({ data: payload });
            } else {
                throw e;
            }
        }
    }

    return {
        printerReady,
        lastPrinterError,
        printReceipt,
        /** @deprecated Use printReceipt. */
        printTopupReceipt: printReceipt,
    };
}
