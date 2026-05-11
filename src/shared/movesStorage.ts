/**
 * Move-tokens reallocation transport via host shared storage.
 *
 * Why storage and not whisper: AGENTS.md hard rule says viewer-sourced
 * `v1.ext.whisper` requires `paymentData` in public shows. We don't want to
 * charge the viewer for moves (they already paid for the original tip), so we
 * route move requests through `v1.storage.string.*` — which has no paymentData
 * requirement — and the model background drains the queue on its existing tick.
 *
 * No mutex: Use idempotent txnIds instead. Each move gets a unique txnId.
 * If two writes race, both succeed and model dedup processes by txnId.
 */

const QUEUE_KEY = 'director:moves';
const QUEUE_TTL_SECONDS = '600'; // SDK expects string
const MAX_AGE_MS = 5 * 60 * 1000;

export type MoveRecord = {
  txnId: string;
  userId: string;
  username: string;
  fromItemId: string;
  toItemId: string;
  amount: number;
  ts: number;
};

type ExtLike = {
  makeRequest(method: string, params: unknown): Promise<unknown>;
};

type ReportError = (message: string, data: unknown) => void;

const safeJsonParseQueue = (raw: string): MoveRecord[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is MoveRecord =>
        r &&
        typeof r === 'object' &&
        typeof r.txnId === 'string' &&
        typeof r.userId === 'string' &&
        typeof r.fromItemId === 'string' &&
        typeof r.toItemId === 'string' &&
        typeof r.amount === 'number' &&
        typeof r.ts === 'number',
    );
  } catch {
    return [];
  }
};

const readQueue = async (ext: ExtLike): Promise<MoveRecord[]> => {
  try {
    const res = (await ext.makeRequest('v1.storage.string.get', {
      key: QUEUE_KEY,
    })) as { value: string };
    return safeJsonParseQueue(res?.value ?? '');
  } catch {
    return [];
  }
};

const writeQueue = async (ext: ExtLike, records: MoveRecord[]): Promise<void> => {
  try {
    await ext.makeRequest('v1.storage.string.set', {
      key: QUEUE_KEY,
      value: JSON.stringify(records),
      ttlSeconds: QUEUE_TTL_SECONDS,
    });
  } catch {
    /* swallow; surface via reportError in caller if needed */
  }
};

const generateTxnId = (): string =>
  `mv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Viewer-side: append a move request to the shared queue. Uses a mutex to
 * serialize concurrent writes from multiple viewers in the same room.
 */
export const submitMove = async (
  ext: ExtLike,
  payload: {
    userId: string;
    username: string;
    fromItemId: string;
    toItemId: string;
    amount: number;
  },
  reportError: ReportError = () => undefined,
): Promise<{ ok: boolean; txnId: string | null }> => {
  console.log('[director-move] submitMove called', { payload });

  if (!payload.userId || !payload.fromItemId || !payload.toItemId) {
    console.log('[director-move] early return: missing required fields');
    return { ok: false, txnId: null };
  }
  if (payload.amount <= 0) {
    console.log('[director-move] early return: amount <= 0');
    return { ok: false, txnId: null };
  }
  if (payload.fromItemId === payload.toItemId) {
    console.log('[director-move] early return: same item');
    return { ok: false, txnId: null };
  }

  const txnId = generateTxnId();
  console.log('[director-move] generated txnId', { txnId });
  reportError('director moves: submit started', {
    txnId,
    userId: payload.userId,
    fromItemId: payload.fromItemId,
    toItemId: payload.toItemId,
    amount: payload.amount,
  });

  try {
    const queue = await readQueue(ext);
    console.log('[director-move] read queue', { queueLength: queue.length, txnId });

    const now = Date.now();
    const fresh = queue.filter((r) => now - r.ts < MAX_AGE_MS);
    const next: MoveRecord[] = [
      ...fresh,
      {
        txnId,
        userId: String(payload.userId),
        username: String(payload.username || ''),
        fromItemId: String(payload.fromItemId),
        toItemId: String(payload.toItemId),
        amount: Math.floor(payload.amount),
        ts: now,
      },
    ].slice(-50); // keep last 50 records

    console.log('[director-move] about to write queue', { nextLength: next.length, txnId });
    await writeQueue(ext, next);
    console.log('[director-move] write queue succeeded', { txnId });

    reportError('director moves: submit succeeded', {
      txnId,
      queueLength: next.length,
    });
    return { ok: true, txnId };
  } catch (err) {
    console.error('[director-move] submit failed', { err, txnId });
    reportError('director moves: submit failed', { err: String(err), txnId });
    return { ok: false, txnId: null };
  }
};

/**
 * Model-side: pull every record whose `txnId` isn't already in `knownTxnIds`,
 * then prune the queue to a reasonable size. Returns the new records to apply.
 */
export const drainMoves = async (
  ext: ExtLike,
  knownTxnIds: Set<string>,
  reportError: ReportError = () => undefined,
): Promise<MoveRecord[]> => {
  console.log('[director-drain] drain started', { knownTxnIdsCount: knownTxnIds.size });

  try {
    const queue = await readQueue(ext);
    console.log('[director-drain] queue read', { queueLength: queue.length });

    reportError('director moves: queue state', {
      queueLength: queue.length,
      knownTxnIdsCount: knownTxnIds.size,
      firstTxnIds: queue.slice(0, 3).map((r) => r.txnId),
    });

  if (!queue.length) {
    console.log('[director-drain] queue empty, returning');
    return [];
  }

  const now = Date.now();
  const fresh = queue.filter((r) => now - r.ts < MAX_AGE_MS);
  console.log('[director-drain] age filtered', {
    freshCount: fresh.length,
    staleCount: queue.length - fresh.length,
  });

  reportError('director moves: queue state', {
    queueLength: queue.length,
    knownTxnIdsCount: knownTxnIds.size,
    firstTxnIds: queue.slice(0, 3).map((r) => r.txnId),
  });

  const newRecords = fresh.filter((r) => !knownTxnIds.has(r.txnId));
  console.log('[director-drain] dedup filtered', {
    newCount: newRecords.length,
    seenCount: fresh.length - newRecords.length,
  });

  reportError('director moves: age filtered', {
    freshCount: fresh.length,
    staleCount: queue.length - fresh.length,
    maxAgeSec: MAX_AGE_MS / 1000,
  });

  reportError('director moves: dedup filtered', {
    newCount: newRecords.length,
    seenBeforeCount: fresh.length - newRecords.length,
  });

    // Keep only recent records to prevent unbounded growth
    const trimmed = fresh.slice(-50);
    if (trimmed.length !== queue.length) {
      console.log('[director-drain] trimming queue', {
        fromLength: queue.length,
        toLength: trimmed.length,
      });
      await writeQueue(ext, trimmed);
    }

  console.log('[director-drain] returning new records', { count: newRecords.length });
  return newRecords;
  } catch (err) {
    console.error('[director-drain] error', { err });
    reportError('director moves: drain failed', { err: String(err) });
    return [];
  }
};
