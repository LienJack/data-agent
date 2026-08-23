import { describe, expect, it } from "vitest";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import { catalogSnapshotSchema, policySnapshotSchema } from "../src/grounding/types.js";
import {
  analystPolicy,
  commerceCatalog,
  fanoutCatalog,
  fanoutPolicy,
  netRevenueContract,
  paymentBySkuContract,
} from "./support/commerce-fixture.js";

describe("ACL-first Grounding 与 Closure", () => {
  it("Catalog 与 Policy 拒绝会导致 Map/.find 覆盖的重复语义身份", () => {
    expect(
      catalogSnapshotSchema.safeParse({
        ...commerceCatalog,
        tables: [...commerceCatalog.tables, commerceCatalog.tables[0]],
      }).success,
    ).toBe(false);
    expect(
      catalogSnapshotSchema.safeParse({
        ...commerceCatalog,
        metrics: [...commerceCatalog.metrics, commerceCatalog.metrics[0]],
      }).success,
    ).toBe(false);
    expect(
      policySnapshotSchema.safeParse({
        ...analystPolicy,
        allowed_tables: [...analystPolicy.allowed_tables, analystPolicy.allowed_tables[0]],
      }).success,
    ).toBe(false);
  });

  it("Catalog 拒绝 Metric 与 Dimension 共用跨类型语义身份", () => {
    expect(
      catalogSnapshotSchema.safeParse({
        ...commerceCatalog,
        dimensions: commerceCatalog.dimensions.map((dimension) => ({
          ...dimension,
          dimension_id: "metric.net_revenue",
        })),
      }).success,
    ).toBe(false);
  });

  it("在检索前拒绝 Table 与限定 Column 前缀漂移的 Catalog/Policy", async () => {
    const corruptedCatalog = {
      ...commerceCatalog,
      tables: commerceCatalog.tables.map((table) =>
        table.table_id === "orders"
          ? {
              ...table,
              columns: table.columns.map((column) =>
                column.column_id === "orders.customer_id"
                  ? { ...column, column_id: "customers.id" }
                  : column,
              ),
            }
          : table,
      ),
      relationships: commerceCatalog.relationships.map((relationship) => ({
        ...relationship,
        left_column_ids: ["customers.id"],
      })),
    };
    const corruptedPolicy = {
      ...analystPolicy,
      allowed_tables: analystPolicy.allowed_tables.map((table) =>
        table.table_id === "orders"
          ? {
              ...table,
              column_ids: table.column_ids.map((columnId) =>
                columnId === "orders.customer_id" ? "customers.id" : columnId,
              ),
            }
          : table,
      ),
    };

    await expect(
      groundQueryContract({
        query_contract: netRevenueContract(),
        catalog: corruptedCatalog,
        policy: corruptedPolicy,
        retrieval_candidates: [],
        max_context_objects: 32,
      }),
    ).rejects.toThrow();
  });

  it("先过滤 ACL 再选择候选，高分越权对象不会进入结果、缓存材料或冲突集", async () => {
    const result = await groundQueryContract({
      query_contract: netRevenueContract(),
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [
        { object_id: "metric.executive_revenue", score: 1 },
        { object_id: "metric.net_revenue", score: 0.5 },
        { object_id: "dimension.customer_segment", score: 0.4 },
      ],
      max_context_objects: 32,
    });

    expect(result.state).toBe("READY");
    if (result.state !== "READY") throw new Error("测试 Fixture 应完成 Grounding。");
    const serialized = JSON.stringify(result.grounding);
    expect(serialized).not.toContain("executive_revenue");
    expect(result.grounding.allowed_schema.tables.map(({ table_id }) => table_id)).toEqual([
      "customers",
      "orders",
    ]);
    expect(result.grounding.join_closure.edges).toHaveLength(1);
    expect(result.grounding.required_column_ids).toEqual(
      expect.arrayContaining([
        "orders.customer_id",
        "customers.id",
        "orders.created_at",
        "orders.tenant_id",
        "customers.tenant_id",
      ]),
    );
  });

  it("多路检索重复命中同一对象时按最高分稳定去重，不把合法请求变成异常", async () => {
    const result = await groundQueryContract({
      query_contract: netRevenueContract(),
      catalog: commerceCatalog,
      policy: analystPolicy,
      retrieval_candidates: [
        { object_id: "metric.net_revenue", score: 0.9 },
        { object_id: "metric.net_revenue", score: 0.8 },
        { object_id: "dimension.customer_segment", score: 0.7 },
      ],
      max_context_objects: 32,
    });

    expect(result.state).toBe("READY");
    if (result.state !== "READY") throw new Error("重复检索 Hit 不应阻断 Grounding。");
    expect(result.grounding.accepted_candidate_ids).toEqual([
      "metric.net_revenue",
      "dimension.customer_segment",
    ]);
  });

  it("Policy 缺失、AllowedSchema 为空或必要依赖被拒绝时一律 DENIED", async () => {
    await expect(
      groundQueryContract({
        query_contract: netRevenueContract(),
        catalog: commerceCatalog,
        policy: null,
        retrieval_candidates: [],
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_POLICY_MISSING",
    });

    await expect(
      groundQueryContract({
        query_contract: netRevenueContract(),
        catalog: commerceCatalog,
        policy: { ...analystPolicy, allowed_tables: [] },
        retrieval_candidates: [],
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_ALLOWED_SCHEMA_EMPTY",
    });

    await expect(
      groundQueryContract({
        query_contract: netRevenueContract(),
        catalog: commerceCatalog,
        policy: {
          ...analystPolicy,
          allowed_tables: analystPolicy.allowed_tables.map((table) =>
            table.table_id === "orders"
              ? {
                  ...table,
                  column_ids: table.column_ids.filter(
                    (columnId) => columnId !== "orders.created_at",
                  ),
                }
              : table,
          ),
        },
        retrieval_candidates: [],
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_DEPENDENCY_DENIED",
      missing_ids: ["orders.created_at"],
    });
  });

  it("相同代价的多条 Join Path 需要澄清，不能随机选路", async () => {
    const ambiguousCatalog = {
      ...commerceCatalog,
      relationships: [
        ...commerceCatalog.relationships,
        {
          relationship_id: "orders_customer_alternate",
          left_table_id: "orders",
          left_column_ids: ["orders.customer_id"],
          right_table_id: "customers",
          right_column_ids: ["customers.id"],
          cardinality: "many-to-one",
          left_row_match: "required",
          right_row_match: "optional",
        },
      ],
    } as const;

    const result = await groundQueryContract({
      query_contract: netRevenueContract(),
      catalog: ambiguousCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 32,
    });

    expect(result).toMatchObject({
      state: "CLARIFY",
      reason_code: "GROUNDING_JOIN_PATH_AMBIGUOUS",
    });
    if (result.state !== "CLARIFY") throw new Error("同成本 Join Path 应触发澄清。");
    expect(result.conflict_set).toHaveLength(2);
  });

  it("缺少分摊或可组合聚合证明时拒绝 one-to-many Fan-out", async () => {
    await expect(
      groundQueryContract({
        query_contract: paymentBySkuContract(),
        catalog: fanoutCatalog,
        policy: fanoutPolicy,
        retrieval_candidates: [],
        max_context_objects: 32,
      }),
    ).resolves.toMatchObject({
      state: "DENIED",
      reason_code: "GROUNDING_FANOUT_UNSAFE",
    });
  });

  it("保留 QueryContract 的 Dimension 顺序作为结果列顺序", async () => {
    const orderedCatalog = {
      ...commerceCatalog,
      dimensions: [
        ...commerceCatalog.dimensions,
        {
          dimension_id: "dimension.z_status",
          aliases: ["状态"],
          table_id: "orders",
          column_id: "orders.status",
          grain: "order",
        },
        {
          dimension_id: "dimension.a_order",
          aliases: ["订单"],
          table_id: "orders",
          column_id: "orders.id",
          grain: "order",
        },
      ],
    } as const;
    const queryContract = netRevenueContract({
      dimensions: ["dimension.z_status", "dimension.a_order"],
      result_contract: {
        columns: ["dimension.z_status", "dimension.a_order", "metric.net_revenue"],
        invariant_ids: ["non_negative_revenue"],
      },
    });
    const result = await groundQueryContract({
      query_contract: queryContract,
      catalog: orderedCatalog,
      policy: analystPolicy,
      retrieval_candidates: [],
      max_context_objects: 32,
    });

    if (result.state !== "READY") throw new Error("多 Dimension Fixture 应完成 Grounding。");
    expect(result.grounding.dimensions.map(({ dimension_id }) => dimension_id)).toEqual([
      "dimension.z_status",
      "dimension.a_order",
    ]);
  });
});
