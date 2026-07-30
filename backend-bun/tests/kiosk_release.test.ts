import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    buildKioskReleaseUrl,
    isSafeKioskReleaseFilename,
    readKioskRelease,
} from "../src/services/kiosk_release_service";

describe("kiosk_release_service", () => {
    const saved = {
        backendBaseUrl: process.env.BACKEND_BASE_URL,
        isbPhotoDir: process.env.ISB_PHOTO_DIR,
    };

    afterEach(() => {
        process.env.BACKEND_BASE_URL = saved.backendBaseUrl;
        process.env.ISB_PHOTO_DIR = saved.isbPhotoDir;
    });

    describe("buildKioskReleaseUrl", () => {
        it("builds API URL when BACKEND_BASE_URL is set", () => {
            process.env.BACKEND_BASE_URL = "https://api.example.com/";
            expect(buildKioskReleaseUrl("kiosk-prod-01.apk")).toBe(
                "https://api.example.com/api/v1/kiosk/releases/kiosk-prod-01.apk",
            );
        });

        it("returns null for invalid filenames", () => {
            process.env.BACKEND_BASE_URL = "https://api.example.com";
            expect(buildKioskReleaseUrl("../evil.apk")).toBeNull();
            expect(buildKioskReleaseUrl("photo.jpg")).toBeNull();
        });

        it("returns null when BACKEND_BASE_URL is unset", () => {
            delete process.env.BACKEND_BASE_URL;
            expect(buildKioskReleaseUrl("kiosk-prod-01.apk")).toBeNull();
        });
    });

    describe("isSafeKioskReleaseFilename", () => {
        it("accepts kiosk APK filenames", () => {
            expect(isSafeKioskReleaseFilename("kiosk-prod-01.apk")).toBe(true);
            expect(isSafeKioskReleaseFilename("kiosk-uat.apk")).toBe(true);
        });

        it("rejects path traversal and non-apk", () => {
            expect(isSafeKioskReleaseFilename("../etc/passwd")).toBe(false);
            expect(isSafeKioskReleaseFilename("foo/bar.apk")).toBe(false);
            expect(isSafeKioskReleaseFilename("photo.jpg")).toBe(false);
        });
    });

    describe("readKioskRelease", () => {
        let tmpDir: string;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiosk-apk-"));
            process.env.ISB_PHOTO_DIR = tmpDir;
            await fs.writeFile(path.join(tmpDir, "kiosk-prod-01.apk"), Buffer.from("fake-apk"));
        });

        afterEach(async () => {
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it("reads a file from ISB_PHOTO_DIR", async () => {
            const bin = await readKioskRelease("kiosk-prod-01.apk");
            expect(bin.content.toString()).toBe("fake-apk");
            expect(bin.contentType).toBe("application/vnd.android.package-archive");
        });

        it("404 when file is missing", async () => {
            await expect(readKioskRelease("missing.apk")).rejects.toMatchObject({ status: 404 });
        });

        it("400 for unsafe filenames", async () => {
            await expect(readKioskRelease("../kiosk-prod-01.apk")).rejects.toMatchObject({ status: 400 });
        });

        it("503 when ISB_PHOTO_DIR is unset", async () => {
            delete process.env.ISB_PHOTO_DIR;
            await expect(readKioskRelease("kiosk-prod-01.apk")).rejects.toMatchObject({ status: 503 });
        });
    });
});

describe("kiosk release route", () => {
    it("serves binary from ISB_PHOTO_DIR", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiosk-apk-route-"));
        process.env.ISB_PHOTO_DIR = tmpDir;
        process.env.BACKEND_BASE_URL = "https://api.example.com";
        await fs.writeFile(path.join(tmpDir, "kiosk-prod-01.apk"), Buffer.from("route-apk"));

        const { createTestApp } = await import("./helpers");
        const app = createTestApp();
        const res = await app.handle(
            new Request("http://localhost/api/v1/kiosk/releases/kiosk-prod-01.apk"),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/vnd.android.package-archive");
        expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="kiosk-prod-01.apk"');
        expect(await res.text()).toBe("route-apk");

        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
