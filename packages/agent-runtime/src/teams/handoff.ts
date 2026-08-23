import { deepFreeze } from "@data-agent/contracts";
import {
  ContextProjectionError,
  type ContextProjectionFilter,
  projectUntrustedContext,
} from "./context-projection.js";
import {
  artifactReferencesAreSubset,
  budgetIsNarrower,
  contextProjectionDataBytes,
  contextProjectionSchema,
  type HandoffReceipt,
  handoffReceiptSchema,
  handoffRequestSchema,
  isSameScope,
  networkPolicyIsNarrower,
  type TaskEnvelope,
  taskEnvelopeSchema,
  toolAllowlistIsSubset,
} from "./contracts.js";
import { isL2TeamHandoffAllowed } from "./roles.js";

export type TeamHandoffPolicyErrorCode =
  | "TEAM_HANDOFF_NOT_ALLOWED"
  | "TEAM_POLICY_VERSION_MISMATCH"
  | "TEAM_ARTIFACT_SCOPE_ESCALATION"
  | "TEAM_BUDGET_ESCALATION"
  | "TEAM_TOOL_SCOPE_ESCALATION"
  | "TEAM_NETWORK_SCOPE_ESCALATION";

export class TeamHandoffPolicyError extends Error {
  override readonly name = "TeamHandoffPolicyError";

  constructor(
    readonly code: TeamHandoffPolicyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type PreparedTeamHandoff = Readonly<{
  task: TaskEnvelope;
  receipt: HandoffReceipt;
}>;

function assertHandoffPolicy(
  parent: TaskEnvelope,
  request: ReturnType<typeof handoffRequestSchema.parse>,
): void {
  if (!isL2TeamHandoffAllowed(parent.role, request.to_role)) {
    throw new TeamHandoffPolicyError(
      "TEAM_HANDOFF_NOT_ALLOWED",
      "L2 Team 角色图不允许该 Handoff。",
    );
  }
  if (request.policy_version !== parent.policy_version) {
    throw new TeamHandoffPolicyError(
      "TEAM_POLICY_VERSION_MISMATCH",
      "Handoff 必须绑定父 Task 的 Policy Version。",
    );
  }
  if (!artifactReferencesAreSubset(parent.artifact_refs, request.artifact_refs)) {
    throw new TeamHandoffPolicyError(
      "TEAM_ARTIFACT_SCOPE_ESCALATION",
      "Handoff 不能扩大 Artifact Reference 范围。",
    );
  }
  if (!budgetIsNarrower(parent.budget, request.budget)) {
    throw new TeamHandoffPolicyError(
      "TEAM_BUDGET_ESCALATION",
      "Handoff 必须严格减少 Handoff 深度且不能扩大其他预算。",
    );
  }
  if (!toolAllowlistIsSubset(parent.tool_policy.allowlist, request.tool_allowlist)) {
    throw new TeamHandoffPolicyError(
      "TEAM_TOOL_SCOPE_ESCALATION",
      "Handoff 不能增加父 Task 未声明的 Tool。",
    );
  }
  if (!networkPolicyIsNarrower(parent.network_policy, request.network_policy)) {
    throw new TeamHandoffPolicyError(
      "TEAM_NETWORK_SCOPE_ESCALATION",
      "Handoff 不能扩大父 Task 的 Network Policy。",
    );
  }
}

export async function prepareTeamHandoff(
  parentInput: unknown,
  requestInput: unknown,
  rawContext: unknown,
  projectionFilter: ContextProjectionFilter = projectUntrustedContext,
): Promise<PreparedTeamHandoff> {
  const parent = taskEnvelopeSchema.parse(parentInput);
  const request = handoffRequestSchema.parse(requestInput);
  assertHandoffPolicy(parent, request);

  let context: ReturnType<typeof contextProjectionSchema.parse>;
  try {
    const projected = await projectionFilter({
      schema_version: request.schema_version,
      projection_id: request.projection_id,
      scope: parent.scope,
      run_id: parent.run_id,
      artifact_refs: request.artifact_refs,
      max_context_bytes: request.budget.max_context_bytes,
      raw_context: rawContext,
    });
    context = contextProjectionSchema.parse(projected);
    if (
      context.schema_version !== request.schema_version ||
      context.projection_id !== request.projection_id ||
      !isSameScope(context.scope, parent.scope) ||
      context.run_id !== parent.run_id ||
      !artifactReferencesAreSubset(request.artifact_refs, context.artifact_refs) ||
      !artifactReferencesAreSubset(context.artifact_refs, request.artifact_refs) ||
      contextProjectionDataBytes(context.data) > request.budget.max_context_bytes
    ) {
      throw new Error("CONTEXT_PROJECTION_CORRELATION_MISMATCH");
    }
  } catch {
    throw new ContextProjectionError();
  }

  const task = taskEnvelopeSchema.parse({
    schema_version: request.schema_version,
    task_id: request.child_task_id,
    attempt_id: request.child_attempt_id,
    scope: parent.scope,
    run_id: parent.run_id,
    from_role: parent.role,
    role: request.to_role,
    objective: request.objective,
    artifact_refs: request.artifact_refs,
    context,
    budget: request.budget,
    tool_policy: {
      policy_version: request.policy_version,
      allowlist: request.tool_allowlist,
    },
    network_policy: request.network_policy,
    policy_version: request.policy_version,
  });

  const receipt = handoffReceiptSchema.parse({
    schema_version: request.schema_version,
    handoff_id: request.handoff_id,
    parent_task_id: parent.task_id,
    child_task_id: task.task_id,
    parent_attempt_id: parent.attempt_id,
    child_attempt_id: task.attempt_id,
    scope: parent.scope,
    run_id: parent.run_id,
    from_role: parent.role,
    to_role: task.role,
    artifact_refs: task.artifact_refs,
    context_projection_id: context.projection_id,
    parent_budget: parent.budget,
    budget: task.budget,
    parent_tool_allowlist: parent.tool_policy.allowlist,
    tool_allowlist: task.tool_policy.allowlist,
    parent_network_policy: parent.network_policy,
    network_policy: task.network_policy,
    policy_version: task.policy_version,
    status: "PREPARED",
    authority: "NON_AUTHORITATIVE_RUNTIME",
  });

  return deepFreeze({
    task,
    receipt,
  });
}
