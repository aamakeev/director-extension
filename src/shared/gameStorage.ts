/**
 * Persistence layer for Director game state.
 *
 * What persists across model page refreshes:
 * - gameAccepting / isLive flags
 * - totalSessionTips
 * - per-user tip allocations (who tipped how much to which item)
 * - director / challenger seat state
 *
 * What does NOT persist (reset on refresh is fine):
 * - activityFeed, commandHistory, commandCooldowns, flashAt
 * - currentPerformance, queue (command queue)
 * - seenTransactions, seenMoveTxnIds (dedup sets)
 *
 * Only "Stop Goal" (pauseGameRound) clears persisted state.
 */

const STATE_KEY = 'director:game_state';
const STATE_TTL_SECONDS = '86400'; // 24h; cleared explicitly on Stop Goal

type ExtLike = {
  makeRequest(method: string, params: unknown): Promise<unknown>;
};

export type PersistedUserAlloc = {
  id: string;
  name: string;
  total: number;
  allocations: Record<string, number>;
};

export type PersistedGameState = {
  version: 1;
  gameAccepting: boolean;
  isLive: boolean;
  totalSessionTips: number;
  director: { id: string | null; name: string; total: number; startedAt: number };
  challenger: { id: string | null; name: string; total: number };
  users: PersistedUserAlloc[];
  savedAt: number;
};

const isPersistedUserAlloc = (u: unknown): u is PersistedUserAlloc =>
  isObj(u) &&
  typeof (u as PersistedUserAlloc).id === 'string' &&
  typeof (u as PersistedUserAlloc).name === 'string' &&
  typeof (u as PersistedUserAlloc).total === 'number' &&
  isObj((u as PersistedUserAlloc).allocations);

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const safeParseState = (raw: string): PersistedGameState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    if (p['version'] !== 1) return null;
    if (
      typeof p['gameAccepting'] !== 'boolean' ||
      typeof p['isLive'] !== 'boolean' ||
      typeof p['totalSessionTips'] !== 'number' ||
      !isObj(p['director']) ||
      !isObj(p['challenger']) ||
      !Array.isArray(p['users'])
    ) {
      return null;
    }
    const users = (p['users'] as unknown[]).filter(isPersistedUserAlloc);
    return {
      version: 1,
      gameAccepting: p['gameAccepting'] as boolean,
      isLive: p['isLive'] as boolean,
      totalSessionTips: p['totalSessionTips'] as number,
      director: p['director'] as PersistedGameState['director'],
      challenger: p['challenger'] as PersistedGameState['challenger'],
      users,
      savedAt: typeof p['savedAt'] === 'number' ? (p['savedAt'] as number) : 0,
    };
  } catch {
    return null;
  }
};

export const loadGameState = async (ext: ExtLike): Promise<PersistedGameState | null> => {
  try {
    const res = (await ext.makeRequest('v1.storage.string.get', {
      key: STATE_KEY,
    })) as { value: string };
    return safeParseState(res?.value ?? '');
  } catch {
    return null;
  }
};

export const saveGameState = async (ext: ExtLike, s: PersistedGameState): Promise<void> => {
  try {
    await ext.makeRequest('v1.storage.string.set', {
      key: STATE_KEY,
      value: JSON.stringify(s),
      ttlSeconds: STATE_TTL_SECONDS,
    });
  } catch {
    /* best-effort */
  }
};

export const clearGameState = async (ext: ExtLike): Promise<void> => {
  try {
    await ext.makeRequest('v1.storage.string.set', {
      key: STATE_KEY,
      value: '',
      ttlSeconds: '1',
    });
  } catch {
    /* best-effort */
  }
};
