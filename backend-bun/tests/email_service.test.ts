/**
 * Outbound email is production-only.
 *
 * uat ships the same real SMTP credentials as prod (.env.uat vs .env.prod), so
 * a staging box used to mail real parents and staff during testing. sendEmail()
 * now refuses on any APP_ENV other than "prod", and refuses BEFORE building a
 * nodemailer transport so no connection is attempted.
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
    SMTP_NOT_CONFIGURED_MSG,
    emailDeliveryStatusFromError,
    emailDisabledInEnvMsg,
    isEmailConfigured,
    isEmailEnabledInCurrentEnv,
    sendEmail,
} from "@/services/email_service";

const ENV_KEYS = ["APP_ENV", "SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_PORT"] as const;
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
    it("enables email only on prod", () => {
        process.env.APP_ENV = "prod";
        expect(isEmailEnabledInCurrentEnv()).toBe(true);
    });

    it("disables email on uat", () => {
        process.env.APP_ENV = "uat";
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
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

    it("does not treat production/PROD as prod", () => {
        // The deploy configs write exactly "prod" (production.config.cjs) — an
        // exact match keeps a typo'd env failing closed rather than open.
        process.env.APP_ENV = "production";
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
        process.env.APP_ENV = "PROD";
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
    });

    it("reads APP_ENV at call time, not import time", () => {
        // Guards against the module-scope capture used in pymt_gateway.ts,
        // which would make the gate impossible to flip at runtime or in tests.
        process.env.APP_ENV = "uat";
        expect(isEmailEnabledInCurrentEnv()).toBe(false);
        process.env.APP_ENV = "prod";
        expect(isEmailEnabledInCurrentEnv()).toBe(true);
    });
});

describe("sendEmail env gate", () => {
    it("throws EmailDisabledInEnvError on a non-prod env even with SMTP fully configured", async () => {
        process.env.APP_ENV = "uat";
        withSmtpConfigured();
        expect(isEmailConfigured()).toBe(true); // creds are fine; env is the blocker
        await expect(sendEmail("a@b.com", "s", "<p>h</p>")).rejects.toThrow(EmailDisabledInEnvError);
    });

    it("rejects immediately rather than dialling SMTP", async () => {
        // An unroutable host would take seconds to fail; the guard must return
        // before createTransport() so this resolves effectively instantly.
        process.env.APP_ENV = "uat";
        withSmtpConfigured();
        const started = Date.now();
        await expect(sendEmail("a@b.com", "s", "<p>h</p>")).rejects.toThrow(EmailDisabledInEnvError);
        expect(Date.now() - started).toBeLessThan(1_000);
    });

    it("names the offending environment in the message", async () => {
        process.env.APP_ENV = "uat";
        withSmtpConfigured();
        await expect(sendEmail("a@b.com", "s", "<p>h</p>")).rejects.toThrow(/APP_ENV=uat/);
    });

    it("says (unset) rather than APP_ENV= when the var is missing", () => {
        delete process.env.APP_ENV;
        expect(emailDisabledInEnvMsg()).toContain("APP_ENV=(unset)");
    });

    it("does NOT blame SMTP configuration when the env is the reason", async () => {
        // Regression guard: reusing SMTP_NOT_CONFIGURED_MSG here would send an
        // admin on uat hunting for env vars that are already set.
        process.env.APP_ENV = "uat";
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
        process.env.APP_ENV = "uat";
        const mapped = emailDeliveryStatusFromError(new EmailDisabledInEnvError());
        expect(mapped.status).toBe("skipped");
        expect(mapped.errorMessage).toContain("APP_ENV=uat");
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
