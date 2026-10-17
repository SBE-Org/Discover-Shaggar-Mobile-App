// The mobile app: boot, navigation (dock and #hash links), screens, the modal and toasts.
import { useEffect, useRef } from 'react';
import { applyCatalog } from '../shared/catalog.js';
import { Icon, toast } from '../lib/util.js';
import { api } from '../lib/api.js';
import { S, data, ui, actions, emit, useStore, isStaff, loadPublic, loadEditorData, loadCache, closeModal } from '../lib/store.js';
import { t } from '../lib/i18n.js';
import { applyBrand } from '../lib/brand.js';
import { MapScreen } from './MapScreen.jsx';
import { Home, Saved, More, openPage } from './home.jsx';
import { Areas, Discover, Plan } from './areas.jsx';
import { Trips, openTrip } from './trips.jsx';
import { Staff } from './staff.jsx';
import { openProfile } from './places.jsx';
import './editor.jsx';
import * as M from './map.js';

const ALL_VIEWS = ['home', 'map', 'areas', 'trips', 'saved', 'more', 'admin', 'discover', 'plan'];
const PAGES = { home: Home, areas: Areas, sub: Areas, trips: Trips, saved: Saved, more: More, admin: Staff, discover: Discover, plan: Plan };
const HOST = { home: 's-home', areas: 's-areas', sub: 's-areas', trips: 's-trips', saved: 's-saved', more: 's-more', admin: 's-admin', discover: 's-discover', plan: 's-plan' };
const dockViews = () => [['home', 'nav.home', 'home'], ['map', 'nav.map', 'map'], ['areas', 'nav.areas', 'grid'], ['trips', 'nav.trips', 'calendar'],
  isStaff() ? ['admin', 'nav.admin', 'shield'] : ['saved', 'nav.saved', 'bookmark'], ['more', 'nav.more', 'more']];
const dockOf = (v) => ({ sub: 'areas', discover: 'home', plan: 'home', saved: isStaff() ? 'more' : 'saved' }[v] || v);

/* ---------- navigation ---------- */
function setView(v, subId) {
  if (S.pick && v !== 'map') actions.pickCancel();
  if (v === 'bureau') v = 'admin';
  if (!ALL_VIEWS.includes(v) && v !== 'sub') v = 'home';
  const changed = S.view !== v || (v === 'sub' && S.subView !== subId);
  S.view = v;
  if (v === 'sub') S.subView = subId;
  try { const h = v === 'sub' ? 'area-' + subId : v; if (location.hash.slice(1) !== h) history.replaceState(null, '', '#' + h); } catch { /* ignore */ }
  if (changed) S.scrollTop = true;
  emit();
}
actions.setView = setView;
actions.render = emit;

function routeHash(hash) {
  const h = typeof hash === 'string' ? hash : location.hash.slice(1);
  if (/^area-\d+$/.test(h)) return setView('sub', +h.slice(5));
  if (h.startsWith('place-')) { if (S.view === 'map' && !S.sel) setView('home'); return openProfile(h.slice(6)); }
  if (h.startsWith('trip-')) { if (S.view !== 'trips') setView('trips'); return openTrip(h.slice(5)); }
  if (h.startsWith('page-')) { if (S.view !== 'more') setView('more'); return openPage(h.slice(5)); }
  if (ALL_VIEWS.includes(h) || h === 'bureau') { if (h !== S.view) setView(h); }
}

function Dock() {
  const cur = dockOf(S.view);
  const n = isStaff() ? (data.stats?.my?.to_verify || 0) + (data.stats?.my?.to_publish || 0) + (data.stats?.my?.returned || 0) + data.suggestions.length + data.reports.length + (data.stats?.contributions || 0) : 0;
  return (
    <nav className="dock glass" id="dock" aria-label="Main">{dockViews().map(([v, l, i]) => (
      <button key={v} aria-current={cur === v ? 'page' : undefined} onClick={() => { closeModal(); setView(v); }}><Icon n={i} /><span>{t(l)}</span>{v === 'admin' && n ? <span className="badge">{n > 99 ? '99+' : n}</span> : null}</button>
    ))}</nav>
  );
}

