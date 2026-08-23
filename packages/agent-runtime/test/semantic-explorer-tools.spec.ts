import { describe, expect, it, vi } from "vitest";
import {
  createSemanticExplorerToolExecutor,
  SEMANTIC_EXPLORER_TOOL_DESCRIPTORS,
  SEMANTIC_EXPLORER_TOOL_NAMES,
  type SemanticExplorerToolService,
  ServerOwnedToolRegistry,
} from "../src/index.js";

describe("Semantic Explorer server-owned Agent tools", () => {
  it("registers a fixed read-only allowlist with network access denied", () => {
    const registry = new ServerOwnedToolRegistry(SEMANTIC_EXPLORER_TOOL_DESCRIPTORS);
    const resolved = registry.resolveAllowlist(Object.values(SEMANTIC_EXPLORER_TOOL_NAMES));

    expect(resolved).toHaveLength(7);
    expect(resolved.every((descriptor) => descriptor.tool_name.endsWith("@1"))).toBe(true);
    expect(resolved.every((descriptor) => descriptor.network_access.mode === "DENY")).toBe(true);
    const surface = JSON.stringify(
      resolved.map(({ tool_name, description }) => ({ tool_name, description })),
    ).toLocaleLowerCase("en-US");
    expect(surface).not.toMatch(/\b(sql|cypher|mutate|publish|rollback|delete|write)\b/);
  });

  it("parses the relationship DTO and delegates it unchanged to the shared service", async () => {
    const searchRelationships = vi.fn(async () => ({
      ok: true as const,
      value: { source: "NEO4J" },
    }));
    const unused = vi.fn(async () => ({ ok: true as const, value: null }));
    const service: SemanticExplorerToolService<{ readonly id: string }> = {
      listDomains: unused,
      getActive: unused,
      getRelease: unused,
      searchRelationships,
      getLineage: unused,
      diffReleases: unused,
      getCandidateComparison: unused,
    };
    const authority = { id: "server-authority" };
    const request = {
      schema_version: "semantic-relationship-search-request@1.0.0",
      semantic_domain: "revenue",
      release: { kind: "ACTIVE" },
      root: null,
      term: "revenue",
      categories: ["BIZ", "FORMULA"],
      direction: "both",
      hop_limit: 3,
      node_limit: 100,
      edge_limit: 200,
    } as const;

    const result = await createSemanticExplorerToolExecutor(service).execute(
      SEMANTIC_EXPLORER_TOOL_NAMES.searchRelationships,
      authority,
      request,
    );

    expect(result).toEqual({ ok: true, value: { source: "NEO4J" } });
    expect(searchRelationships).toHaveBeenCalledWith(authority, request);
  });

  it("rejects unregistered tool names without dispatching", async () => {
    const unused = vi.fn(async () => ({ ok: true as const, value: null }));
    const service: SemanticExplorerToolService<unknown> = {
      listDomains: unused,
      getActive: unused,
      getRelease: unused,
      searchRelationships: unused,
      getLineage: unused,
      diffReleases: unused,
      getCandidateComparison: unused,
    };

    await expect(
      createSemanticExplorerToolExecutor(service).execute("semantic_run_cypher", {}, {}),
    ).resolves.toMatchObject({ ok: false, error: { code: "MODEL_TOOL_NOT_REGISTERED" } });
    expect(unused).not.toHaveBeenCalled();
  });
});
