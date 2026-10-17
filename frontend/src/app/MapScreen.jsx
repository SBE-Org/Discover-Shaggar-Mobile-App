// The Map screen: Leaflet map, search and category chips, the list/detail sheet, "near me", and pick mode.
import { useEffect, useRef, useState } from 'react';
import { SECTORS, SECTOR_IDS } from '../shared/catalog.js';
import { formatDistance, formatLatLon } from '../shared/coords.js';
import { Icon, SectorIcon, toast } from '../lib/util.js';
import { S, data, actions, emit, can, subName, subcityCode, SUBCITY_IDS, useStore } from '../lib/store.js';
import { t, sectorName } from '../lib/i18n.js';
import { Logo } from '../lib/brand.js';
import { PlaceRow, PlaceDetail, filtered, NEAR, FILTERS, selectPlace, setSheet } from './places.jsx';
import * as M from './map.js';

function Chips() {
  return (
    <div className="chips" id="secChips" role="group" aria-label="Filter by sector">
      {S.route ? <button className="chip" aria-pressed="true" style={{ '--c': 'var(--cyan)' }} onClick={() => { S.route = null; emit(); }}><Icon n="route" />Route · {S.route.length} stops <Icon n="x" /></button> : null}
      <button className="chip" aria-pressed={String(S.sector === 'all' && !S.nearChip)} onClick={() => { S.sector = 'all'; S.nearChip = null; S.sel = null; emit(); }}>All</button>
      {SECTOR_IDS.map((k) => <button key={k} className="chip" style={{ '--c': SECTORS[k].color }} aria-pressed={String(S.sector === k)} onClick={() => { S.sector = k; S.nearChip = null; S.sel = null; emit(); }}><SectorIcon sector={k} />{sectorName(k)}</button>)}
    </div>
  );
}

function SheetHead({ list }) {
  const sub = S.loading ? 'Loading the city directory…' : S.near ? 'Nearest first · straight-line distance' : (S.sub !== null ? subName(S.sub) : 'Across Shaggar City');
  return (
    <div className="sheet-head" id="sheetHead">
      <div><h2><b>{list.length}</b> {list.length === 1 ? 'place' : 'places'}</h2><p>{sub}</p></div>
      <label className="sel-wrap"><span className="vh">Area</span>
        <select id="subSel" value={S.sub === null ? '' : String(S.sub)} onChange={(e) => {
          S.sub = e.target.value === '' ? null : +e.target.value; S.sel = null; emit();
          if (S.sub === null) M.fitCity();
          else { const pts = data.places.filter((p) => p.subcity_id === S.sub); const c = data.subcities.get(S.sub); if (c?.lat != null) pts.push({ lat: c.lat, lon: c.lon }); M.fitPoints(pts, 15); }
        }}><option value="">All areas</option>{SUBCITY_IDS.map((id) => <option key={id} value={String(id)}>{subcityCode(id)} · {subName(id)}</option>)}</select><Icon n="chevd" /></label>
    </div>
  );
}

function SheetBody({ list, bodyRef }) {
  const sel = S.sel && data.byId.get(S.sel);
  if (sel) {
    return <><button className="backrow" onClick={() => { S.sel = null; emit(); }}><Icon n="back" />Back to results</button><PlaceDetail p={sel} ctx="sheet" /></>;
  }
  const top = S.near
    ? <div className="nearbar"><div className="chips flat" role="group" aria-label="Type">{NEAR.map((n) => <button key={n.k} className="chip" aria-pressed={String(S.nearChip === n.k)} onClick={() => { S.nearChip = S.nearChip === n.k ? null : n.k; S.sector = 'all'; emit(); }}>{n.l}</button>)}</div>
      <button className="linkbtn" onClick={() => { S.near = null; S.nearChip = null; S.nearMode = false; emit(); }}>Clear</button></div>
    : <div className="promo"><div><b>What's closest to me?</b><p>Use your GPS or tap a point, and everything sorts by distance.</p></div><button className="btn primary sm" onClick={actions.nearMe}><Icon n="locate" />{t('home.nearme')}</button></div>;
  let rows;
  if (S.loading) rows = [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />);
  else if (!data.places.length) rows = <div className="empty"><div className="glyph"><Icon n="pin" /></div><b>The map is ready for its first places</b><span>Every place here is added with its real GPS position and checked by the city Tourism Bureau.</span><button className="btn primary" onClick={actions.addPlace}><Icon n="plus" />{can('places.create') ? 'Add the first place' : t('m.suggest')}</button></div>;
  else if (!list.length) rows = <div className="empty"><b>Nothing matches</b><span>Try another category, area or search word.</span>{S.q || S.sector !== 'all' || S.sub !== null || S.flt.length ? <button className="btn sm" onClick={actions.broaden}>Clear filters and search everywhere</button> : null}</div>;
  else rows = <><div className="list">{list.slice(0, 120).map((p) => <PlaceRow key={p.id} p={p} onClick={() => selectPlace(p.id)} right={S.near ? formatDistance(p._d) : null} />)}</div>
    {list.length > 120 ? <p className="help" style={{ padding: '10px 6px' }}>Showing the nearest or first 120. Search or choose an area to narrow down.</p> : null}</>;
  const flt = <div className="chips flat fltrow" role="group" aria-label="Filters">{Object.entries(FILTERS).map(([k, [l]]) => (
    <button key={k} className="chip" aria-pressed={String(S.flt.includes(k))} onClick={() => { const i = S.flt.indexOf(k); if (i < 0) S.flt.push(k); else S.flt.splice(i, 1); S.sel = null; emit(); }}>{k === 'open' ? t('p.open') : k === 'verified' ? t('p.verified') : l}</button>
  ))}</div>;
  return <>{top}{S.loading ? null : flt}{rows}</>;
}

