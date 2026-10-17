// Leaflet map: base layers, glowing sector markers, your location, reference pin, route and pick mode.
/* global L */
// The map is drawn by Leaflet (loaded from unpkg in index.html, as before) and managed here,
// outside React: React renders the container and calls these functions after each render.
import { SECTORS, CITY_BOUNDS, isAttraction } from '../shared/catalog.js';
import { formatHemi } from '../shared/coords.js';
import { sectorIconHtml as sectorIcon, esc } from '../lib/util.js';
import { S, data, subCentre, subName, SUBCITY_IDS } from '../lib/store.js';
import { tr } from '../lib/i18n.js';

let map, baseDark, baseSat, satLabels, markerLayer, overlayLayer, youMarker, youCircle, refMarker, routeLayer;
let layerMode = 'dark';
const markers = new Map();
let onSelect = () => {};

export function initMap(el, cfg, { onMarker }) {
  onSelect = onMarker;
  map = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 9, maxZoom: 20, worldCopyJump: false, preferCanvas: false })
    .fitBounds(CITY_BOUNDS);
  baseDark = L.tileLayer(cfg.tiles.dark, { maxZoom: 20, maxNativeZoom: 19, subdomains: 'abcd', attribution: cfg.tiles.darkAttribution, className: 'basemap', detectRetina: true });
  baseSat = L.tileLayer(cfg.tiles.satellite, { maxZoom: 20, maxNativeZoom: 19, attribution: cfg.tiles.satelliteAttribution });
  satLabels = L.tileLayer(cfg.tiles.labels, { maxZoom: 20, subdomains: 'abcd', pane: 'overlayPane' });
  baseDark.addTo(map);
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
  overlayLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('move zoom', updateReadout);
  map.on('zoomend', () => renderMarkers());
  map.on('click', (e) => { if (S.nearMode) setReference(e.latlng.lat, e.latlng.lng); });
  updateReadout();
  return map;
}
export const getMap = () => map;
export const zoom = () => (map ? map.getZoom() : 13);

export function toggleLayer() {
  if (!map) return layerMode;
  layerMode = layerMode === 'dark' ? 'sat' : 'dark';
  if (layerMode === 'sat') { map.removeLayer(baseDark); baseSat.addTo(map); satLabels.addTo(map); }
  else { map.removeLayer(baseSat); map.removeLayer(satLabels); baseDark.addTo(map); }
  return layerMode;
}

/** People listening to the point under the crosshair (the pick bar). */
const moveListeners = new Set();
export const onPickMove = (fn) => { moveListeners.add(fn); return () => moveListeners.delete(fn); };
export function updateReadout() {
  const el = document.getElementById('readout');
  if (!map) return;
  const c = pickPoint();
  if (el) el.innerHTML = `<b>${formatHemi(c.lat, c.lng).replace('  ', '</b><br><b>')}</b><br>Z${map.getZoom().toFixed(0)}${S.pick ? ' · PICK' : ''}`;
  if (S.pick) moveListeners.forEach((fn) => fn(c));
}

/** The point under the crosshair (slightly above centre so the bottom bar does not hide it). */
export function pickPoint() {
  if (!map) return { lat: 0, lng: 0 };
  const size = map.getSize();
  return map.containerPointToLatLng([size.x / 2, size.y * 0.45]);
}

