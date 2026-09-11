import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as XLSX from "xlsx";

const outputPath = resolve(
  process.cwd(),
  "src/projects/excelImport/fixtures/sparse-reader-fixtures.xlsx"
);
mkdirSync(dirname(outputPath), { recursive: true });

const primary = XLSX.utils.aoa_to_sheet([
  ["Synthetic workbook fixture", null, null, null, null, null, null],
  ["Item Code", "Description", "Unit", "Quantity", "Unit Cost", "Total", "Notes"],
  ["0012", "MOBILIZATION", "EA", 2, 100, null, "leading-zero identifier"],
  [13, "SIGNAL CABINET", "EA", 1, 2500, null, "formula has no cached value"],
  ["0014", "ERROR ROW", "EA", 1, 5, null, "formula cached error"],
  ["0015", "HIDDEN ROW ITEM", "LS", 1, 10, 10, "hidden physical row"],
  ["Section heading", null, null, null, null, null, null],
  ["Continuation heading", "Vertical merge anchor", null, null, null, null, null],
  [null, null, "covered cell", null, null, null, null]
]);

// Keep formulas and their cache states explicit. The reader must consume the
// saved value, never evaluate the formula in the browser.
primary["F3"] = { t: "n", f: "D3*E3", v: 200, w: "$200.00", z: "$#,##0.00" };
primary["F4"] = { t: "n", f: "D4*E4" };
primary["F5"] = { t: "e", f: "D5*E5", v: 7, w: "#VALUE!" };
primary["A4"].z = "0000";
primary["D3"].z = "0000";
primary["D4"].z = "0.00";
primary["E3"].z = "$#,##0.00";
primary["E4"].z = "$#,##0.00";
primary["E5"].z = "$#,##0.00";
primary["F5"].z = "$#,##0.00";
primary["!merges"] = [
  { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
  { s: { r: 7, c: 1 }, e: { r: 8, c: 1 } }
];
primary["!rows"] = [];
primary["!rows"][5] = { hidden: true };
primary["!cols"] = [];
primary["!cols"][6] = { hidden: true };
primary["!autofilter"] = { ref: "A2:G5" };

const hidden = XLSX.utils.aoa_to_sheet([
  ["Hidden worksheet", "Item Code", "Description"],
  ["do not auto-select", "9999", "HIDDEN ITEM"]
]);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, primary, "Primary");
XLSX.utils.book_append_sheet(workbook, hidden, "Hidden Items");
XLSX.utils.book_set_sheet_visibility(workbook, "Hidden Items", 1);
workbook.Workbook = {
  Sheets: [
    { name: "Primary", Hidden: 0 },
    { name: "Hidden Items", Hidden: 1 }
  ],
  Names: [
    { Name: "_xlnm.Print_Area", Ref: "'Primary'!$A$1:$G$9", Sheet: 0 }
  ]
};

const bytes = XLSX.write(workbook, {
  bookType: "xlsx",
  compression: true,
  type: "buffer"
});
writeFileSync(outputPath, bytes);
console.log(`Wrote ${outputPath}`);