/** The bar shown in pick mode, following the point under the crosshair. */
function PickBar() {
  const [c, setC] = useState(() => M.pickPoint());
  useEffect(() => M.onPickMove(setC), []);
  if (!S.pick) return <div className="pickbar glass" id="pickbar" hidden />;
  return (
    <div className="pickbar glass" id="pickbar">
      <div><span className="label">{S.pick.title || 'Move the map to the exact spot'}</span><div className="pc">{formatLatLon(c.lat, c.lng)}</div>
        <p className="help">Zoom in until you see the building. Switch to satellite with the layers button for the best accuracy.</p></div>
      <div className="row"><button className="btn" onClick={actions.pickCancel}>Cancel</button><button className="btn primary" onClick={actions.pickUse}><Icon n="check" />Use this spot</button></div>
    </div>
  );
}

/** Drag the sheet between peek / half / full on phones; a tap toggles peek and half. */
function useSheetDrag(sheetRef, grabRef, screenRef) {
  useEffect(() => {
    const sheet = sheetRef.current, grab = grabRef.current, screen = screenRef.current;
    let st = null;
    const down = (e) => {
      if (window.innerWidth >= 900 || e.target.closest('select,button,a')) return;
      st = { y: e.clientY, h: sheet.offsetHeight, moved: false };
      sheet.style.transition = 'none';
      try { grab.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const move = (e) => {
      if (!st) return;
      const dy = e.clientY - st.y;
      if (Math.abs(dy) > 5) st.moved = true;
      if (st.moved) sheet.style.height = Math.max(160, Math.min(screen.clientHeight - 70, st.h - dy)) + 'px';
    };
    const end = () => {
      if (!st) return;
      const H = screen.clientHeight, cur = sheet.offsetHeight, moved = st.moved;
      sheet.style.transition = ''; sheet.style.height = '';
      if (!moved) setSheet(S.sheet === 'peek' ? 'half' : 'peek');
      else {
        const peekH = parseFloat(getComputedStyle(screen).getPropertyValue('--sheet-peek')) || 230;
        const opts = { peek: Math.min(peekH, 260), half: H * 0.5, full: H - 70 };
        setSheet(Object.entries(opts).sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0]);
      }
      st = null;
    };
    grab.addEventListener('pointerdown', down);
    grab.addEventListener('pointermove', move);
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
    return () => { grab.removeEventListener('pointerdown', down); grab.removeEventListener('pointermove', move); grab.removeEventListener('pointerup', end); grab.removeEventListener('pointercancel', end); };
  }, []);
}

export function MapScreen({ hidden }) {
  useStore();
  const mapEl = useRef(null), sheetRef = useRef(null), grabRef = useRef(null), screenRef = useRef(null), bodyRef = useRef(null), qRef = useRef(null);
  const [ready, setReady] = useState(false);
  useSheetDrag(sheetRef, grabRef, screenRef);

  // Create the map once the tile settings are known (from /api/config, or the offline fallback).
  useEffect(() => {
    if (ready || !S.tiles || typeof window.L === 'undefined') return;
    M.initMap(mapEl.current, { tiles: S.tiles }, { onMarker: selectPlace });
    M.onReference((lat, lon) => { S.near = { lat, lon }; S.nearMode = false; S.sector = 'all'; S.sel = null; S.sheet = 'half'; emit(); });
    setReady(true);
  });
  useEffect(() => { if (!hidden) setTimeout(M.invalidate, 30); }, [hidden]);
  useEffect(() => { actions.focusSearch = () => setTimeout(() => qRef.current?.focus(), 80); }, []);

  const list = filtered();
  const sel = S.sel && data.byId.get(S.sel);
  // Keep the map in step with the list after every render.
  useEffect(() => {
    if (!ready) return;
    M.renderMarkers(sel && !list.includes(sel) ? [...list, sel] : list);
    M.renderOverlays();
    M.renderRoute(S.route ? S.route.map((x) => (typeof x === 'string' ? data.byId.get(x) : x)).filter(Boolean) : null);
    M.updateReadout();
  });
  // Scroll the sheet to the top when a different place is opened in it.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [S.sel]);

  return (
    <section className="screen screen-map" id="s-map" aria-label="Explore the city" hidden={hidden} data-s={S.sheet} data-pick={S.pick ? '1' : undefined} ref={screenRef}>
      <div id="map" ref={mapEl} aria-label="Map of Shaggar City" />
      <div className="map-vignette" aria-hidden="true" />

      <header className="hud-top" id="hudTop">
        <div className="searchcap">
          <span className="logo" id="capLogo" aria-hidden="true"><Logo size={30} /></span>
          <label className="vh" htmlFor="q">Search places</label>
          <input id="q" ref={qRef} type="search" placeholder={t('home.search')} autoComplete="off" enterKeyHint="search" value={S.q}
            onChange={(e) => { S.q = e.target.value; S.sel = null; if (S.sheet === 'peek') S.sheet = 'half'; emit(); }} />
          <button className="capbtn" id="nearBtn" aria-label="Sort by distance from a point" aria-pressed={String(S.nearMode)} onClick={() => { S.nearMode = !S.nearMode; if (S.nearMode) { S.sel = null; S.sheet = 'peek'; } emit(); }}><Icon n="target" /></button>
        </div>
        <Chips />
      </header>

      <div className="mapctl" id="mapctl">
        <button id="locBtn" className={S.locating ? 'on' : undefined} aria-label="Show my location" onClick={actions.locate}><Icon n="locate" /></button>
        <button id="layerBtn" className={S.layer === 'sat' ? 'on' : undefined} aria-label="Switch map style" onClick={() => { S.layer = M.toggleLayer(); toast(S.layer === 'sat' ? 'Satellite view' : 'Night map'); }}><Icon n="layers" /></button>
        <button aria-label="Show the whole city" onClick={() => { S.sub = null; S.sel = null; emit(); M.fitCity(); }}><Icon n="grid" /></button>
      </div>

      <div className="hud-readout mono" id="readout" aria-live="off" />
      <div className="maphint" id="mapHint" hidden={!S.nearMode || !!S.pick}>Tap the map to set your reference point</div>

      <div className="crosshair" id="cross" hidden={!S.pick} aria-hidden="true">
        <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="15" /><circle cx="40" cy="40" r="2.5" className="dot" /><path d="M40 4v20M40 56v20M4 40h20M56 40h20" /></svg>
      </div>
      <PickBar />

      <button className="addfab" id="addFab" onClick={actions.addPlace}><Icon n="plus" />{can('places.create') ? 'Add place' : t('m.suggest')}</button>

      <section className="sheet glass" id="sheet" data-s={S.sheet} aria-label="Places" ref={sheetRef}>
        <div className="grab" id="sheetGrab" ref={grabRef}><i />{sel ? null : <SheetHead list={list} />}</div>
        <div className="sheet-body" id="sheetBody" ref={bodyRef}><SheetBody list={list} bodyRef={bodyRef} /></div>
      </section>
    </section>
  );
}

/* ---------- map actions ---------- */
Object.assign(actions, {
  broaden: () => { S.q = ''; S.sector = 'all'; S.sub = null; S.nearChip = null; S.flt = []; emit(); M.fitCity(); },
  nearMe: () => {
    if (S.view !== 'map') actions.setView('map');
    toast('Finding your location…');
    let done = false;
    M.locate((lat, lon, acc) => {
      S.locating = true;
      if (!done) { done = true; S.near = { lat, lon }; S.sector = 'all'; S.sel = null; S.sheet = 'half'; emit(); M.focus(lat, lon, 15); toast('Sorted by distance from you (±' + Math.round(acc) + ' m)'); }
    }, (msg) => { toast(msg + ' Tap the map instead.', 'bad'); S.nearMode = true; S.sheet = 'peek'; emit(); });
  },
  locate: () => {
    if (M.isLocating()) { M.stopLocate(); S.locating = false; emit(); return; }
    M.locate((lat, lon, acc, first) => { if (!S.locating) { S.locating = true; emit(); } if (first) M.focus(lat, lon, 16); }, (msg) => { toast(msg, 'bad'); S.locating = false; emit(); });
  },
  addPlace: () => {
    const d = actions.blankDraft();
    if (S.near && S.view === 'map') { d.coords = formatLatLon(S.near.lat, S.near.lon); d.coord_source = 'map'; }
    actions.openEditor(d);
  },
  /* pick mode: move the map under a crosshair to choose an exact point */
  startPick: ({ initial, title, onUse, onCancel }) => {
    actions.closeModal();
    if (S.view !== 'map') actions.setView('map');
    S.pick = { onUse, onCancel, title };
    emit();
    setTimeout(() => {
      M.invalidate();
      if (initial) M.centerPick(initial[0], initial[1], 18);
      else if (M.zoom() < 15) M.centerPick(M.pickPoint().lat, M.pickPoint().lng, 15);
      M.updateReadout();
    }, 40);
  },
  pickUse: () => { const c = M.pickPoint(), cb = S.pick?.onUse; S.pick = null; emit(); cb?.(+c.lat.toFixed(6), +c.lng.toFixed(6)); },
  pickCancel: () => { const cb = S.pick?.onCancel; S.pick = null; emit(); cb?.(); },
});
