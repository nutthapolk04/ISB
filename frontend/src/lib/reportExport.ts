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

// ─── Thai-capable font loader ────────────────────────────────────────────
//
// jsPDF ships with Helvetica only, which has no Thai glyphs — Thai text
// gets transliterated into random Latin characters in the output. Register
// Sarabun (Thai + Latin) from /public/fonts before the first render. The
// TTF is fetched lazily on first call and cached for the lifetime of the
// page so subsequent exports skip the network round-trip.
const FONT_NAME = "Sarabun";
const FONT_FILES: Record<"normal" | "bold", { vfsName: string; url: string }> = {
  normal: { vfsName: "Sarabun-Regular.ttf", url: "/fonts/sarabun-regular.ttf" },
  bold:   { vfsName: "Sarabun-Bold.ttf",    url: "/fonts/sarabun-bold.ttf"    },
};
const fontCache: Partial<Record<"normal" | "bold", string>> = {};

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  // btoa needs a binary string — feed it one byte at a time so we never
  // hit "Maximum call stack size exceeded" on the 130KB file.
  let s = "";
  const u8 = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

async function ensureThaiFont(doc: jsPDF): Promise<void> {
  for (const weight of ["normal", "bold"] as const) {
    const f = FONT_FILES[weight];
    if (!fontCache[weight]) {
      try {
        fontCache[weight] = await fetchFontBase64(f.url);
      } catch (e) {
        // Network failed — caller falls back to helvetica. Log so we can
        // diagnose deploy issues without crashing the export.
        console.warn("Sarabun fetch failed, falling back to Helvetica:", e);
        return;
      }
    }
    doc.addFileToVFS(f.vfsName, fontCache[weight]!);
    doc.addFont(f.vfsName, FONT_NAME, weight);
  }
  doc.setFont(FONT_NAME, "normal");
}

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
  /**
   * Report ID shown in the PDF/Excel footer. Auto-generated as
   * "RPT-YYYYMMDD-HHmmss-XXXX" when omitted.
   */
  reportId?: string;
  /** Name of the user who ran the report. Rendered as "· By: <name>" next to Report ID. */
  runByName?: string;
}

/** Generate a sequential Report ID: ISB001, ISB002, … Counter persisted in localStorage. */
export function generateReportId(prefix = "ISB"): string {
  const STORAGE_KEY = "isb_report_id_counter";
  const current = parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10);
  const next = current + 1;
  localStorage.setItem(STORAGE_KEY, String(next));
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/**
 * Sentinel key used on a row object to flag it as a full-width "section"
 * header (e.g. a product code label in a multi-section stockcard). When
 * present, the renderer ignores `columns` for that row and instead renders
 * a single merged cell spanning every column. Other rows are unaffected.
 */
export const SECTION_KEY = "__section" as const;

/**
 * Optional sentinel key to mark a body row as a summary/subtotal so the PDF
 * renderer can give it visual weight (bold + tinted background). Two levels:
 *   - "subtotal": light grey background, bold text. Used for Closing Balance.
 *   - "total":    darker grey background, bold text. Used for per-section TOTAL.
 * Rows without this key render as plain data rows.
 */
export const EMPHASIS_KEY = "__emphasis" as const;
export type RowEmphasis = "subtotal" | "total";

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

/** A row carrying a SECTION_KEY value is rendered as a merged-cell header. */
function sectionLabel(row: Record<string, unknown>): string | null {
  const v = row[SECTION_KEY];
  return typeof v === "string" ? v : null;
}

