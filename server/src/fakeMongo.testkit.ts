/**
 * Tests only: a tiny in-memory stand-in for the Atlas `Db`, enough for the
 * settlement and score-claim paths (players, matches, duetScores, liveRooms).
 *
 * Every operation runs synchronously inside its async call, so like Mongo a
 * single findOneAndUpdate / updateOne / insertOne is atomic; concurrent
 * callers only interleave between operations. Unique indexes (with the
 * `$type: "number"` partial filter db.ts uses) raise E11000 like the driver.
 */
import type { Db } from "mongodb";

type Doc = Record<string, any>;
type Index = { keys: string[]; partialNumber: string[] };

function getPath(doc: Doc, path: string): unknown {
  let cur: any = doc;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: any = doc;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] == null || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]!] = value;
}

const same = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) || JSON.stringify(a) === JSON.stringify(b);

function matches(doc: Doc, filter: Doc): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    const value = getPath(doc, key);
    const isOps =
      cond && typeof cond === "object" && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith("$"));
    if (!isOps) {
      if (!same(value, cond)) return false;
      continue;
    }
    for (const [op, arg] of Object.entries(cond as Doc)) {
      if (op === "$ne" && same(value, arg)) return false;
      if (op === "$exists" && (value !== undefined) !== Boolean(arg)) return false;
      if (op === "$in" && !(arg as unknown[]).some((x) => same(value, x))) return false;
      if (op === "$nin" && (arg as unknown[]).some((x) => same(value, x))) return false;
      if (op === "$type" && arg === "number" && typeof value !== "number") return false;
      if (op === "$gt" && !((value as any) > (arg as any))) return false;
      if (op === "$lt" && !((value as any) < (arg as any))) return false;
    }
  }
  return true;
}

function applyUpdate(doc: Doc, update: Doc, inserting: boolean): void {
  for (const [path, v] of Object.entries(update.$set ?? {})) setPath(doc, path, structuredClone(v));
  if (inserting) {
    for (const [path, v] of Object.entries(update.$setOnInsert ?? {})) setPath(doc, path, structuredClone(v));
  }
  for (const [path, v] of Object.entries(update.$inc ?? {})) {
    setPath(doc, path, Number(getPath(doc, path) ?? 0) + Number(v));
  }
  for (const [path, v] of Object.entries(update.$max ?? {})) {
    const cur = getPath(doc, path);
    if (cur === undefined || (v as any) > (cur as any)) setPath(doc, path, v);
  }
}

export class FakeCollection {
  docs: Doc[] = [];
  private indexes: Index[] = [];
  private nextId = 1;

  constructor(readonly name: string) {}

  async createIndex(keys: Doc, opts: Doc = {}): Promise<string> {
    if (opts.unique) {
      const partial = opts.partialFilterExpression ?? {};
      this.indexes.push({
        keys: Object.keys(keys),
        partialNumber: Object.keys(partial).filter((k) => partial[k]?.$type === "number"),
      });
    }
    return Object.keys(keys).join("_");
  }

  private checkUnique(candidate: Doc, self?: Doc): void {
    for (const idx of this.indexes) {
      if (idx.partialNumber.some((k) => typeof getPath(candidate, k) !== "number")) continue;
      const clash = this.docs.find(
        (d) =>
          d !== self &&
          !idx.partialNumber.some((k) => typeof getPath(d, k) !== "number") &&
          idx.keys.every((k) => same(getPath(d, k), getPath(candidate, k))),
      );
      if (clash) {
        const err = new Error(`E11000 duplicate key error collection: ${this.name}`) as Error & { code: number };
        err.code = 11000;
        throw err;
      }
    }
  }

  async insertOne(doc: Doc): Promise<{ insertedId: unknown }> {
    const copy = structuredClone(doc);
    copy._id ??= `${this.name}-${this.nextId++}`;
    this.checkUnique(copy);
    this.docs.push(copy);
    doc._id = copy._id;
    return { insertedId: copy._id };
  }

  async findOne(filter: Doc = {}): Promise<Doc | null> {
    const doc = this.docs.find((d) => matches(d, filter));
    return doc ? structuredClone(doc) : null;
  }

  private upsertOrUpdate(filter: Doc, update: Doc, upsert: boolean): { doc: Doc | null; matched: number } {
    const doc = this.docs.find((d) => matches(d, filter));
    if (doc) {
      const next = structuredClone(doc);
      applyUpdate(next, update, false);
      this.checkUnique(next, doc);
      Object.assign(doc, next);
      return { doc, matched: 1 };
    }
    if (!upsert) return { doc: null, matched: 0 };
    const fresh: Doc = {};
    for (const [k, v] of Object.entries(filter)) {
      if (!(v && typeof v === "object" && Object.keys(v).some((x) => x.startsWith("$")))) setPath(fresh, k, v);
    }
    applyUpdate(fresh, update, true);
    fresh._id = `${this.name}-${this.nextId++}`;
    this.checkUnique(fresh);
    this.docs.push(fresh);
    return { doc: fresh, matched: 0 };
  }

  async updateOne(filter: Doc, update: Doc, opts: Doc = {}) {
    const { matched } = this.upsertOrUpdate(filter, update, Boolean(opts.upsert));
    return { matchedCount: matched, modifiedCount: matched, upsertedCount: matched ? 0 : opts.upsert ? 1 : 0 };
  }

  async findOneAndUpdate(filter: Doc, update: Doc, opts: Doc = {}): Promise<Doc | null> {
    const before = this.docs.find((d) => matches(d, filter));
    const snapshot = before ? structuredClone(before) : null;
    const { doc } = this.upsertOrUpdate(filter, update, Boolean(opts.upsert));
    if (!doc) return null;
    return opts.returnDocument === "after" ? structuredClone(doc) : snapshot;
  }

  async deleteOne(filter: Doc) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  async countDocuments(filter: Doc = {}): Promise<number> {
    return this.docs.filter((d) => matches(d, filter)).length;
  }

  /** Just enough for analytics: optional `$match`, then `$group` by one field with `$sum: 1`. */
  aggregate(pipeline: Doc[]): { toArray: () => Promise<Doc[]> } {
    let rows = this.docs.map((d) => structuredClone(d));
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match));
      if (stage.$group) {
        const { _id, ...sums } = stage.$group as Doc;
        const field = typeof _id === "string" && _id.startsWith("$") ? _id.slice(1) : null;
        const groups = new Map<unknown, Doc>();
        for (const d of rows) {
          const key = field ? getPath(d, field) : _id;
          const row = groups.get(key) ?? { _id: key };
          for (const name of Object.keys(sums)) row[name] = Number(row[name] ?? 0) + 1;
          groups.set(key, row);
        }
        rows = [...groups.values()];
      }
    }
    return { toArray: async () => rows };
  }
}

export class FakeDb {
  private cols = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    let col = this.cols.get(name);
    if (!col) {
      col = new FakeCollection(name);
      this.cols.set(name, col);
    }
    return col;
  }
  /** Typed as the driver's Db for setDbForTests. */
  asDb(): Db {
    return this as unknown as Db;
  }
}
