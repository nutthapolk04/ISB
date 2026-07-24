import nodemailer from "nodemailer";

export const SMTP_NOT_CONFIGURED_MSG =
    "SMTP not configured — set SMTP_HOST, SMTP_USERNAME, and SMTP_PASSWORD on the server";

/** True when outbound email can be attempted (SMTP_HOST is set). */
export function isEmailConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST?.trim());
}

export class EmailNotConfiguredError extends Error {
    constructor() {
        super(SMTP_NOT_CONFIGURED_MSG);
        this.name = "EmailNotConfiguredError";
    }
}

/** Map a sendEmail() failure to an email_alerts_log status. */
export function emailDeliveryStatusFromError(err: unknown): {
    status: "failed" | "skipped";
    errorMessage: string;
} {
    if (err instanceof EmailNotConfiguredError) {
        return { status: "skipped", errorMessage: err.message };
    }
    return {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
    };
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!isEmailConfigured()) {
        throw new EmailNotConfiguredError();
    }

    const port = Number(process.env.SMTP_PORT ?? 587);
    const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: {
            user: process.env.SMTP_USERNAME ?? "",
            pass: process.env.SMTP_PASSWORD ?? "",
        },
    });

    await transport.sendMail({
        from: `"${process.env.SMTP_FROM_NAME ?? "ISB"}" <${process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USERNAME ?? ""}>`,
        to,
        subject,
        html,
    });
}
