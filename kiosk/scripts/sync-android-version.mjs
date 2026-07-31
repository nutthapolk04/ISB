/**
 * Sync Android versionCode / versionName from kiosk/package.json.
 * versionCode = major*10000 + minor*100 + patch (each segment 0–99).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kioskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(kioskRoot, 'package.json'), 'utf8'));
const version = String(pkg.version ?? '').trim();
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

if (!match) {
    console.error(`sync-android-version: invalid semver in package.json: ${version}`);
    process.exit(1);
}

const major = Number(match[1]);
const minor = Number(match[2]);
const patch = Number(match[3]);
if (minor > 99 || patch > 99) {
    console.error('sync-android-version: minor and patch must be 0–99');
    process.exit(1);
}

const versionCode = major * 10_000 + minor * 100 + patch;
const gradlePath = path.join(kioskRoot, 'android/app/build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');

gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);

writeFileSync(gradlePath, gradle);
console.log(`sync-android-version: ${version} → versionCode ${versionCode}`);
