/**
 * ISB profile photos — read from local SFTP upload dir, serve via public HTTP URL.
 *
 * Env:
 *   ISB_PHOTO_DIR      — filesystem root (e.g. /sftp/sftp-client/upload)
 *   BACKEND_BASE_URL   — public API origin used when building photo_url for DB storage
 */
import { logger } from "@/logger";
import fs from "node:fs/promises";
import path from "node:path";

/** ISB sync filenames: "202672_SF.jpg", "23973_ST.jpg", etc. */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$/i;

function statusErr(status: number, message: string): Error {
    const err = new Error(message);
    (err as { status?: number }).status = status;
    return err;
}

export function isSafeProfilePhotoFilename(filename: string): boolean {
    return SAFE_FILENAME.test(filename);
}

function contentTypeFromExt(ext: string): string {
    switch (ext.toLowerCase()) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        default:
            return "application/octet-stream";
    }
}

/**
 * Public URL stored on users.photo_url / customers.photo_url after ISB sync.
 * Requires BACKEND_BASE_URL; falls back to legacy ISB_PHOTO_BASE_URL, then raw filename.
 */
export function buildProfilePhotoUrl(filename: string | undefined | null): string | null {
    const name = filename?.trim();
    if (!name) return null;

    const apiBase = process.env.BACKEND_BASE_URL?.replace(/\/$/, "");
    if (apiBase) {
        return `${apiBase}/api/v1/profile-photos/${encodeURIComponent(name)}`;
    }

    const legacyBase = process.env.ISB_PHOTO_BASE_URL?.replace(/\/$/, "");
    if (legacyBase && /^https?:\/\//i.test(legacyBase)) {
        return `${legacyBase}/${name}`;
    }

    return name;
}

export interface ProfilePhotoBinary {
    content: Buffer;
    contentType: string;
    sizeBytes: number;
}

export async function readProfilePhoto(filename: string): Promise<ProfilePhotoBinary> {
    const name = filename.trim();
    if (!isSafeProfilePhotoFilename(name)) {
        throw statusErr(400, "Invalid profile photo filename");
    }

    const dir = process.env.ISB_PHOTO_DIR;
    if (!dir) {
        throw statusErr(503, "Profile photo storage is not configured (ISB_PHOTO_DIR)");
    }

    const resolvedDir = path.resolve(dir);
    const resolvedFile = path.resolve(resolvedDir, name);
    if (resolvedFile !== resolvedDir && !resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
        throw statusErr(400, "Invalid profile photo filename");
    }

    try {
        const content = await fs.readFile(resolvedFile);
        const contentType = contentTypeFromExt(path.extname(name));
        return { content, contentType, sizeBytes: content.byteLength };
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            // Case mismatch on disk (e.g. .JPG vs .jpg) — try once before 404.
            try {
                const entries = await fs.readdir(resolvedDir);
                const hit = entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
                if (hit) {
                    const altPath = path.join(resolvedDir, hit);
                    const content = await fs.readFile(altPath);
                    const contentType = contentTypeFromExt(path.extname(hit));
                    return { content, contentType, sizeBytes: content.byteLength };
                }
            } catch {
                // fall through to 404
            }
            logger.warn(`[PP-01] readProfilePhoto() missing file: ${resolvedFile}`);
            throw statusErr(404, "Profile photo not found");
        }
        throw e;
    }
}
