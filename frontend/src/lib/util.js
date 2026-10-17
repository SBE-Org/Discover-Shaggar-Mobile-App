// Icons, toasts and formatting used across the app and the admin portal.
import { createElement } from 'react';
import { SECTORS } from '../shared/catalog.js';
import { notify } from './store.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICON_PATHS = {
  map: '<path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z"/><path d="M9 4v13M15 7v13"/>',
  grid: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  shield: '<path d="M12 3 19 6v5.5c0 4.2-3 7.8-7 9.5-4-1.7-7-5.3-7-9.5V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', back: '<path d="M15 5l-7 7 7 7"/>', chev: '<path d="m9 6 6 6-6 6"/>', chevd: '<path d="m6 9 6 6 6-6"/>',
  ext: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  pin: '<path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z"/><circle cx="12" cy="11" r="2.2"/>',
  locate: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  down: '<path d="M12 4v11m-4-4 4 4 4-4M5 19h14"/>', up: '<path d="M12 20V9m-4 4 4-4 4 4M5 5h14"/>',
  mountain: '<path d="M3 19 9 9l4 6 2.5-3.5L21 19H3Z"/>',
  bank: '<path d="M4 10 12 4l8 6M5.5 10v8M9.8 10v8M14.2 10v8M18.5 10v8M3.5 20h17"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9-1.1 0-2-.4-2.6-1.2M12 6.6V8M12 16v1.4"/>',
  cap: '<path d="m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5-9.5-4.5Z"/><path d="M6.5 11.8V16c0 1.2 2.5 2.5 5.5 2.5s5.5-1.3 5.5-2.5v-4.2M21.5 9.5V15"/>',
  cross: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M12 8v8M8 12h8"/>',
  bus: '<rect x="5" y="4" width="14" height="13" rx="3"/><path d="M5 11h14M8 20v-3M16 20v-3"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  phone: '<path d="M6 4h3l1.5 4-2 1.3a10 10 0 0 0 5.2 5.2L15 12.5l4 1.5v3a2 2 0 0 1-2 2A13 13 0 0 1 4 6a2 2 0 0 1 2-2Z"/>',
  ticket: '<rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M9.5 6v12" stroke-dasharray="2 2.4"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/>',
  car: '<path d="M4.5 13V9.5L6 6.5h12l1.5 3V13"/><rect x="3.5" y="12" width="17" height="5.5" rx="1.8"/><path d="M7 20v-2.5M17 20v-2.5"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>', camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>',
  inbox: '<path d="M4 13h4l1.5 2.5h5L16 13h4M4 13l2-7h12l2 7v6H4v-6Z"/>', user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  logout: '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/>', trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4 4 0 0 1 5 0"/><circle cx="12" cy="19" r=".8"/>',
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z"/>',
  bookmark: '<path d="M7 4h10v17l-5-4-5 4V4Z"/>', bookmarked: '<path d="M7 4h10v17l-5-4-5 4V4Z" fill="currentColor"/>',
  more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.7-3.2 3-5 6-5s5.3 1.8 6 5"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M18 14.8c1.6.6 2.6 2.1 3 4.7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2.5 2.5M14.5 8.5 17 11"/>',
  doc: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>', megaphone: '<path d="M4 10v4h3l7 4V6L7 10H4Z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>', cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4M12 8v4l3 2"/>', eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>', alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  db: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  tag: '<path d="M3.5 12V4.5H11l9.5 9.5-7.5 7.5-9.5-9.5Z"/><circle cx="7.5" cy="8.5" r="1.3"/>', star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z"/>',
  upload: '<path d="M12 16V5m-4 4 4-4 4 4M5 19h14"/>', globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.3"/>', smartphone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  arrowup: '<path d="M12 19V5m-6 6 6-6 6 6"/>', arrowdown: '<path d="M12 5v14m-6-6 6 6 6-6"/>',
};

/** An icon as an SVG string (for Leaflet markers, which take HTML). */
export const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[n] || ''}</svg>`;
export const sectorIconHtml = (sector) => ic(SECTORS[sector]?.icon || 'pin');

/** An icon as a React element. */
export function Icon({ n, cls = '' }) {
  return createElement('svg', { className: 'i ' + cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: ICON_PATHS[n] || '' } });
}
export const SectorIcon = ({ sector }) => createElement(Icon, { n: SECTORS[sector]?.icon || 'pin' });
export const SectorBadge = ({ sector }) => createElement('span', { className: 'sbadge', style: { '--c': SECTORS[sector]?.color } }, createElement(SectorIcon, { sector }));

/**
 * Render a generated SVG string (illustrations, the default logo) as a real <svg> element,
 * so CSS that targets the svg keeps working exactly as before.
 */
const ATTR = { class: 'className', 'aria-label': 'aria-label', 'aria-hidden': 'aria-hidden', viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', xmlns: 'xmlns' };
export function RawSvg({ svg }) {
  const m = /^\s*<svg([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(svg || '');
  if (!m) return null;
  const props = {};
  for (const [, k, v] of m[1].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) props[ATTR[k.toLowerCase()] || k] = v;
  props.dangerouslySetInnerHTML = { __html: m[2] };
  return createElement('svg', props);
}

export const toast = (msg, kind = '') => notify(msg, kind);

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied ' + text); }
  catch { toast(text); }
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Resize a photo in the browser before upload so phones on mobile data send ~200 KB, not 5 MB. */
export function shrinkImage(file, max = 1600, type = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      if (type === 'image/png') { resolve(c.toDataURL('image/png')); return; }
      let q = 0.82, d = c.toDataURL('image/jpeg', q);
      while (d.length > 900000 && q > 0.4) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
      resolve(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Save a code (report or registration) on this phone so it can be tracked later. */
export function rememberCode(code, kind) {
  try { const codes = JSON.parse(localStorage.getItem('sdc-codes') || '[]'); codes.unshift({ code, at: Date.now(), kind }); localStorage.setItem('sdc-codes', JSON.stringify(codes.slice(0, 20))); } catch { /* ignore */ }
}
export function savedCodes() {
  try { return JSON.parse(localStorage.getItem('sdc-codes') || '[]'); } catch { return []; }
}
