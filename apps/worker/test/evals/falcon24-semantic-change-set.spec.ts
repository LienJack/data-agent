import {
  buildFalcon24AgentAnalysisAcceptanceSuite,
  FALCON24_SEMANTIC_RELEASE_BLUEPRINT,
} from "@data-agent/evals";
import { compileSemanticPublicationProjection } from "@data-agent/semantic/production";
import { describe, expect, it } from "vitest";
import {
  buildFalcon24SemanticConsumptionProjection,
  falcon24FormulaExpression,
} from "../../src/evals/falcon24-semantic-catalog.js";
import { buildFalcon24SemanticChangeSet } from "../../src/evals/falcon24-semantic-change-set.js";

const id = (suffix: number) => `60000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

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
