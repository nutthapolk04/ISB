/** Parse `sort_order` query param — default oldest-first (asc). */
export function parseSortOrder(raw?: string | null): "asc" | "desc" {
    return raw?.trim().toLowerCase() === "desc" ? "desc" : "asc";
}

/** Compare ISO datetimes with optional id tie-breaker. */
export function compareDateTime(
    a: string,
    b: string,
    order: "asc" | "desc",
    aId = 0,
    bId = 0,
): number {
    const cmp = a.localeCompare(b);
    if (cmp !== 0) return order === "asc" ? cmp : -cmp;
    const idCmp = aId - bId;
    return order === "asc" ? idCmp : -idCmp;
}
