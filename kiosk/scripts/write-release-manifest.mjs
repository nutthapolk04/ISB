/**
 * Write kiosk-release.json for upload alongside APKs.
 * Usage: node scripts/write-release-manifest.mjs <outDir> [--build-id <id>]
 *
 * Reads scripts/kiosk-release-matrix.json for artifact list.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { versionCodeFromSemver } from './version-code.mjs';

const kioskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2];
if (!outDir) {
    console.error('Usage: node scripts/write-release-manifest.mjs <outDir> [--build-id <id>]');
    process.exit(1);
}

let buildId;
for (let i = 3; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--build-id') buildId = process.argv[i + 1];
}

const pkg = JSON.parse(readFileSync(path.join(kioskRoot, 'package.json'), 'utf8'));
const version = String(pkg.version).trim();
const versionCode = versionCodeFromSemver(version);
if (!versionCode) {
    console.error(`write-release-manifest: invalid version ${version}`);
    process.exit(1);
}

const matrix = JSON.parse(
    readFileSync(path.join(kioskRoot, 'scripts/kiosk-release-matrix.json'), 'utf8'),
);

const manifest = {
    version,
    version_code: versionCode,
    published_at: new Date().toISOString(),
    ...(buildId ? { build_id: buildId } : {}),
    artifacts: matrix.map((row) => ({
        filename: row.apk_filename,
        kiosk_username: row.kiosk_username,
    })),
};

mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'kiosk-release.json');
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`write-release-manifest: wrote ${outPath}`);
