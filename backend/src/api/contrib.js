// Restaurant menus and visitor contributions.
// Staff keep menus up to date; customers can add menu items and visitors can upload photos of tourist sites.
// Anything from the public, and menu changes by data-entry staff, waits for approval by a supervisor of
// that sub-city or anyone city-wide who holds "contributions.manage".
import { randomUUID, createHash } from 'node:crypto';
import { json, readJson, notFound, badRequest, HttpError } from '../lib/http.js';
import { can, requirePerm, requireScope, inScope } from '../lib/auth.js';
import { str } from '../lib/validate.js';
import { saveImage, removePhotoFile } from '../lib/photos.js';
import { rateLimit } from '../lib/ratelimit.js';
import { audit, nowIso, setting, insert, userNames } from '../db.js';
import { config } from '../config.js';
import { hasMenu, allowsVisitorPhotos } from '../shared/catalog.js';
import { addPhoto, getPlace, menuOut } from './places.js';

const limitPublic = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, message: 'You have sent a lot in the last hour. Try again later.' });
const ipHash = (ip) => createHash('sha256').update(config.ipSalt + ip).digest('hex').slice(0, 24);
const TAGS = ['fasting', 'vegetarian', 'spicy', 'popular', 'new', 'halal'];
const menuSort = (a, b) => (a.sort || 0) - (b.sort || 0) || String(a.section).localeCompare(String(b.section)) || String(a.name).localeCompare(String(b.name));

function menuData(body, partial) {
  const errors = {}, d = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('name')) { d.name = str(body.name, 120); if (!d.name) errors.name = 'Enter the dish or item name.'; }
  for (const [k, max] of [['name_om', 120], ['name_am', 120], ['description', 500], ['price_note', 80]]) if (!partial || has(k)) d[k] = str(body[k], max);
  if (!partial || has('section')) d.section = str(body.section, 60) || 'Other';
  if (!partial || has('price')) {
    const raw = body.price === '' || body.price === null || body.price === undefined ? null : Number(String(body.price).replace(/[^\d.]/g, ''));
    if (raw !== null && (!Number.isFinite(raw) || raw < 0 || raw > 10000000)) errors.price = 'Enter the price as a number, or leave it empty.';
    else d.price = raw === null ? null : Math.round(raw * 100) / 100;
  }
  if (!partial || has('currency')) d.currency = /^[A-Z]{3}$/.test(body.currency || '') ? body.currency : 'ETB';
  if (!partial || has('tags')) d.tags = (Array.isArray(body.tags) ? body.tags : []).filter((t) => TAGS.includes(t));
  if (has('available')) d.available = body.available ? 1 : 0;
  if (has('sort')) d.sort = Number(body.sort) || 0;
  if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
  return d;
}

