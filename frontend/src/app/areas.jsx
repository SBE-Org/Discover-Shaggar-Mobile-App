// Areas, Discover and Plan screens.
import { SECTORS, SECTOR_IDS, INTEREST_GROUPS, INTEREST_LABELS, isAttraction } from '../shared/catalog.js';
import { haversine, formatDistance, formatLatLon } from '../shared/coords.js';
import { Icon, SectorBadge, SectorIcon, RawSvg } from '../lib/util.js';
import { S, data, actions, emit, subName, subPhone, subCentre, subcityCode, SUBCITY_IDS } from '../lib/store.js';
import { t, tr, sectorName, typeName } from '../lib/i18n.js';
import { sceneSvg } from '../lib/art.js';
import { TripCard } from './trips.jsx';
import { PageHead, Empty } from './common.jsx';
import * as M from './map.js';

const nm = (p) => tr(p, 'name');

/* ---------- Areas ---------- */
function counts() {
  const c = Object.fromEntries(SUBCITY_IDS.map((id) => [id, { total: 0, sites: 0, by: Object.fromEntries(SECTOR_IDS.map((k) => [k, 0])) }]));
  data.places.forEach((p) => { const x = c[p.subcity_id]; if (!x || x.by[p.sector] === undefined) return; x.total++; x.by[p.sector]++; if (isAttraction(p)) x.sites++; });
  return c;
}
const Stack = ({ x }) => (
  <div className="stack" role="img" aria-label="Places by sector">{SECTOR_IDS.map((k) => (x.by[k] ? <i key={k} style={{ '--c': SECTORS[k].color, width: (x.by[k] / Math.max(1, x.total) * 100).toFixed(1) + '%' }} /> : null))}</div>
);

export function Areas() {
  const c = counts();
  if (S.view === 'sub') return <Area c={c} />;
  return (
    <div><PageHead title={<>City <em>areas</em></>} sub="Twelve sub-cities and the Mayor's Office. Tap one to see what is there." />
      <div className="agrid">{SUBCITY_IDS.map((id) => (
        <button key={id} className="acard" onClick={() => actions.areaOpen(id)}><RawSvg svg={sceneSvg(['tourism', 'government', 'business', 'transport'][id % 4], 'area' + id)} /><span className="ring" />
          <span className="code">{subcityCode(id)}</span><span className="an">{subName(id)}</span>
          <span className="am">{c[id].total} place{c[id].total === 1 ? '' : 's'} · {c[id].sites} site{c[id].sites === 1 ? '' : 's'}</span><Stack x={c[id]} /></button>
      ))}</div></div>
  );
}

function Area({ c }) {
  const id = S.subView;
  if (!(id >= 0 && id <= 12)) { setTimeout(() => actions.setView('areas')); return null; }
  const x = c[id], centre = subCentre(id);
  const items = data.places.filter((p) => p.subcity_id === id && (S.subTab === 'all' || p.sector === S.subTab))
    .sort((a, b) => SECTOR_IDS.indexOf(a.sector) - SECTOR_IDS.indexOf(b.sector) || a.name.localeCompare(b.name));
  const gov = data.places.filter((p) => p.subcity_id === id && p.sector === 'government').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  const trips = data.trips.filter((tp) => tp.subcity_id === id && !tp.past);
  const summary = tr(data.subcities.get(id), 'summary');
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}><button className="iconbtn" onClick={() => actions.setView('areas')} aria-label="All areas"><Icon n="back" /></button><button className="btn primary sm" onClick={() => actions.areaMap(id)}><Icon n="map" />See on map</button></div>
      <PageHead title={<><span className="mono muted" style={{ fontSize: 14, display: 'block', marginBottom: 6 }}>{subcityCode(id)}</span>{subName(id)}</>} sub={`${x.total} places · ${x.sites} tourism sites${centre ? ' · centre ' + formatLatLon(centre.lat, centre.lon) : ''}`} />
      {summary ? <p className="ddesc" style={{ margin: '-6px 4px 16px' }}>{summary}</p> : null}
      {trips.length ? <><h3 className="sech">{t('home.upcoming')}</h3><div className="hscroll" style={{ marginBottom: 12 }}>{trips.map((tp) => <TripCard key={tp.id} x={tp} compact />)}</div></> : null}
      <div className="chips" style={{ padding: '0 0 12px' }}>
        <button className="chip" aria-pressed={String(S.subTab === 'all')} onClick={() => { S.subTab = 'all'; emit(); }}>All {x.total}</button>
        {SECTOR_IDS.map((k) => <button key={k} className="chip" style={{ '--c': SECTORS[k].color }} aria-pressed={String(S.subTab === k)} onClick={() => { S.subTab = k; emit(); }}><SectorIcon sector={k} />{sectorName(k)} {x.by[k]}</button>)}
      </div>
      <div className="card list-card">{items.length ? items.map((p) => (
        <button key={p.id} className="row" onClick={() => actions.openProfile(p.id)}><SectorBadge sector={p.sector} /><span className="rt"><b>{nm(p)}</b><small>{typeName(p.sector, p.type)}{p.woreda ? ' · ' + p.woreda : ''}</small></span><Icon n="chev" /></button>
      )) : <div className="empty">No published places here yet.</div>}</div>
      <h3 className="sech">Important contacts</h3>
      <div className="card list-card">{subPhone(id) ? <div className="row"><span className="sbadge" style={{ '--c': 'var(--cyan)' }}><Icon n="phone" /></span><span className="rt"><b>Area main line</b><small className="mono">{subPhone(id)}</small></span></div> : null}
        {gov.length ? gov.map((p) => <button key={p.id} className="row" onClick={() => actions.openProfile(p.id)}><SectorBadge sector={p.sector} /><span className="rt"><b>{nm(p)}</b><small className="mono">{p.phone || 'No phone listed'}</small></span><Icon n="chev" /></button>)
          : (subPhone(id) ? null : <div className="empty">No government offices published yet.</div>)}</div>
    </div>
  );
}

