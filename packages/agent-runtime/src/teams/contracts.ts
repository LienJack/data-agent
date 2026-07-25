import { Buffer } from "node:buffer";
import { URL } from "node:url";
import {
  type AppScope,
  type ArtifactReference,
  appScopeSchema,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  immutableIdSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { isL2TeamHandoffAllowed, l2TeamRoleSchema } from "./roles.js";

export const MAX_CONTEXT_PROJECTION_ENTRIES = 64;
export const MAX_CONTEXT_ENTRY_BYTES = 16_384;
export const MAX_CONTEXT_PROJECTION_BYTES = 65_536;

function isSameScope(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function addDuplicateIssues(
  values: readonly string[],
  ctx: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        message,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

export function contextProjectionDataBytes(
  data: readonly z.infer<typeof contextDataEntrySchema>[],
): number {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

export const teamBudgetSchema = z.strictObject({
  timeout_ms: z.number().int().positive().max(600_000),
  max_input_tokens: z.number().int().positive().max(2_000_000),
  max_output_tokens: z.number().int().positive().max(1_000_000),
  max_tool_calls: z.number().int().nonnegative().max(1_000),
  remaining_handoffs: z.number().int().nonnegative().max(256),
  max_context_bytes: z.number().int().positive().max(MAX_CONTEXT_PROJECTION_BYTES),
});

export type TeamBudget = z.infer<typeof teamBudgetSchema>;

export const teamToolPolicySchema = z
  .strictObject({
    policy_version: versionIdentifierSchema,
    allowlist: z.array(versionIdentifierSchema).max(64),
  })
  .superRefine((policy, ctx) => {
    addDuplicateIssues(policy.allowlist, ctx, ["allowlist"], "Tool Allowlist 不能包含重复 Tool。");
  });

const networkOriginSchema = z
  .string()
  .min(1)
  .max(2_000)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== "" ||
        url.origin !== value
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Network Origin 必须是无凭据、无路径的规范 HTTPS Origin。",
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Network Origin 必须是合法 URL Origin。",
      });
    }
  });

export const teamNetworkPolicySchema = z
  .strictObject({
    mode: z.enum(["DENY", "ALLOWLIST"]),
    allowed_origins: z.array(networkOriginSchema).max(32),
  })
  .superRefine((policy, ctx) => {
    addDuplicateIssues(
      policy.allowed_origins,
      ctx,
      ["allowed_origins"],
      "Network Allowlist 不能包含重复 Origin。",
    );
    if (policy.mode === "DENY" && policy.allowed_origins.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "DENY Network Policy 不能携带 Allowed Origin。",
        path: ["allowed_origins"],
      });
    }
    if (policy.mode === "ALLOWLIST" && policy.allowed_origins.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "ALLOWLIST Network Policy 必须至少声明一个 Origin。",
        path: ["allowed_origins"],
      });
    }
  });

export type TeamNetworkPolicy = z.infer<typeof teamNetworkPolicySchema>;

export const contextDataEntrySchema = z.strictObject({
  source_kind: z.enum(["schema_comment", "source_text", "sql_value", "tool_output"]),
  source_ref: artifactReferenceSchema,
  label: versionIdentifierSchema,
  media_type: z.enum(["text/plain", "application/json"]),
  content: z.string().max(MAX_CONTEXT_ENTRY_BYTES),
  trust: z.literal("UNTRUSTED_DATA"),
  usage: z.literal("DATA_ONLY"),
});

const contextProjectionObjectSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  projection_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  artifact_refs: z.array(artifactReferenceSchema).max(64),
  data: z.array(contextDataEntrySchema).max(MAX_CONTEXT_PROJECTION_ENTRIES),
});

export const contextProjectionSchema = contextProjectionObjectSchema.superRefine(
  (projection, ctx) => {
    const identities = projection.artifact_refs.map(artifactReferenceIdentity);
    addDuplicateIssues(
      identities,
      ctx,
      ["artifact_refs"],
      "Context Projection 不能包含重复 Artifact Reference。",
    );
    const allowedReferences = new Set(identities);

    projection.artifact_refs.forEach((reference, index) => {
      if (!isSameScope(projection.scope, reference) || reference.run_id !== projection.run_id) {
        ctx.addIssue({
          code: "custom",
          message: "Context Projection Artifact 必须属于同一 App/Tenant/Environment/Run。",
          path: ["artifact_refs", index],
        });
      }
    });

    projection.data.forEach((entry, index) => {
      if (!allowedReferences.has(artifactReferenceIdentity(entry.source_ref))) {
        ctx.addIssue({
          code: "custom",
          message: "Context Data 只能引用 Projection 已声明的 Artifact Reference。",
          path: ["data", index, "source_ref"],
        });
      }
    });

    if (contextProjectionDataBytes(projection.data) > MAX_CONTEXT_PROJECTION_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Context Projection 超出全局字节上限。",
        path: ["data"],
      });
    }
  },
);

