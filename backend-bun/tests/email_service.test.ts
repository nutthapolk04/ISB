/**
 * Outbound email is gated twice: by environment, then by recipient.
 *
 * uat ships the same real SMTP credentials as prod (.env.uat vs .env.prod), so a
 * staging box could mail real parents and staff during testing. prod sends to
 * anyone; uat sends only to the addresses in ALLOW_EMAIL; every other APP_ENV
 * sends nothing. Both gates refuse BEFORE a nodemailer transport is built, so no
 * connection is attempted.
 *
 * The allowlist fails CLOSED — an unset or empty ALLOW_EMAIL blocks everything
 * on uat. A missing env var must never read as "send to all", which is the one
 * mistake here that reaches real people.
 *
 * Pure-unit, no DB and no nodemailer stub — the repo has no mocking layer, so
 * "never opened a connection" is asserted structurally: the env guard sits
 * above createTransport(), and an unroutable SMTP_HOST would otherwise make the
 * call hang/fail slowly rather than throw instantly. Env-restore idiom copied
 * from tests/placeholder_password_login.test.ts, which is the only other suite
 * that mutates APP_ENV (bun runs every test file in one process, so leaking
 * APP_ENV=prod would silently change auth_service and placeholder-password
 * behaviour for other suites).
 */
import { describe, expect, it, afterEach } from "bun:test";
import {
    EmailDisabledInEnvError,
    EmailNotConfiguredError,
    EmailRecipientNotAllowedError,
    SMTP_NOT_CONFIGURED_MSG,
    allowedEmailRecipients,
    emailDeliveryStatusFromError,
    emailDisabledInEnvMsg,
    isEmailConfigured,
    isEmailEnabledInCurrentEnv,
    isRecipientAllowed,
    sendEmail,
} from "@/services/email_service";

const ENV_KEYS = ["APP_ENV", "ALLOW_EMAIL", "SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_PORT"] as const;
const saved = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

function setEnv(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}

afterEach(() => {
    for (const [k, v] of saved) setEnv(k, v);
});

/** A host that must never be dialled — if the guard ever regresses, the test
 *  fails on a connection error instead of quietly passing. */
function withSmtpConfigured(): void {
    process.env.SMTP_HOST = "smtp.invalid.example";
    process.env.SMTP_USERNAME = "user";
    process.env.SMTP_PASSWORD = "pass";
}

describe("isEmailEnabledInCurrentEnv", () => {
    it("enables email on prod", () => {
        process.env.APP_ENV = "prod";
        expect(isEmailEnabledInCurrentEnv()).toBe(true);
    });

    it("enables email on uat — the recipient allowlist is the gate there, not the env", () => {
        process.env.APP_ENV = "uat";
        expect(isEmailEnabledInCurrentEnv()).toBe(true);
    });

    it("disables email on development", () => {
        process.env.APP_ENV = "development";
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
    });

    it("disables email when APP_ENV is unset", () => {
        delete process.env.APP_ENV;
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
    });

    it("disables email when APP_ENV is empty", () => {
        process.env.APP_ENV = "";
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
    });

    it("does not treat production/PROD/UAT as a sending env", () => {
        // The deploy configs write exactly "prod" / "uat" — a case-sensitive
        // match keeps a typo'd env failing closed rather than open.
        for (const v of ["production", "PROD", "UAT", "Uat"]) {
            process.env.APP_ENV = v;
            expect(isEmailEnabledInCurrentEnv()).toBe(false);
        }
    });

    it("reads APP_ENV at call time, not import time", () => {
        // Guards against the module-scope capture used in pymt_gateway.ts,
        // which would make the gate impossible to flip at runtime or in tests.
        process.env.APP_ENV = "development";
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
        process.env.APP_ENV = "prod";
        expect(isEmailEnabledInCurrentEnv()).toBe(true);
    });
});

describe("allowedEmailRecipients", () => {
    it("parses a comma-separated list, trimmed and lower-cased", () => {
        process.env.ALLOW_EMAIL = " QA@Okontek.com , dev@okontek.com ";
        expect(allowedEmailRecipients()).toEqual(["qa@okontek.com", "dev@okontek.com"]);
    });

    it("accepts semicolons too — operators paste either", () => {
        process.env.ALLOW_EMAIL = "a@x.com;b@x.com";
        expect(allowedEmailRecipients()).toEqual(["a@x.com", "b@x.com"]);
    });

    it("is empty when unset, blank, or only separators", () => {
        delete process.env.ALLOW_EMAIL;
        expect(allowedEmailRecipients()).toEqual([]);
        process.env.ALLOW_EMAIL = "   ";
        expect(allowedEmailRecipients()).toEqual([]);
        process.env.ALLOW_EMAIL = ",,; ,";
        expect(allowedEmailRecipients()).toEqual([]);
    });
});

