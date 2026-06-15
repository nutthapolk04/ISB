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
  // ── Graduation Refund (mirrors FastAPI _ensure_runtime_schema) ──
  {
    sql: `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS refund_method VARCHAR(20)`,
    label: "wallet_transactions.refund_method",
  },
  {
    sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS enroll_date DATE`,
    label: "customers.enroll_date",
  },
  {
    sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS withdraw_date DATE`,
    label: "customers.withdraw_date",
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
