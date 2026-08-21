import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { canonicalImmutableIdSchema } from "../workspaces/defaults.js";
import {
  type AgentProductProfileReference,
  agentProductProfileReferenceSchema,
  agentSpecialistProfileIdSchema,
} from "./profile-registry.js";

export const agentQuestionClassSchema = z.enum([
  "EXPLANATION",
  "SEMANTIC_READ",
  "DATA_QUERY",
  "REPORT",
  "ATTRIBUTION",
]);

export const agentDispatchModeSchema = z.enum(["DIRECT", "TEAM"]);
export const agentDispatchExecutorVersionSchema = z.enum(["LEGACY_FIXED@1", "ADAPTIVE@1"]);

export const agentDispatchEvidenceRequirementSchema = z.enum([
  "DIRECT_PROVIDER_RECEIPT",
  "FROZEN_SEMANTIC_RELEASE",
  "ACCEPTED_QUERY_EVIDENCE",
  "ACCEPTED_REPORT_ARTIFACT",
]);

const directAdmissibilityReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("direct-admissibility-receipt@1.0.0"),
  no_new_facts: z.literal(true),
  no_governance_mutation: z.literal(true),
  no_formal_report: z.literal(true),
  policy_version: versionIdentifierSchema,
  capability_snapshot_hash: contentHashSchema,
});

