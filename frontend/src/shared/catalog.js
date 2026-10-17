// Shared by the browser and the server: categories, workflow states, permissions and fixed lists.
// Sectors (category groups) and types (categories) are the defaults seeded into the database on first start.
// Administrators can rename, recolour, add or retire them from the admin portal; the live list is loaded
// with applyCatalog(), which updates these objects in place so every module sees the same data.

export const SECTORS = {
  tourism:    { label: 'Tourism',    color: '#D97706', icon: 'mountain', review_months: 6 },
  government: { label: 'Government', color: '#1D4ED8', icon: 'bank', review_months: 6 },
  finance:    { label: 'Finance',    color: '#047857', icon: 'coin', review_months: 12 },
  education:  { label: 'Education',  color: '#7C3AED', icon: 'cap', review_months: 12 },
  health:     { label: 'Health',     color: '#DB2777', icon: 'cross', review_months: 6 },
  transport:  { label: 'Transport',  color: '#475569', icon: 'bus', review_months: 12 },
  business:   { label: 'Business',   color: '#0E7490', icon: 'bag', review_months: 12 },
};
export const SECTOR_IDS = Object.keys(SECTORS);

export const TYPES = {
  tourism: { nature: 'Nature site', adventure: 'Adventure site', culture: 'Cultural site', historic: 'Historic site', religious: 'Religious site', park: 'Park and recreation', hotel: 'Hotel', restaurant: 'Restaurant', cafe: 'Café' },
  government: { mayor: "Mayor's Office", subcity: 'Subcity office', woreda: 'Woreda office', service: 'Service centre', land: 'Land office', revenue: 'Revenue office', trade: 'Trade office', civil: 'Civil registration', jobs: 'Job creation office', police: 'Police station' },
  finance: { bank: 'Bank', mfi: 'Microfinance', sacco: 'SACCO', insurance: 'Insurance', atm: 'ATM', momo: 'Mobile-money agent' },
  education: { university: 'University', college: 'College', tvet: 'TVET', high: 'High school', primary: 'Primary school', training: 'Training centre', library: 'Library' },
  health: { hospital: 'Hospital', hc: 'Health centre', clinic: 'Clinic', pharmacy: 'Pharmacy', emergency: 'Emergency unit' },
  transport: { bus: 'Bus terminal', taxi: 'Taxi station', parking: 'Parking', fuel: 'Fuel station', ev: 'EV charging' },
  business: { mall: 'Shopping centre', market: 'Market', super: 'Supermarket', telecom: 'Telecom shop', factory: 'Factory / industry', other: 'Other business' },
};
/** Translated labels for sectors/types, filled by applyCatalog: { 'tourism': {om, am}, 'tourism/nature': {om, am} } */
export const CATALOG_I18N = {};

export const ATTRACTION_TYPES = ['nature', 'adventure', 'culture', 'historic', 'religious', 'park'];
export const INTEREST_GROUPS = { nature: ['nature', 'park'], adventure: ['adventure'], culture: ['culture', 'historic', 'religious'] };
export const INTEREST_LABELS = { nature: 'Nature', adventure: 'Adventure', culture: 'Culture & History' };

export const ICON_CHOICES = ['mountain', 'bank', 'coin', 'cap', 'cross', 'bus', 'bag', 'pin', 'route', 'sun', 'ticket', 'phone', 'web', 'user', 'shield', 'compass'];

/**
 * Replace the live catalog with the one stored in the database.
 * cat = { sectors: [{key,label,label_om,label_am,color,icon,sort,active,review_months}], types: [{sector,key,label,...,attraction,active}] }
 * Inactive entries stay known (so old records still show a label) but are flagged.
 */
