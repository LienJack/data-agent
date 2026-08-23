import {
  groundingContentSchema,
  queryContractSchema,
  semanticQueryContentSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import { catalogSnapshotSchema } from "../src/grounding/types.js";
import { buildLogicalPlan } from "../src/planning/build-logical-plan.js";
import { validateLogicalPlan } from "../src/planning/validate-logical-plan.js";
import { buildSemanticQuery } from "../src/semantic/build-semantic-query.js";
import {
  analystPolicy,
  commerceCatalog,
  fanoutCatalog,
  fanoutPolicy,
  netRevenueContract,
  paymentBySkuContract,
} from "./support/commerce-fixture.js";

async function groundedFixture() {
  const queryContract = netRevenueContract();
  const result = await groundQueryContract({
    query_contract: queryContract,
    catalog: commerceCatalog,
    policy: analystPolicy,
    retrieval_candidates: [],
    max_context_objects: 32,
  });
  if (result.state !== "READY") throw new Error("测试 Fixture 应完成 Grounding。");
  return { queryContract, grounding: result.grounding };
}

describe("Typed SemanticQuery 与 LogicalPlan", () => {
  it("把时间范围编译为显式 [start, end) 参数，保留 Null 与 Unit 语义", async () => {
    const { queryContract, grounding } = await groundedFixture();
    const semanticQuery = buildSemanticQuery({ query_contract: queryContract, grounding });

    expect(semanticQuery.time_predicate).toEqual({
      field: { table_id: "orders", column_id: "orders.created_at" },
      lower: { parameter_key: "time.start", inclusive: true },
      upper: { parameter_key: "time.end", inclusive: false },
      timezone: "Asia/Shanghai",
    });
    expect(semanticQuery.metric).toMatchObject({
      unit: "CNY",
      null_policy: "coalesce-zero",
      additivity: "additive",
    });
    expect(JSON.stringify(semanticQuery)).not.toContain("BETWEEN");
  });

  it("LogicalPlan 只包含类型化字段引用和参数，不接受自由 SQL Predicate/Expression", async () => {
    const { queryContract, grounding } = await groundedFixture();
    const semanticQuery = buildSemanticQuery({ query_contract: queryContract, grounding });
    const logicalPlan = buildLogicalPlan({ semantic_query: semanticQuery, grounding });

    expect(logicalPlan.root_operation_id).toBe("project_result");
    expect(logicalPlan.operations.map(({ operation }) => operation)).toEqual(
      expect.arrayContaining(["scan", "filter", "join", "aggregate", "project"]),
    );
    const serialized = JSON.stringify(logicalPlan);
    expect(serialized).not.toContain("orders.status =");
    expect(serialized).not.toContain("SELECT ");
    expect(logicalPlan.parameters).toMatchObject({
      "literal.status": { source: "literal", value: "paid" },
      "policy.tenant_id": { source: "policy", policy_key: "tenant_id" },
      "time.start": { source: "time", value: queryContract.time_range.start },
      "time.end": { source: "time", value: queryContract.time_range.end },
    });
  });

  it("Grounding Preaggregation 的 Group/Measure Column 必须属于声明 Table", async () => {
    const { grounding } = await groundedFixture();

    expect(
      groundingContentSchema.safeParse({
        ...grounding,
        join_closure: {
          ...grounding.join_closure,
          preaggregations: [
            {
              table_id: "orders",
              group_by_column_ids: ["customers.id"],
              measure_column_ids: ["orders.net_amount"],
              reason_code: "FANOUT_PREAGG_REQUIRED",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("GroundingPackage 拒绝会被 Set/Map 折叠的重复 Table 与 Required Column", async () => {
    const { grounding } = await groundedFixture();
    const firstTable = grounding.allowed_schema.tables[0];
    const firstColumn = grounding.required_column_ids[0];
    if (!firstTable || !firstColumn) throw new Error("测试 Fixture 必须包含 Table 与 Column。");

    expect(
      groundingContentSchema.safeParse({
        ...grounding,
        allowed_schema: {
          tables: [...grounding.allowed_schema.tables, firstTable],
        },
      }).success,
    ).toBe(false);
    expect(
      groundingContentSchema.safeParse({
        ...grounding,
        required_column_ids: [...grounding.required_column_ids, firstColumn],
      }).success,
    ).toBe(false);
  });

  it("GroundingPackage 与 SemanticQuery 都拒绝 Metric/Dimension 跨类型同名", async () => {
    const { queryContract, grounding } = await groundedFixture();
    const conflictingDimensions = grounding.dimensions.map((dimension) => ({
      ...dimension,
      dimension_id: grounding.metric.metric_id,
    }));
    expect(
      groundingContentSchema.safeParse({
        ...grounding,
        dimensions: conflictingDimensions,
      }).success,
    ).toBe(false);

    const semanticQuery = buildSemanticQuery({ query_contract: queryContract, grounding });
    expect(
      semanticQueryContentSchema.safeParse({
        ...semanticQuery,
        dimensions: semanticQuery.dimensions.map((dimension) => ({
          ...dimension,
          dimension_id: semanticQuery.metric.metric_id,
        })),
      }).success,
    ).toBe(false);
  });

  it("IN 使用类型化 Membership 与独立参数，不回退到 SQL 字符串", async () => {
    const queryContract = netRevenueContract({
      filters: [{ field: "orders.status", operator: "in", value: ["paid", "refunded"] }],
    });
    const result = await groundQueryContract({
      query_contract: queryContract,
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 32,
    });
    if (result.state !== "READY") throw new Error("测试 Fixture 应完成 Grounding。");

    const semanticQuery = buildSemanticQuery({
      query_contract: queryContract,
      grounding: result.grounding,
    });
    expect(semanticQuery.predicates).toContainEqual({
      kind: "membership",
      field: { table_id: "orders", column_id: "orders.status" },
      operator: "in",
      values: [{ parameter_key: "literal.status.1" }, { parameter_key: "literal.status.2" }],
      authority: "query-contract",
    });
    expect(semanticQuery.parameters).toMatchObject({
      "literal.status.1": { source: "literal", value: "paid" },
      "literal.status.2": { source: "literal", value: "refunded" },
    });
  });

  it("普通比较不能把 NULL 当作参数，必须使用专用 NULL Predicate", async () => {
    const invalidQueryContract = {
      ...netRevenueContract(),
      filters: [{ field: "orders.status", operator: "eq", value: null }],
    };
    expect(queryContractSchema.safeParse(invalidQueryContract).success).toBe(false);

    const queryContract = netRevenueContract({
      filters: [{ field: "orders.status", operator: "is_null", value: null }],
    });
    const result = await groundQueryContract({
      query_contract: queryContract,
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 32,
    });
    if (result.state !== "READY") throw new Error("测试 Fixture 应完成 Grounding。");

    const semanticQuery = buildSemanticQuery({
      query_contract: queryContract,
      grounding: result.grounding,
    });
    expect(semanticQuery.predicates).toContainEqual({
      kind: "null-check",
      field: { table_id: "orders", column_id: "orders.status" },
      operator: "is_null",
      authority: "query-contract",
    });
  });

  it("两跳 Join Closure 必须从 Root 按连通拓扑展开，不能按 Relationship ID 接反", async () => {
    const queryContract = {
      ...paymentBySkuContract(),
      grain: "payment",
    };
    const safeTwoHopCatalog = {
      ...fanoutCatalog,
      relationships: fanoutCatalog.relationships.map((relationship) =>
        relationship.relationship_id === "order_items_order"
          ? { ...relationship, cardinality: "many-to-one" as const }
          : relationship,
      ),
      dimensions: fanoutCatalog.dimensions.map((dimension) => ({
        ...dimension,
        grain: "payment",
      })),
    };
    const result = await groundQueryContract({
      query_contract: queryContract,
      catalog: safeTwoHopCatalog,
      policy: fanoutPolicy,
      retrieval_candidates: [],
      max_context_objects: 32,
    });
    if (result.state !== "READY") throw new Error("Fan-out Fixture 应完成 Grounding。");
    const semanticQuery = buildSemanticQuery({
      query_contract: queryContract,
      grounding: result.grounding,
    });
    const logicalPlan = buildLogicalPlan({
      semantic_query: semanticQuery,
      grounding: result.grounding,
    });
    const joins = logicalPlan.operations.filter(({ operation }) => operation === "join");

    expect(result.grounding.join_closure.preaggregations).toHaveLength(0);
    expect(
      joins.map((operation) =>
        operation.operation === "join"
          ? [operation.relationship.relationship_id, operation.right_input_id]
          : null,
      ),
    ).toEqual([
      ["payments_order", "scan_orders"],
      ["order_items_order", "scan_order_items"],
    ]);
  });

  it("可选 many-to-one 关系使用 LEFT JOIN，保留未匹配事实行进入 NULL 维度桶", async () => {
    const optionalCustomerCatalog = {
      ...commerceCatalog,
      tables: commerceCatalog.tables.map((table) =>
        table.table_id === "orders"
          ? {
              ...table,
              columns: table.columns.map((column) =>
                column.column_id === "orders.customer_id"
                  ? { ...column, nullable: true as const }
                  : column,
              ),
            }
          : table,
      ),
      relationships: commerceCatalog.relationships.map((relationship) => ({
        ...relationship,
        left_row_match: "optional" as const,
      })),
    };
    const queryContract = netRevenueContract();
    const result = await groundQueryContract({
      query_contract: queryContract,
      catalog: optionalCustomerCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 32,
    });
    if (result.state !== "READY") throw new Error("Optional Join Fixture 应完成 Grounding。");
    const semanticQuery = buildSemanticQuery({
      query_contract: queryContract,
      grounding: result.grounding,
    });
    const logicalPlan = buildLogicalPlan({
      semantic_query: semanticQuery,
      grounding: result.grounding,
    });
    const join = logicalPlan.operations.find((operation) => operation.operation === "join");

    expect(join).toMatchObject({
      operation: "join",
      join_type: "left",
      relationship: { left_row_match: "optional" },
    });
    expect(
      validateLogicalPlan({
        logical_plan: logicalPlan,
        grounding: result.grounding,
        semantic_query: semanticQuery,
        query_contract: queryContract,
      }),
    ).toMatchObject({ state: "VALID" });

    const swappedRootSide = structuredClone(logicalPlan);
    const swappedJoin = swappedRootSide.operations.find(
      (operation) => operation.operation === "join",
    );
    if (swappedJoin?.operation !== "join") {
      throw new Error("Optional Join Fixture 缺少 Join Operation。");
    }
    [swappedJoin.left_input_id, swappedJoin.right_input_id] = [
      swappedJoin.right_input_id,
      swappedJoin.left_input_id,
    ];
    swappedJoin.join_type = "inner";
    expect(
      validateLogicalPlan({
        logical_plan: swappedRootSide,
        grounding: result.grounding,
        semantic_query: semanticQuery,
        query_contract: queryContract,
      }),
      "根事实表不能被交换到 SQL 右侧，再按另一端 required match 降级为 INNER JOIN",
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_DATAFLOW_INVALID",
    });

    expect(
      groundingContentSchema.safeParse({
        ...result.grounding,
        join_closure: {
          ...result.grounding.join_closure,
          root_table_id: "customers",
        },
      }).success,
    ).toBe(false);
  });

  it("可空 Join Key 不能声明 required match 并继续生成 INNER JOIN", () => {
    const contradictoryCatalog = {
      ...commerceCatalog,
      tables: commerceCatalog.tables.map((table) =>
        table.table_id === "orders"
          ? {
              ...table,
              columns: table.columns.map((column) =>
                column.column_id === "orders.customer_id"
                  ? { ...column, nullable: true as const }
                  : column,
              ),
            }
          : table,
      ),
    };

    expect(catalogSnapshotSchema.safeParse(contradictoryCatalog).success).toBe(false);
  });
});
