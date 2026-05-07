export type DirectorSettings = {
  /**
   * Markup (in percent) added on top of every tip menu item for the on-stage
   * prices. e.g. with 10%, a 50tk Dance becomes 55tk shown to viewers. The model
   * earns the extra tokens in exchange for letting viewers tip partial
   * amounts toward the same item.
   */
  tipMenuMarkupPercent: number;
  /** Tokens the room must reach before the show goes live and Director control unlocks. */
  preproductionGoal: number;
  overtakeMargin: number;
  minTenureSec: number;
  commandDurationSec: number;
  commandCooldownSec: number;
  commandCostTokens: number;
};

export const DEFAULT_SETTINGS: DirectorSettings = {
  tipMenuMarkupPercent: 10,
  preproductionGoal: 50,
  overtakeMargin: 10,
  minTenureSec: 15,
  commandDurationSec: 20,
  commandCooldownSec: 6,
  commandCostTokens: 1,
};

const toInt = (
  value: unknown,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return Math.floor(num);
};

export const normalizeSettings = (raw: unknown): DirectorSettings => {
  const input =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  return {
    tipMenuMarkupPercent: toInt(
      input.tipMenuMarkupPercent,
      DEFAULT_SETTINGS.tipMenuMarkupPercent,
      { min: 0, max: 200 },
    ),
    preproductionGoal: toInt(input.preproductionGoal, DEFAULT_SETTINGS.preproductionGoal, {
      min: 10,
    }),
    overtakeMargin: toInt(input.overtakeMargin, DEFAULT_SETTINGS.overtakeMargin, {
      min: 1,
      max: 1_000,
    }),
    minTenureSec: toInt(input.minTenureSec, DEFAULT_SETTINGS.minTenureSec, {
      min: 5,
      max: 600,
    }),
    commandDurationSec: toInt(input.commandDurationSec, DEFAULT_SETTINGS.commandDurationSec, {
      min: 5,
      max: 300,
    }),
    commandCooldownSec: toInt(input.commandCooldownSec, DEFAULT_SETTINGS.commandCooldownSec, {
      min: 1,
      max: 120,
    }),
    commandCostTokens: toInt(input.commandCostTokens, DEFAULT_SETTINGS.commandCostTokens, {
      min: 1,
      max: 100,
    }),
  };
};
