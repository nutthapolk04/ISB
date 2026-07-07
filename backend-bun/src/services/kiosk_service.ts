/** Kiosk device profile — location label stored in users.full_name */
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/db/client";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

export interface KioskProfileDTO {
    user_id: number;
    username: string;
    full_name: string;
    role: string;
}

function requireKiosk(caller: AccessTokenPayload): void {
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
