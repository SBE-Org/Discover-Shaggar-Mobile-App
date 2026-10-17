// Create (or reset) an administrator account from the command line.
// Usage: npm run create-admin              (asks questions)
//        npm run create-admin -- email@x.et "Full Name"   (asks only for the password)
// Uses MONGODB_URI from .env or the environment.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openDb } from '../src/db.js';
import { checkPasswordStrength } from '../src/lib/auth.js';
import { upsertAdmin } from '../src/api/auth.js';

const rl = createInterface({ input: stdin, output: stdout });
const db = await openDb();
try {
  const email = (process.argv[2] || await rl.question('Email: ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email is not valid.');
  const name = (process.argv[3] || await rl.question('Full name: ')).trim() || 'Administrator';
  const password = process.env.ADMIN_PASSWORD_INPUT || await rl.question('Password (10+ characters, letters and numbers): ');
  const weak = checkPasswordStrength(password);
  if (weak) throw new Error(weak);
  const r = await upsertAdmin(db, { email, name, password });
  console.log(r.created
    ? `Created administrator ${email}. Sign in at /admin (web portal) or the Admin tab in the app.`
    : `Updated ${email}: administrator, password reset.`);
} catch (e) {
  console.error('Not created:', e.message);
  process.exitCode = 1;
} finally {
  rl.close();
  await db.close();
}
