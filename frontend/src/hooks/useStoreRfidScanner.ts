import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { lookupPosMemberPassive } from "@/lib/posCardLookup";
import type { StudentLookupResult } from "@/pages/canteen/RfidPaymentModal";
import type { Product } from "@/pages/store/storeTypes";

export interface StoreRfidNotif {
    key: number;
    type: "success" | "error";
    title: string;
    sub?: string;
}

/** Idle delay after the last keystroke before auto-flushing the scan buffer.
 *  Covers barcode guns that send no Enter/Tab suffix. */
const SCAN_IDLE_FLUSH_MS = 80;

function isTextInputFocused(): boolean {
    const ae = document.activeElement as HTMLElement | null;
    return Boolean(
        ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable),
    );
}

interface UseStoreRfidScannerArgs {
    products: Product[];
    onProductMatch: (p: Product) => void;
    onMemberFound: (m: StudentLookupResult) => void;
}

/**
 * Passive RFID/barcode listener for the Store POS. Dual-path like the generic
 * `useRfidListener` (used by Canteen): a PC/SC WebSocket bridge
 * (ws://localhost:9001, for the physical ACR1252 reader) plus a keyboard
 * fallback for keyboard-emulation readers/barcode guns. Both paths dispatch
 * to either a barcode-matched product or a cardholder lookup depending on
 * what was scanned. The keyboard path only acts when no input has focus
 * (checked via `document.activeElement`).
 */