function rowEmphasis(row: Record<string, unknown>): RowEmphasis | null {
  const v = row[EMPHASIS_KEY];
  return v === "subtotal" || v === "total" ? v : null;
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
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
): Promise<{ dataUrl: string; width: number; height: number; format: "PNG" | "JPEG" | "WEBP" } | null> {
  try {
    // If the logo is already stored as a Data URL (base64), don't try to
    // resolve it as a relative URL — just embed it directly.
    if (src.startsWith("data:")) {
      const mime = src.slice(5, src.indexOf(";")).toLowerCase();
      const format =
        mime.includes("jpeg") || mime.includes("jpg")
          ? "JPEG"
          : mime.includes("webp")
            ? "WEBP"
            : mime.includes("png")
              ? "PNG"
              : null;
      if (!format) return null;

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = src;
      });

      return {
        dataUrl: src,
        width: img.naturalWidth,
        height: img.naturalHeight,
        format,
      };
    }

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
    // Admin can upload any browser-renderable image type (accept="image/*"),
    // but jsPDF's addImage only decodes a handful of raster formats — map
    // what we can and let the caller skip the logo for anything else (e.g.
    // SVG, GIF, HEIC) rather than mislabeling it and having addImage throw.
    const format = blob.type.includes("jpeg") || blob.type.includes("jpg")
      ? "JPEG"
      : blob.type.includes("webp")
        ? "WEBP"
        : blob.type.includes("png")
          ? "PNG"
          : null;
    if (!format) return null;
    return {
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      format,
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
  const reportId = meta.reportId ?? generateReportId();
  const generatedAt = meta.generatedAt ?? new Date();
  const printDateTime = formatDateTime(generatedAt);

  // Landscape A4 — most reports have many columns. Switch to portrait if a
  // particular report ever proves it needs that.
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 32;
  let cursorY = 36;

  // Register Sarabun before drawing anything so headers / table can render
  // Thai. Falls back to Helvetica silently if the font fetch fails.
  await ensureThaiFont(doc);
  const fontFamily = doc.getFontList()[FONT_NAME] ? FONT_NAME : "helvetica";

  // ─── Top meta bar: Report ID (left) + Printed (right) ───────────────
  doc.setFont(fontFamily, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(0);
  const reportIdLine = meta.runByName
    ? `Report ID: ${reportId} · By: ${meta.runByName}`
    : `Report ID: ${reportId}`;
  doc.text(reportIdLine, marginX, 20, { align: "left" });
  doc.text(`Printed: ${printDateTime}`, pageWidth - marginX, 20, { align: "right" });
  doc.setTextColor(0);

  // ─── Header: logo (left) + school name & title (left, next to logo) ──
  const logo = meta.schoolLogoUrl ? await loadImageDataUrl(meta.schoolLogoUrl) : null;

  let textStartX = marginX;
  if (logo) {
    try {
      const targetH = 52;           // bigger logo
      const targetW = (logo.width / logo.height) * targetH;
      doc.addImage(logo.dataUrl, logo.format, marginX, cursorY, targetW, targetH);
      textStartX = marginX + targetW + 10;
    } catch (e) {
      // A malformed/corrupt image must not take down the whole export —
      // fall back to the no-logo layout (textStartX stays at marginX).
      console.warn("PDF logo embed failed, continuing without it:", e);
    }
  }

  // School name + title — left-aligned, right of logo
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(14);
  doc.text(meta.schoolName, textStartX, cursorY + 16, { align: "left" });

  doc.setFont(fontFamily, "normal");
  doc.setFontSize(11);
  doc.text(meta.title, textStartX, cursorY + 32, { align: "left" });

  cursorY += 58; // past the (taller) logo block

  // ─── Filters summary ──────────────────────────────────────────────────
  if (meta.filters && meta.filters.length > 0) {
    doc.setFontSize(8);
    doc.setTextColor(0);
    for (const line of meta.filters) {
      doc.text(line, pageWidth - marginX, cursorY, { align: "right" });
      cursorY += 10;
    }
    doc.setTextColor(0);
    cursorY += 6;
  } else {
    cursorY += 4;
  }

  // ─── Table ────────────────────────────────────────────────────────────
  // Header cells are explicit objects so we can center-align them
  // independently of the body column alignment (which stays right-aligned
  // for numeric and left-aligned for text). columnStyles.halign normally
  // wins over headStyles.halign, so we declare the override per-cell.
  const head = [
    columns.map((c) => ({
      content: c.header,
      styles: { halign: "center" as const },
    })),
  ];
  // Rows are either plain arrays of cell strings OR — for section markers —
  // a single merged cell that spans every column. autoTable accepts both
  // shapes inside the same body array.
  type AutoTableCell = string | {
    content: string;
    colSpan?: number;
    styles?: Record<string, unknown>;
  };
  const body: AutoTableCell[][] = rows.map((row) => {
    const label = sectionLabel(row);
    if (label !== null) {
      return [
        {
          content: label,
          colSpan: columns.length,
          styles: {
            fontStyle: "bold",
            fillColor: [226, 232, 240],
            textColor: 15,
            halign: "left",
          },
        },
      ];
    }

    // Emphasis styling for subtotal / total rows so they stand out from
    // the plain movement rows above them. Cell content stays right/left
    // aligned per columnStyles — we only override fill + font weight.
    const emphasis = rowEmphasis(row);
    if (emphasis !== null) {
      const fill: [number, number, number] =
        emphasis === "total" ? [203, 213, 225] : [241, 245, 249];
      return columns.map((c) => ({
        content: formatCell(row[c.key], c.format),
        styles: {
          fontStyle: "bold",
          fillColor: fill,
        },
      }));
    }

    return columns.map((c) => formatCell(row[c.key], c.format));
  });

  let foot: AutoTableCell[][] | undefined;
  if (totals) {
    // Build the TOTAL row.
    //
    // The label "TOTAL" used to live in column 0 (often "Seq", which is
    // narrow), so it line-broke to "TOTA L". Instead, merge every leading
    // text column with no total value into one wide right-aligned cell so
    // the label has room to breathe — then start emitting numeric totals
    // from the first column that actually has a value.
    const firstTotalIdx = columns.findIndex((c) => totals[c.key] !== undefined);
    const labelSpan = firstTotalIdx > 0 ? firstTotalIdx : 1;

    const cells: AutoTableCell[] = [
      {
        content: "TOTAL",
        colSpan: labelSpan,
        styles: { halign: "right", fontStyle: "bold" },
      },
    ];
    for (let i = labelSpan; i < columns.length; i += 1) {
      const c = columns[i];
      const explicit = totals[c.key];
      const align = defaultAlign(c);
      if (explicit !== undefined) {
        cells.push({
          content: typeof explicit === "number" ? formatCell(explicit, c.format) : String(explicit),
          styles: { halign: align },
        });
      } else {
        cells.push({ content: "", styles: { halign: align } });
      }
    }
    foot = [cells];
  }

  // Auto-size font when there are many columns so we stop wrapping headers
  // character-by-character. A4 landscape minus margins ≈ 778pt — once we
  // get past ~10 columns the default 8pt font with a 4pt cell padding
  // forces the headers like "Amt.Campus card" to line-break into a
  // vertical stack. Tighten font + padding for wide reports.
  const tableFontSize = columns.length >= 12 ? 7.5 : columns.length >= 10 ? 9 : 10;
  const tableCellPadding = columns.length >= 12 ? 2.5 : columns.length >= 10 ? 3.5 : 4;

  // Stretch the table to fill the page width. Sum the requested column
  // widths and scale them proportionally so the layout keeps its relative
  // sizing while consuming all available horizontal space.
  const usableWidth = pageWidth - 2 * marginX;
  const totalSpecWidth = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const widthScale = totalSpecWidth > 0 ? usableWidth / totalSpecWidth : 1;

  autoTable(doc, {
    head,
    body,
    foot,
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    tableWidth: usableWidth,
    theme: "grid",
    styles: {
      font: fontFamily,
      fontSize: tableFontSize,
      cellPadding: tableCellPadding,
      overflow: "linebreak",
      lineColor: [150, 150, 150],
      lineWidth: 0.4,
    },
    headStyles: {
      font: fontFamily,
      fillColor: [241, 245, 249],
      textColor: 0,
      fontStyle: "bold",
      // Headers stay readable even at 6.5pt — give them an extra
      // half-point so the columns don't all collapse into 1-char width.
      fontSize: tableFontSize + 0.5,
      cellPadding: tableCellPadding,
      lineColor: [150, 150, 150],
      lineWidth: 0.4,
    },
    footStyles: {
      font: fontFamily,
      fillColor: [241, 245, 249],
      textColor: 30,
      fontStyle: "bold",
      lineColor: [150, 150, 150],
      lineWidth: 0.4,
    },
    columnStyles: Object.fromEntries(
      columns.map((c, i) => [
        i,
        {
          halign: defaultAlign(c),
          ...(c.width ? { cellWidth: c.width * widthScale } : {}),
        },
      ]),
    ),
  });

  // Draw footer on every page after autoTable has finished laying out all rows.
  // This is more reliable than didDrawPage because autoTable's total page count
  // is only known after the call returns.
  const totalPages = doc.getNumberOfPages();
  const footerY = doc.internal.pageSize.getHeight() - 16;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(7.5);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth / 2, footerY, { align: "center" });
  }

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

