// MongoDB connection, collections, first-start setup and small helpers shared by the API.
//
// Every record keeps the same fields as the original SQL tables, with the same defaults, so the
// API returns exactly what the app expects. Lists and objects (facilities, permissions, opening hours,
// boundaries, menu tags) are stored as real arrays/objects. Integer ids (staff accounts, the activity
// log, location evidence, trip stops and updates) come from a `counters` collection.
import { config } from './config.js';
import { memoryStore } from './store/memory.js';
import { SUBCITY_IDS, defaultSubcityName, applyCatalog, DEFAULT_SETTINGS, DEFAULT_ROLES, defaultCatalog } from './shared/catalog.js';

export const nowIso = () => new Date().toISOString();

/** Collection names, by the property used in the code. */
const COLLECTIONS = {
  users: 'users', sessions: 'sessions', roles: 'roles', settings: 'settings', subcities: 'subcities', sectors: 'sectors', types: 'types',
  places: 'places', photos: 'place_photos', evidence: 'location_evidence', suggestions: 'suggestions', audit: 'audit_log', reports: 'reports',
  trips: 'trips', stops: 'trip_stops', tripUpdates: 'trip_updates', tripPhotos: 'trip_photos', registrations: 'trip_registrations',
  pages: 'pages', announcements: 'announcements', menu: 'menu_items', files: 'files', counters: 'counters', meta: 'meta',
  backups: 'backups', backupChunks: 'backup_chunks',
};
export const COLLECTION_NAMES = Object.values(COLLECTIONS);

/** Field defaults for each collection (the DEFAULT values of the original tables). `NOW` is replaced by the time. */
const NOW = Symbol('now');
const DEFAULTS = {
  users: { subcity_id: null, phone: '', active: 1, mfa_secret: null, mfa_enabled: 0, must_change_password: 0, failed_logins: 0, locked_until: null, created_at: NOW, updated_at: null, last_login_at: null },
  sessions: { created_at: NOW, user_agent: null, ip: null },
  roles: { description: '', permissions: [], is_system: 0, level: 20, created_at: NOW, updated_at: NOW },
  subcities: { phone: '', lat: null, lon: null, official_code: '', alt_names: '', summary: '', summary_om: '', summary_am: '', focal_person: '', boundary: null, active: 1, updated_at: NOW },
  sectors: { label_om: '', label_am: '', color: '#9FB3C8', icon: 'pin', sort: 0, review_months: 12, active: 1 },
  types: { label_om: '', label_am: '', sort: 0, attraction: 0, active: 1, has_menu: 0 },
  places: {
    name_om: '', name_am: '', alt_names: '', woreda: '', kebele: '', accuracy_m: null, coord_source: '', description: '', description_om: '', description_am: '',
    phone: '', email: '', hours: '', hours_json: null, website: '', fee: '', best_time: '', parking: '', facilities: [], accessibility: '', visitor_tips: '', safety: '',
    source: '', owner_department: '', status: 'draft', condition: 'open', active: 1, featured: 0, verified: 0, verified_at: null, verified_by: null, review_months: null,
    last_reviewed_at: null, workflow_note: '', boundary_flag: 0, submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null, published_by: null,
    published_at: null, created_by: null, updated_by: null, created_at: NOW, updated_at: NOW,
  },
  photos: {
    width: null, height: null, sort: 0, created_by: null, created_at: NOW, caption: '', credit: '', rights: 'bureau', alt: '', is_primary: 0, status: 'approved',
    source: 'staff', submitter_name: '', contact: '', ip_hash: null, reviewed_by: null, reviewed_at: null, review_note: '',
  },
  evidence: { accuracy_m: null, captured_at: NOW, collector_id: null, notes: '' },
  suggestions: { place_id: null, accuracy_m: null, photo_file: null, contact_name: '', contact_phone: '', status: 'new', reviewed_by: null, reviewed_at: null, ip_hash: null, created_at: NOW, photo_consent: 0 },
  audit: { user_id: null, entity_id: null, detail: null, created_at: NOW, ip: null, user_agent: null },
  reports: { place_id: null, trip_id: null, description: '', contact: '', status: 'open', assigned_to: null, resolution: '', ip_hash: null, created_at: NOW, updated_at: NOW, resolved_at: null, resolved_by: null },
  trips: {
    title_om: '', title_am: '', summary: '', description: '', description_om: '', description_am: '', category: 'other', subcity_id: null, end_at: null, date_note: '',
    meeting_point: '', meeting_lat: null, meeting_lon: null, meeting_place_id: null, organizer: '', contact_phone: '', contact_email: '', capacity: null, price: '',
    is_free: 1, includes: '', excludes: '', what_to_bring: '', accessibility: '', safety: '', eligibility: '', language: '', duration_note: '', cancellation_policy: '',
    registration_mode: 'none', registration_closes_at: null, status: 'draft', featured: 0, cover_file: null, recap: '', created_by: null, updated_by: null, created_at: NOW, updated_at: NOW,
  },
  stops: { place_id: null, title: '', lat: null, lon: null, planned_time: '', notes: '' },
  tripUpdates: { created_by: null, created_at: NOW },
  tripPhotos: { caption: '', credit: '', rights: 'bureau', sort: 0, created_by: null, created_at: NOW },
  registrations: { email: '', party_size: 1, notes: '', consent: 0, kind: 'register', status: 'confirmed', ip_hash: null, created_at: NOW, updated_at: NOW },
  pages: { title_om: '', title_am: '', body: '', body_om: '', body_am: '', published: 1, in_menu: 1, sort: 0, updated_by: null, updated_at: NOW },
  announcements: { title_om: '', title_am: '', body: '', body_om: '', body_am: '', tone: 'info', link_kind: 'none', link_value: '', starts_at: null, ends_at: null, active: 1, sort: 0, created_by: null, created_at: NOW, updated_at: NOW },
  menu: {
    section: 'Other', name_om: '', name_am: '', description: '', price: null, currency: 'ETB', price_note: '', tags: [], available: 1, sort: 0, photo_file: null, status: 'approved',
    source: 'staff', submitter_name: '', contact: '', ip_hash: null, review_note: '', created_by: null, reviewed_by: null, reviewed_at: null, created_at: NOW, updated_at: NOW,
  },
};

