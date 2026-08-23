import {
  type SemanticApplicationAuthority,
  type SemanticExplorerCandidateComparison,
  type SemanticExplorerDiff,
  type SemanticExplorerDomainSummary,
  type SemanticExplorerLineage,
  type SemanticExplorerReleaseTimeline,
  type SemanticRelationshipSearchResult,
  semanticExplorerSnapshotSchema,
} from "@data-agent/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
});

import type { SemanticExplorerService } from "@data-agent/semantic/application";
import { NextRequest } from "next/server";
import type { SemanticAuthorityResolver } from "../src/lib/semantic-authority";
import {
  handleDiffExplorerReleases,
  handleGetActiveExplorerRelease,
  handleGetExplorerCandidateComparison,
  handleGetExplorerLineage,
  handleGetExplorerObject,
  handleGetExplorerRelease,
  handleListExplorerDomains,
  handleListExplorerReleases,
  handleSearchExplorerRelationships,
} from "../src/lib/semantic-explorer-route";
import type { SemanticExplorerRuntime } from "../src/lib/semantic-explorer-runtime";

const ids = {
  release: "00000000-0000-4000-8000-000000000101",
  datasource: "00000000-0000-4000-8000-000000000102",
  projection: "00000000-0000-4000-8000-000000000103",
  relationshipProjection: "00000000-0000-4000-8000-000000000104",
  restrictionProjection: "00000000-0000-4000-8000-000000000105",
  candidate: "00000000-0000-4000-8000-000000000106",
  revision: "00000000-0000-4000-8000-000000000107",
  sourceRevision: "00000000-0000-4000-8000-000000000108",
  baseRelease: "00000000-0000-4000-8000-000000000109",
} as const;

