import { db } from "@/db/client";
import { parentChildLinks, users, customers, emailAlertsLog } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { sendEmail } from "./email_service";

const THRESHOLD = 300;

export async function checkAndSendLowBalanceAlerts(
  customerId: number,
  newBalance: number,
): Promise<void> {
  if (newBalance >= THRESHOLD) return;

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

  for (const parent of parents) {
    if (!parent.email) continue;

    // Cooldown — once per 24h per (parent, child)
    const recent = await db
      .select({ id: emailAlertsLog.id })
      .from(emailAlertsLog)
      .where(
        and(
          eq(emailAlertsLog.alertType, "low_balance"),
          eq(emailAlertsLog.parentUserId, parent.parentUserId),
          eq(emailAlertsLog.childCustomerId, customerId),
          eq(emailAlertsLog.status, "sent"),
          gte(emailAlertsLog.sentAt, cutoff),
        ),
      )
      .limit(1);
    if (recent[0]) continue;

    const subject = `แจ้งเตือน: ยอดเงินบัตรของ ${student.name} ต่ำกว่า ${THRESHOLD} บาท`;
    const html = `
      <p>เรียน ผู้ปกครองของ <strong>${student.name}</strong></p>
      <p>ยอดเงินคงเหลือในบัตรนักเรียนของ <strong>${student.name}</strong> อยู่ที่
         <strong>฿${newBalance.toFixed(2)}</strong>
         ซึ่งต่ำกว่า ฿${THRESHOLD}</p>
      <p>กรุณาเติมเงินเพื่อให้นักเรียนสามารถใช้จ่ายได้ตามปกติ</p>
      <p style="color:#888;font-size:12px">— ระบบสหกรณ์โรงเรียน ISB</p>
    `;

    let status = "sent";
    let errorMessage: string | null = null;
    try {
      await sendEmail(parent.email, subject, html);
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    await db.insert(emailAlertsLog).values({
      alertType: "low_balance",
      recipientEmail: parent.email,
      parentUserId: parent.parentUserId,
      childCustomerId: customerId,
      subject,
      thresholdAmount: String(THRESHOLD),
      balanceAtAlert: String(newBalance),
      status,
      errorMessage,
    });
  }
}
