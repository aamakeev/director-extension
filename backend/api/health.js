import { applyCors, handlePreflight, methodNotAllowed, sendJson } from './_lib/http.js';
import { getStorageMode } from './_lib/store.js';

export default async function handler(req, res) {
  applyCors(req, res);

  if (handlePreflight(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET', 'OPTIONS']);
    return;
  }

  const storage = getStorageMode();

  sendJson(res, 200, {
    ok: true,
    storage,
    isAvailable: storage !== 'disabled',
    isPersistent: storage === 'vercel-kv',
    now: Date.now()
  });
}
