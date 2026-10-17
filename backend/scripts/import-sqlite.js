// One-time move from the previous version (SQLite file + uploads folder) to MongoDB.
// Usage: npm run import-sqlite -- path/to/data/shaggar.db [path/to/data/uploads] --yes
// Needs Node.js 22.13+ (it reads the old file with the built-in node:sqlite).
// Replaces the data in the database named by MONGODB_URI with the contents of the old file.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { openDb, COLLECTION_NAMES } from '../src/db.js';
import { loadSettings, loadCatalog } from '../src/db.js';
import { MIME, FILE_NAME } from '../src/lib/photos.js';

// table -> [collection, id column, columns holding JSON text that become arrays/objects]
const TABLES = {
  users: ['users', 'id'], sessions: ['sessions', 'token_hash'], roles: ['roles', 'key', ['permissions']], settings: ['settings', 'key', ['value']],
  subcities: ['subcities', 'id', ['boundary']], sectors: ['sectors', 'key'], types: ['types', null], places: ['places', 'id', ['facilities', 'hours_json']],
  place_photos: ['place_photos', 'id'], location_evidence: ['location_evidence', 'id'], suggestions: ['suggestions', 'id', ['payload']], audit_log: ['audit_log', 'id'],
  reports: ['reports', 'id'], trips: ['trips', 'id'], trip_stops: ['trip_stops', 'id'], trip_updates: ['trip_updates', 'id'], trip_photos: ['trip_photos', 'id'],
  trip_registrations: ['trip_registrations', 'id'], pages: ['pages', 'slug'], announcements: ['announcements', 'id'], menu_items: ['menu_items', 'id', ['tags']],
};
const COUNTED = { users: 'users', audit_log: 'audit_log', location_evidence: 'location_evidence', trip_stops: 'trip_stops', trip_updates: 'trip_updates' };

export async function importSqlite(db, file, uploadsDir) {
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(file, { readOnly: true });
  const tables = new Set(old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
  const counts = {};
  for (const name of COLLECTION_NAMES) if (!['meta'].includes(name)) await db.store.collection(name).deleteMany({});
  for (const [table, [colName, idCol, jsonCols = []]] of Object.entries(TABLES)) {
    if (!tables.has(table)) continue;
    const rows = old.prepare(`SELECT * FROM ${table}`).all().map((r) => {
      const d = { ...r };
      for (const c of jsonCols) if (typeof d[c] === 'string') { try { d[c] = JSON.parse(d[c]); } catch { /* keep text */ } }
      d._id = idCol ? d[idCol] : d.sector + '/' + d.key;
      return d;
    });
    const col = db.store.collection(colName);
    for (let i = 0; i < rows.length; i += 500) await col.insertMany(rows.slice(i, i + 500));
    counts[colName] = rows.length;
    if (COUNTED[table] && rows.length) {
      const max = Math.max(...rows.map((r) => Number(r.id) || 0));
      await db.counters.updateOne({ _id: COUNTED[table] }, { $set: { seq: max } }, { upsert: true });
    }
  }
  // Photos: copy every referenced image from the old uploads folder into MongoDB.
  let photos = 0;
  if (uploadsDir && existsSync(uploadsDir)) {
    for (const f of readdirSync(uploadsDir)) {
      if (!FILE_NAME.test(f)) continue;
      const buf = readFileSync(resolve(uploadsDir, f));
      await db.files.insertOne({ _id: f, id: f, type: MIME[f.split('.').pop()], size: buf.length, data: buf, created_at: new Date().toISOString() });
      photos++;
    }
  }
  counts.files = photos;
  await db.meta.updateOne({ _id: 'schema' }, { $set: { version: 1, imported_from: 'sqlite', at: new Date().toISOString() } }, { upsert: true });
  old.close();
  await loadSettings(db);
  await loadCatalog(db);
  return counts;
}

if (process.argv[1] && process.argv[1].endsWith('import-sqlite.js')) {
  const file = process.argv[2];
  if (!file || !existsSync(file)) { console.error('Usage: npm run import-sqlite -- path/to/shaggar.db [path/to/uploads] --yes'); process.exit(1); }
  if (!process.argv.includes('--yes')) { console.error('This replaces all data in the MongoDB database. Add --yes to confirm.'); process.exit(1); }
  const uploads = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : resolve(dirname(file), 'uploads');
  const db = await openDb();
  const counts = await importSqlite(db, file, uploads);
  await db.close();
  console.log('Imported:', Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
}
