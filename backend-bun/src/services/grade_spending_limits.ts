/**
 * Grade-tier daily spending limits for students — shared by family sync
 * (powerschool_sync.ts) and the bulk spend-limit import script.
 */

export type GradeTier = "low" | "high";

export const LOW_TIER_LIMITS = { canteen: 0.1, store: 0.1 } as const;
export const HIGH_TIER_LIMITS = { canteen: 500, store: 25_000 } as const;

const LOW_TIER_KINDERGARTEN = new Set(["K0", "K00", "K1", "K01"]);

/** > 1 keeps the existing limit when promoting lower → upper tier. */
export const PROMOTE_KEEP_LIMIT_THRESHOLD = 1;

export function classifyGradeTier(gradeRaw: string | null | undefined): GradeTier | null {
    if (!gradeRaw) return null;
    const grade = gradeRaw.trim().toUpperCase();
    if (LOW_TIER_KINDERGARTEN.has(grade)) return "low";
    if (!/^\d+$/.test(grade)) return null;
    const num = Number(grade);
    if (num >= 0 && num <= 4) return "low";
    if (num >= 5 && num <= 12) return "high";
    return null;
}

export function tierLimits(tier: GradeTier): { canteen: number; store: number } {
    return tier === "low" ? { ...LOW_TIER_LIMITS } : { ...HIGH_TIER_LIMITS };
}

export type SpendingLimitReason = "init" | "null_fill" | "promote";

export interface SpendingLimitResolution {
    /** null = leave column unchanged */
    canteen: string | null;
    store: string | null;
    reason: SpendingLimitReason | null;
}

function formatLimit(n: number): string {
    return n.toFixed(2);
}

function resolveColumn(
    current: number | null,
    tierDefault: number,
    promotingToUpper: boolean,
): string | null {
    if (current === null) return formatLimit(tierDefault);
    if (promotingToUpper) {
        if (current > PROMOTE_KEEP_LIMIT_THRESHOLD) return null;
        return formatLimit(tierDefault);
    }
    return null;
}

/**
 * Decide canteen/store limits to write during family sync.
 *
 * - Unknown grade → no changes.
 * - NULL column → fill from current grade tier (every sync).
 * - New student → fill from tier (reason: init).
 * - lower → upper promotion → per column: keep if > 1, else upper default.
 * - All other existing rows with non-null limits → unchanged.
 */
export function resolveStudentSpendingLimits(args: {
    newGrade: string | null;
    oldGrade: string | null;
    currentCanteen: string | null;
    currentStore: string | null;
    isNew: boolean;
}): SpendingLimitResolution {
    const newTier = classifyGradeTier(args.newGrade);
    if (!newTier) return { canteen: null, store: null, reason: null };

    const defaults = tierLimits(newTier);
    const oldTier = classifyGradeTier(args.oldGrade);
    const promotingToUpper = !args.isNew && oldTier === "low" && newTier === "high";

    const curC = args.currentCanteen != null ? Number(args.currentCanteen) : null;
    const curS = args.currentStore != null ? Number(args.currentStore) : null;

    const canteen = resolveColumn(curC, defaults.canteen, promotingToUpper);
    const store = resolveColumn(curS, defaults.store, promotingToUpper);

    if (canteen === null && store === null) {
        return { canteen: null, store: null, reason: null };
    }

    let reason: SpendingLimitReason;
    if (args.isNew) {
        reason = "init";
    } else if (promotingToUpper) {
        reason = "promote";
    } else {
        reason = "null_fill";
    }

    return { canteen, store, reason };
}
