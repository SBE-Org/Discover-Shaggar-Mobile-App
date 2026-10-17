// Sign in (with optional two-step codes), sign out, current user, staff accounts, and roles & permissions.
import { randomBytes } from 'node:crypto';
import { json, readJson, badRequest, notFound, HttpError } from '../lib/http.js';
import {
  hashPassword, verifyPassword, checkPasswordStrength, createSession, destroySession, requireUser, requirePerm, can,
  effectivePermissions, newTotpSecret, verifyTotp, rolePermissions, roleLevel,
} from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { audit, nowIso, setting, insert, nextId, rolesByKey } from '../db.js';
import { EMAIL, str } from '../lib/validate.js';
import { PERMISSIONS, PERMISSION_KEYS, ROLES } from '../shared/catalog.js';

const limitLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
const LOCK_AFTER = 8, LOCK_MIN = 15;
const mfaTickets = new Map(); // ticket -> { userId, exp }
setInterval(() => { const n = Date.now(); for (const [k, v] of mfaTickets) if (v.exp < n) mfaTickets.delete(k); }, 60000).unref();

export const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, role_name: u.role_name, level: u.level ?? 0, subcity_id: u.subcity_id ?? null, phone: u.phone,
  active: !!u.active, mfa_enabled: !!u.mfa_enabled, must_change_password: !!u.must_change_password,
  locked: !!(u.locked_until && u.locked_until > nowIso()), created_at: u.created_at, last_login_at: u.last_login_at ?? null,
});
export function meFor(req) {
  const u = req.user;
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, role_name: u.role_name, subcity_id: u.subcity_id, level: u.level,
    permissions: effectivePermissions(u, PERMISSION_KEYS), mfa_enabled: u.mfa_enabled, mfa_gate: u.mfa_gate,
    must_change_password: u.must_change_password,
  };
}
/** A staff account with its role's name and level (the SQL version joined users with roles). */
async function withRole(db, u, roles) {
  if (!u) return null;
  const r = roles ? roles[u.role] : await db.roles.findOne({ _id: u.role });
  return { ...u, role_name: r?.name ?? null, level: r?.level ?? null };
}
const userById = async (db, id) => withRole(db, await db.users.findOne({ id }));

