import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { StudentLookupResult, UserPayerLookup } from "@/pages/canteen/RfidPaymentModal";
import type { Product } from "@/pages/store/storeTypes";

export interface StoreRfidNotif {
    key: number;
    type: "success" | "error";
    title: string;
    sub?: string;
}

interface UseStoreRfidScannerArgs {
    products: Product[];
    onProductMatch: (p: Product) => void;
    onMemberFound: (m: StudentLookupResult) => void;
}

/**
 * Passive RFID/barcode listener for the Store POS. Distinct from the generic
 * `useRfidListener` hook (used by Canteen): this one only acts when NO input
 * has focus (checked via `document.activeElement`) rather than gating on
 * fast-typing speed, and it dispatches to either a barcode-matched product or
 * a cardholder lookup depending on what was scanned.
 */
export function useStoreRfidScanner({ products, onProductMatch, onMemberFound }: UseStoreRfidScannerArgs) {
    const [notif, setNotif] = useState<StoreRfidNotif | null>(null);
    const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const notifKey = useRef(0);

    const buffer = useRef<string>("");
    const lastKey = useRef<number>(0);
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

    useEffect(() => {
        function userToStudent(u: UserPayerLookup): StudentLookupResult {
            return {
                id: u.user_id,
                name: u.full_name,
                photo_url: u.photo_url ?? null,
                customer_code: u.username,
                wallet_balance: u.wallet_balance,
                wallet_id: u.wallet_id,
                customer_kind: u.role,
                user_id: u.user_id,
            };
        }

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
                let result: StudentLookupResult | null = null;
                try {
                    result = await api.get<StudentLookupResult>(`/customers/by-card/${encodeURIComponent(trimmed)}`);
                } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
                if (!result) {
                    try {
                        const u = await api.get<UserPayerLookup>(`/users/by-card/${encodeURIComponent(trimmed)}`);
                        result = userToStudent(u);
                    } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
                }
                if (!result) {
                    try {
                        result = await api.get<StudentLookupResult>(`/customers/by-code/${encodeURIComponent(trimmed)}`);
                    } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
                }
                if (!result) {
                    try {
                        const u = await api.get<UserPayerLookup>(`/users/by-username/${encodeURIComponent(trimmed)}`);
                        result = userToStudent(u);
                    } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
                }
                if (result) {
                    onMemberFoundRef.current(result);
                    const bal = result.wallet_balance != null
                        ? `฿${Number(result.wallet_balance).toFixed(2)}`
                        : undefined;
                    showRfidNotif({ type: "success", title: result.name, sub: bal });
                }
                // No match (product barcode already handled elsewhere, and
                // none of the 4 member lookups above hit) — stay silent on
                // this page rather than surfacing a "Card not found" banner.
            } catch {
                // Same: swallow unexpected errors here too, silently.
            }
        }

        function handleKeyDown(e: KeyboardEvent) {
            // If the user has explicitly focused a text input (search box, dialog field,
            // price input, etc.), let keys flow through normally. The RFID handler only
            // acts when the page has no focused input.
            const ae = document.activeElement as HTMLElement | null;
            if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
                return;
            }

            const now = Date.now();
            const gap = now - lastKey.current;

            if (e.key === "Enter") {
                if (buffer.current.length >= 3) {
                    e.preventDefault();
                    e.stopPropagation();
                    const captured = buffer.current;
                    buffer.current = "";
                    lastKey.current = 0;
                    const scanned = captured.trim().toLowerCase();
                    const matchedProduct = productsRef.current.find(
                        (p) =>
                            p.barcode.toLowerCase() === scanned ||
                            (p.extraBarcodes ?? []).some((b) => b.barcode.toLowerCase() === scanned),
                    );
                    if (matchedProduct) {
                        onProductMatchRef.current(matchedProduct);
                    } else {
                        void lookupAndSet(captured);
                    }
                } else {
                    buffer.current = "";
                }
                return;
            }

            if (e.key.length !== 1) return;

            // Reset stale buffer if there's been a long pause (>500ms since last key)
            if (gap > 500 && buffer.current.length > 0) {
                buffer.current = "";
            }

            lastKey.current = now;
            buffer.current += e.key;

            // Always intercept — page has no focused input, so all keystrokes belong to RFID.
            e.preventDefault();
            e.stopPropagation();
        }

        document.addEventListener("keydown", handleKeyDown, true);
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, []);

    return { notif, dismissNotif };
}