/** A new document for a collection: the defaults, then the given fields (undefined values keep the default). */
export function withDefaults(kind, doc) {
  const now = nowIso();
  const out = {};
  for (const [k, v] of Object.entries(DEFAULTS[kind] || {})) out[k] = v === NOW ? now : Array.isArray(v) ? [...v] : v;
  for (const [k, v] of Object.entries(doc)) if (v !== undefined) out[k] = v;
  return out;
}

/** Insert with defaults. `_id` is the record's own id (or key) so lookups by id use the primary index. */
export async function insert(db, kind, doc, idField = 'id') {
  const d = withDefaults(kind, doc);
  d._id = d[idField];
  await db[kind].insertOne(d);
  return d;
}

/** Next integer id for a collection (users, audit_log, …). */
export async function nextId(db, name) {
  const r = await db.counters.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true });
  return r.seq;
}

const DEFAULT_PAGES = [
  { slug: 'about', sort: 0, title: 'About Discover Shaggar', body: 'Discover Shaggar helps residents, visitors and businesses find verified places across all 12 sub-cities of Shaggar City: tourism sites, public services, health, education, finance, transport and more.\n\nEvery published place has been checked by the city Tourism Bureau. Look for the "Verified on site" label and the last verified date on each place.\n\nThe app is run by the Shaggar City Tourism Bureau with the sub-city administrations.' },
  { slug: 'privacy', sort: 1, title: 'Privacy notice', body: 'What we collect\n• Your location is used only on your phone, when you tap "Near me" or "Use my GPS". We never track you in the background.\n• When you suggest a place, report a problem or register for a trip, we store only the details you type in. Your name and phone are optional unless a trip needs them.\n\nWhy\n• To check suggestions and reports, and to organise trips and contact participants about changes.\n\nWho can see it\n• Only authorised Bureau staff. Trip registrations are visible only to staff who organise trips.\n\nHow long\n• Trip registrations are deleted after the retention period set by the Bureau. Report contacts are removed after they are resolved and the retention period ends.\n\nQuestions or corrections\n• Contact the Tourism Bureau using the details on the Contact page to see, correct or delete your data.' },
  { slug: 'help', sort: 2, title: 'Help', body: 'Finding places\n• Search by name, type or neighbourhood, or pick a category on the Home screen.\n• Tap "Near me" to sort everything by distance.\n• Open a place and tap Directions to navigate with your map app.\n\nSaving places\n• Tap the bookmark on any place. Saved places stay available without a connection.\n\nSomething wrong?\n• Open the place and tap "Report a problem". You get a report code to follow up.' },
  { slug: 'contact', sort: 3, title: 'Contact the Tourism Bureau', body: 'Shaggar City Tourism Bureau\n\nAdd the office address, phone numbers, email and opening hours here from the admin portal (Content → Pages).' },
];

