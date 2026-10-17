// Thin client for the REST API, shared by the mobile app and the admin portal.
// Errors carry the server message and per-field details.

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details || {}; }
}

export async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Request failed (' + res.status + ').', data?.details);
  return data;
}

export const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
};
const e = encodeURIComponent;

export const api = {
  config: () => call('GET', '/api/config'),
  me: () => call('GET', '/api/auth/me'),
  login: (email, password) => call('POST', '/api/auth/login', { email, password }),
  loginMfa: (ticket, code) => call('POST', '/api/auth/login/mfa', { ticket, code }),
  logout: () => call('POST', '/api/auth/logout', {}),
  changePassword: (current, next) => call('POST', '/api/auth/password', { current, next }),
  mfaSetup: () => call('POST', '/api/auth/mfa/setup', {}),
  mfaEnable: (code) => call('POST', '/api/auth/mfa/enable', { code }),
  mfaDisable: (password, code) => call('POST', '/api/auth/mfa/disable', { password, code }),

  places: (params) => call('GET', '/api/places' + qs(params)),
  place: (id) => call('GET', '/api/places/' + e(id)),
  createPlace: (data) => call('POST', '/api/places', data),
  updatePlace: (id, data) => call('PATCH', '/api/places/' + e(id), data),
  workflow: (id, action, note) => call('POST', `/api/places/${e(id)}/workflow`, { action, note }),
  advance: (id) => call('POST', `/api/places/${e(id)}/advance`, {}),
  markReviewed: (id) => call('POST', `/api/places/${e(id)}/reviewed`, {}),
  bulk: (ids, action, note) => call('POST', '/api/places/bulk', { ids, action, note }),
  history: (id) => call('GET', `/api/places/${e(id)}/history`),
  duplicates: (p) => call('GET', '/api/places/duplicates' + qs(p)),
  deletePlace: (id) => call('DELETE', '/api/places/' + e(id), {}),
  addPhoto: (id, data) => call('POST', `/api/places/${e(id)}/photos`, data),
  updatePhoto: (id, data) => call('PATCH', '/api/photos/' + e(id), data),
  deletePhoto: (id) => call('DELETE', '/api/photos/' + e(id), {}),

  suggest: (data) => call('POST', '/api/suggestions', data),
  suggestions: (status = 'new') => call('GET', '/api/suggestions' + qs({ status })),
  accept: (id, data) => call('POST', `/api/suggestions/${e(id)}/accept`, data),
  reject: (id, reason) => call('POST', `/api/suggestions/${e(id)}/reject`, { reason }),
  report: (data) => call('POST', '/api/reports', data),
  trackReport: (code) => call('GET', '/api/reports/track/' + e(code)),
  reports: (status) => call('GET', '/api/reports' + qs({ status })),
  updateReport: (id, data) => call('PATCH', '/api/reports/' + e(id), data),

  trips: (params) => call('GET', '/api/trips' + qs(params)),
  trip: (id) => call('GET', '/api/trips/' + e(id)),
  createTrip: (d) => call('POST', '/api/trips', d),
  updateTrip: (id, d) => call('PATCH', '/api/trips/' + e(id), d),
  tripStatus: (id, status, message) => call('POST', `/api/trips/${e(id)}/status`, { status, message }),
  tripUpdate: (id, message) => call('POST', `/api/trips/${e(id)}/updates`, { message }),
  deleteTripUpdate: (id, uid) => call('DELETE', `/api/trips/${e(id)}/updates/${uid}`, {}),
  tripPhoto: (id, d) => call('POST', `/api/trips/${e(id)}/photos`, d),
  deleteTripPhoto: (id) => call('DELETE', '/api/trip-photos/' + e(id), {}),
  deleteTrip: (id) => call('DELETE', '/api/trips/' + e(id), {}),
  register: (id, d) => call('POST', `/api/trips/${e(id)}/registrations`, d),
  lookupRegistration: (d) => call('POST', '/api/registrations/lookup', d),
  registrations: (id) => call('GET', `/api/trips/${e(id)}/registrations`),
  updateRegistration: (id, status) => call('PATCH', '/api/registrations/' + e(id), { status }),

  pages: (all) => call('GET', '/api/pages' + (all ? '?scope=all' : '')),
  page: (slug) => call('GET', '/api/pages/' + e(slug)),
  savePage: (slug, d) => call('PUT', '/api/pages/' + e(slug), d),
  deletePage: (slug) => call('DELETE', '/api/pages/' + e(slug), {}),
  announcements: (all) => call('GET', '/api/announcements' + (all ? '?scope=all' : '')),
  createAnnouncement: (d) => call('POST', '/api/announcements', d),
  updateAnnouncement: (id, d) => call('PATCH', '/api/announcements/' + e(id), d),
  deleteAnnouncement: (id) => call('DELETE', '/api/announcements/' + e(id), {}),
  catalog: () => call('GET', '/api/catalog'),
  addSector: (d) => call('POST', '/api/catalog/sectors', d),
  updateSector: (k, d) => call('PATCH', '/api/catalog/sectors/' + e(k), d),
  addType: (d) => call('POST', '/api/catalog/types', d),
  updateType: (s, k, d) => call('PATCH', `/api/catalog/types/${e(s)}/${e(k)}`, d),
  deleteType: (s, k) => call('DELETE', `/api/catalog/types/${e(s)}/${e(k)}`, {}),

  subcities: () => call('GET', '/api/subcities'),
  saveSubcity: (id, data) => call('PUT', '/api/subcities/' + id, data),
  settings: () => call('GET', '/api/settings'),
  saveSettings: (d) => call('PUT', '/api/settings', d),

  stats: () => call('GET', '/api/stats'),
  dashboard: () => call('GET', '/api/dashboard'),
  importCsv: (csv, dryRun) => call('POST', '/api/import', { csv, dry_run: !!dryRun }),
  users: () => call('GET', '/api/users'),
  createUser: (d) => call('POST', '/api/users', d),
  updateUser: (id, d) => call('PATCH', '/api/users/' + id, d),
  userSessions: (id) => call('GET', `/api/users/${id}/sessions`),
  roles: () => call('GET', '/api/roles'),
  permissions: () => call('GET', '/api/permissions'),
  createRole: (d) => call('POST', '/api/roles', d),
  updateRole: (k, d) => call('PATCH', '/api/roles/' + e(k), d),
  deleteRole: (k) => call('DELETE', '/api/roles/' + e(k), {}),
  audit: (params) => call('GET', '/api/audit' + qs(params)),
  revert: (id) => call('POST', `/api/audit/${id}/revert`, {}),
  system: () => call('GET', '/api/system'),
  systemCheck: () => call('GET', '/api/system/check'),
  backup: () => call('POST', '/api/system/backup', {}),

  menu: (id) => call('GET', `/api/places/${e(id)}/menu`),
  addMenuItem: (id, d) => call('POST', `/api/places/${e(id)}/menu`, d),
  updateMenuItem: (id, d) => call('PATCH', '/api/menu/' + e(id), d),
  deleteMenuItem: (id) => call('DELETE', '/api/menu/' + e(id), {}),
  suggestMenuItem: (id, d) => call('POST', `/api/places/${e(id)}/menu/suggest`, d),
  visitorPhoto: (id, d) => call('POST', `/api/places/${e(id)}/visitor-photos`, d),
  contributions: (params) => call('GET', '/api/contributions' + qs(params)),
  decide: (kind, id, decision, body = {}) => call('POST', `/api/contributions/${kind}/${e(id)}/${decision}`, body),
  uploadBrand: (kind, image) => call('POST', '/api/branding/' + kind, { image }),
  resetBrand: (kind) => call('DELETE', '/api/branding/' + kind, {}),
};
