import { z } from "zod";
import {
  type AppScope,
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  type PortResult,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  businessSubjectNodeSchema,
  dimensionNodeSchema,
  formulaNodeSchema,
  glossaryTermNodeSchema,
  metricNodeSchema,
  semanticEdgeTypeDefinitionSchema,
  semanticGraphEdgeSchema,
  type semanticGraphNodeSchema,
  semanticGraphPatchSchema,
  semanticGraphSourceSchema,
  semanticNodeTypeSchema,
} from "./semantic-graph-v2.js";

export const SEMANTIC_AGENT_TURN_VERSION = "semantic-agent-turn@1.0.0" as const;
export const SEMANTIC_AUTHORING_RUN_VERSION = "semantic-authoring-run@1.0.0" as const;
export const SEMANTIC_AUTHORING_CHECKPOINT_VERSION = "semantic-authoring-checkpoint@1.0.0" as const;
export const SEMANTIC_AUTHORING_TOOL_RECEIPT_VERSION =
  "semantic-authoring-tool-receipt@1.0.0" as const;
export const SEMANTIC_AUTHORING_POLICY_VERSION = "semantic-authoring-policy@1.0.0" as const;
export const SEMANTIC_AUTHORING_PUBLIC_EVENT_VERSION =
  "semantic-authoring-public-event@1.0.0" as const;

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const stableReasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);
const toolCallIdSchema = z.string().min(1).max(256);
const safePositiveIntegerSchema = z.number().int().positive().safe();
const safeNonNegativeIntegerSchema = z.number().int().nonnegative().safe();
const semanticAuthoringWorkerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

export const semanticAuthoringToolNameSchema = z.enum([
  "list_semantic_types",
  "search_semantic_nodes",
  "read_semantic_node",
  "read_semantic_edge",
  "get_semantic_neighborhood",
  "read_schema_bindings",
  "read_formula_dependencies",
  "read_candidate_diff",
  "create_semantic_node",
  "update_semantic_node",
  "retire_semantic_node",
  "create_semantic_edge",
  "update_semantic_edge",
  "retire_semantic_edge",
  "propose_semantic_edge_type",
  "validate_semantic_graph",
  "analyze_semantic_impact",
  "request_semantic_clarification",
  "complete_authoring_run",
]);

export type SemanticAuthoringToolName = z.infer<typeof semanticAuthoringToolNameSchema>;

export const agentTurnToolDescriptorSchema = z.strictObject({
  name: semanticAuthoringToolNameSchema,
  description: z.string().min(1).max(2_048),
  input_schema: z.record(z.string(), z.json()),
});

const assistantToolCallSchema = z.strictObject({
  tool_call_id: toolCallIdSchema,
  tool_name: semanticAuthoringToolNameSchema,
  arguments: z.json(),
});

export const agentTurnMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("user"), content: z.string().min(1).max(200_000) }),
  z.strictObject({
    role: z.literal("assistant"),
    content: z.string().max(200_000),
    tool_calls: z.array(assistantToolCallSchema).max(32),
  }),
  z.strictObject({
    role: z.literal("tool"),
    tool_call_id: toolCallIdSchema,
    tool_name: semanticAuthoringToolNameSchema,
    content: z.string().min(1).max(200_000),
    is_error: z.boolean(),
  }),
]);

export const agentTurnRequestSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_AGENT_TURN_VERSION),
  request_id: immutableIdSchema,
  scope: appScopeSchema,
  authoring_run_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  policy_version: versionIdentifierSchema,
  turn_index: safePositiveIntegerSchema,
  messages: z.array(agentTurnMessageSchema).min(1).max(512),
  tools: z.array(agentTurnToolDescriptorSchema).min(1).max(64),
  budget: z.strictObject({
    timeout_ms: z.number().int().positive().max(600_000),
    max_input_tokens: z.number().int().positive().max(2_000_000),
    max_output_tokens: z.number().int().positive().max(2_000_000),
  }),
});

const agentTurnUsageSchema = z.strictObject({
  input_tokens: safeNonNegativeIntegerSchema,
  output_tokens: safeNonNegativeIntegerSchema,
  tool_calls: safeNonNegativeIntegerSchema,
});