export function useStoreRfidScanner({ products, onProductMatch, onMemberFound }: UseStoreRfidScannerArgs) {
    const { t } = useTranslation();
    const [notif, setNotif] = useState<StoreRfidNotif | null>(null);
    const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const notifKey = useRef(0);

    // Keyboard path state
    const buffer = useRef<string>("");
    const lastKey = useRef<number>(0);
    const idleFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // WebSocket path state
    const wsRef = useRef<WebSocket | null>(null);
    const wsReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const productsRef = useRef<Product[]>(products);
    const onProductMatchRef = useRef(onProductMatch);
    const onMemberFoundRef = useRef(onMemberFound);

    useEffect(() => { productsRef.current = products; }, [products]);
    useEffect(() => { onProductMatchRef.current = onProductMatch; }, [onProductMatch]);
    useEffect(() => { onMemberFoundRef.current = onMemberFound; }, [onMemberFound]);

    const dismissNotif = () => {
        if (notifTimer.current) clearTimeout(notifTimer.current);
        setNotif(null);
    };

    function showRfidNotif(notif: { type: "success" | "error"; title: string; sub?: string }) {
        if (notifTimer.current) clearTimeout(notifTimer.current);
        notifKey.current += 1;
        setNotif({ ...notif, key: notifKey.current });
        notifTimer.current = setTimeout(() => setNotif(null), 2500);
    }

    async function lookupAndSet(q: string) {
        const trimmed = q.trim();
        if (!trimmed || trimmed.length < 3) return;
        try {
            const result = await lookupPosMemberPassive(trimmed, { tryUsername: true });
            if (result) {
                onMemberFoundRef.current(result);
                const bal = result.wallet_balance != null
                    ? `฿${Number(result.wallet_balance).toFixed(2)}`
                    : undefined;
                showRfidNotif({ type: "success", title: result.name, sub: bal });
            } else {
                showRfidNotif({
                    type: "error",
                    title: t("store.scanNotFound"),
                    sub: trimmed,
                });
            }
        } catch {
            showRfidNotif({
                type: "error",
                title: t("store.scanLookupError"),
                sub: trimmed,
            });
        }
    }

    // Shared by both the keyboard path and the PC/SC WebSocket path: a scanned
    // barcode always wins over a member lookup so a product barcode that
    // happens to also resemble a card UID still adds to cart.
    function routeScan(scanned: string) {
        const normalized = scanned.trim().toLowerCase();
        const matchedProduct = productsRef.current.find(
            (p) =>
                p.barcode.toLowerCase() === normalized ||
                p.productCode.toLowerCase() === normalized ||
                (p.extraBarcodes ?? []).some((b) => b.barcode.toLowerCase() === normalized),
        );
        if (matchedProduct) {
            onProductMatchRef.current(matchedProduct);
            showRfidNotif({
                type: "success",
                title: matchedProduct.name,
                sub: t("store.scanProductAdded"),
            });
        } else {
            void lookupAndSet(scanned);
        }
    }

    function clearIdleFlushTimer() {
        if (idleFlushTimer.current) {
            clearTimeout(idleFlushTimer.current);
            idleFlushTimer.current = null;
        }
    }

    function commitBuffer() {
        clearIdleFlushTimer();
        const captured = buffer.current;
        buffer.current = "";
        lastKey.current = 0;

        if (captured.length >= 3) {
            routeScan(captured);
        } else if (captured.length > 0) {
            showRfidNotif({
                type: "error",
                title: t("store.scanTooShort"),
                sub: captured,
            });
        }
    }

    function scheduleIdleFlush() {
        clearIdleFlushTimer();
        idleFlushTimer.current = setTimeout(() => {
            idleFlushTimer.current = null;
            if (buffer.current.length === 0) return;
            commitBuffer();
        }, SCAN_IDLE_FLUSH_MS);
    }

    function flushScanBuffer(e: KeyboardEvent) {
        if (buffer.current.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        commitBuffer();
    }

    // PC/SC WebSocket path — try to connect to rfid-bridge on ws://localhost:9001.
    // This is how the physical ACR1252 reader actually reaches the browser;
    // the keyboard path below is a fallback for keyboard-emulation readers.
    useEffect(() => {
        const connectWebSocket = () => {
            try {
                const ws = new WebSocket("ws://localhost:9001");

                ws.onopen = () => {
                    wsRef.current = ws;
                    if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === "card_detected" && data.uid) {
                            routeScan(data.uid);
                        }
                    } catch (err) {
                        console.warn("Failed to parse WebSocket message:", err);
                    }
                };

                ws.onerror = (err) => {
                    console.debug("RFID WebSocket error (PC/SC bridge may not be running):", err);
                };

                ws.onclose = () => {
                    wsRef.current = null;
                    if (!wsReconnectTimer.current) {
                        wsReconnectTimer.current = setTimeout(connectWebSocket, 3000);
                    }
                };
            } catch (err) {
                console.debug("Failed to create WebSocket:", err);
                if (!wsReconnectTimer.current) {
                    wsReconnectTimer.current = setTimeout(connectWebSocket, 3000);
                }
            }
        };

        connectWebSocket();

        return () => {
            if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
            if (wsRef.current) wsRef.current.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            // If the user has explicitly focused a text input (search box, dialog field,
            // price input, etc.), let keys flow through normally. The RFID handler only
            // acts when the page has no focused input.
            if (isTextInputFocused()) {
                return;
            }

            const now = Date.now();
            const gap = now - lastKey.current;

            // Many barcode guns send Tab (not Enter) as suffix — treat both as scan end.
            if (e.key === "Enter" || e.key === "NumpadEnter" || e.key === "Tab") {
                flushScanBuffer(e);
                return;
            }

            if (e.key.length !== 1) return;

            // Reset stale buffer if there's been a long pause (>500ms since last key)
            if (gap > 500 && buffer.current.length > 0) {
                clearIdleFlushTimer();
                buffer.current = "";
            }

            lastKey.current = now;
            buffer.current += e.key;
            scheduleIdleFlush();

            // Always intercept — page has no focused input, so all keystrokes belong to RFID.
            e.preventDefault();
            e.stopPropagation();
        }

        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            document.removeEventListener("keydown", handleKeyDown, true);
            clearIdleFlushTimer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { notif, dismissNotif };
}
