// App config, CSV import/export, dashboards, the activity log (with restore), system health and backups.
import { json, readJson, send, badRequest, notFound } from '../lib/http.js';
import { requirePerm, can, inScope, requireScope } from '../lib/auth.js';
import { parseCsv, toCsv } from '../lib/csv.js';
import { validatePlace } from '../lib/validate.js';
import { audit, getSettings, nowIso, userNames, like } from '../db.js';
import { config } from '../config.js';
import { SECTORS, TYPES, STATUSES, CITY_BOUNDS, CITY_CENTER, SUBCITY_IDS } from '../shared/catalog.js';
import { parseCoords } from '../shared/coords.js';
import { insertPlace, nearestSubcity, recordEvidence, updatePlace, reviewDue, getPlace } from './places.js';
import { meFor } from './auth.js';
import { PUBLIC_SETTINGS, catalogRows } from './content.js';
import { createBackup, listBackups, readBackup } from '../lib/backup.js';

const STARTED = Date.now();
const LEGACY_STATUS = { pending: 'submitted', reviewed: 'verified', approved: 'verified' };

/** Turn CSV text into validated place records plus a list of row problems. */
export async function prepareImport(db, text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: [], errors: [{ row: 1, message: 'No data rows found. The first row must hold column names.' }] };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
  const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const C = {
    name: col('name', 'placename', 'title'), name_om: col('name_om', 'nameom'), name_am: col('name_am', 'nameam'),
    sector: col('sector', 'category', 'group'), type: col('type', 'subtype', 'kind'),
    sub: col('subcity', 'subcityid', 'subcity_id', 'sub', 'area'), woreda: col('woreda', 'district'), kebele: col('kebele', 'street', 'address', 'landmark'),
    lat: col('latitude', 'lat'), lon: col('longitude', 'lon', 'lng', 'long'), coords: col('coordinates', 'coords', 'gps', 'location', 'latlon', 'latlng'),
    accuracy: col('accuracy_m', 'accuracy'), phone: col('phone', 'tel', 'telephone', 'mobile'), email: col('email'),
    hours: col('hours', 'openinghours', 'opening_hours'), description: col('description', 'desc', 'notes'),
    website: col('website', 'web', 'url'), fee: col('fee', 'entrancefee', 'price'), status: col('status'), verified: col('verified'),
    source: col('source'), owner: col('owner_department', 'owner', 'department'), alt: col('alt_names', 'altnames', 'alternate_names'),
  };
  if (C.name < 0) return { ok: [], errors: [{ row: 1, message: 'Add a "name" column.' }] };
  if (C.coords < 0 && (C.lat < 0 || C.lon < 0)) return { ok: [], errors: [{ row: 1, message: 'Add "latitude" and "longitude" columns (or one "coordinates" column).' }] };

  const byLabel = {};
  for (const s of Object.keys(TYPES)) for (const [k, label] of Object.entries(TYPES[s])) { byLabel[label.toLowerCase()] = [s, k]; byLabel[k] = [s, k]; }
  const subs = await db.subcities.find({}, { projection: { id: 1, name: 1, official_code: 1 } });
  const findSub = (v) => {
    const x = v.trim().toLowerCase();
    if (/^\d+$/.test(x) && +x <= 12) return +x;
    if (x === 'mo' || x.includes('mayor')) return 0;
    const f = subs.find((s) => s.name.toLowerCase() === x || (s.official_code && s.official_code.toLowerCase() === x));
    return f ? f.id : null;
  };
  const g = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const ok = [], errors = [];
  for (const [i, r] of rows.slice(1).entries()) {
    const row = i + 2;
    try {
      const coords = C.coords >= 0 ? g(r, C.coords) : g(r, C.lat) + ', ' + g(r, C.lon);
      let sector = g(r, C.sector).toLowerCase(), type = g(r, C.type).toLowerCase();
      const hit = byLabel[type];
      if (hit && (!SECTORS[sector] || hit[0] === sector)) [sector, type] = hit;
      if (SECTORS[sector] && !TYPES[sector][type]) type = TYPES[sector].other !== undefined ? 'other' : Object.keys(TYPES[sector])[0];
      let sub = C.sub >= 0 && g(r, C.sub) ? findSub(g(r, C.sub)) : null;
      if (sub === null) {
        const p = parseCoords(coords);
        if (p && !p.error) { const ns = await nearestSubcity(db, p.lat, p.lon); if (ns) sub = ns.id; }
      }
      if (sub === null) throw Object.assign(new Error(), { details: { subcity_id: 'No sub-city. Add a subcity column or set sub-city centres first.' } });
      let st = g(r, C.status).toLowerCase();
      st = LEGACY_STATUS[st] || st;
      const data = validatePlace({
        name: g(r, C.name), name_om: g(r, C.name_om), name_am: g(r, C.name_am), alt_names: g(r, C.alt), sector, type, subcity_id: sub, coords,
        coord_source: 'import', accuracy_m: g(r, C.accuracy) || null, woreda: g(r, C.woreda), kebele: g(r, C.kebele), phone: g(r, C.phone), email: g(r, C.email),
        hours: g(r, C.hours), description: g(r, C.description), website: g(r, C.website), fee: g(r, C.fee), source: g(r, C.source), owner_department: g(r, C.owner),
        verified: /^(1|y|yes|true)$/i.test(g(r, C.verified)),
      });
      ok.push({ row, ...data, status: STATUSES.includes(st) ? st : 'submitted' });
    } catch (e) {
      const d = e.details || {};
      errors.push({ row, message: Object.values(d)[0] || e.message || 'Invalid row' });
    }
  }
  return { ok, errors };
}

