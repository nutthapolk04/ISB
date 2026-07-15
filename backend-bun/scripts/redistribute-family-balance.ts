/**
 * Redistribute a family's pooled campus-card balance evenly among that
 * family's currently-enrolled, non-"ES Student" children.
 *
 * Source file: a MyCampusCard (legacy system) "Customer Balance Report" xlsx
 * export. Only rows with Customer Type = "Family" are treated as a money
 * source — Staff / Others / Customers / Visitor rows in the file are ignored
 * entirely, and the file's own "Customers" (student) rows are NEVER used to
 * decide who the recipients are. The recipient list comes 100% from our own
 * DB (`customers` table), joined by family_code. This mirrors the scope we
 * agreed on: "ยึดตาม Database เท่านั้น" — the xlsx only tells us how much
 * money to move, the DB tells us who gets it.
 *
 * Eligibility for a child to receive a share:
 *   - customers.family_code matches the family's code
 *   - customers.customer_kind = 'student'
 *   - customers.is_active = true
 *   - customers.is_graduated = false
 *   - customers.school_type IS NULL OR != 'ES Student'
 *     (NULL is treated as "not ES" — we have no positive evidence it's ES,
 *     and SQL's `!=` alone would silently exclude NULLs, which would have
 *     been wrong here. See DOCUMENTED ASSUMPTIONS below.)
 *
 * DOCUMENTED ASSUMPTIONS (flagged per review — confirm before relying on
 * these for a real payout run):
 *   1. is_active=true / is_graduated=false filters were not explicitly
 *      requested — added as a safety default so money doesn't get paid into
 *      a withdrawn/graduated student's account. Remove ELIGIBLE_WHERE below
 *      if that's wrong.
 *   2. Rows in the xlsx with Customer Type="Family" but a non-blank Grade
 *      (e.g. "STAFF", "Panther Activities") are NOT filtered out — per
 *      instruction, DB match is the sole authority now. A small number of
 *      these (5-digit codes) sit in the same numeric range as real family
 *      codes and could in theory coincide with an unrelated real family.
 *   3. Negative Campus Balance rows are skipped entirely (separate decision,
 *      out of scope for this script) — written to a `.skipped_negative.csv`
 *      report for visibility, not silently dropped.
 *   4. Duplicate Family Code rows (same code appears >1 time under Customer
 *      Type="Family") are deduped by keeping the row with the latest
 *      Transaction DateTime.
 *
 * Money movement goes through the existing audited adjustBalance() path
 * (wallet_transactions + audit_logs) — never a raw UPDATE.
 *
 * SAFETY: defaults to DRY RUN. No wallet is touched unless --execute is
 * passed explicitly. Always run without --execute first and read the
 * reports before ever passing --execute against a real database.
 *
 * Usage (from backend-bun/):
 *   bun scripts/redistribute-family-balance.ts <path-to-xlsx> \
 *     --admin-user-id=<id> [--execute] [--ticket=<ref>]
 *
 * Output (written next to the input xlsx, same basename):
 *   <name>.distributed.csv          family_code, customer, school_type, share, wallet_id, executed
 *   <name>.unmatched.csv            family_code not found in DB at all
 *   <name>.no_eligible_children.csv family found, but 0 eligible children
 *   <name>.skipped_negative.csv     family balance < 0, skipped (per decision)
 */

import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import * as XLSX from "xlsx";
import * as path from "path";
import { customers, users, wallets } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { adjustBalance } from "../src/services/wallet_service";

// ── CLI args ─────────────────────────────────────────────────────────────

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
        throw new Error("Usage: bun scripts/redistribute-family-balance.ts <path-to-xlsx> --admin-user-id=<id> [--execute] [--ticket=<ref>]");
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
        ticket: flags.get("ticket") ?? `family-split-${today}`,
    };
}

// ── xlsx parsing ─────────────────────────────────────────────────────────

interface FamilyRow {
    familyCode: string;
    name: string;
    campusBalance: number;
    transactionDateTime: Date | null;
}

/** Finds the header row by content (not a hardcoded row number) so a
 * differently-shaped export of the same report doesn't silently break this. */
function readFamilyRows(xlsxPath: string): FamilyRow[] {
    const wb = XLSX.readFile(xlsxPath, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

    let headerRowIdx = -1;
    let col: Record<string, number> = {};
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
        throw new Error(`Could not find a "Family Code" header row in ${xlsxPath}`);
    }
    for (const required of ["Family Code", "Name", "Customer Type", "Campus Balance", "Transaction DateTime"]) {
        if (!(required in col)) throw new Error(`Missing expected column "${required}" in ${xlsxPath}`);
    }

    const rows: FamilyRow[] = [];
    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.length === 0) continue;
        const customerType = String(row[col["Customer Type"]] ?? "").trim();
        if (customerType !== "Family") continue; // per decision: only "Family" type is a money source

        const familyCode = String(row[col["Family Code"]] ?? "").trim();
        if (!familyCode) continue;
        const balanceRaw = row[col["Campus Balance"]];
        const campusBalance = typeof balanceRaw === "number" ? balanceRaw : Number(balanceRaw ?? 0);
        const txRaw = row[col["Transaction DateTime"]];
        const transactionDateTime = txRaw instanceof Date ? txRaw : txRaw ? new Date(String(txRaw)) : null;

        rows.push({
            familyCode,
            name: String(row[col["Name"]] ?? "").trim(),
            campusBalance,
            transactionDateTime,
        });
    }
    return rows;
}

/** Same family_code appearing more than once under Customer Type="Family" —
 * keep the row with the latest Transaction DateTime, drop the rest. */
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

// ── even split with exact-cent remainder handling ───────────────────────

