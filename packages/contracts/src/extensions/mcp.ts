import { z } from "zod";
import { artifactReferenceFor } from "../artifacts/envelope.js";
import { semanticRelationshipSearchRequestSchema } from "../artifacts/semantic-relationship-index.js";
import { resolvedContextText2SqlBindingSchema } from "../artifacts/text2sql-primitives.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

const canonicalIds = z
  .array(versionIdentifierSchema)
  .max(256)
  .superRefine((values, ctx) => {
    values.forEach((value, index) => {
      if (index > 0 && (values[index - 1] ?? "") >= value) {
        ctx.addIssue({
          code: "custom",
          message: "Values must be unique and sorted.",
          path: [index],
        });
      }
    });
  });

export const toolEffectSemanticsSchema = z.enum([
  "READ_ONLY",
  "IDEMPOTENT_REQUEST",
  "OUTCOME_STATUS_QUERY",
]);

export const mcpToolManifestSchema = z
  .strictObject({
    tool_id: versionIdentifierSchema,
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().min(1).max(1_000),
    input_schema_hash: contentHashSchema,
    output_schema_hash: contentHashSchema,
    effect_semantics: toolEffectSemanticsSchema,
    remote_idempotency_key_field: versionIdentifierSchema.nullable(),
    outcome_status_tool_id: versionIdentifierSchema.nullable(),
    required_capabilities: canonicalIds,
    max_timeout_ms: z.number().int().positive().max(120_000),
    max_response_bytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
  })
  .superRefine((tool, ctx) => {
    if (
      (tool.effect_semantics === "IDEMPOTENT_REQUEST") !==
      (tool.remote_idempotency_key_field !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "IDEMPOTENT_REQUEST requires exactly one remote idempotency key field.",
        path: ["remote_idempotency_key_field"],
      });
    }
    if (
      (tool.effect_semantics === "OUTCOME_STATUS_QUERY") !==
      (tool.outcome_status_tool_id !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "OUTCOME_STATUS_QUERY requires exactly one status query tool.",
        path: ["outcome_status_tool_id"],
      });
    }
  });

const httpsEndpointSchema = z.url().superRefine((value, ctx) => {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    ctx.addIssue({ code: "custom", message: "MCP endpoint must be credential-free HTTPS." });
  }
});

const mcpServerRevisionDraftSchema = z
  .strictObject({
    schema_version: z.literal("mcp-server-revision@1.0.0"),
    scope: appScopeSchema,
    server_id: immutableIdSchema,
    revision: z.number().int().positive().safe(),
    endpoint: httpsEndpointSchema,
    secret_ref_id: immutableIdSchema.nullable(),
    trust_class: z.enum(["INTERNAL", "TRUSTED_PUBLISHER", "EXTERNAL_REVIEWED"]),
    approval_status: z.enum(["APPROVED", "QUARANTINED"]),
    audience: z.enum(["PRIVATE", "WORKSPACE"]),
    manifest_version: versionIdentifierSchema,
    tools: z.array(mcpToolManifestSchema).min(1).max(256),
    policy_revision: z.number().int().positive().safe(),
  })
  .superRefine((revision, ctx) => {
    const ids = revision.tools.map(({ tool_id }) => tool_id);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && (ids[index - 1] ?? "") >= id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "MCP tools must be unique and sorted.",
        path: ["tools"],
      });
    }
  });

export const mcpServerRevisionSchema = mcpServerRevisionDraftSchema.extend({
  revision_hash: contentHashSchema,
});

