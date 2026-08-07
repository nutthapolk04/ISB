/**
 * Summary-row cell merging in the PDF exporter.
 *
 * With autotable's "grid" theme every emitted cell draws its own full border,
 * so a TOTAL row made of mostly-empty cells fragments into a row of little
 * boxes. This helper collapses runs of blanks so a summary line reads as one.
 *
 * The rule is deliberately "runs of two or more": a single empty cell in a grid
 * reads as a column with no value, which is correct and expected. It is only a
 * *run* that looks broken.
 */
import { describe, expect, it } from "vitest";
import { mergeEmptyCellRuns, type AutoTableCell } from "./reportExport";

const cell = (content: string, colSpan?: number): AutoTableCell =>
    colSpan === undefined ? { content } : { content, colSpan };

/** Compact view of a row: content plus effective span. */
const shape = (cells: AutoTableCell[]) =>
    cells.map((c) => (typeof c === "string" ? [c, 1] : [c.content, c.colSpan ?? 1]));

/** Total columns covered — must never change, or the row misaligns. */
const width = (cells: AutoTableCell[]) =>
    cells.reduce<number>((n, c) => n + (typeof c === "string" ? 1 : c.colSpan ?? 1), 0);

describe("mergeEmptyCellRuns", () => {
    it("merges an interior run — the Stock Card TOTAL shape", () => {
        // TOTAL | 10 | 2 | | | 400.00 | | |
        const out = mergeEmptyCellRuns([
            cell("TOTAL", 3), cell("10"), cell("2"), cell(""), cell(""),
            cell("400.00"), cell(""), cell(""),
        ]);
        expect(shape(out)).toEqual([
            ["TOTAL", 3], ["10", 1], ["2", 1], ["", 2], ["400.00", 1], ["", 2],
        ]);
    });

    it("merges the trailing run, the original behaviour", () => {
        const out = mergeEmptyCellRuns([cell("TOTAL", 2), cell("900"), cell(""), cell(""), cell("")]);
        expect(shape(out)).toEqual([["TOTAL", 2], ["900", 1], ["", 3]]);
    });

    it("leaves a lone blank alone", () => {
        // One gap between two values is a column with no value — correct as is.
        const out = mergeEmptyCellRuns([cell("TOTAL"), cell("1"), cell(""), cell("2")]);
        expect(shape(out)).toEqual([["TOTAL", 1], ["1", 1], ["", 1], ["2", 1]]);
    });

    it("never changes the total column count", () => {
        // The load-bearing invariant: a merged row that spans the wrong number
        // of columns shifts every cell and corrupts the whole table.
        const rows: AutoTableCell[][] = [
            [cell("A", 3), cell(""), cell(""), cell("9"), cell(""), cell("")],
            [cell(""), cell(""), cell(""), cell("")],
            [cell("x"), cell("y")],
            [cell("A", 2), cell(""), cell("1"), cell(""), cell(""), cell(""), cell("2")],
        ];
        for (const row of rows) {
            const before = width(row);
            expect(width(mergeEmptyCellRuns([...row]))).toBe(before);
        }
    });

    it("collapses an all-blank row into a single spanning cell", () => {
        const out = mergeEmptyCellRuns([cell(""), cell(""), cell(""), cell("")]);
        expect(shape(out)).toEqual([["", 4]]);
    });

    it("handles adjacent runs separated by one value", () => {
        const out = mergeEmptyCellRuns([
            cell(""), cell(""), cell("5"), cell(""), cell(""), cell(""),
        ]);
        expect(shape(out)).toEqual([["", 2], ["5", 1], ["", 3]]);
    });

    it("respects a colSpan already on a blank cell when summing the run", () => {
        const out = mergeEmptyCellRuns([cell("T"), cell("", 2), cell(""), cell("9")]);
        expect(shape(out)).toEqual([["T", 1], ["", 3], ["9", 1]]);
    });

    it("returns an empty row untouched", () => {
        expect(mergeEmptyCellRuns([])).toEqual([]);
    });
});
