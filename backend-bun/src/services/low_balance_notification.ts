import { db } from "@/db/client";
import { parentChildLinks, users, customers, emailAlertsLog } from "@/db/schema";
import { eq, and, gte, inArray } from "drizzle-orm";
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

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const subject = `แจ้งเตือน: ยอดเงินบัตรของ ${student.name} ต่ำกว่า ${threshold} บาท`;

    for (const parent of parents) {
        if (!parent.email) continue;

        // Skip if already sent or pending within 24 h for this parent–child pair
        const recent = await db
            .select({ id: emailAlertsLog.id })
            .from(emailAlertsLog)
            .where(
                and(
                    eq(emailAlertsLog.alertType, "low_balance"),
                    eq(emailAlertsLog.parentUserId, parent.parentUserId),
                    eq(emailAlertsLog.childCustomerId, customerId),
                    inArray(emailAlertsLog.status, ["sent", "pending"]),
                    gte(emailAlertsLog.sentAt, cutoff),
                ),
            )
            .limit(1);
        if (recent[0]) continue;

        await db.insert(emailAlertsLog).values({
            alertType: "low_balance",
            recipientEmail: parent.email,
            parentUserId: parent.parentUserId,
            childCustomerId: customerId,
            subject,
            thresholdAmount: String(threshold),
            balanceAtAlert: String(newBalance),
            status: "pending",
            errorMessage: null,
        });
    }
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
}
