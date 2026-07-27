import { db } from "@/db/client";
import { parentChildLinks, users, customers, familyProfiles, emailAlertsLog } from "@/db/schema";
import { eq, and, gte, inArray, isNull, ilike } from "drizzle-orm";
import { emailDeliveryStatusFromError, sendEmail } from "./email_service";
import { getRaw } from "./settings_service";

/** Called immediately after POS checkout — queues a pending alert if needed. */
export async function checkAndSendLowBalanceAlerts(
    customerId: number,
    newBalance: number,
): Promise<void> {
    const alertEnabled = (await getRaw("low_balance_alert_enabled")) as boolean | null;
    if (!alertEnabled) return;

    const rawThreshold = (await getRaw("low_balance_threshold")) as number | null;
    const threshold = typeof rawThreshold === "number" && rawThreshold > 0 ? rawThreshold : 100;

    if (newBalance >= threshold) return;

    const [student] = await db
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
    if (!student) return;

    const parents = await db
        .select({
            parentUserId: parentChildLinks.parentUserId,
            email: users.email,
        })
        .from(parentChildLinks)
        .innerJoin(users, eq(users.id, parentChildLinks.parentUserId))
        .where(eq(parentChildLinks.childCustomerId, customerId));

    // The family profile's notification emails (PowerSchool-synced) and
    // admin-added extras are the REAL addresses parents actually read — a
    // parent's users.email is often a synthetic login id (e.g.
    // "85001@parents.isb.ac.th"), not an inbox anyone checks. Mirror the same
    // "family profile first, login email only as a last resort" rule already
    // used on the admin User Detail page (see notificationEmailFallbackHint).
    const [customerRow] = await db
        .select({ familyCode: customers.familyCode })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

    let familyEmails: string[] = [];
    if (customerRow?.familyCode) {
        const [profile] = await db
            .select({
                notificationEmails: familyProfiles.notificationEmails,
                adminEmails: familyProfiles.adminNotificationEmails,
            })
            .from(familyProfiles)
            .where(eq(familyProfiles.familyCode, customerRow.familyCode))
            .limit(1);
        const isValidEmail = (e: unknown): e is string => typeof e === "string" && e.trim() !== "";
        familyEmails = [
            ...(Array.isArray(profile?.notificationEmails) ? profile.notificationEmails.filter(isValidEmail) : []),
            ...(Array.isArray(profile?.adminEmails) ? profile.adminEmails.filter(isValidEmail) : []),
        ];
    }

    const seen = new Set<string>();
    const recipients: { parentUserId: number | null; email: string }[] = [];
    if (familyEmails.length > 0) {
        const parentUserIdByEmail = new Map(
            parents.filter((p) => p.email).map((p) => [p.email!.trim().toLowerCase(), p.parentUserId]),
        );
        for (const email of familyEmails) {
            const key = email.trim().toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            recipients.push({ parentUserId: parentUserIdByEmail.get(key) ?? null, email });
        }
    } else {
        // No family profile / no notification emails on file — fall back to
        // each linked parent's login email so alerts still go out.
        for (const parent of parents) {
            if (!parent.email) continue;
            const key = parent.email.trim().toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            recipients.push({ parentUserId: parent.parentUserId, email: parent.email });
        }
    }

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const subject = `แจ้งเตือน: ยอดเงินบัตรของ ${student.name} ต่ำกว่า ${threshold} บาท`;

    for (const recipient of recipients) {
        // Skip if already sent or pending within 24 h for this recipient–child pair.
        // Admin-added emails have no parentUserId, so they're deduped by
        // recipientEmail instead.
        const recentCond = recipient.parentUserId !== null
            ? eq(emailAlertsLog.parentUserId, recipient.parentUserId)
            : and(isNull(emailAlertsLog.parentUserId), ilike(emailAlertsLog.recipientEmail, recipient.email));

        const recent = await db
            .select({ id: emailAlertsLog.id })
            .from(emailAlertsLog)
            .where(
                and(
                    eq(emailAlertsLog.alertType, "low_balance"),
                    recentCond,
                    eq(emailAlertsLog.childCustomerId, customerId),
                    inArray(emailAlertsLog.status, ["sent", "pending"]),
                    gte(emailAlertsLog.sentAt, cutoff),
                ),
            )
            .limit(1);
        if (recent[0]) continue;

        await db.insert(emailAlertsLog).values({
            alertType: "low_balance",
            recipientEmail: recipient.email,
            parentUserId: recipient.parentUserId,
            childCustomerId: customerId,
            subject,
            thresholdAmount: String(threshold),
            balanceAtAlert: String(newBalance),
            status: "pending",
            errorMessage: null,
        });
    }
}

