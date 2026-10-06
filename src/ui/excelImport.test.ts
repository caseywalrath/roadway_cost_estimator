// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AgencyItemRecord, StateConfig } from "../data/schema";
import { createUserProject, createCustomProjectLineItem, linkProjectLineItemToCatalog } from "../projects/projectWorkspace";
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

const iowaState = {
  ...state,
  code: "IA",
  name: "Iowa",
  defaultAgencyId: "ia_iowa",
  defaultAgencyName: "Iowa DOT"
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

const iowaAgencyItem = {
  ...agencyItem,
  agencyItemId: "ia:0012",
  state: "IA",
  agencyId: "ia_iowa",
  agencyName: "Iowa DOT",
  officialDescription: "Mobilization and setup",
  agency: "Iowa DOT"
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
  it("keeps critical confirmation warnings visible while collapsing supporting detail", () => {
    const controller = new ExcelImportController({ currentStateCode: "NE", currentAgencyId: "ne_ndot", agencyItems: [], activeProject: null, states: [state], onRender: () => undefined, onClose: () => undefined });
    const root = document.createElement("div");
    root.innerHTML = renderExcelImportWizard({ ...controller.viewModel, stage: "result", confirmation: {
      destinationLabel: "Test estimate", keepsExistingItems: false, importedCount: 4, addedCount: 4, updatedCount: 0,
      skippedCount: 7, unresolvedSkippedCount: 2, automaticallySkippedItemCount: 1, failedItemCount: 1,
      skippedReasons: [{ count: 3, label: "were blank rows, headings, or totals" }],
      constructionCost: 400, otherCost: 0, hasOtherCosts: false,
      sourceTotalComparison: { comparedItemCount: 4, recalculatedMinusSource: 12 }
    } }, [state], null);
    const warnings = root.querySelector(".excel-import-confirmation-warnings")!;
    expect(warnings.closest("details")).toBeNull();
    expect(warnings.textContent).toContain("2 unresolved items will be skipped.");
    expect(warnings.textContent).toContain("2 items could not be imported.");
    expect(warnings.textContent).toContain("$12.00 above spreadsheet costs for 4 compared items");
    expect(root.querySelector(".excel-import-skipped-summary")?.hasAttribute("open")).toBe(false);
    expect(root.querySelector(".excel-import-confirmation-costs details")?.hasAttribute("open")).toBe(false);
    expect(root.querySelectorAll("[data-excel-import-download-report]")).toHaveLength(1);
    expect(root.querySelector(".excel-import-existing-items")).toBeNull();
    expect(root.textContent).not.toContain("Choose a workbook, confirm its data");
  });

  it("plans additions, updates and individual skips on confirmation and sends the effective plan to commit", async () => {
    const root = document.createElement("div");
    const project = createUserProject("Existing estimate", "NE");
    const official = linkProjectLineItemToCatalog(createCustomProjectLineItem("NE", "construction"), agencyItem);
    Object.assign(official, { quantity: 1, preferredUnitCost: 50, notes: "Keep these notes" });
    const custom = createCustomProjectLineItem("NE", "construction");
    Object.assign(custom, { itemCode: "CUSTOM", description: "Temporary traffic control", unit: "LS", quantity: 1, preferredUnitCost: 30 });
    project.lineItems = [official, custom];
    let controller!: ExcelImportController;
    let committedDraft: ExcelImportReadyDraft | undefined;
    const render = () => { root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], project.name); controller.bind(root); };
    controller = new ExcelImportController({ currentStateCode: "NE", currentAgencyId: "ne_ndot", agencyItems: [agencyItem], activeProject: project, states: [state], onRender: render, onClose: () => undefined, onCommit: (draft) => { committedDraft = draft; }, workerFactory: () => new FakeWorker(workbook()) });
    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    for (const stage of ["sheet", "mapping", "review"]) root.querySelector<HTMLButtonElement>(`[data-excel-import-next="${stage}"]`)!.click();
    root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")!.click();
    expect(controller.viewModel.confirmation?.existingItemPlan?.additions).toHaveLength(2);
    expect(root.textContent).toContain("Items already in this Project");
    const rule = root.querySelector<HTMLSelectElement>("[data-excel-import-existing-default]")!;
    rule.value = "update"; rule.dispatchEvent(new Event("change"));
    expect(controller.viewModel.confirmation).toMatchObject({ addedCount: 0, updatedCount: 2, constructionDelta: 195, projectedConstructionCost: 275 });
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")!.textContent).toBe("Update 2 existing items");
    const choices = root.querySelectorAll<HTMLSelectElement>("[data-excel-import-existing-action]");
    choices[1].value = "skip"; choices[1].dispatchEvent(new Event("change"));
    expect(controller.viewModel.confirmation).toMatchObject({ addedCount: 0, updatedCount: 1, skippedCount: 2, constructionDelta: 150, projectedConstructionCost: 230 });
    root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(committedDraft!.existingItemPlan!.updates[0]).toMatchObject({ lineItemId: official.lineItemId, quantity: 2, preferredUnitCost: 100, notes: "Keep these notes" });
    expect(buildExcelImportReportCsv(committedDraft!)).toContain("updated-existing");
    expect(buildExcelImportReportCsv(committedDraft!)).toContain("existing-item-skipped");
    expect(root.textContent).toContain("1 item was updated in Existing estimate");
    expect(project.lineItems[0].quantity).toBe(1);
  });

  it("leaves ambiguous updates as additions and requires an explicit target before saving", async () => {
    const root = document.createElement("div");
    const project = createUserProject("Existing estimate", "NE");
    project.lineItems = [1, 2].map(() => linkProjectLineItemToCatalog(createCustomProjectLineItem("NE", "construction"), agencyItem));
    let controller!: ExcelImportController;
    const render = () => { root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], project.name); controller.bind(root); };
    controller = new ExcelImportController({ currentStateCode: "NE", currentAgencyId: "ne_ndot", agencyItems: [agencyItem], activeProject: project, states: [state], onRender: render, onClose: () => undefined, workerFactory: () => new FakeWorker(workbook()) });
    controller.open(); await controller.selectFile(file()); await new Promise((resolve) => window.setTimeout(resolve, 0));
    for (const stage of ["sheet", "mapping", "review"]) root.querySelector<HTMLButtonElement>(`[data-excel-import-next="${stage}"]`)!.click();
    root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")!.click();
    const rule = root.querySelector<HTMLSelectElement>("[data-excel-import-existing-default]")!;
    rule.value = "update"; rule.dispatchEvent(new Event("change"));
    expect(controller.viewModel.confirmation?.updatedCount).toBe(0);
    const action = root.querySelector<HTMLSelectElement>("[data-excel-import-existing-action]")!;
    action.value = "update"; action.dispatchEvent(new Event("change"));
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")!.disabled).toBe(true);
    const target = root.querySelector<HTMLSelectElement>("[data-excel-import-existing-target]")!;
    target.value = project.lineItems[1].lineItemId; target.dispatchEvent(new Event("change"));
    expect(controller.viewModel.confirmation?.existingItemPlan?.updates[0].lineItemId).toBe(project.lineItems[1].lineItemId);
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")!.disabled).toBe(false);
  });
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
    expect(markup).toContain('name="excelImportDestinationState"');
    expect(markup).toContain('<option value="NE" selected>Nebraska</option>');
    expect(markup).not.toContain("Catalog destination");
    expect(markup).not.toContain("Choose worksheet");

    const activeController = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: createUserProject("Demo Project", "NE"),
      states: [state],
      onRender: () => undefined,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbook())
    });
    const activeMarkup = renderExcelImportWizard(activeController.viewModel, [state], "Demo Project");
    expect(activeMarkup).not.toContain('name="excelImportDestinationState"');
  });

  it("loads the selected state's catalog, preserves it while reading the file, and clears stale review decisions", async () => {
    const root = document.createElement("div");
    const states = [state, iowaState];
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, states, null);
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE",
      currentAgencyId: "ne_ndot",
      agencyItems: [agencyItem],
      activeProject: null,
      states,
      loadAgencyItemsForState: async (stateCode) => stateCode === "IA" ? [iowaAgencyItem] : [agencyItem],
      onRender: render,
      onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbookWithValue(2, 2, "Mobilization and setup"))
    });

    controller.open();
    const initialState = root.querySelector<HTMLSelectElement>("[data-excel-import-destination-state]")!;
    initialState.value = "IA";
    initialState.dispatchEvent(new Event("change"));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(controller.viewModel.destinationState).toBe("IA");
    expect(controller.viewModel.destinationAgencyId).toBe("ia_iowa");
    expect(controller.viewModel.destinationCatalogStatus).toBe("ready");

    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(controller.viewModel.destinationState).toBe("IA");

    const neState = root.querySelector<HTMLSelectElement>("[data-excel-import-destination-state]")!;
    neState.value = "NE";
    neState.dispatchEvent(new Event("change"));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();
    const neRow = controller.viewModel.rows.find((row) => row.values.itemCode === "0012")!;
    expect(neRow.matchStatus).toBe("needs-review");
    root.querySelector<HTMLButtonElement>(`[data-excel-import-row-choice="${neRow.rowId}"][data-excel-import-action="keep-custom"]`)!.click();
    expect(controller.viewModel.decisions[neRow.rowId]?.action).toBe("keep-custom");

    root.querySelector<HTMLButtonElement>('[data-excel-import-step="file"]')?.click();
    const iaState = root.querySelector<HTMLSelectElement>("[data-excel-import-destination-state]")!;
    iaState.value = "IA";
    iaState.dispatchEvent(new Event("change"));
    expect(controller.viewModel.stage).toBe("file");
    expect(controller.viewModel.rows).toEqual([]);
    expect(controller.viewModel.decisions).toEqual({});

    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();
    const iaRow = controller.viewModel.rows.find((row) => row.values.itemCode === "0012")!;
    expect(iaRow.selectedAgencyItemId).toBe("ia:0012");
    expect(iaRow.matchStatus).toBe("catalog-ready");
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
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(false);

    root.querySelector<HTMLButtonElement>('[data-excel-import-row-choice][data-excel-import-action="use-catalog-description"]')!.click();
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>("[data-excel-import-undo]")!.click();
    expect(controller.viewModel.decisions).toEqual({});
    root.querySelector<HTMLButtonElement>('[data-excel-import-row-choice][data-excel-import-action="use-catalog-description"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-review-filter="reviewed"]')!.click();
    expect(root.textContent).toContain("Choice recorded");
    expect(root.textContent).toContain("Change choice");
    root.querySelector<HTMLDetailsElement>(".excel-import-row-actions details")!.open = true;
    root.querySelector<HTMLButtonElement>('[data-excel-import-row-choice][data-excel-import-action="exclude"]')!.click();
    expect(Object.values(controller.viewModel.decisions)[0]?.action).toBe("exclude");
    root.querySelector<HTMLButtonElement>('[data-excel-import-review-filter="needs-review"]')!.click();
    root.querySelector<HTMLButtonElement>("[data-excel-import-undo]")!.click();
    expect(Object.values(controller.viewModel.decisions)[0]?.action).toBe("use-catalog-description");
  });

  it("allows confirmation with unresolved items and clearly counts them as skipped", async () => {
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
    root.querySelector<HTMLInputElement>("[data-excel-import-new-project-name]")!.value = "Demo Project";
    root.querySelector<HTMLInputElement>("[data-excel-import-new-project-name]")!.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')!.click();

    expect(root.textContent).toContain("1 item needs attention. Continue to skip it, or choose an action.");
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")!.click();

    expect(controller.viewModel.stage).toBe("result");
    expect(controller.viewModel.confirmation?.unresolvedSkippedCount).toBe(1);
    expect(controller.viewModel.confirmation?.skippedCount).toBeGreaterThanOrEqual(1);
    expect(root.textContent).toContain("1 unresolved item will be skipped.");
    expect(root.querySelector(".excel-import-skipped-summary")?.textContent).toContain("1 Unresolved items");
    expect(controller.viewModel.confirmation?.importedCount).toBeGreaterThan(0);
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-commit]")?.disabled).toBe(false);
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

    expect(root.textContent).toContain("3 items need attention. Continue to skip them, or choose an action.");
    expect(root.textContent).toContain("Select All / Clear");
    expect(root.querySelectorAll("[data-excel-import-select-visible]")).toHaveLength(1);
    expect(root.querySelector("[data-excel-import-select-filtered]")).toBeNull();
    expect(root.querySelectorAll("[data-excel-import-review-filter]")).toHaveLength(3);
    expect(root.querySelector("[data-excel-import-bulk-action]")).toBeNull();
    const issueGroup = root.querySelector<HTMLSelectElement>("[data-excel-import-review-issue-filter]")!;
    issueGroup.value = "description";
    issueGroup.dispatchEvent(new Event("change"));
    expect(controller.viewModel.reviewIssueFilter).toBe("description");
    root.querySelector<HTMLInputElement>("[data-excel-import-review-row]")?.click();
    expect(controller.viewModel.selectedReviewRowIds).toHaveLength(1);
    const allIssues = root.querySelector<HTMLSelectElement>("[data-excel-import-review-issue-filter]")!;
    allIssues.value = "all";
    allIssues.dispatchEvent(new Event("change"));
    expect(controller.viewModel.selectedReviewRowIds).toEqual([]);
    root.querySelector<HTMLInputElement>("[data-excel-import-review-row]")!.click();
    const bulkAction = root.querySelector<HTMLSelectElement>("[data-excel-import-bulk-action]")!;
    expect(bulkAction.textContent).toContain("Use official description");
    expect(bulkAction.textContent).toContain("Skip selected");
    expect(root.querySelector("[data-excel-import-apply-bulk-action]")).toBeNull();
    expect(root.querySelector("[data-excel-import-clear-selection]")).toBeNull();
    bulkAction.value = "use-catalog-description";
    bulkAction.dispatchEvent(new Event("change"));
    expect(root.querySelector(".excel-import-selection-bar")).toBeNull();

    expect(Object.values(controller.viewModel.decisions).map((decision) => decision.action)).toEqual(["use-catalog-description"]);
    expect(root.textContent).toContain("2 items need attention. Continue to skip them, or choose an action.");
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(false);

    root.querySelector<HTMLButtonElement>("[data-excel-import-select-visible]")?.click();
    expect(controller.viewModel.selectedReviewRowIds).toHaveLength(2);
    const remainingBulkAction = root.querySelector<HTMLSelectElement>("[data-excel-import-bulk-action]")!;
    remainingBulkAction.value = "use-catalog-description";
    remainingBulkAction.dispatchEvent(new Event("change"));

    expect(Object.values(controller.viewModel.decisions).map((decision) => decision.action)).toEqual([
      "use-catalog-description", "use-catalog-description", "use-catalog-description"
    ]);
    expect(controller.viewModel.selectedReviewRowIds).toEqual([]);
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>("[data-excel-import-undo]")!.click();
    expect(Object.keys(controller.viewModel.decisions)).toHaveLength(1);
    expect(root.textContent).toContain("2 items need attention. Continue to skip them, or choose an action.");
    root.querySelector<HTMLButtonElement>('[data-excel-import-review-filter="all"]')!.click();
    const status = root.querySelector<HTMLSelectElement>("[data-excel-import-all-status]")!;
    status.value = "excluded";
    status.dispatchEvent(new Event("change"));
    expect(controller.viewModel.reviewFilter).toBe("excluded");
    expect(root.querySelector('[data-excel-import-review-filter="all"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("automatically skips rows with no supported import choice and reports potential missing scope", async () => {
    const root = document.createElement("div");
    let controller!: ExcelImportController;
    const render = () => {
      root.innerHTML = renderExcelImportWizard(controller.viewModel, [state], "Demo Project");
      controller.bind(root);
    };
    controller = new ExcelImportController({
      currentStateCode: "NE", currentAgencyId: "ne_ndot", agencyItems: [agencyItem],
      activeProject: null, states: [state], onRender: render, onClose: () => undefined,
      workerFactory: () => new FakeWorker(workbookWithValue(3, 2, ""))
    });
    controller.open();
    await controller.selectFile(file());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const projectName = root.querySelector<HTMLInputElement>("[data-excel-import-new-project-name]")!;
    projectName.value = "Demo Project";
    projectName.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="sheet"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')!.click();
    const skipped = controller.viewModel.rows.find((row) => row.locator.rowNumber === 3)!;
    expect(controller.viewModel.decisions[skipped.rowId]).toEqual({ action: "exclude", automaticallySkipped: true });
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")!.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-excel-import-review-filter="reviewed"]')!.click();
    expect(root.textContent).not.toContain("Automatically skipped");
    root.querySelector<HTMLButtonElement>('[data-excel-import-review-filter="all"]')!.click();
    const status = root.querySelector<HTMLSelectElement>("[data-excel-import-all-status]")!;
    status.value = "excluded";
    status.dispatchEvent(new Event("change"));
    expect([...root.querySelectorAll<HTMLTableRowElement>(".excel-import-review-table tbody tr")]
      .some((row) => row.cells[1]?.textContent?.trim() === "3")).toBe(true);
    expect(root.textContent).toContain("CUSTOM");
    expect(root.textContent).toContain("Automatically skipped");
    expect(root.querySelector("[data-excel-import-row-choice]")).toBeNull();
    root.querySelector<HTMLButtonElement>("[data-excel-import-finish]")!.click();
    expect(root.textContent).toContain("Check skipped rows for missing estimate items");
    expect(controller.viewModel.confirmation?.importedCount).toBe(1);
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
    let committed = 0;
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
      onCommitted: () => {
        committed += 1;
        expect(controller.viewModel.commitStatus).toBe("committed");
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
    expect(controller.viewModel.stage).toBe("sheet");
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="mapping"]')?.click();
    expect(controller.viewModel.stage).toBe("mapping");
    root.querySelector<HTMLButtonElement>('[data-excel-import-next="review"]')?.click();
    expect(controller.viewModel.stage).toBe("review");
    expect(controller.viewModel.rows.length).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>('[data-excel-import-finish]')?.click();
    expect(controller.viewModel.stage).toBe("result");
    expect(root.querySelector(".excel-import-confirmation-destination")?.textContent).toBe("New Project: Demo Project");
    expect([...root.querySelectorAll(".excel-import-outcome-counts dd")].map((cell) => cell.textContent)).toEqual(["2", "0", "1"]);
    expect(root.querySelector(".excel-import-confirmation-costs details")?.hasAttribute("open")).toBe(false);
    expect(root.querySelector(".excel-import-skipped-summary")?.hasAttribute("open")).toBe(false);
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
    expect(committed).toBe(1);
    expect(controller.viewModel.commitStatus).toBe("committed");
    expect(root.textContent).toContain("2 items were added to Demo Project.");
    expect(root.querySelectorAll("[data-excel-import-cancel]")).toHaveLength(1);
    expect(root.querySelector<HTMLButtonElement>("[data-excel-import-download-report]")?.textContent).toContain("Download skipped-row report");

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
