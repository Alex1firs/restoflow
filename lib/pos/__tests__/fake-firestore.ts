/**
 * Fake Firestore for the POS idempotency tests.
 *
 * Unlike the minimal shim in lib/ai/__tests__, this one models the two things
 * the idempotency guarantee actually depends on:
 *
 *  1. Optimistic concurrency. Every document carries a version. A transaction
 *     records the version of each document it reads and buffers its writes; at
 *     commit time, if any document it read has changed, the attempt is aborted
 *     and the whole transaction function re-runs — exactly what the Firestore
 *     SDK does on contention.
 *  2. `create` semantics. A buffered `create` whose document exists at commit
 *     time fails with an ALREADY_EXISTS error instead of overwriting.
 *
 * `get` awaits a microtask before returning, so two transactions started
 * together with `Promise.all` deterministically both read before either
 * commits. That is what makes the concurrency tests real races rather than
 * sequential calls dressed up as concurrent ones.
 */

export type DocData = Record<string, unknown>;

export class AlreadyExistsError extends Error {
  readonly code = 6; // grpc ALREADY_EXISTS, as firebase-admin surfaces it
  constructor(path: string) {
    super(`ALREADY_EXISTS: document already exists: ${path}`);
    this.name = "AlreadyExistsError";
  }
}

interface Stored {
  data: DocData;
  version: number;
}

export interface FakeTransaction {
  get(ref: FakeDocRef): Promise<{ exists: boolean; id: string; data(): DocData | undefined }>;
  set(ref: FakeDocRef, data: DocData): void;
  create(ref: FakeDocRef, data: DocData): void;
  update(ref: FakeDocRef, data: DocData): void;
}

type PendingWrite =
  | { op: "set"; path: string; data: DocData }
  | { op: "create"; path: string; data: DocData }
  | { op: "update"; path: string; data: DocData };

class FakeDocRef {
  constructor(
    readonly store: FakeFirestore,
    readonly collectionPath: string,
    readonly id: string
  ) {}
  get path(): string {
    return `${this.collectionPath}/${this.id}`;
  }
  async get() {
    return this.store._snapshot(this.path, this.id);
  }
}

class FakeQuery {
  private filters: Array<[string, string, unknown]> = [];
  private max: number | null = null;
  constructor(private store: FakeFirestore, private collectionPath: string) {}
  where(field: string, op: string, value: unknown): FakeQuery {
    this.filters.push([field, op, value]);
    return this;
  }
  limit(n: number): FakeQuery {
    this.max = n;
    return this;
  }
  async get() {
    let rows = this.store._list(this.collectionPath);
    for (const [field, op, value] of this.filters) {
      rows = rows.filter(({ data }) => (op === "==" ? data[field] === value : true));
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    return {
      empty: rows.length === 0,
      size: rows.length,
      docs: rows.map(({ id, data }) => ({ exists: true, id, data: () => data })),
    };
  }
}

class FakeCollectionRef {
  constructor(private store: FakeFirestore, private path: string) {}
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.store, this.path, id ?? this.store._autoId());
  }
  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.store, this.path).where(field, op, value);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this.store, this.path).limit(n);
  }
  get() {
    return new FakeQuery(this.store, this.path).get();
  }
}

export class FakeFirestore {
  /** Every committed write, for side-effect assertions. */
  readonly commits: Array<{ op: string; path: string }> = [];
  /** How many times a transaction function was re-run because of contention. */
  retries = 0;

  private data = new Map<string, Map<string, Stored>>();
  private autoIdCounter = 0;
  private versionClock = 0;

  seed(collectionPath: string, id: string, data: DocData): this {
    this.getCollection(collectionPath).set(id, { data, version: ++this.versionClock });
    return this;
  }

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this, name);
  }

  /** Documents currently in a collection. */
  docsIn(collectionPath: string): Array<{ id: string; data: DocData }> {
    return this._list(collectionPath);
  }

  countIn(collectionPath: string): number {
    return this._list(collectionPath).length;
  }

  /**
   * Removes a document out of band, without going through a transaction — used
   * to simulate data disappearing behind the system's back (manual deletion, a
   * bad migration) so the claim-with-no-order integrity path can be exercised.
   */
  hardDelete(collectionPath: string, id: string): void {
    this.getCollection(collectionPath).delete(id);
    this.versionClock++;
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const MAX_ATTEMPTS = 6;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const reads = new Map<string, number>();
      const writes: PendingWrite[] = [];

      const tx = {
        get: async (ref: FakeDocRef) => {
          // Yield, so concurrent transactions interleave their reads.
          await Promise.resolve();
          const current = this.rawGet(ref.path);
          reads.set(ref.path, current?.version ?? 0);
          return this._snapshot(ref.path, ref.id);
        },
        set: (ref: FakeDocRef, data: DocData) => {
          writes.push({ op: "set", path: ref.path, data });
        },
        create: (ref: FakeDocRef, data: DocData) => {
          writes.push({ op: "create", path: ref.path, data });
        },
        update: (ref: FakeDocRef, data: DocData) => {
          writes.push({ op: "update", path: ref.path, data });
        },
      };

      const result = await fn(tx);

      // Yield once more so a competing transaction that read at the same time
      // gets the chance to commit first on at least one interleaving.
      await Promise.resolve();

      // Commit check 1: contention on anything we read.
      let stale = false;
      for (const [path, versionAtRead] of reads) {
        const current = this.rawGet(path);
        if ((current?.version ?? 0) !== versionAtRead) {
          stale = true;
          break;
        }
      }
      if (stale) {
        this.retries++;
        continue; // abort and re-run, exactly like the real SDK
      }

      // Commit check 2: `create` onto an existing document.
      for (const write of writes) {
        if (write.op === "create" && this.rawGet(write.path)) {
          throw new AlreadyExistsError(write.path);
        }
      }

      for (const write of writes) {
        const [collectionPath, id] = splitPath(write.path);
        const existing = this.getCollection(collectionPath).get(id);
        const nextData =
          write.op === "update" ? { ...(existing?.data ?? {}), ...write.data } : write.data;
        this.getCollection(collectionPath).set(id, {
          data: nextData,
          version: ++this.versionClock,
        });
        this.commits.push({ op: write.op, path: write.path });
      }

      return result;
    }

    throw new Error("Transaction failed: too much contention");
  }

  // ── internals ──────────────────────────────────────────────────────────────

  _snapshot(path: string, id: string) {
    const stored = this.rawGet(path);
    return {
      exists: stored !== undefined,
      id,
      data: () => (stored ? { ...stored.data } : undefined),
    };
  }

  _list(collectionPath: string): Array<{ id: string; data: DocData }> {
    const m = this.data.get(collectionPath);
    return m ? [...m.entries()].map(([id, stored]) => ({ id, data: stored.data })) : [];
  }

  _autoId(): string {
    return `auto_${++this.autoIdCounter}`;
  }

  private rawGet(path: string): Stored | undefined {
    const [collectionPath, id] = splitPath(path);
    return this.data.get(collectionPath)?.get(id);
  }

  private getCollection(collectionPath: string): Map<string, Stored> {
    if (!this.data.has(collectionPath)) this.data.set(collectionPath, new Map());
    return this.data.get(collectionPath)!;
  }
}

function splitPath(path: string): [string, string] {
  const idx = path.lastIndexOf("/");
  return [path.slice(0, idx), path.slice(idx + 1)];
}