describe("isRecipientAllowed", () => {
    it("allows anyone on prod, ignoring ALLOW_EMAIL entirely", () => {
        process.env.APP_ENV = "prod";
        process.env.ALLOW_EMAIL = "only-this@okontek.com";
        expect(isRecipientAllowed("parent@real.school")).toBe(true);
    });

    it("allows an allow-listed recipient on uat", () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com,dev@okontek.com";
        expect(isRecipientAllowed("dev@okontek.com")).toBe(true);
    });

    it("blocks a recipient that isn't on the list", () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        expect(isRecipientAllowed("parent@real.school")).toBe(false);
    });

    it("matches case-insensitively — the same mailbox either way", () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        expect(isRecipientAllowed("QA@Okontek.COM")).toBe(true);
        expect(isRecipientAllowed("  qa@okontek.com  ")).toBe(true);
    });

    it("blocks EVERYTHING on uat when ALLOW_EMAIL is unset or empty", () => {
        // The failure mode that reaches real people: a forgotten env var must
        // not read as "no restrictions".
        process.env.APP_ENV = "uat";
        delete process.env.ALLOW_EMAIL;
        expect(isRecipientAllowed("qa@okontek.com")).toBe(false);
        process.env.ALLOW_EMAIL = "";
        expect(isRecipientAllowed("qa@okontek.com")).toBe(false);
    });

    it("requires EVERY address when several are passed", () => {
        // "to" reaches nodemailer as a header, so one permitted address must not
        // smuggle a real recipient along beside it.
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        expect(isRecipientAllowed("qa@okontek.com, parent@real.school")).toBe(false);
        expect(isRecipientAllowed("parent@real.school, qa@okontek.com")).toBe(false);
        expect(isRecipientAllowed("qa@okontek.com")).toBe(true);
    });

    it("blocks an empty recipient rather than treating it as nothing to check", () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        expect(isRecipientAllowed("")).toBe(false);
        expect(isRecipientAllowed("  ")).toBe(false);
    });

    it("blocks everyone on an env that can't send at all, list or no list", () => {
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        for (const v of ["development", "", "UAT"]) {
            process.env.APP_ENV = v;
            expect(isRecipientAllowed("qa@okontek.com")).toBe(false);
        }
        delete process.env.APP_ENV;
        expect(isRecipientAllowed("qa@okontek.com")).toBe(false);
    });
});

describe("sendEmail recipient gate (uat)", () => {
    it("lets an allow-listed recipient through to the SMTP stage", async () => {
        // Proof it got past both gates: the failure is now a transport error
        // against the unroutable host, not one of our own guards.
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        withSmtpConfigured();
        const err: unknown = await sendEmail("qa@okontek.com", "s", "<p>h</p>").catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(EmailNotConfiguredError);
    }, 20_000);

    it("throws EmailRecipientNotAllowedError for anyone else", async () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        withSmtpConfigured();
        await expect(sendEmail("parent@real.school", "s", "<p>h</p>"))
            .rejects.toThrow(EmailRecipientNotAllowedError);
    });

    it("rejects without dialling SMTP", async () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        withSmtpConfigured();
        const started = Date.now();
        await expect(sendEmail("parent@real.school", "s", "<p>h</p>")).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(1_000);
    });

    it("names the blocked address so a tester can see why nothing arrived", async () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        withSmtpConfigured();
        await expect(sendEmail("parent@real.school", "s", "<p>h</p>"))
            .rejects.toThrow(/parent@real\.school.*ALLOW_EMAIL/);
    });

    it("logs as skipped, not failed — nothing is broken", () => {
        process.env.APP_ENV = "uat";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        const mapped = emailDeliveryStatusFromError(new EmailRecipientNotAllowedError("parent@real.school"));
        expect(mapped.status).toBe("skipped");
        expect(mapped.errorMessage).toContain("parent@real.school");
    });

    it("answers 503 through the existing controller branch", () => {
        // AdminSettingsController.testEmail() keys off EmailNotConfiguredError.
        expect(new EmailRecipientNotAllowedError("x@y.com")).toBeInstanceOf(EmailNotConfiguredError);
        expect(new EmailRecipientNotAllowedError("x@y.com").name).toBe("EmailRecipientNotAllowedError");
    });

    it("never restricts prod", async () => {
        process.env.APP_ENV = "prod";
        process.env.ALLOW_EMAIL = "qa@okontek.com";
        withSmtpConfigured();
        const err: unknown = await sendEmail("parent@real.school", "s", "<p>h</p>").catch((e) => e);
        expect(err).not.toBeInstanceOf(EmailNotConfiguredError);
    }, 20_000);
});

