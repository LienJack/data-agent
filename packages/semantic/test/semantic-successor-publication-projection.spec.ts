import {
  buildSemanticAssertionCandidate,
  buildSemanticSuccessorStage,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { describe, expect, it } from "vitest";
import {
  compileSemanticChangeSet,
  compileSemanticPublicationProjection,
  freezeSemanticChangeSetForReview,
  semanticPublicationCompilerBundleDigest,
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
} from "../src/production/index.js";

const id = (suffix: number) => `50000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const datasourceId = id(3);
const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test" as const,
  semantic_domain: "falcon24",
};
const timeDomain = {
  time_domain_id: "time.order",
  calendar: "gregorian" as const,
  timezone: "Asia/Shanghai",
  min_time: null,
  max_time: null,
};

async function assertion(input: {
  readonly suffix: number;
  readonly kind: "PHYSICAL_BINDING" | "METRIC" | "DIMENSION" | "FORMULA" | "TIME_SEMANTICS";
  readonly key: string;
  readonly payload: Readonly<Record<string, unknown>>;
}) {
  return buildSemanticAssertionCandidate({
    schema_version: "semantic-assertion-candidate@1.0.0",
    assertion_id: id(input.suffix),
    scope,
    target_kind: input.kind,
    canonical_key: input.key,
    applicability_scope: { datasource: "falcon_db_24" },
    assertion_payload: input.payload,
    source_kind: "SCHEMA_FACT",
    evidence: [
      {
        evidence_id: `schema:${input.key}`,
        source_kind: "SCHEMA_FACT",
        source_ref: {
          resource_id: "falcon24-schema",
          resource_revision: 1,
          resource_hash: hash("a"),
        },
        locator: { locator_kind: "SCHEMA_OBJECT", locator_value: input.key },
        observation: "Fixed Falcon24 source and schema fact.",
      },
    ],
    premise_assertion_ids: [],
    inference_rule_id: null,
    confidence: 1,
  });
}

async function reviewedChangeSet() {
  const binding = (
    suffix: number,
    key: string,
    logicalObjectId: string,
    logicalObjectType: "table" | "column",
    columnName: string | null,
  ) =>
    assertion({
      suffix,
      kind: "PHYSICAL_BINDING",
      key,
      payload: {
        binding: {
          logical_object_id: logicalObjectId,
          logical_object_type: logicalObjectType,
          datasource_id: datasourceId,
          schema_name: "public",
          table_name: "orders",
          column_name: columnName,
          binding_lifecycle: "active",
          valid_from: null,
          valid_until: null,
        },
      },
    });
  const assertions = await Promise.all([
    binding(10, "binding.table.orders", "table.orders", "table", null),
    binding(
      11,
      "binding.column.orders.order_total",
      "column.orders.order_total",
      "column",
      "order_total",
    ),
    binding(
      12,
      "binding.column.orders.order_date",
      "column.orders.order_date",
      "column",
      "order_date",
    ),
    assertion({
      suffix: 13,
      kind: "METRIC",
      key: "metric.order_revenue",
      payload: {
        metric: {
          metric_id: "metric.order_revenue",
          name: "订单收入",
          aliases: ["收入"],
          table_id: "orders",
          column_id: "order_total",
          aggregation: "sum",
          formula: {
            formula_id: "formula.order_revenue",
            expression: "SUM(order_total)",
            dialect: "text2sql",
          },
          grain: { grain_id: "grain.order", granularity: "atomic" },
          unit: null,
          time_domain: timeDomain,
          time_column_id: "order_date",
          additivity: "additive",
          null_policy: "coalesce-zero",
          fanout_policy: "preaggregate",
          dependency_column_ids: ["order_total"],
          tags: [],
          analysis: {
            primary: true,
            priority: 10_000,
            missing_period_policy: "ZERO_IF_SEMANTICALLY_EMPTY",
            seasonality: null,
            allowed_dimension_ids: ["dimension.order_month"],
            capabilities: ["CHART_DATASET", "TREND_CHANGE"],
            causal_role: "OUTCOME",
          },
        },
      },
    }),
    assertion({
      suffix: 14,
      kind: "DIMENSION",
      key: "dimension.order_month",
      payload: {
        dimension: {
          dimension_id: "dimension.order_month",
          name: "订单月份",
          aliases: ["月份"],
          table_id: "orders",
          column_id: "order_date",
          grain: { grain_id: "grain.order", granularity: "atomic" },
          data_type: "date",
          sensitivity: "PUBLIC",
          hierarchical: false,
          parent_dimension_id: null,
          tags: [],
          analysis: { groupable: true, pivotable: true, causal_role: null },
        },
      },
    }),
    assertion({
      suffix: 15,
      kind: "FORMULA",
      key: "formula.order_revenue",
      payload: {
        formula: {
          node_id: "formula.order_revenue",
          node_version: 1,
          node_type: "FORMULA",
          name: "订单收入公式",
          aliases: [],
          owner_ref: "semantic-publication-authority",
          lifecycle: "ACTIVE",
          evidence_refs: [],
          tags: [],
          formula_type: "additive_aggregate",
          return_type: "numeric",
          language: "semantic-ast",
          language_version: "semantic-formula-ast@1",
          expression: { kind: "SLOT", slot_id: "order_total" },
        },
      },
    }),
    assertion({
      suffix: 16,
      kind: "TIME_SEMANTICS",
      key: "time.order",
      payload: { time_domain: timeDomain },
    }),
  ]);
  return freezeSemanticChangeSetForReview(
    await compileSemanticChangeSet({
      change_set_id: id(20),
      scope,
      base_release: { release_id: id(21), generation: 1, release_hash: hash("b") },
      revision: 1,
      assertions,
    }),
  );
}

async function sourceSnapshot() {
  const content = {
    schema_version: "physical-schema-content@1.0.0" as const,
    datasource_id: datasourceId,
    datasource_fingerprint: hash("c"),
    engine: "postgresql" as const,
    engine_version: { major: 17, minor: 0 },
    database_identity: { database_name: "falcon_db_24", database_oid: 24 },
    included_schemas: ["public"],
    relations: [
      {
        identity: { schema_name: "public", relation_name: "orders" },
        relation_kind: "TABLE" as const,
        comment: null,
        columns: [
          {
            column_name: "order_total",
            ordinal_position: 1,
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
          },
          {
            column_name: "order_date",
            ordinal_position: 2,
            formatted_type: "date",
            type_identity: {
              type_schema: "pg_catalog",
              type_name: "date",
              type_kind: "BASE" as const,
              array_dimensions: 0,
            },
            nullable: false,
            default_expression: null,
            identity_generation: null,
            generated_expression: null,
            comment: null,
          },
        ],
        primary_key: null,
        foreign_keys: [],
        unique_constraints: [],
        check_constraints: [],
        indexes: [],
      },
    ],
  };
  return {
    schema_version: "physical-schema-snapshot@1.0.0" as const,
    snapshot_id: id(22),
    scan_run_id: id(23),
    snapshot_content_hash: await sha256ContentHash(content),
    captured_at: "2026-08-28T00:00:00.000Z",
    content,
  };
}

describe("semantic successor publication projection", () => {
  it("rejects source snapshot bytes that do not match the authority hash", async () => {
    const changeSet = await reviewedChangeSet();
    const snapshot = await sourceSnapshot();
    await expect(
      compileSemanticPublicationProjection(changeSet, {
        source_snapshot: {
          ...snapshot,
          content: { ...snapshot.content, included_schemas: ["tampered"] },
        },
      }),
    ).rejects.toThrow("SEMANTIC_COMPILER_SNAPSHOT_HASH_MISMATCH");
  });

  it("server-compiles a snapshot-bound generation 2 envelope accepted by the shared validator", async () => {
    const changeSet = await reviewedChangeSet();
    const snapshot = await sourceSnapshot();
    const projection = await compileSemanticPublicationProjection(changeSet, {
      source_snapshot: snapshot,
    });
    const compilerBundleHash = await semanticPublicationCompilerBundleDigest();
    expect(projection.compiler_bundle_digest).toBe(compilerBundleHash);
    expect(projection.graph_projection.compiler_version).toBe("semantic-change-set-publication@3");
    expect(projection.graph_projection.nodes.map(({ node_type }) => node_type)).toEqual(
      expect.arrayContaining([
        "METRIC",
        "DIMENSION",
        "FORMULA",
        "PHYSICAL_TABLE",
        "PHYSICAL_COLUMN",
      ]),
    );
    const projectionRefs = {
      executable: {
        projection_id: projection.executable_projection_id,
        projection_digest: projection.executable_projection_digest,
      },
      relationship: {
        projection_id: projection.relationship_projection_id,
        projection_digest: projection.relationship_projection_digest,
      },
      runtime_restriction: {
        projection_id: projection.restriction_projection_id,
        projection_digest: projection.restriction_projection_digest,
      },
      graph: {
        projection_id: projection.graph_projection_id,
        projection_digest: projection.graph_projection_digest,
      },
    };
    const stage = await buildSemanticSuccessorStage({
      schema_version: "semantic-successor-stage@1.0.0",
      stage_id: id(24),
      scope,
      predecessor_release: {
        release_id: changeSet.base_release.release_id,
        generation: changeSet.base_release.generation,
        release_digest: changeSet.base_release.release_hash,
      },
      expected_pointer_version: 1,
      target_generation: 2,
      change_set_ref: {
        change_set_id: changeSet.change_set_id,
        change_set_hash: changeSet.change_set_hash,
      },
      review_ref: { review_id: id(25), review_hash: hash("d") },
      source_snapshot_ref: {
        snapshot_id: snapshot.snapshot_id,
        snapshot_revision: 1,
        snapshot_hash: snapshot.snapshot_content_hash,
      },
      compiler_bundle_ref: {
        compiler_version: projection.graph_projection.compiler_version,
        compiler_bundle_hash: compilerBundleHash,
      },
      candidate_release: {
        release_id: projection.release_id,
        generation: 2,
        release_digest: projection.release_digest,
        datasource_id: datasourceId,
      },
      projection_refs: projectionRefs,
      status: "STAGED",
    });
    const verified = await verifySemanticReleaseEnvelope({
      stage,
      projections: {
        executable: {
          projection_kind: "EXECUTABLE",
          ...projectionRefs.executable,
          projection_payload: projection.executable_projection,
        },
        relationship: {
          projection_kind: "RELATIONSHIP",
          ...projectionRefs.relationship,
          projection_payload: projection.relationship_projection,
        },
        runtime_restriction: {
          projection_kind: "RUNTIME_RESTRICTION",
          ...projectionRefs.runtime_restriction,
          projection_payload: projection.restriction_projection,
        },
        graph: {
          projection_kind: "GRAPH",
          ...projectionRefs.graph,
          projection_payload: projection.graph_projection,
        },
      },
    });
    await expect(validateSemanticRuntimeClosure(verified)).resolves.toMatchObject({
      outcome: "PASS",
      reason_codes: [],
    });
  });
});
