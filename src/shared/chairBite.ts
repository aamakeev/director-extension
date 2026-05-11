/**
 * Tokens a viewer still needs this session so their total reaches
 * `directorTotal + overtakeMargin` (threshold to take the chair when the safe window is open).
 */
export const chairCatchUpTokens = (
  directorTotal: number,
  overtakeMargin: number,
  mySessionTotal: number,
): number => {
  const d = Math.max(0, Math.floor(directorTotal));
  const m = Math.max(1, Math.floor(overtakeMargin));
  const mine = Math.max(0, Math.floor(mySessionTotal));
  const threshold = d + m;
  return Math.max(0, threshold - mine);
};

/**
 * Tokens a viewer must add this session to (a) finish the unlock goal in one
 * shot — `preproductionGoal - totalSessionTips` — AND (b) come out as the
 * leading tipper by at least `overtakeMargin`, so the buyer survives the
 * immediate Live transition (when minTenure briefly shields them) and isn't
 * sitting on a tie with the strongest other tipper. Used for the pre-Live
 * "Become Director" direct-buy button so the cost adapts to whatever the
 * room has already chipped in.
 */
export const unlockDirectorBuyTokens = ({
  preproductionGoal,
  totalSessionTips,
  overtakeMargin,
  mySessionTotal,
  topOtherTotal,
}: {
  preproductionGoal: number;
  totalSessionTips: number;
  overtakeMargin: number;
  mySessionTotal: number;
  /** Highest session total among every contributor that isn't the buyer. */
  topOtherTotal: number;
}): number => {
  const goal = Math.max(0, Math.floor(preproductionGoal));
  const room = Math.max(0, Math.floor(totalSessionTips));
  const margin = Math.max(1, Math.floor(overtakeMargin));
  const mine = Math.max(0, Math.floor(mySessionTotal));
  const topOther = Math.max(0, Math.floor(topOtherTotal));
  const closeGoal = Math.max(0, goal - room);
  const overtakeTop = Math.max(0, topOther + margin - mine);
  return Math.max(closeGoal, overtakeTop);
};