Object.assign(actions, {
  areaOpen: (id) => { S.subTab = 'all'; actions.setView('sub', +id); },
  areaMap: (id) => {
    S.sector = 'all'; S.nearChip = null; S.q = ''; S.route = null; S.sel = null; S.sub = id;
    actions.setView('map');
    const pts = data.places.filter((p) => p.subcity_id === id); const c = subCentre(id); if (c) pts.push({ lat: c.lat, lon: c.lon });
    setTimeout(() => M.fitPoints(pts, 15), 60);
  },
});

/* ---------- Discover ---------- */
const Crumb = () => <button className="crumbm" onClick={() => actions.setView('home')}><Icon n="back" />{t('nav.home')}</button>;
export function Discover() {
  const tabs = [['all', 'All'], ['nature', 'Nature'], ['adventure', 'Adventure'], ['culture', 'Culture & History'], ['events', 'Events']];
  let body;
  if (S.discTab === 'events') {
    const ev = data.trips.filter((tp) => !tp.past);
    body = ev.length ? <div className="tlist">{ev.map((tp) => <TripCard key={tp.id} x={tp} />)}</div> : <div className="card"><Empty icon="calendar" title={t('t.none')} text={t('t.none_sub')} /></div>;
  } else {
    const list = data.places.filter(isAttraction).filter((p) => S.discTab === 'all' || INTEREST_GROUPS[S.discTab].includes(p.type))
      .sort((a, b) => (b.verified - a.verified) || ((b.cover ? 1 : 0) - (a.cover ? 1 : 0)) || a.name.localeCompare(b.name));
    body = list.length ? <div className="dgrid">{list.map((p) => (
      <button key={p.id} className="dcard" onClick={() => actions.openProfile(p.id)}>
        <div className="hero">{p.cover ? <img src={p.cover} alt="" loading="lazy" /> : <RawSvg svg={sceneSvg(p.sector, p.id, '', p.type)} />}
          <div className="hcap"><span className="pill" style={{ '--c': SECTORS.tourism?.color }}>{typeName(p.sector, p.type)}</span>{p.verified ? <span className="pill st-ok">Verified</span> : null}</div></div>
        <div className="db"><h3>{nm(p)}</h3><p className="dm">{subName(p.subcity_id)} · {p.hours || 'Hours not listed'}</p><p className="dm">{p.fee || 'Fee not listed'}</p></div></button>
    ))}</div> : <div className="card"><Empty icon="mountain" title="No tourism sites published yet" text="Forests, ridges, lakes and cultural sites appear here once the Bureau publishes them." /></div>;
  }
  return (
    <div><Crumb /><PageHead title={<><em>Discover</em> Shaggar</>} sub="Forests, highland ridges, trails and living culture on the edge of the capital." />
      <div className="chips" style={{ padding: '0 0 16px' }}>{tabs.map(([k, l]) => <button key={k} className="chip" aria-pressed={String(S.discTab === k)} onClick={() => { S.discTab = k; emit(); }}>{l}</button>)}</div>{body}</div>
  );
}

