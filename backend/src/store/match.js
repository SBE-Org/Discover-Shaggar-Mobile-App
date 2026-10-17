// Query and update logic for the in-memory store (used by the automated tests and `MONGODB_URI=memory`).
// Implements the subset of MongoDB the app uses, with MongoDB's semantics:
// equality (null also matches a missing field, an array field matches any element), $eq $ne $in $nin
// $gt $gte $lt $lte $exists $regex/$options $not, $or $and $nor; updates $set $unset $inc $setOnInsert $push.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof RegExp);

export function getPath(doc, path) {
  let v = doc;
  for (const k of path.split('.')) {
    if (v === null || v === undefined) return undefined;
    v = v[k];
  }
  return v;
}

function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(o[keys[i]])) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
function unsetPath(doc, path) {
  const keys = path.split('.');
  let o = doc;
  for (let i = 0; i < keys.length - 1; i++) { o = o?.[keys[i]]; if (!o) return; }
  delete o[keys[keys.length - 1]];
}

const typeRank = (v) => (v === null || v === undefined ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : isObj(v) ? 3 : Array.isArray(v) ? 4 : Buffer.isBuffer(v) ? 5 : typeof v === 'boolean' ? 6 : 7);
/** MongoDB's ordering across types: null < numbers < strings < objects < arrays < binary < booleans. */
export function compare(a, b) {
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (ra === 1 || ra === 6) return a === b ? 0 : a < b ? -1 : 1;
  if (ra === 2) return a === b ? 0 : a < b ? -1 : 1; // binary (code-point) order, like MongoDB's default
  return JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
}

const eq = (a, b) => {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object' && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return false;
};

/** Candidate values for a field: the value itself and, for arrays, each element. */
const candidates = (v) => (Array.isArray(v) ? [v, ...v] : [v]);

function matchOps(value, cond) {
  for (const [op, arg] of Object.entries(cond)) {
    const c = candidates(value);
    switch (op) {
      case '$eq': if (!c.some((x) => eq(x, arg))) return false; break;
      case '$ne': if (c.some((x) => eq(x, arg))) return false; break;
      case '$in': if (!arg.some((a) => (a instanceof RegExp ? c.some((x) => typeof x === 'string' && a.test(x)) : c.some((x) => eq(x, a))))) return false; break;
      case '$nin': if (arg.some((a) => c.some((x) => eq(x, a)))) return false; break;
      case '$gt': if (!c.some((x) => x !== undefined && x !== null && typeRank(x) === typeRank(arg) && compare(x, arg) > 0)) return false; break;
      case '$gte': if (!c.some((x) => x !== undefined && x !== null && typeRank(x) === typeRank(arg) && compare(x, arg) >= 0)) return false; break;
      case '$lt': if (!c.some((x) => x !== undefined && x !== null && typeRank(x) === typeRank(arg) && compare(x, arg) < 0)) return false; break;
      case '$lte': if (!c.some((x) => x !== undefined && x !== null && typeRank(x) === typeRank(arg) && compare(x, arg) <= 0)) return false; break;
      case '$exists': if ((value !== undefined) !== !!arg) return false; break;
      case '$regex': {
        const re = arg instanceof RegExp ? arg : new RegExp(arg, cond.$options || '');
        if (!c.some((x) => typeof x === 'string' && re.test(x))) return false;
        break;
      }
      case '$options': break;
      case '$not': if (matchOps(value, arg)) return false; break;
      default: throw new Error('Unsupported query operator ' + op);
    }
  }
  return true;
}

export function matches(doc, filter = {}) {
  for (const [k, cond] of Object.entries(filter)) {
    if (k === '$or') { if (!cond.some((f) => matches(doc, f))) return false; continue; }
    if (k === '$and') { if (!cond.every((f) => matches(doc, f))) return false; continue; }
    if (k === '$nor') { if (cond.some((f) => matches(doc, f))) return false; continue; }
    const v = getPath(doc, k);
    if (cond instanceof RegExp) { if (!candidates(v).some((x) => typeof x === 'string' && cond.test(x))) return false; continue; }
    if (isObj(cond) && Object.keys(cond).some((x) => x.startsWith('$'))) { if (!matchOps(v, cond)) return false; continue; }
    if (!candidates(v).some((x) => eq(x, cond))) return false;
  }
  return true;
}

export function applyUpdate(doc, update, { inserting = false } = {}) {
  const ops = Object.keys(update).some((k) => k.startsWith('$')) ? update : { $set: update };
  for (const [op, fields] of Object.entries(ops)) {
    // MongoDB refuses empty operators and keys that start with $ or contain dots.
    if (!fields || !Object.keys(fields).length) throw new Error(`'${op}' is empty. You must specify a field like so: {${op}: {<field>: ...}}`);
    for (const [k, v] of Object.entries(fields)) {
      if (k.startsWith('$')) throw new Error('Invalid update key ' + k);
      checkKeys(v);
      if (op === '$set') setPath(doc, k, clone(v));
      else if (op === '$setOnInsert') { if (inserting) setPath(doc, k, clone(v)); }
      else if (op === '$unset') unsetPath(doc, k);
      else if (op === '$inc') setPath(doc, k, (Number(getPath(doc, k)) || 0) + v);
      else if (op === '$push') { const cur = getPath(doc, k); setPath(doc, k, [...(Array.isArray(cur) ? cur : []), clone(v)]); }
      else throw new Error('Unsupported update operator ' + op);
    }
  }
  return doc;
}

/** Stored documents may not have field names with dots or a leading $ (MongoDB rule). */
export function checkKeys(v) {
  if (!v || typeof v !== 'object' || Buffer.isBuffer(v) || v instanceof Date || v instanceof RegExp) return;
  if (Array.isArray(v)) { v.forEach(checkKeys); return; }
  for (const [k, x] of Object.entries(v)) {
    if (k.startsWith('$') || k.includes('.')) throw new Error(`Field names cannot contain '.' or start with '$': ${k}`);
    checkKeys(x);
  }
}

/** Fields fixed by an equality filter, copied into a document created by an upsert. */
export function seedFromFilter(filter) {
  const out = {};
  for (const [k, v] of Object.entries(filter || {})) {
    if (k.startsWith('$')) continue;
    if (isObj(v) && Object.keys(v).some((x) => x.startsWith('$'))) { if ('$eq' in v) setPath(out, k, v.$eq); continue; }
    setPath(out, k, v);
  }
  return out;
}

export function sortDocs(docs, sort) {
  const keys = Object.entries(sort || {});
  if (!keys.length) return docs;
  return docs.sort((a, b) => {
    for (const [k, dir] of keys) {
      const c = compare(getPath(a, k), getPath(b, k));
      if (c) return dir < 0 ? -c : c;
    }
    return 0;
  });
}

export function project(doc, projection) {
  if (!projection || !Object.keys(projection).length) return clone(doc);
  const inc = Object.entries(projection).filter(([k, v]) => v && k !== '_id');
  if (inc.length) {
    const out = {};
    if (projection._id !== 0 && projection._id !== false) out._id = doc._id;
    for (const [k] of inc) { const v = getPath(doc, k); if (v !== undefined) setPath(out, k, clone(v)); }
    return out;
  }
  const out = clone(doc);
  for (const [k, v] of Object.entries(projection)) if (!v) unsetPath(out, k);
  return out;
}

export function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Buffer.isBuffer(v)) return Buffer.from(v);
  if (v instanceof Date) return new Date(v);
  if (v instanceof RegExp) return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = clone(x);
  return o;
}
