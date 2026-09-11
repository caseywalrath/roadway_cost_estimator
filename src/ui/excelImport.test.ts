// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AgencyItemRecord, StateConfig } from "../data/schema";
import type { ExcelImportWorkerResponse, ExcelWorkbookSnapshot } from "../projects/excelImport/types";
import { ExcelImportController, type ExcelImportReadyDraft } from "./excelImportController";
import { buildExcelImportReportCsv } from "./excelImportReport";
import { renderExcelImportWizard } from "./renderExcelImport";

class FakeWorker {
  onmessage: ((event: MessageEvent<ExcelImportWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor(private readonly workbook: ExcelWorkbookSnapshot, private readonly delay = 0) {}

  postMessage(message: { requestId: string }): void {
    window.setTimeout(() => {
      if (this.terminated) return;
      this.onmessage?.({ data: { type: "success", requestId: message.requestId, workbook: this.workbook } } as MessageEvent<ExcelImportWorkerResponse>);
    }, this.delay);
  }

  terminate(): void { this.terminated = true; }
}

const state = {
  code: "NE",
  name: "Nebraska",
  defaultAgencyId: "ne_ndot",
  defaultAgencyName: "NDOT",
  divisionLabel: "Division",
  sectionLabel: "Section",
  sectionPrefixLength: 3,
  capabilities: { districtFilter: false, engineerEstimate: false, bidderDetail: false, periodPriceHistory: false },
  sourceTypeLabels: {},
  files: { sources: "", lettings: "", contracts: "", contractProjects: "", contractItems: "", bids: "", agencyItems: "", agencyItemVersions: "", itemTaxonomy: "", itemMappings: "", observations: "" }
} satisfies StateConfig;

const agencyItem = {
  agencyItemId: "ne:0012",
  state: "NE",
  agencyId: "ne_ndot",
  agencyName: "NDOT",
  itemCode: "0012",
  currentVersionId: "v1",
  itemStatus: "current",
  canonicalItemId: "",
  officialDescription: "Mobilization",
  officialAbbreviatedDescription: "",
  officialUnit: "EA",
  specReferenceCode: "",
  agency: "NDOT"
} satisfies AgencyItemRecord;

function workbook(): ExcelWorkbookSnapshot {
  const values = [
    ["Item Code", "Description", "Unit", "Quantity", "Unit Cost", "Total"],
    ["0012", "Mobilization", "EA", 2, 100, 200],
    ["CUSTOM", "Temporary traffic control", "LS", 1, 75, 75]
  ];
  const cells = values.flatMap((row, rowIndex) => row.map((value, columnIndex) => ({
    address: `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`,
    rowNumber: rowIndex + 1,
    columnNumber: columnIndex + 1,
    columnLabel: String.fromCharCode(65 + columnIndex),
    type: typeof value === "number" ? "number" as const : "string" as const,
    rawValue: value,
    formattedText: String(value),
    formula: null,
    hasFormula: false,
    cachedValue: null,
    numberFormat: null,
    mergeAnchor: null
  })));
  return { fileName: "synthetic.xlsx", workbookType: "xlsx", sheets: [{ name: "Estimate", visibility: "visible", range: "A1:F3", populatedCellCount: cells.length, rowCount: 3, columnCount: 6, cells, merges: [], hiddenRows: [], hiddenColumns: [], printAreas: [] }], sheetCount: 1, populatedCellCount: cells.length, hasDefinedNames: false };
}

function file(): File {
  const value = new File(["synthetic"], "synthetic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(value, "arrayBuffer", { value: async () => new TextEncoder().encode("PK synthetic").buffer });
  return value;
}

function workbookWithValue(rowNumber: number, columnNumber: number, value: string | number): ExcelWorkbookSnapshot {
  const base = workbook();
  const sheet = base.sheets[0]!;
  const cells = sheet.cells.map((cell) => cell.rowNumber === rowNumber && cell.columnNumber === columnNumber
    ? { ...cell, rawValue: value, formattedText: String(value), type: typeof value === "number" ? "number" as const : "string" as const }
    : cell);
  return { ...base, sheets: [{ ...sheet, cells }] };
}

function workbookWithDescriptionConflicts(): ExcelWorkbookSnapshot {
  const base = workbookWithValue(2, 2, "Mobilization and setup");
  const sheet = base.sheets[0]!;
  const sourceRow = sheet.cells.filter((cell) => cell.rowNumber === 2);
  const additionalRows = [4, 5].flatMap((rowNumber) => sourceRow.map((cell) => ({
    ...cell,
    address: `${cell.columnLabel}${rowNumber}`,
    rowNumber,
    rawValue: cell.columnNumber === 2 ? `Mobilization alternate ${rowNumber}` : cell.rawValue,
    formattedText: cell.columnNumber === 2 ? `Mobilization alternate ${rowNumber}` : cell.formattedText
  })));
  return {
    ...base,
    sheets: [{ ...sheet, range: "A1:F5", rowCount: 5, populatedCellCount: sheet.cells.length + additionalRows.length, cells: [...sheet.cells, ...additionalRows] }],
    populatedCellCount: base.populatedCellCount + additionalRows.length
  };
}

describe("Excel import wizard", () => {
  it("presents a file-first screen with user-facing import steps", () => {
    const controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: () => undefined,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbook())
    });

    const markup = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
    expect(markup).toContain("Excel file");
    expect(markup).toContain("Browse files");
    expect(markup).not.toContain("Choose an Excel workbook");
    expect(markup).not.toContain("Choose Excel file");
    expect(markup).toContain("Next: Choose data");
    expect(markup).toContain("Add items to Demo Project");
    expect(markup).toContain("Item codes will be checked against Nebraska items.");
    expect(markup).not.toContain("Catalog destination");
    expect(markup).not.toContain("Choose worksheet");
  });

  it("enables completed steps without enabling future steps", async () => {
    const root = document.createElement("div");
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbook())
    });