/** Indexes for the queries the app makes. Unique indexes protect emails and public codes. */
async function ensureIndexes(db) {
  const ix = [
    [db.users, { email: 1 }, { unique: true }],
    [db.sessions, { user_id: 1 }], [db.sessions, { expires_at: 1 }],
    [db.places, { status: 1, active: 1 }], [db.places, { sector: 1, type: 1 }], [db.places, { subcity_id: 1, status: 1 }], [db.places, { lat: 1, lon: 1 }], [db.places, { updated_at: -1 }],
    [db.photos, { place_id: 1, sort: 1 }], [db.photos, { status: 1, created_at: -1 }], [db.photos, { ip_hash: 1, status: 1 }],
    [db.evidence, { place_id: 1, captured_at: -1 }],
    [db.suggestions, { status: 1, created_at: -1 }],
    [db.audit, { entity: 1, entity_id: 1 }], [db.audit, { user_id: 1, created_at: -1 }], [db.audit, { action: 1, created_at: -1 }], [db.audit, { id: -1 }],
    [db.reports, { code: 1 }, { unique: true }], [db.reports, { status: 1, created_at: -1 }],
    [db.trips, { status: 1, start_at: 1 }],
    [db.stops, { trip_id: 1, seq: 1 }], [db.tripUpdates, { trip_id: 1, created_at: -1 }], [db.tripPhotos, { trip_id: 1, sort: 1 }],
    [db.registrations, { code: 1 }, { unique: true }], [db.registrations, { trip_id: 1, status: 1 }],
    [db.menu, { place_id: 1, status: 1, section: 1, sort: 1 }], [db.menu, { status: 1, created_at: -1 }],
    [db.types, { sector: 1, key: 1 }, { unique: true }],
    [db.backupChunks, { backup: 1, n: 1 }],
  ];
  for (const [col, spec, opts] of ix) await col.createIndex(spec, opts || {});
}

/** First start: the 12 sub-cities, default roles, settings, categories and information pages. */
async function seedDefaults(db) {
  const meta = await db.meta.findOne({ _id: 'schema' });
  if (meta?.version >= 1) return;
  for (const id of SUBCITY_IDS) {
    if (!(await db.subcities.findOne({ _id: id }))) {
      await insert(db, 'subcities', { id, name: defaultSubcityName(id), official_code: id === 0 ? 'MO' : 'SC' + String(id).padStart(2, '0') });
    }
  }
  for (const r of DEFAULT_ROLES) {
    if (!(await db.roles.findOne({ _id: r.key }))) await insert(db, 'roles', { key: r.key, name: r.name, description: r.description, permissions: r.permissions, is_system: r.is_system, level: r.level }, 'key');
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.settings.updateOne({ _id: key }, { $setOnInsert: { key, value, updated_by: null, updated_at: nowIso() } }, { upsert: true });
  }
  if (!(await db.sectors.count({}))) {
    const cat = defaultCatalog();
    for (const s of cat.sectors) await insert(db, 'sectors', { key: s.key, label: s.label, color: s.color, icon: s.icon, sort: s.sort, review_months: s.review_months, active: 1 }, 'key');
    for (const t of cat.types) {
      const d = withDefaults('types', { sector: t.sector, key: t.key, label: t.label, sort: t.sort, attraction: t.attraction, active: 1, has_menu: t.has_menu });
      d._id = t.sector + '/' + t.key;
      await db.types.insertOne(d);
    }
  }
  for (const p of DEFAULT_PAGES) {
    if (!(await db.pages.findOne({ _id: p.slug }))) await insert(db, 'pages', { slug: p.slug, title: p.title, body: p.body, sort: p.sort }, 'slug');
  }
  await db.meta.updateOne({ _id: 'schema' }, { $set: { version: 1, at: nowIso() } }, { upsert: true });
}

