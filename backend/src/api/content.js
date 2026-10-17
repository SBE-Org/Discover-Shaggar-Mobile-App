// Managed content: pages, home announcements, the category catalog, sub-city details and system settings.
import { randomUUID } from 'node:crypto';
import { json, readJson, notFound, badRequest } from '../lib/http.js';
import { requirePerm, can } from '../lib/auth.js';
import { validateSubcity, str, parseDateTime } from '../lib/validate.js';
import { audit, nowIso, loadCatalog, getSettings, saveSettings, insert, withDefaults } from '../db.js';
import { DEFAULT_SETTINGS, ICON_CHOICES } from '../shared/catalog.js';
import { pointInBoundary } from '../shared/coords.js';
import { saveImage, removePhotoFile } from '../lib/photos.js';
import { asObj } from './places.js';

const CORE_PAGES = ['about', 'privacy', 'help', 'contact'];
const PAGE_FIELDS = { title: 120, title_om: 120, title_am: 120, body: 20000, body_om: 20000, body_am: 20000 };
const ANN_FIELDS = { title: 120, title_om: 120, title_am: 120, body: 600, body_om: 600, body_am: 600, link_value: 300 };
export const PUBLIC_SETTINGS = ['site.name', 'site.contact_email', 'site.contact_phone', 'gps.good_accuracy_m', 'gps.max_accuracy_m', 'public.show_stale_warning',
  'public.visitor_photos', 'public.customer_menu_items', 'brand.tagline', 'brand.logo', 'brand.hero', 'brand.primary'];
const UPLOADED = ['brand.logo', 'brand.hero'];

const bySortThen = (field) => (a, b) => (a.sort || 0) - (b.sort || 0) || String(a[field]).localeCompare(String(b[field]));
const changedFields = (cur, d, cols) => Object.fromEntries(cols.filter((k) => cur[k] !== d[k]).map((k) => [k, [cur[k] ?? null, d[k]]]));

/** The category catalog in the order the app shows it. */
export async function catalogRows(db) {
  const sectors = (await db.sectors.find({})).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.key.localeCompare(b.key));
  const types = (await db.types.find({})).sort((a, b) => a.sector.localeCompare(b.sector) || (a.sort || 0) - (b.sort || 0) || a.key.localeCompare(b.key));
  return { sectors, types };
}