export default function register(r, { db }) {
  r.get('/api/config', async (req, res) => {
    const s = getSettings(db);
    json(res, {
      tiles: config.tiles, bounds: CITY_BOUNDS, center: CITY_CENTER, user: meFor(req),
      settings: Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]])),
      catalog: await catalogRows(db),
    });
  });

  r.post('/api/import', async (req, res) => {
    requirePerm(req, 'places.import');
    const body = await readJson(req, 10 * 1024 * 1024);
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw badRequest('Paste CSV text or choose a file.');
    const { ok, errors } = await prepareImport(db, body.csv);
    // Imported data is a starting point, not proof (spec 21.1): only publishers may import straight to published.
    const maxStatus = can(req, 'places.publish') ? null : can(req, 'places.review') ? 'verified' : 'submitted';
    for (const p of ok) {
      if (!inScope(req, p.subcity_id)) { errors.push({ row: p.row, message: 'Outside your sub-city.' }); p.skip = true; continue; }
      if (maxStatus && ['published', 'verified'].includes(p.status) && p.status !== maxStatus) p.status = maxStatus;
    }
    const rows = ok.filter((p) => !p.skip);
    if (body.dry_run) return json(res, { ready: rows.length, errors: errors.sort((a, b) => a.row - b.row), preview: rows.slice(0, 8) });
    if (rows.length > 5000) throw badRequest('Import at most 5,000 rows at a time.');
    for (const p of rows) {
      const { row, status, skip, ...data } = p;
      const id = await insertPlace(db, data, req.user.id, { status });
      await recordEvidence(db, id, { lat: data.lat, lon: data.lon, accuracy_m: data.accuracy_m ?? null, method: 'import', collector: req.user.id, notes: 'CSV import' });
    }
    await audit(db, req, 'import', 'place', null, { rows: rows.length, skipped: errors.length });
    json(res, { imported: rows.length, errors });
  });

  r.get('/api/export.csv', async (req, res) => {
    requirePerm(req, 'places.export');
    const subs = Object.fromEntries((await db.subcities.find({}, { projection: { id: 1, name: 1 } })).map((s) => [s.id, s.name]));
    const scoped = req.user.subcity_id !== null && req.user.subcity_id !== undefined;
    const rows = await db.places.find(scoped ? { subcity_id: req.user.subcity_id } : {}, { sort: { subcity_id: 1, sector: 1, name: 1 } });
    const csv = toCsv([
      ['id', 'name', 'name_om', 'name_am', 'alt_names', 'sector', 'type', 'subcity_id', 'subcity', 'woreda', 'kebele', 'latitude', 'longitude', 'accuracy_m', 'coord_source',
        'verified', 'status', 'condition', 'active', 'featured', 'phone', 'email', 'hours', 'website', 'fee', 'description', 'source', 'owner_department',
        'last_reviewed_at', 'review_due', 'updated_at'],
      ...rows.map((p) => [p.id, p.name, p.name_om, p.name_am, p.alt_names, p.sector, p.type, p.subcity_id, subs[p.subcity_id], p.woreda, p.kebele, p.lat, p.lon,
        p.accuracy_m ?? '', p.coord_source, p.verified ? 'yes' : 'no', p.status, p.condition, p.active ? 'yes' : 'no', p.featured ? 'yes' : 'no', p.phone, p.email,
        p.hours, p.website, p.fee, p.description, p.source, p.owner_department, p.last_reviewed_at || '', reviewDue(p), p.updated_at]),
    ]);
    await audit(db, req, 'export', 'place', null, { rows: rows.length });
    send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="shaggar-places-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  });

  /* ---------- dashboards (FR-022, FR-052, spec 10.1) ---------- */
  async function computeDashboard(req) {
    const scoped = req.user.subcity_id !== null && req.user.subcity_id !== undefined;
    const places = await db.places.find(scoped ? { subcity_id: req.user.subcity_id } : {}, {
      projection: {
        id: 1, name: 1, sector: 1, type: 1, subcity_id: 1, status: 1, active: 1, verified: 1, accuracy_m: 1, coord_source: 1, name_om: 1, name_am: 1, description: 1,
        description_om: 1, description_am: 1, review_months: 1, last_reviewed_at: 1, verified_at: 1, updated_at: 1, created_at: 1, boundary_flag: 1, submitted_by: 1, created_by: 1,
      },
    });
    const photoCount = {};
    for (const ph of await db.photos.find({}, { projection: { place_id: 1 } })) photoCount[ph.place_id] = (photoCount[ph.place_id] || 0) + 1;
    for (const p of places) p.photos = photoCount[p.id] || 0;
    const maxAcc = Number(getSettings(db)['gps.max_accuracy_m']) || 20;
    const warnDays = Number(getSettings(db)['review.warn_days']) || 30;
    const now = nowIso(), soon = new Date(Date.now() + warnDays * 864e5).toISOString();
    const cov = Object.fromEntries(SUBCITY_IDS.map((id) => [id, { id, total: 0, published: 0, awaiting: 0, drafts: 0, returned: 0, no_photo: 0, low_accuracy: 0, overdue: 0, unverified: 0, boundary: 0 }]));
    const by_status = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const by_sector = {};
    const quality = { no_photo: [], low_accuracy: [], missing_translation: [], overdue: [], due_soon: [], boundary: [], unverified: [] };
    for (const p of places) {
      const c = cov[p.subcity_id]; if (!c) continue;
      c.total++; by_status[p.status]++;
      by_sector[p.sector] = (by_sector[p.sector] || 0) + 1;
      if (p.status === 'published') c.published++;
      if (['submitted', 'verified'].includes(p.status)) c.awaiting++;
      if (p.status === 'draft') c.drafts++;
      if (p.status === 'needs_correction') c.returned++;
      const live = !['archived', 'rejected'].includes(p.status);
      if (!live) continue;
      const ref = { id: p.id, name: p.name, subcity_id: p.subcity_id, status: p.status };
      if (!p.photos && (p.sector === 'tourism' || p.status === 'published')) { c.no_photo++; quality.no_photo.push(ref); }
      if (p.accuracy_m != null ? p.accuracy_m > maxAcc : p.coord_source === 'import') { c.low_accuracy++; quality.low_accuracy.push({ ...ref, accuracy_m: p.accuracy_m ?? null }); }
      if (!p.name_om || !p.name_am || (p.description && (!p.description_om || !p.description_am))) quality.missing_translation.push(ref);
      if (p.status === 'published') {
        const due = reviewDue(p);
        if (due < now) { c.overdue++; quality.overdue.push({ ...ref, due }); } else if (due < soon) quality.due_soon.push({ ...ref, due });
      }
      if (p.boundary_flag) { c.boundary++; quality.boundary.push(ref); }
      if (!p.verified) { c.unverified++; if (p.status === 'published') quality.unverified.push(ref); }
    }
    const pub = places.filter((p) => p.status === 'published');
    const q = {};
    for (const [k, v] of Object.entries(quality)) q[k] = { count: v.length, items: v.slice(0, 50) };
    const upcomingTrip = { status: { $in: ['scheduled', 'open', 'full', 'postponed'] }, $or: [{ end_at: { $gte: now } }, { end_at: null, start_at: { $gte: now } }] };
    const upcomingTrips = await db.trips.find(upcomingTrip, { sort: { start_at: 1 } });
    const regs = upcomingTrips.length ? await db.registrations.find({ trip_id: { $in: upcomingTrips.map((t) => t.id) }, status: { $in: ['confirmed', 'attended'] } }, { projection: { trip_id: 1, party_size: 1, status: 1 } }) : [];
    const confirmedBy = {};
    for (const g of regs) if (g.status === 'confirmed') confirmedBy[g.trip_id] = (confirmedBy[g.trip_id] || 0) + (g.party_size || 0);
    let recent = [];
    if (can(req, 'audit.view')) {
      const rows = await db.audit.find({}, { sort: { id: -1 }, limit: 12, projection: { id: 1, action: 1, entity: 1, entity_id: 1, detail: 1, created_at: 1, user_id: 1 } });
      const names = await userNames(db, rows.map((a) => a.user_id));
      recent = rows.map(({ user_id, ...a }) => ({ ...a, user_name: names[user_id]?.name ?? null }));
    }
    const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
    return {
      totals: {
        places: places.length, published: pub.length, verified_pct: pub.length ? Math.round(pub.filter((p) => p.verified).length / pub.length * 100) : 0,
        awaiting: by_status.submitted + by_status.verified, returned: by_status.needs_correction,
        complete_pct: pub.length ? Math.round(pub.filter((p) => p.photos && p.description && p.last_reviewed_at).length / pub.length * 100) : 0,
        subcities_covered: Object.values(cov).filter((c) => c.id !== 0 && c.published > 0).length,
      },
      by_status, by_sector, coverage: Object.values(cov), quality: q,
      moderation: {
        suggestions: await db.suggestions.count({ status: 'new' }),
        reports: await db.reports.count({ status: { $in: ['open', 'in_progress', 'needs_info'] } }),
        photos: await db.photos.count({ status: 'pending' }),
        menu_items: await db.menu.count({ status: 'pending' }),
        reports_resolved_30d: await db.reports.count({ resolved_at: { $gt: since(30) } }),
      },
      trips: {
        upcoming: upcomingTrips.length,
        drafts: await db.trips.count({ status: 'draft' }),
        cancelled: await db.trips.count({ status: 'cancelled', start_at: { $gte: since(90) } }),
        registrations: regs.reduce((a, g) => a + (g.party_size || 0), 0),
        next: upcomingTrips.slice(0, 6).map((t) => ({ id: t.id, title: t.title, start_at: t.start_at, status: t.status, capacity: t.capacity ?? null, registered: confirmedBy[t.id] || 0 })),
      },
      people: {
        active_staff: await db.users.count({ active: 1 }),
        logins_7d: await db.audit.count({ action: 'login', created_at: { $gt: since(7) } }),
        failed_logins_7d: await db.audit.count({ action: 'login_failed', created_at: { $gt: since(7) } }),
      },
      my: {
        drafts: places.filter((p) => p.created_by === req.user.id && p.status === 'draft').length,
        returned: places.filter((p) => (p.created_by === req.user.id || p.submitted_by === req.user.id) && p.status === 'needs_correction').length,
        to_verify: can(req, 'places.review') ? places.filter((p) => p.status === 'submitted' && p.created_by !== req.user.id && p.submitted_by !== req.user.id).length : 0,
        to_publish: can(req, 'places.publish') ? places.filter((p) => p.status === 'verified' && p.created_by !== req.user.id && p.submitted_by !== req.user.id).length : 0,
      },
      recent,
      system: can(req, 'system.backup') || can(req, 'settings.manage') ? await systemInfo() : null,
      teams: await teamsFor(scoped ? req.user.subcity_id : null),
      scope: scoped ? req.user.subcity_id : null,
    };
  }
  /** Who approves each sub-city's work, and how much is waiting (load spread across sub-city supervisors). */
  async function teamsFor(only) {
    const roles = Object.fromEntries((await db.roles.find({})).map((x) => [x.key, x]));
    const staff = (await db.users.find({ active: 1 }, { projection: { id: 1, name: 1, subcity_id: 1, last_login_at: 1, role: 1 } }))
      .filter((u) => roles[u.role]).map((u) => ({ ...u, role_name: roles[u.role].name, level: roles[u.role].level, perms: roles[u.role].permissions || [] }));
    const approves = (u) => u.perms.includes('*') || (u.perms.includes('places.publish') && u.perms.includes('places.review'));
    const enters = (u) => !u.perms.includes('*') && u.perms.includes('places.create') && !u.perms.includes('places.review');
    const waiting = {};
    for (const p of await db.places.find({ status: { $in: ['submitted', 'verified'] } }, { projection: { subcity_id: 1, submitted_at: 1, updated_at: 1 } })) {
      const w = (waiting[p.subcity_id] ||= { n: 0, oldest: null });
      const t = p.submitted_at || p.updated_at;
      w.n++; if (!w.oldest || t < w.oldest) w.oldest = t;
    }
    const pendingIds = [
      ...(await db.photos.find({ status: 'pending' }, { projection: { place_id: 1 } })),
      ...(await db.menu.find({ status: 'pending' }, { projection: { place_id: 1 } })),
    ].map((x) => x.place_id);
    const subOf = Object.fromEntries((pendingIds.length ? await db.places.find({ id: { $in: [...new Set(pendingIds)] } }, { projection: { id: 1, subcity_id: 1 } }) : []).map((p) => [p.id, p.subcity_id]));
    const contrib = {};
    for (const id of pendingIds) if (subOf[id] !== undefined) contrib[subOf[id]] = (contrib[subOf[id]] || 0) + 1;
    return SUBCITY_IDS.filter((id) => only === null || id === only).map((id) => {
      const sup = staff.filter((u) => (u.subcity_id ?? null) === id && approves(u));
      return {
        id, supervisors: sup.map((u) => ({ id: u.id, name: u.name, role: u.role_name, last_login_at: u.last_login_at ?? null })),
        data_entry: staff.filter((u) => (u.subcity_id ?? null) === id && enters(u)).length,
        waiting: waiting[id]?.n || 0, oldest: waiting[id]?.oldest || null, contributions: contrib[id] || 0,
        routed_to: sup.length ? 'subcity' : 'central',
      };
    });
  }

  r.get('/api/dashboard', async (req, res) => {
    requirePerm(req, 'reports.view', 'places.view');
    json(res, await computeDashboard(req));
  });
  // Compact numbers for the mobile admin page.
  r.get('/api/stats', async (req, res) => {
    requirePerm(req, 'reports.view', 'places.view');
    const d = await computeDashboard(req);
    const bySub = {};
    for (const p of await db.places.find({}, { projection: { subcity_id: 1, sector: 1 } })) { const k = p.subcity_id + '|' + p.sector; bySub[k] = (bySub[k] || 0) + 1; }
    json(res, {
      total: d.totals.places, published: d.totals.published, suggestions: d.moderation.suggestions, reports: d.moderation.reports,
      contributions: can(req, 'contributions.manage') ? d.teams.reduce((a, t) => a + t.contributions, 0) : 0,
      by_status: d.by_status, by_sector: d.by_sector, my: d.my, overdue: d.quality.overdue.count, trips_upcoming: d.trips.upcoming,
      verified: await db.places.count({ verified: 1 }),
      by_subcity: Object.entries(bySub).map(([k, n]) => { const [s, sector] = k.split('|'); return { subcity_id: Number(s), sector, n }; }),
      recent: await db.places.find({}, { sort: { updated_at: -1 }, limit: 8, projection: { id: 1, name: 1, status: 1, updated_at: 1 } }),
    });
  });

  /* ---------- activity log (FR-051, spec 8 AuditLog) ---------- */
  async function auditQuery(req, limit) {
    const q = req.query, and = [];
    if (q.get('user')) and.push({ user_id: Number(q.get('user')) });
    if (q.get('action')) and.push({ action: q.get('action') });
    if (q.get('entity')) and.push({ entity: q.get('entity') });
    if (q.get('entity_id')) and.push({ entity_id: q.get('entity_id') });
    if (q.get('from')) and.push({ created_at: { $gte: new Date(q.get('from') + 'T00:00:00+03:00').toISOString() } });
    if (q.get('to')) and.push({ created_at: { $lt: new Date(new Date(q.get('to') + 'T00:00:00+03:00').getTime() + 864e5).toISOString() } });
    if (q.get('q')) {
      const text = q.get('q').slice(0, 60);
      const who = await db.users.find({ name: like(text) }, { projection: { id: 1 } });
      and.push({ $or: [{ detail: like(text) }, { entity_id: like(text) }, { ip: like(text) }, ...(who.length ? [{ user_id: { $in: who.map((u) => u.id) } }] : [])] });
    }
    if (q.get('security') === '1') and.push({ $or: [{ action: { $in: ['login', 'login_failed', 'logout', 'password', 'mfa_enable', 'mfa_disable'] } }, { entity: { $in: ['user', 'role', 'settings'] } }] });
    const before = Number(q.get('before')) || 0;
    if (before) and.push({ id: { $lt: before } });
    const rows = await db.audit.find(and.length ? { $and: and } : {}, { sort: { id: -1 }, limit });
    const names = await userNames(db, rows.map((a) => a.user_id));
    return rows.map((a) => ({ ...a, user_name: names[a.user_id]?.name ?? null, user_email: names[a.user_id]?.email ?? null }));
  }
  r.get('/api/audit', async (req, res) => {
    requirePerm(req, 'audit.view');
    const limit = Math.min(500, Math.max(10, Number(req.query.get('limit')) || 100));
    const items = (await auditQuery(req, limit)).map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null }));
    json(res, { items, next: items.length === limit ? items[items.length - 1].id : null, actions: (await db.audit.distinct('action')).sort() });
  });
  r.get('/api/audit.csv', async (req, res) => {
    requirePerm(req, 'audit.view');
    const rows = await auditQuery(req, 50000);
    await audit(db, req, 'export', 'audit', null, { rows: rows.length });
    send(res, 200, toCsv([['id', 'time_utc', 'user', 'email', 'action', 'entity', 'entity_id', 'detail', 'ip', 'user_agent'],
      ...rows.map((a) => [a.id, a.created_at, a.user_name || 'System', a.user_email || '', a.action, a.entity, a.entity_id || '', a.detail || '', a.ip || '', a.user_agent || ''])]), {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  });
  // Restore the previous values recorded in an audit entry (place edits).
  r.post('/api/audit/:id/revert', async (req, res) => {
    requirePerm(req, 'places.review', 'places.publish');
    requirePerm(req, 'places.edit');
    const a = await db.audit.findOne({ id: Number(req.params.id) });
    if (!a || a.entity !== 'place' || a.action !== 'update') throw badRequest('Only place edits can be restored.');
    const d = JSON.parse(a.detail || '{}');
    const changes = d.changes || {};
    const keys = Object.keys(changes).filter((k) => !['verified', 'boundary_flag'].includes(k));
    if (!keys.length) throw badRequest('That entry has no recorded values to restore.');
    const cur = await db.places.findOne({ _id: a.entity_id }, { projection: { subcity_id: 1 } });
    if (!cur) throw notFound('That place no longer exists.');
    requireScope(req, cur.subcity_id);
    const restore = Object.fromEntries(keys.map((k) => [k, changes[k][0]]));
    const ch = await updatePlace(db, a.entity_id, restore, req.user.id);
    await audit(db, req, 'update', 'place', a.entity_id, { name: d.name, changes: ch, restored_from: a.id });
    json(res, { ok: true, restored: Object.keys(ch), place: await getPlace(db, a.entity_id, { staff: true }) });
  });

  /* ---------- system health and backups ---------- */
  async function systemInfo() {
    const files = await db.files.find({}, { projection: { size: 1 } });
    const backups = await listBackups(db);
    const st = await db.store.stats();
    return {
      uptime_s: Math.round((Date.now() - STARTED) / 1000), node: process.version, db_bytes: st.storageSize || st.dataSize || 0, database: db.kind,
      uploads: files.length, upload_bytes: files.reduce((a, f) => a + (f.size || 0), 0), backups: backups.slice(0, 20), last_backup: backups[0]?.at || null,
      sessions: await db.sessions.count({}), memory_mb: Math.round(process.memoryUsage().rss / 1048576),
    };
  }
  r.get('/api/system', async (req, res) => { requirePerm(req, 'system.backup', 'settings.manage'); json(res, await systemInfo()); });
  r.post('/api/system/backup', async (req, res) => {
    requirePerm(req, 'system.backup');
    const b = await createBackup(db, { keep: config.backupsKept });
    await audit(db, req, 'backup', 'system', b.name);
    json(res, { ok: true, name: b.name, ...(await systemInfo()) });
  });
  r.get('/api/system/backups/:name', async (req, res) => {
    requirePerm(req, 'system.backup');
    const name = String(req.params.name);
    const buf = /^shaggar-[\d-]+\.json\.gz$/.test(name) ? await readBackup(db, name) : null;
    if (!buf) throw notFound('Backup not found.');
    await audit(db, req, 'download', 'backup', name);
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'Content-Length': buf.length });
    res.end(buf);
  });
  r.get('/api/system/check', async (req, res) => {
    requirePerm(req, 'system.backup', 'settings.manage');
    let integrity = 'ok';
    try { await db.store.ping(); } catch (e) { integrity = 'Database not reachable: ' + e.message; }
    // Records that point at a place that no longer exists (what SQL called foreign key problems).
    const ids = new Set(await db.places.distinct('id'));
    let problems = 0;
    for (const col of [db.photos, db.evidence, db.menu]) for (const id of await col.distinct('place_id')) if (!ids.has(id)) problems++;
    json(res, { integrity, foreign_key_problems: problems });
  });
}