function markerIcon(p, selected) {
  const small = map.getZoom() < 12 && !selected;
  const cls = 'mk' + (small ? ' small' : '') + (selected ? ' sel' : '') + (p.status !== 'published' || !p.active ? ' unpub' : '');
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="--c:${SECTORS[p.sector]?.color || '#fff'}"><div class="core">${sectorIcon(p.sector)}</div></div>`,
    iconSize: small ? [16, 16] : [34, 42], iconAnchor: small ? [8, 8] : [17, 40],
  });
}

let lastList = [];
export function renderMarkers(list = lastList) {
  if (!map) return;
  lastList = list;
  const keep = new Set();
  for (const p of list) {
    keep.add(p.id);
    const sel = p.id === S.sel;
    const key = p.lat + ',' + p.lon + '|' + sel + '|' + (map.getZoom() < 12) + '|' + p.sector + p.status + p.active;
    let m = markers.get(p.id);
    if (m && m._key === key) continue;
    if (m) markerLayer.removeLayer(m);
    m = L.marker([p.lat, p.lon], { icon: markerIcon(p, sel), title: tr(p, 'name'), keyboard: true, riseOnHover: true, zIndexOffset: sel ? 1000 : (isAttraction(p) ? 100 : 0) });
    m._key = key;
    m.on('click', () => onSelect(p.id));
    m.addTo(markerLayer);
    markers.set(p.id, m);
  }
  for (const [id, m] of markers) if (!keep.has(id)) { markerLayer.removeLayer(m); markers.delete(id); }
}

/** Subcity centre labels and the reference pin. */
export function renderOverlays() {
  if (!map) return;
  overlayLayer.clearLayers();
  for (const id of SUBCITY_IDS) {
    const b = data.subcities.get(id)?.boundary;
    if (b) L.geoJSON(b, { style: { color: '#C8102E', weight: 1.5, opacity: S.sub === id ? 0.9 : 0.35, fill: S.sub === id, fillOpacity: 0.04, dashArray: '4 6' }, interactive: false }).addTo(overlayLayer);
  }
  for (const id of SUBCITY_IDS) {
    const c = subCentre(id);
    if (!c) continue;
    L.marker([c.lat, c.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'sublabel', html: `<span>${esc(subName(id))}</span>`, iconSize: null }) }).addTo(overlayLayer);
  }
  if (refMarker) refMarker.remove();
  refMarker = null;
  if (S.near) {
    refMarker = L.marker([S.near.lat, S.near.lon], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="refdot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(overlayLayer);
    [500, 1000, 2000].forEach((r) => L.circle([S.near.lat, S.near.lon], { radius: r, color: '#141212', weight: 1.2, opacity: .5, dashArray: '4 6', fill: false, interactive: false }).addTo(overlayLayer));
  }
}

export function renderRoute(points) {
  if (!map) return;
  routeLayer.clearLayers();
  if (!points || !points.length) return;
  L.polyline(points.map((p) => [p.lat, p.lon]), { color: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#C8102E', weight: 4, opacity: .9, dashArray: '8 8' }).addTo(routeLayer);
  points.forEach((p, i) => L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="stopmk">${i + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(routeLayer));
}

let refCb = () => {};
export const onReference = (fn) => { refCb = fn; };
function setReference(lat, lon) { refCb(lat, lon); }

/* ---------- camera ---------- */
const sheetPad = () => {
  if (window.innerWidth >= 900) return { paddingTopLeft: [452, 90], paddingBottomRight: [80, 110] };
  const h = map.getSize().y;
  const sheet = S.sheet === 'peek' ? 220 : S.sheet === 'full' ? h * 0.85 : h * 0.5;
  return { paddingTopLeft: [24, 150], paddingBottomRight: [24, Math.min(h - 220, sheet + 20)] };
};
export function fitCity() { if (!map) return; map.flyToBounds(CITY_BOUNDS, { ...sheetPad(), duration: 0.8 }); }
export function fitPoints(points, maxZoom = 16) {
  if (!map) return;
  if (!points.length) return fitCity();
  if (points.length === 1) return focus(points[0].lat, points[0].lon, Math.min(maxZoom, 16));
  map.flyToBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), { ...sheetPad(), maxZoom, duration: 0.8 });
}
/** Centre a point in the visible part of the map (above the sheet). */
export function focus(lat, lon, zoom) {
  if (!map) return;
  const z = zoom ?? Math.max(map.getZoom(), 15);
  const pad = sheetPad();
  const size = map.getSize();
  const visCx = (pad.paddingTopLeft[0] + size.x - pad.paddingBottomRight[0]) / 2;
  const visCy = (pad.paddingTopLeft[1] + size.y - pad.paddingBottomRight[1]) / 2;
  const target = map.project([lat, lon], z).subtract([visCx - size.x / 2, visCy - size.y / 2]);
  map.flyTo(map.unproject(target, z), z, { duration: 0.7 });
}
export function centerPick(lat, lon, zoom = 18) {
  if (!map) return;
  const size = map.getSize();
  const target = map.project([lat, lon], zoom).subtract([0, size.y * 0.45 - size.y / 2]);
  map.setView(map.unproject(target, zoom), zoom, { animate: false });
}
export const invalidate = () => map && map.invalidateSize();

/* ---------- your location ---------- */
let watchId = null;
export function locate(onFix, onError) {
  if (!('geolocation' in navigator)) { onError?.('This browser cannot share location.'); return; }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  let first = true;
  watchId = navigator.geolocation.watchPosition((pos) => {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    showYou(lat, lon, accuracy);
    onFix?.(lat, lon, accuracy, first);
    first = false;
  }, (err) => {
    onError?.(err.code === 1 ? 'Location permission was denied. Allow it in your browser settings.' : 'Could not get your location. Try again outdoors.');
    stopLocate();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
export function stopLocate() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; }
function showYou(lat, lon, acc) {
  if (!map) return;
  if (!youMarker) {
    youMarker = L.marker([lat, lon], { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: '', html: '<div class="youdot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    youCircle = L.circle([lat, lon], { radius: acc, color: '#2563EB', weight: 1, opacity: .5, fillOpacity: .08, interactive: false }).addTo(map);
  } else { youMarker.setLatLng([lat, lon]); youCircle.setLatLng([lat, lon]).setRadius(acc); }
}
export const isLocating = () => watchId !== null;
