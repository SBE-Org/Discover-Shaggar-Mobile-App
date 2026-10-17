// Tiny HTTP toolkit: router, JSON bodies, cookies and error responses.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  match(method, path) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isJson = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = body === undefined ? '' : isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export const json = (res, body, status = 200) => send(res, status, body);

export async function readBody(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limitBytes = 256 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) throw new HttpError(415, 'Send the request body as JSON.');
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie */ }
  }
  return out;
}

/**
 * Session cookie. `crossSite` is used when the browser calls the API on another domain (CORS_ORIGINS):
 * such cookies must be SameSite=None; Secure. With the Vercel rewrite the API is same-site and Lax is used.
 */
export function setCookie(res, name, value, { maxAgeSec, secure, crossSite = false }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', crossSite ? 'SameSite=None' : 'SameSite=Lax'];
  if (maxAgeSec !== undefined) parts.push('Max-Age=' + maxAgeSec);
  if (secure || crossSite) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, parts.join('; ')) : parts.join('; '));
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || '';
}
