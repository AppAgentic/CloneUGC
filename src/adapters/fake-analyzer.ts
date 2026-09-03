import { assertEvidenceArtifact, assertFidelityMap, type EvidenceArtifact, type EvidenceClaim, type FidelityMap } from "../contracts.ts";
import type { AnalyzerAdapter } from "../kernel/adapters.ts";

export interface AnalyzerFixture {
  artifacts: EvidenceArtifact[];
  evidence: EvidenceClaim[];
  map: FidelityMap;
}

/** Serves validator-accepted Fidelity Maps by source hash without any provider call. */
export class FakeAnalyzer implements AnalyzerAdapter {
  private readonly fixtures = new Map<string, AnalyzerFixture>();

  register(fixture: AnalyzerFixture): void {
    fixture.artifacts.forEach(assertEvidenceArtifact);
    assertFidelityMap(fixture.map, fixture.evidence);
    this.fixtures.set(fixture.map.sourceContentSha256, fixture);
  }

  analyze(sourceContentSha256: string): AnalyzerFixture | undefined {
    const fixture = this.fixtures.get(sourceContentSha256);
    return fixture === undefined ? undefined : structuredClone(fixture);
  }
}
