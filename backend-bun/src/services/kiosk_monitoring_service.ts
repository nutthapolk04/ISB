/** Kiosk online/offline monitoring — heartbeat ingestion, offline-sweep
 * detection, and custodian (responsible-staff) notification.
 *
 * A kiosk is a `users` row with role='kiosk' (see kiosk_service.ts). This
 * module tracks three columns on that same row (kiosk_last_heartbeat_at,
 * kiosk_status, kiosk_offline_since) plus a many-to-many `kiosk_custodians`
 * table (one kiosk can have several responsible staff; one staff member can
 * be responsible for several kiosks).
 *
 * Notifications are edge-triggered, not level-triggered: a kiosk going
 * offline fires exactly one email (when kiosk_status first flips to
 * 'offline'), not one per sweep tick while it stays down — kiosk_status
 * itself is the dedup guard. Coming back online fires exactly one recovery
 * email the moment the next heartbeat arrives.
 */
import { and, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { users, kioskCustodians, emailAlertsLog } from "@/db/schema";
import { sendEmail } from "./email_service";
import { requireKiosk } from "./kiosk_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

export const OFFLINE_THRESHOLD_MINUTES = 5;

export interface KioskCustodianDTO {
    user_id: number;
    full_name: string;
    email: string;
}

export interface KioskMonitoringItemDTO {
    user_id: number;
    username: string;
    location: string;
    status: "online" | "offline" | "never_checked_in";
    last_heartbeat_at: string | null;
    offline_since: string | null;
    custodians: KioskCustodianDTO[];
}

function minutesAgoIso(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function getCustodians(kioskUserId: number): Promise<KioskCustodianDTO[]> {
    const rows = await db
        .select({
            userId: users.id,
            fullName: users.fullName,
            email: users.email,
        })
        .from(kioskCustodians)
        .innerJoin(users, eq(users.id, kioskCustodians.custodianUserId))
        .where(eq(kioskCustodians.kioskUserId, kioskUserId));
    return rows.map((r) => ({ user_id: r.userId, full_name: r.fullName, email: r.email }));
}

async function logAndSendAlert(args: {
    alertType: "kiosk_offline" | "kiosk_online";
    recipientEmail: string;
    subject: string;
    html: string;
}): Promise<void> {
    let status = "sent";
    let errorMessage: string | null = null;
    try {
        await sendEmail(args.recipientEmail, args.subject, args.html);
    } catch (err) {
        status = "failed";
        errorMessage = err instanceof Error ? err.message : String(err);
    }
    await db.insert(emailAlertsLog).values({
        alertType: args.alertType,
        recipientEmail: args.recipientEmail,
        subject: args.subject,
        status,
        errorMessage,
    });
}

function fmtBKK(iso: string | null): string {
    if (!iso) return "-";
    return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
}

async function notifyOffline(kiosk: { id: number; username: string; fullName: string }, lastHeartbeatAt: string | null): Promise<void> {
    const custodians = await getCustodians(kiosk.id);
    if (custodians.length === 0) return;
    const subject = `แจ้งเตือน: เครื่อง Kiosk "${kiosk.fullName}" (${kiosk.username}) ออฟไลน์`;
    const html = `
    <p>เครื่อง Kiosk <strong>${kiosk.fullName}</strong> (username: ${kiosk.username})
       ไม่ได้ส่งสัญญาณเข้ามาเกิน ${OFFLINE_THRESHOLD_MINUTES} นาที</p>
    <p>เห็นครั้งล่าสุดเมื่อ: <strong>${fmtBKK(lastHeartbeatAt)}</strong></p>
    <p>อาจเกิดจากเครื่องดับ, เน็ตหลุด, หรือแอปค้าง — กรุณาตรวจสอบเครื่อง</p>
    <p style="color:#888;font-size:12px">— ระบบสหกรณ์โรงเรียน ISB</p>
  `;
    for (const c of custodians) {
        await logAndSendAlert({ alertType: "kiosk_offline", recipientEmail: c.email, subject, html });
    }
}

async function notifyRecovered(kiosk: { id: number; username: string; fullName: string }, offlineSince: string | null): Promise<void> {
    const custodians = await getCustodians(kiosk.id);
    if (custodians.length === 0) return;
    const downtimeMin = offlineSince ? Math.round((Date.now() - new Date(offlineSince).getTime()) / 60_000) : null;
    const subject = `เครื่อง Kiosk "${kiosk.fullName}" กลับมาออนไลน์แล้ว`;
    const html = `
    <p>เครื่อง Kiosk <strong>${kiosk.fullName}</strong> (username: ${kiosk.username})
       กลับมาออนไลน์แล้ว</p>
    ${downtimeMin !== null ? `<p>ระยะเวลาที่ออฟไลน์: ประมาณ <strong>${downtimeMin} นาที</strong></p>` : ""}
    <p style="color:#888;font-size:12px">— ระบบสหกรณ์โรงเรียน ISB</p>
  `;
    for (const c of custodians) {
        await logAndSendAlert({ alertType: "kiosk_online", recipientEmail: c.email, subject, html });
    }
}

/** Called by the kiosk app — POST /kiosk/heartbeat. */
export async function recordHeartbeat(caller: AccessTokenPayload): Promise<{ status: string }> {
    requireKiosk(caller);
    const userId = Number(caller.sub);
    const rows = await db
        .select({ id: users.id, username: users.username, fullName: users.fullName, kioskStatus: users.kioskStatus, kioskOfflineSince: users.kioskOfflineSince })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    const kiosk = rows[0];
    if (!kiosk) {
        const err = new Error("User not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    const now = new Date().toISOString();
    const wasOffline = kiosk.kioskStatus === "offline";
    await db
        .update(users)
        .set({
            kioskLastHeartbeatAt: now,
            kioskStatus: "online",
            kioskOfflineSince: null,
        })
        .where(eq(users.id, userId));

    if (wasOffline) {
        await notifyRecovered(kiosk, kiosk.kioskOfflineSince);
    }
    return { status: "online" };
}

/** Called by kiosk_health_scheduler.ts every tick — flags kiosks that have
 * gone silent past the threshold and notifies their custodians exactly once
 * per outage (kiosk_status='offline' is the guard against re-notifying on
 * every subsequent tick while still down). */
export async function sweepOfflineKiosks(): Promise<{ flagged: number }> {
    const cutoff = minutesAgoIso(OFFLINE_THRESHOLD_MINUTES);
    const stale = await db
        .select({ id: users.id, username: users.username, fullName: users.fullName, kioskLastHeartbeatAt: users.kioskLastHeartbeatAt })
        .from(users)
        .where(
            and(
                eq(users.role, "kiosk"),
                ne(users.kioskStatus, "offline"),
                isNotNull(users.kioskLastHeartbeatAt),
                lt(users.kioskLastHeartbeatAt, cutoff),
            ),
        );

    for (const kiosk of stale) {
        const now = new Date().toISOString();
        await db
            .update(users)
            .set({ kioskStatus: "offline", kioskOfflineSince: now })
            .where(eq(users.id, kiosk.id));
        await notifyOffline(kiosk, kiosk.kioskLastHeartbeatAt);
    }
    return { flagged: stale.length };
}

/** Admin monitoring page — GET /admin/kiosk-monitoring. */
export async function listKiosksForAdmin(): Promise<KioskMonitoringItemDTO[]> {
    const kiosks = await db
        .select({
            id: users.id,
            username: users.username,
            fullName: users.fullName,
            kioskStatus: users.kioskStatus,
            kioskLastHeartbeatAt: users.kioskLastHeartbeatAt,
            kioskOfflineSince: users.kioskOfflineSince,
        })
        .from(users)
        .where(eq(users.role, "kiosk"))
        .orderBy(desc(users.kioskLastHeartbeatAt));

    if (kiosks.length === 0) return [];

    const custodianRows = await db
        .select({
            kioskUserId: kioskCustodians.kioskUserId,
            userId: users.id,
            fullName: users.fullName,
            email: users.email,
        })
        .from(kioskCustodians)
        .innerJoin(users, eq(users.id, kioskCustodians.custodianUserId))
        .where(inArray(kioskCustodians.kioskUserId, kiosks.map((k) => k.id)));

    const custodiansByKiosk = new Map<number, KioskCustodianDTO[]>();
    for (const row of custodianRows) {
        const list = custodiansByKiosk.get(row.kioskUserId) ?? [];
        list.push({ user_id: row.userId, full_name: row.fullName, email: row.email });
        custodiansByKiosk.set(row.kioskUserId, list);
    }

    return kiosks.map((k) => ({
        user_id: k.id,
        username: k.username,
        location: k.fullName,
        status: k.kioskLastHeartbeatAt === null ? "never_checked_in" : (k.kioskStatus as "online" | "offline" | null) ?? "online",
        last_heartbeat_at: k.kioskLastHeartbeatAt,
        offline_since: k.kioskOfflineSince,
        custodians: custodiansByKiosk.get(k.id) ?? [],
    }));
}

/** Admin monitoring page — PUT /admin/kiosk-monitoring/:kioskUserId/custodians */
export async function setKioskCustodians(kioskUserId: number, custodianUserIds: number[]): Promise<KioskCustodianDTO[]> {
    const kioskRows = await db.select({ id: users.id }).from(users).where(and(eq(users.id, kioskUserId), eq(users.role, "kiosk"))).limit(1);
    if (!kioskRows[0]) {
        const err = new Error(`Kiosk user ${kioskUserId} not found`);
        (err as { status?: number }).status = 404;
        throw err;
    }

    const uniqueIds = Array.from(new Set(custodianUserIds));
    if (uniqueIds.length > 0) {
        const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, uniqueIds));
        if (found.length !== uniqueIds.length) {
            const err = new Error("One or more custodian user IDs do not exist");
            (err as { status?: number }).status = 400;
            throw err;
        }
    }

    await db.delete(kioskCustodians).where(eq(kioskCustodians.kioskUserId, kioskUserId));
    if (uniqueIds.length > 0) {
        await db.insert(kioskCustodians).values(uniqueIds.map((custodianUserId) => ({ kioskUserId, custodianUserId })));
    }
    return getCustodians(kioskUserId);
}
