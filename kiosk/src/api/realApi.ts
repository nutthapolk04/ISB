/**
 * Real API client — connects kiosk to the ISB backend.
 *
 * Auth: kiosk service account (role=kiosk). Credentials are baked per device
 * via VITE_KIOSK_USERNAME / VITE_KIOSK_PASSWORD in .env.
 */

import type { User, Wallet, Transaction } from './mockApi';
import { cardUidLookupAttempts } from '../lib/cardUid';
import { getKioskDeviceId, getKioskDeviceName } from '../lib/kioskLog';
import { verifyTechnicianPassword as verifyTechnicianPasswordLib } from '../lib/technicianPassword';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)
    ?? 'http://localhost:8000/api/v1';

// ── ISB backend response shapes ───────────────────────────────────────────────

interface ISBTokenResponse {
    access_token: string;
    token_type: string;
}

interface ISBCustomerLookupResult {
    id: number;
    user_id?: number | null;  // set when result is from users table (parent/staff)
    name: string;
    student_code: string | null;
    customer_code: string | null;
    customer_kind?: string | null;
    grade: string | null;
    photo_url: string | null;
    wallet_balance: number;
    wallet_id: number | null;
    external_id?: string | null;
    card_frozen?: boolean;
    card_uid?: string | null;
}

interface ISBUserPayerLookup {
    user_id: number;
    username: string;
    full_name: string;
    role: string;
    photo_url: string | null;
    external_id: string | null;
    wallet_id: number;
    wallet_balance: number;
}

/** Thrown when a student card is found but blocked (card_frozen). */
export class CardBlockedError extends Error {
    constructor() {
        super('Card blocked');
        this.name = 'CardBlockedError';
    }
}

interface ISBChildSummary {
    link_id: number;
    relation: string;
    customer_id: number;
    customer_code: string;
    student_code?: string | null;
    name: string;
    grade?: string | null;
    photo_url?: string | null;
    wallet_id?: number | null;
    wallet_balance?: number | null;
    external_id?: string | null;
}

interface ISBCoParentSummary {
    user_id: number;
    full_name: string;
    relation: string | null;
    role?: string | null;
    wallet_id?: number | null;
    wallet_balance?: number | null;
    photo_url?: string | null;
    username: string;
    external_id?: string | null;
}

interface ISBFamilyResponse {
    children: ISBChildSummary[];
    coparents: ISBCoParentSummary[];
}

interface ISBWalletTransaction {
    id: number;
    wallet_id: number;
    transaction_type: string;   // 'TOPUP' | 'DEDUCTION' | 'REFUND' | 'ADJUSTMENT' | …
    amount: number;
    balance_before: number;
    balance_after: number;
    reference_type: string | null;
    reference_id: number | null;
    description: string | null;
    shop_id: string | null;
    shop_name: string | null;
    /** Set by backend for receipt / receipt_void rows. */
    is_voided?: boolean;
    receipt_number?: string | null;
    created_at: string;
}

export interface KioskProfile {
    user_id: number;
    username: string;
    full_name: string;
    role: string;
}

// ── Token manager ─────────────────────────────────────────────────────────────

type RequestOpts = { skipLog?: boolean };

let _token: string | null = null;

async function fetchToken(): Promise<string> {
    const username = import.meta.env.VITE_KIOSK_USERNAME as string;
    const password = import.meta.env.VITE_KIOSK_PASSWORD as string;

    if (!username || !password) {
        throw new Error('Kiosk credentials not configured. Set VITE_KIOSK_USERNAME and VITE_KIOSK_PASSWORD in .env');
    }

    const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
        throw new Error(`Kiosk login failed (${res.status}): check credentials`);
    }

    const data: ISBTokenResponse = await res.json();
    _token = data.access_token;
    return _token;
}

async function request<T>(path: string, retried = false, _opts: RequestOpts = {}): Promise<T> {
    const token = _token ?? await fetchToken();

    const res = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 && !retried) {
        _token = null;
        return request<T>(path, true, _opts);
    }

    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        } catch { /* ignore parse errors */ }
        throw new Error(detail);
    }

    return res.json() as Promise<T>;
}

async function requestPost<T>(path: string, body: unknown, retried = false, opts: RequestOpts = {}): Promise<T> {
    const token = _token ?? await fetchToken();

    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (res.status === 401 && !retried) {
        _token = null;
        return requestPost<T>(path, body, true, opts);
    }

    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const err = await res.json();
            if (err.detail) detail = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
        } catch { /* ignore parse errors */ }
        throw new Error(detail);
    }

    return res.json() as Promise<T>;
}