export function applyCatalog(cat) {
  if (!cat || !Array.isArray(cat.sectors) || !cat.sectors.length) return;
  for (const k of Object.keys(SECTORS)) delete SECTORS[k];
  for (const k of Object.keys(TYPES)) delete TYPES[k];
  for (const k of Object.keys(CATALOG_I18N)) delete CATALOG_I18N[k];
  SECTOR_IDS.length = 0;
  ATTRACTION_TYPES.length = 0;
  HAS_MENU.clear();
  const sectors = [...cat.sectors].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.key.localeCompare(b.key));
  for (const s of sectors) {
    SECTORS[s.key] = { label: s.label, color: s.color, icon: s.icon, review_months: s.review_months ?? 12, active: s.active !== 0 && s.active !== false };
    TYPES[s.key] = {};
    CATALOG_I18N[s.key] = { om: s.label_om || '', am: s.label_am || '' };
    if (SECTORS[s.key].active) SECTOR_IDS.push(s.key);
  }
  const types = [...(cat.types || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const inactiveTypes = {};
  for (const t of types) {
    if (!TYPES[t.sector]) continue;
    TYPES[t.sector][t.key] = t.label;
    CATALOG_I18N[t.sector + '/' + t.key] = { om: t.label_om || '', am: t.label_am || '' };
    if (t.attraction) ATTRACTION_TYPES.push(t.key);
    if (t.has_menu) HAS_MENU.add(t.sector + '/' + t.key); else HAS_MENU.delete(t.sector + '/' + t.key);
    if (t.active === 0 || t.active === false) (inactiveTypes[t.sector] ||= new Set()).add(t.key);
  }
  INACTIVE_TYPES.clear();
  for (const [s, set] of Object.entries(inactiveTypes)) for (const k of set) INACTIVE_TYPES.add(s + '/' + k);
}
export const INACTIVE_TYPES = new Set();
export const isTypeActive = (sector, type) => !!(TYPES[sector] && TYPES[sector][type] !== undefined) && !INACTIVE_TYPES.has(sector + '/' + type) && SECTORS[sector]?.active !== false;

/** Default catalog rows used to seed the database. */
export const MENU_TYPES = ['restaurant', 'cafe', 'hotel'];
export const HAS_MENU = new Set(MENU_TYPES.map((t) => 'tourism/' + t));
export const hasMenu = (p) => HAS_MENU.has(p.sector + '/' + p.type);
export const allowsVisitorPhotos = (p) => p.sector === 'tourism';
export function defaultCatalog() {
  const sectors = Object.entries(SECTORS).map(([key, s], i) => ({ key, label: s.label, color: s.color, icon: s.icon, sort: i, review_months: s.review_months, active: 1 }));
  const types = [];
  for (const [sector, t] of Object.entries(TYPES)) {
    Object.entries(t).forEach(([key, label], i) => types.push({ sector, key, label, sort: i, active: 1, attraction: sector === 'tourism' && ATTRACTION_TYPES.includes(key) ? 1 : 0, has_menu: sector === 'tourism' && MENU_TYPES.includes(key) ? 1 : 0 }));
  }
  return { sectors, types };
}

/* ---------- publishing workflow (spec 10.2, Appendix B) ---------- */
export const STATUSES = ['draft', 'submitted', 'needs_correction', 'verified', 'published', 'rejected', 'archived'];
export const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', needs_correction: 'Needs correction', verified: 'Verified',
  published: 'Published', rejected: 'Rejected', archived: 'Archived',
};
/** Which workflow actions are possible from each status. */
export const WORKFLOW = {
  submit:    { from: ['draft', 'needs_correction'], to: 'submitted', perm: 'places.submit', label: 'Submit for review' },
  verify:    { from: ['submitted'], to: 'verified', perm: 'places.review', label: 'Verify', own: false },
  return:    { from: ['submitted', 'verified'], to: 'needs_correction', perm: 'places.review', label: 'Return for correction', note: true },
  approve:   { from: ['submitted'], to: 'published', perm: 'places.publish', label: 'Approve & publish', own: false },
  publish:   { from: ['verified'], to: 'published', perm: 'places.publish', label: 'Publish', own: false },
  unpublish: { from: ['published'], to: 'verified', perm: 'places.publish', label: 'Unpublish' },
  reject:    { from: ['submitted', 'verified', 'needs_correction'], to: 'rejected', perm: 'places.review', label: 'Reject', note: true },
  archive:   { from: ['published', 'verified', 'rejected', 'draft'], to: 'archived', perm: 'places.publish', label: 'Archive' },
  restore:   { from: ['archived', 'rejected'], to: 'draft', perm: 'places.publish', label: 'Restore to draft' },
};
/** The usual next step, for one-tap buttons. */
export const NEXT_ACTION = { draft: 'submit', needs_correction: 'submit', submitted: 'verify', verified: 'publish' };

/** Operational condition of a place (FR-015). */
/* ---------- menus (restaurants, cafés, hotels) ---------- */
export const MENU_SECTIONS = ['Breakfast', 'Starters', 'Main dishes', 'Traditional dishes', 'Fasting dishes', 'Grill', 'Pizza & pasta', 'Sandwiches & burgers', 'Desserts', 'Coffee & tea', 'Juices & soft drinks', 'Other drinks', 'Rooms', 'Other'];
export const CONTRIB_STATUSES = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Not accepted' };

export const CONDITIONS = {
  open: 'Open as usual', temp_closed: 'Temporarily closed', perm_closed: 'Permanently closed',
  moved: 'Moved', construction: 'Under construction', unconfirmed: 'Information unconfirmed',
};

export const FACILITIES = {
  parking: 'Parking', toilets: 'Toilets', accessible_toilet: 'Accessible toilet', wheelchair: 'Wheelchair access',
  step_free: 'Step-free route', food: 'Food', water: 'Drinking water', guide: 'Guides available',
  wifi: 'Wi-Fi', network: 'Mobile network', family: 'Family friendly', prayer: 'Prayer room',
};

