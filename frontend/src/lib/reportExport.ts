/**
 * Shared report-export helpers — used by every report tab on the Reports
 * page. Produces a polished PDF (with school branding) and a typed Excel
 * workbook from the same payload, so each report only has to declare its
 * columns + rows once.
 *
 * PDF layout
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [logo]  School Name                Generated YYYY-MM-DD  │
 *   │         Report Title                                     │
 *   │         Filter summary line 1                            │
 *   │         Filter summary line 2                            │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ table headers …                                          │
 *   │ rows …                                                   │
 *   │ TOTAL row (bold, if provided)                            │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Excel layout
 *   Row 1: <School Name>
 *   Row 2: <Report Title>
 *   Row 3: Generated: <ISO datetime>
 *   Row 4: Filters: <comma-joined summary>
 *   Row 5: (blank)
 *   Row 6: column headers
 *   Row 7..n: data
 *   Row n+1: TOTAL row (if provided)
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

// ─── Public types ────────────────────────────────────────────────────────

export type ColumnFormat = "text" | "number" | "currency" | "date" | "datetime";
export type ColumnAlign = "left" | "right" | "center";

export interface ReportColumn {
  /** Display name shown in the table header (English — school is international). */
  header: string;
  /** Property name on each row used to read the value. */
  key: string;
  /** Optional width hint. PDF: points. Excel: character width. */
  width?: number;
  /** Cell horizontal alignment. Defaults to "right" for numbers/currency, "left" otherwise. */
  align?: ColumnAlign;
  /** How to format the raw value. Defaults to "text". */
  format?: ColumnFormat;
}

export interface ReportMeta {
  /** Report name shown prominently in the PDF header and Excel row 2. */
  title: string;
  /** School branding — name shown top-right of PDF, row 1 of Excel. */
  schoolName: string;
  /** Optional school logo. Absolute or relative URL; loaded into the PDF if reachable. */
  schoolLogoUrl?: string;
  /** Optional bullet lines summarising the active filters (e.g. "Date: 2026-01-01 → 2026-01-31"). */
  filters?: string[];
  /** Override the "Generated at" stamp. Defaults to new Date(). */
  generatedAt?: Date;
}

export interface ReportPayload<TRow extends Record<string, unknown>> {
  meta: ReportMeta;
  columns: ReportColumn[];
  rows: TRow[];
  /**
   * Optional totals row rendered in bold at the bottom. Map column.key → display value
   * (already formatted). The first column without a totals entry shows the label "TOTAL"
   * automatically unless you provide an explicit value for it.
   */
  totals?: Record<string, string | number>;
}

// ─── Value formatting (shared between PDF and Excel) ─────────────────────

const formatCurrency = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatNumber = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const formatDate = (v: unknown): string => {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
};

