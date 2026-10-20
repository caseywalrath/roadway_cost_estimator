export interface ResultsTableScrollPosition {
  top: number;
  left: number;
}

const resultsTableScrollSelector = ".table-scroll--sticky-results";

export function captureResultsTableScroll(root: ParentNode): ResultsTableScrollPosition | null {
  const scrollContainer = root.querySelector<HTMLElement>(resultsTableScrollSelector);
  if (!scrollContainer) return null;

  return {
    top: document.scrollingElement?.scrollTop ?? window.scrollY,
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

  const pageScroller = document.scrollingElement;
  if (pageScroller) {
    pageScroller.scrollTop = position.top;
  } else {
    document.documentElement.scrollTop = position.top;
    document.body.scrollTop = position.top;
  }
  scrollContainer.scrollTop = 0;
  scrollContainer.scrollLeft = position.left;
}
