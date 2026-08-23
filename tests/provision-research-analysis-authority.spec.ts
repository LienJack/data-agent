import { describe, expect, it } from "vitest";
import {
  buildResearchAnalysisAuthorityManifestBody,
  researchAnalysisAuthorityManifestHash,
} from "../scripts/provision-research-analysis-authority.js";

describe("Research Analysis Authority manifest", () => {
  it("builds the fixed worker profile and hashes it deterministically", () => {
    const input = {
      manifest_id: "39000000-0000-4000-8000-000000000001",
      tenant_id: "39000000-0000-4000-8000-000000000002",
      environment: "local",
      principal_id: "39000000-0000-4000-8000-000000000003",
      deployment_id: "39000000-0000-4000-8000-000000000004",
      membership_role: "owner" as const,
      expires_at: "2026-08-25T12:00:00.000Z",
    };
    const first = buildResearchAnalysisAuthorityManifestBody(input);
    const second = buildResearchAnalysisAuthorityManifestBody(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      protocol_version: "u6-authority-manifest@1.0.0",
      profile: "RESEARCH_ANALYSIS_WORKER",
      membership_role: "OWNER",
    });
    expect(researchAnalysisAuthorityManifestHash(first)).toBe(
      researchAnalysisAuthorityManifestHash(second),
    );
    expect(researchAnalysisAuthorityManifestHash(first)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      researchAnalysisAuthorityManifestHash({ ...first, expires_at: "2026-08-26T12:00:00.000Z" }),
    ).not.toBe(researchAnalysisAuthorityManifestHash(first));
  });
});
