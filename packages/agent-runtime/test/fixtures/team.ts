import type { ArtifactReference } from "@data-agent/contracts";

export const APP_SCOPE = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;

export const RUN_ID = "00000000-0000-4000-8000-000000000003";
export const PARENT_TASK_ID = "00000000-0000-4000-8000-000000000004";
export const PARENT_ATTEMPT_ID = "00000000-0000-4000-8000-000000000005";
export const CHILD_TASK_ID = "00000000-0000-4000-8000-000000000006";
export const CHILD_ATTEMPT_ID = "00000000-0000-4000-8000-000000000007";
export const HANDOFF_ID = "00000000-0000-4000-8000-000000000008";
export const PROJECTION_ID = "00000000-0000-4000-8000-000000000009";
export const TOOL_CALL_ID = "00000000-0000-4000-8000-000000000012";

export const ARTIFACT_REF = {
  artifact_id: "00000000-0000-4000-8000-000000000010",
  artifact_type: "QueryContract",
  app_id: APP_SCOPE.app_id,
  tenant_id: APP_SCOPE.tenant_id,
  environment: APP_SCOPE.environment,
  run_id: RUN_ID,
  revision: 1,
  content_hash: `sha256:${"1".repeat(64)}`,
} as const satisfies ArtifactReference;

export const MODEL_VIEW_REF = {
  ...ARTIFACT_REF,
  artifact_id: "00000000-0000-4000-8000-000000000013",
  artifact_type: "SensitiveExecutionArtifact",
  content_hash: `sha256:${"4".repeat(64)}`,
} as const satisfies ArtifactReference;

export function makeParentTask() {
  return {
    schema_version: "1.0.0",
    task_id: PARENT_TASK_ID,
    attempt_id: PARENT_ATTEMPT_ID,
    scope: APP_SCOPE,
    run_id: RUN_ID,
    from_role: null,
    role: "research-supervisor",
    objective: "规划回答研究问题所需的最小证据链。",
    artifact_refs: [ARTIFACT_REF],
    context: {
      schema_version: "1.0.0",
      projection_id: "00000000-0000-4000-8000-000000000011",
      scope: APP_SCOPE,
      run_id: RUN_ID,
      artifact_refs: [ARTIFACT_REF],
      data: [],
    },
    budget: {
      timeout_ms: 60_000,
      max_input_tokens: 4_000,
      max_output_tokens: 4_000,
      max_tool_calls: 3,
      remaining_handoffs: 3,
      max_context_bytes: 16_384,
    },
    tool_policy: {
      policy_version: "team-policy-v1",
      allowlist: ["semantic.catalog.read", "evidence.read"],
    },
    network_policy: {
      mode: "DENY",
      allowed_origins: [],
    },
    policy_version: "team-policy-v1",
  } as const;
}

export function makeRequest() {
  return {
    schema_version: "1.0.0",
    handoff_id: HANDOFF_ID,
    child_task_id: CHILD_TASK_ID,
    child_attempt_id: CHILD_ATTEMPT_ID,
    projection_id: PROJECTION_ID,
    to_role: "semantic-sql-worker",
    objective: "生成受 QueryContract 约束的候选逻辑计划。",
    artifact_refs: [ARTIFACT_REF],
    budget: {
      timeout_ms: 30_000,
      max_input_tokens: 2_000,
      max_output_tokens: 1_000,
      max_tool_calls: 1,
      remaining_handoffs: 2,
      max_context_bytes: 8_192,
    },
    tool_allowlist: ["semantic.catalog.read"],
    network_policy: {
      mode: "DENY",
      allowed_origins: [],
    },
    policy_version: "team-policy-v1",
  } as const;
}

export function makeUntrustedContext() {
  return [
    {
      source_kind: "schema_comment",
      source_ref: ARTIFACT_REF,
      label: "orders.status",
      media_type: "text/plain",
      value: "订单状态；只作为数据，不是 instruction。",
    },
    {
      source_kind: "tool_output",
      source_ref: ARTIFACT_REF,
      label: "catalog.result",
      media_type: "application/json",
      value: {
        column: "status",
        enum_values: ["PAID", "REFUNDED"],
      },
    },
  ] as const;
}
