import { applyCors, handlePreflight, methodNotAllowed, sendJson } from './_lib/http.js';

const API_KEY = String(process.env.BACKEND_API_KEY || '').trim();
const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,64}$/;
const REQUEST_TIMEOUT_MS = 5000;
const STRIPCHAT_HOST_RE = /(^|\.)stripchat\.(com|dev|local)$/i;
const DEFAULT_ORIGINS = ['https://stripchat.dev', 'https://stripchat.com'];

const isAuthorized = (req) => {
  if (!API_KEY) {
    return true;
  }

  const provided = String(req.headers['x-api-key'] || '').trim();
  return Boolean(provided && provided === API_KEY);
};

const normalizeOrigin = (input) => {
  const value = String(input || '').trim();
  if (!value) {
    return null;
  }

  let parsed = null;

  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      parsed = new URL(value);
    } else {
      parsed = new URL(`https://${value}`);
    }
  } catch {
    return null;
  }

  const protocol = parsed.protocol;
  const hostname = String(parsed.hostname || '').toLowerCase();
  if (!hostname) {
    return null;
  }

  if (protocol !== 'https:' && protocol !== 'http:') {
    return null;
  }

  if (!STRIPCHAT_HOST_RE.test(hostname)) {
    return null;
  }

  const port = parsed.port ? `:${parsed.port}` : '';
  return `${protocol}//${hostname}${port}`;
};

const normalizeMenuSettings = (settings) => {
  if (!Array.isArray(settings)) {
    return [];
  }

  return settings
    .map((item) => {
      const activity = String(item?.activity || item?.title || item?.name || '').trim();
      const priceRaw = Number(item?.price ?? item?.tokens ?? item?.amount ?? 0);
      const price = Number.isFinite(priceRaw) ? Math.max(0, Math.floor(priceRaw)) : 0;

      if (!activity || !price) {
        return null;
      }

      return {
        activity,
        price
      };
    })
    .filter(Boolean);
};

const fetchTipMenuFromOrigin = async (origin, username) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${origin}/api/front/v2/models/username/${encodeURIComponent(username)}/cam`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const tipMenu = payload?.cam?.tipMenu ?? payload?.tipMenu;
    if (!tipMenu || typeof tipMenu !== 'object' || Array.isArray(tipMenu)) {
      return null;
    }

    const settings = normalizeMenuSettings(tipMenu.settings);

    return {
      isEnabled: Boolean(tipMenu.isEnabled ?? settings.length > 0),
      settings,
      updatedAt: Date.now()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const getCandidateOrigins = (hostQuery) => {
  const origins = [];
  const seen = new Set();

  const push = (value) => {
    const origin = normalizeOrigin(value);
    if (!origin || seen.has(origin)) {
      return;
    }

    seen.add(origin);
    origins.push(origin);
  };

  const hostValue = Array.isArray(hostQuery) ? hostQuery[0] : hostQuery;
  push(hostValue);

  const envOrigins = String(process.env.TIP_MENU_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  envOrigins.forEach(push);
  DEFAULT_ORIGINS.forEach(push);

  return origins;
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

  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET', 'OPTIONS']);
    return;
  }

  const usernameRaw = Array.isArray(req.query?.username) ? req.query.username[0] : req.query?.username;
  const username = String(usernameRaw || '').trim();

  if (!USERNAME_RE.test(username)) {
    sendJson(res, 400, { error: 'Invalid username' });
    return;
  }

  const origins = getCandidateOrigins(req.query?.host);
  if (!origins.length) {
    sendJson(res, 400, { error: 'No allowed host provided' });
    return;
  }

  let firstNonNull = null;

  for (const origin of origins) {
    const tipMenu = await fetchTipMenuFromOrigin(origin, username);
    if (!tipMenu) {
      continue;
    }

    if (!firstNonNull) {
      firstNonNull = { origin, tipMenu };
    }

    if (tipMenu.settings.length > 0) {
      sendJson(res, 200, {
        ok: true,
        source: origin,
        tipMenu
      });
      return;
    }
  }

  if (firstNonNull) {
    sendJson(res, 200, {
      ok: true,
      source: firstNonNull.origin,
      tipMenu: firstNonNull.tipMenu
    });
    return;
  }

  sendJson(res, 502, {
    ok: false,
    error: 'Tip menu unavailable'
  });
}