interface LowBalanceAlertLogRow {
    id: number;
    recipientEmail: string;
    subject: string;
    balanceAtAlert: string | null;
    thresholdAmount: string | null;
    studentName: string | null;
}

async function sendOneAlertRow(row: LowBalanceAlertLogRow): Promise<void> {
    const name = row.studentName ?? "นักเรียน";
    const html = `
      <p>เรียน ผู้ปกครองของ <strong>${name}</strong></p>
      <p>ยอดเงินคงเหลือในบัตรนักเรียนของ <strong>${name}</strong> อยู่ที่
         <strong>฿${Number(row.balanceAtAlert ?? 0).toFixed(2)}</strong>
         ซึ่งต่ำกว่า ฿${row.thresholdAmount}</p>
      <p>กรุณาเติมเงินเพื่อให้นักเรียนสามารถใช้จ่ายได้ตามปกติ</p>
      <p style="color:#888;font-size:12px">— ระบบสหกรณ์โรงเรียน ISB</p>
    `;

    let status = "sent";
    let errorMessage: string | null = null;
    try {
        await sendEmail(row.recipientEmail, row.subject, html);
    } catch (err) {
        const mapped = emailDeliveryStatusFromError(err);
        status = mapped.status;
        errorMessage = mapped.errorMessage;
    }

    await db
        .update(emailAlertsLog)
        .set({ status, errorMessage, sentAt: new Date().toISOString() })
        .where(eq(emailAlertsLog.id, row.id));
}

/** Called by the scheduler at the configured send time — flushes all pending alerts. */
export async function sendPendingLowBalanceAlerts(): Promise<void> {
    const pending = await db
        .select({
            id: emailAlertsLog.id,
            recipientEmail: emailAlertsLog.recipientEmail,
            subject: emailAlertsLog.subject,
            balanceAtAlert: emailAlertsLog.balanceAtAlert,
            thresholdAmount: emailAlertsLog.thresholdAmount,
            studentName: customers.name,
        })
        .from(emailAlertsLog)
        .leftJoin(customers, eq(customers.id, emailAlertsLog.childCustomerId))
        .where(
            and(
                eq(emailAlertsLog.alertType, "low_balance"),
                eq(emailAlertsLog.status, "pending"),
            ),
        );

    for (const row of pending) {
        await sendOneAlertRow(row);
    }
}

/** Manually (re)send one specific low-balance alert row right now, regardless of the
 *  scheduled daily send time. Used by the admin "Send now" action. */
export async function sendSingleLowBalanceAlert(id: number): Promise<void> {
    const [row] = await db
        .select({
            id: emailAlertsLog.id,
            recipientEmail: emailAlertsLog.recipientEmail,
            subject: emailAlertsLog.subject,
            balanceAtAlert: emailAlertsLog.balanceAtAlert,
            thresholdAmount: emailAlertsLog.thresholdAmount,
            studentName: customers.name,
        })
        .from(emailAlertsLog)
        .leftJoin(customers, eq(customers.id, emailAlertsLog.childCustomerId))
        .where(and(eq(emailAlertsLog.alertType, "low_balance"), eq(emailAlertsLog.id, id)))
        .limit(1);

    if (!row) {
        const err = new Error("Alert not found") as Error & { status: number };
        err.status = 404;
        throw err;
    }

    await sendOneAlertRow(row);
}
