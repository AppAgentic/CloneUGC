import type {
  AnalysisArtifactStore,
  AnalysisExecutionUnit,
  AnalysisRunLedger,
  AnalysisRunRecord,
  AnalyzerProvider,
  AnalyzerProviderResult,
} from "../analyzer-runner.ts";

export class FakeAnalyzerProvider implements AnalyzerProvider {
  calls: AnalysisExecutionUnit[] = [];
  private readonly response: (unit: AnalysisExecutionUnit) => AnalyzerProviderResult;
  constructor(response: (unit: AnalysisExecutionUnit) => AnalyzerProviderResult) {
    this.response = response;
  }
  async analyze(unit: AnalysisExecutionUnit): Promise<AnalyzerProviderResult> {
    this.calls.push(structuredClone(unit));
    return this.response(unit);
  }
}

export class MemoryAnalysisArtifactStore implements AnalysisArtifactStore {
  readonly entries = new Map<string, { bytes: Uint8Array; sha256: string; provenance: string }>();
  async putIfAbsent(input: { id: string; bytes: Uint8Array; sha256: string; provenance: string }): Promise<void> {
    const existing = this.entries.get(input.id);
    if (existing !== undefined && existing.sha256 !== input.sha256) throw new Error("artifact id hash conflict");
    if (existing === undefined) this.entries.set(input.id, { ...input, bytes: input.bytes.slice() });
  }
}

export class MemoryAnalysisRunLedger implements AnalysisRunLedger {
  readonly records = new Map<string, AnalysisRunRecord>();
  async get(unitId: string): Promise<AnalysisRunRecord | undefined> {
    return this.records.get(unitId);
  }
  async create(record: AnalysisRunRecord): Promise<void> {
    if (this.records.has(record.unitId)) throw new Error("analysis unit already exists");
    this.records.set(record.unitId, structuredClone(record));
  }
  async replace(record: AnalysisRunRecord): Promise<void> {
    if (!this.records.has(record.unitId)) throw new Error("analysis unit does not exist");
    this.records.set(record.unitId, structuredClone(record));
  }
}
