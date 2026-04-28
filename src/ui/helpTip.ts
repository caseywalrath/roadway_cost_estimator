let helpTipId = 0;

export function helpTip(label: string, text: string): string {
  const tooltipId = `info-tip-${helpTipId}`;
  helpTipId += 1;

  return `
    <span class="info-tip-wrap">
      <span class="info-tip" tabindex="0" aria-label="${escapeHtml(label)}" aria-describedby="${tooltipId}">
        i
      </span>
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

