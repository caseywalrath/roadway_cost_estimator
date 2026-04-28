let helpTipId = 0;

export function helpTip(label: string, text: string): string {
  const tooltipId = `info-tip-${helpTipId}`;
  helpTipId += 1;

  return `
    <span class="info-tip-wrap">
      <button class="info-tip" type="button" aria-label="${escapeHtml(label)}" aria-describedby="${tooltipId}">
        i
      </button>
      <span id="${tooltipId}" class="info-popover" role="tooltip">${escapeHtml(text)}</span>
    </span>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return replacements[char];
  });
}

