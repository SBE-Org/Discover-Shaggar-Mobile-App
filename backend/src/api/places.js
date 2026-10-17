// Places: public reading, staff writing, the publishing workflow (Draft → Submitted → Verified → Published),
// photos with rights metadata, location evidence, duplicate detection and edit history.
import { randomUUID } from 'node:crypto';
import { json, readJson, notFound, badRequest, HttpError } from '../lib/http.js';
import { can, requirePerm, requireScope, inScope, userLevel } from '../lib/auth.js';
import { validatePlace, str } from '../lib/validate.js';
import { saveImage, removePhotoFile } from '../lib/photos.js';
import { audit, nowIso, setting, insert, nextId, userNames, like } from '../db.js';
import { STATUSES, WORKFLOW, NEXT_ACTION, SECTORS, TYPES, PHOTO_RIGHTS, PUBLIC_PHOTO_RIGHTS, CONDITIONS, hasMenu } from '../shared/catalog.js';
import { haversine, parseCoords, pointInBoundary } from '../shared/coords.js';

const PUBLIC_FIELDS = ['id', 'name', 'name_om', 'name_am', 'alt_names', 'sector', 'type', 'subcity_id', 'woreda', 'kebele', 'lat', 'lon',
  'accuracy_m', 'coord_source', 'description', 'description_om', 'description_am', 'phone', 'email', 'hours', 'website', 'fee',
  'best_time', 'parking', 'accessibility', 'visitor_tips', 'safety', 'source', 'owner_department', 'status', 'condition',
  'verified_at', 'last_reviewed_at', 'created_at', 'updated_at'];
const STAFF_FIELDS = ['workflow_note', 'review_months', 'boundary_flag', 'submitted_by', 'submitted_at', 'reviewed_by', 'reviewed_at',
  'published_by', 'published_at', 'created_by', 'updated_by'];

/** Arrays/objects may come from older data as JSON text. */
export const asList = (v) => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
export const asObj = (v) => { if (v && typeof v === 'object') return v; if (!v) return null; try { return JSON.parse(v); } catch { return null; } };
const same = (a, b) => a === b || (a == null && b == null) || (typeof a === 'object' && typeof b === 'object' && a && b && JSON.stringify(a) === JSON.stringify(b));

const addMonths = (iso, m) => { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString(); };
export function reviewDue(p) {
  const months = p.review_months || SECTORS[p.sector]?.review_months || 12;
  return addMonths(p.last_reviewed_at || p.verified_at || p.updated_at || p.created_at, months);
}

/** Photo order: chosen cover first, then staff photos before visitor photos, then by position and age. */
const photoOrder = (a, b) => (b.is_primary || 0) - (a.is_primary || 0) || (a.source === 'visitor') - (b.source === 'visitor') || (a.sort || 0) - (b.sort || 0) || String(a.created_at).localeCompare(String(b.created_at));

/** Add `cover` (first public photo) and `photo_count` to place rows in one query. */
export async function attachCovers(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const photos = await db.photos.find({ place_id: { $in: ids }, status: 'approved' }, { projection: { place_id: 1, file: 1, is_primary: 1, source: 1, sort: 1, created_at: 1, rights: 1 } });
  const by = new Map();
  for (const ph of photos) { if (!by.has(ph.place_id)) by.set(ph.place_id, []); by.get(ph.place_id).push(ph); }
  for (const r of rows) {
    const list = by.get(r.id) || [];
    r.photo_count = list.length;
    r.cover = list.filter((x) => PUBLIC_PHOTO_RIGHTS.includes(x.rights)).sort(photoOrder)[0]?.file || null;
  }
  return rows;
}

export function toPlace(r, staff = false) {
  const o = {};
  for (const k of PUBLIC_FIELDS) o[k] = r[k] ?? null;
  o.active = !!r.active; o.verified = !!r.verified; o.featured = !!r.featured;
  o.facilities = asList(r.facilities);
  o.hours_json = asObj(r.hours_json);
  o.cover = r.cover ? '/uploads/' + r.cover : null;
  o.photo_count = r.photo_count ?? 0;
  o.review_due = reviewDue(r);
  o.stale = r.status === 'published' && o.review_due < nowIso();
  if (staff) for (const k of STAFF_FIELDS) o[k] = r[k] ?? null;
  return o;
}

