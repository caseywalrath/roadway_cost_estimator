import type { ExistingItemChoice, ExistingItemMatch } from "./existingItems";

export type ProjectMatchStatus = "changed" | "unchanged" | "needs-target";

/** Compare the fields that an ordinary existing-item update would actually replace. */
export function existingMatchStatus(match: ExistingItemMatch, choice?: ExistingItemChoice): ProjectMatchStatus {
  if (match.needsTarget && !choice?.targetLineItemId && choice?.action !== "add" && choice?.action !== "skip") return "needs-target";
  const target = match.candidates.find((line) => line.lineItemId === choice?.targetLineItemId)
    ?? (match.candidates.length === 1 ? match.candidates[0] : null);
  if (!target) return match.candidates.some((line) => {
    const incoming = match.incoming;
    return (incoming.quantity ?? line.quantity) !== line.quantity
      || (incoming.preferredUnitCost ?? line.preferredUnitCost) !== line.preferredUnitCost
      || (incoming.notes.trim() ? incoming.notes : line.notes) !== line.notes;
  }) ? "changed" : "unchanged";
  const incoming = match.incoming;
  return (incoming.quantity ?? target.quantity) !== target.quantity
    || (incoming.preferredUnitCost ?? target.preferredUnitCost) !== target.preferredUnitCost
    || (incoming.notes.trim() ? incoming.notes : target.notes) !== target.notes
    ? "changed" : "unchanged";
}

