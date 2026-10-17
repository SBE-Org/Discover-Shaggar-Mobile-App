// Configuration from environment variables (see .env.example).
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so no extra package is needed.
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

const env = process.env;

export const config = {
  port: parseInt(env.PORT || '8080', 10),
  host: env.HOST || '0.0.0.0',
  production: env.NODE_ENV === 'production',
  // MongoDB connection string, e.g. from MongoDB Atlas. "memory" keeps everything in memory (testing only).
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/discover-shaggar',
  dbName: env.MONGODB_DB || '',
  sessionDays: parseInt(env.SESSION_DAYS || '14', 10),
  // Salt for hashing visitor IPs in suggestions (privacy). Set a long random value in production.
  ipSalt: env.IP_SALT || 'change-me',
  // Render and Vercel sit in front of the app, so the visitor IP comes from X-Forwarded-For.
  trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === '1' : true,
  maxPhotoBytes: parseInt(env.MAX_PHOTO_BYTES || String(4 * 1024 * 1024), 10),
  // Browser origins allowed to call the API directly (comma separated). Not needed when the
  // frontend forwards /api through its own domain (the Vercel setup in vercel.json).
  corsOrigins: String(env.CORS_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  backupsKept: parseInt(env.BACKUPS_KEPT || '5', 10),
  // Map tiles. Defaults are free providers that need attribution and fair use;
  // use your own tile server or a paid plan for heavy traffic.
  tiles: {
    dark: env.TILE_STREET || env.TILE_DARK || 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    darkAttribution: env.TILE_DARK_ATTR || '&copy; OpenStreetMap contributors &copy; CARTO',
    satellite: env.TILE_SAT || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    satelliteAttribution: env.TILE_SAT_ATTR || 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    labels: env.TILE_LABELS || 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
  },
  bootstrapAdmin: env.ADMIN_EMAIL && env.ADMIN_PASSWORD
    ? { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, name: env.ADMIN_NAME || 'Administrator' }
    : null,
};
