// Trips and events (spec 5.4, 7.3): public listing and details, registration or enquiry,
// staff management of schedules, stops, status changes, public updates and registrations.
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { json, readJson, notFound, badRequest, HttpError, send } from '../lib/http.js';
import { requirePerm, can, requireScope } from '../lib/auth.js';
import { str, EMAIL, parseDateTime } from '../lib/validate.js';
import { savePhoto, removePhotoFile } from '../lib/photos.js';
import { rateLimit } from '../lib/ratelimit.js';
import { audit, nowIso, setting, insert, nextId } from '../db.js';
import { toCsv } from '../lib/csv.js';
import { config } from '../config.js';
import { TRIP_STATUSES, PUBLIC_TRIP_STATUSES, TRIP_CATEGORIES, REGISTRATION_MODES, PHOTO_RIGHTS } from '../shared/catalog.js';
import { parseCoords } from '../shared/coords.js';

const limitReg = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many registrations from this connection. Try again later.' });
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => 'TR-' + [...randomBytes(6)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const endOf = (t) => t.end_at || t.start_at;
const digits = (s) => String(s || '').replace(/\D/g, '');

const TEXT = {
  title: 140, title_om: 140, title_am: 140, summary: 300, description: 6000, description_om: 6000, description_am: 6000,
  date_note: 160, meeting_point: 240, organizer: 120, contact_phone: 40, contact_email: 120, price: 120, includes: 1500,
  excludes: 1500, what_to_bring: 1500, accessibility: 800, safety: 1500, eligibility: 400, language: 80, duration_note: 120,
  cancellation_policy: 1500, recap: 4000,
};

async function validateTrip(db, input, partial) {
  const errors = {}, out = {};
  const has = (k) => input[k] !== undefined;
  for (const [k, max] of Object.entries(TEXT)) if (!partial || has(k)) out[k] = str(input[k], max);
  if ((!partial || has('title')) && !out.title) errors.title = 'Give the trip or event a title.';
  if (out.contact_email && !EMAIL.test(out.contact_email)) errors.contact_email = 'Enter a valid email.';
  if (!partial || has('category')) out.category = TRIP_CATEGORIES[input.category] ? input.category : 'other';
  if (!partial || has('subcity_id')) {
    const s = input.subcity_id === '' || input.subcity_id === null || input.subcity_id === undefined ? null : Number(input.subcity_id);
    if (s !== null && !(Number.isInteger(s) && s >= 0 && s <= 12)) errors.subcity_id = 'Choose a sub-city or city-wide.';
    else out.subcity_id = s;
  }
  if (!partial || has('start_at')) out.start_at = parseDateTime(input.start_at, 'start_at', errors, { required: true });
  if (!partial || has('end_at')) out.end_at = parseDateTime(input.end_at, 'end_at', errors);
  if (!partial || has('registration_closes_at')) out.registration_closes_at = parseDateTime(input.registration_closes_at, 'registration_closes_at', errors);
  const start = out.start_at, end = out.end_at;
  if (start && end && end < start) errors.end_at = 'The end must be after the start.';
  if (!partial || has('meeting_coords')) {
    out.meeting_lat = null; out.meeting_lon = null;
    if (input.meeting_coords) {
      const p = parseCoords(input.meeting_coords);
      if (!p || p.error) errors.meeting_coords = p?.error || 'Invalid coordinates.';
      else { out.meeting_lat = p.lat; out.meeting_lon = p.lon; }
    }
  }
  if (!partial || has('meeting_place_id')) {
    out.meeting_place_id = input.meeting_place_id ? String(input.meeting_place_id) : null;
    if (out.meeting_place_id && !(await db.places.findOne({ _id: out.meeting_place_id }, { projection: { id: 1 } }))) errors.meeting_place_id = 'That place no longer exists.';
  }
  if (!partial || has('capacity')) {
    const c = input.capacity === '' || input.capacity === null || input.capacity === undefined ? null : Number(input.capacity);
    if (c !== null && !(Number.isInteger(c) && c > 0 && c <= 100000)) errors.capacity = 'Use a whole number, or leave empty for no limit.';
    else out.capacity = c;
  }
  if (!partial || has('is_free')) out.is_free = input.is_free === false || input.is_free === 0 ? 0 : 1;
  if (!partial || has('featured')) out.featured = input.featured ? 1 : 0;
  if (!partial || has('registration_mode')) out.registration_mode = REGISTRATION_MODES[input.registration_mode] ? input.registration_mode : 'none';
  if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
  return out;
}

async function validateStops(db, list) {
  if (!Array.isArray(list)) return null;
  const errors = {};
  const out = [];
  for (const [i, s] of list.slice(0, 40).entries()) {
    const o = { seq: i + 1, place_id: s.place_id ? String(s.place_id) : null, title: str(s.title, 140), planned_time: str(s.planned_time, 40), notes: str(s.notes, 500), lat: null, lon: null };
    if (o.place_id && !(await db.places.findOne({ _id: o.place_id }, { projection: { id: 1 } }))) errors['stop' + i] = `Stop ${i + 1}: that place no longer exists.`;
    if (s.coords) { const p = parseCoords(s.coords); if (p && !p.error) { o.lat = p.lat; o.lon = p.lon; } else errors['stop' + i] = `Stop ${i + 1}: ${p?.error || 'invalid coordinates'}`; }
    if (!o.place_id && !o.title) errors['stop' + i] = `Stop ${i + 1}: choose a place or type a name.`;
    out.push(o);
  }
  if (Object.keys(errors).length) throw badRequest(Object.values(errors)[0], errors);
  return out;
}

/** People registered (confirmed or attended), all registrations, and open enquiries for each trip. */
async function countsFor(db, ids) {
  const out = Object.fromEntries(ids.map((id) => [id, { registered: 0, registrations: 0, enquiries: 0 }]));
  if (!ids.length) return out;
  for (const g of await db.registrations.find({ trip_id: { $in: ids } }, { projection: { trip_id: 1, kind: 1, status: 1, party_size: 1 } })) {
    const c = out[g.trip_id];
    c.registrations++;
    if (g.kind === 'register' && ['confirmed', 'attended'].includes(g.status)) c.registered += g.party_size || 0;
    if (g.kind === 'enquiry' && g.status !== 'cancelled') c.enquiries++;
  }
  return out;
}
const counts = async (db, id) => (await countsFor(db, [id]))[id];

async function toTrip(db, t, { staff = false, detail = false, c = null } = {}) {
  c = c || await counts(db, t.id);
  const now = nowIso();
  const o = {
    ...t, featured: !!t.featured, is_free: !!t.is_free,
    cover: t.cover_file ? '/uploads/' + t.cover_file : null,
    registered: c.registered, spots_left: t.capacity ? Math.max(0, t.capacity - c.registered) : null,
    past: t.status === 'completed' || endOf(t) < now,
    registration_open: ['open'].includes(t.status) && t.registration_mode !== 'none' && (!t.registration_closes_at || t.registration_closes_at > now) && endOf(t) >= now && (!t.capacity || c.registered < t.capacity || t.registration_mode === 'enquiry'),
  };
  delete o.cover_file;
  if (staff) Object.assign(o, { registrations: c.registrations, enquiries: c.enquiries });
  else { delete o.created_by; delete o.updated_by; }
  if (detail) {
    const stops = await db.stops.find({ trip_id: t.id }, { sort: { seq: 1 } });
    const pids = [...new Set(stops.map((s) => s.place_id).filter(Boolean))];
    const places = Object.fromEntries((pids.length ? await db.places.find({ id: { $in: pids } }, { projection: { id: 1, name: 1, lat: 1, lon: 1, sector: 1, type: 1, status: 1 } }) : []).map((p) => [p.id, p]));
    o.stops = stops.map((s) => {
      const p = places[s.place_id] || {};
      return {
        seq: s.seq, place_id: staff || p.status === 'published' ? (places[s.place_id] ? s.place_id : null) : null, title: s.title || p.name || '', place_name: p.name ?? null,
        lat: s.lat ?? p.lat ?? null, lon: s.lon ?? p.lon ?? null, sector: p.sector ?? null, type: p.type ?? null, planned_time: s.planned_time, notes: s.notes,
      };
    });
    o.updates = (await db.tripUpdates.find({ trip_id: t.id }, { sort: { created_at: -1, id: -1 } })).map((u) => ({ id: u.id, message: u.message, created_at: u.created_at }));
    o.photos = (await db.tripPhotos.find(staff ? { trip_id: t.id } : { trip_id: t.id, rights: { $in: ['bureau', 'licensed', 'permission'] } }, { sort: { sort: 1, created_at: 1 } }))
      .map((p) => ({ id: p.id, url: '/uploads/' + p.file, caption: p.caption, credit: p.credit, ...(staff ? { rights: p.rights } : {}) }));
    if (t.meeting_place_id) {
      const mp = await db.places.findOne({ _id: t.meeting_place_id }, { projection: { id: 1, name: 1, lat: 1, lon: 1, status: 1 } });
      if (mp) o.meeting_place = { id: staff || mp.status === 'published' ? mp.id : null, name: mp.name, lat: mp.lat, lon: mp.lon };
    }
  }
  return o;
}

/** Remove trip registrations older than the retention period after the trip ended (spec 12.2). */
export async function pruneRegistrations(db) {
  const days = Number(setting(db, 'privacy.registration_retention_days')) || 180;
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const old = await db.trips.find({ $or: [{ end_at: { $lt: cutoff } }, { end_at: null, start_at: { $lt: cutoff } }] }, { projection: { id: 1 } });
  const info = old.length ? await db.registrations.deleteMany({ trip_id: { $in: old.map((t) => t.id) } }) : { deleted: 0 };
  if (info.deleted) await audit(db, null, 'retention', 'registration', null, { deleted: info.deleted, older_than_days: days });
  const rdays = Number(setting(db, 'privacy.report_contact_retention_days')) || 365;
  await db.reports.updateMany({ contact: { $ne: '' }, status: { $in: ['resolved', 'rejected'] }, resolved_at: { $lt: new Date(Date.now() - rdays * 864e5).toISOString() } }, { $set: { contact: '' } });
  return info.deleted;
}

export default function register(r, { db }) {
  const getRow = (id) => db.trips.findOne({ _id: id });
  const detailOf = async (id) => toTrip(db, await getRow(id), { staff: true, detail: true });

  r.get('/api/trips', async (req, res) => {
    const q = req.query;
    const staff = q.get('scope') === 'all' && can(req, 'trips.manage');
    const and = [];
    if (!staff) and.push({ status: { $in: PUBLIC_TRIP_STATUSES } });
    else if (TRIP_STATUSES.includes(q.get('status'))) and.push({ status: q.get('status') });
    const when = q.get('when');
    const now = nowIso();
    if (when === 'upcoming') and.push({ $or: [{ end_at: { $gte: now } }, { end_at: null, start_at: { $gte: now } }] }, { status: { $nin: ['completed', 'archived'] } });
    if (when === 'past') and.push({ $or: [{ end_at: { $lt: now } }, { end_at: null, start_at: { $lt: now } }, { status: 'completed' }] });
    if (q.get('subcity')) and.push({ subcity_id: Number(q.get('subcity')) });
    if (TRIP_CATEGORIES[q.get('category')]) and.push({ category: q.get('category') });
    if (q.get('featured') === '1') and.push({ featured: 1 });
    const rows = await db.trips.find(and.length ? { $and: and } : {}, { sort: { start_at: when === 'past' ? -1 : 1 }, limit: 300 });
    const c = await countsFor(db, rows.map((t) => t.id));
    const items = [];
    for (const t of rows) items.push(await toTrip(db, t, { staff, c: c[t.id] }));
    json(res, { items });
  });

  r.get('/api/trips/:id', async (req, res) => {
    const t = await getRow(req.params.id);
    const staff = can(req, 'trips.manage');
    if (!t || (!staff && !PUBLIC_TRIP_STATUSES.includes(t.status))) throw notFound('Trip not found.');
    json(res, await toTrip(db, t, { staff, detail: true }));
  });

  /* ----- public registration or enquiry (FR-033) ----- */
  r.post('/api/trips/:id/registrations', async (req, res) => {
    limitReg('t:' + req.ip);
    const body = await readJson(req);
    if (body.hp) return json(res, { ok: true, code: newCode() }, 201);
    const t = await getRow(req.params.id);
    if (!t || !PUBLIC_TRIP_STATUSES.includes(t.status)) throw notFound('Trip not found.');
    const view = await toTrip(db, t);
    if (t.registration_mode === 'none') throw badRequest('This trip does not take registrations. Contact the organiser.');
    if (!view.registration_open && !(t.registration_mode === 'enquiry' && ['scheduled', 'open', 'full', 'postponed'].includes(t.status) && !view.past)) {
      throw new HttpError(409, t.status === 'full' ? 'This trip is full.' : 'Registration is closed for this trip.');
    }
    const errors = {};
    const name = str(body.name, 80), phone = str(body.phone, 40), email = str(body.email, 120);
    const party = Math.max(1, Math.min(20, Number(body.party_size) || 1));
    if (!name) errors.name = 'Enter your name.';
    if (!/^[+\d][\d\s-]{6,}$/.test(phone)) errors.phone = 'Enter a phone number so the organiser can reach you.';
    if (email && !EMAIL.test(email)) errors.email = 'Enter a valid email or leave it empty.';
    if (!body.consent) errors.consent = 'Please agree to the privacy notice.';
    if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
    const kind = t.registration_mode === 'enquiry' ? 'enquiry' : 'register';
    const phoneKey = digits(phone);
    const dup = (await db.registrations.find({ trip_id: t.id, status: { $ne: 'cancelled' } }, { projection: { phone: 1, code: 1 } })).find((g) => digits(g.phone) === phoneKey);
    if (dup) throw new HttpError(409, 'This phone number is already registered for this trip. Your code is ' + dup.code + '.', { code: dup.code });
    const c = await counts(db, t.id);
    if (kind === 'register' && t.capacity && c.registered + party > t.capacity) {
      throw new HttpError(409, t.capacity - c.registered > 0 ? `Only ${t.capacity - c.registered} place(s) left.` : 'This trip is full.');
    }
    let code; do { code = newCode(); } while (await db.registrations.findOne({ code }, { projection: { id: 1 } }));
    await insert(db, 'registrations', {
      id: randomUUID(), trip_id: t.id, code, name, phone, email, party_size: party, notes: str(body.notes, 500), consent: 1, kind,
      ip_hash: createHash('sha256').update(config.ipSalt + req.ip).digest('hex').slice(0, 24),
    });
    if (kind === 'register' && t.capacity && c.registered + party >= t.capacity && t.status === 'open') {
      await db.trips.updateOne({ _id: t.id }, { $set: { status: 'full', updated_at: nowIso() } });
      await audit(db, null, 'status', 'trip', t.id, { title: t.title, from: 'open', to: 'full', auto: true });
    }
    json(res, { ok: true, code, kind }, 201);
  });

  // Participants can look up or cancel their own registration with the code and phone number.
  r.post('/api/registrations/lookup', async (req, res) => {
    limitReg('l:' + req.ip);
    const body = await readJson(req);
    const g = await db.registrations.findOne({ code: String(body.code || '').toUpperCase().trim() });
    const t = g ? await getRow(g.trip_id) : null;
    if (!g || !t || digits(g.phone) !== digits(body.phone)) throw notFound('No registration matches that code and phone number.');
    const x = { code: g.code, status: g.status, party_size: g.party_size, kind: g.kind, created_at: g.created_at, trip_id: t.id, title: t.title, start_at: t.start_at, trip_status: t.status };
    if (body.cancel && x.status !== 'cancelled') {
      await db.registrations.updateOne({ code: g.code }, { $set: { status: 'cancelled', updated_at: nowIso() } });
      if (t.status === 'full' && t.capacity && (await counts(db, t.id)).registered < t.capacity) await db.trips.updateOne({ _id: t.id }, { $set: { status: 'open' } });
      x.status = 'cancelled';
    }
    json(res, x);
  });

  /* ----- staff ----- */
  async function saveStops(id, stops) {
    if (!stops) return;
    await db.stops.deleteMany({ trip_id: id });
    for (const s of stops) await insert(db, 'stops', { id: await nextId(db, 'trip_stops'), trip_id: id, ...s });
  }

  r.post('/api/trips', async (req, res) => {
    requirePerm(req, 'trips.manage');
    const body = await readJson(req, 8 * 1024 * 1024);
    const data = await validateTrip(db, body, false);
    if (data.subcity_id !== null) requireScope(req, data.subcity_id);
    const stops = await validateStops(db, body.stops || []);
    const status = TRIP_STATUSES.includes(body.status) ? body.status : 'draft';
    const id = randomUUID();
    const cover = typeof body.cover === 'string' && body.cover ? await savePhoto(db, body.cover) : null;
    await insert(db, 'trips', { id, status, created_by: req.user.id, updated_by: req.user.id, ...data, cover_file: cover });
    await saveStops(id, stops);
    await audit(db, req, 'create', 'trip', id, { title: data.title, status });
    json(res, await detailOf(id), 201);
  });

  r.patch('/api/trips/:id', async (req, res) => {
    requirePerm(req, 'trips.manage');
    const cur = await getRow(req.params.id);
    if (!cur) throw notFound('Trip not found.');
    if (cur.subcity_id !== null && cur.subcity_id !== undefined) requireScope(req, cur.subcity_id);
    const body = await readJson(req, 8 * 1024 * 1024);
    const data = await validateTrip(db, body, true);
    const stops = await validateStops(db, body.stops);
    const changes = {};
    for (const [k, v] of Object.entries(data)) if (cur[k] !== v && !(cur[k] == null && v == null)) changes[k] = [cur[k] ?? null, v];
    const keys = Object.keys(changes);
    if (keys.length) await db.trips.updateOne({ _id: cur.id }, { $set: { ...Object.fromEntries(keys.map((k) => [k, data[k]])), updated_at: nowIso(), updated_by: req.user.id } });
    if (stops) await saveStops(cur.id, stops);
    if (typeof body.cover === 'string' && body.cover) {
      await db.trips.updateOne({ _id: cur.id }, { $set: { cover_file: await savePhoto(db, body.cover) } });
      await removePhotoFile(db, cur.cover_file);
    }
    // Changing the time of a published trip leaves a public note (FR-035).
    if ((changes.start_at || changes.meeting_point) && PUBLIC_TRIP_STATUSES.includes(cur.status) && body.notify !== false) {
      await insert(db, 'tripUpdates', {
        id: await nextId(db, 'trip_updates'), trip_id: cur.id, created_by: req.user.id,
        message: changes.start_at ? 'The start time changed. Check the new date and time.' : 'The meeting point changed. Check the new details.',
      });
    }
    await audit(db, req, 'update', 'trip', cur.id, { title: data.title || cur.title, changes, stops: stops ? stops.length : undefined, cover: body.cover ? true : undefined });
    json(res, await detailOf(cur.id));
  });

  r.post('/api/trips/:id/status', async (req, res) => {
    requirePerm(req, 'trips.manage');
    const cur = await getRow(req.params.id);
    if (!cur) throw notFound('Trip not found.');
    if (cur.subcity_id !== null && cur.subcity_id !== undefined) requireScope(req, cur.subcity_id);
    const body = await readJson(req);
    if (!TRIP_STATUSES.includes(body.status)) throw badRequest('Unknown status.');
    const msg = str(body.message, 1000);
    if (['cancelled', 'postponed'].includes(body.status) && !msg) throw badRequest('Tell participants why and what happens next.', { message: 'Required' });
    await db.trips.updateOne({ _id: cur.id }, { $set: { status: body.status, updated_at: nowIso(), updated_by: req.user.id } });
    if (msg) await insert(db, 'tripUpdates', { id: await nextId(db, 'trip_updates'), trip_id: cur.id, message: msg, created_by: req.user.id });
    await audit(db, req, 'status', 'trip', cur.id, { title: cur.title, from: cur.status, to: body.status, message: msg || undefined });
    const n = await db.registrations.count({ trip_id: cur.id, status: { $ne: 'cancelled' } });
    json(res, { ...(await detailOf(cur.id)), to_notify: n });
  });

  r.post('/api/trips/:id/updates', async (req, res) => {
    requirePerm(req, 'trips.manage');
    const cur = await getRow(req.params.id);
    if (!cur) throw notFound('Trip not found.');
    const body = await readJson(req);
    const msg = str(body.message, 1000);
    if (!msg) throw badRequest('Write the update.', { message: 'Required' });
    await insert(db, 'tripUpdates', { id: await nextId(db, 'trip_updates'), trip_id: cur.id, message: msg, created_by: req.user.id });
    await audit(db, req, 'trip_update', 'trip', cur.id, { title: cur.title, message: msg });
    json(res, await detailOf(cur.id), 201);
  });
  r.delete('/api/trips/:id/updates/:uid', async (req, res) => {
    requirePerm(req, 'trips.manage');
    await db.tripUpdates.deleteOne({ id: Number(req.params.uid), trip_id: req.params.id });
    await audit(db, req, 'trip_update_delete', 'trip', req.params.id);
    if (!(await getRow(req.params.id))) throw notFound('Trip not found.');
    json(res, await detailOf(req.params.id));
  });

  r.post('/api/trips/:id/photos', async (req, res) => {
    requirePerm(req, 'trips.manage');
    if (!(await getRow(req.params.id))) throw notFound('Trip not found.');
    const body = await readJson(req, 8 * 1024 * 1024);
    const file = await savePhoto(db, body.photo);
    await insert(db, 'tripPhotos', { id: randomUUID(), trip_id: req.params.id, file, caption: str(body.caption, 200), credit: str(body.credit, 120), rights: PHOTO_RIGHTS[body.rights] ? body.rights : 'bureau', created_by: req.user.id });
    await audit(db, req, 'photo_add', 'trip', req.params.id);
    json(res, await detailOf(req.params.id), 201);
  });
  r.delete('/api/trip-photos/:id', async (req, res) => {
    requirePerm(req, 'trips.manage');
    const ph = await db.tripPhotos.findOne({ _id: req.params.id });
    if (!ph) throw notFound('Photo not found.');
    await db.tripPhotos.deleteOne({ _id: ph.id });
    await removePhotoFile(db, ph.file);
    await audit(db, req, 'photo_delete', 'trip', ph.trip_id);
    json(res, await detailOf(ph.trip_id));
  });

  r.delete('/api/trips/:id', async (req, res) => {
    requirePerm(req, 'trips.manage');
    const cur = await getRow(req.params.id);
    if (!cur) throw notFound('Trip not found.');
    if (cur.status !== 'draft') throw badRequest('Only drafts can be deleted. Archive or cancel published trips so their history stays available.');
    const files = (await db.tripPhotos.find({ trip_id: cur.id }, { projection: { file: 1 } })).map((x) => x.file).concat(cur.cover_file || []);
    for (const col of [db.stops, db.tripUpdates, db.tripPhotos, db.registrations]) await col.deleteMany({ trip_id: cur.id });
    await db.trips.deleteOne({ _id: cur.id });
    for (const f of files) await removePhotoFile(db, f);
    await audit(db, req, 'delete', 'trip', cur.id, { title: cur.title });
    json(res, { ok: true });
  });

  /* ----- registrations (personal data: separate permission) ----- */
  const regRows = (id) => db.registrations.find({ trip_id: id }, { sort: { created_at: 1 }, projection: { id: 1, code: 1, name: 1, phone: 1, email: 1, party_size: 1, notes: 1, kind: 1, status: 1, created_at: 1 } });
  r.get('/api/trips/:id/registrations', async (req, res) => {
    requirePerm(req, 'trips.registrations');
    if (!(await getRow(req.params.id))) throw notFound('Trip not found.');
    await audit(db, req, 'view', 'registrations', req.params.id);
    json(res, { items: await regRows(req.params.id) });
  });
  r.patch('/api/registrations/:id', async (req, res) => {
    requirePerm(req, 'trips.registrations');
    const body = await readJson(req);
    if (!['confirmed', 'waitlist', 'cancelled', 'attended', 'no_show'].includes(body.status)) throw badRequest('Unknown status.');
    const g = await db.registrations.findOne({ _id: req.params.id });
    if (!g) throw notFound('Registration not found.');
    await db.registrations.updateOne({ _id: g.id }, { $set: { status: body.status, updated_at: nowIso() } });
    await audit(db, req, 'update', 'registration', g.code, { from: g.status, to: body.status });
    json(res, { ok: true });
  });
  r.get('/api/trips/:id/registrations.csv', async (req, res) => {
    requirePerm(req, 'trips.registrations');
    const t = await getRow(req.params.id);
    if (!t) throw notFound('Trip not found.');
    await audit(db, req, 'export', 'registrations', t.id, { title: t.title });
    const csv = toCsv([['code', 'name', 'phone', 'email', 'party_size', 'kind', 'status', 'notes', 'registered_at'],
      ...(await regRows(t.id)).map((g) => [g.code, g.name, g.phone, g.email, g.party_size, g.kind, g.status, g.notes, g.created_at])]);
    send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="registrations-${t.id.slice(0, 8)}.csv"` });
  });
}
