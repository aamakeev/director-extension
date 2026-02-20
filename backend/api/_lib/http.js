const RAW_CORS_ORIGINS = String(process.env.CORS_ORIGINS || '*').trim();

const allowedOrigins = RAW_CORS_ORIGINS === '*'
  ? null
  : new Set(
    RAW_CORS_ORIGINS
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );

const resolveAllowedOrigin = (requestOrigin) => {
  if (RAW_CORS_ORIGINS === '*') {
    return '*';
  }

  const origin = String(requestOrigin || '').trim();
  if (!origin) {
    return '';
  }

  if (allowedOrigins && allowedOrigins.has(origin)) {
    return origin;
  }

  return '';
};

export const applyCors = (req, res) => {
  const allowOrigin = resolveAllowedOrigin(req.headers.origin);

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  }

  if (allowOrigin !== '*') {
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
};

export const handlePreflight = (req, res) => {
  if (req.method !== 'OPTIONS') {
    return false;
  }

  res.statusCode = 204;
  res.end();
  return true;
};

export const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const sendNoContent = (res) => {
  res.statusCode = 204;
  res.end();
};

export const methodNotAllowed = (res, methods) => {
  res.setHeader('Allow', methods.join(','));
  sendJson(res, 405, { error: 'Method Not Allowed' });
};

export const readJsonBody = async (req) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (!chunks.length) {
    return null;
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
