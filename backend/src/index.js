// Discover Shaggar API server: REST API under /api (also /api/v1), photos under /uploads and the
// install manifest. The React app (frontend/) is hosted separately, on Vercel, and forwards /api,
// /uploads and /manifest.webmanifest here. If the built frontend is next to this folder
// (../frontend/dist) the server also serves it, so the whole app can run as one process too.
import http from 'node:http';
import { createReadStream, statSync, readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { config, ROOT } from './config.js';
import { openDb, getSettings, loadSettings, loadCatalog } from './db.js';
import { Router, HttpError, send, clientIp } from './lib/http.js';
import { loadUser, pruneSessions } from './lib/auth.js';
import { readPhotoFile } from './lib/photos.js';
import { createBackup, listBackups } from './lib/backup.js';
import places from './api/places.js';
import suggestions from './api/suggestions.js';
import content from './api/content.js';
import auth, { upsertAdmin } from './api/auth.js';
import data from './api/data.js';
import trips, { pruneRegistrations } from './api/trips.js';
import contrib from './api/contrib.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);
const BASE_MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'src/manifest.json'), 'utf8'));

// Hosts the browser may load from, derived from the tile URLs (used in the CSP header).
export function tileHosts() {
  const hosts = new Set();
  for (const u of [config.tiles.dark, config.tiles.satellite, config.tiles.labels]) {
    try {
      const h = new URL(u.replace('{s}', 'a').replace(/\{[a-z]\}/g, '0').replace('{r}', '')).host;
      hosts.add('https://' + h);
      if (u.includes('{s}')) ['b', 'c', 'd'].forEach((s) => hosts.add('https://' + h.replace(/^a\./, s + '.')));
    } catch { /* ignore malformed */ }
  }
  return [...hosts];
}

