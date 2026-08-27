import { describe, expect, it } from "vitest";
import {
  allowedTableContractSchema,
  catalogRelationshipContractSchema,
  catalogTableContractSchema,
  dimensionBindingSchema,
  logicalOperationSchema,
  mandatoryPredicateContractSchema,
  metricBindingSchema,
} from "../src/artifacts/index.js";

const metric = {
  metric_id: "metric.net_revenue",
  aliases: ["净收入"],
  table_id: "orders",
  column_id: "orders.net_amount",
  aggregation: "sum",
  grain: "order",
  unit: "CNY",
  time_column_id: "orders.created_at",
  additivity: "additive",
  null_policy: "coalesce-zero",
  dependency_column_ids: ["orders.net_amount"],
  fanout_policy: "preaggregate",
} as const;

describe("Text2SQL 基础契约的 Column/Table 所有权", () => {
  it("Catalog Table 不能把其他表的限定列登记为自身 Column", () => {
    expect(
      catalogTableContractSchema.safeParse({
        table_id: "orders",
        physical_name: "orders",
        columns: [
          {
            column_id: "customers.id",
            physical_name: "customer_id",
            data_type: "uuid",
            nullable: false,
            sensitivity: "INTERNAL",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("Relationship 两侧 Join Key 必须分别属于声明的 Table", () => {
    expect(
      catalogRelationshipContractSchema.safeParse({
        relationship_id: "orders_customer",
        left_table_id: "orders",
        left_column_ids: ["customers.id"],
        right_table_id: "customers",
        right_column_ids: ["customers.id"],
        cardinality: "many-to-one",
        left_row_match: "required",
        right_row_match: "optional",
      }).success,
    ).toBe(false);
  });

  it("Metric 的值、时间与依赖 Column 都不能跨越其事实表", () => {
    for (const drift of [
      { ...metric, column_id: "customers.id" },
      { ...metric, time_column_id: "customers.created_at" },
      { ...metric, dependency_column_ids: ["customers.net_amount"] },
    ]) {
      expect(metricBindingSchema.safeParse(drift).success).toBe(false);
    }
  });

  it("逻辑复合 Metric 可以没有直接物理依赖列，但仍保留自身事实绑定", () => {
    expect(metricBindingSchema.safeParse({ ...metric, dependency_column_ids: [] }).success).toBe(
      true,
    );
  });

  it("Dimension、AllowedSchema 与 MandatoryPredicate 都强制 Column 归属", () => {
    expect(
      dimensionBindingSchema.safeParse({
        dimension_id: "dimension.customer",
        aliases: ["客户"],
        table_id: "orders",
        column_id: "customers.id",
        grain: "order",
      }).success,
    ).toBe(false);
    expect(
      allowedTableContractSchema.safeParse({
        table_id: "orders",
        column_ids: ["customers.id"],
      }).success,
    ).toBe(false);
    expect(
      mandatoryPredicateContractSchema.safeParse({
        table_id: "orders",
        column_id: "customers.tenant_id",
        operator: "eq",
        parameter_key: "tenant_id",
      }).success,
    ).toBe(false);
  });

  it("LogicalPlan Scan 不能用声明 Table 扫描其他表的限定列", () => {
    expect(
      logicalOperationSchema.safeParse({
        operation: "scan",
        operation_id: "scan_orders",
        table_id: "orders",
        alias: "t_orders",
        column_ids: ["customers.id"],
      }).success,
    ).toBe(false);
  });

  it("LogicalPlan Project 不接受重复输出 Alias", () => {
    expect(
      logicalOperationSchema.safeParse({
        operation: "project",
        operation_id: "project_result",
        input_id: "aggregate_result",
        columns: [
          {
            source_kind: "group",
            source_id: "customers.segment",
            alias: "metric.net_revenue",
          },
          {
            source_kind: "measure",
            source_id: "metric.net_revenue",
            alias: "metric.net_revenue",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(["1metric", "metric/revenue", "metric+revenue", "m".repeat(64)])(
    "SemanticRelease 的 Metric/Dimension ID 拒绝不可跨 PostgreSQL 保真的 Alias：%s",
    (semanticId) => {
      expect(metricBindingSchema.safeParse({ ...metric, metric_id: semanticId }).success).toBe(
        false,
      );
      expect(
        dimensionBindingSchema.safeParse({
          dimension_id: semanticId,
          aliases: ["客户"],
          table_id: "orders",
          column_id: "orders.customer_id",
          grain: "order",
        }).success,
      ).toBe(false);
    },
  );

  it("SemanticRelease 的 Metric/Dimension ID 接受恰好 63 字节与前导下划线 Alias", () => {
    const maxLengthId = `m${"a".repeat(62)}`;
    expect(metricBindingSchema.safeParse({ ...metric, metric_id: maxLengthId }).success).toBe(true);
    expect(
      dimensionBindingSchema.safeParse({
        dimension_id: "_customer",
        aliases: ["客户"],
        table_id: "orders",
        column_id: "orders.customer_id",
        grain: "order",
      }).success,
    ).toBe(true);
  });
});
