/**
 * Seed spending groups (+ shop links) from docs/spending-groups.json.
 *
 * The JSON is an API export: group fields + linked_shop_count (informational).
 * Shop links are rebuilt on each run: canteen/cantenn* codes → all active
 * canteen-module shops; shop_* codes → all active store-module shops.
 *
 * Usage (from backend-bun/):
 *   bun scripts/seed-spending-groups-from-json.ts
 *   bun scripts/seed-spending-groups-from-json.ts docs/spending-groups.json
 *   bun scripts/seed-spending-groups-from-json.ts --dry-run
 */
import * as path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { shops, spendingGroups } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import {
    createSpendingGroup,
    setLinkedShops,
    updateSpendingGroup,
} from "../src/services/spending_group_service";

const DEFAULT_JSON = "docs/spending-groups.json";

interface SpendingGroupSeedRow {
    id?: number;
    code: string;
    name_en: string;
    name_th: string;
    daily_limit: number;
    grades: string[];
    is_active: boolean;
    linked_shop_count?: number;
    created_at?: string;
    updated_at?: string;
}

function parseArgs(): { jsonPath: string; dryRun: boolean } {
    const argv = process.argv.slice(2);
    let jsonPath = DEFAULT_JSON;
    let dryRun = false;

    for (const arg of argv) {
        if (arg === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (arg.startsWith("--")) {
            throw new Error(`Unknown flag: ${arg}`);
        }
        jsonPath = arg;
    }

    return { jsonPath, dryRun };
}

function moduleForGroupCode(code: string): "canteen" | "store" | null {
    const c = code.toLowerCase();
    if (c.startsWith("canteen") || c.startsWith("cantenn")) return "canteen";
    if (c.startsWith("shop_")) return "store";
    return null;
}

async function shopIdsForModule(module: "canteen" | "store"): Promise<string[]> {
    const rows = await db
        .select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.module, module), eq(shops.isActive, true)))
        .orderBy(asc(shops.id));
    return rows.map((r) => r.id);
}

export async function seedSpendingGroupsFromJson(
    jsonPath: string = DEFAULT_JSON,
    opts: { dryRun?: boolean } = {},
): Promise<void> {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required");
    }

    const dryRun = opts.dryRun ?? false;
    const abs = path.resolve(jsonPath);
    const raw = await Bun.file(abs).json();
    if (!Array.isArray(raw)) {
        throw new Error(`Expected JSON array in ${abs}`);
    }

    const rows = raw as SpendingGroupSeedRow[];
    console.log(`Loading ${rows.length} spending group(s) from ${abs}${dryRun ? " (dry run)" : ""}…`);

    const canteenShopIds = await shopIdsForModule("canteen");
    const storeShopIds = await shopIdsForModule("store");
    console.log(`  Active shops: canteen=${canteenShopIds.length}, store=${storeShopIds.length}`);

    for (const row of rows) {
        const mod = moduleForGroupCode(row.code);
        const targetShopIds = mod === "canteen" ? canteenShopIds : mod === "store" ? storeShopIds : [];

        if (dryRun) {
            console.log(
                `  [dry] ${row.code}: limit=${row.daily_limit} grades=${row.grades.length} → link ${targetShopIds.length} ${mod ?? "?"} shop(s)`,
            );
            continue;
        }

        const existing = await db
            .select({ id: spendingGroups.id })
            .from(spendingGroups)
            .where(eq(spendingGroups.code, row.code))
            .limit(1);

        let groupId: number;
        if (existing[0]) {
            groupId = existing[0].id;
            await updateSpendingGroup(groupId, {
                name_en: row.name_en,
                name_th: row.name_th,
                daily_limit: row.daily_limit,
                grades: row.grades,
                is_active: row.is_active,
            });
            console.log(`  ~ Updated '${row.code}' (id=${groupId})`);
        } else {
            const created = await createSpendingGroup({
                code: row.code,
                name_en: row.name_en,
                name_th: row.name_th,
                daily_limit: row.daily_limit,
                grades: row.grades,
                is_active: row.is_active,
            });
            groupId = created.id;
            console.log(`  + Created '${row.code}' (id=${groupId})`);
        }

        if (mod === null) {
            console.warn(`    ⚠ Unknown code prefix for '${row.code}' — skipped shop linking`);
            continue;
        }

        if (targetShopIds.length === 0) {
            console.warn(`    ⚠ No active ${mod} shops in DB — '${row.code}' has no shop links`);
            continue;
        }

        const { linked, unlinked } = await setLinkedShops(groupId, targetShopIds);
        console.log(`    → linked ${targetShopIds.length} ${mod} shop(s) (+${linked} / -${unlinked})`);
    }
}

async function main(): Promise<void> {
    const { jsonPath, dryRun } = parseArgs();
    await seedSpendingGroupsFromJson(jsonPath, { dryRun });
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
