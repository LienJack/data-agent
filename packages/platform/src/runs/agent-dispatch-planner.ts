import { createHash } from "node:crypto";
import {
  type AgentDispatchAdmissionResult,
  type AgentDispatchPlan,
  type AgentProductProfileReference,
  type AgentProductProfileRegistryItem,
  type AgentQuestionClass,
  buildAgentDispatchDeferredReceipt,
  buildAgentDispatchExecuteAdmission,
  buildAgentDispatchExecutionBinding,
  buildAgentDispatchPlan,
  buildDirectAdmissibilityReceipt,
  sha256ContentHash,
} from "@data-agent/contracts";

export type AgentDispatchRolloutMode = "SHADOW" | "ENFORCED" | "ROOT_ONLY_DEFER_DATA";

export type PlannedAgentDispatch = Readonly<{
  admission: AgentDispatchAdmissionResult;
  shadow_plan: AgentDispatchPlan | null;
}>;

const profileOrder = [
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

function uuid(material: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/adaptive-dispatch@1\0${material}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactEnabledReferences(
  profiles: readonly AgentProductProfileRegistryItem[],
): ReadonlyMap<AgentProductProfileReference["profile_id"], AgentProductProfileReference> {
  const result = new Map<
    AgentProductProfileReference["profile_id"],
    AgentProductProfileReference
  >();
  for (const item of profiles) {
    const { revision, head } = item;
    if (
      head.lifecycle !== "ENABLED" ||
      revision.approval_status !== "APPROVED" ||
      head.profile_id !== revision.profile_id ||
      head.active_revision !== revision.revision ||
      head.active_revision_hash !== revision.revision_hash ||
      result.has(revision.profile_id)
    ) {
      continue;
    }
    result.set(revision.profile_id, {
      profile_id: revision.profile_id,
      revision: revision.revision,
      revision_hash: revision.revision_hash,
    });
  }
  return result;
}

export function classifyAgentQuestion(question: string): AgentQuestionClass {
  const normalized = question.trim().toLocaleLowerCase("zh-CN");
  if (/(归因|因果|causal|attribution)/u.test(normalized)) return "ATTRIBUTION";
  if (/(报告|周报|月报|report)/u.test(normalized)) return "REPORT";
  if (/(指标定义|指标口径|公式定义|语义层|semantic|metric definition)/u.test(normalized)) {
    return "SEMANTIC_READ";
  }
  const businessInstanceSignal =
    /(本月|今天|昨日|今年|去年|订单|销售|收入|用户|客户|产品|下降|增长|变化|趋势|多少|排名|明细|查询|统计|数据|表格|图表|sql|分析)/u.test(
      normalized,
    );
  const explicitConceptExplanation =
    /^(什么是|解释.{0,12}(概念|定义|含义)|说明.{0,12}(概念|定义|含义)|介绍.{0,12}(概念|定义)|explain the concept|define |what is )/u.test(
      normalized,
    );
  return explicitConceptExplanation && !businessInstanceSignal ? "EXPLANATION" : "DATA_QUERY";
}

function selectedIds(questionClass: AgentQuestionClass) {
  switch (questionClass) {
    case "EXPLANATION":
      return [] as const;
    case "SEMANTIC_READ":
      return ["semantic-management-agent"] as const;
    case "DATA_QUERY":
      return ["governed-text2sql-agent"] as const;
    case "REPORT":
      return ["governed-text2sql-agent", "report-writing-agent"] as const;
    case "ATTRIBUTION":
      return [] as const;
  }
}

async function adaptivePlan(input: {
  readonly run_id: string;
  readonly question_class: AgentQuestionClass;
  readonly refs: ReadonlyMap<
    AgentProductProfileReference["profile_id"],
    AgentProductProfileReference
  >;
  readonly capability_snapshot_hash: string;
  readonly policy_version: string;
}): Promise<AgentDispatchPlan | Extract<AgentDispatchAdmissionResult, { kind: "DEFERRED" }>> {
  if (input.question_class === "ATTRIBUTION") {
    return buildAgentDispatchDeferredReceipt({
      kind: "DEFERRED",
      schema_version: "agent-dispatch-deferred-receipt@1.0.0",
      run_id: input.run_id,
      question_class: input.question_class,
      reason_code: "ATTRIBUTION_RUNTIME_NOT_READY",
      required_capabilities: ["attribution.acceptance@1.0.0"],
      policy_version: input.policy_version,
      capability_snapshot_hash: input.capability_snapshot_hash,
    });
  }
  const selected = selectedIds(input.question_class);
  const missing = selected.filter((profileId) => !input.refs.has(profileId));
  if (missing.length > 0) {
    return buildAgentDispatchDeferredReceipt({
      kind: "DEFERRED",
      schema_version: "agent-dispatch-deferred-receipt@1.0.0",
      run_id: input.run_id,
      question_class: input.question_class,
      reason_code: "AGENT_PROFILE_NOT_ALLOWED",
      required_capabilities: missing.map((profileId) => `agent-profile.${profileId}`),
      policy_version: input.policy_version,
      capability_snapshot_hash: input.capability_snapshot_hash,
    });
  }
  const selectedRefs = selected.flatMap((profileId) => {
    const ref = input.refs.get(profileId);
    return ref ? [ref] : [];
  });
  const direct =
    input.question_class === "EXPLANATION"
      ? await buildDirectAdmissibilityReceipt({
          schema_version: "direct-admissibility-receipt@1.0.0",
          no_new_facts: true,
          no_governance_mutation: true,
          no_formal_report: true,
          policy_version: input.policy_version,
          capability_snapshot_hash: input.capability_snapshot_hash,
        })
      : null;
  return buildAgentDispatchPlan({
    schema_version: "agent-dispatch-plan@1.0.0",
    plan_id: uuid(`${input.run_id}:adaptive-plan`),
    run_id: input.run_id,
    question_class: input.question_class,
    mode: input.question_class === "EXPLANATION" ? "DIRECT" : "TEAM",
    selected_profile_refs: selectedRefs,
    dependency_edges:
      input.question_class === "REPORT"
        ? [
            {
              from_profile_id: "governed-text2sql-agent",
              to_profile_id: "report-writing-agent",
              evidence_requirement: "ACCEPTED_QUERY_EVIDENCE",
            },
          ]
        : [],
    required_evidence:
      input.question_class === "EXPLANATION"
        ? ["DIRECT_PROVIDER_RECEIPT"]
        : input.question_class === "SEMANTIC_READ"
          ? ["FROZEN_SEMANTIC_RELEASE"]
          : input.question_class === "DATA_QUERY"
            ? ["ACCEPTED_QUERY_EVIDENCE", "FROZEN_SEMANTIC_RELEASE"]
            : ["ACCEPTED_QUERY_EVIDENCE", "ACCEPTED_REPORT_ARTIFACT", "FROZEN_SEMANTIC_RELEASE"],
    reason_codes: [
      input.question_class === "EXPLANATION"
        ? "DIRECT_EXPLANATION_ADMISSIBLE"
        : `${input.question_class}_SPECIALIST_REQUIRED`,
    ],
    capability_snapshot_hash: input.capability_snapshot_hash,
    policy_version: input.policy_version,
    direct_admissibility_receipt: direct,
  });
}

export async function planAgentDispatch(input: {
  readonly run_id: string;
  readonly question: string;
  readonly enabled_profiles: readonly AgentProductProfileRegistryItem[];
  readonly rollout_mode: AgentDispatchRolloutMode;
  readonly policy_version: string;
}): Promise<PlannedAgentDispatch> {
  const questionClass = classifyAgentQuestion(input.question);
  const refs = exactEnabledReferences(input.enabled_profiles);
  const canonicalRefs = profileOrder.flatMap((profileId) => {
    const ref = refs.get(profileId);
    return ref ? [ref] : [];
  });
  const capabilitySnapshotHash = await sha256ContentHash({ profile_refs: canonicalRefs });
  if (
    /(修改|新增|创建|删除|调整|更新|发布|废弃).{0,16}(指标|公式|语义层)|(指标|公式|语义层).{0,16}(修改|新增|创建|删除|调整|更新|发布|废弃)/u.test(
      input.question.trim(),
    )
  ) {
    return {
      admission: await buildAgentDispatchDeferredReceipt({
        kind: "DEFERRED",
        schema_version: "agent-dispatch-deferred-receipt@1.0.0",
        run_id: input.run_id,
        question_class: "SEMANTIC_READ",
        reason_code: "SEMANTIC_GOVERNANCE_MUTATION_NOT_READY",
        required_capabilities: ["semantic-governance-mutation@1.0.0"],
        policy_version: input.policy_version,
        capability_snapshot_hash: capabilitySnapshotHash,
      }),
      shadow_plan: null,
    };
  }
  const planned = await adaptivePlan({
    run_id: input.run_id,
    question_class: questionClass,
    refs,
    capability_snapshot_hash: capabilitySnapshotHash,
    policy_version: input.policy_version,
  });
  if ("kind" in planned) {
    return { admission: planned, shadow_plan: null };
  }
  if (input.rollout_mode === "ROOT_ONLY_DEFER_DATA" && planned.question_class !== "EXPLANATION") {
    return {
      admission: await buildAgentDispatchDeferredReceipt({
        kind: "DEFERRED",
        schema_version: "agent-dispatch-deferred-receipt@1.0.0",
        run_id: input.run_id,
        question_class: planned.question_class,
        reason_code: "ROOT_ONLY_DEFER_DATA",
        required_capabilities: ["adaptive-team-runtime@1.0.0"],
        policy_version: input.policy_version,
        capability_snapshot_hash: capabilitySnapshotHash,
      }),
      shadow_plan: null,
    };
  }
  if (input.rollout_mode === "SHADOW") {
    if (canonicalRefs.length !== profileOrder.length) {
      return {
        admission: await buildAgentDispatchDeferredReceipt({
          kind: "DEFERRED",
          schema_version: "agent-dispatch-deferred-receipt@1.0.0",
          run_id: input.run_id,
          question_class: planned.question_class,
          reason_code: "AGENT_PROFILE_NOT_ALLOWED",
          required_capabilities: ["legacy-fixed-profile-set@1.0.0"],
          policy_version: input.policy_version,
          capability_snapshot_hash: capabilitySnapshotHash,
        }),
        shadow_plan: null,
      };
    }
    const legacyPlan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: uuid(`${input.run_id}:legacy-plan`),
      run_id: input.run_id,
      question_class: planned.question_class,
      mode: "TEAM",
      selected_profile_refs: canonicalRefs,
      dependency_edges: [
        {
          from_profile_id: "governed-text2sql-agent",
          to_profile_id: "report-writing-agent",
          evidence_requirement: "ACCEPTED_QUERY_EVIDENCE",
        },
      ],
      required_evidence: [
        "ACCEPTED_QUERY_EVIDENCE",
        "ACCEPTED_REPORT_ARTIFACT",
        "FROZEN_SEMANTIC_RELEASE",
      ],
      reason_codes: ["SHADOW_LEGACY_EXECUTOR_FROZEN"],
      capability_snapshot_hash: capabilitySnapshotHash,
      policy_version: input.policy_version,
      direct_admissibility_receipt: null,
    });
    const binding = await buildAgentDispatchExecutionBinding({
      schema_version: "agent-dispatch-execution-binding@1.0.0",
      run_id: input.run_id,
      effective_executor_version: "LEGACY_FIXED@1",
      dispatch_plan_ref: { plan_id: legacyPlan.plan_id, plan_hash: legacyPlan.plan_hash },
      selected_profile_refs: canonicalRefs,
      policy_version: input.policy_version,
      capability_snapshot_hash: capabilitySnapshotHash,
      shadow_dispatch_plan_ref: { plan_id: planned.plan_id, plan_hash: planned.plan_hash },
    });
    return {
      admission: await buildAgentDispatchExecuteAdmission({
        kind: "EXECUTE",
        plan: legacyPlan,
        binding,
      }),
      shadow_plan: planned,
    };
  }
  const binding = await buildAgentDispatchExecutionBinding({
    schema_version: "agent-dispatch-execution-binding@1.0.0",
    run_id: input.run_id,
    effective_executor_version: "ADAPTIVE@1",
    dispatch_plan_ref: { plan_id: planned.plan_id, plan_hash: planned.plan_hash },
    selected_profile_refs: planned.selected_profile_refs,
    policy_version: input.policy_version,
    capability_snapshot_hash: capabilitySnapshotHash,
    shadow_dispatch_plan_ref: null,
  });
  return {
    admission: await buildAgentDispatchExecuteAdmission({
      kind: "EXECUTE",
      plan: planned,
      binding,
    }),
    shadow_plan: null,
  };
}
