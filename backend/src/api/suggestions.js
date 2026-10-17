// Public input: suggestions (new places and corrections) and problem reports with a trackable code.
// Nothing from the public changes official records until a moderator accepts it (FR-041).
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { json, readJson, notFound, badRequest, HttpError } from '../lib/http.js';
import { requirePerm, can, inScope, requireScope } from '../lib/auth.js';
import { validatePlace, str } from '../lib/validate.js';
import { savePhoto, removePhotoFile } from '../lib/photos.js';
import { rateLimit } from '../lib/ratelimit.js';
import { audit, nowIso, insert, userNames } from '../db.js';
import { config } from '../config.js';
import { REPORT_TYPES, REPORT_STATUSES } from '../shared/catalog.js';
import { insertPlace, updatePlace, addPhoto, getPlace, nearestSubcity, recordEvidence } from './places.js';

const limitSuggest = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, message: 'You have sent many suggestions in the last hour. Try again later.' });
const limitReport = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'You have sent many reports in the last hour. Try again later.' });
const ipHash = (ip) => createHash('sha256').update(config.ipSalt + ip).digest('hex').slice(0, 24);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (prefix) => prefix + '-' + [...randomBytes(6)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const newest = (a, b) => String(b.created_at).localeCompare(String(a.created_at));

export default function register(r, { db }) {
  /* ---------- suggestions ---------- */
  r.post('/api/suggestions', async (req, res) => {
    limitSuggest('s:' + req.ip);
    const body = await readJson(req, 8 * 1024 * 1024);
    if (body.hp) return json(res, { ok: true }, 201); // honeypot field filled by bots
    const placeId = body.place_id ? String(body.place_id) : null;
    if (placeId && !(await db.places.findOne({ _id: placeId }, { projection: { id: 1 } }))) throw badRequest('The place you are correcting no longer exists.');

    const input = { ...body };
    for (const k of ['subcity_id', 'featured', 'verified', 'active', 'review_months']) if (k !== 'subcity_id' || input[k] === '' || input[k] === null || input[k] === undefined) delete input[k];
    const data = validatePlace(input, { partial: true });
    const errors = {};
    if (!data.name) errors.name = 'Enter the place name.';
    if (!data.sector || !data.type) errors.sector = 'Choose the category.';
    if (data.lat === undefined) errors.coords = 'Add the GPS coordinates.';
    if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
    if (data.subcity_id === undefined) {
      const ns = await nearestSubcity(db, data.lat, data.lon);
      data.subcity_id = ns ? ns.id : null;
    }

    const id = randomUUID();
    const photo = typeof body.photo === 'string' && body.photo ? await savePhoto(db, body.photo) : null;
    await insert(db, 'suggestions', {
      id, place_id: placeId, payload: data, lat: data.lat, lon: data.lon, accuracy_m: data.accuracy_m ?? null, photo_file: photo,
      contact_name: str(body.contact_name, 80), contact_phone: str(body.contact_phone, 40), ip_hash: ipHash(req.ip), photo_consent: body.photo_consent ? 1 : 0,
    });
    json(res, { ok: true, id }, 201);
  });

  r.get('/api/suggestions', async (req, res) => {
    requirePerm(req, 'moderation.manage');
    const status = ['new', 'accepted', 'rejected'].includes(req.query.get('status')) ? req.query.get('status') : 'new';
    const rows = (await db.suggestions.find({ status })).sort(newest).slice(0, 300);
    const pids = [...new Set(rows.map((s) => s.place_id).filter(Boolean))];
    const places = Object.fromEntries((pids.length ? await db.places.find({ id: { $in: pids } }, { projection: { id: 1, name: 1, subcity_id: 1 } }) : []).map((p) => [p.id, p]));
    const names = await userNames(db, rows.map((s) => s.reviewed_by));
    const items = rows.map((s) => {
      const data = typeof s.payload === 'string' ? JSON.parse(s.payload) : (s.payload || {});
      const p = places[s.place_id];
      return {
        id: s.id, place_id: s.place_id, place_name: p?.name ?? null, data, subcity_id: p?.subcity_id ?? data.subcity_id ?? null,
        lat: s.lat, lon: s.lon, accuracy_m: s.accuracy_m ?? null, photo: s.photo_file ? '/uploads/' + s.photo_file : null, photo_consent: !!s.photo_consent,
        contact_name: s.contact_name, contact_phone: s.contact_phone, status: s.status, created_at: s.created_at,
        reviewer: names[s.reviewed_by]?.name ?? null, reviewed_at: s.reviewed_at ?? null,
      };
    }).filter((s) => s.subcity_id === null || inScope(req, s.subcity_id));
    json(res, { items });
  });

  // Accept: the moderator sends the final, reviewed fields. Creates a place, or updates the one being corrected.
  r.post('/api/suggestions/:id/accept', async (req, res) => {
    requirePerm(req, 'moderation.manage');
    const s = await db.suggestions.findOne({ _id: req.params.id });
    if (!s) throw notFound('Suggestion not found.');
    if (s.status !== 'new') throw new HttpError(409, 'This suggestion was already handled.');
    const body = await readJson(req, 512 * 1024);
    const usePhoto = body.use_photo !== false;
    const rights = s.photo_consent ? 'permission' : (body.photo_rights || 'unknown');
    const target = body.status === 'published' && can(req, 'places.publish') ? 'published'
      : (body.status === 'verified' || body.status === 'published') && can(req, 'places.review') ? 'verified' : 'submitted';
    for (const k of ['use_photo', 'status', 'photo_rights']) delete body[k];
    let pid;
    if (s.place_id) {
      const cur = await db.places.findOne({ _id: s.place_id }, { projection: { subcity_id: 1 } });
      if (!cur) throw notFound('The place being corrected no longer exists.');
      requireScope(req, cur.subcity_id);
      const data = validatePlace(body, { partial: true, allowInactiveType: true });
      const changes = await updatePlace(db, s.place_id, data, req.user.id);
      if (changes.lat || changes.lon) await recordEvidence(db, s.place_id, { lat: s.lat, lon: s.lon, accuracy_m: s.accuracy_m ?? null, method: 'gps', notes: 'From a public correction' });
      await audit(db, req, 'update', 'place', s.place_id, { changes, from_suggestion: s.id });
      pid = s.place_id;
    } else {
      const data = validatePlace({ source: 'Public suggestion', ...body });
      requireScope(req, data.subcity_id);
      pid = await insertPlace(db, data, null, { status: target });
      await db.places.updateOne({ _id: pid }, { $set: { updated_by: req.user.id, reviewed_by: target === 'submitted' ? null : req.user.id, reviewed_at: target === 'submitted' ? null : nowIso() } });
      await recordEvidence(db, pid, { lat: s.lat, lon: s.lon, accuracy_m: s.accuracy_m ?? null, method: s.accuracy_m ? 'gps' : 'typed', notes: 'Location sent by a member of the public' });
      if (data.lat !== s.lat || data.lon !== s.lon) await recordEvidence(db, pid, { lat: data.lat, lon: data.lon, method: 'map', collector: req.user.id, notes: 'Adjusted by the moderator' });
      await audit(db, req, 'create', 'place', pid, { name: data.name, status: target, from_suggestion: s.id });
    }
    if (s.photo_file && usePhoto) await addPhoto(db, pid, s.photo_file, req.user.id, { rights, credit: s.contact_name ? 'Sent by ' + s.contact_name : 'Public suggestion' });
    await db.suggestions.updateOne({ _id: s.id }, { $set: { status: 'accepted', reviewed_by: req.user.id, reviewed_at: nowIso(), place_id: pid } });
    await audit(db, req, 'accept', 'suggestion', s.id, { place: pid });
    if (s.photo_file && !usePhoto) await removePhotoFile(db, s.photo_file);
    json(res, await getPlace(db, pid, { staff: true }));
  });

  r.post('/api/suggestions/:id/reject', async (req, res) => {
    requirePerm(req, 'moderation.manage');
    const s = await db.suggestions.findOne({ _id: req.params.id }, { projection: { status: 1, photo_file: 1 } });
    if (!s) throw notFound('Suggestion not found.');
    if (s.status !== 'new') throw new HttpError(409, 'This suggestion was already handled.');
    const body = await readJson(req);
    await db.suggestions.updateOne({ _id: req.params.id }, { $set: { status: 'rejected', reviewed_by: req.user.id, reviewed_at: nowIso(), photo_file: null } });
    await removePhotoFile(db, s.photo_file);
    await audit(db, req, 'reject', 'suggestion', req.params.id, { reason: str(body.reason, 300) || undefined });
    json(res, { ok: true });
  });

  /* ---------- problem reports (FR-040 to FR-042) ---------- */
  r.post('/api/reports', async (req, res) => {
    limitReport('r:' + req.ip);
    const body = await readJson(req);
    if (body.hp) return json(res, { ok: true, code: newCode('SR') }, 201);
    const errors = {};
    if (!REPORT_TYPES[body.issue_type]) errors.issue_type = 'Choose what is wrong.';
    const description = str(body.description, 2000);
    if (!description && body.issue_type === 'other') errors.description = 'Tell us what is wrong.';
    const placeId = body.place_id ? String(body.place_id) : null;
    const tripId = body.trip_id ? String(body.trip_id) : null;
    if (placeId && !(await db.places.findOne({ _id: placeId, status: 'published' }, { projection: { id: 1 } }))) errors.place_id = 'That place is not available.';
    if (tripId && !(await db.trips.findOne({ _id: tripId }, { projection: { id: 1 } }))) errors.trip_id = 'That trip is not available.';
    if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
    let code;
    do { code = newCode('SR'); } while (await db.reports.findOne({ code }, { projection: { id: 1 } }));
    await insert(db, 'reports', { id: randomUUID(), code, place_id: placeId, trip_id: tripId, issue_type: body.issue_type, description, contact: str(body.contact, 120), ip_hash: ipHash(req.ip) });
    json(res, { ok: true, code }, 201);
  });

  // Anyone with the code can see the status (no personal data).
  r.get('/api/reports/track/:code', async (req, res) => {
    const x = await db.reports.findOne({ code: String(req.params.code).toUpperCase().trim() });
    if (!x) throw notFound('No report has that code. Check the letters and numbers.');
    const p = x.place_id ? await db.places.findOne({ _id: x.place_id }, { projection: { name: 1 } }) : null;
    json(res, { code: x.code, issue_type: x.issue_type, status: x.status, resolution: x.resolution, created_at: x.created_at, updated_at: x.updated_at, place_name: p?.name ?? null });
  });

  r.get('/api/reports', async (req, res) => {
    requirePerm(req, 'moderation.manage');
    const st = req.query.get('status');
    const filter = REPORT_STATUSES[st] ? { status: st } : st === 'active' ? { status: { $in: ['open', 'in_progress', 'needs_info'] } } : {};
    const rows = (await db.reports.find(filter)).sort(newest).slice(0, 500);
    const pids = [...new Set(rows.map((x) => x.place_id).filter(Boolean))], tids = [...new Set(rows.map((x) => x.trip_id).filter(Boolean))];
    const places = Object.fromEntries((pids.length ? await db.places.find({ id: { $in: pids } }, { projection: { id: 1, name: 1, subcity_id: 1 } }) : []).map((p) => [p.id, p]));
    const trips = Object.fromEntries((tids.length ? await db.trips.find({ id: { $in: tids } }, { projection: { id: 1, title: 1 } }) : []).map((t) => [t.id, t]));
    const names = await userNames(db, rows.map((x) => x.assigned_to));
    const items = rows.map(({ ip_hash, ...x }) => ({
      ...x, place_name: places[x.place_id]?.name ?? null, subcity_id: places[x.place_id]?.subcity_id ?? null, trip_title: trips[x.trip_id]?.title ?? null, assignee: names[x.assigned_to]?.name ?? null,
    }));
    json(res, { items: items.filter((x) => x.subcity_id == null || inScope(req, x.subcity_id)) });
  });

  r.patch('/api/reports/:id', async (req, res) => {
    requirePerm(req, 'moderation.manage');
    const cur = await db.reports.findOne({ _id: req.params.id });
    if (!cur) throw notFound('Report not found.');
    const body = await readJson(req);
    const upd = { updated_at: nowIso() };
    if (body.status !== undefined) {
      if (!REPORT_STATUSES[body.status]) throw badRequest('Unknown status.');
      upd.status = body.status;
      if (['resolved', 'rejected'].includes(body.status)) { upd.resolved_at = nowIso(); upd.resolved_by = req.user.id; }
    }
    if (body.resolution !== undefined) upd.resolution = str(body.resolution, 1000);
    if (body.assigned_to !== undefined) upd.assigned_to = body.assigned_to ? Number(body.assigned_to) : null;
    await db.reports.updateOne({ _id: cur.id }, { $set: upd });
    await audit(db, req, 'update', 'report', cur.code, { from: cur.status, to: upd.status, resolution: upd.resolution });
    json(res, await db.reports.findOne({ _id: cur.id }));
  });
}
