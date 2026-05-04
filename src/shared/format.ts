export const formatRemaining = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const slugify = (input: string, fallback: string): string => {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return slug || fallback;
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const clampInt = (value: unknown, fallback = 0, min = 0): number => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) return fallback;
  return Math.floor(num);
};
