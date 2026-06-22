import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { systemSettings, auditLogs } from "@/db/schema";

/**
 * Mirrors FastAPI's app/services/settings_service.KNOWN_FLAGS. Values are
 * JSON-encoded strings in the system_settings.value column; missing rows fall
 * back to the defaults here.
 */
export const KNOWN_FLAGS: Record<string, unknown> = {
  allow_negative_user_wallet: false,
  allow_negative_customer_wallet: false,
  school_name: "International School Bangkok",
  school_address: "",
  school_tax_id: "",
  school_phone: "",
  school_logo_url: "",
  school_cover_url: "",
  school_receipt_footer: "",
  department_adjust_shortcuts: [],
  low_balance_alert_enabled: false,
  low_balance_threshold: 100,
  low_balance_alert_send_time: "19:00",
};

export const SCHOOL_KEYS = new Set([
  "school_name",
  "school_address",
  "school_tax_id",
  "school_phone",
  "school_logo_url",
  "school_cover_url",
  "school_receipt_footer",
]);

export const PUBLIC_KEYS = [
  "school_name",
  "school_cover_url",
  "school_logo_url",
  "school_address",
  "school_tax_id",
  "school_phone",
  "school_receipt_footer",
] as const;

function coerce(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw ?? fallback;
  }
}

export async function getRaw(key: string): Promise<unknown | null> {
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  if (!rows[0]) return null;
  return coerce(rows[0].value, null);
}

/** List all known flags merged with current values from DB. */
export async function listKnown(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(systemSettings);
  const fromDb = new Map<string, unknown>();
  rows.forEach((r) => fromDb.set(r.key, coerce(r.value, null)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(KNOWN_FLAGS)) {
    out[key] = fromDb.has(key) ? fromDb.get(key) : KNOWN_FLAGS[key];
  }
  return out;
}

export async function getPublicSettings(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) {
    const v = await getRaw(key);
    out[key] = v !== null ? v : (KNOWN_FLAGS[key] ?? "");
  }
  return out;
}

export async function getSchoolSettings(): Promise<Record<string, unknown>> {
  const keys = [...SCHOOL_KEYS];
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(inArray(systemSettings.key, keys));
  const found = Object.fromEntries(rows.map((r) => [r.key, coerce(r.value, null)]));
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = key in found ? found[key] : (KNOWN_FLAGS[key] ?? "");
  }
  return out;
}

/**
 * Upsert a single setting. Always JSON-encodes the value for forward compat
 * (same encoding FastAPI uses). Writes an audit_logs entry when auditUserId
 * is provided.
 */
export async function setValue(
  key: string,
  value: unknown,
  auditUserId: number | null = null,
): Promise<unknown> {
  const encoded = JSON.stringify(value);
  const oldValue = await getRaw(key);

  await db
    .insert(systemSettings)
    .values({ key, value: encoded, updatedBy: auditUserId ?? null })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: encoded, updatedBy: auditUserId ?? null, updatedAt: sql`now()` },
    });

  if (auditUserId !== null) {
    await db.insert(auditLogs).values({
      entityType: "system_setting",
      entityId: null,
      entityName: key,
      shopId: null,
      action: "UPDATE",
      userId: auditUserId,
      changesJson: { old: oldValue, new: value },
    });
  }

  return value;
}

export async function setSchoolSettings(
  updates: Record<string, unknown>,
  userId: number,
): Promise<Record<string, unknown>> {
  for (const [key, value] of Object.entries(updates)) {
    if (SCHOOL_KEYS.has(key)) {
      await setValue(key, value, userId);
    }
  }
  return updates;
}