// ─── Excel export ────────────────────────────────────────────────────────

export function exportToExcel<TRow extends Record<string, unknown>>(
  payload: ReportPayload<TRow>,
  filename: string,
): void {
  const { meta, columns, rows, totals } = payload;
  const generatedAt = meta.generatedAt ?? new Date();
  const reportId = meta.reportId ?? generateReportId();

  // Build a sheet from an array of arrays — gives us the most control over
  // the header band above the data table.
  const aoa: (string | number)[][] = [];
  aoa.push([meta.schoolName]);
  aoa.push([meta.title]);
  aoa.push([
    meta.runByName ? `Report ID: ${reportId} · By: ${meta.runByName}` : `Report ID: ${reportId}`,
  ]);
  aoa.push([`Printed: ${formatDateTime(generatedAt)}`]);
  if (meta.filters && meta.filters.length > 0) {
    aoa.push([`Filters: ${meta.filters.join(" · ")}`]);
  }
  aoa.push([]); // blank spacer
  aoa.push(columns.map((c) => c.header));

  // Track row indices that need a merge across all columns (section headers)
  // so we can apply ws["!merges"] after the sheet exists.
  const sectionMergeRows: number[] = [];

  for (const row of rows) {
    const label = sectionLabel(row);
    if (label !== null) {
      // Put the label in column 0 and pad the rest with "" so the row aligns
      // with the column count, then queue a merge for it.
      const padded: (string | number)[] = [label];
      for (let i = 1; i < columns.length; i++) padded.push("");
      sectionMergeRows.push(aoa.length);
      aoa.push(padded);
      continue;
    }
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

  // Merge section-header rows across every column so the label visually
  // spans the table the same way it does in the PDF.
  if (sectionMergeRows.length > 0) {
    ws["!merges"] = sectionMergeRows.map((r) => ({
      s: { r, c: 0 },
      e: { r, c: columns.length - 1 },
    }));
  }

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
  // Locate the column-header row dynamically — it's the first row that has
  // as many cells as there are columns (i.e. the actual column names row).
  const headerRowIndex = aoa.findIndex((r) => r.length === columns.length && r[0] === columns[0].header);
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

  const fname = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
