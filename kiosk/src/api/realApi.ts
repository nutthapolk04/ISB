/**
 * Real API client — connects kiosk to the ISB FastAPI backend.
 * Replaces mockApi.ts for production use.
 *
 * Auth: uses a kiosk service account (role=kiosk) whose credentials
 * are stored in .env (VITE_KIOSK_USERNAME / VITE_KIOSK_PASSWORD).
 * The JWT token is kept in memory and refreshed on 401.
 */

import type { User, Wallet, Transaction } from './mockApi';

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
}

interface ISBCoParentSummary {
  user_id: number;
  full_name: string;
  relation: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  photo_url?: string | null;
  username: string;
}

interface ISBFamilyResponse {
  children: ISBChildSummary[];
  coparents: ISBCoParentSummary[];
}

interface ISBWalletTransaction {
  id: number;
  wallet_id: number;
  transaction_type: string;   // 'topup' | 'debit' | 'credit' | 'transfer_debit' | 'transfer_credit'
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: number | null;
  description: string | null;
  shop_id: string | null;
  shop_name: string | null;
  created_at: string;
}

// ── Token manager ─────────────────────────────────────────────────────────────

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

async function request<T>(path: string, retried = false): Promise<T> {
  const token = _token ?? await fetchToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && !retried) {
    _token = null;
    return request<T>(path, true);
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

async function requestPost<T>(path: string, body: unknown, retried = false): Promise<T> {
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
    return requestPost<T>(path, body, true);
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

const CARD_GRADIENT = 'linear-gradient(135deg, #3b1f7e 0%, #6b3fa0 50%, #9b6fcf 100%)';
const CHILD_GRADIENT = 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)';

const COPARENT_GRADIENT = 'linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #2dd4bf 100%)';

function mapCustomer(c: ISBCustomerLookupResult, family: ISBFamilyResponse = { children: [], coparents: [] }): User {
  const personalWallet: Wallet | null = c.wallet_id != null
    ? {
        id: String(c.wallet_id),
        type: 'personal',
        name: 'Personal Wallet',
        holderName: c.name,
        cardId: c.student_code ?? c.customer_code ?? String(c.id),
        balance: c.wallet_balance ?? 0,
        colorTheme: CARD_GRADIENT,
        photoUrl: c.photo_url ?? undefined,
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
      colorTheme: COPARENT_GRADIENT,
      photoUrl: cp.photo_url ?? undefined,
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
      colorTheme: CHILD_GRADIENT,
      photoUrl: ch.photo_url ?? undefined,
    }));

  return {
    id: String(c.user_id ?? c.id),
    name: c.name,
    employeeId: c.student_code ?? c.customer_code ?? String(c.id),
    role: c.customer_kind ?? undefined,
    wallets: [...(personalWallet ? [personalWallet] : []), ...coparentWallets, ...childWallets],
  };
}

function mapTransaction(tx: ISBWalletTransaction): Transaction {
  const dt = new Date(tx.created_at);
  // DB types: 'topup' | 'deduction' | 'refund' | 'adjustment'
  // Use balance diff as source of truth — handles all types including adjustments
  const isCredit = tx.balance_after > tx.balance_before;

  return {
    id: String(tx.id),
    type: isCredit ? 'topup' : 'purchase',
    date: dt.toLocaleDateString('en-CA'),   // YYYY-MM-DD
    time: dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    amount: Math.abs(tx.amount),
    machine: tx.shop_name ?? (isCredit ? 'Top-up' : tx.description) ?? 'ISB',
    balanceBefore: tx.balance_before,
    balanceAfter: tx.balance_after,
  };
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

    try {
      const results = await request<ISBCustomerLookupResult[]>(
        `/customers/search?q=${encodeURIComponent(q)}&limit=10`,
      );

      if (results.length === 0) return null;

      // Prefer exact match on student_code / customer_code (case-insensitive)
      const lower = q.toLowerCase();
      const exact = results.find(
        c =>
          c.student_code?.toLowerCase() === lower ||
          c.customer_code?.toLowerCase() === lower,
      ) ?? results[0];

      // If this is a parent/staff User (not a student Customer), fetch family
      let family: ISBFamilyResponse = { children: [], coparents: [] };
      if (exact.user_id != null) {
        try {
          family = await request<ISBFamilyResponse>(`/family/by-user/${exact.user_id}`);
          console.log('[Kiosk] family for user', exact.user_id, family);
        } catch (err) {
          console.warn('[Kiosk] /family/by-user failed:', err);
        }
      }

      return mapCustomer(exact, family);
    } catch {
      return null;
    }
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
    try {
      await fetchToken();
    } catch (e) {
      console.warn('[KioskAPI] init: could not pre-warm token:', e);
    }
  },

  /**
   * Top-up a wallet via kiosk (cashier-topup endpoint, kiosk role allowed).
   * Returns updated balance_after and the new transaction_id.
   */
  async topUp(walletId: string, amount: number, method: string): Promise<{ balance_after: number; transaction_id: number }> {
    const res = await requestPost<{
      wallet_id: number;
      customer_name: string;
      amount: number;
      balance_before: number;
      balance_after: number;
      transaction_id: number;
    }>(
      `/wallets/${walletId}/cashier-topup`,
      { amount, notes: `Kiosk top-up via ${method}` },
    );
    return { balance_after: res.balance_after, transaction_id: res.transaction_id };
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