async function requestPatch<T>(path: string, body: unknown, retried = false, opts: RequestOpts = {}): Promise<T> {
    const token = _token ?? await fetchToken();

    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (res.status === 401 && !retried) {
        _token = null;
        return requestPatch<T>(path, body, true, opts);
    }

    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const err = await res.json();
            if (err.detail) detail = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
        } catch { /* ignore parse errors */ }
        throw new Error(detail);
    }

    return res.json() as Promise<T>;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

// Role-based wallet card colors — must match frontend ROLE_STYLES
const PARENT_GRADIENT = 'linear-gradient(135deg, #3b1f7e 0%, #6b3fa0 50%, #9b6fcf 100%)';
const STAFF_GRADIENT = 'linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #2dd4bf 100%)';
const STUDENT_GRADIENT = 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)';

function colorForRole(role: string | null | undefined): string {
    switch (role) {
        case 'parent': return PARENT_GRADIENT;
        case 'staff': return STAFF_GRADIENT;
        case 'student': return STUDENT_GRADIENT;
        default: return STAFF_GRADIENT;
    }
}

function mapCustomer(c: ISBCustomerLookupResult, family: ISBFamilyResponse = { children: [], coparents: [] }): User {
    const personalWallet: Wallet | null = c.wallet_id != null
        ? {
            id: String(c.wallet_id),
            type: 'personal',
            name: 'Personal Wallet',
            holderName: c.name,
            cardId: c.student_code ?? c.customer_code ?? String(c.id),
            balance: c.wallet_balance ?? 0,
            colorTheme: colorForRole(c.customer_kind),
            photoUrl: c.photo_url ?? undefined,
            role: c.customer_kind ?? null,
            externalId: c.external_id ?? null,
        }
        : null;

    const coparentWallets: Wallet[] = family.coparents
        .filter(cp => cp.wallet_id != null)
        .map(cp => ({
            id: String(cp.wallet_id),
            type: 'coparent' as const,
            name: `${cp.full_name}'s Wallet`,
            holderName: cp.full_name,
            cardId: cp.username,
            balance: cp.wallet_balance ?? 0,
            colorTheme: colorForRole(cp.role),
            photoUrl: cp.photo_url ?? undefined,
            role: cp.role ?? null,
            externalId: cp.external_id ?? null,
        }));

    const childWallets: Wallet[] = family.children
        .filter(ch => ch.wallet_id != null)
        .map(ch => ({
            id: String(ch.wallet_id),
            type: 'child' as const,
            name: `${ch.name}'s Wallet`,
            holderName: ch.name,
            cardId: ch.student_code ?? ch.customer_code,
            balance: ch.wallet_balance ?? 0,
            colorTheme: STUDENT_GRADIENT,
            photoUrl: ch.photo_url ?? undefined,
            role: 'student',
            externalId: ch.external_id ?? null,
        }));

    return {
        id: String(c.user_id ?? c.id),
        name: c.name,
        employeeId: c.student_code ?? c.customer_code ?? String(c.id),
        role: c.customer_kind ?? undefined,
        externalId: c.external_id ?? null,
        wallets: [...(personalWallet ? [personalWallet] : []), ...coparentWallets, ...childWallets],
        // Explicitly from c.user_id (not falling back to c.id like the
        // string `id` above) — null means a student scanned their own card,
        // where there's no users-table row to attribute a top-up to.
        actingUserId: c.user_id ?? null,
        // The complement: set only when the scan resolved to a customers row
        // directly (a student scanning their own card) rather than a users
        // row — lets a student's self top-up attribute to their own name.
        actingCustomerId: c.user_id == null ? c.id : null,
    };
}

function mapTransaction(tx: ISBWalletTransaction): Transaction {
    const dt = new Date(tx.created_at);
    // DB types: TOPUP | DEDUCTION | REFUND | ADJUSTMENT — balance diff is the
    // source of truth for credit vs debit, except void refunds which must not
    // look like a normal top-up (Parent Portal pairs them with the purchase).
    const isVoidRefund = tx.reference_type === 'receipt_void';
    const isCredit = tx.balance_after > tx.balance_before;
    const type: Transaction['type'] = isVoidRefund
        ? 'void_refund'
        : isCredit
            ? 'topup'
            : 'purchase';
    // Only the original purchase leg gets the Voided badge; the refund leg
    // already names itself as void_refund.
    const isVoided = type === 'purchase' && !!tx.is_voided;

    return {
        id: String(tx.id),
        type,
        date: dt.toLocaleDateString('en-CA'),   // YYYY-MM-DD
        time: dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        amount: Math.abs(tx.amount),
        machine: tx.shop_name ?? (isCredit ? 'Top-up' : tx.description) ?? 'ISB',
        balanceBefore: tx.balance_before,
        balanceAfter: tx.balance_after,
        isVoided,
        receiptNumber: tx.receipt_number ?? null,
        shop_name: tx.shop_name ?? undefined,
    };
}