/** Splits `totalBaht` into `n` shares (2-decimal baht) that sum EXACTLY back
 * to totalBaht — plain (totalBaht/n).toFixed(2) per share can drift the sum
 * off by a cent due to rounding. Order matters: pass children pre-sorted
 * (ascending id) so the remainder cent(s) land on the same children every
 * run — deterministic, not "whoever happens first". */
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

// ── CSV helpers ──────────────────────────────────────────────────────────

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
    const esc = (v: string | number) => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

// ── DB lookups ───────────────────────────────────────────────────────────

async function familyExistsInDb(familyCode: string): Promise<boolean> {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.familyCode, familyCode)).limit(1);
    if (u) return true;
    const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.familyCode, familyCode)).limit(1);
    return !!c;
}

interface EligibleChild {
    customerId: number;
    name: string;
    schoolType: string | null;
    walletId: number | null;
}

async function getEligibleChildren(familyCode: string): Promise<EligibleChild[]> {
    const rows = await db
        .select({
            customerId: customers.id,
            name: customers.name,
            schoolType: customers.schoolType,
            walletId: wallets.id,
        })
        .from(customers)
        .leftJoin(wallets, eq(wallets.customerId, customers.id))
        .where(
            and(
                eq(customers.familyCode, familyCode),
                eq(customers.customerKind, "student"),
                eq(customers.isActive, true),
                eq(customers.isGraduated, false),
                or(isNull(customers.schoolType), ne(customers.schoolType, "ES Student")),
            ),
        )
        .orderBy(asc(customers.id));
    return rows;
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs();
    console.log(args.execute ? "*** EXECUTE MODE — wallets WILL be adjusted ***" : "DRY RUN — no wallet will be touched (pass --execute to actually move money)");
    console.log(`Reading ${args.xlsxPath} ...`);

    const allRows = readFamilyRows(args.xlsxPath);
    console.log(`Found ${allRows.length} "Family" type row(s).`);

    const negative = allRows.filter((r) => r.campusBalance < 0);
    const nonNegative = allRows.filter((r) => r.campusBalance >= 0);
    console.log(`Skipping ${negative.length} row(s) with a negative balance (per decision — logged separately, not processed).`);

    const deduped = dedupeByLatestTransaction(nonNegative);
    console.log(`${deduped.length} unique family_code(s) after de-duplicating by latest Transaction DateTime.`);

    const distributed: Array<[string, string, number, string, string, number, string, string]> = [];
    const unmatched: Array<[string, string, number, string]> = [];
    const noEligible: Array<[string, string, number, string]> = [];

    let totalDistributed = 0;

    for (const fam of deduped) {
        const exists = await familyExistsInDb(fam.familyCode);
        if (!exists) {
            unmatched.push([fam.familyCode, fam.name, fam.campusBalance, fam.transactionDateTime?.toISOString() ?? ""]);
            continue;
        }

        const children = await getEligibleChildren(fam.familyCode);
        if (children.length === 0) {
            noEligible.push([fam.familyCode, fam.name, fam.campusBalance, fam.transactionDateTime?.toISOString() ?? ""]);
            continue;
        }

        const shares = splitEvenly(fam.campusBalance, children.length);
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const share = shares[i];
            let executed = "no";

            if (!child.walletId) {
                distributed.push([fam.familyCode, fam.name, fam.campusBalance, String(child.customerId), child.name, share, "ERROR: no wallet found", executed]);
                continue;
            }

            if (args.execute && args.adminUserId) {
                await adjustBalance({
                    walletId: child.walletId,
                    amount: share,
                    adminUserId: args.adminUserId,
                    reason: "Family balance redistribution to student members",
                    referenceTicket: args.ticket,
                });
                executed = "yes";
            }
            totalDistributed += share;
            distributed.push([
                fam.familyCode,
                fam.name,
                fam.campusBalance,
                String(child.customerId),
                child.name,
                share,
                child.schoolType ?? "(null)",
                executed,
            ]);
        }
    }

    const base = args.xlsxPath.replace(/\.xlsx$/i, "");
    const dir = path.dirname(args.xlsxPath);
    const stem = path.basename(base);

    await Bun.write(
        path.join(dir, `${stem}.distributed.csv`),
        toCsv(
            ["family_code", "family_name", "family_balance", "customer_id", "student_name", "share_amount", "school_type", "executed"],
            distributed as unknown as Array<Array<string | number>>,
        ),
    );
    await Bun.write(
        path.join(dir, `${stem}.unmatched.csv`),
        toCsv(["family_code", "family_name", "family_balance", "transaction_datetime"], unmatched),
    );
    await Bun.write(
        path.join(dir, `${stem}.no_eligible_children.csv`),
        toCsv(["family_code", "family_name", "family_balance", "transaction_datetime"], noEligible),
    );
    await Bun.write(
        path.join(dir, `${stem}.skipped_negative.csv`),
        toCsv(
            ["family_code", "family_name", "family_balance", "transaction_datetime"],
            negative.map((r): [string, string, number, string] => [r.familyCode, r.name, r.campusBalance, r.transactionDateTime?.toISOString() ?? ""]),
        ),
    );

    console.log("");
    console.log("── Summary ──────────────────────────────");
    console.log(`Families matched + split : ${deduped.length - unmatched.length - noEligible.length}`);
    console.log(`Unmatched (not in DB)    : ${unmatched.length}`);
    console.log(`No eligible children     : ${noEligible.length}`);
    console.log(`Skipped (negative)       : ${negative.length}`);
    console.log(`Total amount distributed : ${totalDistributed.toFixed(2)}${args.execute ? "" : " (dry run — not actually written)"}`);
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
