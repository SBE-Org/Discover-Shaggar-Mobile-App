// Place rows, the place page (in the map sheet or as a modal), opening hours and the place actions.
import { useState } from 'react';
import { SECTORS, STATUS_LABELS, CONDITIONS, FACILITIES, hasMenu, allowsVisitorPhotos, isAttraction, SECTOR_IDS } from '../shared/catalog.js';
import { haversine, formatDistance, formatLatLon, formatHemi } from '../shared/coords.js';
import { Icon, SectorBadge, RawSvg, toast, copyText, fmtDate } from '../lib/util.js';
import { api } from '../lib/api.js';
import { S, data, actions, ui, emit, openModal, isEditor, isSaved, toggleSaved, addRecent, subName } from '../lib/store.js';
import { t, tr, missing, sectorName, typeName } from '../lib/i18n.js';
import { sceneSvg } from '../lib/art.js';
import { MenuBlock } from './contrib.jsx';
import { ModalHead } from './common.jsx';
import * as M from './map.js';

export const placeName = (p) => tr(p, 'name');

/** One row in a list of places. `onClick` defaults to opening the place page. */
export function PlaceRow({ p, onClick, right = null }) {
  return (
    <button className="row" onClick={onClick || (() => actions.openProfile(p.id))}>
      <SectorBadge sector={p.sector} />
      <span className="rt"><b>{placeName(p)}</b><small>{typeName(p.sector, p.type)} · {subName(p.subcity_id)}{p.verified ? ' · ✓' : ''}</small></span>
      {right ? <span className="rd">{right}</span> : <Icon n="chev" />}
    </button>
  );
}

/* ---------- filters for the map list (FR-002) ---------- */
export const NEAR = [
  { k: 'tourism', l: 'Sites', f: (p) => isAttraction(p) },
  { k: 'hotel', l: 'Hotels', f: (p) => p.type === 'hotel' },
  { k: 'food', l: 'Food', f: (p) => p.type === 'restaurant' || p.type === 'cafe' },
  { k: 'bank', l: 'Banks', f: (p) => p.type === 'bank' },
  { k: 'atm', l: 'ATMs', f: (p) => p.type === 'atm' },
  { k: 'hospital', l: 'Hospitals', f: (p) => p.type === 'hospital' || p.type === 'emergency' },
  { k: 'pharmacy', l: 'Pharmacies', f: (p) => p.type === 'pharmacy' },
  { k: 'gov', l: 'Government', f: (p) => p.sector === 'government' && p.type !== 'police' },
  { k: 'police', l: 'Police', f: (p) => p.type === 'police' },
  { k: 'school', l: 'Schools', f: (p) => p.type === 'primary' || p.type === 'high' },
  { k: 'transport', l: 'Transport', f: (p) => p.sector === 'transport' },
];
export const FILTERS = {
  open: ['Open now', (p) => openState(p)?.open], verified: ['Verified', (p) => p.verified],
  wheelchair: ['Wheelchair access', (p) => p.facilities?.includes('wheelchair') || p.facilities?.includes('step_free')], family: ['Family friendly', (p) => p.facilities?.includes('family')],
};
export function filtered() {
  const q = S.q.trim().toLowerCase(), nf = S.nearChip ? NEAR.find((n) => n.k === S.nearChip).f : null;
  let list = data.places.filter((p) => (S.sector === 'all' || p.sector === S.sector) && (S.sub === null || p.subcity_id === S.sub) && (!nf || nf(p)) &&
    S.flt.every((f) => FILTERS[f][1](p)) &&
    (!q || [p.name, p.name_om, p.name_am, p.alt_names, typeName(p.sector, p.type), sectorName(p.sector), SECTORS[p.sector]?.label, p.woreda, p.kebele, subName(p.subcity_id)].join(' ').toLowerCase().includes(q)));
  if (S.near) list = list.map((p) => ({ p, d: haversine(S.near.lat, S.near.lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d).map((x) => Object.assign(x.p, { _d: x.d }));
  else list.sort((a, b) => SECTOR_IDS.indexOf(a.sector) - SECTOR_IDS.indexOf(b.sector) || placeName(a).localeCompare(placeName(b)));
  return list;
}

/* ---------- opening hours in Ethiopia time ---------- */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function openState(p) {
  const h = p.hours_json;
  if (!h) return null;
  const now = new Date(Date.now() + 3 * 3600e3); // Africa/Addis_Ababa, no daylight saving
  const day = DAYS[now.getUTCDay()], hm = now.toISOString().slice(11, 16);
  const ranges = h[day] || [];
  const open = ranges.some(([a, b]) => (a <= b ? hm >= a && hm < b : hm >= a || hm < b));
  return { open, today: ranges.map(([a, b]) => a + '–' + b).join(', ') };
}
function HoursTable({ h }) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], names = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const today = DAYS[new Date(Date.now() + 3 * 3600e3).getUTCDay()];
  return (
    <div className="hours-t">{order.map((d) => [
      <span key={d + 'n'} className={d === today ? 'today' : undefined}>{names[d]}</span>,
      <span key={d + 'v'} className={d === today ? 'today' : undefined}>{(h[d] || []).map(([a, b]) => a + '–' + b).join(', ') || 'Closed'}</span>,
    ])}</div>
  );
}

/* ---------- place page ---------- */
function Hero({ p, photos }) {
  const [i, setI] = useState(0);
  const color = SECTORS[p.sector]?.color || '#9FB3C8';
  if (!photos.length) {
    return (
      <div className="hero nophoto"><RawSvg svg={sceneSvg(p.sector, p.id, 'Illustration: ' + typeName(p.sector, p.type), p.type)} />
        <div className="hcap"><span className="pill" style={{ '--c': color }}>{typeName(p.sector, p.type)}</span>
          {allowsVisitorPhotos(p) ? <button className="pill" onClick={() => actions.visitorPhoto(p.id)}><Icon n="camera" />Add the first photo</button> : null}</div></div>
    );
  }
  const ph = photos[Math.min(i, photos.length - 1)];
  const cap = [ph.caption, ph.credit ? '© ' + ph.credit : ''].filter(Boolean).join(' · ');
  return (
    <div className="hero"><img src={ph.url} alt={ph.alt || (i === 0 ? 'Photo of ' + placeName(p) : '')} loading="lazy" />
      {photos.length > 1 ? <div className="gal">{photos.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={'Photo ' + (k + 1)} aria-current={String(k === i)} />)}</div> : null}
      <div className="hcap"><span className="pill" style={{ '--c': color }}>{typeName(p.sector, p.type)}</span>{cap ? <span className="label pcap">{cap}</span> : null}</div></div>
  );
}

