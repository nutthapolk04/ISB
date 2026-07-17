/**
 * Set each eligible child's wallet balance to (family_balance / n) from a
 * MyCampusCard balance report — NOT an additive top-up.
 *
 * Eligible children (n) come from ISB families sync JSON batches:
 *   - schoolType !== "ES Student"
 *   - withdrawDate is blank (still enrolled per ISB export)
 *
 * Target per child = family Campus Balance / n, split with exact-cent
 * remainder handling (same as redistribute-family-balance.ts).
 * Adjustment = target − current wallet balance (can be positive or negative).
 *
 * Money movement uses audited adjustBalance() — never a raw UPDATE.
 *
 * SAFETY: defaults to DRY RUN. Pass --execute to write wallets.
 *
 * Usage (from backend-bun/):
 *   bun scripts/set-family-child-balances-from-report.ts <path-to-xlsx> \
 *     [--families-json=docs/sync_data/families_batch_001.json,...] \
 *     [--admin-user-id=<id>] [--execute] [--ticket=<ref>]
 *
 * Output CSVs (next to the xlsx, same basename):
 *   <name>.set_balances.csv
 *   <name>.xlsx_not_in_json.csv
 *   <name>.missing_balance.csv
 *   <name>.incomplete_families.csv
 *   <name>.no_eligible_children.csv
 *   <name>.student_not_in_db.csv
 *   <name>.skipped_negative.csv
 *
 * STRICT: the script is JSON-first. It validates all families from the
 * families JSON against DB + xlsx before any write. Dry-run writes reports;
 * execute aborts when any strict validation issue exists.
 */

import { and, eq, inArray } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { customers, users, wallets, walletTransactions } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { adjustBalance } from "../src/services/wallet_service";

// ── CLI ────────────────────────────────────────────────────────────────────

interface Args {
    xlsxPath: string;
    familiesJsonPaths: string[];
    execute: boolean;
    adminUserId: number | null;
    ticket: string;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const positional = argv.filter((a) => !a.startsWith("--"));
    const flags = new Map<string, string>();
    for (const a of argv) {
        if (!a.startsWith("--")) continue;
        const [k, ...rest] = a.slice(2).split("=");
        flags.set(k, rest.join("="));
    }
    if (positional.length === 0) {
        throw new Error(
            "Usage: bun scripts/set-family-child-balances-from-report.ts <path-to-xlsx> " +
            "[--families-json=path1,path2,...] [--admin-user-id=<id>] [--execute] [--ticket=<ref>]",
        );
    }
    const execute = flags.has("execute");
    const adminUserIdRaw = flags.get("admin-user-id");
    if (execute && !adminUserIdRaw) {
        throw new Error("--admin-user-id=<id> is required when --execute is passed");
    }
    const defaultJsonGlob = [
        "docs/sync_data/families_batch_001.json",
        "docs/sync_data/families_batch_002.json",
        "docs/sync_data/families_batch_003.json",
    ];
    const jsonRaw = flags.get("families-json");
    const familiesJsonPaths = jsonRaw
        ? jsonRaw.split(",").map((p) => p.trim()).filter(Boolean)
        : defaultJsonGlob;
    const today = new Date().toISOString().slice(0, 10);
    return {
        xlsxPath: positional[0],
        familiesJsonPaths,
        execute,
        adminUserId: adminUserIdRaw ? Number(adminUserIdRaw) : null,
        ticket: flags.get("ticket") ?? `family-set-balance-${today}`,
    };
}

// ── xlsx ───────────────────────────────────────────────────────────────────

interface FamilyRow {
    familyCode: string;
    name: string;
    campusBalance: number;
    transactionDateTime: Date | null;
}

