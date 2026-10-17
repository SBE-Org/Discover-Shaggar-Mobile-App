// Original vector illustrations in the Shaggar palette (red, black, white), used wherever a real photo
// is not available yet: place heroes, cards, the home banner and area cards. Each scene is drawn from the
// category, with small variations seeded by the record id so neighbouring cards do not look identical.
import { SECTORS } from '../shared/catalog.js';

let RED = '#C8102E';
const BLACK = '#141212', CREAM = '#F5EFE9', SAND = '#EADFD5';
/** Follow the brand colour chosen in Settings → Branding. */
export const setArtBrand = (hex) => { if (/^#[0-9a-f]{6}$/i.test(hex || '')) RED = hex; };

function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed || 'x')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}
const tree = (x, y, s, c = BLACK) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-1.6" y="-4" width="3.2" height="16" fill="${c}"/><path d="M0-34C9-30 13-20 11-12 9-4 4-2 0-2s-9-2-11-10c-2-8 2-18 11-22Z" fill="${c}"/></g>`;
const acacia = (x, y, s, c = BLACK) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-1 0h2l1-18 9-6-9 3-2-6-2 6-9-3 9 6Z" fill="${c}"/><ellipse cx="0" cy="-26" rx="22" ry="6" fill="${c}"/></g>`;
const ridge = (pts, fill) => `<path d="M0 ${pts[0]} ${pts.map((y, i) => `L${(i * 400) / (pts.length - 1)} ${y}`).join(' ')} L400 250 L0 250Z" fill="${fill}"/>`;
const band = (y) => `<g transform="translate(0 ${y})"><rect width="400" height="8" fill="${BLACK}"/>${Array.from({ length: 29 }, (_, i) => `<path d="M${i * 14} 4l7-4 7 4-7 4Z" fill="${RED}"/>`).join('')}</g>`;