const formatDateTime = (v: unknown): string => {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

/**
 * Format a single cell for display. Returns the original value when the
 * format doesn't apply (e.g. number formatter on a null) so totals can do
 * arithmetic on the original numeric value.
 */
export function formatCell(value: unknown, format: ColumnFormat = "text"): string {
  if (value === null || value === undefined || value === "") return "";
  switch (format) {
    case "currency":
      return typeof value === "number" ? formatCurrency(value) : String(value);
    case "number":
      return typeof value === "number" ? formatNumber(value) : String(value);
    case "date":
      return formatDate(value);
    case "datetime":
      return formatDateTime(value);
    case "text":
    default:
      return String(value);
  }
}

const defaultAlign = (col: ReportColumn): ColumnAlign =>
  col.align ?? (col.format === "currency" || col.format === "number" ? "right" : "left");

// ─── Image loading (PDF logo) ────────────────────────────────────────────

/**
 * Fetch an image URL and return a data URL. Returns null on any failure so
 * the PDF can still render without the logo rather than crashing.
 *
 * Resolves relative URLs against `window.location.origin` so a logoUrl like
 * "/uploads/logo.png" works.
 */
async function loadImageDataUrl(
  src: string,
): Promise<{ dataUrl: string; width: number; height: number; format: "PNG" | "JPEG" } | null> {
  try {
    const url = src.startsWith("http") ? src : new URL(src, window.location.origin).toString();
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    // Probe dimensions so we can size the logo proportionally in the PDF.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const isJpeg = blob.type.includes("jpeg") || blob.type.includes("jpg");
    return {
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      format: isJpeg ? "JPEG" : "PNG",
    };
  } catch {
    return null;
  }
}

// ─── PDF export ──────────────────────────────────────────────────────────

export async function exportToPDF<TRow extends Record<string, unknown>>(
  payload: ReportPayload<TRow>,
  filename: string,
): Promise<void> {
  const { meta, columns, rows, totals } = payload;
  const generatedAt = meta.generatedAt ?? new Date();

  // Landscape A4 — most reports have many columns. Switch to portrait if a
  // particular report ever proves it needs that.
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 32;
  let cursorY = 36;

  // ─── Header: logo (left) + school name (right of logo) ────────────────
  const logo = meta.schoolLogoUrl ? await loadImageDataUrl(meta.schoolLogoUrl) : null;
  const headerStartX = marginX;
  let textStartX = headerStartX;

  if (logo) {
    const targetH = 40;
    const targetW = (logo.width / logo.height) * targetH;
    doc.addImage(logo.dataUrl, logo.format, headerStartX, cursorY, targetW, targetH);
    textStartX = headerStartX + targetW + 12;
  }

  // School name + title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(meta.schoolName, textStartX, cursorY + 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(meta.title, textStartX, cursorY + 30);

  // Right side: "Generated …"
  doc.setFontSize(8);
  doc.setTextColor(120);
  const stamp = `Generated: ${formatDateTime(generatedAt)}`;
  doc.text(stamp, pageWidth - marginX, cursorY + 14, { align: "right" });
  doc.setTextColor(0);

  cursorY += 50; // past the logo block

  // ─── Filters summary ──────────────────────────────────────────────────
  if (meta.filters && meta.filters.length > 0) {
    doc.setFontSize(8);
    doc.setTextColor(100);
    for (const line of meta.filters) {
      doc.text(line, marginX, cursorY);
      cursorY += 10;
    }
    doc.setTextColor(0);
    cursorY += 6;
  } else {
    cursorY += 4;
  }

  // ─── Table ────────────────────────────────────────────────────────────
  const head = [columns.map((c) => c.header)];
  const body = rows.map((row) =>
    columns.map((c) => formatCell(row[c.key], c.format)),
  );

  let foot: string[][] | undefined;
  if (totals) {
    // Build the TOTAL row — first column gets "TOTAL" label unless caller
    // already supplied one, then each subsequent column reads its key.
    const row = columns.map((c, i) => {
      const explicit = totals[c.key];
      if (explicit !== undefined) {
        return typeof explicit === "number" ? formatCell(explicit, c.format) : String(explicit);
      }
      return i === 0 ? "TOTAL" : "";
    });
    foot = [row];
  }

  // Auto-size font when there are many columns so we stop wrapping headers
  // character-by-character. A4 landscape minus margins ≈ 778pt — once we
  // get past ~10 columns the default 8pt font with a 4pt cell padding
  // forces the headers like "Amt.Campus card" to line-break into a
  // vertical stack. Tighten font + padding for wide reports.
  const tableFontSize = columns.length >= 12 ? 6.5 : columns.length >= 10 ? 7 : 8;
  const tableCellPadding = columns.length >= 12 ? 2 : columns.length >= 10 ? 2.5 : 4;

  autoTable(doc, {
    head,
    body,
    foot,
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    tableWidth: "auto",
    styles: { fontSize: tableFontSize, cellPadding: tableCellPadding, overflow: "linebreak" },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: 30,
      fontStyle: "bold",
      // Headers stay readable even at 6.5pt — give them an extra
      // half-point so the columns don't all collapse into 1-char width.
      fontSize: tableFontSize + 0.5,
      cellPadding: tableCellPadding,
    },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      columns.map((c, i) => [
        i,
        {
          halign: defaultAlign(c),
          ...(c.width ? { cellWidth: c.width } : {}),
        },
      ]),
    ),
    didDrawPage: (data) => {
      // Footer: page number, centered.
      const pageNo = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Page ${data.pageNumber} of ${pageNo}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 16,
        { align: "center" },
      );
      doc.setTextColor(0);
    },
  });

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