/** Sub-city for a point: the boundary that contains it when boundaries are loaded, otherwise the nearest centre. */
export async function nearestSubcity(db, lat, lon) {
  const rows = await db.subcities.find({}, { projection: { id: 1, lat: 1, lon: 1, boundary: 1 }, sort: { id: 1 } });
  for (const s of rows) {
    if (!s.boundary) continue;
    try { if (pointInBoundary(lat, lon, asObj(s.boundary))) return { id: s.id, d: 0, inside: true }; } catch { /* bad boundary */ }
  }
  let best = null;
  for (const s of rows) {
    if (s.lat == null || s.lon == null) continue;
    const d = haversine(lat, lon, s.lat, s.lon);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  return best;
}
/** 1 when the sub-city has an approved boundary and the point lies outside it (FR-023 edge cases). */
export async function boundaryFlag(db, subcityId, lat, lon) {
  const s = await db.subcities.findOne({ id: subcityId }, { projection: { boundary: 1 } });
  if (!s?.boundary) return 0;
  try { return pointInBoundary(lat, lon, asObj(s.boundary)) ? 0 : 1; } catch { return 0; }
}

export function menuOut(m, staff = false) {
  const o = {
    id: m.id, section: m.section, name: m.name, name_om: m.name_om, name_am: m.name_am, description: m.description, price: m.price ?? null,
    currency: m.currency, price_note: m.price_note, tags: asList(m.tags), available: !!m.available, photo: m.photo_file ? '/uploads/' + m.photo_file : null,
    source: m.source, sort: m.sort,
  };
  if (staff) Object.assign(o, { status: m.status, submitter_name: m.submitter_name, review_note: m.review_note, created_by: m.created_by ?? null, created_at: m.created_at, updated_at: m.updated_at });
  return o;
}
const menuSort = (a, b) => (a.sort || 0) - (b.sort || 0) || String(a.section).localeCompare(String(b.section)) || String(a.name).localeCompare(String(b.name));

export async function getPlace(db, id, { staff = false } = {}) {
  const r = await db.places.findOne({ _id: id });
  if (!r) return null;
  await attachCovers(db, [r]);
  const place = toPlace(r, staff);
  const photoFilter = staff ? { place_id: id, status: { $ne: 'rejected' } } : { place_id: id, status: 'approved', rights: { $in: PUBLIC_PHOTO_RIGHTS } };
  place.photos = (await db.photos.find(photoFilter)).sort(photoOrder).map((p) => ({
    id: p.id, url: '/uploads/' + p.file, width: p.width ?? null, height: p.height ?? null, caption: p.caption, credit: p.credit, alt: p.alt,
    is_primary: !!p.is_primary, source: p.source, ...(staff ? { rights: p.rights, status: p.status, created_at: p.created_at } : {}),
  }));
  if (hasMenu(place) || await db.menu.findOne({ place_id: id }, { projection: { id: 1 } })) {
    const items = await db.menu.find(staff ? { place_id: id, status: { $ne: 'rejected' } } : { place_id: id, status: 'approved', available: 1 });
    place.menu = items.sort(menuSort).map((m) => menuOut(m, staff));
    const approved = await db.menu.find({ place_id: id, status: 'approved' }, { projection: { reviewed_at: 1, updated_at: 1 } });
    place.menu_updated_at = approved.map((m) => m.reviewed_at || m.updated_at).filter(Boolean).sort().pop() || null;
  }
  if (staff) {
    const ev = await db.evidence.find({ place_id: id }, { sort: { captured_at: -1, id: -1 }, limit: 30 });
    const names = await userNames(db, [...ev.map((e) => e.collector_id), r.created_by, r.submitted_by, r.reviewed_by, r.published_by, r.verified_by]);
    place.evidence = ev.map((e) => ({ ...e, collector_name: names[e.collector_id]?.name ?? null }));
    place.people = Object.fromEntries([r.created_by, r.submitted_by, r.reviewed_by, r.published_by, r.verified_by].filter((x) => names[x]).map((x) => [x, names[x].name]));
  }
  return place;
}

const ALL_COLS = ['name', 'name_om', 'name_am', 'alt_names', 'sector', 'type', 'subcity_id', 'woreda', 'kebele', 'lat', 'lon', 'accuracy_m',
  'coord_source', 'description', 'description_om', 'description_am', 'phone', 'email', 'hours', 'hours_json', 'website', 'fee', 'best_time',
  'parking', 'facilities', 'accessibility', 'visitor_tips', 'safety', 'source', 'owner_department', 'condition', 'active', 'featured',
  'verified', 'review_months'];

/** Insert a validated place. Used by the API, suggestions and CSV import. */
export async function insertPlace(db, data, userId, { status = 'draft' } = {}) {
  const id = randomUUID();
  const now = nowIso();
  const row = { condition: 'open', facilities: [], active: 1, featured: 0, verified: 0, coord_source: 'typed', ...data };
  const doc = { id };
  for (const k of ALL_COLS) if (row[k] !== undefined) doc[k] = row[k];
  Object.assign(doc, {
    status, created_by: userId ?? null, updated_by: userId ?? null, created_at: now, updated_at: now,
    verified_at: row.verified ? now : null, verified_by: row.verified ? userId ?? null : null,
    boundary_flag: await boundaryFlag(db, row.subcity_id, row.lat, row.lon),
    submitted_by: ['submitted', 'verified', 'published'].includes(status) ? userId ?? null : null,
    submitted_at: ['submitted', 'verified', 'published'].includes(status) ? now : null,
    published_at: status === 'published' ? now : null, published_by: status === 'published' ? userId ?? null : null,
    last_reviewed_at: ['verified', 'published'].includes(status) ? now : null,
  });
  await insert(db, 'places', doc);
  return id;
}

/** Update a place and return { field: [before, after] } for the audit trail. */
export async function updatePlace(db, id, data, userId) {
  const cur = await db.places.findOne({ _id: id });
  if (!cur) throw notFound('That place no longer exists.');
  const fields = {};
  const changes = {};
  for (const [k, v] of Object.entries(data)) {
    if (same(cur[k], v)) continue;
    fields[k] = v; changes[k] = [cur[k] ?? null, v];
  }
  if (!Object.keys(fields).length) return changes;
  const moved = fields.lat !== undefined || fields.lon !== undefined;
  if (moved && data.verified === undefined && cur.verified) { fields.verified = 0; changes.verified = [1, 0]; }
  if (fields.verified !== undefined) {
    fields.verified_at = fields.verified ? nowIso() : null;
    fields.verified_by = fields.verified ? userId : null;
  }
  if (moved || fields.subcity_id !== undefined) {
    fields.boundary_flag = await boundaryFlag(db, fields.subcity_id ?? cur.subcity_id, fields.lat ?? cur.lat, fields.lon ?? cur.lon);
  }
  fields.updated_by = userId; fields.updated_at = nowIso();
  await db.places.updateOne({ _id: id }, { $set: fields });
  return changes;
}

export async function recordEvidence(db, placeId, { lat, lon, accuracy_m = null, method = 'typed', collector = null, notes = '', at = null }) {
  await insert(db, 'evidence', {
    id: await nextId(db, 'location_evidence'), place_id: placeId, lat, lon, accuracy_m, method, collector_id: collector,
    notes: String(notes || '').slice(0, 500), captured_at: at || nowIso(),
  });
}

/** Add a photo. `file` is a saved file name or a { file, width, height } result from saveImage. */
export async function addPhoto(db, placeId, file, userId, meta = {}) {
  const f = typeof file === 'string' ? { file } : file;
  const last = await db.photos.findOne({ place_id: placeId }, { sort: { sort: -1 }, projection: { sort: 1 } });
  const id = randomUUID();
  await insert(db, 'photos', {
    id, place_id: placeId, file: f.file, width: f.width ?? null, height: f.height ?? null, sort: last ? (last.sort ?? 0) + 1 : 0, created_by: userId ?? null,
    caption: str(meta.caption, 200), credit: str(meta.credit, 120), rights: PHOTO_RIGHTS[meta.rights] ? meta.rights : 'bureau', alt: str(meta.alt, 200),
    status: meta.status || 'approved', source: meta.source || 'staff', submitter_name: str(meta.submitter_name, 80), contact: str(meta.contact, 120), ip_hash: meta.ip_hash || null,
  });
  return id;
}

/* ---------- duplicate detection (FR-014) ---------- */
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function similarity(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const grams = (s) => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const ga = grams(A), gb = grams(B);
  let inter = 0;
  for (const [k, n] of ga) inter += Math.min(n, gb.get(k) || 0);
  return (2 * inter) / Math.max(1, A.length - 1 + B.length - 1);
}
export async function findDuplicates(db, { name, sector, type, lat, lon, excludeId }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const r = 150, dLat = r / 111320, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
  const rows = await db.places.find({
    lat: { $gte: lat - dLat, $lte: lat + dLat }, lon: { $gte: lon - dLon, $lte: lon + dLon }, status: { $ne: 'archived' }, id: { $ne: excludeId || '' },
  }, { projection: { id: 1, name: 1, sector: 1, type: 1, status: 1, lat: 1, lon: 1 } });
  return rows.map((p) => ({ ...p, distance_m: Math.round(haversine(lat, lon, p.lat, p.lon)), score: similarity(name, p.name) }))
    .filter((p) => p.distance_m <= r && (p.score >= 0.6 || (p.type === type && p.sector === sector && p.distance_m <= 25)))
    .sort((a, b) => b.score - a.score || a.distance_m - b.distance_m).slice(0, 5)
    .map(({ id, name: n, status, distance_m, score }) => ({ id, name: n, status, distance_m, score: Math.round(score * 100) / 100 }));
}

/* ---------- workflow ---------- */
const isOwn = (p, uid) => p.created_by === uid || p.submitted_by === uid;

export async function applyWorkflow(db, req, place, action, note = '') {
  const w = WORKFLOW[action];
  if (!w) throw badRequest('Unknown action.');
  requirePerm(req, w.perm);
  requireScope(req, place.subcity_id);
  if (!w.from.includes(place.status)) throw new HttpError(409, `Cannot ${w.label.toLowerCase()} a record that is ${place.status.replace('_', ' ')}.`);
  if (w.own === false && isOwn(place, req.user.id) && !setting(db, 'workflow.allow_self_approval')) {
    throw new HttpError(403, 'You cannot approve a record you created or submitted. Another reviewer must do this step.');
  }
  // Hierarchy: approval needs someone at the author's level or above (a central editor's record goes to a central supervisor).
  if (w.own === false && !req.user.all) {
    const author = place.submitted_by || place.created_by;
    const need = await userLevel(db, author);
    if (need > (req.user.level ?? 0)) {
      const u = author ? await db.users.findOne({ id: author }, { projection: { role: 1 } }) : null;
      const who = (u && (await db.roles.findOne({ _id: u.role }, { projection: { name: 1 } }))?.name) || 'a senior role';
      throw new HttpError(403, `This record was entered by a ${who}. It must be approved by someone at that level or higher.`);
    }
  }
  if (action === 'approve' && !can(req, 'places.review')) throw new HttpError(403, 'Approving needs both review and publish permission.');
  if (w.note && !String(note || '').trim()) throw badRequest('Add a short note so the contributor knows what to fix.', { note: 'Required' });
  const now = nowIso(), uid = req.user.id;
  const set = { status: w.to, updated_at: now, updated_by: uid };
  if (action === 'submit') Object.assign(set, { submitted_by: uid, submitted_at: now, workflow_note: '' });
  if (action === 'verify') Object.assign(set, { reviewed_by: uid, reviewed_at: now, last_reviewed_at: now });
  if (action === 'publish') Object.assign(set, { published_by: uid, published_at: now, last_reviewed_at: place.last_reviewed_at || now, workflow_note: '' });
  if (action === 'approve') Object.assign(set, { reviewed_by: uid, reviewed_at: now, published_by: uid, published_at: now, last_reviewed_at: now, workflow_note: '' });
  if (w.note) set.workflow_note = String(note).trim().slice(0, 1000);
  await db.places.updateOne({ _id: place.id }, { $set: set });
  await audit(db, req, 'status', 'place', place.id, { name: place.name, from: place.status, to: w.to, action, note: note || undefined });
}

/** Photos that data-entry staff add to a live (published) place wait for a supervisor; drafts are approved with the record. */
export const staffPhotoStatus = (req, place) => (place.status === 'published' && !can(req, 'places.review') && !can(req, 'contributions.manage') ? 'pending' : 'approved');

/** Which records a staff member may change, beyond their permission list. */
function assertCanEdit(req, place) {
  requirePerm(req, 'places.edit');
  requireScope(req, place.subcity_id);
  if (['published', 'archived'].includes(place.status) && !can(req, 'places.publish') && !can(req, 'places.review')) {
    throw new HttpError(403, 'Published records can only be changed by reviewers or approvers.');
  }
  if (place.status === 'verified' && !can(req, 'places.review')) {
    throw new HttpError(403, 'This record is verified. Ask a reviewer to return it for correction first.');
  }
}

/** Remove a place and everything that belongs to it (photos, evidence, menu); links from other records are cleared. */
export async function deletePlaceCascade(db, id) {
  const photos = await db.photos.find({ place_id: id }, { projection: { file: 1 } });
  const menuPhotos = await db.menu.find({ place_id: id, photo_file: { $ne: null } }, { projection: { photo_file: 1 } });
  await db.stops.updateMany({ place_id: id }, { $set: { place_id: null } });
  await db.trips.updateMany({ meeting_place_id: id }, { $set: { meeting_place_id: null } });
  await db.suggestions.updateMany({ place_id: id }, { $set: { place_id: null } });
  await db.reports.updateMany({ place_id: id }, { $set: { place_id: null } });
  await db.photos.deleteMany({ place_id: id });
  await db.evidence.deleteMany({ place_id: id });
  await db.menu.deleteMany({ place_id: id });
  await db.places.deleteOne({ _id: id });
  for (const f of [...photos.map((x) => x.file), ...menuPhotos.map((x) => x.photo_file)]) await removePhotoFile(db, f);
}

export default function register(r, { db }) {
  const staffView = (req) => can(req, 'places.view');

  async function listPlaces(req, res, overrides = {}) {
    const q = req.query;
    const get = (k) => overrides[k] ?? q.get(k);
    const and = [];
    const all = get('scope') === 'all' && staffView(req);
    if (!all) and.push({ status: 'published', active: 1 });
    else {
      if (req.user.subcity_id !== null && req.user.subcity_id !== undefined) and.push({ subcity_id: req.user.subcity_id });
      const st = get('status');
      if (STATUSES.includes(st)) and.push({ status: st });
      if (st === 'inactive') and.push({ active: 0 });
      if (st === 'unverified') and.push({ verified: 0 });
      if (get('mine') === '1') and.push({ $or: [{ created_by: req.user.id }, { submitted_by: req.user.id }] });
    }
    if (get('sector')) and.push({ sector: get('sector') });
    if (get('type')) and.push({ type: get('type') });
    const sub = get('subcity');
    if (sub !== null && sub !== undefined && sub !== '') and.push({ subcity_id: Number(sub) });
    if (get('featured') === '1') and.push({ featured: 1 });
    if (get('verified') === '1') and.push({ verified: 1 });
    if (CONDITIONS[get('condition')]) and.push({ condition: get('condition') });
    if (get('facility')) and.push({ facilities: String(get('facility')).replace(/[^a-z_]/g, '') });
    if (get('q')) {
      const qq = String(get('q')).slice(0, 80);
      const text = like(qq.replace(/[%_]/g, ''));
      const or = ['name', 'name_om', 'name_am', 'alt_names', 'woreda', 'kebele', 'description'].map((k) => ({ [k]: text }));
      for (const [s, t] of Object.entries(TYPES)) for (const [k, l] of Object.entries(t)) if (l.toLowerCase().includes(qq.toLowerCase())) or.push({ sector: s, type: k });
      for (const [s, v] of Object.entries(SECTORS)) if (v.label.toLowerCase().includes(qq.toLowerCase())) or.push({ sector: s });
      and.push({ $or: or });
    }
    let near = null, radius = null;
    const nearStr = get('near');
    if (nearStr) {
      const p = parseCoords(nearStr);
      if (!p || p.error) throw badRequest('near must be "lat,lon".');
      near = p;
      radius = Math.min(100000, Math.max(50, Number(get('radius')) || 5000));
      const dLat = radius / 111320, dLon = radius / (111320 * Math.cos(p.lat * Math.PI / 180));
      and.push({ lat: { $gte: p.lat - dLat, $lte: p.lat + dLat }, lon: { $gte: p.lon - dLon, $lte: p.lon + dLon } });
    }
    const limit = Math.min(10000, Math.max(1, Number(get('limit')) || 5000));
    const rows = await db.places.find(and.length ? { $and: and } : {}, { sort: { name: 1 }, limit });
    rows.sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
    await attachCovers(db, rows);
    let items = rows.map((x) => toPlace(x, all));
    if (near) {
      items = items.map((it) => ({ ...it, distance_m: Math.round(haversine(near.lat, near.lon, it.lat, it.lon)) }))
        .filter((it) => it.distance_m <= radius).sort((a, b) => a.distance_m - b.distance_m);
    }
    json(res, { items, count: items.length });
  }

  // List places. Public callers only see published, active places.
  r.get('/api/places', (req, res) => listPlaces(req, res));
  // Spec 20.2: GET /api/v1/places/nearby?lat=&lon=&radius_m=
  r.get('/api/places/nearby', (req, res) => {
    const lat = Number(req.query.get('lat')), lon = Number(req.query.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw badRequest('Give lat and lon.');
    return listPlaces(req, res, { near: lat + ',' + lon, radius: req.query.get('radius_m') || req.query.get('radius') || '2000', scope: 'public' });
  });

  r.get('/api/places/duplicates', async (req, res) => {
    requirePerm(req, 'places.create', 'places.edit');
    const q = req.query;
    json(res, { items: await findDuplicates(db, { name: q.get('name'), sector: q.get('sector'), type: q.get('type'), lat: Number(q.get('lat')), lon: Number(q.get('lon')), excludeId: q.get('exclude') }) });
  });

  r.get('/api/places/:id', async (req, res) => {
    const staff = staffView(req);
    const place = await getPlace(db, req.params.id, { staff });
    if (!place || (!staff && !(place.status === 'published' && place.active))) throw notFound('Place not found.');
    if (staff && !inScope(req, place.subcity_id) && place.status !== 'published') throw notFound('Place not found.');
    json(res, place);
  });

  r.post('/api/places', async (req, res) => {
    requirePerm(req, 'places.create');
    const body = await readJson(req, 8 * 1024 * 1024);
    const data = validatePlace(body);
    requireScope(req, data.subcity_id);
    if (data.featured && !can(req, 'content.manage')) delete data.featured;
    const maxAcc = Number(setting(db, 'gps.max_accuracy_m')) || 20;
    if (data.coord_source === 'gps' && data.accuracy_m > maxAcc && !String(body.accuracy_note || '').trim()) {
      throw badRequest(`GPS accuracy is ±${Math.round(data.accuracy_m)} m, worse than the ${maxAcc} m limit. Retry outdoors, adjust the pin on the map, or explain why.`, { accuracy_note: 'Explain the low accuracy or retry' });
    }
    if (!body.confirm_duplicate) {
      const dups = await findDuplicates(db, { ...data });
      if (dups.length) throw new HttpError(409, 'This looks like a place that is already in the directory.', { duplicates: dups });
    }
    const status = body.submit && can(req, 'places.submit') ? 'submitted' : 'draft';
    const photo = typeof body.photo === 'string' && body.photo ? await saveImage(db, body.photo) : null;
    const pid = await insertPlace(db, data, req.user.id, { status });
    const g = body.gps_original && parseCoords(`${body.gps_original.lat}, ${body.gps_original.lon}`);
    if (g && !g.error && (g.lat !== data.lat || g.lon !== data.lon)) {
      await recordEvidence(db, pid, { lat: g.lat, lon: g.lon, accuracy_m: Number(body.gps_original.accuracy_m) || null, method: 'gps', collector: req.user.id, notes: 'Original GPS reading before manual adjustment' });
    }
    await recordEvidence(db, pid, { lat: data.lat, lon: data.lon, accuracy_m: data.accuracy_m ?? null, method: data.coord_source || 'typed', collector: req.user.id, notes: str(body.accuracy_note, 500) });
    if (photo) await addPhoto(db, pid, photo, req.user.id, body.photo_meta || {});
    await audit(db, req, 'create', 'place', pid, { name: data.name, status });
    json(res, await getPlace(db, pid, { staff: true }), 201);
  });

  r.patch('/api/places/:id', async (req, res) => {
    const cur = await db.places.findOne({ _id: req.params.id });
    if (!cur) throw notFound('That place no longer exists.');
    const body = await readJson(req, 8 * 1024 * 1024);
    const data = validatePlace(body, { partial: true, allowInactiveType: true });
    const onlyPhoto = !Object.keys(data).length;
    if (onlyPhoto) requirePerm(req, 'places.edit', 'places.create'); else assertCanEdit(req, cur);
    requireScope(req, cur.subcity_id);
    if (data.subcity_id !== undefined) requireScope(req, data.subcity_id);
    if (data.featured !== undefined && !can(req, 'content.manage')) delete data.featured;
    if (data.verified !== undefined && !can(req, 'places.review') && data.verified !== cur.verified) delete data.verified;
    const photo = typeof body.photo === 'string' && body.photo ? await saveImage(db, body.photo) : null;
    const changes = Object.keys(data).length ? await updatePlace(db, req.params.id, data, req.user.id) : {};
    if (changes.lat || changes.lon) {
      await recordEvidence(db, req.params.id, { lat: data.lat ?? cur.lat, lon: data.lon ?? cur.lon, accuracy_m: data.accuracy_m ?? null, method: data.coord_source || 'typed', collector: req.user.id, notes: str(body.accuracy_note, 500) || 'Location changed' });
    }
    if (photo) await addPhoto(db, req.params.id, photo, req.user.id, { ...(body.photo_meta || {}), status: staffPhotoStatus(req, cur) });
    if (Object.keys(changes).length || photo) await audit(db, req, 'update', 'place', req.params.id, { name: cur.name, changes, photo: !!photo || undefined });
    if (body.submit && ['draft', 'needs_correction'].includes(cur.status)) {
      await applyWorkflow(db, req, await db.places.findOne({ _id: req.params.id }), 'submit');
    }
    json(res, await getPlace(db, req.params.id, { staff: true }));
  });

  r.post('/api/places/:id/workflow', async (req, res) => {
    const body = await readJson(req);
    const place = await db.places.findOne({ _id: req.params.id });
    if (!place) throw notFound('Place not found.');
    await applyWorkflow(db, req, place, String(body.action || ''), body.note);
    json(res, await getPlace(db, req.params.id, { staff: true }));
  });

  // One tap: the usual next step for the record's status.
  r.post('/api/places/:id/advance', async (req, res) => {
    const place = await db.places.findOne({ _id: req.params.id });
    if (!place) throw notFound('Place not found.');
    const action = place.status === 'submitted' && can(req, 'places.publish') && can(req, 'places.review') ? 'approve' : NEXT_ACTION[place.status];
    if (!action) throw new HttpError(409, place.status === 'published' ? 'This place is already published.' : 'No next step for this record.');
    await applyWorkflow(db, req, place, action);
    json(res, await getPlace(db, req.params.id, { staff: true }));
  });

  r.post('/api/places/bulk', async (req, res) => {
    const body = await readJson(req, 512 * 1024);
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 500).map(String) : [];
    if (!ids.length) throw badRequest('Choose at least one record.');
    const results = [];
    for (const id of ids) {
      const place = await db.places.findOne({ _id: id });
      if (!place) { results.push({ id, ok: false, error: 'Not found' }); continue; }
      try {
        if (body.action === 'reviewed') await markReviewed(req, place);
        else if (body.action === 'feature' || body.action === 'unfeature') {
          requirePerm(req, 'content.manage');
          await updatePlace(db, id, { featured: body.action === 'feature' ? 1 : 0 }, req.user.id);
          await audit(db, req, body.action, 'place', id, { name: place.name });
        } else await applyWorkflow(db, req, place, String(body.action || ''), body.note);
        results.push({ id, ok: true });
      } catch (e) { results.push({ id, ok: false, error: e.message }); }
    }
    json(res, { results, ok: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length });
  });

  // Periodic review: confirm the published details are still correct (spec 10.3).
  async function markReviewed(req, place) {
    requirePerm(req, 'places.review');
    requireScope(req, place.subcity_id);
    await db.places.updateOne({ _id: place.id }, { $set: { last_reviewed_at: nowIso(), reviewed_by: req.user.id, reviewed_at: nowIso() } });
    await audit(db, req, 'reviewed', 'place', place.id, { name: place.name });
  }
  r.post('/api/places/:id/reviewed', async (req, res) => {
    const place = await db.places.findOne({ _id: req.params.id });
    if (!place) throw notFound('Place not found.');
    await markReviewed(req, place);
    json(res, await getPlace(db, req.params.id, { staff: true }));
  });

  r.get('/api/places/:id/history', async (req, res) => {
    requirePerm(req, 'places.view');
    const rows = await db.audit.find({ entity: 'place', entity_id: req.params.id }, { sort: { id: -1 }, limit: 200 });
    const names = await userNames(db, rows.map((a) => a.user_id));
    const items = rows.map((a) => ({
      id: a.id, action: a.action, detail: a.detail ? JSON.parse(a.detail) : null, created_at: a.created_at,
      ip: can(req, 'audit.view') ? a.ip : undefined, user_name: names[a.user_id]?.name ?? null,
    }));
    json(res, { items });
  });

  r.delete('/api/places/:id', async (req, res) => {
    requirePerm(req, 'places.delete');
    const cur = await db.places.findOne({ _id: req.params.id }, { projection: { name: 1, subcity_id: 1 } });
    if (!cur) throw notFound('Place not found.');
    requireScope(req, cur.subcity_id);
    await deletePlaceCascade(db, req.params.id);
    await audit(db, req, 'delete', 'place', req.params.id, { name: cur.name });
    json(res, { ok: true });
  });

  r.post('/api/places/:id/photos', async (req, res) => {
    requirePerm(req, 'places.edit', 'places.create');
    const body = await readJson(req, 8 * 1024 * 1024);
    const p = await db.places.findOne({ _id: req.params.id }, { projection: { subcity_id: 1, status: 1 } });
    if (!p) throw notFound('Place not found.');
    requireScope(req, p.subcity_id);
    const file = await saveImage(db, body.photo);
    const status = staffPhotoStatus(req, p);
    await addPhoto(db, req.params.id, file, req.user.id, { ...body, status, source: 'staff' });
    await audit(db, req, 'photo_add', 'place', req.params.id, { pending: status === 'pending' || undefined });
    json(res, await getPlace(db, req.params.id, { staff: true }), 201);
  });

  async function photoWithPlace(id) {
    const ph = await db.photos.findOne({ _id: id });
    if (!ph) return null;
    const p = await db.places.findOne({ _id: ph.place_id }, { projection: { subcity_id: 1 } });
    return p ? { ...ph, subcity_id: p.subcity_id } : null;
  }

  r.patch('/api/photos/:id', async (req, res) => {
    requirePerm(req, 'places.edit');
    const ph = await photoWithPlace(req.params.id);
    if (!ph) throw notFound('Photo not found.');
    requireScope(req, ph.subcity_id);
    const body = await readJson(req);
    const upd = {};
    for (const [k, max] of [['caption', 200], ['credit', 120], ['alt', 200]]) if (body[k] !== undefined) upd[k] = str(body[k], max);
    if (body.rights !== undefined) { if (!PHOTO_RIGHTS[body.rights]) throw badRequest('Unknown rights status.'); upd.rights = body.rights; }
    if (body.is_primary) { await db.photos.updateMany({ place_id: ph.place_id }, { $set: { is_primary: 0 } }); upd.is_primary = 1; }
    const keys = Object.keys(upd);
    if (keys.length) await db.photos.updateOne({ _id: ph.id }, { $set: upd });
    await audit(db, req, 'photo_update', 'place', ph.place_id, { photo: ph.id, fields: keys });
    json(res, await getPlace(db, ph.place_id, { staff: true }));
  });

  r.delete('/api/photos/:id', async (req, res) => {
    requirePerm(req, 'places.edit');
    const ph = await photoWithPlace(req.params.id);
    if (!ph) throw notFound('Photo not found.');
    requireScope(req, ph.subcity_id);
    await db.photos.deleteOne({ _id: req.params.id });
    await removePhotoFile(db, ph.file);
    await audit(db, req, 'photo_delete', 'place', ph.place_id);
    json(res, await getPlace(db, ph.place_id, { staff: true }));
  });
}
