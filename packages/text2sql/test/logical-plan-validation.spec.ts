import { hasLogicalPlanDataflow } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import { buildLogicalPlan } from "../src/planning/build-logical-plan.js";
import {
  isValidatedLogicalPlan,
  validateLogicalPlan,
} from "../src/planning/validate-logical-plan.js";
import { buildSemanticQuery } from "../src/semantic/build-semantic-query.js";
import { analystPolicy, commerceCatalog, netRevenueContract } from "./support/commerce-fixture.js";

async function validFixture() {
  const queryContract = netRevenueContract();
  const groundingResult = await groundQueryContract({
    query_contract: queryContract,
    catalog: commerceCatalog,
    policy: analystPolicy,
    retrieval_candidates: [],
    max_context_objects: 32,
  });
  if (groundingResult.state !== "READY") {
    throw new Error("LogicalPlan 测试 Fixture 应完成 Grounding。");
  }
  const semanticQuery = buildSemanticQuery({
    query_contract: queryContract,
    grounding: groundingResult.grounding,
  });
  const logicalPlan = buildLogicalPlan({
    semantic_query: semanticQuery,
    grounding: groundingResult.grounding,
  });
  return {
    queryContract,
    grounding: groundingResult.grounding,
    semanticQuery,
    logicalPlan,
  };
}

