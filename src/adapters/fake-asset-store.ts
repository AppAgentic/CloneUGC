import { createHash } from "node:crypto";
import type { AssetPutResult, AssetStore } from "../kernel/adapters.ts";

/**
 * Content-addressed in-memory object store with task-scoped temporary prefixes and atomic
 * multi-object publication.
 */
export class FakeAssetStore implements AssetStore {
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly keys = new Map<string, { hash: string; workspaceId: string; provenance: string }>();
  public failNextPublish = false;

  put(content: Uint8Array | string, options: { workspaceId: string; prefix: string; provenance: string }): AssetPutResult {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!this.blobs.has(hash)) this.blobs.set(hash, Uint8Array.from(bytes));
    const key = `${options.prefix}/${hash}`;
    this.keys.set(key, { hash, workspaceId: options.workspaceId, provenance: options.provenance });
    return { hash, key, bytes: bytes.byteLength };
  }

  get(hash: string): Uint8Array | undefined {
    return this.blobs.get(hash);
  }

  has(hash: string): boolean {
    return this.blobs.has(hash);
  }

  keysUnder(prefix: string): string[] {
    return [...this.keys.keys()].filter((key) => key.startsWith(`${prefix}/`)).sort();
  }

  publishAtomically(input: { workspaceId: string; finalPrefix: string; entries: Array<{ name: string; hash: string }> }): void {
    for (const entry of input.entries) {
      if (!this.blobs.has(entry.hash)) throw new Error(`cannot publish missing asset ${entry.hash}`);
    }
    if (this.failNextPublish) {
      this.failNextPublish = false;
      throw new Error("simulated publish failure before any object was written");
    }
    const staged = input.entries.map((entry) => [`${input.finalPrefix}/${entry.name}`, { hash: entry.hash, workspaceId: input.workspaceId, provenance: "published" }] as const);
    for (const [key, value] of staged) this.keys.set(key, value);
  }

  deletePrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.keysUnder(prefix)) {
      this.keys.delete(key);
      removed += 1;
    }
    return removed;
  }
}
