import { describe, expect, it } from "vitest";
import {
  compileQueryContract,
  type QueryContractResolution,
} from "../src/contracts/query-contract.js";
import {
  artifactReference,
  fixtureIds,
  questionFrameAuthority,
  verifiedQuestionFrame,
} from "./support/commerce-fixture.js";

const completeResolution = {
  metric_candidates: ["metric.net_revenue"],
  dimensions: ["dimension.customer_segment"],
  grain: "order",
  time_range: {
    start: "2026-06-01T00:00:00.000+08:00",
    end: "2026-07-01T00:00:00.000+08:00",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  unit: "CNY",
  filters: [{ field: "orders.status", operator: "eq", value: "paid" }],
  datasource_id: fixtureIds.app,
  result_contract: {
    columns: ["dimension.customer_segment", "metric.net_revenue"],
    invariant_ids: ["non_negative_revenue"],
  },
} as const;

async function compileResolution(
  resolution: QueryContractResolution,
  options: {
    readonly authorizedDatasourceIds?: readonly string[];
    readonly currentCommitted?: boolean;
  } = {},
) {
  const questionFrame = await verifiedQuestionFrame(options.authorizedDatasourceIds);
  return compileQueryContract(
    {
      evidence_plan_ref: artifactReference("EvidencePlan"),
      question_frame: questionFrame,
      resolution,
    },
    questionFrameAuthority(questionFrame, options.currentCommitted ?? true),
  );
}

describe("QueryContract 编译", () => {
  it("没有 Metric 候选时返回可恢复的 CLARIFY，而不是抛出 Schema 异常", async () => {
    const result = await compileResolution({
      ...completeResolution,
      metric_candidates: [],
    });

    expect(result).toEqual({
      state: "CLARIFY",
      reason_code: "QUERY_CONTRACT_METRIC_UNRESOLVED",
      conflict_set: [],
    });
  });

  it("指标冲突未消解时返回 CLARIFY，不能产生 QueryContract", async () => {
    const result = await compileResolution({
      ...completeResolution,
      metric_candidates: ["metric.gross_revenue", "metric.net_revenue"],
    });

    expect(result).toEqual({
      state: "CLARIFY",
      reason_code: "QUERY_CONTRACT_METRIC_AMBIGUOUS",
      conflict_set: ["metric.gross_revenue", "metric.net_revenue"],
    });
    expect("query_contract" in result).toBe(false);
  });

  it("缺少显式时区或半开时间边界时失败关闭，不静默回退 UTC", async () => {
    const result = await compileResolution({
      ...completeResolution,
      time_range: null,
    });

    expect(result).toMatchObject({
      state: "CLARIFY",
      reason_code: "QUERY_CONTRACT_TIME_UNRESOLVED",
    });
  });

  it("只对授权 Datasource 生成冻结的 QueryContract", async () => {
    const result = await compileResolution(completeResolution);

    expect(result.state).toBe("READY");
    if (result.state !== "READY") throw new Error("测试 Fixture 应生成 QueryContract。");
    expect(result.query_contract).toMatchObject({
      artifact_type: "QueryContract",
      metric: "metric.net_revenue",
      datasource_id: fixtureIds.app,
      time_range: {
        timezone: "Asia/Shanghai",
      },
    });
    expect(Object.isFrozen(result.query_contract)).toBe(true);
  });

  it("Datasource 不在权威 QuestionFrame 冻结集合时失败关闭", async () => {
    const result = await compileResolution(
      {
        ...completeResolution,
        datasource_id: "00000000-0000-4000-8000-000000000099",
      },
      { authorizedDatasourceIds: [fixtureIds.app] },
    );

    expect(result).toEqual({
      state: "DENIED",
      reason_code: "QUERY_CONTRACT_DATASOURCE_DENIED",
    });
  });

  it("拒绝当前持久化上下文无法确认的 QuestionFrame", async () => {
    const result = await compileResolution(completeResolution, {
      currentCommitted: false,
    });

    expect(result).toEqual({
      state: "DENIED",
      reason_code: "QUERY_CONTRACT_QUESTION_FRAME_AUTHORITY_DENIED",
    });
  });

  it("在 QueryContract 边界拒绝没有 Table 限定的 Filter Field", async () => {
    await expect(
      compileResolution({
        ...completeResolution,
        filters: [{ field: "region", operator: "eq", value: "south" }],
      }),
    ).rejects.toThrow();
  });

  it("在 QueryContract 边界拒绝重复 Dimension 身份", async () => {
    await expect(
      compileResolution({
        ...completeResolution,
        dimensions: ["dimension.customer_segment", "dimension.customer_segment"],
        result_contract: {
          ...completeResolution.result_contract,
          columns: [
            "dimension.customer_segment",
            "dimension.customer_segment",
            "metric.net_revenue",
          ],
        },
      }),
    ).rejects.toThrow();
  });

  it("在 QueryContract 边界拒绝 Metric 与 Dimension 共用语义身份", async () => {
    await expect(
      compileResolution({
        ...completeResolution,
        dimensions: ["metric.net_revenue"],
        result_contract: {
          ...completeResolution.result_contract,
          columns: ["metric.net_revenue", "metric.net_revenue"],
        },
      }),
    ).rejects.toThrow();
  });
});