export default function register(r, { db }) {
  const loadByEmail = (email) => db.users.findOne({ email });

  async function finishLogin(req, res, u) {
    await createSession(db, req, res, u.id);
    await db.users.updateOne({ id: u.id }, { $set: { last_login_at: nowIso(), failed_logins: 0, locked_until: null } });
    req.user = { id: u.id };
    await audit(db, req, 'login', 'user', String(u.id), { email: u.email });
  }

  r.post('/api/auth/login', async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    limitLogin.check('l:' + req.ip); // only failed attempts count
    const u = await loadByEmail(email);
    if (u?.locked_until && u.locked_until > nowIso()) throw new HttpError(423, 'This account is locked after too many wrong passwords. Try again later or ask an administrator.');
    if (!u || !u.active || !verifyPassword(body.password, u.pass_hash)) {
      if (u) {
        const n = (u.failed_logins || 0) + 1;
        await db.users.updateOne({ id: u.id }, { $set: { failed_logins: n, locked_until: n >= LOCK_AFTER ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null } });
      }
      limitLogin.hit('l:' + req.ip);
      await audit(db, req, 'login_failed', 'user', u ? String(u.id) : null, { email: email.slice(0, 120) });
      throw new HttpError(401, 'The email or password is not correct.');
    }
    if (u.mfa_enabled) {
      const ticket = randomBytes(24).toString('base64url');
      mfaTickets.set(ticket, { userId: u.id, exp: Date.now() + 5 * 60000, tries: 0 });
      return json(res, { mfa_required: true, ticket });
    }
    await finishLogin(req, res, u);
    req.user = null;
    json(res, { user: publicUser(await userById(db, u.id)) });
  });

  r.post('/api/auth/login/mfa', async (req, res) => {
    const body = await readJson(req);
    limitLogin.check('m:' + req.ip);
    const t = mfaTickets.get(String(body.ticket || ''));
    if (!t || t.exp < Date.now()) throw new HttpError(401, 'The sign-in took too long. Start again.');
    const u = await db.users.findOne({ id: t.userId });
    if (!u || !u.active) throw new HttpError(401, 'Account not available.');
    if (!verifyTotp(u.mfa_secret, body.code)) {
      t.tries++;
      limitLogin.hit('m:' + req.ip);
      if (t.tries >= 5) mfaTickets.delete(String(body.ticket));
      await audit(db, req, 'login_failed', 'user', String(u.id), { email: u.email, mfa: true });
      throw new HttpError(401, 'That code is not correct. Use the current 6-digit code from your authenticator app.');
    }
    mfaTickets.delete(String(body.ticket));
    await finishLogin(req, res, u);
    json(res, { user: publicUser(await userById(db, u.id)) });
  });

  r.post('/api/auth/logout', async (req, res) => {
    if (req.user) await audit(db, req, 'logout', 'user', String(req.user.id));
    await destroySession(db, req, res);
    json(res, { ok: true });
  });

  r.get('/api/auth/me', (req, res) => json(res, { user: meFor(req) }));

  r.post('/api/auth/password', async (req, res) => {
    requireUser(req);
    const body = await readJson(req);
    const u = await db.users.findOne({ id: req.user.id }, { projection: { pass_hash: 1 } });
    if (!verifyPassword(body.current, u.pass_hash)) throw badRequest('Your current password is not correct.', { current: 'Incorrect' });
    const weak = checkPasswordStrength(body.next);
    if (weak) throw badRequest(weak, { next: weak });
    await db.users.updateOne({ id: req.user.id }, { $set: { pass_hash: hashPassword(body.next), must_change_password: 0, updated_at: nowIso() } });
    await audit(db, req, 'password', 'user', String(req.user.id));
    json(res, { ok: true });
  });

  /* ----- two-step sign-in ----- */
  r.post('/api/auth/mfa/setup', async (req, res) => {
    requireUser(req);
    const secret = newTotpSecret();
    await db.users.updateOne({ id: req.user.id, mfa_enabled: 0 }, { $set: { mfa_secret: secret } });
    const label = encodeURIComponent((setting(db, 'site.name') || 'Discover Shaggar') + ':' + req.user.email);
    json(res, { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(setting(db, 'site.name') || 'Discover Shaggar')}&period=30&digits=6` });
  });
  r.post('/api/auth/mfa/enable', async (req, res) => {
    requireUser(req);
    const body = await readJson(req);
    const u = await db.users.findOne({ id: req.user.id }, { projection: { mfa_secret: 1, mfa_enabled: 1 } });
    if (u.mfa_enabled) throw new HttpError(409, 'Two-step sign-in is already on.');
    if (!verifyTotp(u.mfa_secret, body.code)) throw badRequest('That code is not correct. Check the time on your phone and try the newest code.', { code: 'Incorrect' });
    await db.users.updateOne({ id: req.user.id }, { $set: { mfa_enabled: 1 } });
    await audit(db, req, 'mfa_enable', 'user', String(req.user.id));
    json(res, { ok: true });
  });
  r.post('/api/auth/mfa/disable', async (req, res) => {
    requireUser(req);
    const body = await readJson(req);
    const u = await db.users.findOne({ id: req.user.id }, { projection: { pass_hash: 1, mfa_secret: 1 } });
    if (!verifyPassword(body.password, u.pass_hash)) throw badRequest('Your password is not correct.', { password: 'Incorrect' });
    if (!verifyTotp(u.mfa_secret, body.code)) throw badRequest('That code is not correct.', { code: 'Incorrect' });
    await db.users.updateOne({ id: req.user.id }, { $set: { mfa_enabled: 0, mfa_secret: null } });
    await audit(db, req, 'mfa_disable', 'user', String(req.user.id));
    json(res, { ok: true });
  });

  /* ----- staff accounts (hierarchy: you manage only accounts below your own level) ----- */
  // Nobody can hand out permissions they do not hold, or a role at or above their own level.
  async function assertCanGrant(req, roleKey) {
    if (req.user.all) return;
    const perms = await rolePermissions(db, roleKey);
    if (perms.includes('*') || perms.some((p) => !req.user.perms.includes(p))) {
      throw new HttpError(403, 'You cannot give a role with more access than your own.');
    }
    if ((await roleLevel(db, roleKey)) >= (req.user.level ?? 0)) throw new HttpError(403, 'You can only give roles below your own level.');
  }
  const scoped = (req) => req.user.subcity_id !== null && req.user.subcity_id !== undefined;
  const fullManager = (req) => can(req, 'users.manage');
  /** May this person change the given account? */
  async function assertManageable(req, u) {
    if (req.user.all) return;
    if (u.id === req.user.id) return;
    if ((await roleLevel(db, u.role)) >= (req.user.level ?? 0)) throw new HttpError(403, 'You can only manage accounts below your own level.');
    if (scoped(req) && (u.subcity_id ?? null) !== req.user.subcity_id) throw new HttpError(403, 'You can only manage staff in your own sub-city.');
  }
  const roleExists = async (k) => typeof k === 'string' && !!(await db.roles.findOne({ _id: k }, { projection: { key: 1 } }));
  const parseScope = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

  r.get('/api/users', async (req, res) => {
    requirePerm(req, 'users.manage', 'team.manage', 'audit.view');
    const roles = await rolesByKey(db);
    let rows = await Promise.all((await db.users.find({})).map((u) => withRole(db, u, roles)));
    rows.sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || (b.active || 0) - (a.active || 0) || String(a.name).localeCompare(String(b.name)));
    if (!fullManager(req) && !can(req, 'audit.view') && scoped(req)) rows = rows.filter((u) => (u.subcity_id ?? null) === req.user.subcity_id);
    json(res, { items: rows.map((u) => ({ ...publicUser(u), level: u.level ?? 0, manageable: req.user.all || (u.id !== req.user.id && (u.level ?? 0) < (req.user.level ?? 0) && (!scoped(req) || (u.subcity_id ?? null) === req.user.subcity_id) && (fullManager(req) || can(req, 'team.manage'))) })) });
  });

  r.post('/api/users', async (req, res) => {
    requirePerm(req, 'users.manage', 'team.manage');
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase(), name = str(body.name, 80);
    const errors = {};
    if (!EMAIL.test(email)) errors.email = 'Enter a valid email.';
    if (!name) errors.name = 'Enter a name.';
    if (!(await roleExists(body.role))) errors.role = 'Choose a role.';
    let scope = parseScope(body.subcity_id);
    if (scoped(req)) scope = req.user.subcity_id; // sub-city supervisors add staff to their own sub-city only
    if (scope !== null && !(Number.isInteger(scope) && scope >= 0 && scope <= 12)) errors.subcity_id = 'Choose a sub-city or city-wide.';
    const weak = checkPasswordStrength(body.password);
    if (weak) errors.password = weak;
    if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
    await assertCanGrant(req, body.role);
    if (await db.users.findOne({ email }, { projection: { id: 1 } })) throw badRequest('An account with that email already exists.', { email: 'Taken' });
    const id = await nextId(db, 'users');
    await insert(db, 'users', { id, email, name, role: body.role, subcity_id: scope, phone: str(body.phone, 40), pass_hash: hashPassword(body.password), must_change_password: body.must_change_password === false ? 0 : 1 });
    await audit(db, req, 'create', 'user', String(id), { email, role: body.role, subcity_id: scope });
    json(res, publicUser(await userById(db, id)), 201);
  });

  r.patch('/api/users/:id', async (req, res) => {
    requirePerm(req, 'users.manage', 'team.manage');
    const id = Number(req.params.id);
    const u = await db.users.findOne({ id });
    if (!u) throw notFound('User not found.');
    await assertManageable(req, u);
    const body = await readJson(req);
    const upd = {};
    if (body.name !== undefined) upd.name = str(body.name, 80) || u.name;
    if (body.phone !== undefined) upd.phone = str(body.phone, 40);
    if (body.role !== undefined && body.role !== u.role) {
      if (!(await roleExists(body.role))) throw badRequest('Unknown role.');
      if (id === req.user.id) throw badRequest('You cannot change your own role. Ask another administrator.');
      await assertCanGrant(req, body.role);
      upd.role = body.role;
    }
    if (body.subcity_id !== undefined) {
      const s = parseScope(body.subcity_id);
      if (s !== null && !(Number.isInteger(s) && s >= 0 && s <= 12)) throw badRequest('Choose a sub-city or city-wide.');
      if (scoped(req) && s !== req.user.subcity_id) throw new HttpError(403, 'You can only assign staff to your own sub-city.');
      if (id === req.user.id && s !== (u.subcity_id ?? null) && !req.user.all) throw badRequest('You cannot change your own sub-city.');
      upd.subcity_id = s;
    }
    if (body.active !== undefined) {
      if (id === req.user.id && !body.active) throw badRequest('You cannot deactivate your own account.');
      upd.active = body.active ? 1 : 0;
    }
    if (body.password) {
      const w = checkPasswordStrength(body.password); if (w) throw badRequest(w, { password: w });
      upd.pass_hash = hashPassword(body.password); upd.must_change_password = 1;
    }
    if (body.unlock) { upd.failed_logins = 0; upd.locked_until = null; }
    if (body.reset_mfa) { upd.mfa_enabled = 0; upd.mfa_secret = null; }
    const losingAdmin = u.role === 'admin' && u.active && ((upd.role && upd.role !== 'admin') || upd.active === 0);
    if (losingAdmin && (await db.users.count({ role: 'admin', active: 1 })) <= 1) {
      throw badRequest('Keep at least one active administrator.');
    }
    upd.updated_at = nowIso();
    const keys = Object.keys(upd);
    await db.users.updateOne({ id }, { $set: upd });
    if (upd.active === 0 || upd.pass_hash || upd.role || body.signout) await db.sessions.deleteMany({ user_id: id });
    const changed = keys.filter((k) => !['pass_hash', 'updated_at', 'mfa_secret', 'failed_logins', 'locked_until', 'must_change_password'].includes(k));
    await audit(db, req, 'update', 'user', String(id), {
      email: u.email, fields: changed.concat(upd.pass_hash ? ['password'] : [], body.reset_mfa ? ['mfa reset'] : [], body.unlock ? ['unlocked'] : [], body.signout ? ['signed out'] : []),
      changes: Object.fromEntries(changed.filter((k) => ['role', 'subcity_id', 'active', 'name'].includes(k)).map((k) => [k, [u[k] ?? null, upd[k]]])),
    });
    json(res, publicUser(await userById(db, id)));
  });

  r.get('/api/users/:id/sessions', async (req, res) => {
    requirePerm(req, 'users.manage', 'team.manage');
    const u = await db.users.findOne({ id: Number(req.params.id) });
    if (!u) throw notFound('User not found.');
    await assertManageable(req, u);
    json(res, { items: await db.sessions.find({ user_id: u.id }, { sort: { created_at: -1 }, projection: { created_at: 1, expires_at: 1, user_agent: 1, ip: 1 } }) });
  });

  /* ----- roles & permissions ----- */
  const toRole = (x) => ({ ...x, permissions: Array.isArray(x.permissions) ? x.permissions : [], is_system: !!x.is_system });
  r.get('/api/permissions', (req, res) => {
    requirePerm(req, 'roles.manage', 'users.manage', 'team.manage');
    json(res, { items: Object.entries(PERMISSIONS).map(([key, v]) => ({ key, ...v })) });
  });
  r.get('/api/roles', async (req, res) => {
    requirePerm(req, 'roles.manage', 'users.manage', 'team.manage', 'audit.view');
    const counts = {};
    for (const u of await db.users.find({ active: 1 }, { projection: { role: 1 } })) counts[u.role] = (counts[u.role] || 0) + 1;
    const order = (k) => { const i = ROLES.indexOf(k); return i < 0 ? 99 : i; };
    const items = (await db.roles.find({})).sort((a, b) => b.level - a.level || order(a.key) - order(b.key) || a.name.localeCompare(b.name));
    const out = [];
    for (const x of items) {
      let assignable = true;
      try { await assertCanGrant(req, x.key); } catch { assignable = false; }
      out.push({ ...toRole(x), users: counts[x.key] || 0, assignable });
    }
    json(res, { items: out });
  });

  function cleanLevel(req, v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 99) throw badRequest('Use a level from 0 to 99.', { level: 'Invalid' });
    if (!req.user.all && n >= (req.user.level ?? 0)) throw new HttpError(403, 'Roles you create must be below your own level.');
    return n;
  }
  function cleanPerms(req, list) {
    const perms = [...new Set((Array.isArray(list) ? list : []).filter((p) => PERMISSIONS[p]))];
    if (!req.user.all) {
      const extra = perms.filter((p) => !req.user.perms.includes(p));
      if (extra.length) throw new HttpError(403, 'You cannot grant permissions you do not have: ' + extra.join(', '));
    }
    return perms;
  }

  r.post('/api/roles', async (req, res) => {
    requirePerm(req, 'roles.manage');
    const body = await readJson(req);
    const name = str(body.name, 60);
    const key = str(body.key || name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!name || !key) throw badRequest('Give the role a name.', { name: 'Required' });
    if (await db.roles.findOne({ _id: key })) throw badRequest('A role with that name already exists.', { name: 'Taken' });
    const perms = cleanPerms(req, body.permissions);
    const level = cleanLevel(req, body.level ?? 30);
    await insert(db, 'roles', { key, name, description: str(body.description, 300), permissions: perms, level }, 'key');
    await audit(db, req, 'create', 'role', key, { name, permissions: perms });
    json(res, toRole(await db.roles.findOne({ _id: key })), 201);
  });

  r.patch('/api/roles/:key', async (req, res) => {
    requirePerm(req, 'roles.manage');
    const cur = await db.roles.findOne({ _id: req.params.key });
    if (!cur) throw notFound('Role not found.');
    const body = await readJson(req);
    if (!req.user.all && cur.level >= (req.user.level ?? 0)) throw new HttpError(403, 'You can only change roles below your own level.');
    const upd = {};
    if (body.level !== undefined && body.level !== cur.level) {
      if (cur.key === 'admin') throw badRequest('The Administrator role is always at the top.');
      upd.level = cleanLevel(req, body.level);
    }
    if (body.name !== undefined) upd.name = str(body.name, 60) || cur.name;
    if (body.description !== undefined) upd.description = str(body.description, 300);
    const before = Array.isArray(cur.permissions) ? cur.permissions : [];
    if (body.permissions !== undefined) {
      if (cur.key === 'admin') throw badRequest('The Bureau administrator role always has every permission.');
      if (req.user.role === cur.key && !req.user.all) throw badRequest('You cannot change the permissions of your own role.');
      upd.permissions = cleanPerms(req, body.permissions);
    }
    upd.updated_at = nowIso();
    await db.roles.updateOne({ _id: cur.key }, { $set: upd });
    const after = upd.permissions || before;
    await audit(db, req, 'update', 'role', cur.key, {
      name: upd.name || cur.name, level: upd.level !== undefined ? [cur.level, upd.level] : undefined,
      added: after.filter((p) => !before.includes(p)), removed: before.filter((p) => !after.includes(p)),
    });
    json(res, toRole(await db.roles.findOne({ _id: cur.key })));
  });

  r.delete('/api/roles/:key', async (req, res) => {
    requirePerm(req, 'roles.manage');
    const cur = await db.roles.findOne({ _id: req.params.key });
    if (!cur) throw notFound('Role not found.');
    if (cur.is_system) throw badRequest('Built-in roles cannot be deleted. Remove their permissions instead.');
    if (await db.users.count({ role: cur.key })) throw badRequest('Move the staff who have this role to another role first.');
    await db.roles.deleteOne({ _id: cur.key });
    await audit(db, req, 'delete', 'role', cur.key, { name: cur.name });
    json(res, { ok: true });
  });

  // Who can do what, for the mobile app and portal menus.
  r.get('/api/auth/can', (req, res) => json(res, { permissions: req.user ? effectivePermissions(req.user, PERMISSION_KEYS) : [], can_publish: can(req, 'places.publish') }));
}

/** Create or reset an administrator (used by scripts/create-admin.js and ADMIN_EMAIL/ADMIN_PASSWORD). */
export async function upsertAdmin(db, { email, name, password }) {
  const e = String(email).trim().toLowerCase();
  const existing = await db.users.findOne({ email: e });
  if (existing) {
    await db.users.updateOne({ id: existing.id }, { $set: { name, role: 'admin', active: 1, pass_hash: hashPassword(password), updated_at: nowIso() } });
    await db.sessions.deleteMany({ user_id: existing.id });
    return { id: existing.id, created: false };
  }
  const id = await nextId(db, 'users');
  await insert(db, 'users', { id, email: e, name, role: 'admin', pass_hash: hashPassword(password) });
  return { id, created: true };
}
