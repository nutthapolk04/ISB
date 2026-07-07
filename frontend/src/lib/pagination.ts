/**
 * Windowed page-number list for pagination UIs: first, last, current ±1,
 * with "ellipsis" markers for gaps. e.g. (5, 10) -> [1, "ellipsis", 4, 5, 6, "ellipsis", 10]
 */
export function getPaginationRange(currentPage: number, totalPages: number): (number | "ellipsis")[] {
  return Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
    .reduce<(number | "ellipsis")[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("ellipsis");
      acc.push(p);
      return acc;
    }, []);
}
