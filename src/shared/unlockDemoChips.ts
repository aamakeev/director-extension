/** Demo names for “many viewers add to the same pool” visuals (settings + main slot). */
export const UNLOCK_DEMO_NAMES = ['Luna_Rose', 'M_K', 'Jaxxx17'] as const;

/** Partial tips that sum to `total` for stacked-chip demos. */
export const chipDemoFromTotal = (total: number) => {
  const p = Math.max(1, Math.floor(total));
  const tipA = p < 3 ? p : Math.max(1, Math.floor(p / 3));
  const tipB = p < 3 ? 0 : Math.max(1, Math.floor((p - tipA) / 2));
  const tipC = p < 3 ? 0 : p - tipA - tipB;
  const chipSteps = tipB > 0 ? (tipC > 0 ? 3 : 2) : 1;
  return { p, tipA, tipB, tipC, chipSteps };
};