/* ---------- Plan ---------- */
const SLOTS = [['Morning', '09:00'], ['Lunch', '12:30'], ['Afternoon', '14:30'], ['Evening', '17:30']];
function buildPlan() {
  const att = data.places.filter(isAttraction).sort((a, b) => (b.verified - a.verified) || a.name.localeCompare(b.name));
  const want = S.planInt.length ? att.filter((p) => S.planInt.some((g) => INTEREST_GROUPS[g].includes(p.type))) : att;
  const rest = att.filter((p) => !want.includes(p)), used = new Set();
  const grp = (p) => Object.keys(INTEREST_GROUPS).find((g) => INTEREST_GROUPS[g].includes(p.type));
  const near = (from, arr) => { let b = null; arr.forEach((p) => { if (used.has(p.id)) return; const d = haversine(from.lat, from.lon, p.lat, p.lon); if (!b || d < b.d) b = { p, d }; }); return b; };
  const first = (arr) => arr.find((p) => !used.has(p.id));
  const food = data.places.filter((p) => p.type === 'restaurant' || p.type === 'cafe'), parks = att.filter((p) => p.type === 'park'), hotels = data.places.filter((p) => p.type === 'hotel');
  const days = []; let hotel = null;
  for (let d = 0; d < S.planDays; d++) {
    const stops = [];
    const take = (slot, p, from) => { if (!p) return null; used.add(p.id); stops.push({ slot, p, leg: from ? haversine(from.lat, from.lon, p.lat, p.lon) : null }); return p; };
    const m = take(0, first(want) || first(rest), null);
    if (!m) break;
    if (d === 0) hotel = near(m, hotels);
    const lu = take(1, near(m, food)?.p, m);
    let cand = want.filter((p) => !used.has(p.id) && grp(p) !== grp(m));
    if (!cand.length) cand = want.filter((p) => !used.has(p.id));
    if (!cand.length) cand = rest.filter((p) => !used.has(p.id));
    const af = take(2, near(lu || m, cand)?.p, lu || m);
    const from = af || lu || m;
    take(3, (near(from, parks) || near(from, food))?.p, from);
    days.push(stops);
  }
  return { days, hotel, ids: days.flat().map((s) => s.p.id) };
}
export function Plan() {
  const p = buildPlan();
  return (
    <div><Crumb /><PageHead title={<>Plan a <em>visit</em></>} sub="Choose your days and interests. Each day keeps its stops close together." />
      <div className="card" style={{ display: 'grid', gap: 16 }}>
        <div><span className="label">How many days</span><div className="seg" style={{ margin: '8px 0 0' }} role="group" aria-label="Days">{[1, 2, 3].map((n) => <button key={n} aria-pressed={String(S.planDays === n)} onClick={() => { S.planDays = n; emit(); }}>{n} day{n > 1 ? 's' : ''}</button>)}</div></div>
        <div><span className="label">Interests</span><div className="chips flat" style={{ padding: '8px 0 0', flexWrap: 'wrap' }}>{Object.keys(INTEREST_GROUPS).map((g) => (
          <button key={g} className="chip" aria-pressed={String(S.planInt.includes(g))} onClick={() => { const i = S.planInt.indexOf(g); if (i < 0) S.planInt.push(g); else S.planInt.splice(i, 1); emit(); }}>{INTEREST_LABELS[g]}</button>
        ))}</div><p className="help" style={{ marginTop: 8 }}>Leave all off for a mix.</p></div>
      </div>
      {p.hotel ? <div className="stay"><b>Where to stay.</b> <button className="linkbtn" style={{ padding: 0 }} onClick={() => actions.openProfile(p.hotel.p.id)}>{nm(p.hotel.p)}</button> is the closest hotel to your first stop, about {formatDistance(p.hotel.d)} away.</div> : null}
      {p.days.map((stops, i) => {
        const tot = stops.reduce((a, s) => a + (s.leg || 0), 0);
        return [
          <div key={'h' + i} className="dayh"><h3>Day {i + 1}</h3><span className="mono muted">≈ {formatDistance(tot)} between stops</span></div>,
          <div key={'t' + i} className="tl">{stops.map((s) => (
            <div key={s.p.id} className="stop" style={{ '--c': SECTORS[s.p.sector].color }}><span className="t">{SLOTS[s.slot][1]} · {SLOTS[s.slot][0]}</span><button className="pl" onClick={() => actions.openProfile(s.p.id)}>{nm(s.p)}</button>
              <span className="leg">{typeName(s.p.sector, s.p.type)} · {subName(s.p.subcity_id)}{s.leg != null ? ' · ' + formatDistance(s.leg) + ' from the last stop' : ''}</span></div>
          ))}</div>,
        ];
      })}
      {!p.days.length ? <div className="card"><Empty icon="route" title="No tourism sites to plan with yet" text="Plans are built from published tourism sites, hotels and restaurants with real coordinates." /></div> : null}
      <p className="help" style={{ marginTop: 12 }}>Distances are straight-line between real coordinates. Check road travel time before you go.</p>
      {p.ids.length ? <div className="planfab"><button className="btn primary block" onClick={() => {
        S.route = p.ids.slice(); S.sector = 'all'; S.nearChip = null; S.q = ''; S.sub = null; S.sel = null;
        actions.setView('map');
        setTimeout(() => M.fitPoints(p.ids.map((id) => data.byId.get(id)).filter(Boolean), 15), 60);
      }}><Icon n="route" />Show route on map</button></div> : null}
    </div>
  );
}
