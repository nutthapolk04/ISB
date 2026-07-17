/**
 * Set each eligible child's wallet balance to (family_balance / n) from a
 * MyCampusCard balance report — NOT an additive top-up.
 *
 * XLSX: reads FamilyCode + Balance from every row (ignores file CustomerType —
 * the export mixes Family and Staff rows). When the same family_code appears
 * more than once, the Family row wins; otherwise Staff is used.
 *
 * DB recipients (n) per family_code:
 *   - customers.customer_type = 'Student'
 *   - customers.customer_kind = 'student'
 *   - customers.school_type IS NULL OR != 'ES Student'
 *
 * Target per child = family balance / n, split with exact-cent remainder
 * handling (same as redistribute-family-balance.ts).
 * Adjustment = target − current wallet balance (can be positive or negative).
 *
 * Money movement uses audited adjustBalance() — never a raw UPDATE.
 *
 * SAFETY: defaults to DRY RUN. Pass --execute to write wallets.
 *
 * Usage (from backend-bun/):
 *   bun scripts/set-family-child-balances-from-report.ts <path-to-xlsx> \
 *     [--admin-user-id=<id>] [--execute] [--ticket=<ref>]
 *
 * Output CSVs (next to the xlsx, same basename):
 *   <name>.set_balances.csv
 *   <name>.no_eligible_children.csv
 *   <name>.skipped_negative.csv
 */

import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import * as path from "path";
import * as XLSX from "xlsx";
import { customers, wallets, walletTransactions } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { adjustBalance } from "../src/services/wallet_service";

// ── CLI ────────────────────────────────────────────────────────────────────

interface Args {
    xlsxPath: string;
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
            "[--admin-user-id=<id>] [--execute] [--ticket=<ref>]",
        );
    }
    const execute = flags.has("execute");
    const adminUserIdRaw = flags.get("admin-user-id");
    if (execute && !adminUserIdRaw) {
        throw new Error("--admin-user-id=<id> is required when --execute is passed");
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
        xlsxPath: positional[0],
        execute,
        adminUserId: adminUserIdRaw ? Number(adminUserIdRaw) : null,
        ticket: flags.get("ticket") ?? `family-set-balance-${today}`,
    };
}

// ── xlsx ───────────────────────────────────────────────────────────────────

interface BalanceRow {
    familyCode: string;
    name: string;
    campusBalance: number;
    /** Family | Staff | other — used only for de-duplication, not filtering. */
    fileCustomerType: string;
    transactionDateTime: Date | null;
}

function readBalanceRowsFromUseSheet(wb: XLSX.WorkBook): BalanceRow[] | null {
    const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "use this sheet");
    if (!sheetName) return null;
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
    const rows: BalanceRow[] = [];
    for (const r of raw) {
        const familyCode = String(r.FamilyCode ?? r["Family Code"] ?? "").trim();
        if (!familyCode) continue;
        const balanceRaw = r.Balance ?? r["Campus Balance"];
        const campusBalance = typeof balanceRaw === "number" ? balanceRaw : Number(balanceRaw ?? 0);
        const name = String(r.CustomerName ?? r.Name ?? "").trim();
        const fileCustomerType = String(r.CustomerType ?? r["Customer Type"] ?? "").trim();
        rows.push({ familyCode, name, campusBalance, fileCustomerType, transactionDateTime: null });
    }
    return rows;
}

