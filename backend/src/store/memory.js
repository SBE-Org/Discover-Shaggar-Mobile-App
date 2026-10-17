// In-memory store with the same interface as the MongoDB store. Used by `npm test`,
// and by `MONGODB_URI=memory` for a quick look without a database (data is lost on restart).
import { matches, applyUpdate, seedFromFilter, sortDocs, project, clone, checkKeys } from './match.js';

class MemoryCollection {
  constructor(name) { this.name = name; this.docs = new Map(); this.unique = []; }

  _all(filter) { return [...this.docs.values()].filter((d) => matches(d, filter)); }
  _checkUnique(doc, selfId) {
    for (const fields of this.unique) {
      const key = fields.map((f) => JSON.stringify(doc[f] ?? null)).join('|');
      for (const d of this.docs.values()) {
        if (d._id === selfId) continue;
        if (fields.map((f) => JSON.stringify(d[f] ?? null)).join('|') === key) {
          const e = new Error(`E11000 duplicate key error collection: ${this.name}`); e.code = 11000; throw e;
        }
      }
    }
  }

  async find(filter = {}, { sort, skip = 0, limit = 0, projection } = {}) {
    let list = sortDocs(this._all(filter), sort);
    if (skip) list = list.slice(skip);
    if (limit) list = list.slice(0, limit);
    return list.map((d) => project(d, { _id: 0, ...(projection || {}) }));
  }
  async findOne(filter = {}, opts = {}) { return (await this.find(filter, { ...opts, limit: 1 }))[0] || null; }
  async count(filter = {}) { return this._all(filter).length; }
  async distinct(field, filter = {}) {
    const out = [];
    for (const d of this._all(filter)) {
      const v = d[field];
      for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && !out.some((y) => JSON.stringify(y) === JSON.stringify(x))) out.push(x);
    }
    return out;
  }
  async insertOne(doc) {
    const d = clone(doc);
    if (d._id === undefined) throw new Error('Documents need an _id');
    const { _id, ...rest } = d; checkKeys(rest);
    if (this.docs.has(d._id)) { const e = new Error(`E11000 duplicate key error collection: ${this.name} _id`); e.code = 11000; throw e; }
    this._checkUnique(d);
    this.docs.set(d._id, d);
    return { insertedId: d._id };
  }
  async insertMany(docs) { for (const d of docs) await this.insertOne(d); return { insertedCount: docs.length }; }
  async updateOne(filter, update, { upsert = false } = {}) {
    const d = this._all(filter)[0];
    if (!d) {
      if (!upsert) return { matched: 0, modified: 0 };
      const doc = applyUpdate(seedFromFilter(filter), update, { inserting: true });
      if (doc._id === undefined) throw new Error('Upserted documents need an _id');
      await this.insertOne(doc);
      return { matched: 0, modified: 0, upserted: doc._id };
    }
    const next = applyUpdate(clone(d), update);
    this._checkUnique(next, d._id);
    this.docs.set(d._id, next);
    return { matched: 1, modified: 1 };
  }
  async updateMany(filter, update) {
    const list = this._all(filter);
    for (const d of list) this.docs.set(d._id, applyUpdate(clone(d), update));
    return { matched: list.length, modified: list.length };
  }
  async findOneAndUpdate(filter, update, { upsert = false, sort } = {}) {
    const d = sortDocs(this._all(filter), sort)[0];
    if (!d && !upsert) return null;
    if (!d) { const doc = applyUpdate(seedFromFilter(filter), update, { inserting: true }); await this.insertOne(doc); return project(doc, { _id: 0 }); }
    const next = applyUpdate(clone(d), update);
    this.docs.set(d._id, next);
    return project(next, { _id: 0 });
  }
  async deleteOne(filter) { const d = this._all(filter)[0]; if (d) this.docs.delete(d._id); return { deleted: d ? 1 : 0 }; }
  async deleteMany(filter = {}) { const list = this._all(filter); for (const d of list) this.docs.delete(d._id); return { deleted: list.length }; }
  async createIndex(spec, opts = {}) { if (opts.unique) this.unique.push(Object.keys(spec)); }
  async raw() { return [...this.docs.values()].map(clone); }
  async bytes() { let n = 0; for (const d of this.docs.values()) n += JSON.stringify(d, (k, v) => (v && v.type === 'Buffer' ? '' : v)).length + (d.data?.length || 0); return n; }
}

export function memoryStore() {
  const cols = new Map();
  return {
    kind: 'memory',
    collection(name) { if (!cols.has(name)) cols.set(name, new MemoryCollection(name)); return cols.get(name); },
    async collectionNames() { return [...cols.keys()]; },
    async stats() { let n = 0; for (const c of cols.values()) n += await c.bytes(); return { dataSize: n, storageSize: n }; },
    async ping() { return true; },
    async drop() { cols.clear(); },
    async close() {},
  };
}
