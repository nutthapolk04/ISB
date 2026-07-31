import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    buildKioskReleaseUrl,
    isSafeKioskReleaseFilename,
    readKioskRelease,
    readKioskReleaseManifest,
    resolveKioskReleaseArtifact,
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

    describe("readKioskReleaseManifest", () => {
        let tmpDir: string;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiosk-manifest-"));
            process.env.ISB_PHOTO_DIR = tmpDir;
            process.env.BACKEND_BASE_URL = "https://api.example.com";
            await fs.writeFile(
                path.join(tmpDir, "kiosk-release.json"),
                JSON.stringify({
                    version: "1.2.3",
                    published_at: "2026-07-31T10:00:00Z",
                    artifacts: [
                        { filename: "kiosk-prod-01.apk", kiosk_username: "kiosk_service" },
                        { filename: "kiosk-prod-02.apk", kiosk_username: "kiosk_service_2" },
                    ],
                }),
            );
        });

        afterEach(async () => {
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it("reads manifest and derives version_code from semver", async () => {
            const manifest = await readKioskReleaseManifest();
            expect(manifest.version).toBe("1.2.3");
            expect(manifest.version_code).toBe(10203);
            expect(manifest.artifacts).toHaveLength(2);
            expect(manifest.artifacts[0].download_url).toBe(
                "https://api.example.com/api/v1/kiosk/releases/kiosk-prod-01.apk",
            );
        });

        it("resolves artifact by username or filename", async () => {
            const manifest = await readKioskReleaseManifest();
            expect(resolveKioskReleaseArtifact(manifest, { kioskUsername: "kiosk_service" })?.filename).toBe(
                "kiosk-prod-01.apk",
            );
            expect(resolveKioskReleaseArtifact(manifest, { apkFilename: "kiosk-prod-02.apk" })?.filename).toBe(
                "kiosk-prod-02.apk",
            );
        });

        it("404 when manifest is missing", async () => {
            await fs.rm(path.join(tmpDir, "kiosk-release.json"));
            await expect(readKioskReleaseManifest()).rejects.toMatchObject({ status: 404 });
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

    it("serves manifest JSON", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiosk-manifest-route-"));
        process.env.ISB_PHOTO_DIR = tmpDir;
        process.env.BACKEND_BASE_URL = "https://api.example.com";
        await fs.writeFile(
            path.join(tmpDir, "kiosk-release.json"),
            JSON.stringify({
                version: "1.0.0",
                version_code: 10000,
                published_at: "2026-07-31T10:00:00Z",
                artifacts: [{ filename: "kiosk-prod-01.apk", kiosk_username: "kiosk_service" }],
            }),
        );

        const { createTestApp } = await import("./helpers");
        const app = createTestApp();
        const res = await app.handle(new Request("http://localhost/api/v1/kiosk/releases/manifest"));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { version: string; artifacts: { download_url: string }[] };
        expect(body.version).toBe("1.0.0");
        expect(body.artifacts[0].download_url).toContain("kiosk-prod-01.apk");

        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
