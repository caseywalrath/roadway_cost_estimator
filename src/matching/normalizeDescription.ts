export function normalizeDescription(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeUnit(value: string): string {
  const raw = value.trim().toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]+/g, " ").trim();
  const unitMap: Record<string, string> = {
    EA: "EACH",
    EACH: "EACH",
    LS: "L S",
    "L S": "L S",
    "LUMP SUM": "L S",
    LB: "LB",
    POUND: "LB",
    POUNDS: "LB",
    SF: "SF",
    "SQ FT": "SF",
    "SQUARE FOOT": "SF",
    SY: "SY",
    "SQ YD": "SY",
    "SQUARE YARD": "SY",
    CY: "CY",
    "CU YD": "CY",
    "CUBIC YARD": "CY",
    LF: "LF",
    FOOT: "LF",
    FEET: "LF",
    AC: "ACRE",
    ACRE: "ACRE",
    HR: "HOUR",
    HOUR: "HOUR",
    HOURS: "HOUR",
    FA: "F A",
    "F A": "F A",
    "F/A": "F A",
  };
  return unitMap[compact] ?? raw;
}

export function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeDescription(value)
      .split(" ")
      .filter((token) => token.length > 1)
  );
}

export function keywordMatches(text: string, includeKeywords: string[], excludeKeywords: string[]): boolean {
  const normalized = normalizeDescription(text);
  const hasInclude = includeKeywords.some((keyword) => normalized.includes(keyword));
  const hasExclude = excludeKeywords.some((keyword) => keyword && normalized.includes(keyword));

  return hasInclude && !hasExclude;
}

export function similarityScore(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

