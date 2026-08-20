// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { captureResultsTableScroll, restoreResultsTableScroll } from "./resultsScroll";

describe("results table scroll preservation", () => {
  it("captures and restores both scroll axes after the table is replaced", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="table-scroll--sticky-results"></div>`;
    const original = root.querySelector<HTMLElement>(".table-scroll--sticky-results");
    if (!original) throw new Error("Expected results table scroll container.");

    original.scrollTop = 318;
    original.scrollLeft = 47;
    const position = captureResultsTableScroll(root);

    root.innerHTML = `<div class="table-scroll--sticky-results"></div>`;
    restoreResultsTableScroll(root, position);

    const replacement = root.querySelector<HTMLElement>(".table-scroll--sticky-results");
    expect(replacement?.scrollTop).toBe(318);
    expect(replacement?.scrollLeft).toBe(47);
  });

  it("does nothing when no results table is rendered", () => {
    const root = document.createElement("div");

    expect(captureResultsTableScroll(root)).toBeNull();
    expect(() => restoreResultsTableScroll(root, { top: 10, left: 4 })).not.toThrow();
  });
});
