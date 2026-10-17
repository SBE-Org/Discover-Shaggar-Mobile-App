// Service worker: makes the app installable and usable with a weak connection.
// Pages: network first, cached copy when offline. Built files (/assets, hashed names): cache first.
// API reads: network first, cached copy when offline. Map tiles: cache first with a size cap.
const VERSION = 'sdc-react-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];
const TILE_CACHE = 'sdc-tiles', TILE_MAX = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { mode: u.startsWith('http') ? 'cors' : 'same-origin' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}
const put = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;

  if (same && url.pathname.startsWith('/api/')) {
    if (url.pathname.endsWith('.csv') || url.pathname.startsWith('/api/system/')) return;
    const cacheable = ['/api/places', '/api/subcities', '/api/trips', '/api/announcements', '/api/pages'].includes(url.pathname) || /^\/api\/(places|trips|pages)\/[^/]+$/.test(url.pathname);
    e.respondWith(fetch(req).then((res) => (cacheable && !url.search.includes('scope=all') ? put(req, res) : res))
      .catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: 'You are offline.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }

  if (/basemaps\.cartocdn\.com|arcgisonline\.com|tile\.openstreetmap\.org/.test(url.host)) {
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
      return res;
    }).catch(() => fetch(req)));
    return;
  }

  if (same && url.pathname.startsWith('/admin')) return;

  // Opening the app: always try for the latest version first.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => put(new Request('/index.html'), res)).catch(() => caches.match('/index.html')));
    return;
  }
  if (same || url.host === 'unpkg.com' || url.host.endsWith('gstatic.com') || url.host === 'fonts.googleapis.com') {
    e.respondWith(caches.match(req).then((hit) => {
      if (hit) {
        // Built files have content hashes in their names and never change; refresh everything else in the background.
        if (!url.pathname.startsWith('/assets/')) fetch(req).then((res) => put(req, res)).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => put(req, res));
    }).catch(() => Response.error()));
  }
});