function readFamilyRowsFromUseSheet(wb: XLSX.WorkBook): FamilyRow[] | null {
    const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "use this sheet");
    if (!sheetName) return null;
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
    const rows: FamilyRow[] = [];
    for (const r of raw) {
        const customerType = String(r.CustomerType ?? r["Customer Type"] ?? "").trim();
        if (customerType !== "Family") continue;
        const familyCode = String(r.FamilyCode ?? r["Family Code"] ?? "").trim();
        if (!familyCode) continue;
        const balanceRaw = r.Balance ?? r["Campus Balance"];
        const campusBalance = typeof balanceRaw === "number" ? balanceRaw : Number(balanceRaw ?? 0);
        const name = String(r.CustomerName ?? r.Name ?? "").trim();
        rows.push({ familyCode, name, campusBalance, transactionDateTime: null });
    }
    return rows;
}

/** Header-scan parser (legacy export shape). */
function readFamilyRowsFromHeaderScan(wb: XLSX.WorkBook): FamilyRow[] {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true });

    let headerRowIdx = -1;
    const col: Record<string, number> = {};
    for (let r = 0; r < aoa.length; r++) {
        const row = aoa[r];
        const idx = row.findIndex((c) => String(c ?? "").trim() === "Family Code");
        if (idx >= 0) {
            headerRowIdx = r;
            row.forEach((c, i) => {
                const name = String(c ?? "").trim();
                if (name) col[name] = i;
            });
            break;
        }
    }
    if (headerRowIdx < 0) {
        throw new Error("Could not find a \"Family Code\" header row in the workbook");
    }
    for (const required of ["Family Code", "Customer Type", "Campus Balance"]) {
        if (!(required in col)) throw new Error(`Missing expected column "${required}"`);
    }

    const rows: FamilyRow[] = [];
    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.length === 0) continue;
        const customerType = String(row[col["Customer Type"]] ?? "").trim();
        if (customerType !== "Family") continue;
        const familyCode = String(row[col["Family Code"]] ?? "").trim();
        if (!familyCode) continue;
        const balanceRaw = row[col["Campus Balance"]];
        const campusBalance = typeof balanceRaw === "number" ? balanceRaw : Number(balanceRaw ?? 0);
        const txRaw = col["Transaction DateTime"] != null ? row[col["Transaction DateTime"]] : null;
        const transactionDateTime = txRaw instanceof Date ? txRaw : txRaw ? new Date(String(txRaw)) : null;
        const name = col["Name"] != null ? String(row[col["Name"]] ?? "").trim() : "";
        rows.push({ familyCode, name, campusBalance, transactionDateTime });
    }
    return rows;
}

function readFamilyRows(xlsxPath: string): FamilyRow[] {
    const wb = XLSX.readFile(xlsxPath, { cellDates: true });
    const fromUseSheet = readFamilyRowsFromUseSheet(wb);
    if (fromUseSheet && fromUseSheet.length > 0) {
        console.log('Using sheet "Use this sheet" for family balances.');
        return fromUseSheet;
    }
    console.log("Using header-scan parser on first sheet.");
    return readFamilyRowsFromHeaderScan(wb);
}

function dedupeByLatestTransaction(rows: FamilyRow[]): FamilyRow[] {
    const byCode = new Map<string, FamilyRow>();
    for (const row of rows) {
        const existing = byCode.get(row.familyCode);
        if (!existing) {
            byCode.set(row.familyCode, row);
            continue;
        }
        const existingTime = existing.transactionDateTime?.getTime() ?? -Infinity;
        const rowTime = row.transactionDateTime?.getTime() ?? -Infinity;
        if (rowTime > existingTime) byCode.set(row.familyCode, row);
    }
    return [...byCode.values()];
}

function familyRowsToMap(rows: FamilyRow[]): Map<string, FamilyRow> {
    const out = new Map<string, FamilyRow>();
    for (const row of rows) out.set(row.familyCode, row);
    return out;
}

// ── families JSON ──────────────────────────────────────────────────────────

interface JsonStudent {
    customerId: number;
    firstName: string;
    lastName: string;
    schoolType?: string;
    withdrawDate?: string;
}

interface JsonFamily {
    familyCode: string;
    students: JsonStudent[];
}

function isEligibleJsonStudent(s: JsonStudent): boolean {
    if (s.schoolType === "ES Student") return false;
    const wd = String(s.withdrawDate ?? "").trim();
    if (wd) return false;
    return true;
}

