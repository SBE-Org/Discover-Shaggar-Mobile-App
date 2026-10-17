// App state, data loading, saved places and the action registry shared by all views.
// The state lives in plain objects (S, data, ui); any change is followed by emit(), and every
// component that calls useStore() re-renders. This keeps the app's behaviour identical to the
// original while React draws the screens.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { SUBCITY_IDS, defaultSubcityName, subcityCode, STATUSES, applyCatalog } from '../shared/catalog.js';
import { haversine, pointInBoundary } from '../shared/coords.js';

export const S = {
  view: 'home', subView: null,
  sector: 'all', sub: null, q: '', sel: null,
  near: null, nearMode: false, nearChip: null, route: null, sheet: 'half', flt: [],
  discTab: 'all', subTab: 'all', planDays: 2, planInt: [], tripTab: 'upcoming',
  btab: 'tasks', bq: '', bSec: 'all', bSub: 'all', bStat: 'all', bLimit: 40,
  me: null, config: null, loading: true, offline: false,
  pick: null, draft: null, imp: null, locating: false, layer: 'dark',
};

export const data = {
  places: [],          // published places (public)
  byId: new Map(),
  all: null,           // every place the staff member may see (loaded on demand)
  subcities: new Map(),
  suggestions: [],
  reports: [],
  stats: null,
  trips: [],
  announcements: [],
  pages: [],
};

/** Modal, toast and other interface state. */
export const ui = { modal: null, modalKey: 0, toast: null, toastKey: 0 };

/** Actions are registered by each module and called from event handlers. */
export const actions = {};

/* ---------- change notification ---------- */
let version = 0;
const listeners = new Set();
export function emit() { version++; listeners.forEach((fn) => fn()); }
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** Re-render the calling component whenever the state changes. */
export const useStore = () => useSyncExternalStore(subscribe, () => version);

let toastTimer;
export function notify(msg, kind = '') {
  ui.toast = { msg, kind }; ui.toastKey++;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; emit(); }, 3200);
  emit();
}

/** Open a modal. `render` returns the modal's content and is called on every render. */
export function openModal(render, { placeId = '', onClose = null } = {}) {
  if (!ui.modal) ui.lastFocus = document.activeElement;
  ui.modal = { render, placeId, onClose };
  ui.modalKey++;
  emit();
}
export function closeModal() {
  if (!ui.modal) return;
  const cb = ui.modal.onClose;
  ui.modal = null;
  if (/^#(place|trip|page)-/.test(location.hash)) { try { history.replaceState(null, '', '#' + (S.view === 'sub' ? 'area-' + S.subView : S.view)); } catch { /* ignore */ } }
  emit();
  cb?.();
  try { ui.lastFocus?.focus(); } catch { /* element gone */ }
}
actions.openModal = openModal;
actions.closeModal = closeModal;

/** Permission checks mirror the server; the server always has the final say. */
export const can = (p) => !!S.me && (S.me.permissions || []).includes(p);
export const isStaff = () => !!S.me && (S.me.permissions || []).length > 0;
export const isEditor = () => can('places.create') || can('places.edit');
export const isAdmin = () => can('users.manage');

export const subName = (id) => data.subcities.get(id)?.name || defaultSubcityName(id);
export const subPhone = (id) => data.subcities.get(id)?.phone || '';
export const subCentre = (id) => { const s = data.subcities.get(id); return s && s.lat != null && s.lon != null ? s : null; };
export { subcityCode, SUBCITY_IDS, STATUSES };

export function nearestSub(lat, lon) {
  for (const id of SUBCITY_IDS) {
    const s = data.subcities.get(id);
    if (s?.boundary && pointInBoundary(lat, lon, s.boundary)) return { id, d: 0, inside: true };
  }
  let best = null;
  for (const id of SUBCITY_IDS) {
    const c = subCentre(id);
    if (!c) continue;
    const d = haversine(lat, lon, c.lat, c.lon);
    if (!best || d < best.d) best = { id, d };
  }
  return best;
}

function indexPlaces() {
  data.byId = new Map(data.places.map((p) => [p.id, p]));
  if (data.all) data.all.forEach((p) => { if (!data.byId.has(p.id)) data.byId.set(p.id, p); });
}

/* ---------- offline cache ---------- */
const CACHE_KEY = 'sdc-cache-v2';
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      places: data.places, subcities: [...data.subcities.values()], trips: data.trips, announcements: data.announcements, pages: data.pages,
      catalog: S.config?.catalog, at: Date.now(),
    }));
  } catch { /* storage full or blocked */ }
}
export function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c) return false;
    if (c.catalog) applyCatalog(c.catalog);
    data.places = c.places || [];
    data.subcities = new Map((c.subcities || []).map((s) => [s.id, s]));
    data.trips = c.trips || []; data.announcements = c.announcements || []; data.pages = c.pages || [];
    indexPlaces();
    S.cacheAt = c.at;
    return true;
  } catch { return false; }
}

