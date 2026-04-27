export function helpTip(label: string, text: string): string {
  return `
    <button class="info-tip" type="button" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(text)}">
      i
    </button>
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

