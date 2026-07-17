/**
 * Set wallet balances from a MyCampusCard balance report — NOT an additive top-up.
 *
 * XLSX: reads FamilyCode + Balance from every row (ignores file CustomerType —
 * the export mixes Family and Staff rows). When the same family_code appears
 * more than once, the Family row wins; otherwise Staff is used.
 *
 * Per family_code:
 *   1. If eligible student(s) exist in DB → split family balance evenly among them.
 *      Eligible = customer_type 'Student', customer_kind 'student',
 *      school_type IS NULL OR != 'ES Student'.
 *   2. If no eligible students → credit the FULL family balance to main parent:
 *      a) parent_child_links.parent_rank = 'main' on any student in the family, else
 *      b) users.external_id = family_code (ISB convention: familyCode = mainParent id;
 *         also covers Staff rows where family_code is the staff member's own id).
 *
 * Target = family balance (parent path) or family balance / n (student path).
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
 *   <name>.set_parent_balances.csv
 *   <name>.no_main_parent.csv
 *   <name>.skipped_negative.csv
 */

import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import * as path from "path";
import * as XLSX from "xlsx";
import { customers, parentChildLinks, users, wallets, walletTransactions } from "../drizzle/schema";
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

interface ResolvedParent {
    userId: number;
    externalId: string | null;
    name: string;
    walletId: number | null;
    currentBalance: number;
    resolvedVia: "main_parent_link" | "external_id";
}

/** Batch-resolve main parent (or staff self) wallet per family_code. */
async function loadMainParentByFamily(familyCodes: string[]): Promise<Map<string, ResolvedParent>> {
    const resolved = new Map<string, ResolvedParent>();
    if (familyCodes.length === 0) return resolved;

    const linkRows = await db
        .select({
            familyCode: customers.familyCode,
            userId: users.id,
            externalId: users.externalId,
            fullName: users.fullName,
            username: users.username,
            walletId: wallets.id,
            balance: wallets.balance,
        })
        .from(customers)
        .innerJoin(
            parentChildLinks,
            and(
                eq(parentChildLinks.childCustomerId, customers.id),
                eq(parentChildLinks.parentRank, "main"),
            ),
        )
        .innerJoin(users, eq(users.id, parentChildLinks.parentUserId))
        .leftJoin(wallets, eq(wallets.userId, users.id))
        .where(
            and(
                inArray(customers.familyCode, familyCodes),
                eq(customers.customerKind, "student"),
            ),
        )
        .orderBy(asc(customers.familyCode), asc(users.id));

    for (const r of linkRows) {
        const fam = r.familyCode;
        if (!fam || resolved.has(fam)) continue;
        resolved.set(fam, {
            userId: r.userId,
            externalId: r.externalId,
            name: r.fullName ?? r.username,
            walletId: r.walletId,
            currentBalance: r.balance != null ? Number(r.balance) : 0,
            resolvedVia: "main_parent_link",
        });
    }

    const unresolved = familyCodes.filter((c) => !resolved.has(c));
    if (unresolved.length === 0) return resolved;

    const userRows = await db
        .select({
            externalId: users.externalId,
            userId: users.id,
            fullName: users.fullName,
            username: users.username,
            walletId: wallets.id,
            balance: wallets.balance,
        })
        .from(users)
        .leftJoin(wallets, eq(wallets.userId, users.id))
        .where(inArray(users.externalId, unresolved));

    for (const r of userRows) {
        const fam = r.externalId;
        if (!fam || resolved.has(fam)) continue;
        resolved.set(fam, {
            userId: r.userId,
            externalId: r.externalId,
            name: r.fullName ?? r.username,
            walletId: r.walletId,
            currentBalance: r.balance != null ? Number(r.balance) : 0,
            resolvedVia: "external_id",
        });
    }

    return resolved;
}