/** Header-scan parser (legacy export shape). */
function readBalanceRowsFromHeaderScan(wb: XLSX.WorkBook): BalanceRow[] {
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
    if (!("Family Code" in col) || !("Campus Balance" in col)) {
        throw new Error('Missing expected columns "Family Code" and "Campus Balance"');
    }

    const rows: BalanceRow[] = [];
    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.length === 0) continue;
        const familyCode = String(row[col["Family Code"]] ?? "").trim();
        if (!familyCode) continue;
        const balanceRaw = row[col["Campus Balance"]];
        const campusBalance = typeof balanceRaw === "number" ? balanceRaw : Number(balanceRaw ?? 0);
        const txRaw = col["Transaction DateTime"] != null ? row[col["Transaction DateTime"]] : null;
        const transactionDateTime = txRaw instanceof Date ? txRaw : txRaw ? new Date(String(txRaw)) : null;
        const name = col["Name"] != null ? String(row[col["Name"]] ?? "").trim() : "";
        const fileCustomerType = col["Customer Type"] != null
            ? String(row[col["Customer Type"]] ?? "").trim()
            : "";
        rows.push({ familyCode, name, campusBalance, fileCustomerType, transactionDateTime });
    }
    return rows;
}

function readBalanceRows(xlsxPath: string): BalanceRow[] {
    const wb = XLSX.readFile(xlsxPath, { cellDates: true });
    const fromUseSheet = readBalanceRowsFromUseSheet(wb);
    if (fromUseSheet && fromUseSheet.length > 0) {
        console.log('Using sheet "Use this sheet" (FamilyCode + Balance; file CustomerType ignored).');
        return fromUseSheet;
    }
    console.log("Using header-scan parser on first sheet (FamilyCode + Balance).");
    return readBalanceRowsFromHeaderScan(wb);
}

function balanceRowPriority(row: BalanceRow): number {
    const t = row.fileCustomerType.toLowerCase();
    if (t === "family") return 3;
    if (t === "staff") return 2;
    return 1;
}