export const COORD_SOURCES = { gps: 'Phone GPS', map: 'Map pin', typed: 'Typed / pasted', import: 'Imported dataset', survey: 'Field survey' };

export const PHOTO_RIGHTS = {
  bureau: 'Taken by Bureau staff', licensed: 'Licensed', permission: 'Used with permission',
  unknown: 'Rights not confirmed', withdrawn: 'Withdrawn',
};
export const PUBLIC_PHOTO_RIGHTS = ['bureau', 'licensed', 'permission'];

/* ---------- roles and permissions (spec section 4) ---------- */
export const PERMISSIONS = {
  'places.view':        { group: 'Places', label: 'See unpublished records' },
  'places.create':      { group: 'Places', label: 'Add places and capture GPS' },
  'places.edit':        { group: 'Places', label: 'Edit place details' },
  'places.submit':      { group: 'Places', label: 'Submit for review' },
  'places.review':      { group: 'Places', label: 'Verify, return or reject' },
  'places.publish':     { group: 'Places', label: 'Publish, unpublish and archive' },
  'places.delete':      { group: 'Places', label: 'Delete places permanently' },
  'places.import':      { group: 'Places', label: 'Import CSV' },
  'places.export':      { group: 'Places', label: 'Export CSV' },
  'moderation.manage':  { group: 'Public input', label: 'Handle suggestions and problem reports' },
  'contributions.manage': { group: 'Public input', label: 'Approve visitor photos and customer menu items' },
  'trips.manage':       { group: 'Trips & events', label: 'Create and update trips and events' },
  'trips.registrations':{ group: 'Trips & events', label: 'See registrations (personal data)' },
  'content.manage':     { group: 'Content', label: 'Pages, announcements and featured items' },
  'catalog.manage':     { group: 'Content', label: 'Categories and types' },
  'areas.manage':       { group: 'Content', label: 'Sub-city details and boundaries' },
  'reports.view':       { group: 'Oversight', label: 'Dashboards and coverage reports' },
  'audit.view':         { group: 'Oversight', label: 'Activity log' },
  'users.manage':       { group: 'Administration', label: 'All staff accounts below my level' },
  'team.manage':        { group: 'Administration', label: 'Data-entry staff in my own sub-city' },
  'roles.manage':       { group: 'Administration', label: 'Roles and permissions' },
  'settings.manage':    { group: 'Administration', label: 'System settings' },
  'system.backup':      { group: 'Administration', label: 'Backups' },
};
export const PERMISSION_KEYS = Object.keys(PERMISSIONS);

/**
 * Roles form a hierarchy. `level` decides who may manage whom and who may approve whose work:
 * nobody manages an account at or above their own level, and a record is approved only by someone
 * at the same level as its author or higher. Sub-city scope is set per person on the account.
 */
export const DEFAULT_ROLES = [
  { key: 'admin', level: 100, name: 'Administrator', description: 'Full access. Manages supervisors and all staff, settings and branding. Privileged actions are logged.', permissions: ['*'], is_system: 1 },
  { key: 'sysadmin', level: 90, name: 'System administrator', description: 'Manages accounts, access, settings and backups. No editorial access by default.',
    permissions: ['users.manage', 'team.manage', 'roles.manage', 'settings.manage', 'system.backup', 'audit.view', 'reports.view'], is_system: 1 },
  { key: 'approver', level: 70, name: 'Central supervisor', description: 'Approves and publishes records city-wide, including work from sub-cities without a supervisor and from central editors.',
    permissions: ['places.view', 'places.create', 'places.edit', 'places.submit', 'places.review', 'places.publish', 'places.export', 'moderation.manage', 'contributions.manage', 'trips.manage', 'trips.registrations', 'content.manage', 'reports.view', 'audit.view', 'team.manage'], is_system: 1 },
  { key: 'editor', level: 60, name: 'Central content editor', description: 'Manages city-wide content, categories, translations and trips. Their records are approved by a central supervisor.',
    permissions: ['places.view', 'places.create', 'places.edit', 'places.submit', 'places.review', 'places.import', 'places.export', 'moderation.manage', 'contributions.manage', 'trips.manage', 'trips.registrations', 'content.manage', 'catalog.manage', 'reports.view'], is_system: 1 },
  { key: 'supervisor', level: 50, name: 'Sub-city supervisor', description: 'Checks and approves the data entered in their sub-city, approves visitor photos and menu items, and manages the data-entry staff of the sub-city.',
    permissions: ['places.view', 'places.create', 'places.edit', 'places.submit', 'places.review', 'places.publish', 'places.export', 'moderation.manage', 'contributions.manage', 'reports.view', 'team.manage'], is_system: 1 },
  { key: 'reviewer', level: 40, name: 'Sub-city reviewer', description: 'Checks completeness and location for the assigned sub-city and returns records for correction. Cannot publish.',
    permissions: ['places.view', 'places.create', 'places.edit', 'places.submit', 'places.review', 'moderation.manage', 'contributions.manage', 'reports.view'], is_system: 1 },
  { key: 'data_entry', level: 20, name: 'Data entry', description: 'Enters places, GPS locations, photos and menus. Everything they enter waits for their supervisor’s approval.',
    permissions: ['places.view', 'places.create', 'places.edit', 'places.submit'], is_system: 1 },
  { key: 'collector', level: 20, name: 'Field data collector', description: 'Captures coordinates and photos in the field for the assigned sub-city. Cannot approve or publish.',
    permissions: ['places.view', 'places.create', 'places.edit', 'places.submit'], is_system: 1 },
  { key: 'auditor', level: 10, name: 'Auditor / management viewer', description: 'Read-only dashboards and activity log. Personal data is hidden.',
    permissions: ['places.view', 'reports.view', 'audit.view'], is_system: 1 },
];
export const LEVEL_NAMES = [[100, 'Administrator'], [80, 'Admin'], [60, 'Central'], [50, 'Supervisor'], [30, 'Staff'], [20, 'Data entry'], [0, 'Viewer']];
export const levelName = (n) => (LEVEL_NAMES.find(([l]) => n >= l) || [0, 'Viewer'])[1];
export const ROLES = DEFAULT_ROLES.map((r) => r.key);

