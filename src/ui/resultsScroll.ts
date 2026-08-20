export interface ResultsTableScrollPosition {
  top: number;
  left: number;
}

const resultsTableScrollSelector = ".table-scroll--sticky-results";

export function captureResultsTableScroll(root: ParentNode): ResultsTableScrollPosition | null {
  const scrollContainer = root.querySelector<HTMLElement>(resultsTableScrollSelector);
  if (!scrollContainer) return null;

  return {
    top: scrollContainer.scrollTop,
    left: scrollContainer.scrollLeft
  };
}

export function restoreResultsTableScroll(
  root: ParentNode,
  position: ResultsTableScrollPosition | null
): void {
  if (!position) return;

  const scrollContainer = root.querySelector<HTMLElement>(resultsTableScrollSelector);
  if (!scrollContainer) return;

  scrollContainer.scrollTop = position.top;
  scrollContainer.scrollLeft = position.left;
}
