/**
 * Manual/one-off runner for all three ISB-sync staleness sweeps — family
 * membership, staff, department. See the individual services for why
 * staleness (not per-batch presence) is the safe way to detect "ISB stopped
 * reporting this":
 *   - src/services/family_sweep_service.ts
 *   - src/services/staff_sweep_service.ts
 *   - src/services/department_sweep_service.ts
 *
 * The running server already does this automatically every hour (see
 * isb_sync_sweep_scheduler.ts) — use this script to run it on demand, e.g.
 * right after a real sync to see the effect immediately, or with a short
 * --cutoff-hours to verify behavior against test data.
 *
 * Usage (from backend-bun/):
 *   bun scripts/sweep-stale-isb-sync.ts [--cutoff-hours=3]
 */
import { sweepStaleFamilies } from "../src/services/family_sweep_service";
import { sweepStaleStaff } from "../src/services/staff_sweep_service";
import { sweepStaleDepartments } from "../src/services/department_sweep_service";
import { pgClient } from "../src/db/client";

function parseArgs(): { cutoffHours: number } {
    const flag = process.argv.find((a) => a.startsWith("--cutoff-hours="));
    return { cutoffHours: flag ? Number(flag.split("=")[1]) : 3 };
}

async function main() {
    const { cutoffHours } = parseArgs();
    console.log(`Sweeping ISB-sync-managed rows stale for more than ${cutoffHours}h...`);

    const family = await sweepStaleFamilies(cutoffHours);
    console.log("");
    console.log("── Family sweep ──────────────────────────");
    if (family.skippedNoRecentActivity) {
        console.log("Skipped — no recent family sync activity detected.");
    } else {
        console.log(`Families swept         : ${family.familiesSwept}`);
        console.log(`Parents/staff orphaned  : ${family.parentsOrphaned}`);
        console.log(`Students deactivated    : ${family.studentsDeactivated}`);
        if (family.familyCodesSwept.length > 0) console.log(`Family codes            : ${family.familyCodesSwept.join(", ")}`);
    }

    const staff = await sweepStaleStaff(cutoffHours);
    console.log("");
    console.log("── Staff sweep ───────────────────────────");
    if (staff.skippedNoRecentActivity) {
        console.log("Skipped — no recent staff sync activity detected.");
    } else {
        console.log(`Staff deactivated       : ${staff.staffSwept}`);
        if (staff.externalIdsSwept.length > 0) console.log(`External IDs            : ${staff.externalIdsSwept.join(", ")}`);
    }

    const dept = await sweepStaleDepartments(cutoffHours);
    console.log("");
    console.log("── Department sweep ──────────────────────");
    if (dept.skippedNoRecentActivity) {
        console.log("Skipped — no recent department sync activity detected.");
    } else {
        console.log(`Departments deactivated : ${dept.departmentsSwept}`);
        if (dept.departmentCodesSwept.length > 0) console.log(`Department codes        : ${dept.departmentCodesSwept.join(", ")}`);
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