/** Prefer Family row over Staff when the same family_code appears more than once. */
function dedupeBalanceRows(rows: BalanceRow[]): BalanceRow[] {
    const byCode = new Map<string, BalanceRow>();
    for (const row of rows) {
        const existing = byCode.get(row.familyCode);
        if (!existing) {
            byCode.set(row.familyCode, row);
            continue;
        }
        const existingPri = balanceRowPriority(existing);
        const rowPri = balanceRowPriority(row);
        if (rowPri > existingPri) {
            byCode.set(row.familyCode, row);
            continue;
        }
        if (rowPri < existingPri) continue;
        const existingTime = existing.transactionDateTime?.getTime() ?? -Infinity;
        const rowTime = row.transactionDateTime?.getTime() ?? -Infinity;
        if (rowTime > existingTime) byCode.set(row.familyCode, row);
    }
    return [...byCode.values()];
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

/** Eligible student filter — matches sync + ES exclusion on DB school_type. */
function eligibleStudentWhere(familyCodes: string[]) {
    return and(
        inArray(customers.familyCode, familyCodes),
        eq(customers.customerKind, "student"),
        eq(customers.customerType, "Student"),
        or(isNull(customers.schoolType), ne(customers.schoolType, "ES Student")),
    );
}

async function loadEligibleStudentsByFamily(
    familyCodes: string[],
): Promise<Map<string, DbChild[]>> {
    const out = new Map<string, DbChild[]>();
    if (familyCodes.length === 0) return out;

    const rows = await db
        .select({
            familyCode: customers.familyCode,
            customerId: customers.id,
            externalId: customers.externalId,
            studentCode: customers.studentCode,
            name: customers.name,
            schoolType: customers.schoolType,
            walletId: wallets.id,
            balance: wallets.balance,
        })
        .from(customers)
        .leftJoin(wallets, eq(wallets.customerId, customers.id))
        .where(eligibleStudentWhere(familyCodes))
        .orderBy(asc(customers.familyCode), asc(customers.id));

    for (const r of rows) {
        const fam = r.familyCode;
        if (!fam) continue;
        const child: DbChild = {
            customerId: r.customerId,
            externalId: r.externalId ?? r.studentCode ?? String(r.customerId),
            name: r.name,
            schoolType: r.schoolType,
            walletId: r.walletId,
            currentBalance: r.balance != null ? Number(r.balance) : 0,
        };
        const list = out.get(fam) ?? [];
        list.push(child);
        out.set(fam, list);
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

    const allRows = readBalanceRows(args.xlsxPath);
    console.log(`Found ${allRows.length} row(s) with FamilyCode + Balance in xlsx.`);

    const deduped = dedupeBalanceRows(allRows);
    const negative = deduped.filter((r) => r.campusBalance < 0);
    const nonNegative = deduped.filter((r) => r.campusBalance >= 0);
    console.log(`Skipping ${negative.length} family_code(s) with negative balance.`);
    console.log(`${deduped.length} unique family_code(s) after de-duplication (prefer Family row over Staff).`);

    const familyCodes = nonNegative.map((r) => r.familyCode);
    console.log(`Loading eligible DB students for ${familyCodes.length} family_code(s)...`);
    const studentsByFamily = await loadEligibleStudentsByFamily(familyCodes);

    const alreadyDone = args.execute ? await walletsAlreadyDoneForTicket(args.ticket) : new Set<number>();
    if (alreadyDone.size > 0) {
        console.log(`Resume: ${alreadyDone.size} wallet(s) already have reference_ticket='${args.ticket}' — will skip.`);
    }

    type SetRow = [string, string, number, number, string, string, string, number, number, number, string];
    const setRows: SetRow[] = [];
    const noEligible: Array<[string, string, number, string, number]> = [];

    let familiesProcessed = 0;
    let adjustmentsPlanned = 0;
    let totalDeltaAbs = 0;
    let newlyExecuted = 0;
    let skippedAlready = 0;
    let skippedAtTarget = 0;
    let skippedNoWallet = 0;

    const sortedFamilies = [...nonNegative].sort((a, b) =>
        a.familyCode.localeCompare(b.familyCode, undefined, { numeric: true }),
    );

    let familyIdx = 0;
    for (const fam of sortedFamilies) {
        familyIdx += 1;
        if (familyIdx % 100 === 0 || familyIdx === sortedFamilies.length) {
            console.log(`Processing family ${familyIdx}/${sortedFamilies.length}...`);
        }

        const children = studentsByFamily.get(fam.familyCode) ?? [];
        if (children.length === 0) {
            noEligible.push([
                fam.familyCode,
                fam.name,
                fam.campusBalance,
                fam.fileCustomerType || "(unknown)",
                0,
            ]);
            continue;
        }

        familiesProcessed += 1;
        const targets = splitEvenly(fam.campusBalance, children.length);

        for (let i = 0; i < children.length; i++) {
            const dbChild = children[i];
            const target = targets[i];

            if (!dbChild.walletId) {
                skippedNoWallet += 1;
                setRows.push([
                    fam.familyCode, fam.name, fam.campusBalance, children.length,
                    dbChild.externalId, dbChild.name, dbChild.schoolType ?? "",
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
                fam.familyCode, fam.name, fam.campusBalance, children.length,
                dbChild.externalId, dbChild.name, dbChild.schoolType ?? "",
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
        path.join(dir, `${stem}.no_eligible_children.csv`),
        toCsv(
            ["family_code", "family_name", "family_balance", "xlsx_row_type", "db_eligible_n"],
            noEligible,
        ),
    );
    await Bun.write(
        path.join(dir, `${stem}.skipped_negative.csv`),
        toCsv(
            ["family_code", "family_name", "family_balance", "xlsx_row_type"],
            negative.map((r): [string, string, number, string] => [
                r.familyCode, r.name, r.campusBalance, r.fileCustomerType || "(unknown)",
            ]),
        ),
    );

    console.log("");
    console.log("── Summary ──────────────────────────────");
    console.log(`Xlsx family codes (>= 0) : ${nonNegative.length}`);
    console.log(`Families processed       : ${familiesProcessed}`);
    console.log(`No eligible DB students  : ${noEligible.length}`);
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
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.stack ?? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pgClient.end({ timeout: 5 });
    });
