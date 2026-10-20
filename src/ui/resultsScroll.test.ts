// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { captureResultsTableScroll, restoreResultsTableScroll } from "./resultsScroll";

describe("results scroll preservation", () => {
  it("preserves page position and horizontal table position after the table is replaced", () => {
    // jsdom leaves scrollingElement null; browsers expose the document scroller.
    Object.defineProperty(document, "scrollingElement", { configurable: true, value: document.documentElement });
    const root = document.createElement("div");
    root.innerHTML = `<div class="table-scroll--sticky-results"></div>`;
    const original = root.querySelector<HTMLElement>(".table-scroll--sticky-results");
    if (!original) throw new Error("Expected results table scroll container.");

    const pageScroller = document.scrollingElement ?? document.documentElement;
    pageScroller.scrollTop = 318;
    original.scrollLeft = 47;
    const position = captureResultsTableScroll(root);

    root.innerHTML = `<div class="table-scroll--sticky-results"></div>`;
    restoreResultsTableScroll(root, position);

    const replacement = root.querySelector<HTMLElement>(".table-scroll--sticky-results");
    expect(pageScroller.scrollTop).toBe(318);
    expect(replacement?.scrollTop).toBe(0);
    expect(replacement?.scrollLeft).toBe(47);
  });

  it("does nothing when no results table is rendered", () => {
    const root = document.createElement("div");

    expect(captureResultsTableScroll(root)).toBeNull();
    expect(() => restoreResultsTableScroll(root, { top: 10, left: 4 })).not.toThrow();
  });
});
