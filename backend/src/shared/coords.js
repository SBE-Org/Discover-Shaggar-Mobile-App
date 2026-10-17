// Coordinate helpers shared by the browser and the server.
import { REGION } from './catalog.js';

export const inRegion = (lat, lon) =>
  lat >= REGION.lat0 && lat <= REGION.lat1 && lon >= REGION.lon0 && lon <= REGION.lon1;

/** Great-circle distance in metres. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const formatDistance = (m) =>
  m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + ' km';

export const formatLatLon = (lat, lon) => lat.toFixed(6) + ', ' + lon.toFixed(6);

export const formatHemi = (lat, lon) =>
  Math.abs(lat).toFixed(5) + '°' + (lat >= 0 ? 'N' : 'S') + '  ' + Math.abs(lon).toFixed(5) + '°' + (lon >= 0 ? 'E' : 'W');

/**
 * Read coordinates the way people actually paste them:
 * "9.0123, 38.7456", "9.0123 38.7456", degrees-minutes-seconds,
 * Google Maps links (@lat,lon or !3d..!4d..), ?q=lat,lon, OpenStreetMap links and geo: URIs.
 * Returns {lat, lon, swapped, inRegion} or {error}.
 */
export function parseCoords(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let lat = null, lon = null, m;
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /[?&#](?:q|ll|query|destination|center|daddr)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/i,
    /map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/,
    /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    if ((m = s.match(re))) { lat = +m[1]; lon = +m[2]; break; }
  }
  if (lat === null) {
    const dms = /(\d{1,3})\s*[°º:\s]\s*(\d{1,2})\s*['′:\s]\s*(\d{1,2}(?:[.,]\d+)?)\s*["″]?\s*([NS])[\s,;]*(\d{1,3})\s*[°º:\s]\s*(\d{1,2})\s*['′:\s]\s*(\d{1,2}(?:[.,]\d+)?)\s*["″]?\s*([EW])/i;
    if ((m = s.match(dms))) {
      lat = +m[1] + m[2] / 60 + parseFloat(m[3].replace(',', '.')) / 3600;
      if (/s/i.test(m[4])) lat = -lat;
      lon = +m[5] + m[6] / 60 + parseFloat(m[7].replace(',', '.')) / 3600;
      if (/w/i.test(m[8])) lon = -lon;
    }
  }
  if (lat === null) {
    m = s.match(/(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?/i);
    if (m) {
      lat = +m[1]; lon = +m[3];
      if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
      if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
    }
  }
  if (lat === null && /goo\.gl/i.test(s)) {
    return { error: 'Short share links do not contain the coordinates. In Google Maps, long-press the spot and copy the numbers instead.' };
  }
  if (lat === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { error: 'Could not read coordinates. Use the form 9.012345, 38.745678 or paste a Google Maps link.' };
  }
  let swapped = false;
  if (!inRegion(lat, lon) && inRegion(lon, lat)) { [lat, lon] = [lon, lat]; swapped = true; }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { error: 'Latitude must be between -90 and 90 and longitude between -180 and 180.' };
  }
  return { lat: +lat.toFixed(6), lon: +lon.toFixed(6), swapped, inRegion: inRegion(lat, lon) };
}

/**
 * Accept a sub-city boundary as GeoJSON (Feature, FeatureCollection, Polygon or MultiPolygon, text or object)
 * and return { geometry: {type:'MultiPolygon', coordinates} } or { error }.
 */
export function normalizeBoundary(input) {
  let g = input;
  if (typeof g === 'string') { try { g = JSON.parse(g); } catch { return { error: 'The boundary is not valid GeoJSON.' }; } }
  const polys = [];
  const take = (geom) => {
    if (!geom) return;
    if (geom.type === 'Polygon') polys.push(geom.coordinates);
    else if (geom.type === 'MultiPolygon') polys.push(...geom.coordinates);
    else if (geom.type === 'Feature') take(geom.geometry);
    else if (geom.type === 'FeatureCollection') (geom.features || []).forEach(take);
    else if (geom.type === 'GeometryCollection') (geom.geometries || []).forEach(take);
  };
  take(g);
  if (!polys.length) return { error: 'Paste a GeoJSON Polygon or MultiPolygon (longitude, latitude order).' };
  let points = 0;
  for (const poly of polys) for (const ring of poly) {
    if (!Array.isArray(ring) || ring.length < 4) return { error: 'Each boundary ring needs at least 4 points.' };
    for (const pt of ring) {
      if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1]) || Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90) return { error: 'The boundary has an invalid coordinate.' };
      points++;
    }
  }
  if (points > 20000) return { error: 'The boundary has too many points. Simplify it to under 20,000.' };
  return { geometry: { type: 'MultiPolygon', coordinates: polys } };
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Is the point inside a normalised MultiPolygon boundary (holes respected)? */
export function pointInBoundary(lat, lon, geometry) {
  if (!geometry?.coordinates) return false;
  return geometry.coordinates.some((poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole)));
}