const SCENES = {
  tourism(r, c) {
    const y = 120 + r() * 20;
    return `<rect width="400" height="250" fill="${CREAM}"/><circle cx="${280 + r() * 60}" cy="${62 + r() * 18}" r="30" fill="${RED}"/>
      ${ridge([y + 10, y - 40, y - 10, y - 70, y - 30, y - 55, y], '#D8CBBE')}
      ${ridge([y + 50, y + 10, y + 30, y - 5, y + 25, y + 5, y + 40], c)}
      ${ridge([y + 80, y + 60, y + 72, y + 52, y + 70, y + 58, y + 76], BLACK)}
      ${Array.from({ length: 9 }, (_, i) => tree(20 + i * 45 + r() * 14, y + 70 - r() * 10, 0.9 + r() * 0.6)).join('')}
      ${acacia(330, y + 58, 1.2)}`;
  },
  government(r, c) {
    return `<rect width="400" height="250" fill="${CREAM}"/><rect y="200" width="400" height="50" fill="${SAND}"/>
      <path d="M120 112 200 66l80 46Z" fill="${BLACK}"/><rect x="128" y="112" width="144" height="10" fill="${BLACK}"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${138 + i * 26}" y="126" width="12" height="66" fill="#fff" stroke="${BLACK}" stroke-width="3"/>`).join('')}
      <rect x="118" y="192" width="164" height="12" fill="${BLACK}"/><rect x="198" y="30" width="3" height="40" fill="${BLACK}"/>
      <rect x="201" y="30" width="34" height="8" fill="#078930"/><rect x="201" y="38" width="34" height="8" fill="#FCDD09"/><rect x="201" y="46" width="34" height="8" fill="#DA121A"/>
      ${tree(70, 196, 1.3)}${tree(330, 196, 1.3)}<circle cx="200" cy="92" r="9" fill="${c}"/>`;
  },
  finance(r, c) {
    return `<rect width="400" height="250" fill="${CREAM}"/><rect y="205" width="400" height="45" fill="${SAND}"/>
      <rect x="110" y="80" width="180" height="125" rx="6" fill="#fff" stroke="${BLACK}" stroke-width="4"/>
      ${[0, 1, 2].map((row) => [0, 1, 2, 3].map((col) => `<rect x="${126 + col * 40}" y="${96 + row * 28}" width="26" height="16" fill="${row === 0 && col === 1 ? RED : BLACK}" opacity="${row === 0 && col === 1 ? 1 : 0.85}"/>`).join('')).join('')}
      <rect x="182" y="176" width="36" height="29" fill="${BLACK}"/><circle cx="310" cy="70" r="28" fill="${c}"/><text x="310" y="80" font-family="Archivo,sans-serif" font-weight="800" font-size="28" fill="#fff" text-anchor="middle">ብር</text>
      <circle cx="80" cy="160" r="22" fill="${RED}"/><circle cx="80" cy="160" r="14" fill="none" stroke="#fff" stroke-width="3"/>`;
  },
  education(r, c) {
    return `<rect width="400" height="250" fill="${CREAM}"/><rect y="200" width="400" height="50" fill="${SAND}"/>
      <path d="M110 120 200 76l90 44Z" fill="${RED}"/><rect x="120" y="120" width="160" height="80" fill="#fff" stroke="${BLACK}" stroke-width="4"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${134 + i * 36}" y="136" width="22" height="22" fill="${BLACK}"/>`).join('')}<rect x="186" y="168" width="28" height="32" fill="${BLACK}"/>
      <g transform="translate(300 60)"><path d="M-30 0 0-14 30 0 0 14Z" fill="${BLACK}"/><path d="M-18 6v14c0 6 36 6 36 0V6" fill="none" stroke="${BLACK}" stroke-width="5"/><path d="M28 2v18" stroke="${c}" stroke-width="4"/></g>
      ${tree(60, 196, 1.2)}${tree(350, 196, 1)}`;
  },
  health(r, c) {
    return `<rect width="400" height="250" fill="${CREAM}"/><rect y="200" width="400" height="50" fill="${SAND}"/>
      <rect x="100" y="90" width="200" height="110" rx="8" fill="#fff" stroke="${BLACK}" stroke-width="4"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${114 + i * 36}" y="150" width="24" height="20" fill="${BLACK}" opacity=".85"/>`).join('')}
      <rect x="170" y="42" width="60" height="60" rx="14" fill="${RED}"/><path d="M200 54v36M182 72h36" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
      <rect x="184" y="174" width="32" height="26" fill="${c}"/>${tree(56, 196, 1.2)}${tree(344, 196, 1.2)}`;
  },
  transport(r, c) {
    return `<rect width="400" height="250" fill="${CREAM}"/>${ridge([150, 120, 140, 110, 135, 120, 150], SAND)}<rect y="186" width="400" height="64" fill="${BLACK}"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${i * 64 + 10}" y="214" width="34" height="5" fill="#fff"/>`).join('')}
      <g transform="translate(${110 + r() * 60} 120)"><rect width="160" height="66" rx="14" fill="${RED}"/><rect x="10" y="10" width="140" height="24" rx="5" fill="#fff"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${16 + i * 34}" y="14" width="26" height="16" fill="${c}" opacity=".85"/>`).join('')}<rect y="44" width="160" height="6" fill="#fff" opacity=".9"/>
      <circle cx="34" cy="68" r="12" fill="${BLACK}" stroke="#fff" stroke-width="4"/><circle cx="126" cy="68" r="12" fill="${BLACK}" stroke="#fff" stroke-width="4"/></g>`;
  },
  business(r, c) {
    return `<rect width="400" height="250" fill="${CREAM}"/><rect y="200" width="400" height="50" fill="${SAND}"/>
      ${[0, 1, 2].map((i) => `<g transform="translate(${50 + i * 110} 96)"><path d="M0 24 10 0h80l10 24Z" fill="${i === 1 ? BLACK : RED}"/>
        ${[0, 1, 2, 3, 4].map((k) => `<path d="M${k * 20} 24a10 10 0 0 0 20 0" fill="${k % 2 ? '#fff' : i === 1 ? RED : BLACK}"/>`).join('')}
        <rect x="6" y="34" width="88" height="70" fill="#fff" stroke="${BLACK}" stroke-width="3"/>
        ${[0, 1, 2].map((k) => `<circle cx="${24 + k * 26}" cy="${84 - (k % 2) * 6}" r="9" fill="${[c, '#D97706', '#0E7C45'][k]}"/>`).join('')}</g>`).join('')}`;
  },
};

// Food and drink: a jebena coffee pot, cups and a mesob basket.
SCENES.food = (r, c) => `<rect width="400" height="250" fill="${CREAM}"/><rect y="176" width="400" height="74" fill="${BLACK}"/>
  ${Array.from({ length: 10 }, (_, i) => `<path d="M${i * 44} 176h22l-11 14Z" fill="${RED}"/>`).join('')}
  <g transform="translate(120 70)"><path d="M30 0c-6 0-8 10-8 18 0 10-22 22-22 52 0 24 18 36 40 36s40-12 40-36c0-30-22-42-22-52 0-8-2-18-8-18Z" fill="${BLACK}"/>
  <path d="M58 52c18-6 26 4 22 18" fill="none" stroke="${BLACK}" stroke-width="6"/><path d="M8 70c10 8 54 8 64 0" stroke="${RED}" stroke-width="5" fill="none"/></g>
  ${[0, 1, 2].map((i) => `<g transform="translate(${230 + i * 34} 150)"><path d="M0 0h22l-3 18H3Z" fill="#fff" stroke="${BLACK}" stroke-width="3"/></g>`).join('')}
  <g transform="translate(310 60)"><path d="M-36 40h72l-10 50h-52Z" fill="${RED}"/><path d="M-36 40c0-22 72-22 72 0" fill="${c}"/><path d="M-30 58h60M-26 74h52" stroke="${BLACK}" stroke-width="3"/></g>
  <path d="M150 54c-6-10 6-14 0-24M170 54c-6-10 6-14 0-24" stroke="#A0968F" stroke-width="3" fill="none" stroke-linecap="round"/>`;
SCENES.hotel = (r, c) => `<rect width="400" height="250" fill="${CREAM}"/><rect y="204" width="400" height="46" fill="${SAND}"/>
  <rect x="120" y="50" width="160" height="154" fill="#fff" stroke="${BLACK}" stroke-width="4"/>
  ${[0, 1, 2, 3].map((row) => [0, 1, 2, 3].map((col) => `<rect x="${134 + col * 36}" y="${64 + row * 30}" width="22" height="18" fill="${(row + col * 3 + Math.floor(r() * 3)) % 4 ? BLACK : '#F5D28A'}"/>`).join('')).join('')}
  <rect x="176" y="178" width="48" height="26" fill="${RED}"/><rect x="150" y="32" width="100" height="20" fill="${RED}"/><text x="200" y="47" font-family="Archivo,sans-serif" font-weight="800" font-size="14" fill="#fff" text-anchor="middle">HOTEL</text>
  ${tree(70, 200, 1.4)}${tree(330, 200, 1.2)}`;
const BY_TYPE = { restaurant: 'food', cafe: 'food', hotel: 'hotel', hospital: 'health', hc: 'health', clinic: 'health', pharmacy: 'health', bus: 'transport', taxi: 'transport', market: 'business', mall: 'business', bank: 'finance', atm: 'finance' };

/** Full-bleed illustration for a place or card (pass the type for a more specific scene). */
export function sceneSvg(sector, seed = '', label = '', type = '') {
  const r = rng(seed + sector);
  const c = SECTORS[sector]?.color || '#475569';
  const draw = SCENES[BY_TYPE[type]] || SCENES[sector] || SCENES.tourism;
  return `<svg class="art" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label || 'Illustration'}" xmlns="http://www.w3.org/2000/svg">${draw(r, c)}${band(242)}</svg>`;
}

