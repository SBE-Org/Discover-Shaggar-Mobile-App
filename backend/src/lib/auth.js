// Passwords (scrypt), sessions (random token in an HttpOnly cookie, hashed in the database),
// role-based permissions with sub-city scoping, and time-based one-time codes (TOTP) for two-step sign-in.
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { HttpError, parseCookies, setCookie } from './http.js';
import { config } from '../config.js';
import { setting, insert, nowIso } from '../db.js';

const COOKIE = 'sdc_session';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use a password of at least 10 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use both letters and numbers in the password.';
  return null;
}

export const sha = (s) => createHash('sha256').update(s).digest('hex');

export async function createSession(db, req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const days = Number(setting(db, 'security.session_days')) || config.sessionDays;
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  await insert(db, 'sessions', { token_hash: sha(token), user_id: userId, expires_at: expires, user_agent: String(req.headers['user-agent'] || '').slice(0, 200), ip: req.ip || null }, 'token_hash');
  setCookie(res, COOKIE, token, { maxAgeSec: days * 86400, secure: config.production, crossSite: req.crossSite });
}

export async function destroySession(db, req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await db.sessions.deleteOne({ _id: sha(token) });
  setCookie(res, COOKIE, '', { maxAgeSec: 0, secure: config.production, crossSite: req.crossSite });
}

/* ---------- permissions ---------- */
// Permissions that need two-step sign-in when the "require MFA" setting is on.
export const PRIVILEGED = ['places.publish', 'places.delete', 'users.manage', 'team.manage', 'roles.manage', 'settings.manage', 'system.backup'];

export const roleLevel = async (db, roleKey) => (await db.roles.findOne({ _id: roleKey }, { projection: { level: 1 } }))?.level ?? 0;
export async function userLevel(db, userId) {
  if (!userId) return 0;
  const u = await db.users.findOne({ id: userId }, { projection: { role: 1 } });
  return u ? roleLevel(db, u.role) : 0;
}

export async function rolePermissions(db, roleKey) {
  const r = await db.roles.findOne({ _id: roleKey }, { projection: { permissions: 1 } });
  return Array.isArray(r?.permissions) ? r.permissions : [];
}

/** Attach req.user (or null) from the session cookie, with the role's permissions. */
export async function loadUser(db, req) {
  const token = parseCookies(req)[COOKIE];
  req.user = null;
  if (!token) return;
  const s = await db.sessions.findOne({ _id: sha(token) });
  if (!s) return;
  const u = await db.users.findOne({ id: s.user_id });
  if (!u || s.expires_at < nowIso() || !u.active) {
    await db.sessions.deleteOne({ _id: sha(token) });
    return;
  }
  const r = await db.roles.findOne({ _id: u.role });
  let perms = Array.isArray(r?.permissions) ? [...r.permissions] : [];
  // A temporary password unlocks nothing until the person chooses their own.
  if (u.must_change_password) perms = [];
  const all = perms.includes('*');
  const mfaGate = !!setting(db, 'security.require_mfa_admins') && !u.mfa_enabled;
  req.user = {
    id: u.id, email: u.email, name: u.name, role: u.role, role_name: r?.name || u.role, level: r?.level ?? 0,
    subcity_id: u.subcity_id ?? null, all, perms, mfa_enabled: !!u.mfa_enabled, mfa_gate: mfaGate,
    must_change_password: !!u.must_change_password,
  };
}

/** Does the signed-in user hold this permission? */
export function can(req, perm) {
  const u = req.user;
  if (!u) return false;
  if (u.mfa_gate && PRIVILEGED.includes(perm)) return false;
  return u.all || u.perms.includes(perm);
}
/** The permission list sent to the browser so it can show the right tools. */
export function effectivePermissions(u, keys) {
  if (!u) return [];
  return keys.filter((k) => (u.all || u.perms.includes(k)) && !(u.mfa_gate && PRIVILEGED.includes(k)));
}

export const requireUser = (req) => {
  if (!req.user) throw new HttpError(401, 'Sign in to continue.');
};
/** Require at least one of the given permissions. */
export function requirePerm(req, ...perms) {
  requireUser(req);
  if (perms.some((p) => can(req, p))) return;
  if (req.user.mfa_gate && perms.some((p) => PRIVILEGED.includes(p) && (req.user.all || req.user.perms.includes(p)))) {
    throw new HttpError(403, 'Turn on two-step sign-in in your account before using this.');
  }
  throw new HttpError(403, 'Your role does not allow this.');
}
/** Staff limited to one sub-city may only work on records in that sub-city (enforced on the server). */
export const inScope = (req, subcityId) => !req.user || req.user.subcity_id === null || req.user.subcity_id === undefined || Number(subcityId) === req.user.subcity_id;
export function requireScope(req, subcityId) {
  if (!inScope(req, subcityId)) throw new HttpError(403, 'This record belongs to another sub-city.');
}
export const isStaff = (req) => !!req.user && (req.user.all || req.user.perms.length > 0);

export async function pruneSessions(db) {
  await db.sessions.deleteMany({ expires_at: { $lt: nowIso() } });
}

/* ---------- TOTP (RFC 6238), compatible with Google Authenticator, Microsoft Authenticator and others ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));
export function totp(secret, t = Date.now(), step = 30) {
  const counter = Math.floor(t / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
export function verifyTotp(secret, code, t = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return false;
  for (const w of [0, -1, 1]) if (totp(secret, t + w * 30000) === c) return true;
  return false;
}
