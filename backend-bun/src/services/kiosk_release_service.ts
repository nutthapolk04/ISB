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

export const KIOSK_RELEASE_MANIFEST_FILENAME = "kiosk-release.json";

export interface KioskReleaseArtifactDTO {
    filename: string;
    kiosk_username?: string;
    download_url: string | null;
}

export interface KioskReleaseManifestDTO {
    version: string;
    version_code: number;
    published_at: string;
    build_id?: string;
    artifacts: KioskReleaseArtifactDTO[];
}

function statusErr(status: number, message: string): Error {
    const err = new Error(message);
    (err as { status?: number }).status = status;
    return err;
}

export function isSafeKioskReleaseFilename(filename: string): boolean {
    return SAFE_FILENAME.test(filename);
}

function semverToVersionCode(version: string): number | null {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    if (!match) return null;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (minor > 99 || patch > 99) return null;
    return major * 10_000 + minor * 100 + patch;
}

interface RawKioskReleaseManifest {
    version: string;
    version_code?: number;
    published_at: string;
    build_id?: string;
    artifacts: Array<{
        filename: string;
        kiosk_username?: string;
    }>;
}

function normalizeManifest(raw: RawKioskReleaseManifest): KioskReleaseManifestDTO {
    const versionCode =
        typeof raw.version_code === "number" && Number.isFinite(raw.version_code)
            ? raw.version_code
            : semverToVersionCode(raw.version) ?? 0;

    const artifacts = (raw.artifacts ?? []).map((artifact) => {
        const filename = artifact.filename?.trim() ?? "";
        return {
            filename,
            kiosk_username: artifact.kiosk_username?.trim() || undefined,
            download_url: buildKioskReleaseUrl(filename),
        };
    });

    return {
        version: raw.version.trim(),
        version_code: versionCode,
        published_at: raw.published_at,
        build_id: raw.build_id?.trim() || undefined,
        artifacts,
    };
}

export function resolveKioskReleaseArtifact(
    manifest: KioskReleaseManifestDTO,
    opts: { apkFilename?: string | null; kioskUsername?: string | null },
): KioskReleaseArtifactDTO | null {
    const apkFilename = opts.apkFilename?.trim();
    if (apkFilename) {
        return manifest.artifacts.find((a) => a.filename === apkFilename) ?? null;
    }

    const username = opts.kioskUsername?.trim();
    if (username) {
        return manifest.artifacts.find((a) => a.kiosk_username === username) ?? null;
    }

    return null;
}

export async function readKioskReleaseManifest(): Promise<KioskReleaseManifestDTO> {
    const dir = process.env.ISB_PHOTO_DIR;
    if (!dir) {
        throw statusErr(503, "Kiosk release storage is not configured (ISB_PHOTO_DIR)");
    }

    const resolvedDir = path.resolve(dir);
    const manifestPath = path.resolve(resolvedDir, KIOSK_RELEASE_MANIFEST_FILENAME);
    if (manifestPath !== resolvedDir && !manifestPath.startsWith(`${resolvedDir}${path.sep}`)) {
        throw statusErr(400, "Invalid kiosk release manifest path");
    }

    let rawText: string;
    try {
        rawText = await fs.readFile(manifestPath, "utf8");
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            logger.warn(`[KR-02] readKioskReleaseManifest() missing file: ${manifestPath}`);
            throw statusErr(404, "Kiosk release manifest not found");
        }
        throw e;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        throw statusErr(500, "Kiosk release manifest is not valid JSON");
    }

    const raw = parsed as RawKioskReleaseManifest;
    if (!raw?.version || !raw?.published_at || !Array.isArray(raw.artifacts) || raw.artifacts.length === 0) {
        throw statusErr(500, "Kiosk release manifest is missing required fields");
    }

    for (const artifact of raw.artifacts) {
        if (!artifact?.filename || !isSafeKioskReleaseFilename(artifact.filename)) {
            throw statusErr(500, "Kiosk release manifest contains an invalid APK filename");
        }
    }

    return normalizeManifest(raw);
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
