import { describe, expect, it } from "vitest";
// @ts-expect-error Node is used only to load the committed binary fixture in tests.
import { readFileSync } from "node:fs";
import { readWorkbook, WorkbookReadException } from "./readWorkbook";

function fixtureBytes(): Uint8Array {
  return readFileSync(new URL("./fixtures/sparse-reader-fixtures.xlsx", import.meta.url));
}

describe("sparse SheetJS workbook reader", () => {
  it("preserves physical cells, cached formula results, merges, and visibility metadata", () => {
    const progress: number[] = [];
    const workbook = readWorkbook(fixtureBytes(), {
      fileName: "sparse-reader-fixtures.xlsx",
      onProgress: ({ populatedCellCount }) => progress.push(populatedCellCount)
    });

    expect(workbook.workbookType).toBe("xlsx");
    expect(workbook.sheetCount).toBe(2);
    expect(workbook.sheets.map((sheet) => [sheet.name, sheet.visibility])).toEqual([
      ["Primary", "visible"],
      ["Hidden Items", "hidden"]
    ]);

    const primary = workbook.sheets[0];
    expect(primary.range).toBe("A1:G9");
    expect(primary.hiddenRows).toEqual([6]);
    expect(primary.hiddenColumns).toEqual([7]);
    expect(primary.printAreas).toEqual(["'Primary'!$A$1:$G$9"]);
    expect(primary.merges.map((merge) => merge.range)).toEqual(["A1:G1", "B8:B9"]);

    const byAddress = new Map(primary.cells.map((cell) => [cell.address, cell]));
    expect(byAddress.get("A3")?.rawValue).toBe("0012");
    expect(byAddress.get("A4")?.rawValue).toBe(13);
    expect(byAddress.get("A4")?.formattedText).toBe("0013");
    expect(byAddress.get("A4")?.numberFormat).toBe("0000");
    expect(byAddress.get("F3")).toMatchObject({
      hasFormula: true,
      formula: "D3*E3",
      cachedValue: 200,
      formattedText: "$200.00"
    });
    expect(byAddress.get("F4")).toMatchObject({
      hasFormula: true,
      formula: "D4*E4",
      cachedValue: null
    });
    expect(byAddress.get("F5")).toMatchObject({
      type: "error",
      hasFormula: true,
      cachedValue: 7,
      formattedText: "#DIV/0!"
    });
    expect(byAddress.get("A1")?.mergeAnchor).toBe("A1");
    expect(byAddress.get("B8")?.mergeAnchor).toBe("B8");
    expect(progress.length).toBeGreaterThan(0);
  });

  it("reports unsupported extensions and non-ZIP input explicitly", () => {
    expect(() => readWorkbook(new Uint8Array([1, 2, 3]), {
      fileName: "estimate.xls"
    })).toThrowError(WorkbookReadException);
    try {
      readWorkbook(new Uint8Array([1, 2, 3]), { fileName: "estimate.xls" });
    } catch (error) {
      expect((error as WorkbookReadException).details.code).toBe("unsupported-extension");
    }

    try {
      readWorkbook(new Uint8Array([1, 2, 3]), { fileName: "estimate.xlsx" });
    } catch (error) {
      expect((error as WorkbookReadException).details.code).toBe("unsupported-format");
    }
  });

  it("enforces byte, worksheet, cell, timeout, and cancellation limits before state changes", () => {
    expect(() => readWorkbook(fixtureBytes(), {
      fileName: "estimate.xlsx",
      limits: { maxFileBytes: 1 }
    })).toThrow(/MiB/);
    expect(() => readWorkbook(fixtureBytes(), {
      fileName: "estimate.xlsx",
      limits: { maxWorksheets: 1 }
    })).toThrow(/worksheets/);
    expect(() => readWorkbook(fixtureBytes(), {
      fileName: "estimate.xlsx",
      limits: { maxPopulatedCells: 2 }
    })).toThrow(/populated cells/);
    expect(() => readWorkbook(fixtureBytes(), {
      fileName: "estimate.xlsx",
      limits: { maxParseMilliseconds: 0.1 }
    })).toThrow(/limit/);

    const controller = new AbortController();
    controller.abort();
    expect(() => readWorkbook(fixtureBytes(), {
      fileName: "estimate.xlsx",
      signal: controller.signal
    })).toThrow(/cancelled/i);
  });
});