export const agentTurnResultSchema = z.discriminatedUnion("terminal", [
  z.strictObject({
    terminal: z.literal("TOOL_CALLS"),
    response_digest: contentHashSchema,
    assistant_text: z.string().max(200_000),
    tool_calls: z.array(assistantToolCallSchema).min(1).max(32),
    usage: agentTurnUsageSchema,
  }),
  z.strictObject({
    terminal: z.literal("FINAL"),
    response_digest: contentHashSchema,
    assistant_text: z.string().max(200_000),
    usage: agentTurnUsageSchema,
  }),
  z.strictObject({
    terminal: z.literal("FAILED"),
    reason_code: stableReasonCodeSchema,
    retryable: z.boolean(),
  }),
]);

export type AgentTurnMessage = z.infer<typeof agentTurnMessageSchema>;
export type AgentTurnToolDescriptor = z.infer<typeof agentTurnToolDescriptorSchema>;
export type AgentTurnRequest = z.infer<typeof agentTurnRequestSchema>;
export type AgentTurnResult = z.infer<typeof agentTurnResultSchema>;

declare const authoritativeAgentTurnRequest: unique symbol;
const authorizedAgentTurnRequests = new WeakSet<object>();

export type AuthoritativeAgentTurnRequest = AgentTurnRequest & {
  readonly [authoritativeAgentTurnRequest]: true;
};

export interface AgentTurnAuthorityContext {
  readonly scope: AppScope;
  readonly authoring_run_id: string;
  readonly candidate_id: string;
  readonly principal_id: string;
  readonly policy_version: string;
  readonly tool_names: readonly SemanticAuthoringToolName[];
}

