import { describe, expect, it } from "vitest";
import {
  semanticExplorerCandidateComparisonSchema,
  semanticExplorerSnapshotSchema,
} from "../src/artifacts/semantic-explorer.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

const metricIdentity = { kind: "metric", object_id: "shared-id" } as const;
const dimensionIdentity = { kind: "dimension", object_id: "shared-id" } as const;

function metricObject(identity = metricIdentity) {
  return {
    identity,
    status: "published",
    canonical_digest: hash("a"),
    name: "Revenue",
    description: null,
    aliases: ["sales"],
    owner: null,
    restricted: false,
    payload: {
      kind: "metric",
      table_id: "orders",
      column_id: "orders.amount",
      aggregation: "sum",
      formula: null,
      grain: { grain_id: "day", description: null, granularity: "day" },
      unit: null,
      time_domain: null,
      time_column_id: null,
      additivity: "additive",
      null_policy: "coalesce-zero",
      fanout_policy: "preaggregate",
      dependency_column_ids: ["orders.amount"],
      tags: [],
      bindings: [],
    },
  };
}

function dimensionObject() {
  return {
    identity: dimensionIdentity,
    status: "published",
    canonical_digest: hash("b"),
    name: "Region",
    description: null,
    aliases: [],
    owner: null,
    restricted: false,
    payload: {
      kind: "dimension",
      table_id: "customers",
      column_id: "customers.region",
      grain: { grain_id: "row", description: null, granularity: "atomic" },
      data_type: "text",
      sensitivity: "PUBLIC",
      hierarchical: false,
      parent_dimension_id: null,
      tags: [],
      bindings: [],
    },
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "semantic-explorer-snapshot@1.0.0",
    authority: "POSTGRESQL",
    release_identity: {
      semantic_domain: "sales",
      release_id: "00000000-0000-4000-8000-000000000001",
      release_generation: 7,
      release_digest: hash("c"),
      executable_projection: {
        projection_id: "00000000-0000-4000-8000-000000000002",
        projection_digest: hash("d"),
      },
      relationship_projection: {
        projection_id: "00000000-0000-4000-8000-000000000003",
        projection_digest: hash("e"),
      },
      runtime_restriction_projection: {
        projection_id: "00000000-0000-4000-8000-000000000004",
        projection_digest: hash("f"),
      },
      published_at: "2026-08-09T00:00:00.000Z",
      published_by: "reviewer@example.com",
    },
    pointer_observation: {
      current_release_id: "00000000-0000-4000-8000-000000000001",
      current_release_generation: 7,
      current_release_digest: hash("c"),
      pointer_generation: 11,
      observed_at: "2026-08-09T00:01:00.000Z",
    },
    is_active: true,
    capabilities: {
      business_ontology: false,
      physical_binding: false,
      catalog_governance: false,
    },
    objects: [metricObject(), dimensionObject()],
    edges: [
      {
        edge_id: "metric:shared-id->dimension:shared-id",
        kind: "metric_dependency",
        source: metricIdentity,
        target: dimensionIdentity,
        canonical_digest: hash("1"),
        payload: { kind: "metric_dependency", formula_id: null },
      },
    ],
    counts: {
      total_objects: 2,
      by_object_kind: {
        business_entity: 0,
        business_event: 0,
        business_term: 0,
        metric: 1,
        dimension: 1,
        relationship: 0,
        datasource: 0,
      },
      total_edges: 1,
      by_edge_kind: {
        metric_dependency: 1,
        dimension_hierarchy: 0,
        analytical_relationship: 0,
        business_relationship: 0,
        physical_binding: 0,
      },
    },
    ...overrides,
  };
}

describe("SemanticExplorerSnapshot contract", () => {
  it("keeps cross-kind equal object IDs distinct", () => {
    expect(semanticExplorerSnapshotSchema.parse(snapshot()).objects).toHaveLength(2);
  });

  it("fails closed on a same-kind duplicate identity", () => {
    const duplicate = metricObject();
    expect(() =>
      semanticExplorerSnapshotSchema.parse(
        snapshot({ objects: [metricObject(), duplicate, dimensionObject()] }),
      ),
    ).toThrow();
  });

  it("fails closed on dangling edges", () => {
    const dangling = snapshot();
    const input = {
      ...dangling,
      objects: [metricObject()],
    };
    expect(() => semanticExplorerSnapshotSchema.parse(input)).toThrow();
  });

  it("rejects unknown payload fields", () => {
    expect(() =>
      semanticExplorerSnapshotSchema.parse({ ...snapshot(), leaked_sql: "select secret" }),
    ).toThrow();
  });

  it("keeps candidate and stale outside active object status", () => {
    const activeWithCandidate = snapshot({
      objects: [{ ...metricObject(), status: "candidate" }],
      edges: [],
    });
    expect(() => semanticExplorerSnapshotSchema.parse(activeWithCandidate)).toThrow();

    const comparison = {
      schema_version: "semantic-explorer-candidate-comparison@1.0.0",
      semantic_domain: "sales",
      candidate_id: "00000000-0000-4000-8000-000000000010",
      revision_id: "00000000-0000-4000-8000-000000000011",
      revision_number: 2,
      source_revision_id: "00000000-0000-4000-8000-000000000012",
      candidate_status: "STALE_REBASE_REQUIRED",
      base_release: snapshot().release_identity,
      compared_release: snapshot().release_identity,
      comparison_state: {
        state: "stale",
        reason_code: "CANDIDATE_GOVERNANCE_STALE",
      },
      diff: {
        schema_version: "semantic-diff@1.0.0",
        summary: "Rename revenue metric",
        operations: [
          {
            path: "metrics.metric-revenue.name",
            change_type: "MODIFY",
            before: "Revenue",
            after: "Net revenue",
          },
        ],
      },
    };
    expect(semanticExplorerCandidateComparisonSchema.parse(comparison).comparison_state.state).toBe(
      "stale",
    );
  });
});