function isNotFoundError(e: unknown): boolean {
    if (!(e instanceof Error)) return false;
    const msg = e.message.toLowerCase();
    return msg.includes('404')
        || msg.includes('not found')
        || msg.includes('card not bound');
}

async function requestGetOrNull<T>(path: string): Promise<T | null> {
    try {
        return await request<T>(path);
    } catch (e) {
        if (isNotFoundError(e)) return null;
        throw e;
    }
}

async function getByCardWithFallback<T>(pathPrefix: string, raw: string): Promise<T | null> {
    for (const attempt of cardUidLookupAttempts(raw)) {
        const hit = await requestGetOrNull<T>(`${pathPrefix}/${encodeURIComponent(attempt)}`);
        if (hit) return hit;
    }
    return null;
}

function userPayerToLookup(user: ISBUserPayerLookup): ISBCustomerLookupResult {
    return {
        id: user.user_id,
        user_id: user.user_id,
        name: user.full_name,
        student_code: null,
        customer_code: user.username,
        customer_kind: user.role,
        grade: null,
        photo_url: user.photo_url,
        wallet_balance: user.wallet_balance,
        wallet_id: user.wallet_id,
        external_id: user.external_id,
        card_frozen: false,
    };
}

async function buildUserFromLookup(exact: ISBCustomerLookupResult): Promise<User> {
    if (exact.card_frozen && exact.user_id == null) {
        throw new CardBlockedError();
    }

    let family: ISBFamilyResponse = { children: [], coparents: [] };
    if (exact.user_id != null) {
        try {
            family = await request<ISBFamilyResponse>(`/family/by-user/${exact.user_id}`);
        } catch (err) {
            console.warn('[Kiosk] /family/by-user failed:', err);
        }
    }

    return mapCustomer(exact, family);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const realApi = {
    /**
     * Look up a member by student code, employee ID, or RFID card UID.
     * Returns null if not found.
     */
    async checkBalance(identifier: string): Promise<User | null> {
        const q = identifier.trim();
        if (!q) return null;

        const customerByCard = await getByCardWithFallback<ISBCustomerLookupResult>('/customers/by-card', q);
        if (customerByCard) {
            return buildUserFromLookup(customerByCard);
        }

        const userByCard = await getByCardWithFallback<ISBUserPayerLookup>('/users/by-card', q);
        if (userByCard) {
            return buildUserFromLookup(userPayerToLookup(userByCard));
        }

        const byCode = await requestGetOrNull<ISBCustomerLookupResult>(
            `/customers/by-code/${encodeURIComponent(q)}`,
        );
        if (byCode) {
            return buildUserFromLookup(byCode);
        }

        const results = await request<ISBCustomerLookupResult[]>(
            `/customers/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        if (results.length === 0) return null;

        const lower = q.toLowerCase();
        const uidCandidates = new Set(cardUidLookupAttempts(q).map((c) => c.toLowerCase()));
        const exact = results.find((c) =>
            c.student_code?.toLowerCase() === lower
            || c.customer_code?.toLowerCase() === lower
            || (c.card_uid && uidCandidates.has(c.card_uid.toLowerCase())),
        );

        if (exact) {
            return buildUserFromLookup(exact);
        }

        if (results.length === 1) {
            return buildUserFromLookup(results[0]);
        }

        return null;
    },

    /**
     * Fetch the latest transactions for a wallet (by wallet ID string).
     */
    async getLatestTransactions(walletId: string, limit = 20): Promise<Transaction[]> {
        if (!walletId) return [];
        try {
            const txs = await request<ISBWalletTransaction[]>(
                `/wallets/${walletId}/transactions`,
            );
            return txs.slice(0, limit).map(mapTransaction);
        } catch {
            return [];
        }
    },

    /**
     * Pre-warm the auth token so the first user lookup is instant.
     */
    async init(): Promise<void> {
        await fetchToken();
    },

    async getKioskProfile(): Promise<KioskProfile> {
        return request<KioskProfile>('/kiosk/me');
    },

    /** Liveness ping — see kioskHeartbeat.ts, which calls this on an interval
     * independent of whether a member is currently tapped in. Uses the same
     * Bearer token (and auto-refresh-on-401) as every other kiosk call —
     * no separate credential payload needed since the kiosk is already
     * authenticated for the whole process lifetime. */
    async sendHeartbeat(): Promise<{ status: string }> {
        return requestPost<{ status: string }>('/kiosk/heartbeat', {}, false, { skipLog: true });
    },

    async updateKioskLocation(fullName: string): Promise<KioskProfile> {
        return requestPatch<KioskProfile>('/kiosk/me/location', { full_name: fullName });
    },

    verifyTechnicianPassword(password: string): boolean {
        return verifyTechnicianPasswordLib(password);
    },

    /** Uploads a batch of on-device event-log entries — see kioskLogUploader.ts,
     * which calls this on an interval and tracks its own "already sent" cursor. */
    async uploadKioskLogs(entries: Array<{ ts: string; level: string; category: string; message: string; data?: Record<string, unknown> }>): Promise<{ inserted: number }> {
        return requestPost<{ inserted: number }>('/kiosk/logs', { entries }, false, { skipLog: true });
    },

    /**
     * Top-up a wallet via kiosk (cashier-topup endpoint, kiosk role allowed).
     * Returns updated balance_after and the new transaction_id.
     *
     * `actingUserId`/`actingCustomerId` are the RFID-identified card owner's
     * id (from `store.currentUser.actingUserId`/`actingCustomerId`) — a
     * parent/staff scan sets the former, a student scanning their own card
     * (self top-up) sets the latter; at most one is ever non-null.
     */
    async topUp(
        walletId: string,
        amount: number,
        method: string,
        idempotencyKey?: string,
        actingUserId?: number | null,
        actingCustomerId?: number | null,
    ): Promise<{ balance_after: number; transaction_id: number }> {
        const location = getKioskDeviceName();
        const deviceId = getKioskDeviceId();
        const body: Record<string, unknown> = {
            amount,
            notes: `Kiosk top-up via ${method} @ ${location} (${deviceId})`,
        };
        if (idempotencyKey) {
            body.idempotency_key = idempotencyKey;
        }
        if (actingUserId != null) {
            body.acting_user_id = actingUserId;
        }
        if (actingCustomerId != null) {
            body.acting_customer_id = actingCustomerId;
        }
        const res = await requestPost<{
            wallet_id: number;
            customer_name: string;
            amount: number;
            balance_before: number;
            balance_after: number;
            transaction_id: number;
        }>(
            `/wallets/${walletId}/cashier-topup`,
            body,
        );
        return { balance_after: res.balance_after, transaction_id: res.transaction_id };
    },

    /**
     * `actingUserId`/`actingCustomerId` are the RFID-identified card owner's
     * id — persisted on the intent now since confirmation happens later,
     * asynchronously (BAY webhook/inquiry), with no request context to
     * thread it through at that point. At most one is ever non-null.
     */
    async createTopupIntent(
        walletId: string,
        amount: number,
        actingUserId?: number | null,
        actingCustomerId?: number | null,
    ): Promise<{ ref_code: string; qr_payload: string; status: string; payment_method: string }> {
        const location = getKioskDeviceName();
        const body: Record<string, unknown> = {
            amount,
            payment_method: 'bay_qr',
            remark: `Kiosk top-up via QR @ ${location}`,
        };
        if (actingUserId != null) {
            body.acting_user_id = actingUserId;
        }
        if (actingCustomerId != null) {
            body.acting_customer_id = actingCustomerId;
        }
        return requestPost(`/wallets/${walletId}/topup`, body);
    },

    async getTopupStatus(refCode: string): Promise<{
        ref_code: string;
        status: string;
        amount: number;
        payment_method: string;
        transaction_id?: number | null;
    }> {
        return request(`/wallets/topup/${refCode}/status`);
    },

    /**
     * Transfer money from the tapped parent's wallet to a linked family
     * member's wallet (child only — matches the parent-portal transfer
     * feature's family-link check). `actingUserId` is the RFID-identified
     * parent's user id; the backend verifies the family link against THAT
     * id rather than the kiosk service account's own id.
     */
    async transfer(
        fromWalletId: string,
        toWalletId: string,
        amount: number,
        note: string,
        actingUserId: number,
    ): Promise<{ from_balance_after: number; to_balance_after: number }> {
        return requestPost(`/wallets/transfer`, {
            from_wallet_id: Number(fromWalletId),
            to_wallet_id: Number(toWalletId),
            amount,
            note,
            acting_user_id: actingUserId,
        });
    },

    async getPublicSettings(): Promise<{ school_name: string; school_logo_url: string }> {
        try {
            const res = await fetch(`${BASE_URL}/admin/settings/public`);
            if (!res.ok) return { school_name: '', school_logo_url: '' };
            return res.json();
        } catch {
            return { school_name: '', school_logo_url: '' };
        }
    },
};
