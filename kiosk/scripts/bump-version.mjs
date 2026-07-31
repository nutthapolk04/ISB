/**
 * Bump kiosk/package.json semver once per release (not per device build).
 * Usage: node scripts/bump-version.mjs patch|minor|major
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kind = process.argv[2];
if (!['patch', 'minor', 'major'].includes(kind)) {
    console.error('Usage: node scripts/bump-version.mjs patch|minor|major');
    process.exit(1);
}

const kioskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(kioskRoot, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(pkg.version ?? '').trim());

if (!match) {
    console.error(`bump-version: invalid current version: ${pkg.version}`);
    process.exit(1);
}

let [major, minor, patch] = match.slice(1).map(Number);
if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
} else if (kind === 'minor') {
    minor += 1;
    patch = 0;
} else {
    patch += 1;
}

const next = `${major}.${minor}.${patch}`;
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`bump-version: ${match[0]} → ${next}`);