function scopesMatch(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

export function authorizeAgentTurnRequest(
  input: unknown,
  authority: AgentTurnAuthorityContext,
): AuthoritativeAgentTurnRequest {
  const request = agentTurnRequestSchema.parse(input);
  const requestedTools = request.tools.map((tool) => tool.name).sort();
  const allowedTools = [...authority.tool_names].sort();
  if (
    !scopesMatch(request.scope, authority.scope) ||
    request.authoring_run_id !== authority.authoring_run_id ||
    request.candidate_id !== authority.candidate_id ||
    request.principal_id !== authority.principal_id ||
    request.policy_version !== authority.policy_version ||
    JSON.stringify(requestedTools) !== JSON.stringify(allowedTools)
  ) {
    throw new SemanticAuthoringContractError(
      "SEMANTIC_AGENT_TURN_NOT_AUTHORIZED",
      "Agent Turn 必须精确绑定服务端 Scope、候选、策略和工具目录。",
    );
  }
  const frozen = deepFreeze(request);
  authorizedAgentTurnRequests.add(frozen);
  return frozen as AuthoritativeAgentTurnRequest;
}

export function isAuthoritativeAgentTurnRequest(
  value: unknown,
): value is AuthoritativeAgentTurnRequest {
  return typeof value === "object" && value !== null && authorizedAgentTurnRequests.has(value);
}

export interface AgentTurnPort {
  turn(input: AuthoritativeAgentTurnRequest): Promise<AgentTurnResult>;
}

const agentManagedSemanticNodeSchema = z.discriminatedUnion("node_type", [
  businessSubjectNodeSchema,
  dimensionNodeSchema,
  metricNodeSchema,
  formulaNodeSchema,
  glossaryTermNodeSchema,
]);

const toolCallBase = { tool_call_id: toolCallIdSchema } as const;
const emptyArgumentsSchema = z.strictObject({});

export const semanticAuthoringToolCallSchema = z.discriminatedUnion("tool_name", [
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("list_semantic_types"),
    arguments: emptyArgumentsSchema,
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("search_semantic_nodes"),
    arguments: z.strictObject({
      query: z.string().trim().min(1).max(256),
      node_types: z.array(semanticNodeTypeSchema).max(7),
      limit: z.number().int().min(1).max(50),
    }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("read_semantic_node"),
    arguments: z.strictObject({ node_id: versionIdentifierSchema }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("read_semantic_edge"),
    arguments: z.strictObject({ edge_id: versionIdentifierSchema }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("get_semantic_neighborhood"),
    arguments: z.strictObject({
      node_id: versionIdentifierSchema,
      direction: z.enum(["IN", "OUT", "BOTH"]),
      limit: z.number().int().min(1).max(200),
    }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("read_schema_bindings"),
    arguments: z.strictObject({ node_id: versionIdentifierSchema }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("read_formula_dependencies"),
    arguments: z.strictObject({ formula_node_id: versionIdentifierSchema }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("read_candidate_diff"),
    arguments: emptyArgumentsSchema,
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("create_semantic_node"),
    arguments: z.strictObject({ node: agentManagedSemanticNodeSchema }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("update_semantic_node"),
    arguments: z.strictObject({
      node: agentManagedSemanticNodeSchema,
      expected_node_version: safePositiveIntegerSchema,
      expected_entry_digest: contentHashSchema,
    }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("retire_semantic_node"),
    arguments: z.strictObject({
      node_id: versionIdentifierSchema,
      expected_node_version: safePositiveIntegerSchema,
      expected_entry_digest: contentHashSchema,
      retirement_reason: z.string().trim().min(1).max(1_024),
    }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("create_semantic_edge"),
    arguments: z.strictObject({ edge: semanticGraphEdgeSchema }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("update_semantic_edge"),
    arguments: z.strictObject({
      edge: semanticGraphEdgeSchema,
      expected_edge_version: safePositiveIntegerSchema,
      expected_entry_digest: contentHashSchema,
    }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("retire_semantic_edge"),
    arguments: z.strictObject({
      edge_id: versionIdentifierSchema,
      expected_edge_version: safePositiveIntegerSchema,
      expected_entry_digest: contentHashSchema,
      retirement_reason: z.string().trim().min(1).max(1_024),
    }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("propose_semantic_edge_type"),
    arguments: z.strictObject({ edge_type_definition: semanticEdgeTypeDefinitionSchema }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("validate_semantic_graph"),
    arguments: emptyArgumentsSchema,
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("analyze_semantic_impact"),
    arguments: emptyArgumentsSchema,
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("request_semantic_clarification"),
    arguments: z.strictObject({
      question: z.string().trim().min(1).max(2_048),
      options: z.array(z.string().trim().min(1).max(256)).min(2).max(8),
    }),
  }),
  z.strictObject({
    ...toolCallBase,
    tool_name: z.literal("complete_authoring_run"),
    arguments: z.strictObject({
      expected_graph_digest: contentHashSchema,
      validation_receipt_digest: contentHashSchema,
      summary: z.string().trim().min(1).max(2_048),
    }),
  }),
]);

export type SemanticAuthoringToolCall = z.infer<typeof semanticAuthoringToolCallSchema>;

export const semanticAuthoringValidationReceiptSchema = z.strictObject({
  receipt_version: z.literal("semantic-authoring-validation@1.0.0"),
  graph_digest: contentHashSchema,
  compiler_version: versionIdentifierSchema,
  valid: z.boolean(),
  issues: z.array(
    z.strictObject({
      code: stableReasonCodeSchema,
      message: z.string().min(1).max(2_048),
      subject_id: versionIdentifierSchema.optional(),
    }),
  ),
  receipt_digest: contentHashSchema,
});

export const semanticAuthoringCheckpointSchema = z.strictObject({
  checkpoint_version: z.literal(SEMANTIC_AUTHORING_CHECKPOINT_VERSION),
  messages: z.array(agentTurnMessageSchema).min(1).max(512),
  pending_agent_request: agentTurnRequestSchema.nullable(),
  read_node_ids: z.array(versionIdentifierSchema).max(10_000),
  read_edge_ids: z.array(versionIdentifierSchema).max(20_000),
  searches: z
    .array(
      z.strictObject({
        query: z.string().min(1).max(256),
        matched_node_ids: z.array(versionIdentifierSchema).max(50),
      }),
    )
    .max(256),
  pending_tool_calls: z.array(semanticAuthoringToolCallSchema).max(32),
  last_validation: semanticAuthoringValidationReceiptSchema.nullable(),
});

export const semanticAuthoringRunStatusSchema = z.enum([
  "RUNNING",
  "WAITING_CLARIFICATION",
  "READY_FOR_REVIEW",
  "FAILED",
  "CANCELLED",
]);

export const semanticAuthoringRunSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_AUTHORING_RUN_VERSION),
  authority: z.enum(["POSTGRESQL", "NON_AUTHORITATIVE_IN_MEMORY"]),
  scope: appScopeSchema,
  semantic_domain: semanticDomainSchema,
  authoring_run_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  graph_id: immutableIdSchema,
  base_release_id: immutableIdSchema.nullable(),
  principal_id: immutableIdSchema,
  policy_version: versionIdentifierSchema,
  status: semanticAuthoringRunStatusSchema,
  working_revision: safeNonNegativeIntegerSchema,
  graph_digest: contentHashSchema,
  writer_fence: safePositiveIntegerSchema,
  current_turn: safeNonNegativeIntegerSchema,
  pending_request_digest: contentHashSchema.nullable(),
  used_tool_calls: safeNonNegativeIntegerSchema,
  budget: z.strictObject({
    max_turns: z.number().int().min(1).max(128),
    max_tool_calls: z.number().int().min(1).max(2_048),
  }),
  validation_receipt_digest: contentHashSchema.nullable(),
  clarification: z
    .strictObject({
      clarification_id: immutableIdSchema,
      question: z.string().min(1).max(2_048),
      options: z.array(z.string().min(1).max(256)).min(2).max(8),
      answer: z.string().min(1).max(2_048).nullable(),
    })
    .nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const semanticAuthoringToolReceiptSchema = z.strictObject({
  receipt_version: z.literal(SEMANTIC_AUTHORING_TOOL_RECEIPT_VERSION),
  receipt_id: immutableIdSchema,
  authoring_run_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  turn_index: safePositiveIntegerSchema,
  tool_call_id: toolCallIdSchema,
  tool_name: semanticAuthoringToolNameSchema,
  idempotency_key: z.string().min(1).max(256),
  input_digest: contentHashSchema,
  output_digest: contentHashSchema,
  status: z.enum(["SUCCEEDED", "FAILED", "CLARIFICATION_REQUIRED", "COMPLETED"]),
  mutation: z.boolean(),
  from_working_revision: safeNonNegativeIntegerSchema,
  to_working_revision: safeNonNegativeIntegerSchema,
  before_digest: contentHashSchema,
  after_digest: contentHashSchema,
  patch: semanticGraphPatchSchema.nullable(),
  result: z.json(),
  error_code: stableReasonCodeSchema.nullable(),
  receipt_digest: contentHashSchema,
  committed_at: timestampSchema,
});

const authoringPublicEventBase = {
  schema_version: z.literal(SEMANTIC_AUTHORING_PUBLIC_EVENT_VERSION),
  event_id: immutableIdSchema,
  run_id: immutableIdSchema,
  sequence: safePositiveIntegerSchema,
  occurred_at: timestampSchema,
} as const;

export const semanticAuthoringPublicEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...authoringPublicEventBase,
    type: z.literal("stage"),
    payload: z.strictObject({
      phase: versionIdentifierSchema,
      summary: z.string().min(1).max(2_048),
      status: z.enum(["RUNNING", "COMPLETED"]),
    }),
  }),
  z.strictObject({
    ...authoringPublicEventBase,
    type: z.literal("tool"),
    payload: z.strictObject({
      call_id: toolCallIdSchema,
      tool_name: semanticAuthoringToolNameSchema,
      status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
      summary: z.string().min(1).max(2_048),
      error_code: stableReasonCodeSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...authoringPublicEventBase,
    type: z.literal("graph_patch"),
    payload: z.strictObject({
      patch_id: immutableIdSchema,
      from_working_revision: safeNonNegativeIntegerSchema,
      to_working_revision: safePositiveIntegerSchema,
      before_digest: contentHashSchema,
      after_digest: contentHashSchema,
      operation_count: safePositiveIntegerSchema,
      affected_node_ids: z.array(versionIdentifierSchema).max(10_000),
      affected_edge_ids: z.array(versionIdentifierSchema).max(20_000),
    }),
  }),
  z.strictObject({
    ...authoringPublicEventBase,
    type: z.literal("validation"),
    payload: semanticAuthoringValidationReceiptSchema,
  }),
  z.strictObject({
    ...authoringPublicEventBase,
    type: z.literal("clarification"),
    payload: z.strictObject({
      clarification_id: immutableIdSchema,
      question: z.string().min(1).max(2_048),
      options: z.array(z.string().min(1).max(256)).min(2).max(8),
      status: z.enum(["WAITING", "ANSWERED"]),
    }),
  }),
  z.strictObject({
    ...authoringPublicEventBase,
    type: z.literal("authoring_terminal"),
    payload: z.strictObject({
      status: z.enum(["READY_FOR_REVIEW", "FAILED", "CANCELLED"]),
      summary: z.string().min(1).max(2_048),
      error_code: stableReasonCodeSchema.nullable(),
    }),
  }),
]);

export const semanticAuthoringStartInputSchema = z.strictObject({
  schema_version: z.literal("semantic-authoring-start@1.0.0"),
  scope: appScopeSchema,
  semantic_domain: semanticDomainSchema,
  authoring_run_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  policy_version: versionIdentifierSchema,
  base_release_id: immutableIdSchema.nullable(),
  base_graph: semanticGraphSourceSchema,
  instruction: z.string().trim().min(1).max(20_000),
  budget: z.strictObject({
    max_turns: z.number().int().min(1).max(128),
    max_tool_calls: z.number().int().min(1).max(2_048),
  }),
  idempotency_key: z.string().min(8).max(256),
});

export const semanticAuthoringStateSchema = z.strictObject({
  run: semanticAuthoringRunSchema,
  working_graph: semanticGraphSourceSchema,
  checkpoint: semanticAuthoringCheckpointSchema,
  event_sequence: safeNonNegativeIntegerSchema,
});

export const semanticAuthoringLeaseSchema = z.strictObject({
  schema_version: z.literal("semantic-authoring-lease@1.0.0"),
  scope: appScopeSchema,
  semantic_domain: semanticDomainSchema,
  authoring_run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  worker_id: semanticAuthoringWorkerIdSchema,
  lease_token: immutableIdSchema,
  writer_fence: safePositiveIntegerSchema,
  claimed_at: timestampSchema,
  expires_at: timestampSchema,
});

export const semanticAuthoringClaimSchema = z.strictObject({
  lease: semanticAuthoringLeaseSchema,
  state: semanticAuthoringStateSchema,
});

export type SemanticAuthoringCheckpoint = z.infer<typeof semanticAuthoringCheckpointSchema>;
export type SemanticAuthoringRun = z.infer<typeof semanticAuthoringRunSchema>;
export type SemanticAuthoringRunStatus = z.infer<typeof semanticAuthoringRunStatusSchema>;
export type SemanticAuthoringToolReceipt = z.infer<typeof semanticAuthoringToolReceiptSchema>;
export type SemanticAuthoringValidationReceipt = z.infer<
  typeof semanticAuthoringValidationReceiptSchema
>;
export type SemanticAuthoringPublicEvent = z.infer<typeof semanticAuthoringPublicEventSchema>;
export type SemanticAuthoringStartInput = z.infer<typeof semanticAuthoringStartInputSchema>;
export type SemanticAuthoringState = z.infer<typeof semanticAuthoringStateSchema>;
export type SemanticAuthoringLease = z.infer<typeof semanticAuthoringLeaseSchema>;
export type SemanticAuthoringClaim = z.infer<typeof semanticAuthoringClaimSchema>;

export interface SemanticAuthoringCommitTurnInput {
  readonly authoring_run_id: string;
  readonly expected_writer_fence: number;
  readonly expected_turn: number;
  readonly request_digest: string;
  readonly response_digest: string;
  readonly checkpoint: SemanticAuthoringCheckpoint;
  readonly events: readonly SemanticAuthoringPublicEvent[];
}

export interface SemanticAuthoringBeginTurnInput {
  readonly authoring_run_id: string;
  readonly expected_writer_fence: number;
  readonly expected_turn: number;
  readonly request_digest: string;
  readonly checkpoint: SemanticAuthoringCheckpoint;
  readonly events: readonly SemanticAuthoringPublicEvent[];
}

export interface SemanticAuthoringCommitToolInput {
  readonly authoring_run_id: string;
  readonly expected_writer_fence: number;
  readonly expected_working_revision: number;
  readonly expected_graph_digest: string;
  readonly receipt: SemanticAuthoringToolReceipt;
  readonly next_graph: z.infer<typeof semanticGraphSourceSchema>;
  readonly checkpoint: SemanticAuthoringCheckpoint;
  readonly events: readonly SemanticAuthoringPublicEvent[];
}

export interface SemanticAuthoringResumeInput {
  readonly authoring_run_id: string;
  readonly clarification_id: string;
  readonly answer: string;
  readonly idempotency_key: string;
}

export interface SemanticAuthoringCompleteInput {
  readonly authoring_run_id: string;
  readonly expected_writer_fence: number;
  readonly expected_working_revision: number;
  readonly expected_graph_digest: string;
  readonly validation_receipt: SemanticAuthoringValidationReceipt;
  readonly final_graph: z.infer<typeof semanticGraphSourceSchema>;
  readonly summary: string;
  readonly event: SemanticAuthoringPublicEvent;
}

export interface SemanticAuthoringStorePort {
  start(input: SemanticAuthoringStartInput): Promise<PortResult<SemanticAuthoringState>>;
  load(input: {
    readonly scope: AppScope;
    readonly semantic_domain: string;
    readonly authoring_run_id: string;
  }): Promise<PortResult<SemanticAuthoringState | null>>;
  beginTurn(input: SemanticAuthoringBeginTurnInput): Promise<PortResult<SemanticAuthoringState>>;
  commitTurn(input: SemanticAuthoringCommitTurnInput): Promise<PortResult<SemanticAuthoringState>>;
  findToolReceipt(input: {
    readonly authoring_run_id: string;
    readonly tool_call_id: string;
  }): Promise<PortResult<SemanticAuthoringToolReceipt | null>>;
  commitTool(input: SemanticAuthoringCommitToolInput): Promise<PortResult<SemanticAuthoringState>>;
  resume(input: SemanticAuthoringResumeInput): Promise<PortResult<SemanticAuthoringState>>;
  complete(input: SemanticAuthoringCompleteInput): Promise<PortResult<SemanticAuthoringState>>;
  fail(input: {
    readonly authoring_run_id: string;
    readonly expected_writer_fence: number;
    readonly error_code: string;
    readonly event: SemanticAuthoringPublicEvent;
  }): Promise<PortResult<SemanticAuthoringState>>;
  listEvents(input: {
    readonly scope: AppScope;
    readonly semantic_domain: string;
    readonly authoring_run_id: string;
    readonly after_sequence?: number;
    readonly limit?: number;
  }): Promise<PortResult<readonly SemanticAuthoringPublicEvent[]>>;
}

/**
 * Worker-only queue boundary. Web may create a RUNNING row, but only a claimed,
 * fenced Worker lease may advance its Agent/tool checkpoint.
 */
export interface SemanticAuthoringQueuePort {
  claimNext(input: {
    readonly scope: AppScope;
    readonly worker_id: string;
    readonly lease_duration_ms: number;
  }): Promise<PortResult<SemanticAuthoringClaim | null>>;
  heartbeat(input: {
    readonly lease: SemanticAuthoringLease;
    readonly lease_duration_ms: number;
  }): Promise<PortResult<SemanticAuthoringLease>>;
  release(input: { readonly lease: SemanticAuthoringLease }): Promise<PortResult<null>>;
}

export class SemanticAuthoringContractError extends Error {
  override readonly name = "SemanticAuthoringContractError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function affectedSemanticGraphEntryIds(patch: z.infer<typeof semanticGraphPatchSchema>): {
  readonly node_ids: readonly string[];
  readonly edge_ids: readonly string[];
} {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const operation of patch.operations) {
    switch (operation.operation) {
      case "ADD_NODE":
      case "UPDATE_NODE":
        nodeIds.add(operation.node.node_id);
        break;
      case "RETIRE_NODE":
        nodeIds.add(operation.node_id);
        break;
      case "ADD_EDGE":
      case "UPDATE_EDGE":
        edgeIds.add(operation.edge.edge_id);
        nodeIds.add(operation.edge.source_node_id);
        nodeIds.add(operation.edge.target_node_id);
        break;
      case "RETIRE_EDGE":
        edgeIds.add(operation.edge_id);
        break;
      case "ADD_EDGE_TYPE":
        break;
    }
  }
  return {
    node_ids: [...nodeIds].sort(),
    edge_ids: [...edgeIds].sort(),
  };
}

export function assertAgentManagedToolNode(
  input: unknown,
): z.infer<typeof semanticGraphNodeSchema> {
  return agentManagedSemanticNodeSchema.parse(input);
}