// ─── Excel export ────────────────────────────────────────────────────────

export function exportToExcel<TRow extends Record<string, unknown>>(
  payload: ReportPayload<TRow>,
  filename: string,
): void {
  const { meta, columns, rows, totals } = payload;
  const generatedAt = meta.generatedAt ?? new Date();

  // Build a sheet from an array of arrays — gives us the most control over
  // the header band above the data table.
  const aoa: (string | number)[][] = [];
  aoa.push([meta.schoolName]);
  aoa.push([meta.title]);
  aoa.push([`Generated: ${formatDateTime(generatedAt)}`]);
  if (meta.filters && meta.filters.length > 0) {
    aoa.push([`Filters: ${meta.filters.join(" · ")}`]);
  }
  aoa.push([]); // blank spacer
  aoa.push(columns.map((c) => c.header));

  for (const row of rows) {
    aoa.push(
      columns.map((c) => {
        const raw = row[c.key];
        // Keep numbers numeric in Excel so users can sum/filter them; format
        // only dates and text.
        if (c.format === "currency" || c.format === "number") {
          return typeof raw === "number" ? raw : raw == null ? "" : Number(raw) || 0;
        }
        return formatCell(raw, c.format);
      }),
    );
  }

  if (totals) {
    aoa.push(
      columns.map((c, i) => {
        const explicit = totals[c.key];
        if (explicit !== undefined) {
          if (typeof explicit === "number" && (c.format === "currency" || c.format === "number")) {
            return explicit;
          }
          return typeof explicit === "number" ? formatCell(explicit, c.format) : String(explicit);
        }
        return i === 0 ? "TOTAL" : "";
      }),
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths — fall back to a sensible default per format.
  ws["!cols"] = columns.map((c) => ({
    wch:
      c.width ??
      (c.format === "currency" || c.format === "number"
        ? 14
        : c.format === "date"
          ? 12
          : c.format === "datetime"
            ? 18
            : 22),
  }));

  // Apply number/currency formatting on the data cells so the value reads
  // "1,234.56" in Excel instead of plain 1234.56.
  const headerRowIndex = aoa.findIndex((r) => r === aoa[5]); // row 6 (0-indexed = 5)
  if (headerRowIndex >= 0) {
    const firstDataRow = headerRowIndex + 1;
    const totalRow = totals ? aoa.length - 1 : -1;
    for (let r = firstDataRow; r < aoa.length; r++) {
      // Skip the totals row for non-currency cells; still format currency cells.
      const isTotalRow = r === totalRow;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        if (col.format === "currency" || col.format === "number") {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell && typeof cell.v === "number") {
            cell.t = "n";
            cell.z = col.format === "currency" ? "#,##0.00" : "#,##0.##";
            if (isTotalRow) cell.s = { font: { bold: true } }; // requires styled writer
          }
        }
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// ─── Small convenience used by every report tab ──────────────────────────

/**
 * Build a "Date: A → B" filter line, leaving fields blank when unset. Skips
 * the line entirely if both A and B are empty.
 */
export function buildDateFilterLine(label: string, from?: string, to?: string): string | null {
  if (!from && !to) return null;
  if (from && to) return `${label}: ${from} → ${to}`;
  if (from) return `${label}: from ${from}`;
  return `${label}: until ${to}`;
}
