import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AnalysisArtifactStore,
  AnalysisRunLedger,
  AnalysisRunRecord,
} from "../analyzer-runner.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

async function durableWriteNew(path: string, bytes: Uint8Array): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
    await syncDirectory(dirname(path));
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function durableReplace(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function encodeJSON(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function assertRecord(record: AnalysisRunRecord): void {
  assert(/^analysis-[a-f0-9]{24}$/.test(record.unitId), "invalid analysis unit id");
  assert(/^[a-f0-9]{64}$/.test(record.unitHash), "invalid analysis unit hash");
  assert(record.status === "running" || record.status === "succeeded" || record.status === "failed", "invalid analysis run status");
}

export class FileAnalysisArtifactStore implements AnalysisArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    assert(root.trim().length > 0, "analysis artifact root is required");
    this.root = root;
  }

  async putIfAbsent(input: { id: string; bytes: Uint8Array; sha256: string; provenance: string }): Promise<void> {
    const match = /^analysis\/(raw|structured)\/([a-f0-9]{64})$/.exec(input.id);
    assert(match !== null, "invalid analysis artifact id");
    assert(match[2] === input.sha256 && sha256(input.bytes) === input.sha256, "analysis artifact hash does not match its bytes");
    assert(/^[a-f0-9]{64}$/.test(input.provenance), "analysis artifact provenance must be a SHA-256 hash");
    const path = join(this.root, match[1]!, `${input.sha256}.bin`);
    if (!await durableWriteNew(path, input.bytes)) {
      const existing = await readFile(path);
      assert(sha256(existing) === input.sha256, "existing analysis artifact is corrupt or conflicts");
    }
    const receipt = encodeJSON({ schemaVersion: "0.1.0", id: input.id, sha256: input.sha256, provenance: input.provenance });
    const receiptPath = join(this.root, match[1]!, `${input.sha256}.provenance`, `${input.provenance}.json`);
    if (!await durableWriteNew(receiptPath, receipt)) {
      assert(Buffer.from(await readFile(receiptPath)).equals(Buffer.from(receipt)), "existing analysis artifact provenance conflicts");
    }
  }
}

export class FileAnalysisRunLedger implements AnalysisRunLedger {
  private readonly root: string;

  constructor(root: string) {
    assert(root.trim().length > 0, "analysis ledger root is required");
    this.root = root;
  }

  private path(unitId: string): string {
    assert(/^analysis-[a-f0-9]{24}$/.test(unitId), "invalid analysis unit id");
    return join(this.root, `${unitId}.json`);
  }

  async get(unitId: string): Promise<AnalysisRunRecord | undefined> {
    const path = this.path(unitId);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    let record: AnalysisRunRecord;
    try {
      record = JSON.parse(new TextDecoder().decode(bytes)) as AnalysisRunRecord;
    } catch {
      throw new Error(`analysis ledger record ${unitId} is corrupt; reconcile instead of resubmitting`);
    }
    assertRecord(record);
    assert(record.unitId === unitId, "analysis ledger filename does not match record unit id");
    return record;
  }

  async create(record: AnalysisRunRecord): Promise<void> {
    assertRecord(record);
    assert(record.status === "running", "new analysis ledger record must be running");
    if (!await durableWriteNew(this.path(record.unitId), encodeJSON(record))) {
      throw new Error(`analysis unit ${record.unitId} already exists`);
    }
  }

  async replace(record: AnalysisRunRecord): Promise<void> {
    assertRecord(record);
    const path = this.path(record.unitId);
    const existing = await this.get(record.unitId);
    assert(existing !== undefined, "analysis unit does not exist");
    assert(existing.unitHash === record.unitHash, "analysis unit hash cannot change");
    assert(existing.status === "running", "terminal analysis ledger records are immutable");
    assert(record.status === "succeeded" || record.status === "failed", "analysis replacement must be terminal");
    await durableReplace(path, encodeJSON(record));
  }
}
