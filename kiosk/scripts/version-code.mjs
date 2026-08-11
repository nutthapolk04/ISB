/**
 * Android versionCode from kiosk semver — must match sync-android-version.mjs.
 * major*10000 + minor*100 + patch (minor/patch 0–99).
 */
export function versionCodeFromSemver(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
    if (!match) return 0;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    return major * 10_000 + minor * 100 + patch;
}