    controller.open();
    expect(root.querySelector<HTMLButtonElement>('[data-excel-import-step="sheet"]')?.disabled).toBe(true);
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    const fileStep = root.querySelector<HTMLButtonElement>('[data-excel-import-step="file"]');
    expect(fileStep?.disabled).toBe(false);
    fileStep?.click();
    expect(controller.viewModel.stage).toBe("file");
  });

  it("shows the automatic data selection, preview, and optional range controls", async () => {
    const root = document.createElement("div");
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbook())
    });

    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const projectName = root.querySelector<HTMLInputElement>("[data-excel-import-new-project-name]")!;
    projectName.value = "Demo Project";
    projectName.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();

    expect(root.textContent).toContain("Detected item table");
    expect(root.textContent).toContain("3 spreadsheet rows in A1:F3");
    expect(root.textContent).toContain("Change data range");
    expect(root.textContent).not.toContain("Primary data area");
    expect(root.textContent).not.toContain("Apply range");
    expect(root.querySelector('[data-excel-import-region]')).toBeNull();

    const details = root.querySelector<HTMLDetailsElement>(".excel-import-range-settings");
    details!.open = true;
    root.querySelector<HTMLInputElement>("[data-excel-import-start-cell]")!.value = "A1";
    root.querySelector<HTMLInputElement>("[data-excel-import-end-cell]")!.value = "E3";
    root.querySelector<HTMLButtonElement>("[data-excel-import-apply-range]")?.click();
    expect(controller.viewModel.selection?.endColumn).toBe(5);
    expect(controller.viewModel.mapping?.columns.itemCode).toBe(1);
  });

  it("shows six primary mappings and keeps secondary import behavior in advanced settings", async () => {
    const root = document.createElement("div");
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbook())
    });

    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();

    expect(root.textContent).toContain("Match spreadsheet columns");
    expect(root.textContent).toContain("Example values");
    expect(root.textContent).toContain("Advanced import settings");
    expect(root.textContent).toContain("Assign imported items to Construction Costs");
    expect(root.textContent).not.toContain("Group source");
    expect(root.textContent).not.toContain("Cost category source");
    expect([...root.querySelectorAll<HTMLSelectElement>("[data-excel-import-field]")].map((select) => select.dataset.excelImportField)).toEqual([
      "itemCode", "description", "unit", "quantity", "unitCost", "notes", "sourceTotal"
    ]);
    expect(controller.viewModel.mapping?.categorySource).toBe("construction");

    const advanced = root.querySelector<HTMLDetailsElement>("[data-excel-import-advanced-settings]")!;
    advanced.open = true;
    advanced.dispatchEvent(new Event("toggle"));
    const groupSource = root.querySelector<HTMLSelectElement>("[data-excel-import-group-source]")!;
    groupSource.value = "mapped";
    groupSource.dispatchEvent(new Event("change"));
    expect(root.querySelector<HTMLDetailsElement>("[data-excel-import-advanced-settings]")?.open).toBe(true);

    root.querySelector<HTMLSelectElement>('[data-excel-import-field="itemCode"]')!.value = "";
    root.querySelector<HTMLSelectElement>('[data-excel-import-field="itemCode"]')!.dispatchEvent(new Event("change"));
    root.querySelector<HTMLSelectElement>('[data-excel-import-field="description"]')!.value = "";
    root.querySelector<HTMLSelectElement>('[data-excel-import-field="description"]')!.dispatchEvent(new Event("change"));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();
    expect(root.textContent).toContain("Map Item Code or Description before reviewing items.");
  });

  it("maps an unlabeled leading estimate column as Description when the remaining headers are recognized", async () => {
    const base = workbook().sheets[0]!;
    const headerValues = ["", "Units", "Qty", "Unit Price", "Total"];
    const dataValues = [
      ["Clearing and grubbing", "LS", 1, 100, 100],
      ["Temporary traffic control", "LS", 1, 75, 75]
    ];
    const cells = base.cells.filter((cell) => cell.columnNumber <= 5).map((cell) => {
      const value = cell.rowNumber === 1 ? headerValues[cell.columnNumber - 1] : dataValues[cell.rowNumber - 2]?.[cell.columnNumber - 1];
      return { ...cell, rawValue: value ?? "", formattedText: String(value ?? ""), type: typeof value === "number" ? "number" as const : "string" as const };
    });
    const estimate = { ...base, range: "A1:E3", columnCount: 5, populatedCellCount: cells.length, cells };
    const compactEstimate = { ...workbook(), sheets: [estimate], populatedCellCount: cells.length };
    const controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: () => undefined,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(compactEstimate)
    });

    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(controller.viewModel.mapping?.columns).toMatchObject({ description: 1, unit: 2, quantity: 3, unitCost: 4, sourceTotal: 5 });
  });

  it("uses user-facing match text and only presents choices relevant to a conflict", async () => {
    const root = document.createElement("div");
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbookWithValue(2, 2, "Mobilization and setup"))
    });

    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();

    expect(controller.viewModel.reviewFilter).toBe("needs-review");
    expect(root.textContent).toContain("Description differs — choose which to use");
    expect(root.textContent).toContain("Spreadsheet");
    expect(root.textContent).toContain("Official");
    expect(root.textContent).toContain("Use official description");
    expect(root.textContent).toContain("Keep spreadsheet description as custom item");
    expect(root.textContent).toContain("Previous 50");
    expect(root.textContent).toContain("Next 50");
    expect(root.textContent).not.toContain("Classification");
    expect(root.textContent).not.toContain("catalog-ready");
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(true);

    const choice = root.querySelector<HTMLSelectElement>("[data-excel-import-row-action]")!;
    choice.value = "use-catalog-description";
    choice.dispatchEvent(new Event("change"));
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(false);
  });

  it("resolves a selected filtered subset in bulk while preserving row-level choices", async () => {
    const root = document.createElement("div");
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbookWithDescriptionConflicts())
    });

    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();

    expect(root.textContent).toContain("Resolve selected items");
    expect(root.textContent).toContain("Select all filtered (3)");
    root.querySelector<HTMLInputElement>("[data-excel-import-review-row]")?.click();
    expect(controller.viewModel.selectedReviewRowIds).toHaveLength(1);
    const bulkAction = root.querySelector<HTMLSelectElement>("[data-excel-import-bulk-action]")!;
    expect(bulkAction.textContent).toContain("Use official description");
    bulkAction.value = "use-catalog-description";
    root.querySelector<HTMLButtonElement>("[data-excel-import-apply-bulk-action]")?.click();

    expect(Object.values(controller.viewModel.decisions).map((decision) => decision.action)).toEqual(["use-catalog-description"]);
    expect(root.textContent).toContain("Resolve 2 items to continue.");
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>("[data-excel-import-select-filtered]")?.click();
    expect(controller.viewModel.selectedReviewRowIds).toHaveLength(2);
    const remainingBulkAction = root.querySelector<HTMLSelectElement>("[data-excel-import-bulk-action]")!;
    remainingBulkAction.value = "use-catalog-description";
    root.querySelector<HTMLButtonElement>("[data-excel-import-apply-bulk-action]")?.click();

    expect(Object.values(controller.viewModel.decisions).map((decision) => decision.action)).toEqual([
      "use-catalog-description", "use-catalog-description", "use-catalog-description"
    ]);
    expect(controller.viewModel.selectedReviewRowIds).toEqual([]);
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(false);
  });

  it("prefers a visible worksheet with recognized estimate headers", async () => {
    const estimate = workbook().sheets[0]!;
    const readme = {
      ...estimate,
      name: "Read me",
      range: "A1:B2",
      rowCount: 2,
      columnCount: 2,
      cells: estimate.cells.slice(0, 2).map((cell, index) => ({
        ...cell,
        address: `${String.fromCharCode(65 + index)}1`,
        rowNumber: 1,
        columnNumber: index + 1,
        columnLabel: String.fromCharCode(65 + index),
        rawValue: index === 0 ? "Instructions" : "Use Estimate",
        formattedText: index === 0 ? "Instructions" : "Use Estimate"
      })),
      populatedCellCount: 2
    };
    const selectedWorkbook = { ...workbook(), sheets: [readme, estimate], sheetCount: 2 };
    const controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: () => undefined,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(selectedWorkbook)
    });

    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    // The file stage stays in place until the user chooses the next step.
    expect(controller.viewModel.stage).toBe("file");
    expect(controller.viewModel.selectedSheetName).toBe("Estimate");
  });

  it("shows a concrete confirmation and completes a synthetic import", async () => {
    const root = document.createElement("div");
    let ready = 0;
    let commits = 0;
    let draft: ExcelImportReadyDraft | null = null;
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => undefined,
      onReady: (value) => { ready += 1; draft = value; },
      onCommit: async () => { commits += 1; },
      workerFactory: () => new FakeWorker(workbook())
    });
    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const projectName = root.querySelector<HTMLInputElement>("[data-excel-import-new-project-name]")!;
    projectName.value = "Demo Project";
    projectName.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    expect(controller.viewModel.stage).toBe("sheet");
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();
    expect(controller.viewModel.stage).toBe("mapping");
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();
    expect(controller.viewModel.stage).toBe("review");
    expect(controller.viewModel.rows.length).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>('[data-excel-import-finish]')?.click();
    expect(controller.viewModel.stage).toBe("result");
    expect(root.textContent).toContain("2 items will be added to Demo Project.");
    expect(root.textContent).toContain("A new Project will be created with these items.");
    expect(root.textContent).toContain("Construction Costs");
    expect(root.textContent).toContain("Import 2 items");
    expect(root.textContent).not.toContain("Commit import");
    expect(root.textContent).not.toContain("Close preview");
    expect(root.textContent).not.toContain("No Project data is written during preview");
    expect(ready).toBe(1);
    expect(draft).not.toBeNull();
    expect(buildExcelImportReportCsv(draft!)).toContain("file,sheet,original row");
    expect(buildExcelImportReportCsv({
      ...draft!,
      rows: draft!.rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, description: "=SUM(A1)" } } : row)
    })).toContain("'=SUM(A1)");
    root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")?.click();
    root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(commits).toBe(1);
    expect(controller.viewModel.commitStatus).toBe("committed");
    expect(root.textContent).toContain("2 items were added to Demo Project.");
    expect(root.querySelectorAll("[data-excel-import-cancel]")).toHaveLength(1);
    expect(root.querySelector("[data-excel-import-download-report]")).toBeNull();

  });

  it("cancels the worker without producing a ready draft", async () => {
    const root = document.createElement("div");
    let closed = 0;
    let ready = 0;
    let worker: FakeWorker | undefined;
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], null);
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => { closed += 1; },
      onReady: () => { ready += 1; },
      workerFactory: () => (worker = new FakeWorker(workbook(), 10))
    });
    controller.open();
    const pending = controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    controller.cancel();
    await pending;
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(closed).toBe(1);
    expect(ready).toBe(0);
    expect((worker as FakeWorker | undefined)?.terminated).toBe(true);
  });

  it("retains the prepared draft after a commit failure and allows one retry", async () => {
    const root = document.createElement("div");
    let attempts = 0;
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], null);
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states: [state],
      onRender: render,
      onClose: () => undefined,
      onCommit: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Storage quota exceeded.");
      },
      workerFactory: () => new FakeWorker(workbook())
    });
    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const projectName = root.querySelector<HTMLInputElement>("[data-excel-import-new-project-name]")!;
    projectName.value = "Demo Project";
    projectName.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();
    root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.click();
    root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(controller.viewModel.commitStatus).toBe("failed");
    expect(controller.viewModel.stage).toBe("result");
    expect(controller.viewModel.rows.length).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(attempts).toBe(2);
    expect(controller.viewModel.commitStatus).toBe("committed");
  });
});
