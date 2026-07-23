/**
 * Bulk-set student daily spending limits (canteen/store) from a school report.
 *
 * Input file columns:
 *   CustomerId, name, SPENDLIMIT, category
 *
 * The source is normally exported as an Apple Numbers file (e.g.
 * spend-limit.numbers). Bun/Node has no reliable way to read Apple's native
 * .numbers format, so export it to CSV or XLSX first — in Numbers.app:
 * File > Export To > CSV… (or XLSX) — then pass that file to this script.
 *
 * Matching: CustomerId → customers.external_id (ISB sync convention — see
 * isb_sync_service.ts, whose `customerId` field is written to external_id on
 * sync). No fallback to student_code/customer_code — if external_id isn't
 * populated for a student, that row is reported as "not found" rather than
 * guessed at.
 *
 * category → column:
 *   Canteen → daily_limit_canteen
 *   Shop    → daily_limit_store
 *   anything else is unrecognized and skipped (reported).
 *
 * Each row SETS an absolute target (not a delta), so re-running the script
 * against the same file is a no-op the second time — no ticket/resume
 * mechanism needed.
 *
 * A blank/unparseable SPENDLIMIT is skipped (reported) and never written as
 * null — a missing value in the file means "don't know", not "remove the
 * limit".
 *
 * Grade-tier default (2026-07 review): a PARSED SPENDLIMIT value below 1
 * (this includes 0 and negative numbers — applied literally, no manual
 * review of *why* it's low) is never written as-is. Instead it's replaced
 * with a grade-tier default looked up from customers.grade:
 *   - Grade K0/K00, K1/K01, 00, 01, 02, 03, 04 ("low" tier): 0.1 for BOTH
 *     canteen and store, regardless of the row's own category.
 *   - Grade 05-12 ("high" tier): 500 for canteen, 25000 for store.
 * A customer whose grade doesn't resolve to either tier (null, or any value
 * outside the above) is skipped and reported (`skipped_low_value_unknown_grade`)
 * — never guessed. The report's `raw_file_value` column always preserves the
 * original SPENDLIMIT from the file even when overridden, and `override_tier`
 * shows which tier (if any) was applied, so the substitution is auditable.
 *
 * SAFETY: defaults to DRY RUN. Pass --execute to write customers.
 *
 * Usage (from backend-bun/):
 *   bun scripts/set-spend-limits-from-report.ts <path-to-csv-or-xlsx> [--execute]
 *
 * Output CSV (next to the input file, same basename):
 *   <name>.spend_limits_report.csv
 */

import { eq, inArray } from "drizzle-orm";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { customers } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import {
    classifyGradeTier,
    HIGH_TIER_LIMITS,
    LOW_TIER_LIMITS,
} from "../src/services/grade_spending_limits";

// ── CLI ──────────────────────────────────────────────────────────────────

