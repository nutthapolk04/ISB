import { describe, expect, it } from "vitest";
import { SECTION_KEY, EMPHASIS_KEY } from "@/lib/reportExport";
import {
    buildReceiveStockColumns,
    buildReceiveStockGroupedRows,
    sumCostPerUnit,
    type ReceiveStockRow,
} from "./receiveStockExport";

function row(overrides: Partial<ReceiveStockRow>): ReceiveStockRow {
    return {
        seq: 1,
        date: "2026-08-11T09:20:00Z",
        received_date: "2026-08-11",
        product_code: "BHGIF0023",
        product_name: "ADVENT CALENDAR",
        shop_id: "store_booster",
        shop_name: "Booster Shop",
        quantity: 10,
        cost_per_unit: 100,
        total_cost: 1000,
        po_number: null,
        invoice_number: "2026081658",
        note: null,
        created_by_name: "B01 Manager",
        ...overrides,
    };
}

describe("buildReceiveStockGroupedRows", () => {
    it("groups rows under one section header per invoice, in first-seen order", () => {
        const rows = [
            row({ seq: 1, invoice_number: "INV-A" }),
            row({ seq: 2, invoice_number: "INV-B" }),
            row({ seq: 3, invoice_number: "INV-A" }), // interleaved — still joins INV-A's group
        ];
        const out = buildReceiveStockGroupedRows(rows);

        const sectionLabels = out.filter((r) => SECTION_KEY in r).map((r) => r[SECTION_KEY]);
        expect(sectionLabels).toEqual(["Invoice No.  INV-A", "Invoice No.  INV-B"]);

        // INV-A's two data rows plus its TOTAL row all appear before INV-B starts.
        const invAIndex = out.findIndex((r) => r[SECTION_KEY] === "Invoice No.  INV-A");
        const invBIndex = out.findIndex((r) => r[SECTION_KEY] === "Invoice No.  INV-B");
        const seqInBetween = out
            .slice(invAIndex + 1, invBIndex)
            .filter((r) => "seq" in r)
            .map((r) => r.seq);
        expect(seqInBetween).toEqual([1, 3]);
    });

    it("sums quantity, cost_per_unit and total_cost per invoice into a TOTAL row", () => {
        const rows = [
            row({ invoice_number: "INV-A", quantity: 100, cost_per_unit: 100, total_cost: 10000 }),
            row({ invoice_number: "INV-A", quantity: 10, cost_per_unit: 500, total_cost: 5000 }),
            row({ invoice_number: "INV-A", quantity: 10, cost_per_unit: 50, total_cost: 500 }),
        ];
        const out = buildReceiveStockGroupedRows(rows);
        const totalRow = out.find((r) => r[EMPHASIS_KEY] === "total");
        expect(totalRow).toMatchObject({
            product_name: "TOTAL",
            quantity: 120,
            cost_per_unit: 650,
            total_cost: 15500,
        });
    });

    it("buckets rows with no invoice number under a single 'No Invoice No.' group instead of splitting them", () => {
        const rows = [
            row({ invoice_number: null, quantity: 1, total_cost: 100 }),
            row({ invoice_number: null, quantity: 2, total_cost: 200 }),
        ];
        const out = buildReceiveStockGroupedRows(rows);
        const sectionLabels = out.filter((r) => SECTION_KEY in r).map((r) => r[SECTION_KEY]);
        expect(sectionLabels).toEqual(["No Invoice No."]);
        const totalRow = out.find((r) => r[EMPHASIS_KEY] === "total");
        expect(totalRow).toMatchObject({ quantity: 3, total_cost: 300 });
    });

    it("carries invoice_number, po_number and note through to each data row for the per-row columns", () => {
        const out = buildReceiveStockGroupedRows([
            row({ invoice_number: "INV-A", po_number: "PO001", note: "test" }),
        ]);
        const dataRow = out.find((r) => "seq" in r);
        expect(dataRow).toMatchObject({ invoice_number: "INV-A", po_number: "PO001", note: "test" });
    });
});

describe("sumCostPerUnit", () => {
    it("sums cost_per_unit across every row, for the grand-total footer", () => {
        const rows = [
            row({ cost_per_unit: 100 }),
            row({ cost_per_unit: 20 }),
            row({ cost_per_unit: 1000 }),
        ];
        expect(sumCostPerUnit(rows)).toBe(1120);
    });
});

describe("buildReceiveStockColumns", () => {
    it("omits the Shop column by default (shop identity shown once as a header line instead)", () => {
        const columns = buildReceiveStockColumns(false);
        expect(columns.map((c) => c.key)).not.toContain("shop_name");
    });

    it("includes the Shop column when the export spans multiple shops", () => {
        const columns = buildReceiveStockColumns(true);
        expect(columns.map((c) => c.key)).toContain("shop_name");
    });

    it("places Invoice No. right after Date/Time, matching the printed layout", () => {
        const keys = buildReceiveStockColumns(false).map((c) => c.key);
        expect(keys.indexOf("invoice_number")).toBe(keys.indexOf("date") + 1);
    });
});