function enabledRuntime() {
  const authority: SemanticApplicationAuthority = {
    authority: "POSTGRESQL",
    capabilityInput: { server: "capability" },
    scope: {
      appId: "00000000-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000002",
      environment: "test",
      semanticDomain: "revenue",
    },
    deploymentId: "00000000-0000-4000-8000-000000000003",
    principal: "00000000-0000-4000-8000-000000000004",
    semanticRole: "human-reviewer",
    allowedDomains: ["revenue"],
  };
  const snapshot = semanticExplorerSnapshotSchema.parse({
    schema_version: "semantic-explorer-snapshot@1.0.0",
    authority: "POSTGRESQL",
    release_identity: {
      semantic_domain: "revenue",
      release_id: ids.release,
      release_generation: 1,
      release_digest: `sha256:${"d".repeat(64)}`,
      executable_projection: {
        projection_id: ids.projection,
        projection_digest: `sha256:${"a".repeat(64)}`,
      },
      relationship_projection: {
        projection_id: ids.relationshipProjection,
        projection_digest: `sha256:${"b".repeat(64)}`,
      },
      runtime_restriction_projection: {
        projection_id: ids.restrictionProjection,
        projection_digest: `sha256:${"c".repeat(64)}`,
      },
      published_at: "2026-08-09T00:00:00.000Z",
      published_by: "publisher",
    },
    pointer_observation: {
      current_release_id: ids.release,
      current_release_generation: 1,
      current_release_digest: `sha256:${"d".repeat(64)}`,
      pointer_generation: 2,
      observed_at: "2026-08-09T00:01:00.000Z",
    },
    is_active: true,
    capabilities: {
      business_ontology: false,
      physical_binding: false,
      catalog_governance: false,
    },
    objects: [
      {
        identity: { kind: "metric", object_id: "net_revenue" },
        status: "published",
        canonical_digest: `sha256:${"e".repeat(64)}`,
        name: "Net revenue",
        description: null,
        aliases: [],
        owner: null,
        restricted: false,
        payload: {
          kind: "metric",
          table_id: "orders",
          column_id: "net_revenue",
          aggregation: "sum",
          formula: null,
          grain: { grain_id: "order", granularity: "atomic", description: null },
          unit: null,
          time_domain: null,
          time_column_id: null,
          additivity: "additive",
          null_policy: "preserve",
          fanout_policy: "reject",
          dependency_column_ids: [],
          tags: [],
          bindings: [],
        },
      },
    ],
    edges: [],
    counts: {
      total_objects: 1,
      by_object_kind: {
        business_entity: 0,
        business_event: 0,
        business_term: 0,
        metric: 1,
        dimension: 0,
        relationship: 0,
        datasource: 0,
      },
      total_edges: 0,
      by_edge_kind: {
        metric_dependency: 0,
        dimension_hierarchy: 0,
        analytical_relationship: 0,
        business_relationship: 0,
        physical_binding: 0,
      },
    },
  });
  const domainSummary: SemanticExplorerDomainSummary = {
    schema_version: "semantic-explorer-domain-summary@1.0.0",
    semantic_domain: "revenue",
    display_name: "Revenue",
    description: null,
    datasource_id: ids.datasource,
    pointer_observation: snapshot.pointer_observation,
    has_current_release: true,
  };
  const timeline: SemanticExplorerReleaseTimeline = {
    schema_version: "semantic-explorer-release-timeline@1.0.0",
    semantic_domain: "revenue",
    pointer_observation: snapshot.pointer_observation,
    releases: [
      {
        schema_version: "semantic-explorer-release-summary@1.0.0",
        release_identity: snapshot.release_identity,
        candidate_id: ids.candidate,
        is_current_at_observation: true,
      },
    ],
    next_generation_cursor: null,
  };
  const diff: SemanticExplorerDiff = {
    schema_version: "semantic-explorer-diff@1.0.0",
    base_release: snapshot.release_identity,
    target_release: snapshot.release_identity,
    objects: { added: [], removed: [], changed: [] },
    edges: { added: [], removed: [], changed: [] },
  };
  const lineage: SemanticExplorerLineage = {
    schema_version: "semantic-explorer-lineage@1.0.0",
    release_identity: snapshot.release_identity,
    root: { kind: "metric", object_id: "net_revenue" },
    direction: "upstream",
    hop_limit: 4,
    nodes: snapshot.objects,
    edges: [],
    cycles_detected: false,
    truncated: false,
    truncation_reasons: [],
  };
  const comparison: SemanticExplorerCandidateComparison = {
    schema_version: "semantic-explorer-candidate-comparison@1.0.0",
    semantic_domain: "revenue",
    candidate_id: ids.candidate,
    revision_id: ids.revision,
    revision_number: 1,
    source_revision_id: ids.sourceRevision,
    candidate_status: "DRAFT",
    base_release: snapshot.release_identity,
    compared_release: snapshot.release_identity,
    comparison_state: { state: "candidate", reason_code: null },
    diff: {
      schema_version: "semantic-diff@1.0.0",
      summary: "Candidate change",
      operations: [
        {
          path: "metrics.net_revenue",
          change_type: "MODIFY",
          before: "current",
          after: "changed",
        },
      ],
    },
  };
  const relationshipResult: SemanticRelationshipSearchResult = {
    schema_version: "semantic-relationship-search-result@1.0.0",
    release_identity: snapshot.release_identity,
    pointer_observation: snapshot.pointer_observation,
    is_active: true,
    source: "POSTGRESQL_FALLBACK",
    index_state: "DISABLED",
    index_reason_code: "INDEX_DISABLED",
    manifest_digest: `sha256:${"f".repeat(64)}`,
    root: null,
    term: null,
    categories: ["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"],
    nodes: [],
    edges: [],
    truncated: false,
    truncation_reasons: [],
    explanation: {
      summary: "PostgreSQL fallback exact release relationship search.",
      requested_hop_limit: 3,
      traversed_hops: 0,
      categories: ["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"],
      authority_revalidated: true,
      fallback_reason: "INDEX_DISABLED",
    },
  };
  const listDomains = vi.fn<SemanticExplorerService["listDomains"]>(async () => ({
    ok: true as const,
    value: [domainSummary],
  }));
  const getActive = vi.fn<SemanticExplorerService["getActive"]>(async () => ({
    ok: true as const,
    value: snapshot,
  }));
  const getObject = vi.fn<SemanticExplorerService["getObject"]>(async () => ({
    ok: false as const,
    error: {
      code: "SEMANTIC_EXPLORER_OBJECT_NOT_VISIBLE",
      message: "当前 Authority 不允许读取该语义对象。",
      retryable: false,
    },
  }));
  const service: SemanticExplorerService = {
    listDomains,
    getActive,
    getRelease: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    listReleases: vi.fn(async () => ({ ok: true as const, value: timeline })),
    diffReleases: vi.fn(async () => ({ ok: true as const, value: diff })),
    getObject,
    getLineage: vi.fn(async () => ({ ok: true as const, value: lineage })),
    getCandidateComparison: vi.fn(async () => ({ ok: true as const, value: comparison })),
    searchRelationships: vi.fn(async () => ({ ok: true as const, value: relationshipResult })),
  };
  const authorityResolver: SemanticAuthorityResolver = {
    resolve: vi.fn(async () => authority),
  };
  const value: Extract<SemanticExplorerRuntime, { enabled: true }> = {
    enabled: true as const,
    authorityResolver,
    service,
  };
  return { value, authority, service, listDomains, getActive, getObject };
}

