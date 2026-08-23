import type {
  SemanticApplicationAuthority,
  SemanticExplorerDomainSummary,
  SemanticExplorerPointerObservation,
  SemanticExplorerReadPort,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSemanticExplorerService } from "../src/application/explorer.js";

const pointer: SemanticExplorerPointerObservation = {
  current_release_id: null,
  current_release_generation: 0,
  current_release_digest: null,
  pointer_generation: 1,
  observed_at: "2026-08-09T00:00:00.000Z",
};

function domain(semanticDomain: string): SemanticExplorerDomainSummary {
  return {
    schema_version: "semantic-explorer-domain-summary@1.0.0",
    semantic_domain: semanticDomain,
    display_name: semanticDomain,
    description: null,
    datasource_id: "00000000-0000-4000-8000-000000000001",
    pointer_observation: pointer,
    has_current_release: false,
  };
}

describe("Semantic Explorer application service", () => {
  it("passes the authority allowlist to its port and filters an over-broad response", async () => {
    const listDomains = vi.fn(async () => ({
      ok: true as const,
      value: [domain("revenue"), domain("inventory")],
    }));
    const reader = {
      listDomains,
      getActiveSource: vi.fn(),
      getReleaseSource: vi.fn(),
      listReleases: vi.fn(),
      getCandidateComparison: vi.fn(),
    } as unknown as SemanticExplorerReadPort;
    const authority: SemanticApplicationAuthority = {
      authority: "POSTGRESQL",
      capabilityInput: { server: "capability" },
      scope: {
        appId: "00000000-0000-4000-8000-000000000002",
        tenantId: "00000000-0000-4000-8000-000000000003",
        environment: "test",
        semanticDomain: "all",
      },
      deploymentId: "00000000-0000-4000-8000-000000000004",
      principal: "00000000-0000-4000-8000-000000000005",
      semanticRole: "human-reviewer",
      allowedDomains: ["revenue"],
    };

    const result = await createSemanticExplorerService(reader).listDomains(authority);

    expect(listDomains).toHaveBeenCalledWith(authority.capabilityInput, ["revenue"]);
    expect(result).toEqual({ ok: true, value: [domain("revenue")] });
  });
});