function securityHeaders() {
  const tiles = tileHosts().join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://unpkg.com ${tiles}`,
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
    ...(config.production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

/** The web app manifest, following the branding settings (name and uploaded logo). */
export function manifestFor(db) {
  const st = getSettings(db);
  const m = JSON.parse(JSON.stringify(BASE_MANIFEST));
  m.name = st['site.name'] || m.name;
  m.short_name = (st['site.name'] || m.short_name).slice(0, 20);
  if (st['brand.tagline']) m.description = st['brand.tagline'];
  if (st['brand.logo']) {
    const [w, h] = st['brand.logo_size'] || [512, 512];
    const type = st['brand.logo'].endsWith('.png') ? 'image/png' : st['brand.logo'].endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    m.icons = [{ src: '/uploads/' + st['brand.logo'], sizes: `${w}x${h}`, type, purpose: 'any' }, ...m.icons.filter((i) => i.purpose === 'maskable')];
  }
  return m;
}

export function createApp({ db, frontendDir = resolve(ROOT, '..', 'frontend', 'dist') } = {}) {
  const router = new Router();
  const ctx = { db };
  [auth, places, suggestions, content, trips, contrib, data].forEach((reg) => reg(router, ctx));
  router.get('/api/health', (req, res) => send(res, 200, { ok: true, time: new Date().toISOString(), database: db.kind }));

  const SEC = securityHeaders();
  const gzCache = new Map();
  const hasFrontend = existsSync(resolve(frontendDir, 'index.html'));

  function serveFile(req, res, file, { immutable = false } = {}) {
    let st;
    try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const ext = extname(file).toLowerCase();
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = {
      ...SEC,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ETag: etag,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : (ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600'),
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
    if (COMPRESS.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && st.size > 1024) {
      let hit = gzCache.get(file);
      if (!hit || hit.etag !== etag) { hit = { etag, buf: gzipSync(readFileSync(file)) }; gzCache.set(file, hit); }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': hit.buf.length });
      res.end(req.method === 'HEAD' ? undefined : hit.buf);
      return true;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    return true;
  }
  const safeJoin = (root, p) => {
    const full = resolve(root, '.' + p);
    return full === root || full.startsWith(root + sep) ? full : null;
  };

  /** CORS for browsers calling the API on another domain (only origins listed in CORS_ORIGINS). */
  function cors(req, res) {
    const origin = String(req.headers.origin || '').replace(/\/$/, '');
    if (!origin || !config.corsOrigins.includes(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    req.crossSite = true;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return true;
    }
    return false;
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
    // Versioned API (spec 20.2): /api/v1/... is the same as /api/...
    if (path.startsWith('/api/v1/')) path = '/api/' + path.slice(8);
    req.ip = clientIp(req, config.trustProxy);
    try {
      if (path.startsWith('/api/')) {
        if (cors(req, res)) return;
        // Every state-changing API call must be JSON. Browsers cannot send JSON across sites
        // without a CORS preflight, which this server grants only to CORS_ORIGINS, so this blocks CSRF.
        if (!['GET', 'HEAD'].includes(req.method) && !String(req.headers['content-type'] || '').includes('application/json')) {
          throw new HttpError(415, 'Send the request body as JSON.');
        }
        await loadUser(db, req);
        req.query = url.searchParams;
        const m = router.match(req.method, path);
        if (!m) throw new HttpError(404, 'Unknown API route.');
        if (m.methodNotAllowed) throw new HttpError(405, 'Method not allowed.');
        req.params = m.params;
        for (const h of m.handlers) await h(req, res);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      // Photos are stored in MongoDB and never change once saved (each upload gets a new name).
      if (path.startsWith('/uploads/')) {
        const name = path.slice('/uploads/'.length);
        const f = await readPhotoFile(db, name);
        if (!f) throw new HttpError(404, 'Not found');
        const etag = `"${name}"`;
        const headers = { ...SEC, 'Content-Type': f.type, ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, { ...headers, 'Content-Length': f.data.length });
        res.end(req.method === 'HEAD' ? undefined : f.data);
        return;
      }
      if (path === '/manifest.webmanifest') {
        send(res, 200, JSON.stringify(manifestFor(db)), { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache', ...SEC });
        return;
      }
      if (hasFrontend) {
        // Admin web portal: its own single-page app under /admin.
        if (path === '/admin' || (path.startsWith('/admin/') && !extname(path))) { serveFile(req, res, resolve(frontendDir, 'admin/index.html')); return; }
        const f = safeJoin(frontendDir, path === '/' ? '/index.html' : path);
        if (f && serveFile(req, res, f, { immutable: path.startsWith('/assets/') })) return;
        if (!extname(path)) { serveFile(req, res, resolve(frontendDir, 'index.html')); return; }
      } else if (path === '/') {
        send(res, 200, 'Discover Shaggar API is running. The app is served by the frontend (Vercel). Health check: /api/health');
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(new Date().toISOString(), req.method, path, e);
      const headers = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {};
      send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message, details: e.details }, headers);
    }
  };
}

async function bootstrapAdmin(db) {
  if (!config.bootstrapAdmin || (await db.users.count({ role: 'admin' })) > 0) return;
  const a = config.bootstrapAdmin;
  await upsertAdmin(db, { email: a.email, name: a.name, password: a.password });
  console.log(`Created administrator ${a.email}. Remove ADMIN_PASSWORD from the environment now.`);
}

// Start the server when run directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const db = await openDb();
  await bootstrapAdmin(db);
  // SEED_DEMO=1 loads the clearly-labelled sample data on start (for a test deployment without a shell).
  if (process.env.SEED_DEMO === '1') { const { seedDemo } = await import('../scripts/seed-demo.js'); await seedDemo(db); }
  await pruneSessions(db);
  await pruneRegistrations(db);
  // Daily automatic backup kept inside MongoDB (AUTO_BACKUP=0 turns it off).
  const autoBackup = async () => {
    if (process.env.AUTO_BACKUP === '0') return;
    const last = (await listBackups(db))[0];
    if (!last || Date.now() - new Date(last.at) > 23 * 3600 * 1000) await createBackup(db, { keep: config.backupsKept });
  };
  const housekeeping = () => { pruneSessions(db).catch(() => {}); pruneRegistrations(db).catch(() => {}); autoBackup().catch((e) => console.error('Backup failed:', e.message)); };
  setTimeout(() => autoBackup().catch((e) => console.error('Backup failed:', e.message)), 60 * 1000).unref();
  setInterval(housekeeping, 6 * 3600 * 1000).unref();
  // Pick up settings or categories changed by another server process (e.g. during a deploy).
  setInterval(() => { loadSettings(db).catch(() => {}); loadCatalog(db).catch(() => {}); }, 60 * 1000).unref();
  const server = http.createServer(createApp({ db }));
  server.headersTimeout = 30000;
  server.requestTimeout = 60000;
  server.listen(config.port, config.host, async () => {
    console.log(`Discover Shaggar API running at http://localhost:${config.port}  (database: ${db.kind})`);
    if (!(await db.users.count({}))) console.log('No staff accounts yet. Run: npm run create-admin  (or set ADMIN_EMAIL and ADMIN_PASSWORD)');
  });
  const stop = () => { server.close(() => { db.close().finally(() => process.exit(0)); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
