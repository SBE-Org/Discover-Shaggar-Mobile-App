// Input validation, so the API never stores half-formed records.
import { SECTORS, TYPES, isTypeActive, CONDITIONS, FACILITIES, COORD_SOURCES } from '../shared/catalog.js';
import { parseCoords, normalizeBoundary } from '../shared/coords.js';
import { badRequest } from './http.js';

export const str = (v, max) => String(v ?? '').trim().slice(0, max);
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Structured weekly opening hours: { mon: [["08:30","17:00"]], sun: [] } or null (stored as an object). */
export function parseHours(v) {
  if (v === null || v === '' || v === undefined) return null;
  let o = v;
  if (typeof v === 'string') { try { o = JSON.parse(v); } catch { throw new Error('Opening hours are not in the expected format.'); } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Opening hours are not in the expected format.');
  const out = {};
  let any = false;
  for (const d of DAYS) {
    const ranges = Array.isArray(o[d]) ? o[d] : [];
    out[d] = [];
    for (const r of ranges.slice(0, 3)) {
      if (!Array.isArray(r) || !HHMM.test(r[0]) || !HHMM.test(r[1])) throw new Error(`Use HH:MM times for ${d}.`);
      out[d].push([r[0], r[1]]);
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * Validate a place payload. `partial` allows missing fields (for updates).
 * Accepts either lat/lon numbers or a `coords` string (anything parseCoords reads).
 * Status is never taken from here: it changes only through workflow actions.
 */
export function validatePlace(input, { partial = false, allowInactiveType = false } = {}) {
  const errors = {};
  const out = {};
  const has = (k) => input[k] !== undefined;

  if (!partial || has('name')) {
    out.name = str(input.name, 120);
    if (!out.name) errors.name = 'Enter the place name.';
  }
  if (!partial || has('sector') || has('type')) {
    out.sector = str(input.sector, 20);
    if (!SECTORS[out.sector]) errors.sector = 'Choose a valid category group.';
    else {
      out.type = str(input.type, 30);
      if (TYPES[out.sector][out.type] === undefined) errors.type = 'Choose a valid category for this group.';
      else if (!allowInactiveType && !isTypeActive(out.sector, out.type)) errors.type = 'This category is no longer in use. Choose another.';
    }
  }
  if (!partial || has('subcity_id')) {
    const s = Number(input.subcity_id);
    if (input.subcity_id === '' || input.subcity_id === null || !Number.isInteger(s) || s < 0 || s > 12) errors.subcity_id = 'Choose the sub-city.';
    else out.subcity_id = s;
  }
  if (!partial || has('lat') || has('lon') || has('coords')) {
    let p = null;
    if (has('coords') && input.coords !== '') p = parseCoords(input.coords);
    else if (input.lat !== undefined && input.lon !== undefined && input.lat !== '' && input.lon !== '') p = parseCoords(input.lat + ', ' + input.lon);
    if (!p) errors.coords = 'Add the GPS coordinates.';
    else if (p.error) errors.coords = p.error;
    else { out.lat = p.lat; out.lon = p.lon; }
  }
  if (has('accuracy_m')) {
    const a = input.accuracy_m === null || input.accuracy_m === '' ? null : Number(input.accuracy_m);
    out.accuracy_m = a === null || !Number.isFinite(a) || a < 0 ? null : Math.round(a * 10) / 10;
  }
  if (has('coord_source')) out.coord_source = COORD_SOURCES[input.coord_source] ? input.coord_source : 'typed';

  const text = {
    name_om: 120, name_am: 120, alt_names: 300, woreda: 60, kebele: 160, description: 4000, description_om: 4000, description_am: 4000,
    phone: 40, email: 120, hours: 160, website: 200, fee: 120, best_time: 120, parking: 120, accessibility: 600,
    visitor_tips: 1500, safety: 1000, source: 200, owner_department: 120,
  };
  for (const [k, max] of Object.entries(text)) if (!partial || has(k)) out[k] = str(input[k], max);
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = 'https://' + out.website;
  if (out.website) {
    try { new URL(out.website); } catch { errors.website = 'Enter a valid website address.'; }
  }
  if (out.email && !EMAIL.test(out.email)) errors.email = 'Enter a valid email address.';

  if (has('condition')) {
    if (!CONDITIONS[input.condition]) errors.condition = 'Unknown condition.';
    else out.condition = input.condition;
  }
  if (has('facilities')) {
    const f = Array.isArray(input.facilities) ? input.facilities : [];
    out.facilities = [...new Set(f.filter((x) => FACILITIES[x]))];
  }
  if (has('hours_json')) {
    try { out.hours_json = parseHours(input.hours_json); } catch (e) { errors.hours_json = e.message; }
  }
  if (has('review_months')) {
    const m = input.review_months === '' || input.review_months === null ? null : Number(input.review_months);
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 36)) errors.review_months = 'Use 1 to 36 months, or leave empty for the category default.';
    else out.review_months = m;
  }
  if (has('active')) out.active = input.active ? 1 : 0;
  if (has('verified')) out.verified = input.verified ? 1 : 0;
  if (has('featured')) out.featured = input.featured ? 1 : 0;

  if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
  return out;
}

export function validateSubcity(input) {
  const out = {
    name: str(input.name, 80), phone: str(input.phone, 40), official_code: str(input.official_code, 20),
    alt_names: str(input.alt_names, 200), summary: str(input.summary, 2000), summary_om: str(input.summary_om, 2000),
    summary_am: str(input.summary_am, 2000), focal_person: str(input.focal_person, 120), lat: null, lon: null,
  };
  if (!out.name) throw badRequest('Enter the sub-city name.', { name: 'Required' });
  if (input.coords) {
    const p = parseCoords(input.coords);
    if (!p || p.error) throw badRequest(p?.error || 'Invalid centre coordinates.', { coords: p?.error });
    out.lat = p.lat; out.lon = p.lon;
  }
  if (input.boundary !== undefined) {
    if (input.boundary === '' || input.boundary === null) out.boundary = null;
    else {
      const b = normalizeBoundary(input.boundary);
      if (b.error) throw badRequest(b.error, { boundary: b.error });
      out.boundary = b.geometry;
    }
  }
  return out;
}

/** Parse an ISO date-time or "YYYY-MM-DDTHH:MM" (local time in Ethiopia, UTC+3) into an ISO string. */
export function parseDateTime(v, field, errors, { required = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s) { if (required) errors[field] = 'Choose the date and time.'; return null; }
  let d;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) d = new Date(s + ':00+03:00');
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00+03:00');
  else d = new Date(s);
  if (Number.isNaN(d.getTime())) { errors[field] = 'Enter a valid date and time.'; return null; }
  return d.toISOString();
}
