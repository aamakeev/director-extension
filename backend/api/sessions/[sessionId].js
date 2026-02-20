import {
  applyCors,
  handlePreflight,
  methodNotAllowed,
  readJsonBody,
  sendJson,
  sendNoContent
} from '../_lib/http.js';
import { StorageUnavailableError, deleteSession, getSession, setSession } from '../_lib/store.js';

const API_KEY = String(process.env.BACKEND_API_KEY || '').trim();
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const getSessionId = (req) => {
  const raw = Array.isArray(req.query?.sessionId) ? req.query.sessionId[0] : req.query?.sessionId;
  return String(raw || '').trim();
};

const isAuthorized = (req) => {
  if (!API_KEY) {
    return true;
  }

  const provided = String(req.headers['x-api-key'] || '').trim();
  return Boolean(provided && provided === API_KEY);
};

const isObject = (value) => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export default async function handler(req, res) {
  applyCors(req, res);

  if (handlePreflight(req, res)) {
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const sessionId = getSessionId(req);
  if (!SESSION_ID_RE.test(sessionId)) {
    sendJson(res, 400, { error: 'Invalid session id' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const row = await getSession(sessionId);
      if (!row) {
        sendJson(res, 404, { error: 'Session not found' });
        return;
      }

      sendJson(res, 200, {
        sessionId,
        updatedAt: row.updatedAt,
        state: row.state
      });
      return;
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (!isObject(body) || !isObject(body.state)) {
        sendJson(res, 400, { error: 'Body must include object in field "state"' });
        return;
      }

      const updatedAt = Number(body.state.savedAt || Date.now());
      const result = await setSession(sessionId, {
        state: body.state,
        updatedAt: Number.isFinite(updatedAt) ? Math.floor(updatedAt) : Date.now()
      });

      if (result.isStale) {
        sendJson(res, 409, {
          error: 'Stale snapshot rejected: a newer state already exists',
          sessionId,
          updatedAt: result.updatedAt,
          state: result.state
        });
        return;
      }

      sendNoContent(res);
      return;
    }

    if (req.method === 'DELETE') {
      await deleteSession(sessionId);
      sendNoContent(res);
      return;
    }

    methodNotAllowed(res, ['GET', 'PUT', 'DELETE', 'OPTIONS']);
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      sendJson(res, 503, { error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : 'Internal Server Error';
    sendJson(res, 500, { error: message });
  }
}
