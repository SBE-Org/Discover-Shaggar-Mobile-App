// End-to-end API tests against a real server.
// Run: npm test                     (in-memory database, no MongoDB needed)
//      TEST_MONGODB_URI=mongodb+srv://... npm test   (a real MongoDB; uses and then drops a temporary database)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/index.js';
import { totp } from '../src/lib/auth.js';
import { upsertAdmin } from '../src/api/auth.js';

let server, base, db;
// 1x1 JPEG
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}
async function signIn(email, password = 'correct-horse-42') {
  const c = client();
  const r = await c('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}

before(async () => {
  db = await openDb(process.env.TEST_MONGODB_URI || 'memory', 'shaggar_test_' + randomBytes(4).toString('hex'));
  await upsertAdmin(db, { email: 'admin@city.et', name: 'Admin', password: 'correct-horse-42' });
  server = http.createServer(createApp({ db, frontendDir: '/nonexistent' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { server.close(); await db.store.drop(); await db.close(); });

test('serves the API, the install manifest and the health check', async () => {
  const c = client();
  const home = await c('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Shaggar/);
  assert.equal((await c('GET', '/api/health')).status, 200);
  assert.equal((await c('GET', '/api/nope')).status, 404);
  assert.equal((await c('GET', '/api/v1/subcities')).body.items.length, 13);
  const cfg = await c('GET', '/api/config');
  assert.ok(cfg.body.catalog.sectors.length >= 7);
  assert.equal(cfg.body.user, null);
});

test('public visitors cannot write places; non-JSON writes are refused', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/places', { name: 'X', sector: 'health', type: 'clinic', subcity_id: 1, coords: '9.0, 38.7' })).status, 401);
  const r = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(r.status, 415);
});

test('roles, sub-city scope, workflow without self-approval, publishing, history and restore', async () => {
  const admin = await signIn('ADMIN@city.et');
  assert.equal((await admin('GET', '/api/auth/me')).body.user.permissions.includes('users.manage'), true);
  assert.equal((await admin('PUT', '/api/subcities/3', { name: 'Sebeta', phone: '+251 11 000 0000', coords: '8.917, 38.621' })).status, 200);

  // Staff accounts with different roles.
  for (const [email, role, sub] of [['col@city.et', 'collector', 3], ['rev@city.et', 'reviewer', 3], ['app@city.et', 'approver', ''], ['aud@city.et', 'auditor', '']]) {
    const u = await admin('POST', '/api/users', { email, name: role, role, subcity_id: sub, password: 'correct-horse-42', must_change_password: false });
    assert.equal(u.status, 201, JSON.stringify(u.body));
  }
  const col = await signIn('col@city.et'), rev = await signIn('rev@city.et'), app = await signIn('app@city.et'), aud = await signIn('aud@city.et'), pub = client();

  // Validation errors come back per field.
  const bad = await col('POST', '/api/places', { name: '', sector: 'health', type: 'nope', subcity_id: 3, coords: 'abc' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.name && bad.body.details.type && bad.body.details.coords);
  // Collector is limited to sub-city 3.
  assert.equal((await col('POST', '/api/places', { name: 'Elsewhere', sector: 'health', type: 'hc', subcity_id: 5, coords: '9.0,38.7' })).status, 403);
  // Poor GPS accuracy needs a reason.
  const weak = await col('POST', '/api/places', { name: 'Sebeta Health Centre', sector: 'health', type: 'hc', subcity_id: 3, coords: '8.9184,38.6227', accuracy_m: 45, coord_source: 'gps' });
  assert.equal(weak.status, 400);
  assert.ok(weak.body.details.accuracy_note);

  const created = await col('POST', '/api/places', {
    name: 'Sebeta Health Centre', name_om: 'Buufata Fayyaa Sabbataa', sector: 'health', type: 'hc', subcity_id: 3,
    coords: 'https://www.google.com/maps/@8.9184,38.6227,17z', accuracy_m: 6, coord_source: 'gps', photo: JPEG,
    gps_original: { lat: 8.91852, lon: 38.62281, accuracy_m: 14 }, facilities: ['parking', 'wheelchair', 'bogus'],
    hours_json: { mon: [['08:00', '17:00']] }, submit: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal(created.body.status, 'submitted');
  assert.deepEqual(created.body.facilities, ['parking', 'wheelchair']);
  assert.equal(created.body.evidence.length, 2, 'original GPS reading and final pin are both kept');
  assert.equal(created.body.photos.length, 1);

  // Duplicate warning.
  const dup = await col('POST', '/api/places', { name: 'Sebeta Health Center', sector: 'health', type: 'hc', subcity_id: 3, coords: '8.91845,38.62275' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.details.duplicates[0].id, id);

  // Not public until published; collector cannot verify; reviewer cannot publish.
  assert.equal((await pub('GET', '/api/places')).body.count, 0);
  assert.equal((await pub('GET', '/api/places/' + id)).status, 404);
  assert.equal((await col('POST', `/api/places/${id}/workflow`, { action: 'verify' })).status, 403);
  assert.equal((await rev('POST', `/api/places/${id}/workflow`, { action: 'return' })).status, 400, 'return needs a note');
  const ret = await rev('POST', `/api/places/${id}/workflow`, { action: 'return', note: 'Add opening hours text' });
  assert.equal(ret.body.status, 'needs_correction');
  assert.equal((await col('PATCH', '/api/places/' + id, { hours: 'Mon–Fri 08:00–17:00', submit: true })).body.status, 'submitted');
  assert.equal((await rev('POST', `/api/places/${id}/advance`, {})).body.status, 'verified');
  assert.equal((await rev('POST', `/api/places/${id}/workflow`, { action: 'publish' })).status, 403);

  // Approver cannot publish what they created themselves.
  const own = await app('POST', '/api/places', { name: 'Approver Bank', sector: 'finance', type: 'bank', subcity_id: 3, coords: '8.93,38.63', submit: true });
  assert.equal((await app('POST', `/api/places/${own.body.id}/workflow`, { action: 'verify' })).status, 403);

  const published = await app('POST', `/api/places/${id}/workflow`, { action: 'publish' });
  assert.equal(published.body.status, 'published');
  const list = await pub('GET', '/api/places');
  assert.equal(list.body.count, 1);
  assert.ok(list.body.items[0].cover.startsWith('/uploads/'));
  assert.equal(list.body.items[0].workflow_note, undefined, 'staff fields are not public');
  const photo = await fetch(base + list.body.items[0].cover);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal((await pub('GET', '/api/places?q=buufata')).body.count, 1, 'search finds the Afaan Oromo name');
  assert.equal((await pub('GET', '/api/places?q=health centre')).body.count, 1, 'search finds the category name');
  const near = await pub('GET', '/api/v1/places/nearby?lat=8.92&lon=38.62&radius_m=1000');
  assert.equal(near.body.count, 1);
  assert.ok(near.body.items[0].distance_m > 100 && near.body.items[0].distance_m < 600);

  // Collector can no longer edit the published record; the approver can, and the edit can be restored.
  assert.equal((await col('PATCH', '/api/places/' + id, { phone: '1' })).status, 403);
  const ed = await app('PATCH', '/api/places/' + id, { phone: '+251 11 338 0000', description: 'Main public health centre.' });
  assert.equal(ed.body.phone, '+251 11 338 0000');
  const hist = await app('GET', `/api/places/${id}/history`);
  const editEntry = hist.body.items.find((h) => h.action === 'update' && h.detail.changes?.phone);
  assert.ok(editEntry);
  const restored = await app('POST', `/api/audit/${editEntry.id}/revert`, {});
  assert.equal(restored.status, 200);
  assert.equal(restored.body.place.phone, '');

  // Auditor reads the log and dashboard but cannot change anything.
  assert.equal((await aud('GET', '/api/audit?entity=place')).status, 200);
  assert.equal((await aud('GET', '/api/dashboard')).status, 200);
  assert.equal((await aud('PATCH', '/api/places/' + id, { phone: '2' })).status, 403);
  assert.equal((await aud('GET', '/api/users')).status, 200);
  assert.equal((await aud('POST', '/api/users', { email: 'x@y.et', name: 'x', role: 'admin', password: 'correct-horse-42' })).status, 403);

  // Dashboard coverage.
  const dash = await admin('GET', '/api/dashboard');
  const c3 = dash.body.coverage.find((c) => c.id === 3);
  assert.equal(c3.published, 1);
  assert.equal(c3.awaiting, 1);
  assert.equal(dash.body.quality.missing_translation.count >= 1, true);

  // Self-approval can be allowed in settings.
  assert.equal((await admin('PUT', '/api/settings', { 'workflow.allow_self_approval': true })).status, 200);
  assert.equal((await app('POST', `/api/places/${own.body.id}/workflow`, { action: 'verify' })).body.status, 'verified');
  await admin('PUT', '/api/settings', { 'workflow.allow_self_approval': false });

  // Archive keeps the record but hides it.
  assert.equal((await app('POST', `/api/places/${id}/workflow`, { action: 'archive' })).body.status, 'archived');
  assert.equal((await pub('GET', '/api/places')).body.count, 0);
  assert.equal((await app('POST', `/api/places/${id}/workflow`, { action: 'restore' })).body.status, 'draft');
  assert.equal((await app('DELETE', '/api/places/' + id, {})).status, 403, 'only roles with delete permission');
  assert.equal((await admin('DELETE', '/api/places/' + id, {})).status, 200);
});

test('suggestions, problem reports and CSV import/export', async () => {
  const admin = await signIn('admin@city.et'), pub = client();
  await admin('PUT', '/api/subcities/4', { name: 'Burayu', coords: '9.05, 38.6' });
  const sug = await pub('POST', '/api/suggestions', { name: 'Abdi Pharmacy', sector: 'health', type: 'pharmacy', coords: '38.6301, 9.0510', contact_name: 'Resident', photo: JPEG, photo_consent: true });
  assert.equal(sug.status, 201);
  assert.equal((await pub('GET', '/api/suggestions')).status, 401);
  const s = (await admin('GET', '/api/suggestions')).body.items.find((x) => x.data.name === 'Abdi Pharmacy');
  assert.equal(s.lat, 9.051, 'swapped coordinates are fixed');
  assert.equal(s.data.subcity_id, 4);
  const acc = await admin('POST', `/api/suggestions/${s.id}/accept`, { ...s.data, coords: s.lat + ',' + s.lon, status: 'published' });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(acc.body.status, 'published', 'nobody owns a public suggestion, so a publisher may publish it');
  assert.equal(acc.body.photos[0].rights, 'permission');
  assert.equal((await admin('POST', `/api/suggestions/${s.id}/accept`, {})).status, 409);

  // Problem report with a tracking code.
  const rep = await pub('POST', '/api/reports', { place_id: acc.body.id, issue_type: 'wrong_pin', description: 'The pin is across the road', contact: '0911' });
  assert.equal(rep.status, 201);
  assert.match(rep.body.code, /^SR-[A-Z0-9]{6}$/);
  assert.equal((await pub('GET', '/api/reports/track/' + rep.body.code)).body.status, 'open');
  const reps = await admin('GET', '/api/reports?status=active');
  const rr = reps.body.items.find((x) => x.code === rep.body.code);
  await admin('PATCH', '/api/reports/' + rr.id, { status: 'resolved', resolution: 'Pin moved to the entrance.' });
  const tracked = await pub('GET', '/api/reports/track/' + rep.body.code.toLowerCase());
  assert.equal(tracked.body.status, 'resolved');
  assert.equal(tracked.body.contact, undefined);

  const csv = 'name,sector,type,latitude,longitude,status\nGelan Market,business,market,8.8651,38.8302,published\nOld Status,health,clinic,9.01,38.71,pending\nNo coords,health,clinic,,\n';
  const dry = await admin('POST', '/api/import', { csv, dry_run: true });
  assert.equal(dry.body.ready, 2);
  assert.equal(dry.body.errors.length, 1);
  assert.equal(dry.body.preview[1].status, 'submitted');
  assert.equal((await admin('POST', '/api/import', { csv })).body.imported, 2);
  const exp = await admin('GET', '/api/export.csv');
  assert.match(exp.body, /Gelan Market/);
  assert.equal((await pub('GET', '/api/export.csv')).status, 401);
});

test('trips: publish, register, capacity, updates and privacy of registrations', async () => {
  const admin = await signIn('admin@city.et'), pub = client();
  const start = new Date(Date.now() + 7 * 864e5).toISOString();
  const t = await admin('POST', '/api/trips', {
    title: 'Menagesha forest walk', category: 'nature', subcity_id: 3, start_at: start, capacity: 3, registration_mode: 'register',
    meeting_point: 'Sebeta bus terminal', meeting_coords: '8.92, 38.62', what_to_bring: 'Water, boots',
    stops: [{ title: 'Forest gate', coords: '8.95, 38.55', planned_time: '09:00' }, { title: 'Viewpoint', planned_time: '11:00' }],
  });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.stops.length, 2);
  assert.equal((await pub('GET', '/api/trips/' + t.body.id)).status, 404, 'drafts are private');
  await admin('POST', `/api/trips/${t.body.id}/status`, { status: 'open' });
  const up = await pub('GET', '/api/trips?when=upcoming');
  assert.equal(up.body.items.length, 1);
  assert.equal(up.body.items[0].registration_open, true);

  assert.equal((await pub('POST', `/api/trips/${t.body.id}/registrations`, { name: 'Lensa', phone: '0911 223344', party_size: 2 })).status, 400, 'consent required');
  const reg = await pub('POST', `/api/trips/${t.body.id}/registrations`, { name: 'Lensa', phone: '0911 223344', party_size: 2, consent: true });
  assert.equal(reg.status, 201);
  assert.match(reg.body.code, /^TR-/);
  assert.equal((await pub('POST', `/api/trips/${t.body.id}/registrations`, { name: 'Lensa again', phone: '0911-223344', consent: true })).status, 409, 'same phone twice');
  assert.equal((await pub('POST', `/api/trips/${t.body.id}/registrations`, { name: 'Big group', phone: '0922 000000', party_size: 2, consent: true })).status, 409, 'over capacity');
  assert.equal((await pub('POST', `/api/trips/${t.body.id}/registrations`, { name: 'Abebe', phone: '0922 000000', consent: true })).status, 201);
  assert.equal((await pub('GET', '/api/trips/' + t.body.id)).body.status, 'full');

  // Registrations are personal data: auditors and the public cannot see them.
  assert.equal((await pub('GET', `/api/trips/${t.body.id}/registrations`)).status, 401);
  const regs = await admin('GET', `/api/trips/${t.body.id}/registrations`);
  assert.equal(regs.body.items.length, 2);

  // Cancelling one registration reopens the trip.
  const look = await pub('POST', '/api/registrations/lookup', { code: reg.body.code, phone: '+0911223344', cancel: true });
  assert.equal(look.body.status, 'cancelled');
  assert.equal((await pub('GET', '/api/trips/' + t.body.id)).body.status, 'open');

  // Postponing needs a message, which becomes a public update.
  assert.equal((await admin('POST', `/api/trips/${t.body.id}/status`, { status: 'postponed' })).status, 400);
  const pp = await admin('POST', `/api/trips/${t.body.id}/status`, { status: 'postponed', message: 'Heavy rain expected. New date next week.' });
  assert.equal(pp.body.to_notify, 1);
  assert.equal((await pub('GET', '/api/trips/' + t.body.id)).body.updates[0].message, 'Heavy rain expected. New date next week.');
  assert.equal((await admin('DELETE', '/api/trips/' + t.body.id, {})).status, 400, 'published trips are archived, not deleted');
});

test('content: pages, announcements, categories and settings', async () => {
  const admin = await signIn('admin@city.et'), pub = client();
  assert.equal((await pub('GET', '/api/pages/privacy')).status, 200);
  assert.equal((await admin('PUT', '/api/pages/visitor-guide', { title: 'Visitor guide', body: 'Welcome', title_am: 'የጎብኚዎች መመሪያ' })).status, 201);
  assert.equal((await pub('GET', '/api/pages')).body.items.some((p) => p.slug === 'visitor-guide'), true);
  assert.equal((await admin('DELETE', '/api/pages/privacy', {})).status, 400);

  const a = await admin('POST', '/api/announcements', { title: 'Irreecha this weekend', tone: 'event', ends_at: new Date(Date.now() + 864e5).toISOString() });
  assert.equal(a.status, 201);
  await admin('POST', '/api/announcements', { title: 'Expired', ends_at: '2020-01-01' });
  const anns = await pub('GET', '/api/announcements');
  assert.deepEqual(anns.body.items.map((x) => x.title), ['Irreecha this weekend']);

  const cat = await admin('POST', '/api/catalog/types', { sector: 'tourism', label: 'Camp site', attraction: true });
  assert.equal(cat.status, 201);
  assert.ok(cat.body.types.some((x) => x.key === 'camp_site'));
  const camp = await admin('POST', '/api/places', { name: 'Ridge camp', sector: 'tourism', type: 'camp_site', subcity_id: 3, coords: '8.97,38.58' });
  assert.equal(camp.status, 201, JSON.stringify(camp.body));
  assert.equal((await admin('DELETE', '/api/catalog/types/tourism/camp_site', {})).status, 400, 'in use');
  await admin('PATCH', '/api/catalog/types/tourism/camp_site', { active: false });
  assert.equal((await admin('POST', '/api/places', { name: 'Another camp', sector: 'tourism', type: 'camp_site', subcity_id: 3, coords: '8.99,38.50' })).status, 400, 'retired categories cannot be used for new places');

  assert.equal((await admin('PUT', '/api/settings', { 'gps.max_accuracy_m': 'abc' })).status, 400);
  assert.equal((await pub('GET', '/api/settings')).status, 401);
});

test('permissions: custom roles, no privilege escalation, lockout and two-step sign-in', async () => {
  const admin = await signIn('admin@city.et');
  // A system administrator manages accounts but cannot hand out more than they have.
  await admin('POST', '/api/users', { email: 'sys@city.et', name: 'Sys', role: 'sysadmin', password: 'correct-horse-42', must_change_password: false });
  const sys = await signIn('sys@city.et');
  assert.equal((await sys('POST', '/api/users', { email: 'boss@city.et', name: 'Boss', role: 'admin', password: 'correct-horse-42', must_change_password: false })).status, 403);
  assert.equal((await sys('POST', '/api/roles', { name: 'Publisher', permissions: ['places.publish'] })).status, 403);
  const custom = await sys('POST', '/api/roles', { name: 'Log reader', permissions: ['audit.view'] });
  assert.equal(custom.status, 201);
  assert.equal((await admin('PATCH', '/api/roles/admin', { permissions: [] })).status, 400);
  const tr = await admin('POST', '/api/roles', { name: 'Trip coordinator', permissions: ['trips.manage', 'trips.registrations'] });
  assert.equal(tr.body.key, 'trip_coordinator');
  await admin('POST', '/api/users', { email: 'trip@city.et', name: 'Trips', role: 'trip_coordinator', password: 'correct-horse-42', must_change_password: false });
  const trip = await signIn('trip@city.et');
  assert.equal((await trip('GET', '/api/trips?scope=all')).status, 200);
  assert.equal((await trip('POST', '/api/places', { name: 'x', sector: 'health', type: 'hc', subcity_id: 1, coords: '9,38.7' })).status, 403);
  assert.equal((await admin('DELETE', '/api/roles/trip_coordinator', {})).status, 400, 'role in use');
  assert.equal((await admin('PATCH', '/api/users/1', { role: 'editor' })).status, 400, 'cannot change own role');

  // A temporary password unlocks nothing until it is changed.
  await admin('POST', '/api/users', { email: 'new@city.et', name: 'New', role: 'editor', password: 'temp-pass-2026' });
  const nu = await signIn('new@city.et', 'temp-pass-2026');
  assert.deepEqual((await nu('GET', '/api/auth/me')).body.user.permissions, []);
  assert.equal((await nu('GET', '/api/places?scope=all')).body.items.every((p) => p.status === 'published'), true);
  assert.equal((await nu('POST', '/api/auth/password', { current: 'temp-pass-2026', next: 'my-own-pass-77' })).status, 200);
  assert.ok((await nu('GET', '/api/auth/me')).body.user.permissions.includes('places.create'));

  // Lockout after repeated wrong passwords (rate limiter allows 10 per window).
  const c = client();
  for (let i = 0; i < 8; i++) await c('POST', '/api/auth/login', { email: 'trip@city.et', password: 'wrong-pass-' + i });
  assert.equal((await c('POST', '/api/auth/login', { email: 'trip@city.et', password: 'correct-horse-42' })).status, 423);
  const tu = (await admin('GET', '/api/users')).body.items.find((u) => u.email === 'trip@city.et');
  assert.equal(tu.locked, true);
  await admin('PATCH', '/api/users/' + tu.id, { unlock: true });

  // Two-step sign-in.
  const setup = await sys('POST', '/api/auth/mfa/setup', {});
  assert.match(setup.body.otpauth, /^otpauth:\/\/totp\//);
  assert.equal((await sys('POST', '/api/auth/mfa/enable', { code: '000000' })).status, 400);
  assert.equal((await sys('POST', '/api/auth/mfa/enable', { code: totp(setup.body.secret) })).status, 200);
  const c2 = client();
  const step1 = await c2('POST', '/api/auth/login', { email: 'sys@city.et', password: 'correct-horse-42' });
  assert.equal(step1.body.mfa_required, true);
  assert.equal((await c2('GET', '/api/auth/me')).body.user, null);
  assert.equal((await c2('POST', '/api/auth/login/mfa', { ticket: step1.body.ticket, code: totp(setup.body.secret) })).status, 200);
  assert.equal((await c2('GET', '/api/auth/me')).body.user.email, 'sys@city.et');

  // When MFA is required, privileged permissions are withheld until it is turned on.
  await admin('PUT', '/api/settings', { 'security.require_mfa_admins': true });
  assert.equal((await admin('GET', '/api/users')).status, 200, 'users.manage is not blocked from listing via audit/users');
  assert.equal((await admin('POST', '/api/users', { email: 'z@city.et', name: 'Z', role: 'auditor', password: 'correct-horse-42', must_change_password: false })).status, 403);
  assert.equal((await c2('POST', '/api/users', { email: 'z@city.et', name: 'Z', role: 'log_reader', password: 'correct-horse-42', must_change_password: false })).status, 201);
  assert.equal((await c2('PUT', '/api/settings', { 'security.require_mfa_admins': false })).status, 200, 'sysadmin with MFA keeps settings access');

  const log = await sys('GET', '/api/audit?security=1');
  assert.ok(log.body.items.some((x) => x.action === 'login_failed'));
  assert.ok(log.body.items.every((x) => 'ip' in x));
  const csv = await sys('GET', '/api/audit.csv');
  assert.match(csv.body, /login_failed/);
});

test('hierarchy: data entry → sub-city supervisor approves; supervisors manage their own team only', async () => {
  const admin = await signIn('admin@city.et');
  await admin('PUT', '/api/subcities/7', { name: 'Holeta', coords: '9.06, 38.50' });
  await admin('PUT', '/api/subcities/8', { name: 'Gefersa', coords: '9.08, 38.62' });
  for (const [email, role, sub] of [['sup7@city.et', 'supervisor', 7], ['sup8@city.et', 'supervisor', 8], ['ed@city.et', 'editor', '']]) {
    assert.equal((await admin('POST', '/api/users', { email, name: email.split('@')[0], role, subcity_id: sub, password: 'correct-horse-42', must_change_password: false })).status, 201);
  }
  const sup7 = await signIn('sup7@city.et'), sup8 = await signIn('sup8@city.et'), ed = await signIn('ed@city.et');

  // A supervisor adds data-entry staff, always in their own sub-city, and cannot create another supervisor.
  const de = await sup7('POST', '/api/users', { email: 'de7@city.et', name: 'Data Entry 7', role: 'data_entry', subcity_id: 3, password: 'correct-horse-42', must_change_password: false });
  assert.equal(de.status, 201, JSON.stringify(de.body));
  assert.equal(de.body.subcity_id, 7, 'forced into the supervisor’s sub-city');
  assert.equal((await sup7('POST', '/api/users', { email: 'x7@city.et', name: 'x', role: 'supervisor', password: 'correct-horse-42' })).status, 403);
  assert.equal((await sup8('PATCH', '/api/users/' + de.body.id, { active: false })).status, 403, 'other sub-city');
  const sup8id = (await admin('GET', '/api/users')).body.items.find((u) => u.email === 'sup8@city.et').id;
  assert.equal((await sup7('PATCH', '/api/users/' + sup8id, { active: false })).status, 403, 'same level');
  const team = (await sup7('GET', '/api/users')).body.items;
  assert.ok(team.every((u) => u.subcity_id === 7));
  assert.equal(team.find((u) => u.email === 'de7@city.et').manageable, true);
  const roles = (await sup7('GET', '/api/roles')).body.items;
  assert.deepEqual(roles.filter((r) => r.assignable).map((r) => r.key).sort(), ['collector', 'data_entry', 'reviewer']);

  // Data entry enters a place; only their sub-city supervisor (or someone city-wide) can approve it.
  const dataEntry = await signIn('de7@city.et');
  const p = await dataEntry('POST', '/api/places', { name: 'Holeta Market', sector: 'business', type: 'market', subcity_id: 7, coords: '9.061, 38.501', submit: true });
  assert.equal(p.body.status, 'submitted');
  assert.equal((await dataEntry('POST', `/api/places/${p.body.id}/workflow`, { action: 'approve' })).status, 403);
  assert.equal((await sup8('POST', `/api/places/${p.body.id}/workflow`, { action: 'approve' })).status, 403, 'other sub-city supervisor');
  const ok = await sup7('POST', `/api/places/${p.body.id}/workflow`, { action: 'approve' });
  assert.equal(ok.body.status, 'published', 'one step: approve and publish');
  assert.equal(ok.body.reviewed_by !== undefined, true);
  const dash = await admin('GET', '/api/dashboard');
  const t7 = dash.body.teams.find((t) => t.id === 7);
  assert.equal(t7.supervisors[0].name, 'sup7');
  assert.equal(t7.data_entry, 1);
  assert.equal(dash.body.teams.find((t) => t.id === 9).routed_to, 'central');

  // A central editor's record is above a sub-city supervisor's level.
  const ep = await ed('POST', '/api/places', { name: 'Holeta Museum', sector: 'tourism', type: 'culture', subcity_id: 7, coords: '9.064, 38.505', submit: true });
  const no = await sup7('POST', `/api/places/${ep.body.id}/workflow`, { action: 'approve' });
  assert.equal(no.status, 403);
  assert.match(no.body.error, /Central content editor/);
  assert.equal((await admin('POST', `/api/places/${ep.body.id}/workflow`, { action: 'approve' })).body.status, 'published');
});

test('menus: staff items, data-entry and customer items wait for the supervisor', async () => {
  const admin = await signIn('admin@city.et'), pub = client();
  const sup7 = await signIn('sup7@city.et'), de = await signIn('de7@city.et');
  const r = await de('POST', '/api/places', { name: 'Holeta Kitfo House', sector: 'tourism', type: 'restaurant', subcity_id: 7, coords: '9.0655, 38.5072', submit: true });
  // While the record is a draft/submitted, data entry builds the menu freely; it goes live with the record.
  const item = await de('POST', `/api/places/${r.body.id}/menu`, { section: 'Traditional dishes', name: 'Kitfo', price: '450', tags: ['popular', 'bogus'] });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  assert.equal(item.body.item.status, 'approved');
  assert.deepEqual(item.body.item.tags, ['popular']);
  await sup7('POST', `/api/places/${r.body.id}/workflow`, { action: 'approve' });
  let place = (await pub('GET', '/api/places/' + r.body.id)).body;
  assert.equal(place.menu.length, 1);
  assert.equal(place.menu[0].price, 450);
  // Once live, data-entry changes need approval.
  assert.equal((await de('PATCH', '/api/menu/' + item.body.item.id, { price: 1 })).status, 403);
  const late = await de('POST', `/api/places/${r.body.id}/menu`, { section: 'Coffee & tea', name: 'Buna', price: 40 });
  assert.equal(late.body.item.status, 'pending');
  // Customers suggest an item.
  assert.equal((await pub('POST', `/api/places/${r.body.id}/menu/suggest`, { name: 'Shiro', price: 180, section: 'Fasting dishes', submitter_name: 'Guest' })).status, 201);
  place = (await pub('GET', '/api/places/' + r.body.id)).body;
  assert.equal(place.menu.length, 1, 'pending items are not public');
  const queue = (await sup7('GET', '/api/contributions?kind=menu')).body.items;
  assert.equal(queue.length, 2);
  for (const q of queue) assert.equal((await sup7('POST', `/api/contributions/menu/${q.id}/approve`, { edits: q.name === 'Shiro' ? { price: 200 } : undefined })).status, 200);
  place = (await pub('GET', '/api/places/' + r.body.id)).body;
  assert.deepEqual(place.menu.map((m) => m.name).sort(), ['Buna', 'Kitfo', 'Shiro']);
  assert.equal(place.menu.find((m) => m.name === 'Shiro').price, 200);
  assert.ok(place.menu_updated_at);
  assert.equal((await pub('POST', `/api/places/${(await admin('GET', '/api/places?q=Holeta Market')).body.items[0].id}/menu/suggest`, { name: 'x' })).status, 400, 'markets have no menu');
});

test('visitor photos: pending until approved, metadata stripped, rejected files removed', async () => {
  const pub = client(), sup7 = await signIn('sup7@city.et'), sup8 = await signIn('sup8@city.et'), admin = await signIn('admin@city.et');
  const museum = (await pub('GET', '/api/places?q=Holeta Museum')).body.items[0];
  // JPEG with an EXIF segment carrying a fake GPS marker.
  const raw = Buffer.from(JPEG.split(',')[1], 'base64');
  const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x10]), Buffer.from('Exif\0\0GPSDATA!')]);
  const withExif = Buffer.concat([raw.subarray(0, 2), exif, raw.subarray(2)]);
  const photo = 'data:image/jpeg;base64,' + withExif.toString('base64');
  assert.equal((await pub('POST', `/api/places/${museum.id}/visitor-photos`, { photo })).status, 400, 'consent required');
  assert.equal((await pub('POST', `/api/places/${museum.id}/visitor-photos`, { photo, consent: true, name: 'Hana', caption: 'Main hall' })).status, 201);
  assert.equal((await pub('GET', '/api/places/' + museum.id)).body.photos.length, 0);
  assert.equal((await sup8('GET', '/api/contributions?kind=photo')).body.items.length, 0, 'other sub-city does not see it');
  const q = (await sup7('GET', '/api/contributions?kind=photo')).body.items[0];
  assert.equal(q.submitter_name, 'Hana');
  const file = await fetch(base + q.url);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(bytes.includes(Buffer.from('GPSDATA')), false, 'EXIF removed');
  assert.equal((await sup7('POST', `/api/contributions/photo/${q.id}/approve`, {})).status, 200);
  const shown = (await pub('GET', '/api/places/' + museum.id)).body;
  assert.equal(shown.photos[0].credit, 'Hana');
  assert.equal(shown.photos[0].source, 'visitor');
  // Rejected photos are deleted from disk.
  await pub('POST', `/api/places/${museum.id}/visitor-photos`, { photo, consent: true });
  const q2 = (await admin('GET', '/api/contributions?kind=photo')).body.items[0];
  await admin('POST', `/api/contributions/photo/${q2.id}/reject`, { note: 'Blurry' });
  assert.equal((await fetch(base + q2.url)).status, 404);
  const market = (await pub('GET', '/api/places?q=Holeta Market')).body.items[0];
  assert.equal((await pub('POST', `/api/places/${market.id}/visitor-photos`, { photo, consent: true })).status, 400, 'tourism places only');
});

test('branding: name, colour and logo appear in config and the install manifest', async () => {
  const admin = await signIn('admin@city.et'), pub = client();
  assert.equal((await admin('PUT', '/api/settings', { 'brand.primary': 'red' })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { 'site.name': 'Discover Shaggar City', 'brand.primary': '#B0122B', 'brand.logo': 'hack.png' })).status, 200);
  const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 2, 0, 0, 0, 2, 0, 8, 6, 0, 0, 0]), Buffer.alloc(20)]).toString('base64');
  const up = await admin('POST', '/api/branding/logo', { image: png });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const cfg = (await pub('GET', '/api/config')).body.settings;
  assert.equal(cfg['site.name'], 'Discover Shaggar City');
  assert.equal(cfg['brand.primary'], '#B0122B');
  assert.match(cfg['brand.logo'], /\.png$/);
  const man = await pub('GET', '/manifest.webmanifest');
  const m = typeof man.body === 'string' ? JSON.parse(man.body) : man.body;
  assert.equal(m.name, 'Discover Shaggar City');
  assert.equal(m.icons[0].sizes, '512x512');
  assert.equal((await pub('POST', '/api/branding/logo', { image: png })).status, 401);
  assert.equal((await admin('DELETE', '/api/branding/logo', {})).body.values['brand.logo'], '');
});

test('blocks path traversal and bad images', async () => {
  const r = await fetch(base + '/uploads/..%2f..%2fpackage.json');
  assert.equal(r.status, 404);
  const c = client();
  const s = await c('POST', '/api/suggestions', { name: 'X', sector: 'health', type: 'clinic', coords: '9,38.7', photo: 'data:image/png;base64,AAAA' });
  assert.equal(s.status, 400);
});
