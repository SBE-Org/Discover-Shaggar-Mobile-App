// Download a full backup of the database (all collections, photos included) to a local file.
// Usage: npm run backup              -> backups/shaggar-YYYY-MM-DD-HH-MM-SS.json.gz
// Restore with: npm run restore -- backups/<file>.json.gz
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../src/db.js';
import { dumpDatabase } from '../src/lib/backup.js';
import { ROOT } from '../src/config.js';

const dir = resolve(ROOT, 'backups');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, 'shaggar-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json.gz');
const db = await openDb();
writeFileSync(file, await dumpDatabase(db));
await db.close();
console.log('Backup written to', file);
