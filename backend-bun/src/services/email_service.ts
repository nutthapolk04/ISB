import nodemailer from "nodemailer";

export const SMTP_NOT_CONFIGURED_MSG =
    "SMTP not configured — set SMTP_HOST, SMTP_USERNAME, and SMTP_PASSWORD on the server";

/** True when outbound email can be attempted (SMTP_HOST is set). */
export function isEmailConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST?.trim());
}

/**
 * APP_ENV, trimmed but NOT case-folded.
 *
 * The deploy configs write exactly "prod" / "uat"; matching case-sensitively
 * keeps a typo'd value ("PROD", "production") failing closed instead of open.
 * Read inside every function — never captured at module scope — so tests can
 * flip it (same idiom as lib/placeholder_password.ts).
 */
function currentEnv(): string {
    return (process.env.APP_ENV ?? "").trim();
}

/**
 * Environments allowed to open an SMTP connection at all.
 *
 * prod sends to anyone. uat may send, but only to the addresses listed in
 * ALLOW_EMAIL — see isRecipientAllowed(). Every other environment is off.
 *
 * uat carries the same real SMTP credentials as prod (see .env.uat), which is
 * why the allowlist exists: without it a staging box mails real parents and
 * staff during testing.
 */
export function isEmailEnabledInCurrentEnv(): boolean {
    const env = currentEnv();
    return env === "prod" || env === "uat";
}

export function emailDisabledInEnvMsg(): string {
    const env = process.env.APP_ENV?.trim() || "(unset)";
    return `Outbound email is disabled in this environment (APP_ENV=${env}) — only prod and uat send email`;
}

/**
 * Addresses uat is allowed to mail, from ALLOW_EMAIL (comma- or
 * semicolon-separated). Lower-cased for comparison.
 *
 * An unset or empty list allows NOTHING. Failing closed is the whole point: uat
 * holds working credentials for the school's real mail server, so a missing env
 * var must never read as "send to everyone".
 */
export function allowedEmailRecipients(): string[] {
    return (process.env.ALLOW_EMAIL ?? "")
        .split(/[,;]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0);
}

/**
 * Whether this recipient may be mailed in the current environment.
 *
 * prod: anyone. uat: only ALLOW_EMAIL entries. Anything else: nobody.
 *
 * `to` is split on commas before checking, and EVERY address must be allowed —
 * a header like "tester@allowed.com, parent@real.school" must not slip a real
 * recipient through on the back of a permitted one.
 */
export function isRecipientAllowed(to: string): boolean {
    const env = currentEnv();
    if (env === "prod") return true;
    if (env !== "uat") return false;

    const allowed = new Set(allowedEmailRecipients());
    if (allowed.size === 0) return false;

    const targets = to.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
    if (targets.length === 0) return false;
    return targets.every((t) => allowed.has(t));
}

export function recipientNotAllowedMsg(to: string): string {
    const count = allowedEmailRecipients().length;
    return `Recipient '${to}' is not in ALLOW_EMAIL — uat only sends to the ${count} allow-listed address(es)`;
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

/**
 * Raised on uat when the recipient isn't in ALLOW_EMAIL.
 *
 * Same base class as EmailDisabledInEnvError and for the same reason: this is a
 * deliberate skip, not a delivery failure, so email_alerts_log records
 * "skipped" and the admin test-email endpoint answers 503 with the real reason.
 */
export class EmailRecipientNotAllowedError extends EmailNotConfiguredError {
    constructor(to: string) {
        super(recipientNotAllowedMsg(to));
        this.name = "EmailRecipientNotAllowedError";
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
    // Both gates sit above createTransport(), so a box that isn't allowed to
    // mail this recipient never even opens an SMTP connection. Order matters:
    // checking creds first would report the wrong reason on uat, where
    // SMTP_HOST is set and working.
    if (!isEmailEnabledInCurrentEnv()) {
        throw new EmailDisabledInEnvError();
    }
    if (!isRecipientAllowed(to)) {
        throw new EmailRecipientNotAllowedError(to);
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
