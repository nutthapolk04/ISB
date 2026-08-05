import nodemailer from "nodemailer";

export const SMTP_NOT_CONFIGURED_MSG =
    "SMTP not configured — set SMTP_HOST, SMTP_USERNAME, and SMTP_PASSWORD on the server";

/** True when outbound email can be attempted (SMTP_HOST is set). */
export function isEmailConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST?.trim());
}

/**
 * Outbound email is a production-only capability.
 *
 * uat carries the same real SMTP credentials as prod (see .env.uat), so before
 * this gate a staging box would happily mail real parents/staff during testing.
 * Env is read inside the function — never captured at module scope — so the
 * value can be flipped in tests (see tests/email_service.test.ts) and matches
 * the idiom in lib/placeholder_password.ts.
 */
export function isEmailEnabledInCurrentEnv(): boolean {
    return (process.env.APP_ENV ?? "") === "prod";
}

export function emailDisabledInEnvMsg(): string {
    const env = process.env.APP_ENV?.trim() || "(unset)";
    return `Outbound email is disabled in this environment (APP_ENV=${env}) — only prod sends email`;
}

export class EmailNotConfiguredError extends Error {
    constructor(message: string = SMTP_NOT_CONFIGURED_MSG) {
        super(message);
        this.name = "EmailNotConfiguredError";
    }
}

/**
 * Raised when SMTP is fine but the environment isn't allowed to send.
 *
 * Deliberately extends EmailNotConfiguredError so every existing consumer keeps
 * working untouched: emailDeliveryStatusFromError() still maps it to "skipped"
 * (not "failed" — nothing is broken), and AdminSettingsController.testEmail()'s
 * `instanceof EmailNotConfiguredError` branch still answers 503 while now
 * reporting the accurate reason via `e.message` instead of telling an admin to
 * set SMTP vars that are already set.
 */
export class EmailDisabledInEnvError extends EmailNotConfiguredError {
    constructor() {
        super(emailDisabledInEnvMsg());
        this.name = "EmailDisabledInEnvError";
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
    // Env gate first, and above createTransport(), so a non-prod box never even
    // opens an SMTP connection — checking creds first would report the wrong
    // reason on uat, where SMTP_HOST is set.
    if (!isEmailEnabledInCurrentEnv()) {
        throw new EmailDisabledInEnvError();
    }
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
