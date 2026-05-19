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
  name: string;
  student_code: string | null;
  customer_code: string | null;
  customer_kind?: string | null;
  grade: string | null;
  photo_url: string | null;
  wallet_balance: number;
  wallet_id: number | null;
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
    // Token expired — re-login once
    _token = null;
    return request<T>(path, true);
  }

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

const CARD_GRADIENT = 'linear-gradient(135deg, #3b1f7e 0%, #6b3fa0 50%, #9b6fcf 100%)';

function mapCustomer(c: ISBCustomerLookupResult): User {
  const wallet: Wallet | null = c.wallet_id != null
    ? {
        id: String(c.wallet_id),
        type: 'personal',
        name: 'Student Wallet',
        holderName: c.name,
        cardId: c.student_code ?? c.customer_code ?? String(c.id),
        balance: c.wallet_balance ?? 0,
        colorTheme: CARD_GRADIENT,
      }
    : null;

  return {
    id: String(c.id),
    name: c.name,
    employeeId: c.student_code ?? c.customer_code ?? String(c.id),
    wallets: wallet ? [wallet] : [],
  };
}

function mapTransaction(tx: ISBWalletTransaction): Transaction {
  const dt = new Date(tx.created_at);
  const isCredit = tx.transaction_type === 'topup'
    || tx.transaction_type === 'credit'
    || tx.transaction_type === 'transfer_credit';

  return {
    id: String(tx.id),
    type: isCredit ? 'topup' : 'purchase',
    date: dt.toLocaleDateString('en-CA'),   // YYYY-MM-DD
    time: dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    amount: Math.abs(tx.amount),
    machine: tx.shop_name ?? tx.description ?? 'ISB',
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

      return mapCustomer(exact);
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
};