export default function register(r, { db }) {
  const placeRow = (id) => db.places.findOne({ _id: id }, { projection: { id: 1, name: 1, sector: 1, type: 1, subcity_id: 1, status: 1 } });
  const approver = (req, place) => can(req, 'contributions.manage') && inScope(req, place.subcity_id);

  /* ---------- menus: staff ---------- */
  r.get('/api/places/:id/menu', async (req, res) => {
    const p = await placeRow(req.params.id);
    const staff = can(req, 'places.view');
    if (!p || (!staff && p.status !== 'published')) throw notFound('Place not found.');
    const rows = await db.menu.find(staff ? { place_id: p.id } : { place_id: p.id, status: 'approved', available: 1 });
    json(res, { items: rows.sort(menuSort).map((m) => menuOut(m, staff)) });
  });

  r.post('/api/places/:id/menu', async (req, res) => {
    requirePerm(req, 'places.edit', 'places.create');
    const p = await placeRow(req.params.id);
    if (!p) throw notFound('Place not found.');
    requireScope(req, p.subcity_id);
    const body = await readJson(req, 8 * 1024 * 1024);
    const d = menuData(body, false);
    // Data-entry changes on a live place wait for approval; in a draft they are approved with the record.
    const status = approver(req, p) || p.status !== 'published' ? 'approved' : 'pending';
    const id = randomUUID();
    const photo = typeof body.photo === 'string' && body.photo ? (await saveImage(db, body.photo)).file : null;
    const last = await db.menu.findOne({ place_id: p.id }, { sort: { sort: -1 }, projection: { sort: 1 } });
    const sort = d.sort ?? (last ? (last.sort || 0) + 1 : 1);
    await insert(db, 'menu', {
      id, place_id: p.id, section: d.section, name: d.name, name_om: d.name_om, name_am: d.name_am, description: d.description, price: d.price, currency: d.currency,
      price_note: d.price_note, tags: d.tags, available: d.available ?? 1, sort, photo_file: photo, status, source: 'staff', created_by: req.user.id,
      reviewed_by: status === 'approved' ? req.user.id : null, reviewed_at: status === 'approved' ? nowIso() : null,
    });
    await audit(db, req, 'menu_add', 'place', p.id, { name: p.name, item: d.name, price: d.price, pending: status === 'pending' || undefined });
    json(res, { item: menuOut(await db.menu.findOne({ _id: id }), true), place: await getPlace(db, p.id, { staff: true }) }, 201);
  });

  async function loadItem(req, id) {
    const m = await db.menu.findOne({ _id: id });
    if (!m) throw notFound('Menu item not found.');
    const p = await placeRow(m.place_id);
    if (!p) throw notFound('Place not found.');
    requireScope(req, p.subcity_id);
    return { m, p };
  }
  r.patch('/api/menu/:id', async (req, res) => {
    requirePerm(req, 'places.edit');
    const { m, p } = await loadItem(req, req.params.id);
    const body = await readJson(req, 8 * 1024 * 1024);
    const d = menuData(body, true);
    const mayApprove = approver(req, p);
    if (m.status === 'approved' && p.status === 'published' && !mayApprove) throw new HttpError(403, 'This item is live. Ask your supervisor to change it, or add a corrected item for approval.');
    if (typeof body.photo === 'string' && body.photo) { d.photo_file = (await saveImage(db, body.photo)).file; await removePhotoFile(db, m.photo_file); }
    if (body.remove_photo) { d.photo_file = null; await removePhotoFile(db, m.photo_file); }
    const changes = Object.fromEntries(Object.keys(d).filter((k) => JSON.stringify(m[k] ?? null) !== JSON.stringify(d[k] ?? null)).map((k) => [k, [m[k] ?? null, d[k]]]));
    d.updated_at = nowIso();
    await db.menu.updateOne({ _id: m.id }, { $set: d });
    await audit(db, req, 'menu_update', 'place', p.id, { name: p.name, item: d.name || m.name, changes });
    json(res, { item: menuOut(await db.menu.findOne({ _id: m.id }), true) });
  });
  r.delete('/api/menu/:id', async (req, res) => {
    requirePerm(req, 'places.edit');
    const { m, p } = await loadItem(req, req.params.id);
    if (m.status === 'approved' && p.status === 'published' && !approver(req, p)) throw new HttpError(403, 'Only a supervisor can remove a live menu item.');
    await db.menu.deleteOne({ _id: m.id });
    await removePhotoFile(db, m.photo_file);
    await audit(db, req, 'menu_delete', 'place', p.id, { name: p.name, item: m.name });
    json(res, { ok: true });
  });

  /* ---------- customers and visitors ---------- */
  r.post('/api/places/:id/menu/suggest', async (req, res) => {
    limitPublic('m:' + req.ip);
    const body = await readJson(req, 8 * 1024 * 1024);
    if (body.hp) return json(res, { ok: true }, 201);
    if (setting(db, 'public.customer_menu_items') === false) throw new HttpError(403, 'Menu suggestions are switched off.');
    const p = await placeRow(req.params.id);
    if (!p || p.status !== 'published') throw notFound('Place not found.');
    if (!hasMenu(p)) throw badRequest('This place does not have a menu.');
    const d = menuData(body, false);
    const photo = typeof body.photo === 'string' && body.photo ? (await saveImage(db, body.photo)).file : null;
    await insert(db, 'menu', {
      id: randomUUID(), place_id: p.id, section: d.section, name: d.name, description: d.description, price: d.price, currency: d.currency, price_note: d.price_note,
      tags: d.tags, photo_file: photo, status: 'pending', source: 'customer', submitter_name: str(body.submitter_name, 80), contact: str(body.contact, 120), ip_hash: ipHash(req.ip), sort: 999,
    });
    json(res, { ok: true }, 201);
  });

  r.post('/api/places/:id/visitor-photos', async (req, res) => {
    limitPublic('p:' + req.ip);
    const body = await readJson(req, 8 * 1024 * 1024);
    if (body.hp) return json(res, { ok: true }, 201);
    if (setting(db, 'public.visitor_photos') === false) throw new HttpError(403, 'Visitor photos are switched off.');
    const p = await placeRow(req.params.id);
    if (!p || p.status !== 'published') throw notFound('Place not found.');
    if (!allowsVisitorPhotos(p)) throw badRequest('Photos can be shared for tourism places only.');
    const errors = {};
    if (!body.consent) errors.consent = 'Please confirm you took the photo and allow the city to publish it.';
    if (typeof body.photo !== 'string' || !body.photo) errors.photo = 'Choose a photo.';
    if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
    const pending = await db.photos.count({ ip_hash: ipHash(req.ip), status: 'pending' });
    if (pending >= 10) throw new HttpError(429, 'You already have 10 photos waiting for approval. Please wait until they are checked.');
    const name = str(body.name, 80);
    await addPhoto(db, p.id, await saveImage(db, body.photo), null, {
      caption: body.caption, credit: name ? name : 'Visitor', rights: 'permission', status: 'pending', source: 'visitor',
      submitter_name: name, contact: body.contact, ip_hash: ipHash(req.ip), alt: body.caption,
    });
    json(res, { ok: true }, 201);
  });

  /* ---------- moderation queue ---------- */
  r.get('/api/contributions', async (req, res) => {
    requirePerm(req, 'contributions.manage');
    const status = ['pending', 'approved', 'rejected'].includes(req.query.get('status')) ? req.query.get('status') : 'pending';
    const kind = req.query.get('kind');
    const scope = req.user.subcity_id !== null && req.user.subcity_id !== undefined ? req.user.subcity_id : null;
    const pick = (rows) => rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 300);
    const photoRows = kind === 'menu' ? [] : await db.photos.find({ status, $or: [{ source: 'visitor' }, { status: { $ne: 'approved' } }] });
    const menuRows = kind === 'photo' ? [] : await db.menu.find({ status, $or: [{ source: 'customer' }, { status: { $ne: 'approved' } }] });
    const pids = [...new Set([...photoRows, ...menuRows].map((x) => x.place_id))];
    const places = Object.fromEntries((pids.length ? await db.places.find({ id: { $in: pids } }, { projection: { id: 1, name: 1, subcity_id: 1, sector: 1, type: 1 } }) : []).map((p) => [p.id, p]));
    const inQueue = (x) => places[x.place_id] && (scope === null || places[x.place_id].subcity_id === scope);
    const photos = pick(photoRows.filter(inQueue));
    const menu = pick(menuRows.filter(inQueue));
    const names = await userNames(db, [...photos.map((x) => x.reviewed_by), ...menu.map((x) => x.reviewed_by), ...menu.map((x) => x.created_by)]);
    const outPhotos = photos.map((x) => ({
      kind: 'photo', id: x.id, place_id: x.place_id, place_name: places[x.place_id].name, subcity_id: places[x.place_id].subcity_id, url: '/uploads/' + x.file, caption: x.caption, credit: x.credit,
      source: x.source, submitter_name: x.submitter_name, contact: x.contact, status: x.status, created_at: x.created_at, reviewer: names[x.reviewed_by]?.name ?? null, reviewed_at: x.reviewed_at ?? null, review_note: x.review_note,
    }));
    const outMenu = menu.map((x) => ({
      kind: 'menu', ...menuOut(x, true), place_id: x.place_id, place_name: places[x.place_id].name, subcity_id: places[x.place_id].subcity_id, contact: x.contact,
      creator: names[x.created_by]?.name ?? null, reviewer: names[x.reviewed_by]?.name ?? null, reviewed_at: x.reviewed_at ?? null,
    }));
    json(res, { items: [...outPhotos, ...outMenu].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) });
  });

  async function decide(req, kind, id, approve, note, edits = {}) {
    const col = kind === 'photo' ? db.photos : db.menu;
    const x = await col.findOne({ _id: id });
    if (!x) throw notFound('Not found.');
    const p = await placeRow(x.place_id);
    if (!p) throw notFound('Not found.');
    if (!approver(req, p)) throw new HttpError(403, 'Only a supervisor of this sub-city, or a city-wide supervisor, can decide on this.');
    if (x.status !== 'pending') throw new HttpError(409, 'This was already decided.');
    if (x.created_by && x.created_by === req.user.id && !req.user.all) throw new HttpError(403, 'Someone else must approve what you added.');
    const upd = { status: approve ? 'approved' : 'rejected', reviewed_by: req.user.id, reviewed_at: nowIso(), review_note: str(note, 300), ...edits };
    if (!approve) {
      await removePhotoFile(db, kind === 'photo' ? x.file : x.photo_file);
      upd.contact = '';
      if (kind === 'menu') upd.photo_file = null;
    }
    await col.updateOne({ _id: id }, { $set: upd });
    await audit(db, req, approve ? 'approve' : 'reject', kind === 'photo' ? 'visitor_photo' : 'menu_item', id, { name: p.name, place: p.id, item: x.name || x.caption || undefined, note: note || undefined });
  }
  r.post('/api/contributions/:kind/:id/:decision', async (req, res) => {
    requirePerm(req, 'contributions.manage');
    const kind = req.params.kind;
    if (!['photo', 'menu'].includes(kind) || !['approve', 'reject'].includes(req.params.decision)) throw notFound('Unknown action.');
    const body = await readJson(req);
    const approve = req.params.decision === 'approve';
    const edits = {};
    if (approve && kind === 'menu' && body.edits) Object.assign(edits, menuData(body.edits, true));
    if (approve && kind === 'photo' && body.caption !== undefined) edits.caption = str(body.caption, 200);
    await decide(req, kind, req.params.id, approve, body.note, edits);
    json(res, { ok: true });
  });
}
