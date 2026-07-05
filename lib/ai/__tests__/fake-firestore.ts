/**
 * A minimal in-memory Firestore double for tests. Implements the read surface the
 * AI layer uses (collection → where/orderBy/limit/get, doc → get, subcollections)
 * and RECORDS every write (set/update/delete/add) with its collection path, so a
 * test can assert exactly which collections were written to.
 *
 * Not a full Firestore — just enough to drive the intelligence layer offline.
 */

export type WriteOp = "set" | "update" | "delete" | "add";
export interface RecordedWrite {
  collection: string; // e.g. "ai_usage", "orders"
  path: string; // full path incl. id
  op: WriteOp;
}

type DocData = Record<string, unknown>;
interface Row {
  id: string;
  data: DocData;
}
interface Filter {
  field: string;
  op: string;
  value: unknown;
}
interface Order {
  field: string;
  dir: "asc" | "desc";
}

function valueOf(v: unknown): number | string {
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === "object" && typeof (v as { seconds?: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  return v as number | string;
}

function applyFilter(fieldVal: unknown, op: string, target: unknown): boolean {
  const a = valueOf(fieldVal);
  const b = valueOf(target);
  switch (op) {
    case "==":
      return a === b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    default:
      return true;
  }
}

class FakeQuery {
  constructor(
    private rows: Row[],
    private filters: Filter[] = [],
    private orders: Order[] = [],
    private lim?: number
  ) {}
  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.rows, [...this.filters, { field, op, value }], this.orders, this.lim);
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc"): FakeQuery {
    return new FakeQuery(this.rows, this.filters, [...this.orders, { field, dir }], this.lim);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this.rows, this.filters, this.orders, n);
  }
  async get() {
    let out = this.rows.filter((r) => this.filters.every((f) => applyFilter(r.data[f.field], f.op, f.value)));
    for (const o of this.orders) {
      out = [...out].sort((x, y) => {
        const xv = valueOf(x.data[o.field]);
        const yv = valueOf(y.data[o.field]);
        const cmp = xv < yv ? -1 : xv > yv ? 1 : 0;
        return o.dir === "desc" ? -cmp : cmp;
      });
    }
    if (this.lim != null) out = out.slice(0, this.lim);
    return {
      empty: out.length === 0,
      size: out.length,
      docs: out.map((r) => ({ id: r.id, exists: true, data: () => r.data })),
    };
  }
}

class FakeDocRef {
  constructor(private store: FakeFirestore, private collectionPath: string, public id: string) {}
  async get() {
    const data = this.store._get(this.collectionPath, this.id);
    return { exists: data !== undefined, id: this.id, data: () => data };
  }
  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this.store, `${this.collectionPath}/${this.id}/${name}`);
  }
  set(data: DocData, opts?: { merge?: boolean }) {
    if (opts?.merge) {
      const existing = this.store._get(this.collectionPath, this.id) ?? {};
      this.store._write(this.collectionPath, this.id, { ...existing, ...data }, "set");
    } else {
      this.store._write(this.collectionPath, this.id, data, "set");
    }
    return Promise.resolve();
  }
  update(data: DocData) {
    const existing = this.store._get(this.collectionPath, this.id) ?? {};
    this.store._write(this.collectionPath, this.id, { ...existing, ...data }, "update");
    return Promise.resolve();
  }
  delete() {
    this.store._write(this.collectionPath, this.id, undefined, "delete");
    return Promise.resolve();
  }
}

class FakeCollectionRef {
  constructor(private store: FakeFirestore, private path: string) {}
  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.store, this.path, id);
  }
  where(field: string, op: string, value: unknown): FakeQuery {
    return this.query().where(field, op, value);
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc"): FakeQuery {
    return this.query().orderBy(field, dir);
  }
  limit(n: number): FakeQuery {
    return this.query().limit(n);
  }
  get() {
    return this.query().get();
  }
  add(data: DocData) {
    const id = `auto_${this.store._nextId()}`;
    this.store._write(this.path, id, data, "add");
    return Promise.resolve(new FakeDocRef(this.store, this.path, id));
  }
  private query(): FakeQuery {
    return new FakeQuery(this.store._list(this.path));
  }
}

export class FakeFirestore {
  readonly writes: RecordedWrite[] = [];
  private data = new Map<string, Map<string, DocData>>();
  private counter = 0;

  /** Seed a document (does NOT count as a write). */
  seed(collectionPath: string, id: string, data: DocData): this {
    if (!this.data.has(collectionPath)) this.data.set(collectionPath, new Map());
    this.data.get(collectionPath)!.set(id, data);
    return this;
  }

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this, name);
  }

  /**
   * Minimal transaction shim — non-atomic (single-threaded tests), enough to drive
   * read-then-write claim logic. `tx.get/set/update/delete` proxy to the doc refs.
   */
  async runTransaction<T>(fn: (tx: {
    get: (ref: FakeDocRef) => Promise<{ exists: boolean; id: string; data: () => DocData | undefined }>;
    set: (ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }) => void;
    update: (ref: FakeDocRef, data: DocData) => void;
    delete: (ref: FakeDocRef) => void;
  }) => Promise<T>): Promise<T> {
    const tx = {
      get: (ref: FakeDocRef) => ref.get(),
      set: (ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }) => {
        void ref.set(data, opts);
      },
      update: (ref: FakeDocRef, data: DocData) => {
        void ref.update(data);
      },
      delete: (ref: FakeDocRef) => {
        void ref.delete();
      },
    };
    return fn(tx);
  }

  /** Collections that were written to, de-duplicated (top-level collection name). */
  writtenCollections(): string[] {
    return [...new Set(this.writes.map((w) => w.collection))];
  }

  // --- internals used by the fake refs ---
  _list(collectionPath: string): Row[] {
    const m = this.data.get(collectionPath);
    return m ? [...m.entries()].map(([id, data]) => ({ id, data })) : [];
  }
  _get(collectionPath: string, id: string): DocData | undefined {
    return this.data.get(collectionPath)?.get(id);
  }
  _write(collectionPath: string, id: string, data: DocData | undefined, op: WriteOp) {
    // Record the top-level collection (first path segment) for assertions.
    const topCollection = collectionPath.split("/")[0];
    this.writes.push({ collection: topCollection, path: `${collectionPath}/${id}`, op });
    if (op === "delete") {
      this.data.get(collectionPath)?.delete(id);
      return;
    }
    if (!this.data.has(collectionPath)) this.data.set(collectionPath, new Map());
    this.data.get(collectionPath)!.set(id, data ?? {});
  }
  _nextId(): number {
    return ++this.counter;
  }
}
