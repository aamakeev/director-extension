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