function Nearby({ p, label, fn, onPick }) {
  const a = data.places.filter((x) => x.id !== p.id && fn(x)).map((x) => ({ x, d: haversine(p.lat, p.lon, x.lat, x.lon) })).sort((u, v) => u.d - v.d).slice(0, 3);
  if (!a.length) return null;
  return <div className="nearby"><h4>{label}</h4>{a.map((o) => <button key={o.x.id} className="nbrow" onClick={() => onPick(o.x.id)}><span>{placeName(o.x)}</span><span>{formatDistance(o.d)}</span></button>)}</div>;
}

function SaveButton({ p }) {
  const saved = isSaved(p.id);
  return (
    <button className="btn" aria-pressed={String(saved)} onClick={() => {
      const on = toggleSaved(p);
      toast(on ? 'Saved. Available without a connection.' : 'Removed from saved places');
    }}><Icon n={saved ? 'bookmarked' : 'bookmark'} />{t(saved ? 'act.saved' : 'act.save')}</button>
  );
}

/** The place page. `ctx` is 'sheet' (inside the map sheet) or 'modal'. */
export function PlaceDetail({ p, ctx }) {
  const pick = ctx === 'sheet' ? (id) => selectPlace(id) : (id) => openProfile(id);
  const color = SECTORS[p.sector]?.color || '#9FB3C8';
  const allPhotos = p.photos || (p.cover ? [{ url: p.cover }] : []);
  const photos = allPhotos.filter((x) => x.source !== 'visitor');
  const visitor = allPhotos.filter((x) => x.source === 'visitor');
  if (!photos.length && visitor.length) photos.push(visitor.shift());
  const where = [subName(p.subcity_id), p.woreda, p.kebele].filter(Boolean).join(' · ');
  const st = p.status === 'published' && p.active ? null : <span className={'pill st-' + p.status}>{STATUS_LABELS[p.status] || p.status}{p.active ? '' : ' · hidden'}</span>;
  const g = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
  const osm = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`;
  const os = openState(p);
  const spec = [];
  if (S.near) spec.push(['From your point', <span className="mono" style={{ color: 'var(--cyan)' }}>{formatDistance(haversine(S.near.lat, S.near.lon, p.lat, p.lon))}</span>]);
  spec.push([t('p.hours'), <>{os ? <><b className={os.open ? 'ok' : 'bad'}>{t(os.open ? 'p.open' : 'p.closed')}</b>{os.today ? ' · today ' + os.today : ''}<br /></> : null}{p.hours || (os ? '' : t('p.notlisted'))}{p.hours_json ? <details className="hrsd"><summary>Week</summary><HoursTable h={p.hours_json} /></details> : null}</>]);
  spec.push([t('p.phone'), p.phone ? <a href={'tel:' + p.phone.replace(/\s/g, '')} className="mono">{p.phone}</a> : t('p.notlisted')]);
  if (p.email) spec.push([t('p.email'), <a href={'mailto:' + p.email}>{p.email}</a>]);
  if (p.website) spec.push([t('p.website'), <a href={p.website} target="_blank" rel="noopener">{p.website.replace(/^https?:\/\//, '')}</a>]);
  if (p.fee) spec.push(['Entrance', p.fee]);
  if (p.best_time) spec.push(['Best time', p.best_time]);
  if (p.parking) spec.push(['Parking', p.parking]);
  const desc = tr(p, 'description');
  const showStale = p.stale && S.config?.settings?.['public.show_stale_warning'] !== false;
  return (
    <article className="detail">
      <Hero key={p.id} p={p} photos={photos} />
      <div className="dtitle"><SectorBadge sector={p.sector} /><div><h2>{placeName(p)}</h2><p>{where}</p></div></div>
      <div className="badges"><span className="pill" style={{ '--c': color }}>{sectorName(p.sector)}</span>{p.verified ? <span className="pill st-ok">{t('p.verified')}</span> : <span className="pill st-unv">{t('p.unverified')}</span>}{st}</div>
      {p.condition && p.condition !== 'open' ? <div className="notice" role="status"><b>{CONDITIONS[p.condition]}.</b> Check before you travel.</div> : null}
      {showStale ? <div className="notice">{t('p.stale')}</div> : null}
      <div className="actions">
        <a className="btn primary" href={dir} target="_blank" rel="noopener"><Icon n="ext" />{t('act.directions')}</a>
        <SaveButton p={p} />
        <button className="btn" onClick={() => actions.sharePlace(p.id)}><Icon n="share" />{t('act.share')}</button>
        <button className="btn" onClick={() => actions.nearHere(p.id)}><Icon n="target" />{t('act.near')}</button>
        {ctx !== 'sheet' ? <button className="btn" onClick={() => actions.showOnMap(p.id)}><Icon n="map" />{t('act.onmap')}</button> : null}
        {isEditor()
          ? <button className="btn" onClick={() => actions.editPlace(p.id)}><Icon n="edit" />{t('act.edit')}</button>
          : <button className="btn" onClick={() => actions.suggestFix(p.id)}><Icon n="edit" />{t('act.fix')}</button>}
      </div>
      {desc ? <><p className="ddesc">{desc}</p>{missing(p, 'description') ? <p className="help">{t('p.trmissing')}</p> : null}</> : null}
      <div className="spec">
        <div className="wide"><span className="label">GPS coordinates{p.accuracy_m ? ' · ±' + Math.round(p.accuracy_m) + ' m' : ''}{p.coord_source ? ' · ' + p.coord_source : ''}</span>
          <div className="v mono">{formatHemi(p.lat, p.lon)}</div>
          <div className="gps-tools"><button className="btn sm" onClick={() => copyText(formatLatLon(p.lat, p.lon))}><Icon n="copy" />Copy</button><a className="btn sm" href={g} target="_blank" rel="noopener">Google Maps</a><a className="btn sm" href={osm} target="_blank" rel="noopener">OpenStreetMap</a></div></div>
        {spec.map(([k, v], i) => <div key={i}><span className="label">{k}</span><div className="v">{v}</div></div>)}
      </div>
      {p.facilities?.length ? <div><h4 className="sech" style={{ margin: '0 0 8px' }}>{t('p.facilities')}</h4><div className="facs">{p.facilities.map((f) => <span key={f}><Icon n="check" />{FACILITIES[f] || f}</span>)}</div></div> : null}
      {p.accessibility ? <div><h4 className="sech" style={{ margin: '0 0 6px' }}>{t('p.access')}</h4><p className="ddesc">{p.accessibility}</p></div> : null}
      {p.visitor_tips ? <div><h4 className="sech" style={{ margin: '0 0 6px' }}>{t('p.tips')}</h4><p className="ddesc">{p.visitor_tips}</p></div> : null}
      {p.safety ? <div><h4 className="sech" style={{ margin: '0 0 6px' }}>{t('p.safety')}</h4><p className="ddesc">{p.safety}</p></div> : null}
      {hasMenu(p) || p.menu?.length ? <MenuBlock p={p} /> : null}
      {allowsVisitorPhotos(p) ? (
        <div><h4 className="sech" style={{ margin: '0 0 8px' }}>Visitor photos</h4>
          {visitor.length
            ? <div className="vgal">{visitor.slice(0, 9).map((v, i) => <button key={v.id || i} onClick={() => actions.visitorGallery(p.id, i)} aria-label={'Photo by ' + (v.credit || '')}><img src={v.url} alt={v.caption || v.alt || ''} loading="lazy" /><span>{v.credit || 'Visitor'}</span></button>)}</div>
            : <p className="help">Been here? Share a photo. The Bureau checks every photo before it appears.</p>}
          <button className="btn block" style={{ marginTop: 8 }} onClick={() => actions.visitorPhoto(p.id)}><Icon n="camera" />Share your photo</button></div>
      ) : null}
      {p.sector === 'tourism'
        ? <><Nearby p={p} label="Nearby hotels" fn={(x) => x.type === 'hotel'} onPick={pick} /><Nearby p={p} label="Nearby food" fn={(x) => x.type === 'restaurant' || x.type === 'cafe'} onPick={pick} /><Nearby p={p} label="Nearby banks and ATMs" fn={(x) => x.type === 'bank' || x.type === 'atm'} onPick={pick} /></>
        : <Nearby p={p} label="Close by" fn={() => true} onPick={pick} />}
      <p className="help prov">{p.last_reviewed_at || p.verified_at ? `${t('p.lastver')}: ${fmtDate(p.last_reviewed_at || p.verified_at)}` : ''}{p.source && p.source !== 'Public suggestion' ? ` · Source: ${p.source}` : ''}{p.owner_department ? ` · ${p.owner_department}` : ''}</p>
      <button className="btn block" onClick={() => actions.reportPlace(p.id)}><Icon n="flag" />{t('act.report')}</button>
      <p className="help">Opening hours and contacts are checked by the Bureau but can change. Routes and travel times come from your map app.</p>
    </article>
  );
}

/** Load full details (all photos, menu) for a place and re-render wherever it is shown. */
export async function hydrate(id) {
  try {
    const full = await api.place(id);
    const cur = data.byId.get(id);
    if (cur) Object.assign(cur, full); else data.byId.set(id, full);
    addRecent(data.byId.get(id));
    emit();
  } catch { /* keep the summary */ }
}

function PlaceModal({ id }) {
  const p = data.byId.get(id);
  if (!p) return null;
  return <><ModalHead title={placeName(p)} hiddenTitle /><div className="mbody"><PlaceDetail p={p} ctx="modal" /></div></>;
}
export async function openProfile(id) {
  let p = data.byId.get(id);
  if (!p) { try { p = await api.place(id); data.byId.set(id, p); } catch { toast('That place is not available.', 'bad'); return; } }
  openModal(() => <PlaceModal id={id} />, { placeId: id });
  try { history.replaceState(null, '', '#place-' + id); } catch { /* ignore */ }
  hydrate(id);
}

export function setSheet(st) { S.sheet = st; emit(); }

export function selectPlace(id) {
  const p = data.byId.get(id); if (!p) return;
  S.sel = id;
  if (S.sheet === 'peek') S.sheet = 'half';
  emit();
  M.focus(p.lat, p.lon, Math.max(M.zoom(), 16));
  hydrate(id);
}

Object.assign(actions, {
  openProfile,
  selectPlace,
  setSheet,
  nearHere: (id) => {
    const p = data.byId.get(id); if (!p) return;
    S.near = { lat: p.lat, lon: p.lon }; S.nearMode = false; S.sel = null; S.sector = 'all'; S.nearChip = null;
    actions.closeModal(); S.sheet = 'half'; if (S.view !== 'map') actions.setView('map'); else emit();
    setTimeout(() => M.focus(p.lat, p.lon, 15), 40); toast('Sorted by distance from ' + placeName(p));
  },
  showOnMap: (id) => {
    actions.closeModal(); S.sector = 'all'; S.nearChip = null; S.q = ''; S.sub = null; S.route = null;
    if (S.sheet === 'peek') S.sheet = 'half';
    actions.setView('map');
    setTimeout(() => selectPlace(id), 40);
  },
  editPlace: async (id) => {
    let p = data.byId.get(id); if (!p) return;
    try { p = Object.assign(p, await api.place(p.id)); } catch { /* use summary */ }
    actions.openEditor(actions.draftFromPlace(p, 'edit'));
  },
  suggestFix: (id) => { const p = data.byId.get(id); if (p) actions.openEditor(actions.draftFromPlace(p, 'fix')); },
  sharePlace: async (id) => {
    const p = data.byId.get(id); if (!p) return;
    const url = location.origin + '/#place-' + p.id;
    try { if (navigator.share) { await navigator.share({ title: placeName(p), text: placeName(p) + ' · Discover Shaggar', url }); return; } } catch { return; }
    copyText(url);
  },
});
export { ui };
