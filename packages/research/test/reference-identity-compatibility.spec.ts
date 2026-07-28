import {
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { computeResearchKernelHash, computeResearchKernelHashV2 } from "../src/internal/hash.js";
import {
  orderedDistinctReferencesV2,
  orderedUniqueReferences,
  uniqueReferences,
} from "../src/internal/reference-identity.js";

function makeReference(artifactId: string, revision = 1): ArtifactReference {
  return {
    app_id: "00000000-0000-4000-8000-000000000001",
    tenant_id: "00000000-0000-4000-8000-000000000002",
    environment: "test",
    run_id: "00000000-0000-4000-8000-000000000003",
    artifact_id: artifactId,
    artifact_type: "ResearchBrief",
    revision,
    content_hash: `sha256:${"b".repeat(64)}`,
  };
}

describe("Research v1/v2 compatibility facade", () => {
  it("保留 v1 finite float 与 undefined-field omission 语义", async () => {
    const value = {
      float: 1.5,
      omitted: undefined,
    };

    expect(canonicalizeJson(value)).toBe('{"float":1.5}');
    await expect(computeResearchKernelHash("compatibility@1", value)).resolves.toBe(
      await sha256ContentHash({
        hash_domain: "compatibility@1",
        value,
      }),
    );
  });

  it("由 research internal facade 暴露 strict v2 helper", async () => {
    await expect(computeResearchKernelHashV2("compatibility@2", 1)).resolves.toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    await expect(computeResearchKernelHashV2("compatibility@2", 1.5)).rejects.toThrow(TypeError);
  });

  it("保留 v1 Map 的首次 key 位置与 last-value-wins 行为", () => {
    const higher = makeReference("00000000-0000-4000-8000-000000000020");
    const lowerFirst = makeReference("00000000-0000-4000-8000-000000000010");
    const lowerLast = { ...lowerFirst };

    expect(uniqueReferences([lowerFirst, higher, lowerLast])).toEqual([lowerLast, higher]);
    expect(orderedUniqueReferences([higher, lowerFirst, lowerLast])).toEqual([lowerLast, higher]);
  });

  it("v2 facade 按 identity 排序并拒绝 duplicate", () => {
    const higher = makeReference("00000000-0000-4000-8000-000000000020");
    const lower = makeReference("00000000-0000-4000-8000-000000000010");

    expect(orderedDistinctReferencesV2([higher, lower]).map(artifactReferenceIdentity)).toEqual(
      [higher, lower].map(artifactReferenceIdentity).sort(),
    );
    expect(() => orderedDistinctReferencesV2([lower, { ...lower }])).toThrow(TypeError);
  });
});