function Modal() {
  const ref = useRef(null);
  const open = !!ui.modal;
  // Reset scroll and focus the first field whenever a new modal opens.
  useEffect(() => {
    if (!open || !ref.current) return;
    const mb = ref.current.querySelector('.mbody'); if (mb) mb.scrollTop = 0;
    const placeId = ui.modal?.placeId;
    const tm = setTimeout(() => { const f = ref.current?.querySelector('input:not(.vh),select,textarea') || ref.current?.querySelector('.iconbtn'); if (f && !placeId) f.focus({ preventScroll: true }); }, 50);
    return () => clearTimeout(tm);
  }, [ui.modalKey]);
  return (
    <div className="modal" id="ov" hidden={!open} onClick={(e) => { if (e.target.id === 'ov') { if (S.draft) actions.closeEditor(); else closeModal(); } }}>
      <div className="msheet glass" role="dialog" aria-modal="true" aria-labelledby="ovTitle" id="ovBody" ref={ref}>
        {open ? <ModalContent key={ui.modalKey} render={ui.modal.render} /> : null}
      </div>
    </div>
  );
}
const ModalContent = ({ render }) => render();

function Page({ view }) {
  const Comp = PAGES[view];
  const ref = useRef(null);
  useEffect(() => { if (S.scrollTop && ref.current) { ref.current.scrollTop = 0; S.scrollTop = false; } });
  return <div className="pg" id={'pg-' + (view === 'sub' ? 'areas' : view)} ref={ref}><Comp /></div>;
}

export function App() {
  useStore();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (ui.modal) { if (S.draft) actions.closeEditor(); else closeModal(); }
      else if (S.pick) actions.pickCancel();
      else if (S.sel) { S.sel = null; emit(); }
    };
    const onHash = () => routeHash();
    const onOnline = () => loadPublic();
    const onOffline = () => { S.offline = true; emit(); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    boot();
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHash); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  const host = HOST[S.view];
  return (
    <div className="app" id="app">
      <main className="screens">
        <MapScreen hidden={S.view !== 'map'} />
        {Object.entries({ home: 's-home', areas: 's-areas', trips: 's-trips', saved: 's-saved', more: 's-more', admin: 's-admin', discover: 's-discover', plan: 's-plan' }).map(([v, id]) => (
          <section key={id} className="screen page" id={id} hidden={host !== id}>{host === id ? <Page view={S.view} /> : null}</section>
        ))}
      </main>
      <Dock />
      <Modal />
      <div key={ui.toastKey} className={'toast ' + (ui.toast?.kind || '')} id="toast" role="status" hidden={!ui.toast}>{ui.toast?.msg}</div>
      <div className="offline" id="offline" hidden={!S.offline}>Offline · showing saved data</div>
    </div>
  );
}

/* ---------- boot ---------- */
let booted = false;
async function boot() {
  if (booted) return; booted = true;
  try { const c = JSON.parse(localStorage.getItem('sdc-brand') || 'null'); if (c) applyBrand(c); } catch { /* none */ }
  const cached = loadCache();
  try {
    const cfg = await api.config(); S.config = cfg; S.me = cfg.user;
    applyBrand(cfg.settings || {});
    try { localStorage.setItem('sdc-brand', JSON.stringify(cfg.settings || {})); } catch { /* ignore */ }
    if (cfg.catalog) applyCatalog(cfg.catalog);
    S.tiles = cfg.tiles;
  } catch {
    S.tiles = { dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', darkAttribution: '&copy; OpenStreetMap contributors &copy; CARTO', satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', satelliteAttribution: 'Imagery &copy; Esri', labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png' };
    S.offline = true;
  }
  if (cached) S.loading = false;
  const h = location.hash.slice(1);
  setView(ALL_VIEWS.includes(h) || h === 'bureau' ? h : /^area-\d+$/.test(h) ? 'areas' : 'home');
  if (/^(area|place|trip|page)-/.test(h)) routeHash(h);
  await loadPublic().catch((e) => toast(e.message, 'bad'));
  if (isStaff()) loadEditorData().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
export { M };