/* ---------- trips and events (spec 5.4, 7.3) ---------- */
export const TRIP_STATUSES = ['draft', 'scheduled', 'open', 'full', 'postponed', 'cancelled', 'completed', 'archived'];
export const TRIP_STATUS_LABELS = {
  draft: 'Draft', scheduled: 'Scheduled', open: 'Open for registration', full: 'Full', postponed: 'Postponed',
  cancelled: 'Cancelled', completed: 'Completed', archived: 'Archived',
};
export const PUBLIC_TRIP_STATUSES = ['scheduled', 'open', 'full', 'postponed', 'cancelled', 'completed'];
export const TRIP_CATEGORIES = { nature: 'Nature trip', culture: 'Culture & heritage', adventure: 'Adventure', festival: 'Festival', community: 'Community event', education: 'Learning & tour', other: 'Other' };
export const REGISTRATION_MODES = { none: 'No registration', enquiry: 'Enquiry (we call you back)', register: 'Free registration' };

/* ---------- public problem reports (spec 5.5) ---------- */
export const REPORT_TYPES = {
  wrong_pin: 'Wrong map location', wrong_info: 'Wrong details (phone, hours…)', closed: 'Closed or moved',
  broken_link: 'Broken link', inappropriate: 'Inappropriate content or photo', other: 'Something else',
};
export const REPORT_STATUSES = { open: 'Open', in_progress: 'In progress', needs_info: 'Clarification requested', resolved: 'Resolved', rejected: 'Not accepted' };

/* ---------- languages (spec 9.3) ---------- */
export const LANGS = { en: 'English', om: 'Afaan Oromoo', am: 'አማርኛ' };

export const SUBCITY_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const subcityCode = (id) => (id === 0 ? 'MO' : String(id).padStart(2, '0'));
export const defaultSubcityName = (id) => (id === 0 ? "Mayor's Office" : 'Subcity ' + String(id).padStart(2, '0'));

export const typeLabel = (sector, type) => (TYPES[sector] && TYPES[sector][type]) || type;
export const isAttraction = (p) => p.sector === 'tourism' && ATTRACTION_TYPES.includes(p.type);

// Approximate service area. Points outside get a warning, not a block.
export const REGION = { lat0: 8.55, lat1: 9.5, lon0: 38.3, lon1: 39.2 };
export const CITY_BOUNDS = [[8.82, 38.52], [9.24, 38.98]];
export const CITY_CENTER = [9.03, 38.74];

/** Default system settings (spec 6.2 accuracy rules, 10.3 review schedule, 12 security). */
export const DEFAULT_SETTINGS = {
  'site.name': 'Discover Shaggar',
  'site.contact_email': '',
  'site.contact_phone': '',
  'workflow.allow_self_approval': false,
  'gps.good_accuracy_m': 10,
  'gps.max_accuracy_m': 20,
  'review.warn_days': 30,
  'security.require_mfa_admins': false,
  'security.session_days': 14,
  'privacy.registration_retention_days': 180,
  'privacy.report_contact_retention_days': 365,
  'public.show_stale_warning': true,
  'public.visitor_photos': true,
  'public.customer_menu_items': true,
  'brand.tagline': 'Verified places across all 12 sub-cities',
  'brand.logo': '',
  'brand.hero': '',
  'brand.primary': '#C8102E',
};
