/**
 * Idempotent schema-patcher run at Bun startup.
 *
 * The Bun container's Dockerfile boots straight into `bun src/index.ts`,
 * so the FastAPI bootstrap (start.sh) + main.py's _ensure_runtime_schema
 * never run. Whenever Drizzle's schema.ts gains a column that Drizzle
 * tries to read/write, the DB also needs that column — otherwise every
 * INSERT/SELECT against that table 500s with "column does not exist".
 *
 * This module mirrors the FastAPI patches we care about. Add new ALTERs
 * here when you ship a Drizzle schema change. Every statement is
 * idempotent (IF NOT EXISTS / DROP NOT NULL) so re-runs are safe.
 *
 * Statements run in order; each in its own connection so one failure
 * (e.g. a missing prerequisite table on first boot) doesn't block the
 * rest. Failures are logged loudly but do NOT block boot — fail-open so
 * a Drizzle/DB mismatch surfaces at the offending endpoint rather than
 * taking the whole service down.
 */
import { pgClient } from "./client";

const PATCHES: ReadonlyArray<{ sql: string; label: string }> = [
    // ── POS-sale BAY QR: extend payment_intents with cart snapshot + type ──
    {
        sql: `ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS intent_type VARCHAR(20) DEFAULT 'wallet_topup'`,
        label: "payment_intents.intent_type",
    },
    {
        sql: `ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS cart_snapshot JSONB`,
        label: "payment_intents.cart_snapshot",
    },
    {
        sql: `ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS receipt_id INTEGER`,
        label: "payment_intents.receipt_id",
    },
    {
        sql: `ALTER TABLE payment_intents ALTER COLUMN wallet_id DROP NOT NULL`,
        label: "payment_intents.wallet_id nullable",
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS ix_payment_intents_intent_type ON payment_intents(intent_type)`,
        label: "payment_intents idx intent_type",
    },
    // ── BAY POS QR introduces 'QR_PROMPTPAY' as a paymentmethod enum value
    // so we can split it from the legacy 'OTHER' bucket in reports.
    // ALTER TYPE ... ADD VALUE IF NOT EXISTS requires Postgres 12+.
    {
        sql: `ALTER TYPE paymentmethod ADD VALUE IF NOT EXISTS 'QR_PROMPTPAY'`,
        label: "paymentmethod += QR_PROMPTPAY",
    },
    // ── customer_types: table + enum + seed rows ──
    // Created via SQLAlchemy Base.metadata.create_all on FastAPI, which the
    // Bun container never runs. Without these rows, creating a student
    // (ensureCustomerTypeId('INTERNAL')) blows up with "Failed query: select
    // from customer_types" because the table doesn't exist OR the seed row
    // is missing.
    {
        sql: `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customertypeenum') THEN
        CREATE TYPE customertypeenum AS ENUM ('PUBLIC', 'INTERNAL');
      END IF;
    END $$;`,
        label: "type customertypeenum",
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS customer_types (
      id SERIAL PRIMARY KEY,
      type_name customertypeenum NOT NULL UNIQUE,
      description VARCHAR(255),
      default_price_level VARCHAR(50) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
        label: "customer_types table",
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS ix_customer_types_id ON customer_types(id)`,
        label: "customer_types idx",
    },
    {
        sql: `INSERT INTO customer_types (type_name, description, default_price_level)
          VALUES ('INTERNAL', 'Student/staff internal customer', 'internal')
          ON CONFLICT (type_name) DO NOTHING`,
        label: "customer_types seed INTERNAL",
    },
    {
        sql: `INSERT INTO customer_types (type_name, description, default_price_level)
          VALUES ('PUBLIC', 'Public/visitor', 'retail')
          ON CONFLICT (type_name) DO NOTHING`,
        label: "customer_types seed PUBLIC",
    },
    // ── Graduation Refund (mirrors FastAPI _ensure_runtime_schema) ──
    {
        sql: `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS refund_method VARCHAR(20)`,
        label: "wallet_transactions.refund_method",
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS ix_wallet_tx_cashier_idempotency
          ON wallet_transactions (reference_ticket)
          WHERE reference_ticket LIKE 'cashier-idem:%'`,
        label: "wallet_transactions cashier idempotency index",
    },
    {
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS enroll_date DATE`,
        label: "customers.enroll_date",
    },
    {
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS withdraw_date DATE`,
        label: "customers.withdraw_date",
    },
    {
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS daily_limit_canteen NUMERIC(10,2)`,
        label: "customers.daily_limit_canteen",
    },
    {
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS daily_limit_store NUMERIC(10,2)`,
        label: "customers.daily_limit_store",
    },
    // ── Close Month: monthly stock period closes ──────────────────────────────
    {
        sql: `CREATE TABLE IF NOT EXISTS stock_period_closes (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'draft',
      closed_by INTEGER REFERENCES users(id),
      closed_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_stock_period_closes_shop_period UNIQUE (shop_id, period_year, period_month)
    )`,
        label: "CREATE stock_period_closes",
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS ix_stock_period_closes_shop_id ON stock_period_closes(shop_id)`,
        label: "idx stock_period_closes.shop_id",
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS stock_period_close_items (
      id SERIAL PRIMARY KEY,
      close_id INTEGER NOT NULL REFERENCES stock_period_closes(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES shop_products(id),
      system_qty INTEGER NOT NULL,
      physical_qty INTEGER,
      variance_qty INTEGER,
      unit_cost NUMERIC(10,4),
      variance_value NUMERIC(10,4),
      adjustment_movement_id INTEGER REFERENCES shop_movements(id) ON DELETE SET NULL
    )`,
        label: "CREATE stock_period_close_items",
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS ix_stock_period_close_items_close_id ON stock_period_close_items(close_id)`,
        label: "idx stock_period_close_items.close_id",
    },
    // ── Per-shop void receipt reason shortcuts ────────────────────────────────
    {
        sql: `ALTER TABLE shops ADD COLUMN IF NOT EXISTS void_shortcuts JSONB NOT NULL DEFAULT '[]'::jsonb`,
        label: "shops.void_shortcuts",
    },
    // ── confirmed_via on payment_intents (used by wallet transaction channel display)
    {
        sql: `ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS confirmed_via VARCHAR(30)`,
        label: "payment_intents.confirmed_via",
    },
    // ── Multi-account SSO: a staff+parent person can log in with either of
    // their ISB accounts and land on the same wallet/family. ISB's vendor
    // sync now sends `login` as a string array per Staff/Parent record.
    {
        sql: `CREATE TABLE IF NOT EXISTS user_login_emails (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
        label: "CREATE user_login_emails",
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS ix_user_login_emails_email ON user_login_emails(email)`,
        label: "idx user_login_emails.email",
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS ix_user_login_emails_user_id ON user_login_emails(user_id)`,
        label: "idx user_login_emails.user_id",
    },
    {
        // One-time backfill: every existing user's primary email becomes a
        // known login too, so the new SSO fallback lookup never regresses
        // anyone who only ever had one email.
        sql: `INSERT INTO user_login_emails (user_id, email)
      SELECT id, email FROM users WHERE email IS NOT NULL AND email <> ''
      ON CONFLICT (email) DO NOTHING`,
        label: "backfill user_login_emails from users.email",
    },
    // ── user_login_emails.source: a staff+parent person is synced through
    // TWO independent channels (/sync/staffs and /sync/families), each only
    // knowing its own half of that person's login emails. Reconciling stale
    // emails (dropping ones no longer sent) must stay scoped to whichever
    // channel wrote them, or the two channels wipe each other's emails out
    // on alternating runs. NULL = pre-dates this column (legacy backfill
    // above) — left alone by both channels' reconcile.
    {
        sql: `ALTER TABLE user_login_emails ADD COLUMN IF NOT EXISTS source VARCHAR(20)`,
        label: "user_login_emails.source",
    },
    // ── family_profiles.is_active: ISB's vendor sync never signals "this is
    // the last batch of the run" (batches are independent, arbitrary order),
    // so a family missing from any one HTTP call can't safely be treated as
    // "gone" — see family_sweep_service.ts for the staleness-sweep approach
    // this backs instead.
    {
        sql: `ALTER TABLE family_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`,
        label: "family_profiles.is_active",
    },
    // ── departments.last_synced_at: same reasoning as family_profiles above,
    // extended to the department sync channel — see department_sweep_service.ts.
    {
        sql: `ALTER TABLE departments ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`,
        label: "departments.last_synced_at",
    },
    // ── Vendor wallet-adjust-balance API idempotency (POST /api/v1/wallet/adjust-balance) ──
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS ix_wallet_tx_vendor_idempotency
      ON wallet_transactions (reference_ticket)
      WHERE reference_ticket LIKE 'vendor-adjust:%'`,
        label: "wallet_transactions vendor-adjust idempotency index",
    },
    // ── Kiosk top-up attribution: who scanned their card, not just which
    // service account made the API call (mirrors wallet transfer's
    // acting_user_id pattern, extended to cashier top-ups). ──
    {
        sql: `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS acting_user_id INTEGER REFERENCES users(id)`,
        label: "wallet_transactions.acting_user_id",
    },
    // Same attribution for QR-code top-ups at a kiosk — confirmation is
    // async (webhook/inquiry/reconcile) so the scanned identity has to be
    // persisted on the intent and copied onto wallet_transactions later.
    {
        sql: `ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS acting_user_id INTEGER REFERENCES users(id)`,
        label: "payment_intents.acting_user_id",
    },
];

export async function ensureSchema(): Promise<void> {
    for (const patch of PATCHES) {
        try {
            await pgClient.unsafe(patch.sql);
            // eslint-disable-next-line no-console
            console.log(`[ensureSchema] + ${patch.label}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // ALTER TABLE ALTER COLUMN DROP NOT NULL is silently OK on second
            // run; "already exists"/"does not exist" on a DROP we want to be
            // idempotent. Log other errors loudly.
            const benign = /already exists|does not exist|is not null/i.test(msg);
            if (benign) {
                // eslint-disable-next-line no-console
                console.log(`[ensureSchema] = ${patch.label} (already applied)`);
            } else {
                // eslint-disable-next-line no-console
                console.error(`[ensureSchema] ! ${patch.label} FAILED — ${msg}`);
            }
        }
    }
}