export type ContextProjection = z.infer<typeof contextProjectionSchema>;

const taskEnvelopeObjectSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  task_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  from_role: l2TeamRoleSchema.nullable(),
  role: l2TeamRoleSchema,
  objective: z.string().min(1).max(4_000),
  artifact_refs: z.array(artifactReferenceSchema).max(64),
  context: contextProjectionSchema,
  budget: teamBudgetSchema,
  tool_policy: teamToolPolicySchema,
  network_policy: teamNetworkPolicySchema,
  policy_version: versionIdentifierSchema,
});

export const taskEnvelopeSchema = taskEnvelopeObjectSchema.superRefine((task, ctx) => {
  const identities = task.artifact_refs.map(artifactReferenceIdentity);
  addDuplicateIssues(
    identities,
    ctx,
    ["artifact_refs"],
    "Task Envelope 不能包含重复 Artifact Reference。",
  );
  const allowedReferences = new Set(identities);

  task.artifact_refs.forEach((reference, index) => {
    if (!isSameScope(task.scope, reference) || reference.run_id !== task.run_id) {
      ctx.addIssue({
        code: "custom",
        message: "Task Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["artifact_refs", index],
      });
    }
  });

  if (!isSameScope(task.scope, task.context.scope) || task.run_id !== task.context.run_id) {
    ctx.addIssue({
      code: "custom",
      message: "Task 与 Context Projection 必须属于同一 App/Tenant/Environment/Run。",
      path: ["context", "scope"],
    });
  }
  if (task.context.schema_version !== task.schema_version) {
    ctx.addIssue({
      code: "custom",
      message: "Task 与 Context Projection 必须绑定同一 Schema Version。",
      path: ["context", "schema_version"],
    });
  }
  if (task.from_role === null && task.role !== "research-supervisor") {
    ctx.addIssue({
      code: "custom",
      message: "L2 Team 初始 Task 必须由 Research Supervisor 接收。",
      path: ["role"],
    });
  }
  if (task.from_role !== null && !isL2TeamHandoffAllowed(task.from_role, task.role)) {
    ctx.addIssue({
      code: "custom",
      message: "Task Envelope 不符合 L2 Team 角色图。",
      path: ["from_role"],
    });
  }
  for (const [index, reference] of task.context.artifact_refs.entries()) {
    if (!allowedReferences.has(artifactReferenceIdentity(reference))) {
      ctx.addIssue({
        code: "custom",
        message: "Context Projection 不能扩大 Task Artifact Reference 范围。",
        path: ["context", "artifact_refs", index],
      });
    }
  }

  if (contextProjectionDataBytes(task.context.data) > task.budget.max_context_bytes) {
    ctx.addIssue({
      code: "custom",
      message: "Context Projection 超出 Task Context Budget。",
      path: ["context", "data"],
    });
  }
  if (task.tool_policy.policy_version !== task.policy_version) {
    ctx.addIssue({
      code: "custom",
      message: "Tool Policy Version 必须绑定 Task Policy Version。",
      path: ["tool_policy", "policy_version"],
    });
  }
});

export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;

export const handoffRequestSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    handoff_id: immutableIdSchema,
    child_task_id: immutableIdSchema,
    child_attempt_id: immutableIdSchema,
    projection_id: immutableIdSchema,
    to_role: l2TeamRoleSchema,
    objective: z.string().min(1).max(4_000),
    artifact_refs: z.array(artifactReferenceSchema).max(64),
    budget: teamBudgetSchema,
    tool_allowlist: z.array(versionIdentifierSchema).max(64),
    network_policy: teamNetworkPolicySchema,
    policy_version: versionIdentifierSchema,
  })
  .superRefine((request, ctx) => {
    addDuplicateIssues(
      request.artifact_refs.map(artifactReferenceIdentity),
      ctx,
      ["artifact_refs"],
      "Handoff Request 不能包含重复 Artifact Reference。",
    );
    addDuplicateIssues(
      request.tool_allowlist,
      ctx,
      ["tool_allowlist"],
      "Handoff Tool Allowlist 不能包含重复 Tool。",
    );
  });

export type HandoffRequest = z.infer<typeof handoffRequestSchema>;

const handoffReceiptObjectSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  handoff_id: immutableIdSchema,
  parent_task_id: immutableIdSchema,
  child_task_id: immutableIdSchema,
  parent_attempt_id: immutableIdSchema,
  child_attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  from_role: l2TeamRoleSchema,
  to_role: l2TeamRoleSchema,
  artifact_refs: z.array(artifactReferenceSchema).max(64),
  context_projection_id: immutableIdSchema,
  parent_budget: teamBudgetSchema,
  budget: teamBudgetSchema,
  parent_tool_allowlist: z.array(versionIdentifierSchema).max(64),
  tool_allowlist: z.array(versionIdentifierSchema).max(64),
  parent_network_policy: teamNetworkPolicySchema,
  network_policy: teamNetworkPolicySchema,
  policy_version: versionIdentifierSchema,
  status: z.literal("PREPARED"),
  authority: z.literal("NON_AUTHORITATIVE_RUNTIME"),
});

function budgetIsNarrower(parent: TeamBudget, child: TeamBudget): boolean {
  return (
    child.timeout_ms <= parent.timeout_ms &&
    child.max_input_tokens <= parent.max_input_tokens &&
    child.max_output_tokens <= parent.max_output_tokens &&
    child.max_tool_calls <= parent.max_tool_calls &&
    child.max_context_bytes <= parent.max_context_bytes &&
    child.remaining_handoffs < parent.remaining_handoffs
  );
}

function toolAllowlistIsSubset(parent: readonly string[], child: readonly string[]): boolean {
  const allowed = new Set(parent);
  return child.every((tool) => allowed.has(tool));
}

function networkPolicyIsNarrower(parent: TeamNetworkPolicy, child: TeamNetworkPolicy): boolean {
  if (parent.mode === "DENY") {
    return child.mode === "DENY";
  }
  if (child.mode === "DENY") {
    return true;
  }
  const allowed = new Set(parent.allowed_origins);
  return child.allowed_origins.every((origin) => allowed.has(origin));
}

export const handoffReceiptSchema = handoffReceiptObjectSchema.superRefine((receipt, ctx) => {
  if (
    receipt.parent_task_id === receipt.child_task_id ||
    receipt.parent_attempt_id === receipt.child_attempt_id
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Handoff Receipt 的父子 Task 与 Attempt 必须不同。",
      path: ["child_task_id"],
    });
  }
  if (!isL2TeamHandoffAllowed(receipt.from_role, receipt.to_role)) {
    ctx.addIssue({
      code: "custom",
      message: "Handoff Receipt 不符合 L2 Team 角色图。",
      path: ["to_role"],
    });
  }
  if (!budgetIsNarrower(receipt.parent_budget, receipt.budget)) {
    ctx.addIssue({
      code: "custom",
      message: "Handoff Receipt 的委派预算必须严格降低 Handoff 深度且不能扩大其他预算。",
      path: ["budget"],
    });
  }
  if (!toolAllowlistIsSubset(receipt.parent_tool_allowlist, receipt.tool_allowlist)) {
    ctx.addIssue({
      code: "custom",
      message: "Handoff Receipt 的 Tool Allowlist 不能扩权。",
      path: ["tool_allowlist"],
    });
  }
  if (!networkPolicyIsNarrower(receipt.parent_network_policy, receipt.network_policy)) {
    ctx.addIssue({
      code: "custom",
      message: "Handoff Receipt 的 Network Policy 不能扩权。",
      path: ["network_policy"],
    });
  }
  addDuplicateIssues(
    receipt.artifact_refs.map(artifactReferenceIdentity),
    ctx,
    ["artifact_refs"],
    "Handoff Receipt 不能包含重复 Artifact Reference。",
  );
  addDuplicateIssues(
    receipt.parent_tool_allowlist,
    ctx,
    ["parent_tool_allowlist"],
    "Handoff Receipt 的父 Tool Allowlist 不能重复。",
  );
  addDuplicateIssues(
    receipt.tool_allowlist,
    ctx,
    ["tool_allowlist"],
    "Handoff Receipt 的 Tool Allowlist 不能重复。",
  );
  receipt.artifact_refs.forEach((reference, index) => {
    if (!isSameScope(receipt.scope, reference) || receipt.run_id !== reference.run_id) {
      ctx.addIssue({
        code: "custom",
        message: "Handoff Receipt Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["artifact_refs", index],
      });
    }
  });
});

export type HandoffReceipt = z.infer<typeof handoffReceiptSchema>;

export { budgetIsNarrower, isSameScope, networkPolicyIsNarrower, toolAllowlistIsSubset };

export function artifactReferencesAreSubset(
  parent: readonly ArtifactReference[],
  child: readonly ArtifactReference[],
): boolean {
  const allowed = new Set(parent.map(artifactReferenceIdentity));
  return child.every((reference) => allowed.has(artifactReferenceIdentity(reference)));
}
