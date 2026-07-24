/** Kiosk device profile (location label stored in users.full_name) and
 * event-log ingestion (see kiosk/src/lib/kioskLog.ts for the on-device
 * source of truth this mirrors, and kiosk/src/lib/kioskLogUploader.ts for
 * the uploader that calls ingestKioskLogs). */
import { eq } from "drizzle-orm";
import { users, kioskLogs } from "@/db/schema";
import { db } from "@/db/client";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

export interface KioskProfileDTO {
    user_id: number;
    username: string;
    full_name: string;
    role: string;
}

export function requireKiosk(caller: AccessTokenPayload): void {
    if (!caller.roles.includes("kiosk")) {
        const err = new Error("Kiosk role required");
        (err as { status?: number }).status = 403;
        throw err;
    }
}

export async function getKioskProfile(caller: AccessTokenPayload): Promise<KioskProfileDTO> {
    requireKiosk(caller);
    const userId = Number(caller.sub);
    const rows = await db
        .select({
            id: users.id,
            username: users.username,
            fullName: users.fullName,
            role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!rows[0]) {
        const err = new Error("User not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const u = rows[0];
    return {
        user_id: u.id,
        username: u.username,
        full_name: u.fullName,
        role: u.role ?? "kiosk",
    };
}

export async function updateKioskLocation(
    caller: AccessTokenPayload,
    fullName: string,
): Promise<KioskProfileDTO> {
    requireKiosk(caller);
    const trimmed = fullName.trim();
    if (!trimmed || trimmed.length > 255) {
        const err = new Error("Location name is required (max 255 characters)");
        (err as { status?: number }).status = 400;
        throw err;
    }
    const userId = Number(caller.sub);
    await db.update(users).set({ fullName: trimmed }).where(eq(users.id, userId));
    return getKioskProfile(caller);
}

const VALID_LEVELS = new Set(["info", "warn", "error"]);
const VALID_CATEGORIES = new Set(["system", "auth", "api", "bill", "cash", "qr", "pending"]);
/** Defensive cap — the uploader batches its own backlog, but never trust a
 * single request body size regardless of what the client claims to send. */
const MAX_ENTRIES_PER_REQUEST = 500;

export interface KioskLogEntryInput {
    ts: string;
    level: string;
    category: string;
    message: string;
    data?: unknown;
}

/** Best-effort from the kiosk's point of view (see kioskLogUploader.ts) but
 * strict here — a malformed entry is dropped rather than silently coerced,
 * so a client-side bug surfaces as "fewer rows than expected" instead of
 * corrupt data admins can't trust. */
export async function ingestKioskLogs(
    caller: AccessTokenPayload,
    entries: KioskLogEntryInput[],
): Promise<{ inserted: number }> {
    requireKiosk(caller);
    const kioskUserId = Number(caller.sub);
    const rows = entries
        .slice(0, MAX_ENTRIES_PER_REQUEST)
        .filter((e) => VALID_LEVELS.has(e.level) && VALID_CATEGORIES.has(e.category) && !!e.ts && !!e.message)
        .map((e) => ({
            kioskUserId,
            ts: e.ts,
            level: e.level,
            category: e.category,
            message: e.message.slice(0, 500),
            data: e.data ?? null,
        }));
    if (rows.length === 0) return { inserted: 0 };
    await db.insert(kioskLogs).values(rows);
    return { inserted: rows.length };
}
