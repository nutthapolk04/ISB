/**
 * Load ISB sync batch JSON files and run them through isb_sync_service
 * (same path as POST /api/v1/sync/*).
 *
 * Usage (from backend-bun/):
 *   bun scripts/isb-sync-from-files.ts <file.json> [more.json ...]
 *   bun scripts/isb-sync-from-files.ts --admin-user-id=1 docs/sync_data/departments_batch_001.json
 *
 * Each file must contain one of: { departments: [...] }, { staffs: [...] }, { families: [...] }.
 * Process files in the order given (departments before staffs is recommended).
 */
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import {
    processDepartmentBatch,
    processFamilyBatch,
    processStaffBatch,
    type IsbDepartment,
    type IsbFamily,
    type IsbStaff,
} from "../src/services/isb_sync_service";

function parseArgs(): { files: string[]; adminUserId: number | null } {
    const argv = process.argv.slice(2);
    let adminUserId: number | null = null;
    const files: string[] = [];

    for (const arg of argv) {
        if (arg.startsWith("--admin-user-id=")) {
            adminUserId = Number(arg.slice("--admin-user-id=".length));
            if (!Number.isFinite(adminUserId) || adminUserId <= 0) {
                throw new Error(`Invalid --admin-user-id: ${arg}`);
            }
            continue;
        }
        if (arg.startsWith("--")) {
            throw new Error(`Unknown flag: ${arg}`);
        }
        files.push(arg);
    }

    if (files.length === 0) {
        throw new Error(
            "Usage: bun scripts/isb-sync-from-files.ts [--admin-user-id=<id>] <file.json> [more.json ...]",
        );
    }

    return { files, adminUserId };
}

async function resolveTriggeredById(explicit: number | null): Promise<number | null> {
    if (explicit !== null) return explicit;

    const username = process.env.ADMIN_USERNAME ?? "admin";
    const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
    return rows[0]?.id ?? null;
}

type BatchKind = "departments" | "staffs" | "families";

async function loadBatchFile(filePath: string): Promise<{ kind: BatchKind; count: number; file: string } & (
    | { kind: "departments"; items: IsbDepartment[] }
    | { kind: "staffs"; items: IsbStaff[] }
    | { kind: "families"; items: IsbFamily[] }
)> {
    const abs = path.resolve(filePath);
    const raw = await Bun.file(abs).json() as Record<string, unknown>;

    if (Array.isArray(raw.departments)) {
        return { kind: "departments", items: raw.departments as IsbDepartment[], count: raw.departments.length, file: abs };
    }
    if (Array.isArray(raw.staffs)) {
        return { kind: "staffs", items: raw.staffs as IsbStaff[], count: raw.staffs.length, file: abs };
    }
    if (Array.isArray(raw.families)) {
        return { kind: "families", items: raw.families as IsbFamily[], count: raw.families.length, file: abs };
    }

    throw new Error(`Unrecognized sync file (expected departments/staffs/families array): ${abs}`);
}

function printResult(label: string, result: { success: number; failed: number; errors: Array<{ index: number; id: string | number; error: string }> }) {
    console.log(`  ${label}: success=${result.success} failed=${result.failed}`);
    if (result.errors.length > 0) {
        const sample = result.errors.slice(0, 5);
        for (const e of sample) {
            console.error(`    [${e.index}] id=${e.id}: ${e.error}`);
        }
        if (result.errors.length > 5) {
            console.error(`    … and ${result.errors.length - 5} more error(s)`);
        }
    }
}

export async function runIsbSyncFromFiles(files: string[], adminUserId: number | null = null): Promise<void> {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required");
    }

    const triggeredById = await resolveTriggeredById(adminUserId);
    let totalFailed = 0;

    for (const file of files) {
        const batch = await loadBatchFile(file);
        console.log(`\nSyncing ${batch.kind} from ${batch.file} (${batch.count} record(s))…`);

        let result;
        if (batch.kind === "departments") {
            result = await processDepartmentBatch(batch.items, triggeredById);
        } else if (batch.kind === "staffs") {
            result = await processStaffBatch(batch.items, triggeredById);
        } else {
            result = await processFamilyBatch(batch.items, triggeredById);
        }

        printResult(batch.kind, result);
        totalFailed += result.failed;
    }

    if (totalFailed > 0) {
        throw new Error(`ISB sync finished with ${totalFailed} failed record(s)`);
    }
}

async function main(): Promise<void> {
    const { files, adminUserId } = parseArgs();
    console.log(`ISB sync from ${files.length} file(s)…`);
    await runIsbSyncFromFiles(files, adminUserId);
    console.log("\nDone.");
}

if (import.meta.main) {
    main()
        .catch((err) => {
            console.error(err instanceof Error ? err.message : err);
            process.exitCode = 1;
        })
        .finally(async () => {
            await pgClient.end({ timeout: 5 });
        });
}
