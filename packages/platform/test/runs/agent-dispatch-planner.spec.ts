import type { AgentProductProfileRegistryItem } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  classifyAgentQuestion,
  classifyAgentVisualizationIntent,
  planAgentDispatch,
} from "../../src/runs/agent-dispatch-planner.js";

const runId = "00000000-0000-4000-8000-000000000101";
const policyVersion = "adaptive-routing@1.0.0+rollout.2";
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function profile(
  profileId: "governed-text2sql-agent" | "report-writing-agent" | "semantic-management-agent",
  index: number,
): AgentProductProfileRegistryItem {
  const revision = profileId === "semantic-management-agent" ? 2 : 1;
  const revisionHash = hash(String(index));
  return {
    revision: {
      profile_id: profileId,
      revision,
      revision_hash: revisionHash,
      approval_status: "APPROVED",
    },
    head: {
      profile_id: profileId,
      active_revision: revision,
      active_revision_hash: revisionHash,
      lifecycle: "ENABLED",
    },
  } as AgentProductProfileRegistryItem;
}

const catalog = [
  profile("governed-text2sql-agent", 1),
  profile("report-writing-agent", 2),
  profile("semantic-management-agent", 3),
];

describe("adaptive Agent dispatch planner", () => {
  it("classifies ambiguous business questions fail-closed", () => {
    expect(classifyAgentQuestion("为什么订单下降")).toBe("DATA_QUERY");
    expect(classifyAgentQuestion("解释本月销售变化")).toBe("DATA_QUERY");
    expect(classifyAgentQuestion("什么是同比")).toBe("EXPLANATION");
    expect(classifyAgentQuestion("指标定义是什么")).toBe("SEMANTIC_READ");
    expect(classifyAgentQuestion("写一份销售报告")).toBe("REPORT");
    expect(classifyAgentQuestion("做个经营分析报告")).toBe("REPORT");
    expect(classifyAgentQuestion("输出周报")).toBe("REPORT");
  });

  it("freezes visualization intent only for explicit trend, comparison, or composition questions", () => {
    expect(classifyAgentVisualizationIntent("按月展示订单趋势")).toBe("TREND");
    expect(classifyAgentVisualizationIntent("比较各品类销售额排名")).toBe("COMPARISON");
    expect(classifyAgentVisualizationIntent("各渠道订单占比")).toBe("COMPOSITION");
    expect(classifyAgentVisualizationIntent("本月订单是多少")).toBeNull();
  });

  it("always defers formal attribution before every rollout executor branch", async () => {
    for (const rolloutMode of ["SHADOW", "ENFORCED", "ROOT_ONLY_DEFER_DATA"] as const) {
      await expect(
        planAgentDispatch({
          run_id: runId,
          question: "请给出订单下降的正式归因结论",
          enabled_profiles: catalog,
          rollout_mode: rolloutMode,
          policy_version: policyVersion,
        }),
      ).resolves.toMatchObject({
        admission: {
          kind: "DEFERRED",
          question_class: "ATTRIBUTION",
          reason_code: "ATTRIBUTION_RUNTIME_NOT_READY",
          required_capabilities: ["attribution.acceptance@1.0.0"],
        },
        shadow_plan: null,
      });
    }
  });

  it("freezes ENFORCED DIRECT with zero profiles and Text2SQL-only TEAM", async () => {
    const direct = await planAgentDispatch({
      run_id: runId,
      question: "什么是同比",
      enabled_profiles: catalog,
      rollout_mode: "ENFORCED",
      policy_version: policyVersion,
    });
    expect(direct).toMatchObject({
      admission: {
        kind: "EXECUTE",
        plan: { mode: "DIRECT", selected_profile_refs: [] },
        binding: {
          effective_executor_version: "ADAPTIVE@1",
          selected_profile_refs: [],
          policy_version: policyVersion,
        },
      },
      shadow_plan: null,
    });
    const data = await planAgentDispatch({
      run_id: runId,
      question: "本月订单是多少",
      enabled_profiles: catalog,
      rollout_mode: "ENFORCED",
      policy_version: policyVersion,
    });
    expect(data.admission).toMatchObject({
      kind: "EXECUTE",
      plan: {
        question_class: "DATA_QUERY",
        selected_profile_refs: [{ profile_id: "governed-text2sql-agent" }],
      },
    });

    const trend = await planAgentDispatch({
      run_id: runId,
      question: "按月展示订单趋势",
      enabled_profiles: catalog,
      rollout_mode: "ENFORCED",
      policy_version: policyVersion,
    });
    expect(trend.admission).toMatchObject({
      kind: "EXECUTE",
      plan: {
        reason_codes: ["DATA_QUERY_SPECIALIST_REQUIRED", "DATA_QUERY_TREND_VISUALIZATION"],
      },
    });
  });

  it("freezes Report DAG and legacy SHADOW binding", async () => {
    const enforced = await planAgentDispatch({
      run_id: runId,
      question: "生成正式报告",
      enabled_profiles: catalog,
      rollout_mode: "ENFORCED",
      policy_version: policyVersion,
    });
    expect(enforced.admission).toMatchObject({
      kind: "EXECUTE",
      plan: {
        selected_profile_refs: [
          { profile_id: "governed-text2sql-agent" },
          { profile_id: "report-writing-agent" },
        ],
        dependency_edges: [
          {
            from_profile_id: "governed-text2sql-agent",
            to_profile_id: "report-writing-agent",
            evidence_requirement: "ACCEPTED_QUERY_EVIDENCE",
          },
        ],
      },
    });
    const shadow = await planAgentDispatch({
      run_id: runId,
      question: "本月订单是多少",
      enabled_profiles: catalog,
      rollout_mode: "SHADOW",
      policy_version: policyVersion,
    });
    expect(shadow).toMatchObject({
      admission: {
        kind: "EXECUTE",
        binding: { effective_executor_version: "LEGACY_FIXED@1" },
        plan: { selected_profile_refs: expect.any(Array) },
      },
      shadow_plan: { question_class: "DATA_QUERY" },
    });
    if (shadow.admission.kind === "EXECUTE") {
      expect(shadow.admission.plan.selected_profile_refs).toHaveLength(3);
    }
  });

  it("returns durable-admission DEFERRED decisions for root-only and missing capability", async () => {
    await expect(
      planAgentDispatch({
        run_id: runId,
        question: "本月订单是多少",
        enabled_profiles: catalog,
        rollout_mode: "ROOT_ONLY_DEFER_DATA",
        policy_version: policyVersion,
      }),
    ).resolves.toMatchObject({
      admission: { kind: "DEFERRED", reason_code: "ROOT_ONLY_DEFER_DATA" },
    });
    await expect(
      planAgentDispatch({
        run_id: runId,
        question: "生成正式报告",
        enabled_profiles: catalog.filter(
          ({ revision }) => revision.profile_id !== "report-writing-agent",
        ),
        rollout_mode: "ENFORCED",
        policy_version: policyVersion,
      }),
    ).resolves.toMatchObject({
      admission: { kind: "DEFERRED", reason_code: "AGENT_PROFILE_NOT_ALLOWED" },
    });
    await expect(
      planAgentDispatch({
        run_id: runId,
        question: "修改指标定义并发布语义层",
        enabled_profiles: catalog,
        rollout_mode: "ENFORCED",
        policy_version: policyVersion,
      }),
    ).resolves.toMatchObject({
      admission: { kind: "DEFERRED", reason_code: "SEMANTIC_GOVERNANCE_MUTATION_NOT_READY" },
    });
  });
});