export async function buildMcpServerRevision(input: unknown) {
  const draft = mcpServerRevisionDraftSchema.parse(input);
  return deepFreeze(
    mcpServerRevisionSchema.parse({ ...draft, revision_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifyMcpServerRevision(input: unknown) {
  const revision = mcpServerRevisionSchema.parse(input);
  const { revision_hash: _hash, ...draft } = revision;
  if ((await sha256ContentHash(draft)) !== revision.revision_hash) {
    throw new TypeError("MCP_SERVER_REVISION_HASH_MISMATCH");
  }
  return revision;
}

export const mcpServerHeadSchema = z.strictObject({
  schema_version: z.literal("mcp-server-head@1.0.0"),
  scope: appScopeSchema,
  server_id: immutableIdSchema,
  active_revision: z.number().int().positive().safe(),
  active_revision_hash: contentHashSchema,
  lifecycle: z.enum(["ENABLED", "DISABLED", "REVOKED"]),
  version: z.number().int().positive().safe(),
  updated_at: timestampSchema,
});

export const mcpServerRegistryItemSchema = z.strictObject({
  schema_version: z.literal("mcp-server-registry-item@1.0.0"),
  revision: mcpServerRevisionSchema,
  head: mcpServerHeadSchema,
});

export type McpServerRevision = z.infer<typeof mcpServerRevisionSchema>;
export type McpToolManifest = z.infer<typeof mcpToolManifestSchema>;
export type McpServerHead = z.infer<typeof mcpServerHeadSchema>;
export type McpServerRegistryItem = z.infer<typeof mcpServerRegistryItemSchema>;

export const toolEffectStateSchema = z.enum([
  "INTENT_COMMITTED",
  "DISPATCH_MARKED",
  "RESPONSE_OBSERVED",
  "COMPLETED",
  "FAILED",
  "TOOL_OUTCOME_UNKNOWN",
]);

const toolEffectIntentDraftSchema = z
  .strictObject({
    schema_version: z.literal("tool-effect-intent@1.0.0"),
    effect_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().positive().safe(),
    task_capability_hash: contentHashSchema,
    projection_receipt_ref: artifactReferenceFor("AgentDataProjectionReceipt"),
    server_id: immutableIdSchema,
    server_revision: z.number().int().positive().safe(),
    server_revision_hash: contentHashSchema,
    tool_id: versionIdentifierSchema,
    effect_semantics: toolEffectSemanticsSchema,
    remote_idempotency_key: z.string().min(8).max(256).nullable(),
    request_payload_hash: contentHashSchema,
    policy_revision: z.number().int().positive().safe(),
  })
  .superRefine((intent, ctx) => {
    if (
      (intent.effect_semantics === "IDEMPOTENT_REQUEST") !==
      (intent.remote_idempotency_key !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Only IDEMPOTENT_REQUEST carries a remote idempotency key.",
        path: ["remote_idempotency_key"],
      });
    }
  });

export const toolEffectIntentSchema = toolEffectIntentDraftSchema.extend({
  intent_hash: contentHashSchema,
});

export async function buildToolEffectIntent(input: unknown) {
  const draft = toolEffectIntentDraftSchema.parse(input);
  return deepFreeze(
    toolEffectIntentSchema.parse({ ...draft, intent_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifyToolEffectIntent(input: unknown) {
  const intent = toolEffectIntentSchema.parse(input);
  const { intent_hash: _hash, ...draft } = intent;
  if ((await sha256ContentHash(draft)) !== intent.intent_hash) {
    throw new TypeError("TOOL_EFFECT_INTENT_HASH_MISMATCH");
  }
  return intent;
}

const toolEffectTransitionDraftSchema = z
  .strictObject({
    schema_version: z.literal("tool-effect-transition@1.0.0"),
    transition_id: immutableIdSchema,
    effect_id: immutableIdSchema,
    expected_state: toolEffectStateSchema,
    target_state: toolEffectStateSchema,
    dispatch_hash: contentHashSchema.nullable(),
    response_hash: contentHashSchema.nullable(),
    delivery_certainty: z.enum(["NOT_DISPATCHED", "DISPATCHED_KNOWN", "DISPATCHED_UNKNOWN"]),
    reason_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
    reconciliation_of: immutableIdSchema.nullable(),
  })
  .superRefine((transition, ctx) => {
    const allowed: Record<z.infer<typeof toolEffectStateSchema>, readonly string[]> = {
      INTENT_COMMITTED: ["DISPATCH_MARKED", "FAILED"],
      DISPATCH_MARKED: ["RESPONSE_OBSERVED", "TOOL_OUTCOME_UNKNOWN"],
      RESPONSE_OBSERVED: ["COMPLETED", "FAILED"],
      TOOL_OUTCOME_UNKNOWN: ["COMPLETED", "FAILED"],
      COMPLETED: [],
      FAILED: [],
    };
    if (!allowed[transition.expected_state].includes(transition.target_state)) {
      ctx.addIssue({ code: "custom", message: "Tool effect transition is invalid." });
    }
    const dispatched =
      transition.target_state !== "FAILED" || transition.expected_state !== "INTENT_COMMITTED";
    if (dispatched !== (transition.dispatch_hash !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "Dispatch hash truth table mismatch.",
        path: ["dispatch_hash"],
      });
    }
    const observed =
      ["RESPONSE_OBSERVED", "COMPLETED", "FAILED"].includes(transition.target_state) &&
      transition.expected_state !== "INTENT_COMMITTED";
    if (observed !== (transition.response_hash !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "Response hash truth table mismatch.",
        path: ["response_hash"],
      });
    }
    const unknown = transition.target_state === "TOOL_OUTCOME_UNKNOWN";
    if (unknown !== (transition.delivery_certainty === "DISPATCHED_UNKNOWN")) {
      ctx.addIssue({ code: "custom", message: "Unknown delivery certainty mismatch." });
    }
    const reconciliation = transition.expected_state === "TOOL_OUTCOME_UNKNOWN";
    if (reconciliation !== (transition.reconciliation_of !== null)) {
      ctx.addIssue({ code: "custom", message: "Unknown reconciliation parent mismatch." });
    }
  });

export const toolEffectTransitionSchema = toolEffectTransitionDraftSchema.extend({
  transition_hash: contentHashSchema,
});

export async function buildToolEffectTransition(input: unknown) {
  const draft = toolEffectTransitionDraftSchema.parse(input);
  return deepFreeze(
    toolEffectTransitionSchema.parse({
      ...draft,
      transition_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyToolEffectTransition(input: unknown) {
  const transition = toolEffectTransitionSchema.parse(input);
  const { transition_hash: _hash, ...draft } = transition;
  if ((await sha256ContentHash(draft)) !== transition.transition_hash) {
    throw new TypeError("TOOL_EFFECT_TRANSITION_HASH_MISMATCH");
  }
  return transition;
}

export type ToolEffectIntent = z.infer<typeof toolEffectIntentSchema>;
export type ToolEffectTransition = z.infer<typeof toolEffectTransitionSchema>;

export const semanticMcpToolNameSchema = z.enum([
  "list_metrics",
  "describe_semantic_model",
  "resolve_context",
  "graph_traversal",
  "query",
]);

export const semanticMcpToolCallSchema = z.discriminatedUnion("tool_name", [
  z.strictObject({
    tool_name: z.literal("list_metrics"),
    arguments: z.strictObject({ semantic_domain: versionIdentifierSchema }),
  }),
  z.strictObject({
    tool_name: z.literal("describe_semantic_model"),
    arguments: z.strictObject({ semantic_domain: versionIdentifierSchema }),
  }),
  z.strictObject({
    tool_name: z.literal("resolve_context"),
    arguments: z.strictObject({}),
  }),
  z.strictObject({
    tool_name: z.literal("graph_traversal"),
    arguments: semanticRelationshipSearchRequestSchema,
  }),
  z.strictObject({
    tool_name: z.literal("query"),
    arguments: z.strictObject({
      query_contract_ref: artifactReferenceFor("QueryContract"),
      resolved_context_binding: resolvedContextText2SqlBindingSchema,
    }),
  }),
]);

export type SemanticMcpToolCall = z.infer<typeof semanticMcpToolCallSchema>;
