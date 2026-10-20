interface StickyTablePair {
  scroller: HTMLElement;
  sourceTable: HTMLTableElement;
  sourceHead: HTMLTableSectionElement;
  floatingHeader: HTMLDivElement;
  floatingClip: HTMLDivElement;
  floatingTable: HTMLTableElement;
  floatingHead: HTMLTableSectionElement;
  addItemDockButton: HTMLButtonElement | null;
}

let cleanupCurrentMount: (() => void) | null = null;

/** Adds page-sticky visual mirrors while preserving the tables' original semantic headers. */
export function mountPageStickyTableHeaders(root: HTMLElement): void {
  cleanupCurrentMount?.();

  const pairs: StickyTablePair[] = [];
  root.querySelectorAll<HTMLElement>(".table-scroll--sticky-results").forEach((scroller) => {
    const sourceTable = scroller.querySelector<HTMLTableElement>("table");
    const sourceHead = sourceTable?.tHead;
    const shell = scroller.parentElement;
    if (!sourceTable || !sourceHead || !shell) return;

    const floatingHeader = document.createElement("div");
    floatingHeader.className = "page-sticky-table-header";
    floatingHeader.hidden = true;
    floatingHeader.setAttribute("aria-hidden", "true");

    const floatingClip = document.createElement("div");
    floatingClip.className = "page-sticky-table-header__clip";

    const floatingTable = sourceTable.cloneNode(false) as HTMLTableElement;
    floatingTable.removeAttribute("id");
    floatingTable.classList.add("page-sticky-table-header__table");
    floatingTable.style.tableLayout = "fixed";
    const floatingHead = sourceHead.cloneNode(true) as HTMLTableSectionElement;
    floatingTable.append(floatingHead);
    floatingClip.append(floatingTable);
    floatingHeader.append(floatingClip);
    const addItemDockButton = shell.querySelector<HTMLButtonElement>(".project-add-item-dock");
    if (addItemDockButton) {
      const footer = root.querySelector<HTMLElement>(".app-footer");
      const dockParent = footer?.parentElement ?? root;
      dockParent.insertBefore(addItemDockButton, footer?.parentElement === dockParent ? footer : null);
    }
    shell.insertBefore(floatingHeader, scroller);

    floatingHead.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.tabIndex = -1;
    });

    pairs.push({ scroller, sourceTable, sourceHead, floatingHeader, floatingClip, floatingTable, floatingHead, addItemDockButton });
  });

  if (pairs.length === 0) {
    cleanupCurrentMount = null;
    return;
  }

  const appFooter = root.querySelector<HTMLElement>(".app-footer");
  const listeners = new AbortController();
  let frameId: number | null = null;
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
  if (appFooter) resizeObserver?.observe(appFooter);

  function update(): void {
    const stickyTop = 0;
    const candidates = pairs.filter((pair) => {
      const headerRect = pair.sourceHead.getBoundingClientRect();
      const tableRect = pair.scroller.getBoundingClientRect();
      return headerRect.bottom <= stickyTop && tableRect.bottom > stickyTop + headerRect.height;
    });
    const activePair = candidates.sort((left, right) =>
      right.sourceHead.getBoundingClientRect().top - left.sourceHead.getBoundingClientRect().top
    )[0];

    const footerRect = appFooter?.getBoundingClientRect();
    for (const pair of pairs) {
      updateAddItemDock(pair.addItemDockButton, pair.scroller, footerRect);
      const active = pair === activePair;
      pair.floatingHeader.hidden = !active;
      if (!active) continue;

      const scrollerRect = pair.scroller.getBoundingClientRect();
      const headerRect = pair.sourceHead.getBoundingClientRect();
      const sourceCells = Array.from(pair.sourceHead.rows[0]?.cells ?? []);
      const floatingCells = Array.from(pair.floatingHead.rows[0]?.cells ?? []);
      sourceCells.forEach((cell, index) => {
        const width = cell.getBoundingClientRect().width;
        if (floatingCells[index]) floatingCells[index].style.width = `${width}px`;
      });

      const tableWidth = pair.sourceTable.getBoundingClientRect().width;
      pair.floatingTable.style.width = `${tableWidth}px`;
      pair.floatingTable.style.minWidth = `${tableWidth}px`;
      pair.floatingTable.style.transform = `translateX(${-pair.scroller.scrollLeft}px)`;
      pair.floatingHeader.style.top = `${stickyTop}px`;
      pair.floatingHeader.style.left = `${scrollerRect.left + pair.scroller.clientLeft}px`;
      pair.floatingHeader.style.width = `${pair.scroller.clientWidth}px`;
      pair.floatingHeader.style.height = `${headerRect.height}px`;
      pair.floatingClip.style.width = `${pair.scroller.clientWidth}px`;
      pair.floatingClip.style.height = `${headerRect.height}px`;
      pair.floatingHeader.setAttribute("aria-hidden", "true");
      resizeObserver?.observe(pair.sourceTable);
    }
  }

  function scheduleUpdate(): void {
    if (frameId !== null) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      update();
    });
  }

  for (const pair of pairs) {
    pair.scroller.addEventListener("scroll", scheduleUpdate, { passive: true, signal: listeners.signal });
    resizeObserver?.observe(pair.scroller);
  }
  window.addEventListener("scroll", scheduleUpdate, { passive: true, signal: listeners.signal });
  window.addEventListener("resize", scheduleUpdate, { passive: true, signal: listeners.signal });
  update();

  cleanupCurrentMount = () => {
    listeners.abort();
    resizeObserver?.disconnect();
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    pairs.forEach((pair) => pair.floatingHeader.remove());
  };
}

function updateAddItemDock(button: HTMLButtonElement | null, scroller: HTMLElement, footerRect?: DOMRect): void {
  if (!button) return;
  const rect = scroller.getBoundingClientRect();
  const visibleInViewport = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  const buttonWidth = 175;
  const buttonHeight = 40;
  const footerGap = 12;
  let bottom = 16;
  let dockTop = window.innerHeight - bottom - buttonHeight;
  if (footerRect && footerRect.top < window.innerHeight && footerRect.bottom > 0) {
    dockTop = footerRect.top - footerGap - buttonHeight;
    bottom = window.innerHeight - footerRect.top + footerGap;
  }

  const left = Math.max(8, Math.min(rect.left + scroller.clientLeft, window.innerWidth - buttonWidth - 8));
  button.style.left = `${left}px`;
  button.style.bottom = `${bottom}px`;
  button.hidden = button.disabled || !visibleInViewport || dockTop < 8;
}