/** Home banner: Shaggar ridges, eucalyptus forest and the city at dusk. */
export function heroSvg() {
  const r = rng('shaggar-hero');
  const towers = Array.from({ length: 16 }, (_, i) => { const w = 14 + r() * 18, h = 30 + r() * 70; const x = 120 + i * 18; return `<rect x="${x}" y="${300 - h}" width="${w}" height="${h}" fill="#1E1A19"/>`; }).join('');
  const lights = Array.from({ length: 40 }, () => `<rect x="${130 + r() * 280}" y="${220 + r() * 70}" width="2.5" height="3" fill="#F5D28A" opacity="${0.4 + r() * 0.6}"/>`).join('');
  return `<svg viewBox="0 0 400 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Shaggar City at dusk" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A0A0E"/><stop offset=".55" stop-color="${RED}"/><stop offset="1" stop-color="#F08A4B"/></linearGradient></defs>
    <rect width="400" height="360" fill="url(#sky)"/><circle cx="300" cy="190" r="46" fill="#FFD9A8" opacity=".9"/>
    ${ridge([200, 170, 185, 150, 175, 160, 190].map((y) => y + 40), '#5A1018')}
    ${towers}${lights}
    ${ridge([310, 280, 295, 270, 300, 285, 305], BLACK)}
    ${Array.from({ length: 14 }, (_, i) => tree(i * 30 + r() * 10, 300 - r() * 12, 0.9 + r() * 0.8)).join('')}
    <rect y="300" width="400" height="60" fill="${BLACK}"/></svg>`;
}

/** Default logo: a white map pin with a Meskel-flower star on Shaggar red, with a tibeb band. */
export function logoSvg(size = 40) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Logo" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" rx="16" fill="${RED}"/><path d="M0 50h64v6H0z" fill="${BLACK}"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${i * 8} 53l4-3 4 3-4 3Z" fill="#fff"/>`).join('')}
    <path d="M32 9c-9.4 0-17 7.4-17 16.6C15 37.8 32 48 32 48s17-10.2 17-22.4C49 16.4 41.4 9 32 9Z" fill="#fff"/>
    <path d="M32 16l2.6 6.4L41 25l-6.4 2.6L32 34l-2.6-6.4L23 25l6.4-2.6Z" fill="${BLACK}"/><circle cx="32" cy="25" r="2.4" fill="${RED}"/></svg>`;
}