export default function register(r, { db }) {
  /* ---------- pages ---------- */
  r.get('/api/pages', async (req, res) => {
    const staff = req.query.get('scope') === 'all' && can(req, 'content.manage');
    const projection = { slug: 1, title: 1, title_om: 1, title_am: 1, published: 1, in_menu: 1, sort: 1, updated_at: 1, ...(staff ? { body: 1, body_om: 1, body_am: 1 } : {}) };
    const rows = (await db.pages.find(staff ? {} : { published: 1 }, { projection })).sort(bySortThen('title'));
    json(res, { items: rows });
  });
  r.get('/api/pages/:slug', async (req, res) => {
    const p = await db.pages.findOne({ _id: req.params.slug });
    if (!p || (!p.published && !can(req, 'content.manage'))) throw notFound('Page not found.');
    json(res, p);
  });
  r.put('/api/pages/:slug', async (req, res) => {
    requirePerm(req, 'content.manage');
    const slug = String(req.params.slug).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw badRequest('Use a short web address of letters, numbers and dashes.', { slug: 'Invalid' });
    const body = await readJson(req, 512 * 1024);
    const d = {};
    for (const [k, max] of Object.entries(PAGE_FIELDS)) d[k] = str(body[k], max);
    if (!d.title) throw badRequest('Give the page a title.', { title: 'Required' });
    d.published = body.published === false ? 0 : 1;
    d.in_menu = body.in_menu === false ? 0 : 1;
    d.sort = Number.isFinite(Number(body.sort)) ? Number(body.sort) : 50;
    const cur = await db.pages.findOne({ _id: slug });
    const cols = Object.keys(d);
    if (cur) await db.pages.updateOne({ _id: slug }, { $set: { ...d, updated_by: req.user.id, updated_at: nowIso() } });
    else await insert(db, 'pages', { slug, ...d, updated_by: req.user.id }, 'slug');
    const changes = cur ? changedFields(cur, d, cols) : undefined;
    await audit(db, req, cur ? 'update' : 'create', 'page', slug, { title: d.title, changes });
    json(res, await db.pages.findOne({ _id: slug }), cur ? 200 : 201);
  });
  r.delete('/api/pages/:slug', async (req, res) => {
    requirePerm(req, 'content.manage');
    if (CORE_PAGES.includes(req.params.slug)) throw badRequest('This page is required. Unpublish it instead.');
    const p = await db.pages.findOne({ _id: req.params.slug }, { projection: { title: 1 } });
    if (!p) throw notFound('Page not found.');
    await db.pages.deleteOne({ _id: req.params.slug });
    await audit(db, req, 'delete', 'page', req.params.slug, { title: p.title });
    json(res, { ok: true });
  });

  /* ---------- announcements ---------- */
  r.get('/api/announcements', async (req, res) => {
    const staff = req.query.get('scope') === 'all' && can(req, 'content.manage');
    const now = nowIso();
    const rows = staff
      ? (await db.announcements.find({})).sort((a, b) => (b.active || 0) - (a.active || 0) || (a.sort || 0) - (b.sort || 0) || String(b.created_at).localeCompare(String(a.created_at)))
      : (await db.announcements.find({ active: 1, $and: [{ $or: [{ starts_at: null }, { starts_at: { $lte: now } }] }, { $or: [{ ends_at: null }, { ends_at: { $gte: now } }] }] }))
        .sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10)
        .map(({ created_by, ...x }) => x);
    json(res, { items: rows });
  });
  function annData(body, partial) {
    const errors = {}, d = {};
    for (const [k, max] of Object.entries(ANN_FIELDS)) if (!partial || body[k] !== undefined) d[k] = str(body[k], max);
    if ((!partial || body.title !== undefined) && !d.title) errors.title = 'Write a short title.';
    if (!partial || body.tone !== undefined) d.tone = ['info', 'warn', 'event', 'success'].includes(body.tone) ? body.tone : 'info';
    if (!partial || body.link_kind !== undefined) d.link_kind = ['none', 'place', 'trip', 'page', 'url'].includes(body.link_kind) ? body.link_kind : 'none';
    if (d.link_kind === 'url' && d.link_value && !/^https:\/\//.test(d.link_value)) errors.link_value = 'Links must start with https://';
    if (!partial || body.starts_at !== undefined) d.starts_at = parseDateTime(body.starts_at, 'starts_at', errors);
    if (!partial || body.ends_at !== undefined) d.ends_at = parseDateTime(body.ends_at, 'ends_at', errors);
    if (!partial || body.active !== undefined) d.active = body.active === false ? 0 : 1;
    if (!partial || body.sort !== undefined) d.sort = Number(body.sort) || 0;
    if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
    return d;
  }
  r.post('/api/announcements', async (req, res) => {
    requirePerm(req, 'content.manage');
    const d = annData(await readJson(req), false);
    const id = randomUUID();
    await insert(db, 'announcements', { id, created_by: req.user.id, ...d });
    await audit(db, req, 'create', 'announcement', id, { title: d.title });
    json(res, await db.announcements.findOne({ _id: id }), 201);
  });
  r.patch('/api/announcements/:id', async (req, res) => {
    requirePerm(req, 'content.manage');
    const cur = await db.announcements.findOne({ _id: req.params.id });
    if (!cur) throw notFound('Announcement not found.');
    const d = annData(await readJson(req), true);
    const cols = Object.keys(d);
    if (cols.length) await db.announcements.updateOne({ _id: cur.id }, { $set: { ...d, updated_at: nowIso() } });
    await audit(db, req, 'update', 'announcement', cur.id, { title: d.title || cur.title, fields: cols });
    json(res, await db.announcements.findOne({ _id: cur.id }));
  });
  r.delete('/api/announcements/:id', async (req, res) => {
    requirePerm(req, 'content.manage');
    const cur = await db.announcements.findOne({ _id: req.params.id }, { projection: { title: 1 } });
    if (!cur) throw notFound('Announcement not found.');
    await db.announcements.deleteOne({ _id: req.params.id });
    await audit(db, req, 'delete', 'announcement', req.params.id, { title: cur.title });
    json(res, { ok: true });
  });

  /* ---------- category catalog ---------- */
  r.get('/api/catalog', async (req, res) => {
    const c = await catalogRows(db);
    if (can(req, 'catalog.manage')) {
      const used = {};
      for (const p of await db.places.find({}, { projection: { sector: 1, type: 1 } })) used[p.sector + '/' + p.type] = (used[p.sector + '/' + p.type] || 0) + 1;
      c.types = c.types.map((t) => ({ ...t, places: used[t.sector + '/' + t.key] || 0 }));
    }
    json(res, c);
  });
  const keyOf = (v) => str(v, 30).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  function sectorData(body, partial) {
    const d = {};
    for (const [k, max] of [['label', 40], ['label_om', 60], ['label_am', 60]]) if (!partial || body[k] !== undefined) d[k] = str(body[k], max);
    if ((!partial || body.label !== undefined) && !d.label) throw badRequest('Enter a name.', { label: 'Required' });
    if (!partial || body.color !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(body.color || '')) throw badRequest('Pick a colour.', { color: 'Invalid' }); d.color = body.color; }
    if (!partial || body.icon !== undefined) d.icon = ICON_CHOICES.includes(body.icon) ? body.icon : 'pin';
    if (!partial || body.sort !== undefined) d.sort = Number(body.sort) || 0;
    if (!partial || body.review_months !== undefined) { const m = Number(body.review_months); d.review_months = Number.isInteger(m) && m >= 1 && m <= 36 ? m : 12; }
    if (body.active !== undefined) d.active = body.active ? 1 : 0;
    return d;
  }
  r.post('/api/catalog/sectors', async (req, res) => {
    requirePerm(req, 'catalog.manage');
    const body = await readJson(req);
    const key = keyOf(body.key || body.label);
    if (!key) throw badRequest('Enter a name.', { label: 'Required' });
    if (await db.sectors.findOne({ _id: key })) throw badRequest('That category group already exists.', { label: 'Taken' });
    const d = sectorData(body, false);
    await insert(db, 'sectors', { key, ...d }, 'key');
    await loadCatalog(db);
    await audit(db, req, 'create', 'category', key, { label: d.label });
    json(res, await catalogRows(db), 201);
  });
  r.patch('/api/catalog/sectors/:key', async (req, res) => {
    requirePerm(req, 'catalog.manage');
    const cur = await db.sectors.findOne({ _id: req.params.key });
    if (!cur) throw notFound('Category group not found.');
    const d = sectorData(await readJson(req), true), cols = Object.keys(d);
    if (cols.length) await db.sectors.updateOne({ _id: cur.key }, { $set: d });
    await loadCatalog(db);
    await audit(db, req, 'update', 'category', cur.key, { changes: changedFields(cur, d, cols) });
    json(res, await catalogRows(db));
  });
  function typeData(body, partial) {
    const d = {};
    for (const [k, max] of [['label', 60], ['label_om', 80], ['label_am', 80]]) if (!partial || body[k] !== undefined) d[k] = str(body[k], max);
    if ((!partial || body.label !== undefined) && !d.label) throw badRequest('Enter a name.', { label: 'Required' });
    if (!partial || body.sort !== undefined) d.sort = Number(body.sort) || 0;
    if (!partial || body.attraction !== undefined) d.attraction = body.attraction ? 1 : 0;
    if (!partial || body.has_menu !== undefined) d.has_menu = body.has_menu ? 1 : 0;
    if (body.active !== undefined) d.active = body.active ? 1 : 0;
    return d;
  }
  r.post('/api/catalog/types', async (req, res) => {
    requirePerm(req, 'catalog.manage');
    const body = await readJson(req);
    if (typeof body.sector !== 'string' || !(await db.sectors.findOne({ _id: body.sector }))) throw badRequest('Choose the category group.', { sector: 'Required' });
    const key = keyOf(body.key || body.label);
    if (!key) throw badRequest('Enter a name.', { label: 'Required' });
    if (await db.types.findOne({ _id: body.sector + '/' + key })) throw badRequest('That category already exists in this group.', { label: 'Taken' });
    const d = typeData(body, false);
    const doc = withDefaults('types', { sector: body.sector, key, ...d });
    doc._id = body.sector + '/' + key;
    await db.types.insertOne(doc);
    await loadCatalog(db);
    await audit(db, req, 'create', 'category', body.sector + '/' + key, { label: d.label });
    json(res, await catalogRows(db), 201);
  });
  r.patch('/api/catalog/types/:sector/:key', async (req, res) => {
    requirePerm(req, 'catalog.manage');
    const cur = await db.types.findOne({ _id: req.params.sector + '/' + req.params.key });
    if (!cur) throw notFound('Category not found.');
    const d = typeData(await readJson(req), true), cols = Object.keys(d);
    if (cols.length) await db.types.updateOne({ _id: cur.sector + '/' + cur.key }, { $set: d });
    await loadCatalog(db);
    await audit(db, req, 'update', 'category', cur.sector + '/' + cur.key, { changes: changedFields(cur, d, cols) });
    json(res, await catalogRows(db));
  });
  r.delete('/api/catalog/types/:sector/:key', async (req, res) => {
    requirePerm(req, 'catalog.manage');
    const n = await db.places.count({ sector: req.params.sector, type: req.params.key });
    if (n) throw badRequest(`${n} place(s) use this category. Retire it instead so their records keep a label.`);
    await db.types.deleteOne({ _id: req.params.sector + '/' + req.params.key });
    await loadCatalog(db);
    await audit(db, req, 'delete', 'category', req.params.sector + '/' + req.params.key);
    json(res, await catalogRows(db));
  });

  /* ---------- sub-cities ---------- */
  r.get('/api/subcities', async (req, res) => {
    const rows = await db.subcities.find({}, { sort: { id: 1 } });
    const counts = {};
    for (const p of await db.places.find({ status: 'published', active: 1 }, { projection: { subcity_id: 1 } })) counts[p.subcity_id] = (counts[p.subcity_id] || 0) + 1;
    const showFocal = can(req, 'areas.manage') || can(req, 'reports.view');
    json(res, { items: rows.map((s) => ({ ...s, place_count: counts[s.id] || 0, boundary: asObj(s.boundary), focal_person: showFocal ? s.focal_person : undefined })) });
  });
  r.put('/api/subcities/:id', async (req, res) => {
    requirePerm(req, 'areas.manage');
    const id = Number(req.params.id);
    const cur = await db.subcities.findOne({ id });
    if (!cur) throw notFound('Sub-city not found.');
    const data = validateSubcity(await readJson(req, 4 * 1024 * 1024));
    const cols = Object.keys(data);
    await db.subcities.updateOne({ id }, { $set: { ...data, updated_at: nowIso() } });
    if (data.boundary !== undefined) {
      await db.places.updateMany({ subcity_id: id }, { $set: { boundary_flag: 0 } });
      if (data.boundary) await recheckBoundaries(db, id);
    }
    const changes = Object.fromEntries(cols.filter((k) => k !== 'boundary' && cur[k] !== data[k]).map((k) => [k, [cur[k] ?? null, data[k]]]));
    if (data.boundary !== undefined && JSON.stringify(data.boundary) !== JSON.stringify(cur.boundary ?? null)) changes.boundary = [cur.boundary ? 'set' : 'none', data.boundary ? 'set' : 'none'];
    await audit(db, req, 'update', 'subcity', String(id), { name: data.name, changes });
    const s = await db.subcities.findOne({ id });
    json(res, { ...s, boundary: asObj(s.boundary) });
  });

  /* ---------- branding: logo and home picture ---------- */
  r.post('/api/branding/:kind', async (req, res) => {
    requirePerm(req, 'settings.manage');
    const key = { logo: 'brand.logo', hero: 'brand.hero' }[req.params.kind];
    if (!key) throw notFound('Unknown branding item.');
    const body = await readJson(req, 8 * 1024 * 1024);
    const img = await saveImage(db, body.image);
    if (key === 'brand.logo' && img.width && (img.width < 96 || img.height < 96)) { await removePhotoFile(db, img.file); throw badRequest('Use a logo at least 96 × 96 pixels; 512 × 512 PNG works best.'); }
    const old = getSettings(db)[key];
    await saveSettings(db, { [key]: img.file, [key + '_size']: img.width ? [img.width, img.height] : null }, req.user.id);
    if (old) await removePhotoFile(db, old);
    await audit(db, req, 'update', 'settings', null, { changes: { [key]: [old ? 'image' : 'default', 'new image'] } });
    json(res, { values: getSettings(db) });
  });
  r.delete('/api/branding/:kind', async (req, res) => {
    requirePerm(req, 'settings.manage');
    const key = { logo: 'brand.logo', hero: 'brand.hero' }[req.params.kind];
    if (!key) throw notFound('Unknown branding item.');
    const old = getSettings(db)[key];
    await saveSettings(db, { [key]: '', [key + '_size']: null }, req.user.id);
    if (old) await removePhotoFile(db, old);
    await audit(db, req, 'update', 'settings', null, { changes: { [key]: ['image', 'default'] } });
    json(res, { values: getSettings(db) });
  });

  /* ---------- settings ---------- */
  r.get('/api/settings', (req, res) => {
    requirePerm(req, 'settings.manage');
    json(res, { values: getSettings(db), defaults: DEFAULT_SETTINGS });
  });
  r.put('/api/settings', async (req, res) => {
    requirePerm(req, 'settings.manage');
    const body = await readJson(req);
    const cur = getSettings(db), upd = {}, errors = {};
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
      if (body[k] === undefined || UPLOADED.includes(k)) continue;
      let v = body[k];
      if (typeof def === 'boolean') v = !!v;
      else if (typeof def === 'number') { v = Number(v); if (!Number.isFinite(v) || v < 0 || v > 100000) { errors[k] = 'Enter a number.'; continue; } }
      else v = str(v, 200);
      if (v !== cur[k]) upd[k] = v;
    }
    if (upd['brand.primary'] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(upd['brand.primary'])) errors['brand.primary'] = 'Pick a colour.';
    if (upd['site.name'] !== undefined && !upd['site.name']) errors['site.name'] = 'The app needs a name.';
    if (upd['security.session_days'] !== undefined && (upd['security.session_days'] < 1 || upd['security.session_days'] > 90)) errors['security.session_days'] = 'Use 1 to 90 days.';
    if (Object.keys(errors).length) throw badRequest('Some settings need attention.', errors);
    await saveSettings(db, upd, req.user.id);
    await audit(db, req, 'update', 'settings', null, { changes: Object.fromEntries(Object.keys(upd).map((k) => [k, [cur[k], upd[k]]])) });
    json(res, { values: getSettings(db) });
  });
}

/** Flag places whose point lies outside the boundary of the sub-city they are assigned to. */
export async function recheckBoundaries(db, subcityId) {
  const s = await db.subcities.findOne({ id: subcityId }, { projection: { boundary: 1 } });
  const geo = asObj(s?.boundary);
  if (!geo) return;
  for (const p of await db.places.find({ subcity_id: subcityId }, { projection: { id: 1, lat: 1, lon: 1 } })) {
    await db.places.updateOne({ _id: p.id }, { $set: { boundary_flag: pointInBoundary(p.lat, p.lon, geo) ? 0 : 1 } });
  }
}
