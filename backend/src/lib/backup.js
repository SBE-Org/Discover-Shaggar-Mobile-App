// Backups: every collection (including photos) as gzipped JSON, kept inside MongoDB so they survive
// restarts on hosts with a temporary disk (Render free). Download them from the portal (System & backups)
// or with `npm run backup`, and restore with `npm run restore -- <file>`.
import { gzipSync, gunzipSync } from 'node:zlib';
import { COLLECTION_NAMES, nowIso } from '../db.js';

const SKIP = new Set(['sessions', 'backups', 'backup_chunks']);
const CHUNK = 8 * 1024 * 1024; // MongoDB documents are limited to 16 MB, so large backups are split

/** Buffers are written as { $b64: "..." } so the file is plain JSON. */
const replacer = function (k, v) {
  const raw = this[k];
  if (Buffer.isBuffer(raw)) return { $b64: raw.toString('base64') };
  return v;
};
const reviver = (k, v) => (v && typeof v === 'object' && typeof v.$b64 === 'string' && Object.keys(v).length === 1 ? Buffer.from(v.$b64, 'base64') : v);

/** The whole database as a gzipped JSON buffer. */
export async function dumpDatabase(db) {
  const out = { app: 'discover-shaggar', format: 1, created_at: nowIso(), collections: {} };
  for (const name of COLLECTION_NAMES) {
    if (SKIP.has(name)) continue;
    out.collections[name] = await db.store.collection(name).raw();
  }
  return gzipSync(Buffer.from(JSON.stringify(out, replacer)));
}

/** Replace every collection with the contents of a backup file (gzipped JSON). */
export async function restoreDatabase(db, buf) {
  const data = JSON.parse(gunzipSync(buf).toString('utf8'), reviver);
  if (data.app !== 'discover-shaggar' || !data.collections) throw new Error('This is not a Discover Shaggar backup.');
  const counts = {};
  for (const [name, docs] of Object.entries(data.collections)) {
    if (SKIP.has(name) || !COLLECTION_NAMES.includes(name)) continue;
    const col = db.store.collection(name);
    await col.deleteMany({});
    for (let i = 0; i < docs.length; i += 500) await col.insertMany(docs.slice(i, i + 500));
    counts[name] = docs.length;
  }
  return counts;
}

export async function createBackup(db, { keep = 5 } = {}) {
  const buf = await dumpDatabase(db);
  const name = 'shaggar-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json.gz';
  const parts = Math.ceil(buf.length / CHUNK) || 1;
  for (let n = 0; n < parts; n++) {
    await db.backupChunks.insertOne({ _id: name + '#' + n, backup: name, n, data: buf.subarray(n * CHUNK, (n + 1) * CHUNK) });
  }
  await db.backups.insertOne({ _id: name, name, bytes: buf.length, parts, at: nowIso() });
  // Keep only the newest backups so the free database tier does not fill up.
  const all = await db.backups.find({}, { sort: { at: -1 } });
  for (const old of all.slice(Math.max(1, keep))) {
    await db.backupChunks.deleteMany({ backup: old.name });
    await db.backups.deleteOne({ _id: old.name });
  }
  return { name, bytes: buf.length };
}

export async function listBackups(db) {
  return (await db.backups.find({}, { sort: { at: -1 } })).map((b) => ({ name: b.name, bytes: b.bytes, at: b.at }));
}

export async function readBackup(db, name) {
  const b = await db.backups.findOne({ _id: name });
  if (!b) return null;
  const chunks = await db.backupChunks.find({ backup: name }, { sort: { n: 1 } });
  return Buffer.concat(chunks.map((c) => c.data));
}