function loadFamiliesFromJson(paths: string[]): Map<string, JsonFamily> {
    const map = new Map<string, JsonFamily>();
    for (const p of paths) {
        const resolved = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Families JSON not found: ${resolved}`);
        }
        const data = JSON.parse(fs.readFileSync(resolved, "utf8")) as { families: Array<{
            familyCode: number | string;
            students?: JsonStudent[];
        }> };
        for (const fam of data.families ?? []) {
            const code = String(fam.familyCode).trim();
            map.set(code, { familyCode: code, students: fam.students ?? [] });
        }
    }
    return map;
}

// ── split / CSV ────────────────────────────────────────────────────────────

function splitEvenly(totalBaht: number, n: number): number[] {
    const totalCents = Math.round(totalBaht * 100);
    const base = Math.floor(totalCents / n);
    let remainder = totalCents - base * n;
    const shares: number[] = [];
    for (let i = 0; i < n; i++) {
        let cents = base;
        if (remainder > 0) {
            cents += 1;
            remainder -= 1;
        }
        shares.push(cents / 100);
    }
    return shares;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
    const esc = (v: string | number) => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

const DELTA_EPSILON = 0.005;

// ── DB ─────────────────────────────────────────────────────────────────────

interface DbChild {
    customerId: number;
    externalId: string;
    name: string;
    schoolType: string | null;
    walletId: number | null;
    currentBalance: number;
}

async function loadDbFamilyCodes(familyCodes: string[]): Promise<Set<string>> {
    if (familyCodes.length === 0) return new Set();
    const [customerRows, userRows] = await Promise.all([
        db
            .selectDistinct({ familyCode: customers.familyCode })
            .from(customers)
            .where(inArray(customers.familyCode, familyCodes)),
        db
            .selectDistinct({ familyCode: users.familyCode })
            .from(users)
            .where(inArray(users.familyCode, familyCodes)),
    ]);
    return new Set(
        [...customerRows, ...userRows]
            .map((r) => r.familyCode)
            .filter((code): code is string => !!code),
    );
}

/** familyCode → externalId → wallet row */
async function loadDbStudentsByFamily(
    familyCodes: string[],
): Promise<Map<string, Map<string, DbChild>>> {
    const out = new Map<string, Map<string, DbChild>>();
    if (familyCodes.length === 0) return out;

    const rows = await db
        .select({
            familyCode: customers.familyCode,
            customerId: customers.id,
            externalId: customers.externalId,
            name: customers.name,
            schoolType: customers.schoolType,
            walletId: wallets.id,
            balance: wallets.balance,
        })
        .from(customers)
        .leftJoin(wallets, eq(wallets.customerId, customers.id))
        .where(
            and(
                inArray(customers.familyCode, familyCodes),
                eq(customers.customerKind, "student"),
            ),
        );

    for (const r of rows) {
        const fam = r.familyCode;
        const ext = r.externalId;
        if (!fam || !ext) continue;
        const byExt = out.get(fam) ?? new Map<string, DbChild>();
        byExt.set(ext, {
            customerId: r.customerId,
            externalId: ext,
            name: r.name,
            schoolType: r.schoolType,
            walletId: r.walletId,
            currentBalance: r.balance != null ? Number(r.balance) : 0,
        });
        out.set(fam, byExt);
    }
    return out;
}

async function walletsAlreadyDoneForTicket(ticket: string): Promise<Set<number>> {
    const rows = await db
        .selectDistinct({ walletId: walletTransactions.walletId })
        .from(walletTransactions)
        .where(eq(walletTransactions.referenceTicket, ticket));
    return new Set(rows.map((r) => r.walletId));
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs();
    console.log(
        args.execute
            ? "*** EXECUTE MODE — wallets WILL be adjusted ***"
            : "DRY RUN — no wallet will be touched (pass --execute to apply)",
    );
    console.log(`Ticket: ${args.ticket}`);
    console.log(`Reading ${args.xlsxPath} ...`);
    console.log(`Families JSON: ${args.familiesJsonPaths.join(", ")}`);

    const familiesJson = loadFamiliesFromJson(args.familiesJsonPaths);
    console.log(`Loaded ${familiesJson.size} families from JSON.`);

    const allRows = readFamilyRows(args.xlsxPath);
    console.log(`Found ${allRows.length} "Family" type row(s) in xlsx.`);

    const dedupedAllRows = dedupeByLatestTransaction(allRows);
    const negative = dedupedAllRows.filter((r) => r.campusBalance < 0);
    const nonNegative = dedupedAllRows.filter((r) => r.campusBalance >= 0);
    const balanceByFamily = familyRowsToMap(nonNegative);
    const negativeByFamily = familyRowsToMap(negative);
    console.log(`Found ${negative.length} unique family_code(s) with negative family balance.`);

    console.log(`${dedupedAllRows.length} unique family_code(s) after de-duplication.`);

    const alreadyDone = args.execute ? await walletsAlreadyDoneForTicket(args.ticket) : new Set<number>();
    if (alreadyDone.size > 0) {
        console.log(`Resume: ${alreadyDone.size} wallet(s) already have reference_ticket='${args.ticket}' — will skip.`);
    }

    const jsonFamilies = [...familiesJson.values()].sort((a, b) => a.familyCode.localeCompare(b.familyCode, undefined, { numeric: true }));
    const familyCodesInJson = jsonFamilies.map((f) => f.familyCode);
    console.log(`Loading DB family/student data for ${familyCodesInJson.length} family_code(s) from JSON...`);
    const [dbFamilyCodes, dbByFamily] = await Promise.all([
        loadDbFamilyCodes(familyCodesInJson),
        loadDbStudentsByFamily(familyCodesInJson),
    ]);

    type SetRow = [string, string, number, number, string, string, string, number, number, number, string];
    const setRows: SetRow[] = [];
    const xlsxNotInJson: Array<[string, string, number]> = [];
    const missingBalance: Array<[string, number, number]> = [];
    const noEligible: Array<Array<string | number>> = [];
    const studentNotInDb: Array<[string, string, number, string, string]> = [];
    const incompleteFamilies: Array<Array<string | number>> = [];

    let familiesProcessed = 0;
    let adjustmentsPlanned = 0;
    let totalDeltaAbs = 0;
    let newlyExecuted = 0;
    let skippedAlready = 0;
    let skippedAtTarget = 0;
    let skippedNoWallet = 0;

    for (const row of nonNegative) {
        if (!familiesJson.has(row.familyCode)) {
            xlsxNotInJson.push([row.familyCode, row.name, row.campusBalance]);
        }
    }

    const invalidFamilies = new Set<string>();
    console.log("Running strict pre-flight validation...");
    for (const jsonFam of jsonFamilies) {
        const eligible = jsonFam.students
            .filter(isEligibleJsonStudent)
            .sort((a, b) => a.customerId - b.customerId);
        const dbChildren = dbByFamily.get(jsonFam.familyCode) ?? new Map<string, DbChild>();
        const dbMatched = eligible.filter((s) => dbChildren.has(String(s.customerId)));
        const dbWithWallet = dbMatched.filter((s) => !!dbChildren.get(String(s.customerId))?.walletId);

        const issues: string[] = [];
        if (!dbFamilyCodes.has(jsonFam.familyCode)) issues.push("family_not_in_db");
        if (negativeByFamily.has(jsonFam.familyCode)) issues.push("negative_balance");
        const familyBalanceRow = balanceByFamily.get(jsonFam.familyCode);
        if (!familyBalanceRow) {
            issues.push("missing_balance");
            missingBalance.push([jsonFam.familyCode, eligible.length, jsonFam.students.length]);
        }

        const missingStudentIds = eligible
            .map((s) => String(s.customerId))
            .filter((externalId) => !dbChildren.has(externalId));
        const missingWalletIds = dbMatched
            .map((s) => String(s.customerId))
            .filter((externalId) => !dbChildren.get(externalId)?.walletId);

        if (missingStudentIds.length > 0) issues.push("student_not_in_db");
        if (missingWalletIds.length > 0) issues.push("wallet_missing");

        if (eligible.length === 0) {
            noEligible.push([jsonFam.familyCode, familyBalanceRow?.campusBalance ?? "", jsonFam.students.length]);
        }

        const targets = familyBalanceRow && eligible.length > 0 ? splitEvenly(familyBalanceRow.campusBalance, eligible.length) : [];

        for (let i = 0; i < eligible.length; i++) {
            const js = eligible[i];
            const externalId = String(js.customerId);
            if (!dbChildren.has(externalId)) {
                const displayName = `${js.firstName} ${js.lastName}`.trim();
                studentNotInDb.push([jsonFam.familyCode, externalId, targets[i] ?? 0, displayName, js.schoolType ?? ""]);
            }
        }

        if (issues.length > 0) {
            invalidFamilies.add(jsonFam.familyCode);
            incompleteFamilies.push([
                jsonFam.familyCode,
                issues.join("|"),
                eligible.length,
                dbMatched.length,
                dbWithWallet.length,
                missingStudentIds.join("|"),
                missingWalletIds.join("|"),
            ]);
        }
    }

    const strictIssueCount = invalidFamilies.size;
    if (strictIssueCount > 0) {
        console.log(`Strict validation found ${strictIssueCount} incomplete family/families.`);
    } else {
        console.log("Strict validation passed.");
    }
    const executeBlockedByStrict = args.execute && strictIssueCount > 0;
    if (executeBlockedByStrict) {
        console.log("Execute is blocked by strict validation. No wallet adjustments will be executed.");
    }

    let familyIdx = 0;
    for (const jsonFam of jsonFamilies) {
        familyIdx += 1;
        if (familyIdx % 100 === 0 || familyIdx === jsonFamilies.length) {
            console.log(`Processing family ${familyIdx}/${jsonFamilies.length}...`);
        }

        if (invalidFamilies.has(jsonFam.familyCode)) {
            continue;
        }

        const eligible = jsonFam.students
            .filter(isEligibleJsonStudent)
            .sort((a, b) => a.customerId - b.customerId);

        if (eligible.length === 0) {
            continue;
        }

        const fam = balanceByFamily.get(jsonFam.familyCode);
        if (!fam) continue;

        familiesProcessed += 1;
        const targets = splitEvenly(fam.campusBalance, eligible.length);

        for (let i = 0; i < eligible.length; i++) {
            const js = eligible[i];
            const target = targets[i];
            const externalId = String(js.customerId);
            const displayName = `${js.firstName} ${js.lastName}`.trim();

            const dbChild = dbByFamily.get(fam.familyCode)?.get(externalId) ?? null;
            if (!dbChild) {
                setRows.push([
                    fam.familyCode, fam.name, fam.campusBalance, eligible.length,
                    externalId, displayName, js.schoolType ?? "",
                    0, target, target, "ERROR:not_in_db",
                ]);
                continue;
            }

            if (!dbChild.walletId) {
                skippedNoWallet += 1;
                setRows.push([
                    fam.familyCode, fam.name, fam.campusBalance, eligible.length,
                    externalId, dbChild.name, dbChild.schoolType ?? "",
                    dbChild.currentBalance, target, target - dbChild.currentBalance, "ERROR:no_wallet",
                ]);
                continue;
            }

            const delta = Math.round((target - dbChild.currentBalance) * 100) / 100;
            let executed = "no";

            if (Math.abs(delta) < DELTA_EPSILON) {
                skippedAtTarget += 1;
                executed = "skipped_at_target";
            } else if (alreadyDone.has(dbChild.walletId)) {
                skippedAlready += 1;
                executed = "already";
            } else if (executeBlockedByStrict) {
                executed = "blocked_strict";
            } else if (args.execute && args.adminUserId) {
                await adjustBalance({
                    walletId: dbChild.walletId,
                    amount: delta,
                    adminUserId: args.adminUserId,
                    reason: "Set student wallet to family balance share (MyCampusCard sync)",
                    referenceTicket: args.ticket,
                });
                alreadyDone.add(dbChild.walletId);
                executed = "yes";
                newlyExecuted += 1;
            }

            if (Math.abs(delta) >= DELTA_EPSILON) {
                adjustmentsPlanned += 1;
                totalDeltaAbs += Math.abs(delta);
            }

            setRows.push([
                fam.familyCode, fam.name, fam.campusBalance, eligible.length,
                externalId, dbChild.name, dbChild.schoolType ?? "",
                dbChild.currentBalance, target, delta, executed,
            ]);
        }
    }

    const base = args.xlsxPath.replace(/\.xlsx$/i, "");
    const dir = path.dirname(args.xlsxPath);
    const stem = path.basename(base);

    await Bun.write(
        path.join(dir, `${stem}.set_balances.csv`),
        toCsv(
            [
                "family_code", "family_name", "family_balance", "eligible_n",
                "external_id", "student_name", "school_type",
                "current_balance", "target_balance", "delta", "executed",
            ],
            setRows as unknown as Array<Array<string | number>>,
        ),
    );
    await Bun.write(
        path.join(dir, `${stem}.xlsx_not_in_json.csv`),
        toCsv(["family_code", "family_name", "family_balance"], xlsxNotInJson),
    );
    await Bun.write(
        path.join(dir, `${stem}.missing_balance.csv`),
        toCsv(["family_code", "eligible_n", "total_students_in_json"], missingBalance),
    );
    await Bun.write(
        path.join(dir, `${stem}.incomplete_families.csv`),
        toCsv(
            [
                "family_code",
                "issues",
                "json_eligible_n",
                "db_matched_n",
                "db_with_wallet_n",
                "missing_student_external_ids",
                "missing_wallet_external_ids",
            ],
            incompleteFamilies,
        ),
    );
    await Bun.write(
        path.join(dir, `${stem}.no_eligible_children.csv`),
        toCsv(["family_code", "family_balance", "total_students_in_json"], noEligible),
    );
    await Bun.write(
        path.join(dir, `${stem}.student_not_in_db.csv`),
        toCsv(["family_code", "external_id", "target_balance", "json_name", "school_type"], studentNotInDb),
    );
    await Bun.write(
        path.join(dir, `${stem}.skipped_negative.csv`),
        toCsv(
            ["family_code", "family_name", "family_balance"],
            negative.map((r): [string, string, number] => [r.familyCode, r.name, r.campusBalance]),
        ),
    );

    console.log("");
    console.log("── Summary ──────────────────────────────");
    console.log(`JSON families scanned    : ${jsonFamilies.length}`);
    console.log(`Families processed       : ${familiesProcessed}`);
    console.log(`Strict incomplete fams   : ${strictIssueCount}`);
    console.log(`Xlsx-only families       : ${xlsxNotInJson.length}`);
    console.log(`Missing xlsx balance     : ${missingBalance.length}`);
    console.log(`No eligible children     : ${noEligible.length}`);
    console.log(`Students not in DB       : ${studentNotInDb.length}`);
    console.log(`Skipped (negative fam)   : ${negative.length}`);
    console.log(`Skipped (already target) : ${skippedAtTarget}`);
    console.log(`Skipped (no wallet)      : ${skippedNoWallet}`);
    console.log(`Skipped (already ticket) : ${skippedAlready}`);
    console.log(`Adjustments planned      : ${adjustmentsPlanned}`);
    console.log(`Sum |delta| planned      : ${totalDeltaAbs.toFixed(2)}`);
    if (args.execute) {
        console.log(`Newly executed this run  : ${newlyExecuted}`);
    } else {
        console.log("(dry run — pass --execute to apply)");
    }
    console.log(`Reports written next to ${args.xlsxPath} (basename: ${stem}.*.csv)`);

    if (executeBlockedByStrict) {
        throw new Error(
            `Strict validation failed for ${strictIssueCount} family/families. ` +
            "No wallet adjustments were executed. Review *.incomplete_families.csv before retrying.",
        );
    }
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.stack ?? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pgClient.end({ timeout: 5 });
    });
