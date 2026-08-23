import { describe, expect, it } from "vitest";
import {
  ContextProjectionError,
  type ContextProjectionFilter,
  contextProjectionSchema,
  handoffReceiptSchema,
  L2_TEAM_ROLE_DEFINITIONS,
  prepareTeamHandoff,
  taskEnvelopeSchema,
} from "../src/teams/index.js";
import {
  APP_SCOPE,
  ARTIFACT_REF,
  CHILD_ATTEMPT_ID,
  CHILD_TASK_ID,
  HANDOFF_ID,
  makeParentTask,
  makeRequest,
  makeUntrustedContext,
  PARENT_ATTEMPT_ID,
  PARENT_TASK_ID,
  PROJECTION_ID,
  RUN_ID,
} from "./fixtures/team.js";

describe("L2 Team handoff", () => {
  it("固定且只导出首版四个 L2 角色", () => {
    expect(L2_TEAM_ROLE_DEFINITIONS).toEqual([
      {
        role: "research-supervisor",
        display_name: "Research Supervisor",
        responsibility: "维护研究问题、竞争假设、证据义务与委派预算。",
      },
      {
        role: "semantic-sql-worker",
        display_name: "Semantic/SQL Worker",
        responsibility: "把受治理语义编译为候选 LogicalPlan 与 SqlArtifact。",
      },
      {
        role: "evidence-worker",
        display_name: "Evidence Worker",
        responsibility: "核验查询证据、不变量与 Claim 支持关系。",
      },
      {
        role: "report-projector",
        display_name: "Report Projector",
        responsibility: "只从受引用约束的 Claim 与 Evidence 投影报告候选。",
      },
    ]);
  });

  it("只携带 Artifact Reference、有界数据、递减预算和收窄后的策略", async () => {
    const prepared = await prepareTeamHandoff(
      makeParentTask(),
      makeRequest(),
      makeUntrustedContext(),
    );

    expect(prepared.task).toMatchObject({
      task_id: CHILD_TASK_ID,
      attempt_id: CHILD_ATTEMPT_ID,
      scope: APP_SCOPE,
      run_id: RUN_ID,
      from_role: "research-supervisor",
      role: "semantic-sql-worker",
      artifact_refs: [ARTIFACT_REF],
      objective: "生成受 QueryContract 约束的候选逻辑计划。",
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 2_000,
        max_output_tokens: 1_000,
        max_tool_calls: 1,
        remaining_handoffs: 2,
        max_context_bytes: 8_192,
      },
      tool_policy: {
        policy_version: "team-policy-v1",
        allowlist: ["semantic.catalog.read"],
      },
      network_policy: {
        mode: "DENY",
        allowed_origins: [],
      },
    });
    expect(prepared.task.context.artifact_refs).toEqual([ARTIFACT_REF]);
    expect(prepared.task.context.data).toHaveLength(2);
    expect(prepared.task.context.data[0]).toMatchObject({
      trust: "UNTRUSTED_DATA",
      usage: "DATA_ONLY",
    });
    expect(prepared.task.context.data[0]?.content).toContain("订单状态");
    expect(JSON.stringify(prepared.task)).not.toContain("parent raw conversation");
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.task.context.data)).toBe(true);

    expect(handoffReceiptSchema.parse(prepared.receipt)).toMatchObject({
      handoff_id: HANDOFF_ID,
      parent_task_id: PARENT_TASK_ID,
      child_task_id: CHILD_TASK_ID,
      from_role: "research-supervisor",
      to_role: "semantic-sql-worker",
      context_projection_id: PROJECTION_ID,
      authority: "NON_AUTHORITATIVE_RUNTIME",
      status: "PREPARED",
    });
  });

  it("严格拒绝未知字段、跨 Scope Artifact 与无限 Context", () => {
    expect(() =>
      taskEnvelopeSchema.parse({
        ...makeParentTask(),
        raw_memory: ["parent raw conversation"],
      }),
    ).toThrow();

    expect(() =>
      taskEnvelopeSchema.parse({
        ...makeParentTask(),
        role: "evidence-worker",
      }),
    ).toThrow();

    expect(() =>
      taskEnvelopeSchema.parse({
        ...makeParentTask(),
        context: {
          ...makeParentTask().context,
          schema_version: "2.0.0",
        },
      }),
    ).toThrow();

    const crossScopeRef = {
      ...ARTIFACT_REF,
      tenant_id: "00000000-0000-4000-8000-000000000099",
    };
    expect(() =>
      contextProjectionSchema.parse({
        ...makeParentTask().context,
        artifact_refs: [crossScopeRef],
      }),
    ).toThrow();

    expect(() =>
      contextProjectionSchema.parse({
        ...makeParentTask().context,
        data: Array.from({ length: 65 }, (_, index) => ({
          source_kind: "source_text",
          source_ref: ARTIFACT_REF,
          label: `entry-${index}`,
          media_type: "text/plain",
          content: "x",
          trust: "UNTRUSTED_DATA",
          usage: "DATA_ONLY",
        })),
      }),
    ).toThrow();
  });

  it("拒绝预算、Tool 或 Network 扩权，并要求 handoff 深度严格递减", async () => {
    await expect(
      prepareTeamHandoff(
        makeParentTask(),
        {
          ...makeRequest(),
          budget: {
            ...makeRequest().budget,
            max_output_tokens: 4_001,
          },
        },
        makeUntrustedContext(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_BUDGET_ESCALATION",
    });

    await expect(
      prepareTeamHandoff(
        makeParentTask(),
        {
          ...makeRequest(),
          budget: {
            ...makeRequest().budget,
            remaining_handoffs: 3,
          },
        },
        makeUntrustedContext(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_BUDGET_ESCALATION",
    });

    await expect(
      prepareTeamHandoff(
        makeParentTask(),
        {
          ...makeRequest(),
          tool_allowlist: ["semantic.catalog.read", "sql.execute"],
        },
        makeUntrustedContext(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_TOOL_SCOPE_ESCALATION",
    });

    await expect(
      prepareTeamHandoff(
        makeParentTask(),
        {
          ...makeRequest(),
          network_policy: {
            mode: "ALLOWLIST",
            allowed_origins: ["https://example.com"],
          },
        },
        makeUntrustedContext(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_NETWORK_SCOPE_ESCALATION",
    });
  });

  it("拒绝越过角色图的 Handoff", async () => {
    await expect(
      prepareTeamHandoff(
        {
          ...makeParentTask(),
          from_role: "evidence-worker",
          role: "report-projector",
        },
        makeRequest(),
        makeUntrustedContext(),
      ),
    ).rejects.toMatchObject({
      code: "TEAM_HANDOFF_NOT_ALLOWED",
    });
  });

  it("projection/filter 抛错或返回完整父 Context 时失败关闭，且错误不泄露 raw context", async () => {
    const rawSecret = "parent raw conversation SECRET_VALUE_DO_NOT_LEAK";
    const throwingFilter: ContextProjectionFilter = async () => {
      throw new Error(rawSecret);
    };

    const thrown = await prepareTeamHandoff(
      makeParentTask(),
      makeRequest(),
      { raw: rawSecret },
      throwingFilter,
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ContextProjectionError);
    expect(thrown).toMatchObject({
      code: "CONTEXT_PROJECTION_FAILED",
      message: "Context Projection 失败，Handoff 已失败关闭。",
    });
    expect(JSON.stringify(thrown)).not.toContain(rawSecret);
    expect(String(thrown)).not.toContain(rawSecret);

    const fullParentContextFilter: ContextProjectionFilter = ({ raw_context }) => ({
      ...makeParentTask().context,
      raw_context,
    });
    await expect(
      prepareTeamHandoff(
        makeParentTask(),
        makeRequest(),
        { raw: rawSecret },
        fullParentContextFilter,
      ),
    ).rejects.toMatchObject({
      code: "CONTEXT_PROJECTION_FAILED",
    });
  });

  it("Handoff Receipt 自身也严格校验 scope、budget、tool 与 projection 绑定", async () => {
    const prepared = await prepareTeamHandoff(
      makeParentTask(),
      makeRequest(),
      makeUntrustedContext(),
    );

    expect(() =>
      handoffReceiptSchema.parse({
        ...prepared.receipt,
        budget: {
          ...prepared.receipt.budget,
          timeout_ms: 61_000,
        },
      }),
    ).toThrow();

    expect(() =>
      handoffReceiptSchema.parse({
        ...prepared.receipt,
        scope: {
          ...prepared.receipt.scope,
          app_id: "00000000-0000-4000-8000-000000000099",
        },
      }),
    ).toThrow();
  });

  it("Task 与 Receipt 固定父子关联字段", async () => {
    const prepared = await prepareTeamHandoff(
      makeParentTask(),
      makeRequest(),
      makeUntrustedContext(),
    );

    expect(prepared.task).toMatchObject({
      task_id: CHILD_TASK_ID,
      attempt_id: CHILD_ATTEMPT_ID,
    });
    expect(prepared.receipt).toMatchObject({
      handoff_id: HANDOFF_ID,
      parent_task_id: PARENT_TASK_ID,
      child_task_id: CHILD_TASK_ID,
      parent_attempt_id: PARENT_ATTEMPT_ID,
      child_attempt_id: CHILD_ATTEMPT_ID,
    });
  });
});