describe("Semantic Explorer routes", () => {
  it("returns no-store active data using only server-resolved authority", async () => {
    const test = enabledRuntime();
    const response = await handleGetActiveExplorerRelease(
      new NextRequest("http://localhost/api/semantic/releases/active?domain=revenue"),
      test.value,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(test.value.authorityResolver.resolve).toHaveBeenCalledWith({
      access: "READ",
      semanticDomain: "revenue",
    });
    expect(test.getActive).toHaveBeenCalledWith(test.authority, "revenue");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        release_identity: { release_id: ids.release },
        pointer_observation: { pointer_generation: 2 },
      },
      meta: { authority: "POSTGRESQL" },
    });
  });

  it("routes the strict relationship DTO through the same service and authority", async () => {
    const test = enabledRuntime();
    const request = {
      schema_version: "semantic-relationship-search-request@1.0.0",
      semantic_domain: "revenue",
      release: { kind: "ACTIVE" },
      root: null,
      term: null,
      categories: ["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"],
      direction: "both",
      hop_limit: 3,
      node_limit: 250,
      edge_limit: 500,
    } as const;
    const response = await handleSearchExplorerRelationships(
      new NextRequest("http://localhost/api/semantic/relationships/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      test.value,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(test.service.searchRelationships).toHaveBeenCalledWith(test.authority, request);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        schema_version: "semantic-relationship-search-result@1.0.0",
        source: "POSTGRESQL_FALLBACK",
      },
      meta: { authority: "POSTGRESQL" },
    });
  });

  it.each([
    { operation: "release" as const, schemaVersion: "semantic-explorer-snapshot@1.0.0" },
    { operation: "timeline" as const, schemaVersion: "semantic-explorer-release-timeline@1.0.0" },
    { operation: "diff" as const, schemaVersion: "semantic-explorer-diff@1.0.0" },
    { operation: "lineage" as const, schemaVersion: "semantic-explorer-lineage@1.0.0" },
    {
      operation: "candidate" as const,
      schemaVersion: "semantic-explorer-candidate-comparison@1.0.0",
    },
  ])("routes exact $operation reads through the typed service", async (testCase) => {
    const test = enabledRuntime();
    let response: Response | null = null;
    switch (testCase.operation) {
      case "release":
        response = await handleGetExplorerRelease(
          new NextRequest(`http://localhost/api/semantic/releases/${ids.release}?domain=revenue`),
          Promise.resolve({ releaseId: ids.release }),
          test.value,
        );
        expect(test.service.getRelease).toHaveBeenCalledWith(
          test.authority,
          "revenue",
          ids.release,
        );
        break;
      case "timeline":
        response = await handleListExplorerReleases(
          new NextRequest(
            "http://localhost/api/semantic/releases?domain=revenue&limit=25&cursor=3",
          ),
          test.value,
        );
        expect(test.service.listReleases).toHaveBeenCalledWith(test.authority, "revenue", 25, 3);
        break;
      case "diff":
        response = await handleDiffExplorerReleases(
          new NextRequest(
            `http://localhost/api/semantic/releases/${ids.release}/diff?domain=revenue&base=${ids.baseRelease}`,
          ),
          Promise.resolve({ releaseId: ids.release }),
          test.value,
        );
        expect(test.service.diffReleases).toHaveBeenCalledWith(
          test.authority,
          "revenue",
          ids.baseRelease,
          ids.release,
        );
        break;
      case "lineage":
        response = await handleGetExplorerLineage(
          new NextRequest(
            `http://localhost/api/semantic/objects/net_revenue/lineage?domain=revenue&kind=metric&releaseId=${ids.release}&direction=upstream&hops=4`,
          ),
          Promise.resolve({ objectId: "net_revenue" }),
          test.value,
        );
        expect(test.service.getLineage).toHaveBeenCalledWith(test.authority, {
          semantic_domain: "revenue",
          release_id: ids.release,
          root: { kind: "metric", object_id: "net_revenue" },
          direction: "upstream",
          hop_limit: 4,
        });
        break;
      case "candidate":
        response = await handleGetExplorerCandidateComparison(
          new NextRequest(
            `http://localhost/api/semantic/candidates/${ids.candidate}/comparison?domain=revenue&revisionId=${ids.revision}`,
          ),
          Promise.resolve({ candidateId: ids.candidate }),
          test.value,
        );
        expect(test.service.getCandidateComparison).toHaveBeenCalledWith(
          test.authority,
          "revenue",
          ids.candidate,
          ids.revision,
        );
        break;
    }

    if (!response) throw new Error("Explorer route case did not produce a response.");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      data: { schema_version: testCase.schemaVersion },
      meta: { authority: "POSTGRESQL" },
    });
  });

  it("rejects client-supplied scope fields before resolving authority", async () => {
    const test = enabledRuntime();
    const response = await handleGetActiveExplorerRelease(
      new NextRequest(
        "http://localhost/api/semantic/releases/active?domain=revenue&tenantId=attacker",
      ),
      test.value,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("SEMANTIC_EXPLORER_INVALID_PARAMS");
    expect(test.value.authorityResolver.resolve).not.toHaveBeenCalled();
    expect(test.getActive).not.toHaveBeenCalled();
  });

  it("uses the same permission response for missing and invisible objects", async () => {
    const test = enabledRuntime();
    const response = await handleGetExplorerObject(
      new NextRequest(
        `http://localhost/api/semantic/objects/net_revenue?domain=revenue&kind=metric&releaseId=${ids.release}`,
      ),
      Promise.resolve({ objectId: "net_revenue" }),
      test.value,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SEMANTIC_EXPLORER_OBJECT_NOT_VISIBLE",
        message: "当前 Authority 不允许读取该语义对象。",
        retryable: false,
      },
    });
  });

  it("maps unknown internal service errors to the public unavailable contract", async () => {
    const test = enabledRuntime();
    vi.mocked(test.service.getActive).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "INTERNAL_DATABASE_SECRET",
        message: "password and table detail must not escape",
        retryable: false,
      },
    });

    const response = await handleGetActiveExplorerRelease(
      new NextRequest("http://localhost/api/semantic/releases/active?domain=revenue"),
      test.value,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "SEMANTIC_EXPLORER_UNAVAILABLE",
        message: "语义 Explorer 暂时不可用。",
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("fails closed with a no-store response while the feature flag is disabled", async () => {
    const response = await handleListExplorerDomains({ enabled: false });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SEMANTIC_EXPLORER_DISABLED", retryable: false },
    });
  });
});
