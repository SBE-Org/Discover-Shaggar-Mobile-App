// MongoDB store: a thin layer over the official driver so every query in the app goes through
// the same few calls. Documents keep their own `id` field (and the same value as `_id`);
// `_id` is never sent to the browser.
import { MongoClient } from 'mongodb';

/** Buffers come back from MongoDB as BSON Binary values; turn them back into Buffers. */
function fixBinary(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  for (const [k, v] of Object.entries(doc)) {
    if (v && v._bsontype === 'Binary') doc[k] = Buffer.from(v.buffer);
  }
  return doc;
}

class MongoCollection {
  constructor(col) { this.col = col; }
  async find(filter = {}, { sort, skip, limit, projection } = {}) {
    let cur = this.col.find(filter, { projection: { _id: 0, ...(projection || {}) } });
    if (sort && Object.keys(sort).length) cur = cur.sort(sort);
    if (skip) cur = cur.skip(skip);
    if (limit) cur = cur.limit(limit);
    return (await cur.toArray()).map(fixBinary);
  }
  async findOne(filter = {}, { sort, projection } = {}) {
    return fixBinary(await this.col.findOne(filter, { sort, projection: { _id: 0, ...(projection || {}) } }));
  }
  async count(filter = {}) { return this.col.countDocuments(filter); }
  async distinct(field, filter = {}) { return this.col.distinct(field, filter); }
  async insertOne(doc) { await this.col.insertOne({ ...doc }); return { insertedId: doc._id }; }
  async insertMany(docs) { if (!docs.length) return { insertedCount: 0 }; const r = await this.col.insertMany(docs.map((d) => ({ ...d })), { ordered: true }); return { insertedCount: r.insertedCount }; }
  async updateOne(filter, update, { upsert = false } = {}) {
    const ops = Object.keys(update).some((k) => k.startsWith('$')) ? update : { $set: update };
    const r = await this.col.updateOne(filter, ops, { upsert });
    return { matched: r.matchedCount, modified: r.modifiedCount, upserted: r.upsertedId ?? undefined };
  }
  async updateMany(filter, update) {
    const ops = Object.keys(update).some((k) => k.startsWith('$')) ? update : { $set: update };
    const r = await this.col.updateMany(filter, ops);
    return { matched: r.matchedCount, modified: r.modifiedCount };
  }
  async findOneAndUpdate(filter, update, { upsert = false, sort } = {}) {
    const r = await this.col.findOneAndUpdate(filter, update, { upsert, sort, returnDocument: 'after', projection: { _id: 0 }, includeResultMetadata: false });
    return fixBinary(r);
  }
  async deleteOne(filter) { const r = await this.col.deleteOne(filter); return { deleted: r.deletedCount }; }
  async deleteMany(filter = {}) { const r = await this.col.deleteMany(filter); return { deleted: r.deletedCount }; }
  async createIndex(spec, opts = {}) { return this.col.createIndex(spec, opts); }
  async raw() { return (await this.col.find({}).toArray()).map(fixBinary); }
}

export async function mongoStore(uri, dbName) {
  // ignoreUndefined: fields set to undefined are left out instead of being stored as null.
  const client = new MongoClient(uri, { ignoreUndefined: true, serverSelectionTimeoutMS: 15000, maxPoolSize: 20 });
  await client.connect();
  const db = client.db(dbName || undefined);
  const cols = new Map();
  return {
    kind: 'mongodb',
    collection(name) { if (!cols.has(name)) cols.set(name, new MongoCollection(db.collection(name))); return cols.get(name); },
    async collectionNames() { return (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name); },
    async stats() { const s = await db.stats(); return { dataSize: s.dataSize, storageSize: s.storageSize }; },
    async ping() { await db.command({ ping: 1 }); return true; },
    async drop() { await db.dropDatabase(); },
    async close() { await client.close(); },
  };
}