export const directAdmissibilityReceiptSchema = directAdmissibilityReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export async function buildDirectAdmissibilityReceipt(input: unknown) {
  const draft = directAdmissibilityReceiptDraftSchema.parse(input);
  return deepFreeze(
    directAdmissibilityReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyDirectAdmissibilityReceipt(input: unknown) {
  const receipt = directAdmissibilityReceiptSchema.parse(input);
  const { receipt_hash: actual, ...draft } = receipt;
  if ((await sha256ContentHash(directAdmissibilityReceiptDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("DIRECT_ADMISSIBILITY_RECEIPT_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const agentDispatchDependencyEdgeSchema = z
  .strictObject({
    from_profile_id: agentSpecialistProfileIdSchema,
    to_profile_id: agentSpecialistProfileIdSchema,
    evidence_requirement: agentDispatchEvidenceRequirementSchema,
  })
  .superRefine((edge, ctx) => {
    if (edge.from_profile_id === edge.to_profile_id) {
      ctx.addIssue({ code: "custom", message: "Agent dependency 不能自循环。" });
    }
  });

const profileOrder = new Map(
  agentSpecialistProfileIdSchema.options.map((profileId, index) => [profileId, index]),
);

function profileIndex(profileId: z.infer<typeof agentSpecialistProfileIdSchema>): number {
  return profileOrder.get(profileId) ?? Number.MAX_SAFE_INTEGER;
}

function canonicalUniqueStrings(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
}

function canonicalProfileRefs(references: readonly AgentProductProfileReference[]): boolean {
  return references.every(
    (reference, index) =>
      index === 0 ||
      profileIndex(reference.profile_id) >
        profileIndex(references[index - 1]?.profile_id ?? reference.profile_id),
  );
}

function edgeKey(edge: z.infer<typeof agentDispatchDependencyEdgeSchema>): string {
  return `${profileIndex(edge.from_profile_id)}:${profileIndex(edge.to_profile_id)}:${edge.evidence_requirement}`;
}

const canonicalSelectedProfileRefsSchema = z
  .array(agentProductProfileReferenceSchema)
  .max(agentSpecialistProfileIdSchema.options.length)
  .superRefine((references, ctx) => {
    if (!canonicalProfileRefs(references)) {
      ctx.addIssue({
        code: "custom",
        message: "selected_profile_refs 必须唯一且按 built-in Profile 顺序排列。",
      });
    }
  });

const canonicalDependencyEdgesSchema = z
  .array(agentDispatchDependencyEdgeSchema)
  .max(8)
  .superRefine((edges, ctx) => {
    const keys = edges.map(edgeKey);
    if (!canonicalUniqueStrings(keys)) {
      ctx.addIssue({ code: "custom", message: "dependency_edges 必须唯一且规范排序。" });
    }
  });

const canonicalEvidenceRequirementsSchema = z
  .array(agentDispatchEvidenceRequirementSchema)
  .max(agentDispatchEvidenceRequirementSchema.options.length)
  .superRefine((requirements, ctx) => {
    if (!canonicalUniqueStrings(requirements)) {
      ctx.addIssue({ code: "custom", message: "required_evidence 必须唯一且规范排序。" });
    }
  });

const reasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);

const canonicalReasonCodesSchema = z
  .array(reasonCodeSchema)
  .min(1)
  .max(16)
  .superRefine((reasons, ctx) => {
    if (!canonicalUniqueStrings(reasons)) {
      ctx.addIssue({ code: "custom", message: "reason_codes 必须唯一且规范排序。" });
    }
  });

const agentDispatchPlanDraftSchema = z
  .strictObject({
    schema_version: z.literal("agent-dispatch-plan@1.0.0"),
    plan_id: canonicalImmutableIdSchema,
    run_id: canonicalImmutableIdSchema,
    question_class: agentQuestionClassSchema,
    mode: agentDispatchModeSchema,
    selected_profile_refs: canonicalSelectedProfileRefsSchema,
    dependency_edges: canonicalDependencyEdgesSchema,
    required_evidence: canonicalEvidenceRequirementsSchema,
    reason_codes: canonicalReasonCodesSchema,
    capability_snapshot_hash: contentHashSchema,
    policy_version: versionIdentifierSchema,
    direct_admissibility_receipt: directAdmissibilityReceiptSchema.nullable(),
  })
  .superRefine((plan, ctx) => {
    const selected = new Set(plan.selected_profile_refs.map(({ profile_id: id }) => id));
    if (plan.mode === "DIRECT") {
      if (
        plan.question_class !== "EXPLANATION" ||
        plan.selected_profile_refs.length !== 0 ||
        plan.dependency_edges.length !== 0 ||
        plan.direct_admissibility_receipt === null ||
        plan.required_evidence.length !== 1 ||
        plan.required_evidence[0] !== "DIRECT_PROVIDER_RECEIPT"
      ) {
        ctx.addIssue({ code: "custom", message: "DIRECT plan 不满足解释类零委派合同。" });
      }
    } else if (
      plan.selected_profile_refs.length === 0 ||
      plan.direct_admissibility_receipt !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "TEAM plan 必须选择 Agent 且不能携带 DIRECT receipt。",
      });
    }
    for (const [index, edge] of plan.dependency_edges.entries()) {
      if (!selected.has(edge.from_profile_id) || !selected.has(edge.to_profile_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Agent dependency 两端必须都属于 selected profiles。",
          path: ["dependency_edges", index],
        });
      }
    }
    const outgoing = new Map<string, string[]>();
    for (const edge of plan.dependency_edges) {
      outgoing.set(edge.from_profile_id, [
        ...(outgoing.get(edge.from_profile_id) ?? []),
        edge.to_profile_id,
      ]);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (profileId: string): boolean => {
      if (visiting.has(profileId)) return true;
      if (visited.has(profileId)) return false;
      visiting.add(profileId);
      for (const target of outgoing.get(profileId) ?? []) {
        if (hasCycle(target)) return true;
      }
      visiting.delete(profileId);
      visited.add(profileId);
      return false;
    };
    if ([...selected].some(hasCycle)) {
      ctx.addIssue({ code: "custom", message: "Agent dependency graph 必须是 DAG。" });
    }
    if (selected.has("report-writing-agent")) {
      const reportDependency = plan.dependency_edges.some(
        (edge) =>
          edge.from_profile_id === "governed-text2sql-agent" &&
          edge.to_profile_id === "report-writing-agent" &&
          edge.evidence_requirement === "ACCEPTED_QUERY_EVIDENCE",
      );
      if (!selected.has("governed-text2sql-agent") || !reportDependency) {
        ctx.addIssue({
          code: "custom",
          message: "Report 必须依赖 selected Text2SQL 的 accepted QueryEvidence。",
          path: ["dependency_edges"],
        });
      }
    }
    const direct = plan.direct_admissibility_receipt;
    if (
      direct &&
      (direct.policy_version !== plan.policy_version ||
        direct.capability_snapshot_hash !== plan.capability_snapshot_hash)
    ) {
      ctx.addIssue({ code: "custom", message: "DIRECT receipt 必须绑定同一策略与能力快照。" });
    }
  });

export const agentDispatchPlanSchema = agentDispatchPlanDraftSchema.extend({
  plan_hash: contentHashSchema,
});

export async function buildAgentDispatchPlan(input: unknown) {
  const candidate = input as Record<string, unknown>;
  const direct =
    candidate.direct_admissibility_receipt === null ||
    candidate.direct_admissibility_receipt === undefined
      ? candidate.direct_admissibility_receipt
      : await verifyDirectAdmissibilityReceipt(candidate.direct_admissibility_receipt);
  const draft = agentDispatchPlanDraftSchema.parse({
    ...candidate,
    direct_admissibility_receipt: direct,
  });
  return deepFreeze(
    agentDispatchPlanSchema.parse({ ...draft, plan_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifyAgentDispatchPlan(input: unknown) {
  const plan = agentDispatchPlanSchema.parse(input);
  if (plan.direct_admissibility_receipt) {
    await verifyDirectAdmissibilityReceipt(plan.direct_admissibility_receipt);
  }
  const { plan_hash: actual, ...draft } = plan;
  if ((await sha256ContentHash(agentDispatchPlanDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("AGENT_DISPATCH_PLAN_HASH_MISMATCH");
  }
  return deepFreeze(plan);
}

export const agentDispatchPlanReferenceSchema = z.strictObject({
  plan_id: canonicalImmutableIdSchema,
  plan_hash: contentHashSchema,
});

const agentDispatchExecutionBindingDraftSchema = z
  .strictObject({
    schema_version: z.literal("agent-dispatch-execution-binding@1.0.0"),
    run_id: canonicalImmutableIdSchema,
    effective_executor_version: agentDispatchExecutorVersionSchema,
    dispatch_plan_ref: agentDispatchPlanReferenceSchema,
    selected_profile_refs: canonicalSelectedProfileRefsSchema,
    policy_version: versionIdentifierSchema,
    capability_snapshot_hash: contentHashSchema,
    shadow_dispatch_plan_ref: agentDispatchPlanReferenceSchema.nullable(),
  })
  .superRefine((binding, ctx) => {
    if (
      binding.effective_executor_version === "ADAPTIVE@1" &&
      binding.shadow_dispatch_plan_ref !== null
    ) {
      ctx.addIssue({ code: "custom", message: "ADAPTIVE executor 不能携带 shadow plan。" });
    }
    if (
      binding.effective_executor_version === "LEGACY_FIXED@1" &&
      (binding.selected_profile_refs.length !== agentSpecialistProfileIdSchema.options.length ||
        binding.shadow_dispatch_plan_ref === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Legacy executor 必须冻结 exact-three Profile refs 与 shadow plan ref。",
      });
    }
  });

export const agentDispatchExecutionBindingSchema = agentDispatchExecutionBindingDraftSchema.extend({
  binding_hash: contentHashSchema,
});

export async function buildAgentDispatchExecutionBinding(input: unknown) {
  const draft = agentDispatchExecutionBindingDraftSchema.parse(input);
  return deepFreeze(
    agentDispatchExecutionBindingSchema.parse({
      ...draft,
      binding_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyAgentDispatchExecutionBinding(input: unknown) {
  const binding = agentDispatchExecutionBindingSchema.parse(input);
  const { binding_hash: actual, ...draft } = binding;
  if ((await sha256ContentHash(agentDispatchExecutionBindingDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("AGENT_DISPATCH_EXECUTION_BINDING_MISMATCH");
  }
  return deepFreeze(binding);
}

const executeAdmissionSchema = z.strictObject({
  kind: z.literal("EXECUTE"),
  plan: agentDispatchPlanSchema,
  binding: agentDispatchExecutionBindingSchema,
});

const deferredAdmissionDraftSchema = z.strictObject({
  kind: z.literal("DEFERRED"),
  schema_version: z.literal("agent-dispatch-deferred-receipt@1.0.0"),
  run_id: canonicalImmutableIdSchema,
  question_class: agentQuestionClassSchema,
  reason_code: reasonCodeSchema,
  required_capabilities: z
    .array(versionIdentifierSchema)
    .min(1)
    .max(16)
    .superRefine((values, ctx) => {
      if (!canonicalUniqueStrings(values)) {
        ctx.addIssue({ code: "custom", message: "required_capabilities 必须唯一且规范排序。" });
      }
    }),
  policy_version: versionIdentifierSchema,
  capability_snapshot_hash: contentHashSchema,
});

const deferredAdmissionSchema = deferredAdmissionDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export const agentDispatchAdmissionResultSchema = z.discriminatedUnion("kind", [
  executeAdmissionSchema,
  deferredAdmissionSchema,
]);

export async function buildAgentDispatchDeferredReceipt(input: unknown) {
  const draft = deferredAdmissionDraftSchema.parse(input);
  return deepFreeze(
    deferredAdmissionSchema.parse({ ...draft, receipt_hash: await sha256ContentHash(draft) }),
  );
}

export async function buildAgentDispatchExecuteAdmission(input: unknown) {
  const candidate = z
    .strictObject({ kind: z.literal("EXECUTE"), plan: z.unknown(), binding: z.unknown() })
    .parse(input);
  const plan = await verifyAgentDispatchPlan(candidate.plan);
  const binding = await verifyAgentDispatchExecutionBinding(candidate.binding);
  if (
    binding.run_id !== plan.run_id ||
    binding.dispatch_plan_ref.plan_id !== plan.plan_id ||
    binding.dispatch_plan_ref.plan_hash !== plan.plan_hash ||
    binding.policy_version !== plan.policy_version ||
    binding.capability_snapshot_hash !== plan.capability_snapshot_hash ||
    JSON.stringify(binding.selected_profile_refs) !== JSON.stringify(plan.selected_profile_refs)
  ) {
    throw new TypeError("AGENT_DISPATCH_RECEIPT_MISMATCH");
  }
  return deepFreeze(executeAdmissionSchema.parse({ kind: "EXECUTE", plan, binding }));
}

export async function verifyAgentDispatchAdmissionResult(input: unknown) {
  const parsed = agentDispatchAdmissionResultSchema.parse(input);
  if (parsed.kind === "EXECUTE") return buildAgentDispatchExecuteAdmission(parsed);
  const { receipt_hash: actual, ...draft } = parsed;
  if ((await sha256ContentHash(deferredAdmissionDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("AGENT_DISPATCH_DEFERRED_RECEIPT_MISMATCH");
  }
  return deepFreeze(parsed);
}

export type AgentQuestionClass = z.infer<typeof agentQuestionClassSchema>;
export type AgentDispatchPlan = z.infer<typeof agentDispatchPlanSchema>;
export type AgentDispatchExecutionBinding = z.infer<typeof agentDispatchExecutionBindingSchema>;
export type AgentDispatchAdmissionResult = z.infer<typeof agentDispatchAdmissionResultSchema>;