interface Args {
    inputPath: string;
    execute: boolean;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const positional = argv.filter((a) => !a.startsWith("--"));
    const flags = new Set(argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
    if (positional.length === 0) {
        throw new Error("Usage: bun scripts/set-spend-limits-from-report.ts <path-to-csv-or-xlsx> [--execute]");
    }
    return { inputPath: positional[0], execute: flags.has("execute") };
}

// ── input parsing ────────────────────────────────────────────────────────

type LimitCategory = "canteen" | "store";

interface LimitRow {
    rowNum: number;
    externalId: string;
    nameInFile: string;
    rawCategory: string;
    category: LimitCategory | null;
    targetLimit: number | null;
}

const CATEGORY_MAP: Record<string, LimitCategory> = {
    canteen: "canteen",
    shop: "store",
};

// ── grade-tier default (see header doc comment) ─────────────────────────────

const LOW_TIER_DEFAULT = LOW_TIER_LIMITS.canteen;
const HIGH_TIER_DEFAULT = HIGH_TIER_LIMITS;

function readLimitRows(inputPath: string): LimitRow[] {
    const wb = XLSX.readFile(inputPath, { raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

    const rows: LimitRow[] = [];
    raw.forEach((r, i) => {
        const externalId = String(r.CustomerId ?? "").trim();
        if (!externalId) return;
        const rawCategory = String(r.category ?? "").trim();
        const limitRaw = r.SPENDLIMIT;
        const limitNum = limitRaw === null || limitRaw === undefined || limitRaw === ""
            ? null
            : Number(limitRaw);
        rows.push({
            rowNum: i + 2, // +1 for header row, +1 to make it 1-based like a spreadsheet
            externalId,
            nameInFile: String(r.name ?? "").trim(),
            rawCategory,
            category: CATEGORY_MAP[rawCategory.toLowerCase()] ?? null,
            targetLimit: limitNum !== null && Number.isFinite(limitNum) ? Math.round(limitNum * 100) / 100 : null,
        });
    });
    return rows;
}

// ── CSV writer ───────────────────────────────────────────────────────────

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
    const esc = (v: string | number) => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

const DELTA_EPSILON = 0.005;

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs();
    console.log(
        args.execute
            ? "*** EXECUTE MODE — customers WILL be updated ***"
            : "DRY RUN — no customer will be touched (pass --execute to apply)",
    );
    console.log(`Reading ${args.inputPath} ...`);

    const rows = readLimitRows(args.inputPath);
    console.log(`Found ${rows.length} row(s) with a CustomerId in the file.`);

    const externalIds = [...new Set(rows.map((r) => r.externalId))];
    const dbRows = externalIds.length > 0
        ? await db
            .select({
                id: customers.id,
                externalId: customers.externalId,
                name: customers.name,
                grade: customers.grade,
                dailyLimitCanteen: customers.dailyLimitCanteen,
                dailyLimitStore: customers.dailyLimitStore,
            })
            .from(customers)
            .where(inArray(customers.externalId, externalIds))
        : [];

    const byExternalId = new Map(dbRows.map((r) => [r.externalId as string, r]));
    console.log(`Matched ${byExternalId.size}/${externalIds.length} unique CustomerId(s) to a customer via external_id.`);

    type ReportRow = [
        number, string, string, string,
        string | number, string, string,
        string | number, string | number, string | number, string | number,
        string, string,
    ];
    const reportRows: ReportRow[] = [];

    let updated = 0;
    let skippedAtTarget = 0;
    let skippedNotFound = 0;
    let skippedBadCategory = 0;
    let skippedMissingValue = 0;
    let skippedUnknownGradeForOverride = 0;
    let overridden = 0;

    let rowIdx = 0;
    for (const row of rows) {
        rowIdx += 1;
        if (rowIdx % 500 === 0 || rowIdx === rows.length) {
            console.log(`Processing row ${rowIdx}/${rows.length}...`);
        }

        const dbCustomer = byExternalId.get(row.externalId);

        if (!dbCustomer) {
            skippedNotFound += 1;
            reportRows.push([
                row.rowNum, row.externalId, row.nameInFile, row.rawCategory,
                "", "", "", "", row.targetLimit ?? "", "", "", "skipped_not_found", "",
            ]);
            continue;
        }

        if (row.category === null) {
            skippedBadCategory += 1;
            reportRows.push([
                row.rowNum, row.externalId, row.nameInFile, row.rawCategory,
                dbCustomer.id, dbCustomer.name, dbCustomer.grade ?? "", "", row.targetLimit ?? "", "", "", "skipped_unrecognized_category", "",
            ]);
            continue;
        }

        if (row.targetLimit === null) {
            skippedMissingValue += 1;
            reportRows.push([
                row.rowNum, row.externalId, row.nameInFile, row.rawCategory,
                dbCustomer.id, dbCustomer.name, dbCustomer.grade ?? "", "", "", "", "", "skipped_missing_spendlimit", "",
            ]);
            continue;
        }

        // Grade-tier default (2026-07 review): a parsed value below 1 —
        // including 0 and negatives, applied literally, no exception — is
        // never written as-is. See the header doc comment for the exact
        // tiers/values; classifyGradeTier() never guesses, so an
        // unresolvable grade is skipped and reported rather than defaulted
        // to either tier.
        let effectiveLimit = row.targetLimit;
        let overrideTier = "";
        if (row.targetLimit < 1) {
            const tier = classifyGradeTier(dbCustomer.grade);
            if (tier === null) {
                skippedUnknownGradeForOverride += 1;
                reportRows.push([
                    row.rowNum, row.externalId, row.nameInFile, row.rawCategory,
                    dbCustomer.id, dbCustomer.name, dbCustomer.grade ?? "", "", row.targetLimit, "", "",
                    "skipped_low_value_unknown_grade", "",
                ]);
                continue;
            }
            effectiveLimit = tier === "low" ? LOW_TIER_DEFAULT : HIGH_TIER_DEFAULT[row.category];
            overrideTier = tier;
            overridden += 1;
        }

        const column = row.category === "canteen" ? "dailyLimitCanteen" : "dailyLimitStore";
        const currentRaw = row.category === "canteen" ? dbCustomer.dailyLimitCanteen : dbCustomer.dailyLimitStore;
        const current = currentRaw != null ? Number(currentRaw) : null;

        if (current !== null && Math.abs(effectiveLimit - current) < DELTA_EPSILON) {
            skippedAtTarget += 1;
            reportRows.push([
                row.rowNum, row.externalId, row.nameInFile, row.rawCategory,
                dbCustomer.id, dbCustomer.name, dbCustomer.grade ?? "", current, row.targetLimit, effectiveLimit, 0,
                "skipped_at_target", overrideTier,
            ]);
            continue;
        }

        if (args.execute) {
            await db.update(customers)
                .set({ [column]: effectiveLimit.toFixed(2) })
                .where(eq(customers.id, dbCustomer.id));
        }
        updated += 1;
        const delta = current !== null ? Math.round((effectiveLimit - current) * 100) / 100 : "";
        reportRows.push([
            row.rowNum, row.externalId, row.nameInFile, row.rawCategory,
            dbCustomer.id, dbCustomer.name, dbCustomer.grade ?? "", current ?? "", row.targetLimit, effectiveLimit, delta,
            args.execute ? "executed" : "planned", overrideTier,
        ]);
    }

    const dir = path.dirname(args.inputPath);
    const stem = path.basename(args.inputPath).replace(/\.[^.]+$/, "");
    const reportPath = path.join(dir, `${stem}.spend_limits_report.csv`);
    await Bun.write(
        reportPath,
        toCsv(
            [
                "row", "customer_id_in_file", "name_in_file", "category_in_file",
                "db_customer_id", "db_name", "db_grade", "current_limit", "raw_file_value", "target_limit", "delta",
                "status", "override_tier",
            ],
            reportRows as unknown as Array<Array<string | number>>,
        ),
    );

    console.log("");
    console.log("── Summary ──────────────────────────────");
    console.log(`Rows in file                     : ${rows.length}`);
    console.log(`Matched customers                : ${byExternalId.size}/${externalIds.length}`);
    console.log(`${args.execute ? "Updated" : "Would update"}                         : ${updated}`);
    console.log(`  of which grade-tier overridden  : ${overridden}`);
    console.log(`Skipped (already @target)        : ${skippedAtTarget}`);
    console.log(`Skipped (not found)              : ${skippedNotFound}`);
    console.log(`Skipped (bad category)           : ${skippedBadCategory}`);
    console.log(`Skipped (missing value)          : ${skippedMissingValue}`);
    console.log(`Skipped (<1, unresolvable grade)  : ${skippedUnknownGradeForOverride}`);
    if (!args.execute) console.log("(dry run — pass --execute to apply)");
    console.log(`Report written to ${reportPath}`);
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.stack ?? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pgClient.end({ timeout: 5 });
    });
