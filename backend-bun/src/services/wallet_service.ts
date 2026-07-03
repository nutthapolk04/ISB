import { and, eq, gte, lte, inArray, asc, desc, sql, or } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import {
  wallets,
  walletTransactions,
  customers,
  users,
  departments,
  parentChildLinks,
  receipts,
  shops,
  paymentIntents,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

const MAX_WALLET_BALANCE = 50_000;
const WALLET_USER_ROLES = new Set(["parent", "staff", "cashier", "manager", "kitchen", "admin"]);

export interface WalletResponseDTO {
  id: number;
  owner_type: "customer" | "user" | "department";
  customer_id: number | null;
  user_id: number | null;
  department_id: number | null;
  balance: number;
  is_active: boolean;
  name: string | null;
  photo_url: string | null;
  customer_code: string | null;
  student_code: string | null;
  card_uid: string | null;
  grade: string | null;
  card_frozen: boolean | null;
  daily_limit: number | null;
  username: string | null;
  role: string | null;
  department_code: string | null;
}

export interface WalletTransactionResponseDTO {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: number | null;
  description: string | null;
  shop_id: string | null;
  shop_name: string | null;
  confirmed_via: string | null;
  created_at: string;
}

type WalletRow = typeof wallets.$inferSelect;

async function enrichWallet(w: WalletRow): Promise<WalletResponseDTO> {
  const base = {
    id: w.id,
    balance: pgNumber(w.balance) ?? 0,
    is_active: w.isActive,
    customer_id: null as number | null,
    user_id: null as number | null,
    department_id: null as number | null,
    name: null as string | null,
    photo_url: null as string | null,
    customer_code: null as string | null,
    student_code: null as string | null,
    card_uid: null as string | null,
    grade: null as string | null,
    card_frozen: null as boolean | null,
    daily_limit: null as number | null,
    username: null as string | null,
    role: null as string | null,
    department_code: null as string | null,
  };

  if (w.userId !== null) {
    const ur = await db.select().from(users).where(eq(users.id, w.userId)).limit(1);
    const u = ur[0];
    return {
      ...base,
      owner_type: "user",
      user_id: w.userId,
      name: u?.fullName ?? null,
      photo_url: u?.photoUrl ?? null,
      username: u?.username ?? null,
      card_uid: u?.cardUid ?? null,
      role: u?.role ?? null,
    };
  }
  if (w.departmentId !== null) {
    const dr = await db.select().from(departments).where(eq(departments.id, w.departmentId)).limit(1);
    const d = dr[0];
    return {
      ...base,
      owner_type: "department",
      department_id: w.departmentId,
      name: d?.departmentName ?? null,
      department_code: d?.departmentCode ?? null,
    };
  }
  if (w.customerId !== null) {
    const cr = await db.select().from(customers).where(eq(customers.id, w.customerId)).limit(1);
    const c = cr[0];
    return {
      ...base,
      owner_type: "customer",
      customer_id: w.customerId,
      name: c?.name ?? null,
      photo_url: c?.photoUrl ?? null,
      customer_code: c?.customerCode ?? null,
      student_code: c?.studentCode ?? null,
      card_uid: c?.cardUid ?? null,
      grade: c?.grade ?? null,
      card_frozen: c?.cardFrozen ?? null,
      daily_limit: c ? pgNumber(c.dailyLimit) : null,
    };
  }
  return { ...base, owner_type: "customer" };
}

async function ensureWalletForUser(userId: number): Promise<WalletRow> {
  const existing = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(wallets)
    .values({ userId, balance: "0", isActive: true })
    .returning();
  return created;
}

export async function ensureWalletForDepartment(departmentId: number): Promise<WalletRow> {
  const existing = await db.select().from(wallets).where(eq(wallets.departmentId, departmentId)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(wallets)
    .values({ departmentId, balance: "0", isActive: true })
    .returning();
  return created;
}

export async function ensureWalletForCustomer(customerId: number): Promise<WalletRow> {
  const existing = await db.select().from(wallets).where(eq(wallets.customerId, customerId)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(wallets)
    .values({ customerId, balance: "0", isActive: true })
    .returning();
  return created;
}

export async function getMyWallet(caller: AccessTokenPayload): Promise<WalletResponseDTO | null> {
  const role = (caller.roles[0] ?? "").toLowerCase();
  if (WALLET_USER_ROLES.has(role) || caller.is_superuser) {
    const w = await ensureWalletForUser(Number(caller.sub));
    return enrichWallet(w);
  }
  // Student: match by username == student_code or customer_code
  const cr = await db
    .select()
    .from(customers)
    .where(or(eq(customers.studentCode, caller.username), eq(customers.customerCode, caller.username)))
    .limit(1);
  if (!cr[0]) return null;
  const w = await ensureWalletForCustomer(cr[0].id);
  return enrichWallet(w);
}

export async function listFamilyWallets(caller: AccessTokenPayload): Promise<WalletResponseDTO[]> {
  const role = (caller.roles[0] ?? "").toLowerCase();
  if (role === "student") {
    const cr = await db
      .select()
      .from(customers)
      .where(eq(customers.studentCode, caller.username))
      .limit(1);
    if (!cr[0]) return [];
    const w = await ensureWalletForCustomer(cr[0].id);
    return [await enrichWallet(w)];
  }

  const userId = Number(caller.sub);
  const own = await ensureWalletForUser(userId);
  const links = await db
    .select({ childId: parentChildLinks.childCustomerId })
    .from(parentChildLinks)
    .where(eq(parentChildLinks.parentUserId, userId));

  const childWallets: WalletRow[] = [];
  for (const link of links) {
    const w = await ensureWalletForCustomer(link.childId);
    childWallets.push(w);
  }

  const all = [own, ...childWallets];
  return Promise.all(all.map(enrichWallet));
}

async function userCanAccessWallet(
  caller: AccessTokenPayload & { shop_id?: string | null; family_code?: string | null },
  wallet: WalletRow,
): Promise<boolean> {
  if (caller.is_superuser || caller.roles.includes("admin") || caller.roles.includes("kiosk")) return true;
  if (wallet.departmentId !== null) return false;
  const callerId = Number(caller.sub);
  if (wallet.userId !== null && wallet.userId === callerId) return true;
  if (wallet.userId !== null && caller.family_code) {
    const owner = await db.select({ familyCode: users.familyCode }).from(users).where(eq(users.id, wallet.userId)).limit(1);
    if (owner[0]?.familyCode && owner[0].familyCode === caller.family_code) return true;
  }
  if (wallet.customerId !== null) {
    if (caller.roles.includes("student")) {
      const c = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.studentCode, caller.username))
        .limit(1);
      return c[0]?.id === wallet.customerId;
    }
    // POS terminal (cashier/manager) can view any customer wallet —
    // mirrors topup_service.userCanAccessWallet so balance/history lookups
    // succeed after a cashier-initiated top-up.
    if (caller.roles.includes("cashier") || caller.roles.includes("manager")) {
      return true;
    }
    const link = await db
      .select()
      .from(parentChildLinks)
      .where(and(eq(parentChildLinks.parentUserId, callerId), eq(parentChildLinks.childCustomerId, wallet.customerId)))
      .limit(1);
    return !!link[0];
  }
  return false;
}

export async function getWallet(
  caller: AccessTokenPayload & { shop_id?: string | null; family_code?: string | null },
  walletId: number,
): Promise<WalletResponseDTO> {
  const wr = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  if (!wr[0]) {
    const err = new Error("Wallet not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!(await userCanAccessWallet(caller, wr[0]))) {
    const err = new Error("Not authorized to view this wallet");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return enrichWallet(wr[0]);
}

export async function listTransactions(
  caller: AccessTokenPayload & { shop_id?: string | null; family_code?: string | null },
  walletId: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<WalletTransactionResponseDTO[]> {
  const wr = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  if (!wr[0]) {
    const err = new Error("Wallet not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!(await userCanAccessWallet(caller, wr[0]))) {
    const err = new Error("Not authorized");
    (err as { status?: number }).status = 403;
    throw err;
  }

  const conds = [eq(walletTransactions.walletId, walletId)];
  if (dateFrom) conds.push(gte(walletTransactions.createdAt, `${dateFrom}T00:00:00+07:00`));
  if (dateTo) conds.push(lte(walletTransactions.createdAt, `${dateTo}T23:59:59.999999+07:00`));

  const txs = await db
    .select()
    .from(walletTransactions)
    .where(and(...conds))
    .orderBy(desc(walletTransactions.createdAt));

  // Enrich with shop_id/shop_name for receipt-referenced rows
  const receiptIds = txs
    .filter((t) => (t.referenceType === "receipt" || t.referenceType === "receipt_void") && t.referenceId !== null)
    .map((t) => t.referenceId!) as number[];
  const shopMap = new Map<number, { shopId: string | null; shopName: string | null }>();
  if (receiptIds.length > 0) {
    const rows = await db
      .select({
        rid: receipts.id,
        shopId: receipts.shopId,
        shopName: shops.name,
      })
      .from(receipts)
      .leftJoin(shops, eq(shops.id, receipts.shopId))
      .where(inArray(receipts.id, receiptIds));
    rows.forEach((r) => shopMap.set(r.rid, { shopId: r.shopId, shopName: r.shopName }));
  }

  // For payment_intent-referenced topup rows: pull confirmed_via for channel display.
  const paymentIntentIds = txs
    .filter((t) => t.referenceType === "payment_intent" && t.referenceId !== null)
    .map((t) => t.referenceId!) as number[];
  const confirmedViaMap = new Map<number, string | null>(); // payment_intent.id -> confirmed_via
  if (paymentIntentIds.length > 0) {
    const piRows = await db
      .select({ id: paymentIntents.id, confirmedVia: paymentIntents.confirmedVia })
      .from(paymentIntents)
      .where(inArray(paymentIntents.id, paymentIntentIds));
    piRows.forEach((r) => confirmedViaMap.set(r.id, r.confirmedVia ?? null));
  }

  // For non-receipt transactions (topup, adjustment, transfer): enrich with
  // the creator user's shop so the frontend can show "Top-up at <Shop>" or "Kiosk".
  const creatorShopMap = new Map<number, string | null>(); // userId -> shopName
  const nonReceiptCreatorIds = [
    ...new Set(
      txs
        .filter((t) => t.referenceType !== "receipt" && t.referenceType !== "receipt_void")
        .map((t) => t.createdBy),
    ),
  ];
  if (nonReceiptCreatorIds.length > 0) {
    const userShopRows = await db
      .select({ userId: users.id, shopId: users.shopId })
      .from(users)
      .where(inArray(users.id, nonReceiptCreatorIds));
    const creatorShopIds = [...new Set(userShopRows.map((u) => u.shopId).filter((s): s is string => !!s))];
    const shopNameMap = new Map<string, string>();
    if (creatorShopIds.length > 0) {
      const shopRows = await db
        .select({ id: shops.id, name: shops.name })
        .from(shops)
        .where(inArray(shops.id, creatorShopIds));
      shopRows.forEach((s) => shopNameMap.set(s.id, s.name ?? ""));
    }
    userShopRows.forEach((u) => {
      creatorShopMap.set(u.userId, u.shopId ? (shopNameMap.get(u.shopId) ?? null) : null);
    });
  }

  return txs.map((t) => {
    const isReceiptTx = t.referenceType === "receipt" || t.referenceType === "receipt_void";
    const receiptShop = isReceiptTx && t.referenceId !== null ? shopMap.get(t.referenceId) : undefined;
    const creatorShopName = isReceiptTx ? null : (creatorShopMap.get(t.createdBy) ?? null);
    return {
      id: t.id,
      wallet_id: t.walletId,
      transaction_type: t.transactionType,
      amount: pgNumber(t.amount) ?? 0,
      balance_before: pgNumber(t.balanceBefore) ?? 0,
      balance_after: pgNumber(t.balanceAfter) ?? 0,
      reference_type: t.referenceType ?? null,
      reference_id: t.referenceId ?? null,
      description: t.description ?? null,
      shop_id: receiptShop?.shopId ?? null,
      shop_name: receiptShop?.shopName ?? creatorShopName,
      confirmed_via: t.referenceType === "payment_intent" && t.referenceId !== null
        ? (confirmedViaMap.get(t.referenceId) ?? null)
        : null,
      created_at: pgToIso(t.createdAt)!,
    };
  });
}

// ── Write operations (atomic with audit row) ────────────────────────────────

export async function adjustBalance(args: {
  walletId: number;
  amount: number;
  adminUserId: number;
  reason: string;
  referenceTicket?: string;
}): Promise<WalletTransactionResponseDTO> {
  const { walletId, amount, adminUserId, referenceTicket } = args;
  const reason = args.reason?.trim();
  if (amount === 0) {
    const err = new Error("Adjustment amount must be non-zero");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!reason) {
    const err = new Error("Reason is required for balance adjustment");
    (err as { status?: number }).status = 400;
    throw err;
  }

  // postgres-js transaction: SELECT FOR UPDATE the wallet, write tx + new balance atomically.
  const result = await pgClient.begin(async (sqlTx) => {
    const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
      SELECT id, balance FROM wallets WHERE id = ${walletId} FOR UPDATE
    `;
    if (wRows.length === 0) {
      const err = new Error(`Wallet ${walletId} not found`);
      (err as { status?: number }).status = 404;
      throw err;
    }
    const balanceBefore = Number(wRows[0].balance);
    const balanceAfter = balanceBefore + amount;
    const direction = amount > 0 ? "credit" : "debit";
    const refTag = referenceTicket ? ` [ref:${referenceTicket}]` : "";
    const description = `Admin ${direction} adjustment${refTag} — ${reason}`;

    await sqlTx`
      UPDATE wallets SET balance = ${balanceAfter}, updated_at = NOW() WHERE id = ${walletId}
    `;
    const txRows = await sqlTx<Array<{
      id: number;
      wallet_id: number;
      transaction_type: string;
      amount: string;
      balance_before: string;
      balance_after: string;
      reference_type: string | null;
      reference_id: number | null;
      description: string | null;
      created_at: string;
    }>>`
      INSERT INTO wallet_transactions
        (wallet_id, transaction_type, amount, balance_before, balance_after,
         reference_type, reference_id, description, reason, reference_ticket, created_by)
      VALUES (${walletId}, 'ADJUSTMENT', ${Math.abs(amount)}, ${balanceBefore}, ${balanceAfter},
              'admin_adjustment', NULL, ${description}, ${reason}, ${referenceTicket ?? null}, ${adminUserId})
      RETURNING id, wallet_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description, created_at
    `;
    // Audit log row (best-effort — same transaction so rolled back on failure).
    await sqlTx`
      INSERT INTO audit_logs (entity_type, entity_id, entity_name, shop_id, action, user_id, changes_json)
      VALUES ('wallet', ${walletId}, ${"wallet#" + walletId}, NULL, 'UPDATE',
              ${adminUserId},
              ${JSON.stringify({
      reason,
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    })}::jsonb)
    `;
    return txRows[0];
  });

  return {
    id: result.id,
    wallet_id: result.wallet_id,
    transaction_type: result.transaction_type,
    amount: Number(result.amount),
    balance_before: Number(result.balance_before),
    balance_after: Number(result.balance_after),
    reference_type: result.reference_type ?? null,
    reference_id: result.reference_id ?? null,
    description: result.description ?? null,
    shop_id: null,
    shop_name: null,
    confirmed_via: null,
    created_at: pgToIso(result.created_at)!,
  };
}

export interface CashierTopupDTO {
  wallet_id: number;
  customer_name: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  transaction_id: number;
}

/**
 * Cashier-side cash top-up — wraps adjustBalance with the right reason format
 * and enforces the 50,000 THB ceiling (non-department wallets only).
 */
export async function cashierTopup(args: {
  walletId: number;
  amount: number;
  cashierUserId: number;
  notes?: string;
}): Promise<CashierTopupDTO> {
  const { walletId, amount, cashierUserId, notes } = args;
  if (amount <= 0) {
    const err = new Error("Top-up amount must be positive");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const wRows = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  if (!wRows[0]) {
    const err = new Error("Wallet not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const w = wRows[0];
  if (w.departmentId === null) {
    const projected = (pgNumber(w.balance) ?? 0) + amount;
    if (projected > MAX_WALLET_BALANCE) {
      const current = pgNumber(w.balance) ?? 0;
      const available = Math.max(0, MAX_WALLET_BALANCE - current);
      const err = new Error(
        `Wallet balance cannot exceed ฿${MAX_WALLET_BALANCE.toLocaleString()}. ` +
        `Current: ฿${current.toFixed(2)}. Max top-up: ฿${available.toFixed(2)}.`,
      );
      (err as { status?: number }).status = 400;
      throw err;
    }
  }

  // Resolve display name
  let customerName = "Unknown";
  if (w.customerId !== null) {
    const cr = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, w.customerId)).limit(1);
    if (cr[0]) customerName = cr[0].name || `Customer #${w.customerId}`;
  } else if (w.userId !== null) {
    const ur = await db
      .select({ fullName: users.fullName, username: users.username })
      .from(users)
      .where(eq(users.id, w.userId))
      .limit(1);
    if (ur[0]) customerName = ur[0].fullName || ur[0].username;
  }

  const tx = await adjustBalance({
    walletId,
    amount,
    adminUserId: cashierUserId,
    reason: "Cash top-up at POS" + (notes ? ` - ${notes}` : ""),
  });

  return {
    wallet_id: walletId,
    customer_name: customerName,
    amount,
    balance_before: tx.balance_before,
    balance_after: tx.balance_after,
    transaction_id: tx.id,
  };
}

/** Cashier top-up by customer ID — auto-creates wallet if customer has none. */
export async function cashierTopupByCustomer(args: {
  customerId: number;
  amount: number;
  cashierUserId: number;
  notes?: string;
}): Promise<CashierTopupDTO> {
  const wallet = await ensureWalletForCustomer(args.customerId);
  return cashierTopup({
    walletId: wallet.id,
    amount: args.amount,
    cashierUserId: args.cashierUserId,
    notes: args.notes,
  });
}

/** Cashier top-up by user ID (staff/parent) — auto-creates wallet if user has none. */
export async function cashierTopupByUser(args: {
  userId: number;
  amount: number;
  cashierUserId: number;
  notes?: string;
}): Promise<CashierTopupDTO> {
  const wallet = await ensureWalletForUser(args.userId);
  return cashierTopup({
    walletId: wallet.id,
    amount: args.amount,
    cashierUserId: args.cashierUserId,
    notes: args.notes,
  });
}

export interface DepartmentAdjustDTO {
  department_id: number;
  wallet_id: number;
  new_balance: number;
  transaction: WalletTransactionResponseDTO;
}

export async function adjustDepartmentBalance(args: {
  departmentId: number;
  amount: number;
  adminUserId: number;
  reason: string;
  referenceTicket?: string;
}): Promise<DepartmentAdjustDTO> {
  // Ensure department exists
  const dr = await db.select().from(departments).where(eq(departments.id, args.departmentId)).limit(1);
  if (!dr[0]) {
    const err = new Error("Department not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const wallet = await ensureWalletForDepartment(args.departmentId);
  const tx = await adjustBalance({
    walletId: wallet.id,
    amount: args.amount,
    adminUserId: args.adminUserId,
    reason: args.reason,
    referenceTicket: args.referenceTicket,
  });
  return {
    department_id: args.departmentId,
    wallet_id: wallet.id,
    new_balance: tx.balance_after,
    transaction: tx,
  };
}

export async function listDepartmentTransactions(args: {
  departmentId: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ items: WalletTransactionResponseDTO[] }> {
  const dr = await db.select().from(departments).where(eq(departments.id, args.departmentId)).limit(1);
  if (!dr[0]) {
    const err = new Error("Department wallet not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const wRows = await db.select().from(wallets).where(eq(wallets.departmentId, args.departmentId)).limit(1);
  if (!wRows[0]) {
    return { items: [] };
  }
  const conds = [eq(walletTransactions.walletId, wRows[0].id)];
  if (args.dateFrom) conds.push(gte(walletTransactions.createdAt, `${args.dateFrom}T00:00:00+07:00`));
  if (args.dateTo) conds.push(lte(walletTransactions.createdAt, `${args.dateTo}T23:59:59.999999+07:00`));
  const txs = await db
    .select()
    .from(walletTransactions)
    .where(and(...conds))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(args.limit ?? 100);
  return {
    items: txs.map((t) => ({
      id: t.id,
      wallet_id: t.walletId,
      transaction_type: t.transactionType,
      amount: pgNumber(t.amount) ?? 0,
      balance_before: pgNumber(t.balanceBefore) ?? 0,
      balance_after: pgNumber(t.balanceAfter) ?? 0,
      reference_type: t.referenceType ?? null,
      reference_id: t.referenceId ?? null,
      description: t.description ?? null,
      shop_id: null,
      shop_name: null,
      confirmed_via: null,
      created_at: pgToIso(t.createdAt)!,
    })),
  };
}

export interface FamilyTransferDTO {
  debit_tx: WalletTransactionResponseDTO;
  credit_tx: WalletTransactionResponseDTO;
  from_balance_after: number;
  to_balance_after: number;
}

export async function transferWithinFamily(args: {
  fromWalletId: number;
  toWalletId: number;
  amount: number;
  initiatorUserId: number;
  initiatorIsAdmin: boolean;
  initiatorRoles: string[];
  note?: string;
}): Promise<FamilyTransferDTO> {
  const { fromWalletId, toWalletId, amount, initiatorUserId, initiatorIsAdmin, note } = args;
  if (amount <= 0) {
    const err = new Error("Transfer amount must be positive");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (fromWalletId === toWalletId) {
    const err = new Error("Cannot transfer to the same wallet");
    (err as { status?: number }).status = 400;
    throw err;
  }

  return await pgClient.begin(async (sqlTx) => {
    // SELECT FOR UPDATE both wallets, lower id first to avoid deadlock.
    const lo = Math.min(fromWalletId, toWalletId);
    const hi = Math.max(fromWalletId, toWalletId);
    const locked = await sqlTx<Array<{ id: number; balance: string; customer_id: number | null; user_id: number | null; department_id: number | null }>>`
      SELECT id, balance, customer_id, user_id, department_id
      FROM wallets WHERE id IN (${lo}, ${hi}) ORDER BY id FOR UPDATE
    `;
    const fromW = locked.find((w) => w.id === fromWalletId);
    const toW = locked.find((w) => w.id === toWalletId);
    if (!fromW || !toW) {
      const err = new Error("Source or destination wallet not found");
      (err as { status?: number }).status = 404;
      throw err;
    }

    // Authorization: admin bypass; otherwise both wallets must be reachable.
    if (!initiatorIsAdmin) {
      const reach = async (w: typeof fromW): Promise<boolean> => {
        if (w.user_id === initiatorUserId) return true;
        if (w.customer_id !== null) {
          const link = await sqlTx<Array<{ id: number }>>`
            SELECT id FROM parent_child_links
            WHERE parent_user_id = ${initiatorUserId} AND child_customer_id = ${w.customer_id}
            LIMIT 1
          `;
          return link.length > 0;
        }
        if (w.department_id !== null) return false;
        return false;
      };
      if (!(await reach(fromW)) || !(await reach(toW))) {
        const err = new Error("Not authorized for one or both wallets");
        (err as { status?: number }).status = 403;
        throw err;
      }
    }

    const fromBalanceBefore = Number(fromW.balance);
    const toBalanceBefore = Number(toW.balance);
    if (fromBalanceBefore < amount) {
      const err = new Error(`Insufficient balance in source wallet (have ฿${fromBalanceBefore.toFixed(2)})`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    const toBalanceAfter = toBalanceBefore + amount;
    if (toBalanceAfter > MAX_WALLET_BALANCE) {
      const err = new Error(`Destination wallet would exceed max balance ฿${MAX_WALLET_BALANCE.toLocaleString()}`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    const fromBalanceAfter = fromBalanceBefore - amount;

    await sqlTx`UPDATE wallets SET balance = ${fromBalanceAfter}, updated_at = NOW() WHERE id = ${fromWalletId}`;
    await sqlTx`UPDATE wallets SET balance = ${toBalanceAfter}, updated_at = NOW() WHERE id = ${toWalletId}`;

    const noteSuffix = note ? ` — ${note}` : "";
    const debitTxRows = await sqlTx<Array<{ id: number; wallet_id: number; transaction_type: string; amount: string; balance_before: string; balance_after: string; reference_type: string | null; reference_id: number | null; description: string | null; created_at: string }>>`
      INSERT INTO wallet_transactions
        (wallet_id, transaction_type, amount, balance_before, balance_after,
         reference_type, reference_id, description, created_by)
      VALUES (${fromWalletId}, 'DEDUCTION', ${amount}, ${fromBalanceBefore}, ${fromBalanceAfter},
              'family_transfer', ${toWalletId},
              ${"Transfer to wallet #" + toWalletId + noteSuffix}, ${initiatorUserId})
      RETURNING id, wallet_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description, created_at
    `;
    const creditTxRows = await sqlTx<Array<{ id: number; wallet_id: number; transaction_type: string; amount: string; balance_before: string; balance_after: string; reference_type: string | null; reference_id: number | null; description: string | null; created_at: string }>>`
      INSERT INTO wallet_transactions
        (wallet_id, transaction_type, amount, balance_before, balance_after,
         reference_type, reference_id, description, created_by)
      VALUES (${toWalletId}, 'TOPUP', ${amount}, ${toBalanceBefore}, ${toBalanceAfter},
              'family_transfer', ${fromWalletId},
              ${"Transfer from wallet #" + fromWalletId + noteSuffix}, ${initiatorUserId})
      RETURNING id, wallet_id, transaction_type, amount, balance_before, balance_after,
                reference_type, reference_id, description, created_at
    `;

    const toDto = (row: typeof debitTxRows[0]): WalletTransactionResponseDTO => ({
      id: row.id,
      wallet_id: row.wallet_id,
      transaction_type: row.transaction_type,
      amount: Number(row.amount),
      balance_before: Number(row.balance_before),
      balance_after: Number(row.balance_after),
      reference_type: row.reference_type ?? null,
      reference_id: row.reference_id ?? null,
      description: row.description ?? null,
      shop_id: null,
      shop_name: null,
      confirmed_via: null,
      created_at: pgToIso(row.created_at)!,
    });

    return {
      debit_tx: toDto(debitTxRows[0]),
      credit_tx: toDto(creditTxRows[0]),
      from_balance_after: fromBalanceAfter,
      to_balance_after: toBalanceAfter,
    };
  });
}
