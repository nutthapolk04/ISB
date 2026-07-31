#!/usr/bin/env node
/**
 * Local kiosk release — same idea as CI but runs on your machine.
 *
 * Bump version ONCE, then build every device in kiosk-release-matrix.json
 * (each with its own .env.prod-XX file). Only env credentials differ.
 *
 * Setup (one-time per device):
 *   cp .env.prod-01.example .env.prod-01
 *   cp .env.prod-02.example .env.prod-02
 *
 * Usage:
 *   node scripts/build-release.mjs              # build all devices, no bump
 *   node scripts/build-release.mjs --bump patch
 *   node scripts/build-release.mjs --device prod-01
 *   node scripts/build-release.mjs --debug      # assembleDebug (no keystore)
 *
 * Output: dist-release/  (APKs + kiosk-release.json)
 * Upload that folder to ISB_PHOTO_DIR on the server.
 *
 * Requires JDK 21 (not brew's default openjdk which may be Java 26).
 *   brew install openjdk@21
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeJavaProblem, java21Env, resolveJava21Home } from './resolve-java-home.mjs';

const kioskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(kioskRoot, '..');
const hardwareRoot = path.join(repoRoot, 'plugins/capacitor-hardware');
const outDir = path.join(kioskRoot, 'dist-release');

const args = process.argv.slice(2);
const bump = args.includes('--bump') ? args[args.indexOf('--bump') + 1] : null;
const deviceFilter = args.includes('--device') ? args[args.indexOf('--device') + 1] : null;
const forceDebug = args.includes('--debug');

function assertJavaRuntime() {
    if (resolveJava21Home()) return;
    console.error(describeJavaProblem());
    process.exit(1);
}

function run(cmd, opts = {}) {
    const cwd = opts.cwd ?? kioskRoot;
    const env = java21Env({ ...process.env, ...opts.env });
    if (!env) {
        console.error(describeJavaProblem());
        process.exit(1);
    }
    console.log(`\n> ${cmd}`);
    const result = spawnSync(cmd, {
        shell: true,
        cwd,
        stdio: 'inherit',
        env,
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function readMatrix() {
    const matrixPath = path.join(kioskRoot, 'scripts/kiosk-release-matrix.json');
    const rows = JSON.parse(readFileSync(matrixPath, 'utf8'));
    if (!Array.isArray(rows) || rows.length === 0) {
        console.error('kiosk-release-matrix.json is empty');
        process.exit(1);
    }
    return rows;
}

function writeEnvFromFile(envFilePath) {
    const content = readFileSync(envFilePath, 'utf8');
    writeFileSync(path.join(kioskRoot, '.env'), content);
}

function hasReleaseKeystore() {
    return existsSync(path.join(kioskRoot, 'android/keystore.properties'));
}

if (bump) {
    if (!['patch', 'minor', 'major'].includes(bump)) {
        console.error('Use --bump patch|minor|major');
        process.exit(1);
    }
    run(`node scripts/bump-version.mjs ${bump}`);
}

assertJavaRuntime();

run('node scripts/sync-android-version.mjs');

if (existsSync(hardwareRoot)) {
    run('npm ci', { cwd: hardwareRoot });
    run('npm run build', { cwd: hardwareRoot });
}

run('npm ci');

const useRelease = !forceDebug && hasReleaseKeystore();
const gradleTask = useRelease ? ':app:assembleRelease' : ':app:assembleDebug';
const apkSubpath = useRelease
    ? 'app/build/outputs/apk/release/app-release.apk'
    : 'app/build/outputs/apk/debug/app-debug.apk';

console.log(`\nGradle: ${gradleTask}${useRelease ? '' : ' (pass --debug to force, or add android/keystore.properties for release)'}`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const matrix = readMatrix().filter((row) => !deviceFilter || row.slug === deviceFilter);
if (deviceFilter && matrix.length === 0) {
    console.error(`Unknown device slug: ${deviceFilter}`);
    process.exit(1);
}

for (const row of matrix) {
    const envFile = row.env_file ?? `.env.${row.slug}`;
    const envPath = path.join(kioskRoot, envFile);
    if (!existsSync(envPath)) {
        console.error(`Missing ${envFile} — copy from ${envFile}.example`);
        process.exit(1);
    }

    console.log(`\n========== Building ${row.slug} → ${row.apk_filename} ==========`);
    writeEnvFromFile(envPath);

    run('npm run build');
    run('npx cap sync android');

    run(`./gradlew ${gradleTask} --no-daemon`, { cwd: path.join(kioskRoot, 'android') });

    const builtApk = path.join(kioskRoot, 'android', apkSubpath);
    if (!existsSync(builtApk)) {
        console.error(`APK not found: ${builtApk}`);
        process.exit(1);
    }
    copyFileSync(builtApk, path.join(outDir, row.apk_filename));
    console.log(`Wrote ${row.apk_filename}`);
}

run(`node scripts/write-release-manifest.mjs "${outDir}" --build-id local-${Date.now()}`);

const version = JSON.parse(readFileSync(path.join(kioskRoot, 'package.json'), 'utf8')).version;
console.log(`\nDone — v${version} in ${outDir}/`);
console.log('Upload dist-release/* to ISB_PHOTO_DIR on the server.');
