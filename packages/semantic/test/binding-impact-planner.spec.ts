import {
  buildSemanticBindingImpactAuthorityBundle,
  type SemanticBindingImpactAuthorityBundle,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { planSemanticBindingImpact } from "../src/induction/binding-impact-planner.js";
import { collectTransitiveDependents } from "../src/induction/impact-planner.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const DATASOURCE_ID = "10000000-0000-4000-8000-000000000002";
const DRIFT_ID = "10000000-0000-4000-8000-000000000003";
const RELEASE_ID = "10000000-0000-4000-8000-000000000004";
const NAMESPACE_ID = "10000000-0000-4000-8000-000000000005";
const PACKAGE_ID = "10000000-0000-4000-8000-000000000006";
const MAPPING_ID = "20000000-0000-4000-8000-000000000001";
const DIMENSION_ID = "30000000-0000-4000-8000-000000000001";
const FORMULA_ID = "30000000-0000-4000-8000-000000000002";
const METRIC_ID = "30000000-0000-4000-8000-000000000003";
const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const H3 = `sha256:${"3".repeat(64)}` as const;
const H4 = `sha256:${"4".repeat(64)}` as const;
const H5 = `sha256:${"5".repeat(64)}` as const;
const H6 = `sha256:${"6".repeat(64)}` as const;

function physicalColumn(name: string) {
  return {
    column_name: name,
    ordinal_position: 2,
    formatted_type: "numeric",
    type_identity: {
      type_schema: "pg_catalog",
      type_name: "numeric",
      type_kind: "BASE" as const,
      array_dimensions: 0,
    },
    nullable: false,
    default_expression: null,
    identity_generation: null,
    generated_expression: null,
    comment: null,
  };
}

function operation(kind: "COLUMN_REMOVED" | "COLUMN_COMMENT_CHANGED") {
  const identity = {
    relation: { schema_name: "public", relation_name: "orders" },
    column_name: "total",
  };
  if (kind === "COLUMN_REMOVED") {
    return {
      operation_kind: kind,
      severity: "BREAKING" as const,
      identity,
      before: physicalColumn("total"),
    };
  }
  return {
    operation_kind: kind,
    severity: "INFO" as const,
    identity,
    before: null,
    after: "Order total",
  };
}

async function authority(
  operationKind: "COLUMN_REMOVED" | "COLUMN_COMMENT_CHANGED" = "COLUMN_REMOVED",
  mappings: SemanticBindingImpactAuthorityBundle["packages"][number]["physical_mappings"] = [
    {
      mapping_id: MAPPING_ID,
      logical_object_id: DIMENSION_ID,
      mode: "QUERYABLE",
      datasource_id: DATASOURCE_ID,
      schema_snapshot_id: "10000000-0000-4000-8000-000000000007",
      snapshot_content_hash: H2,
      physical_locator: {
        kind: "COLUMN",
        schema_name: "public",
        table_name: "orders",
        column_name: "total",
      },
      evidence_sources: [],
      resolution: "RESOLVED",
    },
  ],
) {
  return buildSemanticBindingImpactAuthorityBundle({
    schema_version: "semantic-binding-impact-authority@1.0.0",
    scope: {
      app_id: APP_ID,
      tenant_id: TENANT_ID,
      environment: "dev",
      semantic_domain: "sales",
    },
    datasource_id: DATASOURCE_ID,
    drift: {
      event: {
        schema_version: "schema-drift-event@1.0.0",
        drift_event_id: DRIFT_ID,
        datasource_id: DATASOURCE_ID,
        datasource_fingerprint: H1,
        base_snapshot_content_hash: H2,
        current_snapshot_content_hash: H3,
        observed_at: "2026-08-23T00:00:00.000Z",
        severity: operationKind === "COLUMN_REMOVED" ? "BREAKING" : "INFO",
        binding_impact: "UNKNOWN",
        operations: [operation(operationKind)],
      },
      event_storage_digest: H4,
    },
    release: { release_id: RELEASE_ID, generation: 2, release_digest: H5 },
    packages: [
      {
        namespace_id: NAMESPACE_ID,
        package_id: PACKAGE_ID,
        package_version: 1,
        package_hash: H6,
        objects: [
          {
            object_id: DIMENSION_ID,
            graph_entry_kind: "NODE",
            graph_entry_id: "dimension.total",
            semantic_role: "DATA_PROPERTY",
            resolution: "RESOLVED",
            object_hash: H1,
          },
          {
            object_id: FORMULA_ID,
            graph_entry_kind: "NODE",
            graph_entry_id: "formula.gmv",
            semantic_role: "FORMULA",
            resolution: "RESOLVED",
            object_hash: H2,
          },
          {
            object_id: METRIC_ID,
            graph_entry_kind: "NODE",
            graph_entry_id: "metric.gmv",
            semantic_role: "METRIC",
            resolution: "RESOLVED",
            object_hash: H3,
          },
        ],
        physical_mappings: mappings,
        metric_bindings: [
          {
            metric_object_id: METRIC_ID,
            formula_object_id: FORMULA_ID,
            dimension_object_ids: [DIMENSION_ID],
            grain_object_ids: [],
            time_object_id: null,
            unit_object_id: null,
            formula_ast_hash: H4,
            compiler_digest: H5,
            resolution: "RESOLVED",
          },
        ],
        constraints: [],
        graph_edges: [],
      },
    ],
  });
}

describe("semantic binding impact planner", () => {
  it("maps a removed bound column to direct and transitive review operations", async () => {
    const input = await authority();
    const first = await planSemanticBindingImpact(input);
    const second = await planSemanticBindingImpact(input);

    expect(first.status).toBe("REVIEW_REQUIRED");
    expect(first.risk_level).toBe("CRITICAL");
    expect(first.direct_impacts).toHaveLength(1);
    expect(first.direct_impacts[0]).toMatchObject({
      mapping_id: MAPPING_ID,
      logical_object_id: DIMENSION_ID,
      suggested_action: "REMAP_COLUMN",
    });
    expect(first.transitive_impacts.map(({ object_id }) => object_id)).toEqual([
      DIMENSION_ID,
      METRIC_ID,
    ]);
    expect(first.candidate_operations.map(({ target_type }) => target_type).sort()).toEqual([
      "DIMENSION",
      "METRIC",
      "PHYSICAL_BINDING",
    ]);
    expect(second.plan_hash).toBe(first.plan_hash);
  });

  it("does not exaggerate a comment change into semantic breakage", async () => {
    const plan = await planSemanticBindingImpact(await authority("COLUMN_COMMENT_CHANGED"));
    expect(plan).toMatchObject({
      status: "NO_SEMANTIC_ACTION",
      risk_level: "LOW",
      direct_impacts: [],
      transitive_impacts: [],
      candidate_operations: [],
      suggested_actions: ["NO_SEMANTIC_ACTION"],
    });
  });

  it("fails closed to manual investigation for one locator mapped to multiple meanings", async () => {
    const alternateObjectId = "30000000-0000-4000-8000-000000000004";
    const mappings = [
      ...((await authority()).packages[0]?.physical_mappings ?? []),
      {
        mapping_id: "20000000-0000-4000-8000-000000000002",
        logical_object_id: alternateObjectId,
        mode: "QUERYABLE" as const,
        datasource_id: DATASOURCE_ID,
        schema_snapshot_id: "10000000-0000-4000-8000-000000000007",
        snapshot_content_hash: H2,
        physical_locator: {
          kind: "COLUMN" as const,
          schema_name: "public",
          table_name: "orders",
          column_name: "total",
        },
        evidence_sources: [],
        resolution: "RESOLVED" as const,
      },
    ];
    const base = await authority("COLUMN_REMOVED", mappings);
    const { authority_input_hash: _authorityHash, ...baseMaterial } = base;
    const withObject = await buildSemanticBindingImpactAuthorityBundle({
      ...baseMaterial,
      packages: [
        {
          ...base.packages[0],
          objects: [
            ...(base.packages[0]?.objects ?? []),
            {
              object_id: alternateObjectId,
              graph_entry_kind: "NODE",
              graph_entry_id: "dimension.alternate_total",
              semantic_role: "DATA_PROPERTY",
              resolution: "RESOLVED",
              object_hash: H6,
            },
          ],
        },
      ],
    });
    const plan = await planSemanticBindingImpact(withObject);
    expect(plan.status).toBe("MANUAL_INVESTIGATION");
    expect(plan.manual_reason_codes).toContain("AMBIGUOUS_PHYSICAL_MAPPING");
    expect(plan.candidate_operations).toEqual([]);
  });

  it("matches a removed foreign key only to the exact published join locator", async () => {
    const base = await authority();
    const { authority_input_hash: _authorityHash, ...baseMaterial } = base;
    const foreignKey = {
      constraint_name: "orders_customer_fk",
      referenced_relation: { schema_name: "public", relation_name: "customers" },
      column_pairs: [{ column_name: "customer_id", referenced_column_name: "id" }],
      match_type: "SIMPLE" as const,
      on_update: "NO_ACTION" as const,
      on_delete: "NO_ACTION" as const,
      deferrable: false,
      initially_deferred: false,
    };
    const input = await buildSemanticBindingImpactAuthorityBundle({
      ...baseMaterial,
      drift: {
        ...base.drift,
        event: {
          ...base.drift.event,
          operations: [
            {
              operation_kind: "FOREIGN_KEY_REMOVED",
              severity: "BREAKING",
              identity: {
                relation: { schema_name: "public", relation_name: "orders" },
                object_name: "orders_customer_fk",
              },
              before: foreignKey,
            },
          ],
        },
      },
      packages: [
        {
          ...base.packages[0],
          physical_mappings: [
            {
              ...(base.packages[0]?.physical_mappings[0] ?? {}),
              physical_locator: {
                kind: "JOIN",
                left_schema_name: "public",
                left_table_name: "orders",
                left_column_name: "customer_id",
                right_schema_name: "public",
                right_table_name: "customers",
                right_column_name: "id",
              },
            },
          ],
        },
      ],
    });
    const plan = await planSemanticBindingImpact(input);
    expect(plan.status).toBe("REVIEW_REQUIRED");
    expect(plan.direct_impacts).toHaveLength(1);
    expect(plan.direct_impacts[0]?.suggested_action).toBe("REVALIDATE_JOIN");
  });

  it("requires manual investigation when an affected release has dangling metric lineage", async () => {
    const base = await authority();
    const { authority_input_hash: _authorityHash, ...baseMaterial } = base;
    const input = await buildSemanticBindingImpactAuthorityBundle({
      ...baseMaterial,
      packages: [
        {
          ...base.packages[0],
          metric_bindings: [
            {
              ...(base.packages[0]?.metric_bindings[0] ?? {}),
              formula_object_id: "30000000-0000-4000-8000-000000000099",
            },
          ],
        },
      ],
    });
    const plan = await planSemanticBindingImpact(input);
    expect(plan.status).toBe("MANUAL_INVESTIGATION");
    expect(plan.manual_reason_codes).toContain("DANGLING_RELEASE_REFERENCE");
    expect(plan.candidate_operations).toEqual([]);
  });

  it("terminates cycles and preserves every root provenance", () => {
    expect(
      collectTransitiveDependents({
        roots: ["a", "b", "a"],
        dependencies: [
          { source_object_id: "a", dependent_object_id: "c" },
          { source_object_id: "c", dependent_object_id: "a" },
          { source_object_id: "b", dependent_object_id: "c" },
        ],
      }),
    ).toEqual([
      { object_id: "a", source_object_ids: ["a", "b"] },
      { object_id: "b", source_object_ids: ["b"] },
      { object_id: "c", source_object_ids: ["a", "b"] },
    ]);
  });
});