/**
 * Connect and prepare the database. Pass `uri` ("memory" for an in-memory database)
 * or let it come from MONGODB_URI.
 */
export async function openDb(uri = config.mongoUri, dbName = config.dbName) {
  // The driver is loaded only when needed, so tests run without it.
  const store = uri === 'memory' ? memoryStore() : await (await import('./store/mongo.js')).mongoStore(uri, dbName);
  const db = { store, kind: store.kind };
  for (const [prop, name] of Object.entries(COLLECTIONS)) db[prop] = store.collection(name);
  db.close = () => store.close();
  await ensureIndexes(db);
  await seedDefaults(db);
  await loadSettings(db);
  await loadCatalog(db);
  return db;
}

/** Load the editable category catalog from the database into the shared catalog objects. */
export async function loadCatalog(db) {
  const cat = { sectors: await db.sectors.find({}), types: await db.types.find({}) };
  applyCatalog(cat);
  return cat;
}

/**
 * Write an audit entry. Pass req to record the source IP and browser.
 * detail.changes = { field: [before, after] } lets authorised staff restore previous values (FR-051).
 * The detail is kept as JSON text so the activity log can be searched and exported as it is.
 */
export async function audit(db, userOrReq, action, entity, entityId, detail) {
  let userId = userOrReq, ip = null, ua = null;
  if (userOrReq && typeof userOrReq === 'object') {
    userId = userOrReq.user?.id ?? null;
    ip = userOrReq.ip || null;
    ua = String(userOrReq.headers?.['user-agent'] || '').slice(0, 200) || null;
  }
  const id = await nextId(db, 'audit_log');
  await insert(db, 'audit', {
    id, user_id: userId ?? null, action, entity, entity_id: entityId === null || entityId === undefined ? null : String(entityId),
    detail: detail ? JSON.stringify(detail) : null, ip, user_agent: ua,
  });
}

/* ---------- settings (kept in memory; this app runs as one server process) ---------- */
const settingsCache = new WeakMap();
export async function loadSettings(db) {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of await db.settings.find({})) if (r.value !== undefined) s[r.key] = r.value;
  settingsCache.set(db, s);
  return s;
}
export function getSettings(db) { return settingsCache.get(db) || { ...DEFAULT_SETTINGS }; }
export const setting = (db, key) => getSettings(db)[key];
export async function saveSettings(db, values, userId) {
  for (const [key, value] of Object.entries(values)) {
    await db.settings.updateOne({ _id: key }, { $set: { key, value, updated_by: userId ?? null, updated_at: nowIso() } }, { upsert: true });
  }
  return loadSettings(db);
}

/* ---------- small helpers ---------- */
/** { id: name } for a list of user ids (the SQL version used LEFT JOIN users). */
export async function userNames(db, ids) {
  const list = [...new Set(ids.filter((x) => x !== null && x !== undefined))];
  if (!list.length) return {};
  const rows = await db.users.find({ id: { $in: list } }, { projection: { id: 1, name: 1, email: 1 } });
  return Object.fromEntries(rows.map((u) => [u.id, u]));
}
/** { key: role } for every role. */
export async function rolesByKey(db) {
  return Object.fromEntries((await db.roles.find({})).map((r) => [r.key, r]));
}
/** Escape text for use inside a regular expression (search boxes). */
export const rx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Case-insensitive "contains" match, like SQL LIKE '%text%'. */
export const like = (s) => ({ $regex: rx(s), $options: 'i' });
