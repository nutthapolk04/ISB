/**
 * One-shot production database bootstrap.
 *
 * Steps (in order):
 *   1. drizzle migrate
 *   2. seed admin (admin / admin1234) + kiosk service accounts
 *   3. ISB sync: departments + families + staffs batch JSON
 *   4. wallet balances from CustomerBalanceReport summary xlsx
 *   5. student spend limits from spend-limit xlsx
 *
 * Requires DATABASE_URL in env (backend-bun/.env or shell).
 *
 * Usage (from backend-bun/):
 *   bun run prod:init
 *   bun run prod:init -- --dry-run          # migrate + seed + sync only; skip balance/spend-limit writes
 *   bun run prod:init -- --skip-sync        # skip ISB JSON sync
 *   bun run prod:init -- --skip-balance     # skip wallet balance import
 *   bun run prod:init -- --skip-spendlimit  # skip spend-limit import
 *
 * From repo root:
 *   bun run prod:init
 */
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { buildAdminSpec, seedAdminUser } from "./seed-admin-user";
import { runIsbSyncFromFiles } from "./isb-sync-from-files";

const BACKEND_ROOT = path.join(import.meta.dir, "..");

const DEFAULT_SYNC_FILES = [
    "docs/sync_data/departments_batch_001.json",
    "docs/sync_data/families_batch_001.json",
    "docs/sync_data/families_batch_002.json",
    "docs/sync_data/families_batch_003.json",
    "docs/sync_data/staffs_batch_001.json",
    "docs/sync_data/staffs_batch_002.json",
] as const;

const DEFAULT_BALANCE_XLSX = "docs/CustomerBalanceReportAsof16Jul2026-summary.xlsx";
const DEFAULT_SPENDLIMIT_XLSX = "docs/spend-limit.xlsx";

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

async function spawnStep(label: string, args: string[]): Promise<void> {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`▶ ${label}`);
    console.log(`${"═".repeat(60)}`);

    const proc = Bun.spawn(["bun", ...args], {
        cwd: BACKEND_ROOT,
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
    });

    const code = await proc.exited;
    if (code !== 0) {
        throw new Error(`${label} failed (exit ${code})`);
    }
}

async function lookupAdminId(): Promise<number> {
    const username = buildAdminSpec().username;
    const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
    if (!rows[0]) {
        throw new Error(`Admin user '${username}' not found after seed`);
    }
    return rows[0].id;
}

async function main(): Promise<void> {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required — set it in backend-bun/.env or the shell");
    }

    const dryRun = hasFlag("--dry-run");
    const skipSync = hasFlag("--skip-sync");
    const skipBalance = hasFlag("--skip-balance");
    const skipSpendlimit = hasFlag("--skip-spendlimit");

    console.log("ISB production init");
    console.log(`  dry-run (balance/spendlimit): ${dryRun}`);
    console.log(`  skip-sync: ${skipSync}`);
    console.log(`  skip-balance: ${skipBalance}`);
    console.log(`  skip-spendlimit: ${skipSpendlimit}`);

    // 1. Migrations
    await spawnStep("1/5 — db:migrate", ["run", "db:migrate"]);

    // 2. Admin + kiosk seeds (in-process — reuse DB pool for admin id lookup)
    console.log(`\n${"═".repeat(60)}`);
    console.log("▶ 2/5 — seed admin + kiosk");
    console.log(`${"═".repeat(60)}`);
    console.log("\n[admin]");
    await seedAdminUser();
    const adminId = await lookupAdminId();
    console.log(`\n[admin id for audits: ${adminId}]`);
    await spawnStep("kiosk accounts", ["scripts/seed-kiosk-user.ts"]);

    // 3. ISB sync
    if (!skipSync) {
        console.log(`\n${"═".repeat(60)}`);
        console.log("▶ 3/5 — ISB sync (departments + families + staffs)");
        console.log(`${"═".repeat(60)}`);
        await runIsbSyncFromFiles([...DEFAULT_SYNC_FILES], adminId);
    } else {
        console.log("\n⏭  Skipped ISB sync (--skip-sync)");
    }

    // 4. Wallet balances
    if (!skipBalance) {
        const balanceArgs = [
            "scripts/set-family-child-balances-from-report.ts",
            DEFAULT_BALANCE_XLSX,
        ];
        if (!dryRun) {
            balanceArgs.push("--execute", `--admin-user-id=${adminId}`, "--ticket=prod-init-balance");
        }
        await spawnStep(`4/5 — wallet balances${dryRun ? " (dry run)" : ""}`, balanceArgs);
    } else {
        console.log("\n⏭  Skipped balance import (--skip-balance)");
    }

    // 5. Spend limits
    if (!skipSpendlimit) {
        const spendArgs = [
            "scripts/set-spend-limits-from-report.ts",
            DEFAULT_SPENDLIMIT_XLSX,
        ];
        if (!dryRun) {
            spendArgs.push("--execute");
        }
        await spawnStep(`5/5 — spend limits${dryRun ? " (dry run)" : ""}`, spendArgs);
    } else {
        console.log("\n⏭  Skipped spend-limit import (--skip-spendlimit)");
    }

    console.log(`\n${"═".repeat(60)}`);
    console.log("✅ prod:init complete");
    console.log(`${"═".repeat(60)}`);
    if (dryRun) {
        console.log("Note: balance and spend-limit were dry-run only. Re-run without --dry-run to apply.");
    }
    const spec = buildAdminSpec();
    console.log(`Admin login: ${spec.username} / ${spec.password}`);
}

main()
    .catch((err) => {
        console.error("\n❌ prod:init failed:", err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pgClient.end({ timeout: 5 });
    });
