import type { ExcelImportMapping, ExcelImportRangeSelection, ImportSelectionConflict } from "./types";

export interface MappedImportRegion {
  regionId: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  mapping: ExcelImportMapping;
}

/**
 * Check overlapping physical ranges before parsing. Identical overlap is safe
 * and deduplicated; a disagreement in mapping/group/category policy blocks the
 * import instead of letting selection order decide the result.
 */
export function validateRegionOverlaps(regions: MappedImportRegion[]): ImportSelectionConflict[] {
  const conflicts: ImportSelectionConflict[] = [];
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const left = regions[leftIndex];
      const right = regions[rightIndex];
      const startRow = Math.max(left.startRow, right.startRow);
      const endRow = Math.min(left.endRow, right.endRow);
      const startColumn = Math.max(left.startColumn, right.startColumn);
      const endColumn = Math.min(left.endColumn, right.endColumn);
      if (startRow > endRow || startColumn > endColumn) continue;
      if (!samePolicy(left.mapping, right.mapping)) {
        conflicts.push({ rowNumber: startRow, regionIds: [left.regionId, right.regionId], message: `Overlapping regions disagree about column mapping or group/category treatment at row ${startRow}. Remove the overlap or assign that row to one region.` });
      }
    }
  }
  return conflicts;
}

export function deduplicateSelectedRows(ranges: ExcelImportRangeSelection[]): ExcelImportRangeSelection[] {
  const rows = new Map<number, ExcelImportRangeSelection>();
  for (const range of ranges) {
    for (let rowNumber = range.startRow; rowNumber <= range.endRow; rowNumber += 1) {
      if (!rows.has(rowNumber)) rows.set(rowNumber, { ...range, startRow: rowNumber, endRow: rowNumber });
    }
  }
  return [...rows.values()].sort((left, right) => left.startRow - right.startRow || left.rangeId.localeCompare(right.rangeId));
}

function samePolicy(left: ExcelImportMapping, right: ExcelImportMapping): boolean {
  const leftColumns = Object.entries(left.columns).sort(([a], [b]) => a.localeCompare(b));
  const rightColumns = Object.entries(right.columns).sort(([a], [b]) => a.localeCompare(b));
  return left.headerRow === right.headerRow
    && left.groupSource === right.groupSource
    && left.categorySource === right.categorySource
    && JSON.stringify(leftColumns) === JSON.stringify(rightColumns);
}