describe("sendEmail env gate", () => {
    it("throws EmailDisabledInEnvError on an env that cannot send, even with SMTP fully configured", async () => {
        process.env.APP_ENV = "development";
        withSmtpConfigured();
        expect(isEmailConfigured()).toBe(true); // creds are fine; env is the blocker
        await expect(sendEmail("a@b.com", "s", "<p>h</p>")).rejects.toThrow(EmailDisabledInEnvError);
    });

    it("rejects immediately rather than dialling SMTP", async () => {
        // An unroutable host would take seconds to fail; the guard must return
        // before createTransport() so this resolves effectively instantly.
        process.env.APP_ENV = "development";
        withSmtpConfigured();
        const started = Date.now();
        await expect(sendEmail("a@b.com", "s", "<p>h</p>")).rejects.toThrow(EmailDisabledInEnvError);
        expect(Date.now() - started).toBeLessThan(1_000);
    });

    it("names the offending environment in the message", async () => {
        process.env.APP_ENV = "development";
        withSmtpConfigured();
        await expect(sendEmail("a@b.com", "s", "<p>h</p>")).rejects.toThrow(/APP_ENV=development/);
    });

    it("says (unset) rather than APP_ENV= when the var is missing", () => {
        delete process.env.APP_ENV;
        expect(emailDisabledInEnvMsg()).toContain("APP_ENV=(unset)");
    });

    it("does NOT blame SMTP configuration when the env is the reason", async () => {
        // Regression guard: reusing SMTP_NOT_CONFIGURED_MSG here would send an
        // admin on uat hunting for env vars that are already set.
        process.env.APP_ENV = "development";
        withSmtpConfigured();
        const err: unknown = await sendEmail("a@b.com", "s", "<p>h</p>").catch((e) => e);
        expect(err).toBeInstanceOf(EmailDisabledInEnvError);
        expect((err as Error).message).not.toContain("SMTP not configured");
        expect((err as Error).message).not.toBe(SMTP_NOT_CONFIGURED_MSG);
    });

    it("still reports missing SMTP config when on prod without credentials", async () => {
        process.env.APP_ENV = "prod";
        delete process.env.SMTP_HOST;
        const err = await sendEmail("a@b.com", "s", "<p>h</p>").catch((e) => e);
        expect(err).toBeInstanceOf(EmailNotConfiguredError);
        expect(err).not.toBeInstanceOf(EmailDisabledInEnvError);
        expect(err.message).toBe(SMTP_NOT_CONFIGURED_MSG);
    });
});

describe("EmailDisabledInEnvError shape — keeps existing consumers working", () => {
    it("is an EmailNotConfiguredError subclass", () => {
        // AdminSettingsController.testEmail() branches on
        // `instanceof EmailNotConfiguredError` to answer 503; subclassing means
        // that branch keeps working with no controller change.
        expect(new EmailDisabledInEnvError()).toBeInstanceOf(EmailNotConfiguredError);
    });

    it("logs as skipped, not failed", () => {
        // low_balance_notification.ts and kiosk_monitoring_service.ts both write
        // this straight into email_alerts_log.status. "failed" would wrongly
        // read as a broken mail server on every non-prod row.
        process.env.APP_ENV = "development";
        const mapped = emailDeliveryStatusFromError(new EmailDisabledInEnvError());
        expect(mapped.status).toBe("skipped");
        expect(mapped.errorMessage).toContain("APP_ENV=development");
    });

    it("keeps a genuine transport failure classified as failed", () => {
        const mapped = emailDeliveryStatusFromError(new Error("ECONNREFUSED"));
        expect(mapped.status).toBe("failed");
        expect(mapped.errorMessage).toBe("ECONNREFUSED");
    });

    it("carries a distinct name for log grepping", () => {
        expect(new EmailDisabledInEnvError().name).toBe("EmailDisabledInEnvError");
        expect(new EmailNotConfiguredError().name).toBe("EmailNotConfiguredError");
    });
});
