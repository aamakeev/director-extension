/** Distinct hues for stacked tips / contributor chips (cycles by index). */
export const CONTRIBUTOR_COLORS = [
  '#5eead4',
  '#fbbf24',
  '#c084fc',
  '#4ade80',
  '#fb7185',
  '#60a5fa',
  '#f472b6',
  '#a3e635',
] as const;

export const contributorColorAt = (index: number): string =>
  CONTRIBUTOR_COLORS[Math.abs(index) % CONTRIBUTOR_COLORS.length]!;
