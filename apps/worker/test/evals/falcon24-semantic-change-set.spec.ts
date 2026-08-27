import { buildSemanticSuccessorStage } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AgentAnalysisAcceptanceSuite,
  FALCON24_SEMANTIC_RELEASE_BLUEPRINT,
} from "@data-agent/evals";
import {
  compileSemanticPublicationProjection,
  semanticPublicationCompilerBundleDigest,
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
} from "@data-agent/semantic/production";
import { describe, expect, it } from "vitest";
import {
  buildFalcon24SemanticConsumptionProjection,
  falcon24FormulaExpression,
} from "../../src/evals/falcon24-semantic-catalog.js";
import { buildFalcon24SemanticChangeSet } from "../../src/evals/falcon24-semantic-change-set.js";

const id = (suffix: number) => `60000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function falcon24PhysicalType(column: string): string {
  if (/(?:^|_)(?:date|time)(?:_|$)/u.test(column)) return "timestamp without time zone";
  if (
    /(?:amount|total|price|quantity|stock|spend|revenue|rating|minutes|impressions|clicks|conversions)/u.test(
      column,
    )
  ) {
    return "numeric";
  }
  return "text";
}

async function falcon24Snapshot(datasourceId: string) {
  const content = {
    schema_version: "physical-schema-content@1.0.0" as const,
    datasource_id: datasourceId,
    datasource_fingerprint: hash("c"),
    engine: "postgresql" as const,
    engine_version: { major: 17, minor: 0 },
    database_identity: { database_name: "falcon_db_24", database_oid: 24 },
    included_schemas: ["falcon_db_24"],
    relations: FALCON24_SEMANTIC_RELEASE_BLUEPRINT.tables.map((table) => ({
      identity: { schema_name: "falcon_db_24", relation_name: table.table_id },
      relation_kind: "TABLE" as const,
      comment: null,
      columns: table.columns.map((column, index) => {
        const formattedType = falcon24PhysicalType(column);
        return {
          column_name: column,
          ordinal_position: index + 1,
          formatted_type: formattedType,
          type_identity: {
            type_schema: "pg_catalog",
            type_name:
              formattedType === "numeric"
                ? "numeric"
                : formattedType === "text"
                  ? "text"
                  : "timestamp",
            type_kind: "BASE" as const,
            array_dimensions: 0,
          },
          nullable: false,
          default_expression: null,
          identity_generation: null,
          generated_expression: null,
          comment: null,
        };
      }),
      primary_key: null,
      foreign_keys: [],
      unique_constraints: [],
      check_constraints: [],
      indexes: [],
    })),
  };
  return {
    schema_version: "physical-schema-snapshot@1.0.0" as const,
    snapshot_id: id(90),
    scan_run_id: id(91),
    snapshot_content_hash: await sha256ContentHash(content),
    captured_at: "2026-08-28T00:00:00.000Z",
    content,
  };
}

describe("Falcon24 governed semantic change set", () => {
  it("deterministically freezes all physical bindings and five competency cases for human review", async () => {
    const input = {
      scope: {
        app_id: id(1),
        tenant_id: id(2),
        environment: "test" as const,
        semantic_domain: "falcon24",
      },
      base_release: { release_id: id(3), generation: 0, release_hash: hash("a") },
    };
    const [first, replay] = await Promise.all([
      buildFalcon24SemanticChangeSet(input),
      buildFalcon24SemanticChangeSet(input),
    ]);
    expect(first.change_set.lifecycle_state).toBe("REVIEW_FROZEN");
    expect(first.change_set.validation).toMatchObject({
      outcome: "PASS",
      evidence_closed: true,
      formula_cycle_free: true,
      grain_join_time_valid: true,
      policy_quality_valid: true,
      competency_cases_passed: true,
    });
    expect(first.competency_case_count).toBe(5);
    expect(first.change_set.competency_results).toHaveLength(5);
    expect(first.change_set.competency_results.every(({ verdict }) => verdict === "PASS")).toBe(
      true,
    );
    expect(
      first.change_set.assertions.filter(({ target_kind }) => target_kind === "PHYSICAL_BINDING"),
    ).toHaveLength(79);
    expect(
      first.change_set.assertions.filter(({ target_kind }) => target_kind === "RELATIONSHIP"),
    ).toHaveLength(8);
    expect(
      first.change_set.assertions.filter(({ target_kind }) => target_kind === "QUALITY_CONSTRAINT"),
    ).toHaveLength(5);
    const questionEntrypoints = first.change_set.assertions.filter(
      ({ target_kind }) => target_kind === "BUSINESS_ENTITY_TYPE",
    );
    expect(questionEntrypoints).toHaveLength(5);
    expect(
      questionEntrypoints.every(({ assertion_payload: payload }) =>
        Array.isArray(
          payload.entity &&
            (payload.entity as { business_relationship_types?: unknown })
              .business_relationship_types,
        ),
      ),
    ).toBe(true);
    expect(
      first.change_set.assertions.find(
        ({ canonical_key }) => canonical_key === "metric.order_revenue",
      )?.assertion_payload,
    ).toMatchObject({
      metric: {
        aliases: expect.arrayContaining(["订单收入"]),
        formula: { formula_id: "formula.order_revenue", expression: "SUM(order_total)" },
        grain: { grain_id: "grain.order" },
      },
    });
    expect(
      first.change_set.assertions.find(
        ({ canonical_key }) => canonical_key === "metric.low_rating_rate",
      )?.assertion_payload,
    ).toMatchObject({
      metric: {
        aggregation: "count_distinct",
        formula: { formula_id: "formula.low_rating_rate" },
        unit: { dimension: "ratio" },
      },
    });
    const damageFormula = first.change_set.assertions.find(
      ({ canonical_key }) => canonical_key === "formula.inventory_damage_rate",
    )?.assertion_payload.formula as { expression?: unknown } | undefined;
    expect(JSON.stringify(damageFormula?.expression)).toContain("stock_received");
    expect(JSON.stringify(damageFormula?.expression)).not.toContain('"operator":"ADD"');
    expect(
      first.change_set.assertions.filter(({ target_kind }) => target_kind === "FORMULA"),
    ).toHaveLength(Object.keys(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas).length);
    const projection = await compileSemanticPublicationProjection(first.change_set);
    expect(projection.graph_projection.nodes).toHaveLength(
      first.change_set.assertions.filter(({ target_kind }) => target_kind !== "PHYSICAL_BINDING")
        .length,
    );
    expect(projection.graph_projection.edges).toHaveLength(
      first.change_set.competency_results.reduce(
        (count, result) => count + result.resolved_assertion_ids.length,
        0,
      ),
    );
    expect(
      projection.graph_projection.edges.every(
        ({ edge_type }) => edge_type === "LINEAGE_REQUIREMENT",
      ),
    ).toBe(true);
    expect(first.change_set.change_set_hash).toBe(replay.change_set.change_set_hash);
    expect(first.blueprint_hash).toBe(replay.blueprint_hash);
  });

  it("rejects a non-Falcon semantic domain before compiling candidates", async () => {
    await expect(
      buildFalcon24SemanticChangeSet({
        scope: {
          app_id: id(1),
          tenant_id: id(2),
          environment: "test",
          semantic_domain: "ecommerce",
        },
        base_release: { release_id: id(3), generation: 1, release_hash: hash("a") },
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_DOMAIN_INVALID");
  });

  it("fails closed while Falcon24 cohort formula slots still lack reviewed dependency definitions", async () => {
    const built = await buildFalcon24SemanticChangeSet({
      scope: {
        app_id: id(1),
        tenant_id: id(2),
        environment: "test",
        semantic_domain: "falcon24",
      },
      base_release: { release_id: id(3), generation: 1, release_hash: hash("a") },
    });
    const snapshot = await falcon24Snapshot(built.datasource_id);
    const projection = await compileSemanticPublicationProjection(built.change_set, {
      source_snapshot: snapshot,
    });
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
      stage_id: id(92),
      scope: built.change_set.scope,
      predecessor_release: {
        release_id: built.change_set.base_release.release_id,
        generation: built.change_set.base_release.generation,
        release_digest: built.change_set.base_release.release_hash,
      },
      expected_pointer_version: 3,
      target_generation: 2,
      change_set_ref: {
        change_set_id: built.change_set.change_set_id,
        change_set_hash: built.change_set.change_set_hash,
      },
      review_ref: { review_id: id(93), review_hash: hash("d") },
      source_snapshot_ref: {
        snapshot_id: snapshot.snapshot_id,
        snapshot_revision: 1,
        snapshot_hash: snapshot.snapshot_content_hash,
      },
      compiler_bundle_ref: {
        compiler_version: "semantic-change-set-publication@2",
        compiler_bundle_hash: await semanticPublicationCompilerBundleDigest(),
      },
      candidate_release: {
        release_id: projection.release_id,
        generation: 2,
        release_digest: projection.release_digest,
        datasource_id: built.datasource_id,
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
    expect(await validateSemanticRuntimeClosure(verified)).toMatchObject({
      outcome: "FAIL",
      reason_codes: ["SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID"],
    });
  });

  it("fails closed for an unpublished formula instead of manufacturing a fallback AST", () => {
    expect(() => falcon24FormulaExpression("unpublished_formula")).toThrow(
      "FALCON24_FORMULA_UNKNOWN:unpublished_formula",
    );
  });

  it("projects every required metric, formula, dimension, relationship, and quality rule for consumption", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    const inventoryCase = suite.cases.find(
      ({ case_id }) => case_id === "falcon24-inventory-damage-12m",
    );
    if (!inventoryCase) throw new TypeError("inventory case missing");
    const projection = await buildFalcon24SemanticConsumptionProjection({
      test_case: inventoryCase,
      semantic_release_hash: hash("b"),
    });

    expect(projection.metrics.map(({ metric_id }) => metric_id)).toEqual([
      "metric.damaged_stock",
      "metric.sales_quantity",
      "metric.stock_received",
    ]);
    expect(projection.dimensions.map(({ dimension_id }) => dimension_id)).toEqual([
      "dimension.product",
      "dimension.product_category",
    ]);
    expect(
      projection.formulas.find(({ formula_id }) => formula_id === "formula.inventory_damage_rate"),
    ).toMatchObject({
      expression: "SUM(damaged_stock)/NULLIF(SUM(stock_received),0)",
      expression_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(projection.relationships.map(({ relationship_id }) => relationship_id)).toEqual([
      "relationship.inventory_product",
      "relationship.order_item_product",
    ]);
    expect(projection.quality_rules).toEqual([
      expect.objectContaining({ rule_id: "quality.inventory_new_sensitivity_only" }),
    ]);
  });
});
