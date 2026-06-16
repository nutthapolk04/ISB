import nodemailer from "nodemailer";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) return; // email disabled — skip silently

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: {
      user: process.env.SMTP_USERNAME ?? "",
      pass: process.env.SMTP_PASSWORD ?? "",
    },
  });

  await transport.sendMail({
    from: `"${process.env.SMTP_FROM_NAME ?? "ISB"}" <${process.env.SMTP_FROM_EMAIL ?? ""}>`,
    to,
    subject,
    html,
  });
}
