// Restore a backup made with `npm run backup` or downloaded from the portal (System & backups).
// Usage: npm run restore -- path/to/shaggar-....json.gz --yes
// WARNING: this replaces everything in the database named by MONGODB_URI.
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { restoreDatabase } from '../src/lib/backup.js';

const file = process.argv[2];
if (!file) { console.error('Usage: npm run restore -- <backup.json.gz> --yes'); process.exit(1); }
if (!process.argv.includes('--yes')) { console.error('This replaces all data in the database. Add --yes to confirm.'); process.exit(1); }
const db = await openDb();
const counts = await restoreDatabase(db, readFileSync(file));
await db.close();
console.log('Restored:', Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