async function ensureUserWalletId(userId: number): Promise<number> {
    const rows = await db.select({ id: wallets.id }).from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (rows[0]) return rows[0].id;
    const [created] = await db
        .insert(wallets)
        .values({ userId, balance: "0", isActive: true })
        .returning({ id: wallets.id });
    return created.id;
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

    const noEligibleCodes = familyCodes.filter((c) => (studentsByFamily.get(c) ?? []).length === 0);
    console.log(`Loading main parent / staff wallets for ${noEligibleCodes.length} family_code(s) with no eligible students...`);
    const mainParentByFamily = await loadMainParentByFamily(noEligibleCodes);

    const alreadyDone = args.execute ? await walletsAlreadyDoneForTicket(args.ticket) : new Set<number>();
    if (alreadyDone.size > 0) {
        console.log(`Resume: ${alreadyDone.size} wallet(s) already have reference_ticket='${args.ticket}' — will skip.`);
    }

    type SetRow = [string, string, number, number, string, string, string, number, number, number, string];
    type ParentSetRow = [string, string, number, string, number, string, string, number, number, number, string, string];
    const setRows: SetRow[] = [];
    const setParentRows: ParentSetRow[] = [];
    const noMainParent: Array<[string, string, number, string]> = [];

    let familiesProcessed = 0;
    let parentFamiliesProcessed = 0;
    let adjustmentsPlanned = 0;
    let parentAdjustmentsPlanned = 0;
    let totalDeltaAbs = 0;
    let parentDeltaAbs = 0;
    let newlyExecuted = 0;
    let parentNewlyExecuted = 0;
    let skippedAlready = 0;
    let skippedAtTarget = 0;
    let skippedNoWallet = 0;
    let parentSkippedAtTarget = 0;
    let parentSkippedAlready = 0;

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
            const parent = mainParentByFamily.get(fam.familyCode);
            if (!parent) {
                noMainParent.push([
                    fam.familyCode,
                    fam.name,
                    fam.campusBalance,
                    fam.fileCustomerType || "(unknown)",
                ]);
                continue;
            }

            parentFamiliesProcessed += 1;
            const target = fam.campusBalance;
            let walletId = parent.walletId;
            let currentBalance = parent.currentBalance;

            if (!walletId && args.execute) {
                walletId = await ensureUserWalletId(parent.userId);
                currentBalance = 0;
            }

            if (!walletId) {
                setParentRows.push([
                    fam.familyCode, fam.name, fam.campusBalance,
                    fam.fileCustomerType || "(unknown)",
                    parent.userId, parent.externalId ?? "", parent.name,
                    currentBalance, target, target - currentBalance,
                    "ERROR:no_wallet", parent.resolvedVia,
                ]);
                continue;
            }

            const delta = Math.round((target - currentBalance) * 100) / 100;
            let executed = "no";

            if (Math.abs(delta) < DELTA_EPSILON) {
                parentSkippedAtTarget += 1;
                executed = "skipped_at_target";
            } else if (alreadyDone.has(walletId)) {
                parentSkippedAlready += 1;
                executed = "already";
            } else if (args.execute && args.adminUserId) {
                await adjustBalance({
                    walletId,
                    amount: delta,
                    adminUserId: args.adminUserId,
                    reason: "Set main parent wallet to family balance (MyCampusCard sync, no eligible students)",
                    referenceTicket: args.ticket,
                });
                alreadyDone.add(walletId);
                executed = "yes";
                parentNewlyExecuted += 1;
            }

            if (Math.abs(delta) >= DELTA_EPSILON) {
                parentAdjustmentsPlanned += 1;
                parentDeltaAbs += Math.abs(delta);
            }

            setParentRows.push([
                fam.familyCode, fam.name, fam.campusBalance,
                fam.fileCustomerType || "(unknown)",
                parent.userId, parent.externalId ?? "", parent.name,
                currentBalance, target, delta, executed, parent.resolvedVia,
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
        path.join(dir, `${stem}.set_parent_balances.csv`),
        toCsv(
            [
                "family_code", "family_name", "family_balance", "xlsx_row_type",
                "parent_user_id", "parent_external_id", "parent_name",
                "current_balance", "target_balance", "delta", "executed", "resolved_via",
            ],
            setParentRows as unknown as Array<Array<string | number>>,
        ),
    );
    await Bun.write(
        path.join(dir, `${stem}.no_main_parent.csv`),
        toCsv(
            ["family_code", "family_name", "family_balance", "xlsx_row_type"],
            noMainParent,
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

    const viaLink = setParentRows.filter((r) => r[11] === "main_parent_link").length;
    const viaExtId = setParentRows.filter((r) => r[11] === "external_id").length;

    console.log("");
    console.log("── Summary ──────────────────────────────");
    console.log(`Xlsx family codes (>= 0) : ${nonNegative.length}`);
    console.log(`Student split families   : ${familiesProcessed}`);
    console.log(`Main parent / staff fams : ${parentFamiliesProcessed}`);
    console.log(`No main parent in DB     : ${noMainParent.length}`);
    console.log(`Skipped (negative fam)   : ${negative.length}`);
    console.log(`Student: skipped @target : ${skippedAtTarget}`);
    console.log(`Student: skipped no wlt  : ${skippedNoWallet}`);
    console.log(`Student: skipped ticket  : ${skippedAlready}`);
    console.log(`Student: adjustments     : ${adjustmentsPlanned} (|delta| ${totalDeltaAbs.toFixed(2)})`);
    console.log(`Parent:  via main link   : ${viaLink}`);
    console.log(`Parent:  via external_id: ${viaExtId}`);
    console.log(`Parent:  skipped @target  : ${parentSkippedAtTarget}`);
    console.log(`Parent:  skipped ticket   : ${parentSkippedAlready}`);
    console.log(`Parent:  adjustments      : ${parentAdjustmentsPlanned} (|delta| ${parentDeltaAbs.toFixed(2)})`);
    if (args.execute) {
        console.log(`Student executed         : ${newlyExecuted}`);
        console.log(`Parent executed          : ${parentNewlyExecuted}`);
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
