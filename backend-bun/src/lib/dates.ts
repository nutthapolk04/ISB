/**
 * Format a Postgres timestamp-with-timezone string into Pydantic v2-compatible
 * ISO 8601 with microsecond precision and explicit ±HH:MM offset.
 *
 * postgres-js gives us strings like "2026-05-12 08:43:42.21772+00";
 * Pydantic outputs "2026-05-12T08:43:42.217720+00:00". Date.toISOString()
 * collapses to UTC "Z" and rounds to milliseconds, so it loses information.
 * This is the canonical conversion used by every service mapper.
 */
export function pgToIso(pg: string | null): string | null {
  if (pg === null) return null;
  if (pg.includes("T") && (pg.includes("+") || pg.endsWith("Z"))) return pg;
  const m = pg.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/,
  );
  if (!m) return pg;
  const [, date, time, offH, offM = "00"] = m;
  return `${date}T${time}${offH}:${offM}`;
}

/** Convert Drizzle numeric (string) → number; null-safe. */
export function pgNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
