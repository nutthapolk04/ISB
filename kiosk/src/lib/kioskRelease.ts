export interface KioskReleaseManifest {
    version: string;
    version_code: number;
    published_at: string;
    build_id?: string;
    artifacts: Array<{
        filename: string;
        kiosk_username?: string;
        download_url: string | null;
    }>;
}

export interface KioskUpdateCheck {
    currentVersionCode: number;
    currentVersionName: string;
    latestVersionCode: number;
    latestVersionName: string;
    downloadUrl: string | null;
    updateAvailable: boolean;
    publishedAt: string | null;
}

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function kioskApkFilenameFromEnv(): string {
    return (import.meta.env.VITE_KIOSK_APK_FILENAME as string | undefined)?.trim() ?? '';
}

function kioskUsernameFromEnv(): string {
    return (import.meta.env.VITE_KIOSK_USERNAME as string | undefined)?.trim() ?? '';
}

export async function fetchKioskReleaseManifest(): Promise<KioskReleaseManifest> {
    const res = await fetch(`${apiBase}/kiosk/releases/manifest`);
    if (!res.ok) {
        throw new Error(`Release manifest unavailable (${res.status})`);
    }
    return res.json() as Promise<KioskReleaseManifest>;
}

function resolveArtifact(manifest: KioskReleaseManifest) {
    const apkFilename = kioskApkFilenameFromEnv();
    if (apkFilename) {
        return manifest.artifacts.find((a) => a.filename === apkFilename) ?? null;
    }
    const username = kioskUsernameFromEnv();
    if (username) {
        return manifest.artifacts.find((a) => a.kiosk_username === username) ?? null;
    }
    return null;
}

export async function checkKioskUpdate(getBuild: () => Promise<{ version: string; build: string }>): Promise<KioskUpdateCheck> {
    const info = await getBuild();
    const currentVersionCode = Number.parseInt(info.build, 10) || 0;
    const manifest = await fetchKioskReleaseManifest();
    const artifact = resolveArtifact(manifest);

    return {
        currentVersionCode,
        currentVersionName: info.version,
        latestVersionCode: manifest.version_code,
        latestVersionName: manifest.version,
        downloadUrl: artifact?.download_url ?? null,
        updateAvailable: manifest.version_code > currentVersionCode,
        publishedAt: manifest.published_at ?? null,
    };
}
