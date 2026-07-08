/** Simple CSV parser — handles commas, quoted cells, CR/LF. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const parseRow = (row: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (inQuotes) {
        if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { cells.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };
  const header = parseRow(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => { obj[h] = cells[idx] ?? ""; });
    return obj;
  });
}
