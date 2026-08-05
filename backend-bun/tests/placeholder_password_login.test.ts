import { describe, expect, test, afterEach } from "bun:test";
import {
    SYNC_PLACEHOLDER_PASSWORD,
    isSyncPlaceholderPasswordHash,
    passwordLoginBlockedInCurrentEnv,
} from "@/lib/placeholder_password";

describe("placeholder password login policy", () => {
    const prevAppEnv = process.env.APP_ENV;

    afterEach(() => {
        if (prevAppEnv === undefined) delete process.env.APP_ENV;
        else process.env.APP_ENV = prevAppEnv;
    });

    test("blocks password login only on prod and uat", () => {
        process.env.APP_ENV = "prod";
        expect(passwordLoginBlockedInCurrentEnv()).toBe(true);
        process.env.APP_ENV = "uat";
        expect(passwordLoginBlockedInCurrentEnv()).toBe(true);
        process.env.APP_ENV = "development";
        expect(passwordLoginBlockedInCurrentEnv()).toBe(false);
        delete process.env.APP_ENV;
        expect(passwordLoginBlockedInCurrentEnv()).toBe(false);
    });

    test("detects sync placeholder bcrypt hash", async () => {
        const parentHash = await Bun.password.hash(SYNC_PLACEHOLDER_PASSWORD, {
            algorithm: "bcrypt",
            cost: 10,
        });
        const cashierHash = await Bun.password.hash("cashier", {
            algorithm: "bcrypt",
            cost: 12,
        });
        expect(await isSyncPlaceholderPasswordHash(parentHash)).toBe(true);
        expect(await isSyncPlaceholderPasswordHash(cashierHash)).toBe(false);
    });
});