describe("LogicalPlan 确定性验证", () => {
  it("接受由同一 QueryContract 与 Grounding 编译出的拓扑有序 DAG", async () => {
    const fixture = await validFixture();

    const result = validateLogicalPlan({
      logical_plan: fixture.logicalPlan,
      grounding: fixture.grounding,
      semantic_query: fixture.semanticQuery,
      query_contract: fixture.queryContract,
    });
    expect(result.state).toBe("VALID");
    if (result.state !== "VALID") throw new Error("测试 Fixture 应通过 LogicalPlan 验证。");
    expect(isValidatedLogicalPlan(result.logical_plan)).toBe(true);
  });

  it("对未知或不完整输入失败关闭，并返回稳定 Schema Reason Code", () => {
    expect(validateLogicalPlan({ logical_plan: null })).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_INVALID_SCHEMA",
    });
  });

  it("拒绝重复 operation_id", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const first = candidate.operations[0];
    const second = candidate.operations[1];
    if (!first || !second) throw new Error("测试 Fixture 至少需要两个 Operation。");
    second.operation_id = first.operation_id;

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_DUPLICATE_OPERATION_ID",
    });
  });

  it("拒绝引用缺失节点", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const aggregate = candidate.operations.find((operation) => operation.operation === "aggregate");
    if (!aggregate) throw new Error("测试 Fixture 缺少 Aggregate Operation。");
    aggregate.input_id = "missing_operation";

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_INPUT_NOT_FOUND",
    });
  });

  it("拒绝引用未来节点的非拓扑顺序", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const aggregateIndex = candidate.operations.findIndex(
      (operation) => operation.operation === "aggregate",
    );
    if (aggregateIndex < 1) throw new Error("测试 Fixture 的 Aggregate 位置无效。");
    const aggregate = candidate.operations[aggregateIndex];
    if (aggregate?.operation !== "aggregate") {
      throw new Error("测试 Fixture 缺少 Aggregate Operation。");
    }
    const dependencyIndex = candidate.operations.findIndex(
      ({ operation_id }) => operation_id === aggregate.input_id,
    );
    if (dependencyIndex < 0 || dependencyIndex >= aggregateIndex) {
      throw new Error("测试 Fixture 的 Aggregate 依赖必须位于其前方。");
    }
    candidate.operations.splice(aggregateIndex, 1);
    candidate.operations.splice(dependencyIndex, 0, aggregate);

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_NOT_TOPOLOGICALLY_SORTED",
    });
  });

  it("拒绝不存在的 root_operation_id", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    candidate.root_operation_id = "missing_root";

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_ROOT_NOT_FOUND",
    });
  });

  it("在非拓扑检查前识别真实循环", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const aggregate = candidate.operations.find((operation) => operation.operation === "aggregate");
    if (!aggregate) throw new Error("测试 Fixture 缺少 Aggregate Operation。");
    const aggregateInput = candidate.operations.find(
      ({ operation_id }) => operation_id === aggregate.input_id,
    );
    if (aggregateInput?.operation !== "filter") {
      throw new Error("测试 Fixture 的 Aggregate 输入应为 Filter。");
    }
    aggregateInput.input_id = aggregate.operation_id;

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_CYCLE_DETECTED",
    });
  });

  it("拒绝引用未进入 GroundingPackage 的字段", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const scan = candidate.operations.find((operation) => operation.operation === "scan");
    if (!scan) throw new Error("测试 Fixture 缺少 Scan Operation。");
    scan.column_ids[0] = `${scan.table_id}.secret`;

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_FIELD_NOT_GROUNDED",
    });
  });

  it("即使列名在 Grounding 中存在，也拒绝由错误 Table 扫描该限定列", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const ordersScan = candidate.operations.find(
      (operation) => operation.operation === "scan" && operation.table_id === "orders",
    );
    if (ordersScan?.operation !== "scan") {
      throw new Error("测试 Fixture 缺少 orders Scan Operation。");
    }
    ordersScan.column_ids[0] = "customers.id";

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_INVALID_SCHEMA",
    });
  });

  it("Dataflow 使用 Table+Column 身份，不能借同名 Column 把 ACL Filter 放到错误分支", () => {
    expect(
      hasLogicalPlanDataflow(
        [
          {
            operation: "scan",
            operation_id: "scan_customers",
            table_id: "customers",
            alias: "t_customers",
            column_ids: ["orders.tenant_id"],
          },
          {
            operation: "filter",
            operation_id: "filter_wrong_branch",
            input_id: "scan_customers",
            predicates: [
              {
                kind: "comparison",
                left: { table_id: "orders", column_id: "orders.tenant_id" },
                operator: "eq",
                right: { parameter_key: "policy.tenant_id" },
                authority: "policy",
              },
            ],
          },
        ],
        "orders",
      ),
    ).toBe(false);
  });

  it("拒绝与冻结 QueryContract 不一致的结果签名", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    candidate.semantic_signature.unit = "USD";

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_RESULT_SIGNATURE_MISMATCH",
    });
  });

  it("拒绝未被 Root 消费的孤立 Operation", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const scan = candidate.operations.find((operation) => operation.operation === "scan");
    if (!scan) throw new Error("测试 Fixture 缺少 Scan Operation。");
    candidate.operations.push({
      ...scan,
      operation_id: "scan_unreachable",
    });

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_UNREACHABLE_OPERATION",
    });
  });

  it("拒绝不属于 Grounding Join Closure 的 Relationship", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const join = candidate.operations.find((operation) => operation.operation === "join");
    if (!join) throw new Error("测试 Fixture 缺少 Join Operation。");
    join.relationship.relationship_id = "invented_relationship";

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_RELATIONSHIP_NOT_GROUNDED",
    });
  });

  it("拒绝参数值漂移或遗漏 SemanticQuery 的时间 Predicate", async () => {
    const fixture = await validFixture();
    const parameterDrift = structuredClone(fixture.logicalPlan);
    parameterDrift.parameters["literal.status"] = {
      source: "literal",
      value: "cancelled",
    };
    expect(
      validateLogicalPlan({
        logical_plan: parameterDrift,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_PARAMETER_MISMATCH",
    });

    const predicateDrift = structuredClone(fixture.logicalPlan);
    const filter = predicateDrift.operations.find(
      (operation) =>
        operation.operation === "filter" &&
        operation.predicates.some(
          (predicate) => predicate.kind === "comparison" && predicate.authority === "time",
        ),
    );
    if (filter?.operation !== "filter") {
      throw new Error("测试 Fixture 缺少时间 Filter。");
    }
    filter.predicates = filter.predicates.filter(
      (predicate) =>
        !(
          predicate.kind === "comparison" &&
          predicate.authority === "time" &&
          predicate.operator === "lt"
        ),
    );

    expect(
      validateLogicalPlan({
        logical_plan: predicateDrift,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_PREDICATE_COVERAGE_MISMATCH",
    });
  });

  it("拒绝借用合法 Metric 标签聚合其他字段，或漂移 Group/Project 结果绑定", async () => {
    const fixture = await validFixture();
    const measureDrift = structuredClone(fixture.logicalPlan);
    const aggregate = measureDrift.operations.find(
      (operation) => operation.operation === "aggregate",
    );
    if (aggregate?.operation !== "aggregate") {
      throw new Error("测试 Fixture 缺少 Aggregate Operation。");
    }
    const measure = aggregate.measures[0];
    if (!measure) throw new Error("测试 Fixture 缺少 Metric Measure。");
    aggregate.measures[0] = {
      ...measure,
      field: { table_id: "orders", column_id: "orders.created_at" },
    };
    expect(
      validateLogicalPlan({
        logical_plan: measureDrift,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_MEASURE_MISMATCH",
    });

    const resultDrift = structuredClone(fixture.logicalPlan);
    const finalAggregate = resultDrift.operations.find(
      (operation) => operation.operation === "aggregate",
    );
    if (finalAggregate?.operation !== "aggregate") {
      throw new Error("测试 Fixture 缺少最终 Aggregate。");
    }
    finalAggregate.group_by[0] = {
      table_id: "orders",
      column_id: "orders.created_at",
    };
    expect(
      validateLogicalPlan({
        logical_plan: resultDrift,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_RESULT_BINDING_MISMATCH",
    });
  });

  it("单指标切片拒绝复制同一个 Aggregate Measure 后仍获得 VALID", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const aggregate = candidate.operations.find((operation) => operation.operation === "aggregate");
    if (aggregate?.operation !== "aggregate" || !aggregate.measures[0]) {
      throw new Error("测试 Fixture 缺少 Aggregate Measure。");
    }
    aggregate.measures.push(structuredClone(aggregate.measures[0]));

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_INVALID_SCHEMA",
    });
  });

  it("公开验证器与最终 Authority 一致：Project 必须直接消费最终 Aggregate", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const projectIndex = candidate.operations.findIndex(
      (operation) => operation.operation === "project",
    );
    const project = candidate.operations[projectIndex];
    if (project?.operation !== "project") {
      throw new Error("测试 Fixture 缺少 Project Operation。");
    }
    const aggregateInputId = project.input_id;
    const existingFilter = candidate.operations.find(
      (operation) => operation.operation === "filter",
    );
    if (existingFilter?.operation !== "filter") {
      throw new Error("测试 Fixture 缺少 Filter Operation。");
    }
    candidate.operations.splice(projectIndex, 0, {
      ...existingFilter,
      operation_id: "filter_after_aggregate",
      input_id: aggregateInputId,
    });
    project.input_id = "filter_after_aggregate";

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_RESULT_BINDING_MISMATCH",
    });
  });

  it("首版 QueryContract 没有 order/limit 语义，验证器明确拒绝 Sort/Limit", async () => {
    const fixture = await validFixture();
    const unsupportedOperations = [
      {
        operation: "sort",
        operation_id: "sort_result",
        input_id: fixture.logicalPlan.root_operation_id,
        keys: [{ source_id: fixture.semanticQuery.metric.metric_id, direction: "desc" }],
      },
      {
        operation: "limit",
        operation_id: "limit_result",
        input_id: fixture.logicalPlan.root_operation_id,
        count: 100,
      },
    ];

    for (const unsupportedOperation of unsupportedOperations) {
      expect(
        validateLogicalPlan({
          logical_plan: {
            ...fixture.logicalPlan,
            operations: [...fixture.logicalPlan.operations, unsupportedOperation],
          },
          grounding: fixture.grounding,
          semantic_query: fixture.semanticQuery,
          query_contract: fixture.queryContract,
        }),
      ).toEqual({
        state: "INVALID",
        reason_code: "LOGICAL_PLAN_INVALID_SCHEMA",
      });
    }
  });

  it("拒绝 Grounding Join Closure 未授权的 Preaggregation", async () => {
    const fixture = await validFixture();
    const candidate = structuredClone(fixture.logicalPlan);
    const aggregateIndex = candidate.operations.findIndex(
      (operation) => operation.operation === "aggregate",
    );
    const aggregate = candidate.operations[aggregateIndex];
    if (aggregate?.operation !== "aggregate" || !aggregate.measures[0]) {
      throw new Error("测试 Fixture 缺少 Aggregate Measure。");
    }
    candidate.operations.splice(aggregateIndex, 0, {
      operation: "preaggregate",
      operation_id: "preaggregate_unproven",
      input_id: aggregate.input_id,
      group_by: [{ table_id: "orders", column_id: "orders.created_at" }],
      measures: [aggregate.measures[0]],
      reason_code: "FANOUT_PREAGG_REQUIRED",
    });
    aggregate.input_id = "preaggregate_unproven";

    expect(
      validateLogicalPlan({
        logical_plan: candidate,
        grounding: fixture.grounding,
        semantic_query: fixture.semanticQuery,
        query_contract: fixture.queryContract,
      }),
    ).toEqual({
      state: "INVALID",
      reason_code: "LOGICAL_PLAN_PREAGGREGATION_MISMATCH",
    });
  });
});