export async function loadPublic() {
  try {
    const [pl, sc, tr, an, pg] = await Promise.all([
      api.places(), api.subcities(), api.trips({ when: 'upcoming' }), api.announcements(), api.pages(),
    ]);
    data.places = pl.items;
    data.subcities = new Map(sc.items.map((s) => [s.id, s]));
    data.trips = tr.items; data.announcements = an.items; data.pages = pg.items;
    indexPlaces();
    S.offline = false;
    saveCache();
    refreshSavedSummaries();
  } catch (e) {
    if (e.status === 0 || e.status === 503) S.offline = true; else throw e;
  } finally {
    S.loading = false;
    emit();
  }
}

export async function loadEditorData() {
  if (!isStaff()) { data.all = null; data.suggestions = []; data.reports = []; data.stats = null; emit(); return; }
  const jobs = [
    can('places.view') ? api.places({ scope: 'all' }) : null,
    can('moderation.manage') ? api.suggestions() : null,
    can('moderation.manage') ? api.reports('active') : null,
    can('reports.view') || can('places.view') ? api.stats() : null,
  ];
  const [all, sugg, reps, stats] = await Promise.all(jobs.map((j) => j && j.catch(() => null)));
  data.all = all?.items || null; data.suggestions = sugg?.items || []; data.reports = reps?.items || []; data.stats = stats;
  indexPlaces();
  emit();
}

export async function refreshAll() {
  await loadPublic();
  if (isStaff()) await loadEditorData();
}

/** Replace one place in the local lists after an edit, without a full reload. */
export function upsertLocal(p) {
  const pub = p.status === 'published' && p.active;
  data.places = data.places.filter((x) => x.id !== p.id);
  if (pub) data.places.push(p);
  if (data.all) { data.all = data.all.filter((x) => x.id !== p.id); data.all.push(p); }
  indexPlaces();
}
export function removeLocal(id) {
  data.places = data.places.filter((x) => x.id !== id);
  if (data.all) data.all = data.all.filter((x) => x.id !== id);
  indexPlaces();
}

/* ---------- saved places and recently viewed (kept on the phone, available offline) ---------- */
const SAVED_KEY = 'sdc-saved-v1', RECENT_KEY = 'sdc-recent-v1';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const summary = (p) => ({ id: p.id, name: p.name, name_om: p.name_om, name_am: p.name_am, sector: p.sector, type: p.type, subcity_id: p.subcity_id, lat: p.lat, lon: p.lon, phone: p.phone, hours: p.hours, kebele: p.kebele, cover: p.cover, verified: p.verified, at: Date.now() });
export const savedList = () => read(SAVED_KEY);
export const recentList = () => read(RECENT_KEY);
export const isSaved = (id) => savedList().some((x) => x.id === id);
export function toggleSaved(p) {
  const list = savedList();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) list.splice(i, 1); else list.unshift(summary(p));
  write(SAVED_KEY, list.slice(0, 200));
  return i < 0;
}
export function unsave(id) { write(SAVED_KEY, savedList().filter((p) => p.id !== id)); }
export function addRecent(p) {
  const list = recentList().filter((x) => x.id !== p.id);
  list.unshift(summary(p));
  write(RECENT_KEY, list.slice(0, 20));
}
/** Keep saved summaries in step with the latest published data; drop places that were unpublished. */
function refreshSavedSummaries() {
  const list = savedList();
  if (!list.length) return;
  write(SAVED_KEY, list.map((x) => (data.byId.get(x.id) ? { ...summary(data.byId.get(x.id)), at: x.at } : { ...x, gone: true })));
}
