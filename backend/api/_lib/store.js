import { Redis } from '@upstash/redis';

const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC || 60 * 60 * 24 * 3);
const ALLOW_MEMORY_FALLBACK = String(process.env.ALLOW_MEMORY_FALLBACK || '')
  .trim()
  .toLowerCase() === 'true';

const memoryStore = globalThis.__directorExtensionMemoryStore || new Map();
if (!globalThis.__directorExtensionMemoryStore) {
  globalThis.__directorExtensionMemoryStore = memoryStore;
}

const redisRestUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasKvEnv = Boolean(redisRestUrl && redisRestToken);
let redis = null;

if (hasKvEnv) {
  try {
    redis = Redis.fromEnv();
  } catch {
    redis = null;
  }
}

const sessionKey = (sessionId) => `director:session:${sessionId}`;

export class StorageUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

const assertStorageReady = () => {
  if (redis || ALLOW_MEMORY_FALLBACK) {
    return;
  }

  throw new StorageUnavailableError(
    'Persistent storage is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN, or set ALLOW_MEMORY_FALLBACK=true for local development.'
  );
};

const normalizeUpdatedAt = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return Date.now();
  }

  return Math.floor(num);
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeRecord = (payload) => ({
  updatedAt: normalizeUpdatedAt(payload?.updatedAt),
  state: isObject(payload?.state) ? payload.state : {}
});

export const getStorageMode = () => {
  if (redis) return 'vercel-kv';
  if (ALLOW_MEMORY_FALLBACK) return 'memory';
  return 'disabled';
};

export const getSession = async (sessionId) => {
  assertStorageReady();

  const key = sessionKey(sessionId);

  if (!redis) {
    return memoryStore.get(key) || null;
  }

  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return normalizeRecord(parsed);
};

export const setSession = async (sessionId, payload) => {
  assertStorageReady();

  const key = sessionKey(sessionId);
  const normalized = normalizeRecord(payload);
  const existing = await getSession(sessionId);

  if (existing && normalized.updatedAt < existing.updatedAt) {
    return {
      ...existing,
      isStale: true,
      wasWritten: false
    };
  }

  if (!redis) {
    memoryStore.set(key, normalized);
    return {
      ...normalized,
      isStale: false,
      wasWritten: true
    };
  }

  await redis.set(key, JSON.stringify(normalized), {
    ex: SESSION_TTL_SEC
  });

  return {
    ...normalized,
    isStale: false,
    wasWritten: true
  };
};

export const deleteSession = async (sessionId) => {
  assertStorageReady();

  const key = sessionKey(sessionId);

  if (!redis) {
    memoryStore.delete(key);
    return;
  }

  await redis.del(key);
};
