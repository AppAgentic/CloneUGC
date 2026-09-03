/**
 * In-memory durable document store with Firestore-like transactional semantics.
 *
 * Documents are versioned. A transaction records every read version, buffers writes, and commits
 * atomically only if nothing it read has changed. Chaos hooks let tests inject crashes before or
 * after a commit to emulate process death, lost responses, and duplicate delivery.
 */

export class ConflictError extends Error {
  override name = "ConflictError";
}

export class SimulatedCrash extends Error {
  override name = "SimulatedCrash";
}

interface StoredDocument {
  version: number;
  data: unknown;
}

type WriteOp = { kind: "set"; data: unknown } | { kind: "delete" };

export interface ChaosHooks {
  /** Called with the keys about to be written; throwing aborts the commit (nothing persists). */
  beforeCommit?: (keys: string[]) => void;
  /** Called after the commit persisted; throwing makes the caller believe the commit failed. */
  afterCommit?: (keys: string[]) => void;
}

export interface Transaction {
  get<T>(collection: string, id: string): T | undefined;
  list<T>(collection: string): Array<{ id: string; data: T }>;
  set<T>(collection: string, id: string, data: T): void;
  delete(collection: string, id: string): void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore {
  private readonly documents = new Map<string, StoredDocument>();
  private inTransaction = false;
  public commits = 0;
  public chaos: ChaosHooks = {};

  private static key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  get<T>(collection: string, id: string): T | undefined {
    const document = this.documents.get(MemoryStore.key(collection, id));
    return document === undefined ? undefined : clone(document.data as T);
  }

  list<T>(collection: string): Array<{ id: string; data: T }> {
    const prefix = `${collection}/`;
    const result: Array<{ id: string; data: T }> = [];
    for (const [key, document] of this.documents) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
        result.push({ id: key.slice(prefix.length), data: clone(document.data as T) });
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  count(collection: string): number {
    return this.list(collection).length;
  }

  transaction<T>(fn: (tx: Transaction) => T): T {
    if (this.inTransaction) throw new Error("nested transactions are not supported");
    this.inTransaction = true;
    const reads = new Map<string, number>();
    const writes = new Map<string, WriteOp>();
    const documents = this.documents;
    const recordRead = (key: string): void => {
      if (!reads.has(key)) reads.set(key, documents.get(key)?.version ?? 0);
    };
    const tx: Transaction = {
      get: <V>(collection: string, id: string): V | undefined => {
        const key = MemoryStore.key(collection, id);
        const pending = writes.get(key);
        if (pending !== undefined) return pending.kind === "set" ? clone(pending.data as V) : undefined;
        recordRead(key);
        const document = documents.get(key);
        return document === undefined ? undefined : clone(document.data as V);
      },
      list: <V>(collection: string): Array<{ id: string; data: V }> => {
        const prefix = `${collection}/`;
        const result = new Map<string, V>();
        for (const [key, document] of documents) {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
            recordRead(key);
            result.set(key.slice(prefix.length), clone(document.data as V));
          }
        }
        for (const [key, op] of writes) {
          if (!key.startsWith(prefix)) continue;
          const id = key.slice(prefix.length);
          if (op.kind === "delete") result.delete(id);
          else result.set(id, clone(op.data as V));
        }
        return [...result.entries()].map(([id, data]) => ({ id, data })).sort((a, b) => a.id.localeCompare(b.id));
      },
      set: (collection, id, data) => {
        writes.set(MemoryStore.key(collection, id), { kind: "set", data: clone(data) });
      },
      delete: (collection, id) => {
        writes.set(MemoryStore.key(collection, id), { kind: "delete" });
      },
    };
    try {
      const result = fn(tx);
      for (const [key, version] of reads) {
        const current = documents.get(key)?.version ?? 0;
        if (current !== version) throw new ConflictError(`document ${key} changed during the transaction`);
      }
      const keys = [...writes.keys()].sort();
      this.chaos.beforeCommit?.(keys);
      for (const [key, op] of writes) {
        if (op.kind === "delete") {
          documents.delete(key);
        } else {
          const version = (documents.get(key)?.version ?? 0) + 1;
          documents.set(key, { version, data: op.data });
        }
      }
      this.commits += 1;
      this.chaos.afterCommit?.(keys);
      return result;
    } finally {
      this.inTransaction = false;
    }
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, document] of [...this.documents.entries()].sort(([a], [b]) => a.localeCompare(b))) result[key] = clone(document.data);
    return result;
  }
}

export interface Clock {
  nowMs(): number;
}

export class ManualClock implements Clock {
  private current: number;

  constructor(initialMs = 1_000) {
    this.current = initialMs;
  }

  nowMs(): number {
    return this.current;
  }

  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }
}

export class SequentialIds {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const value = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, value);
    return `${prefix}_${String(value).padStart(4, "0")}`;
  }
}
