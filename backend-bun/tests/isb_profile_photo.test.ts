import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    buildProfilePhotoUrl,
    isSafeProfilePhotoFilename,
    readProfilePhoto,
} from "../src/services/isb_profile_photo_service";

describe("isb_profile_photo_service", () => {
    const saved = {
        backendBaseUrl: process.env.BACKEND_BASE_URL,
        isbPhotoDir: process.env.ISB_PHOTO_DIR,
        isbPhotoBaseUrl: process.env.ISB_PHOTO_BASE_URL,
    };

    afterEach(() => {
        process.env.BACKEND_BASE_URL = saved.backendBaseUrl;
        process.env.ISB_PHOTO_DIR = saved.isbPhotoDir;
        process.env.ISB_PHOTO_BASE_URL = saved.isbPhotoBaseUrl;
    });

    describe("buildProfilePhotoUrl", () => {
        it("builds API URL when BACKEND_BASE_URL is set", () => {
            process.env.BACKEND_BASE_URL = "https://api.example.com/";
            process.env.ISB_PHOTO_BASE_URL = "https://legacy.example.com";
            expect(buildProfilePhotoUrl("202672_SF.jpg")).toBe(
                "https://api.example.com/api/v1/profile-photos/202672_SF.jpg",
            );
        });

        it("falls back to ISB_PHOTO_BASE_URL when BACKEND_BASE_URL is unset", () => {
            delete process.env.BACKEND_BASE_URL;
            process.env.ISB_PHOTO_BASE_URL = "https://cdn.example.com/photos";
            expect(buildProfilePhotoUrl("202672_SF.jpg")).toBe(
                "https://cdn.example.com/photos/202672_SF.jpg",
            );
        });

        it("returns raw filename when no base is configured", () => {
            delete process.env.BACKEND_BASE_URL;
            delete process.env.ISB_PHOTO_BASE_URL;
            expect(buildProfilePhotoUrl("202672_SF.jpg")).toBe("202672_SF.jpg");
        });
    });

    describe("isSafeProfilePhotoFilename", () => {
        it("accepts ISB-style filenames", () => {
            expect(isSafeProfilePhotoFilename("202672_SF.jpg")).toBe(true);
            expect(isSafeProfilePhotoFilename("23973_ST.jpeg")).toBe(true);
        });

        it("rejects path traversal", () => {
            expect(isSafeProfilePhotoFilename("../etc/passwd")).toBe(false);
            expect(isSafeProfilePhotoFilename("foo/bar.jpg")).toBe(false);
        });
    });

    describe("readProfilePhoto", () => {
        let tmpDir: string;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "isb-photo-"));
            process.env.ISB_PHOTO_DIR = tmpDir;
            await fs.writeFile(path.join(tmpDir, "202672_SF.jpg"), Buffer.from("fake-jpeg"));
        });

        afterEach(async () => {
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it("reads a file from ISB_PHOTO_DIR", async () => {
            const bin = await readProfilePhoto("202672_SF.jpg");
            expect(bin.content.toString()).toBe("fake-jpeg");
            expect(bin.contentType).toBe("image/jpeg");
        });

        it("404 when file is missing", async () => {
            await expect(readProfilePhoto("missing_SF.jpg")).rejects.toMatchObject({ status: 404 });
        });

        it("400 for unsafe filenames", async () => {
            await expect(readProfilePhoto("../202672_SF.jpg")).rejects.toMatchObject({ status: 400 });
        });
    });
});

describe("profile photo route", () => {
    it("serves binary from ISB_PHOTO_DIR", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "isb-photo-route-"));
        process.env.ISB_PHOTO_DIR = tmpDir;
        process.env.BACKEND_BASE_URL = "https://api.example.com";
        await fs.writeFile(path.join(tmpDir, "202672_SF.jpg"), Buffer.from("route-jpeg"));

        const { createTestApp } = await import("./helpers");
        const app = createTestApp();
        const res = await app.handle(
            new Request("http://localhost/api/v1/profile-photos/202672_SF.jpg"),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/jpeg");
        expect(await res.text()).toBe("route-jpeg");

        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
