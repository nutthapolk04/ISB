/**
 * Grade-tier daily spending limits — shared constants/helpers for the bulk
 * spend-limit import script (scripts/set-spend-limits-from-report.ts).
 */

export type GradeTier = "low" | "high";

export const LOW_TIER_LIMITS = { canteen: 0.1, store: 0.1 } as const;
export const HIGH_TIER_LIMITS = { canteen: 500, store: 25_000 } as const;

const LOW_TIER_KINDERGARTEN = new Set(["K0", "K00", "K1", "K01"]);

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
