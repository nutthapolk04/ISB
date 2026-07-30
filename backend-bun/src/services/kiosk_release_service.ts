/**
 * Kiosk APK releases — read from local filesystem, serve via public HTTP URL.
 *
 * Env:
 *   ISB_PHOTO_DIR      — same SFTP upload dir as profile photos (e.g. /sftp/sftp-client/upload)
 *   BACKEND_BASE_URL   — public API origin for building download URLs
 */
import { logger } from "@/logger";
import fs from "node:fs/promises";
import path from "node:path";

/** e.g. kiosk-prod-01.apk, kiosk-uat.apk */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+\.apk$/i;

function statusErr(status: number, message: string): Error {
    const err = new Error(message);
    (err as { status?: number }).status = status;
    return err;
}

export function isSafeKioskReleaseFilename(filename: string): boolean {
    return SAFE_FILENAME.test(filename);
}

export function buildKioskReleaseUrl(filename: string | undefined | null): string | null {
    const name = filename?.trim();
    if (!name || !isSafeKioskReleaseFilename(name)) return null;

    const apiBase = process.env.BACKEND_BASE_URL?.replace(/\/$/, "");
    if (!apiBase) return null;

    return `${apiBase}/api/v1/kiosk/releases/${encodeURIComponent(name)}`;
}

export interface KioskReleaseBinary {
    content: Buffer;
    contentType: string;
    sizeBytes: number;
    filename: string;
}

export async function readKioskRelease(filename: string): Promise<KioskReleaseBinary> {
    const name = filename.trim();
    if (!isSafeKioskReleaseFilename(name)) {
        throw statusErr(400, "Invalid kiosk release filename");
    }

    const dir = process.env.ISB_PHOTO_DIR;
    if (!dir) {
        throw statusErr(503, "Kiosk release storage is not configured (ISB_PHOTO_DIR)");
    }

    const resolvedDir = path.resolve(dir);
    const resolvedFile = path.resolve(resolvedDir, name);
    if (resolvedFile !== resolvedDir && !resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
        throw statusErr(400, "Invalid kiosk release filename");
    }

    try {
        const content = await fs.readFile(resolvedFile);
        return {
            content,
            contentType: "application/vnd.android.package-archive",
            sizeBytes: content.byteLength,
            filename: name,
        };
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            try {
                const entries = await fs.readdir(resolvedDir);
                const hit = entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
                if (hit) {
                    const altPath = path.join(resolvedDir, hit);
                    const content = await fs.readFile(altPath);
                    return {
                        content,
                        contentType: "application/vnd.android.package-archive",
                        sizeBytes: content.byteLength,
                        filename: hit,
                    };
                }
            } catch {
                // fall through to 404
            }
            logger.warn(`[KR-01] readKioskRelease() missing file: ${resolvedFile}`);
            throw statusErr(404, "Kiosk release not found");
        }
        throw e;
    }
}
