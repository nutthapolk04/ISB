export type DateTimeSortDir = "asc" | "desc";

export const DEFAULT_DATE_TIME_SORT: DateTimeSortDir = "asc";

export function toggleDateTimeSort(current: DateTimeSortDir): DateTimeSortDir {
  return current === "asc" ? "desc" : "asc";
}

export function sortByDateTime<T>(
  rows: T[],
  getDateTime: (row: T) => string,
  getId: (row: T) => number,
  dir: DateTimeSortDir,
): T[] {
  return [...rows].sort((a, b) => {
    const cmp = getDateTime(a).localeCompare(getDateTime(b));
    if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    const idCmp = getId(a) - getId(b);
    return dir === "asc" ? idCmp : -idCmp;
  });
}

export function appendSortOrder(params: URLSearchParams, dir: DateTimeSortDir) {
  params.set("sort_order", dir);
}
