import { z } from "zod";
import {
  agentDispatchExecutionBindingSchema,
  agentDispatchPlanSchema,
} from "../agents/dispatch.js";
import {
  agentProductProfileReferenceSchema,
  agentSpecialistProfileIdSchema,
} from "../agents/profile-registry.js";
import { subagentCapabilityCatalogSnapshotSchema } from "../agents/subagent-harness.js";
import { SENSITIVITY_LEVEL } from "../artifacts/text2sql-primitives.js";
import { contentHashSchema, sha256ContentHash, versionIdentifierSchema } from "../common/index.js";
import { modelProviderSchema } from "../providers/index.js";
import {
  canonicalImmutableIdSchema,
  canonicalU2TimestampSchema,
  requestedResourceCollectionSchema,
  requestedSingleResourceSchema,
  versionedResourceReferenceSchema,
  workspaceDefaultsReferenceSchema,
  workspaceScopedAuthoritySchema,
} from "../workspaces/defaults.js";
import { workspaceIdempotencyKeySchema } from "../workspaces/identity.js";
import { runtimeIdentifierSchema } from "./runtime.js";

const positiveRevisionSchema = z.number().int().positive().safe();

function canonicalVersionedResourceArray(max: number) {
  return z
    .array(versionedResourceReferenceSchema)
    .max(max)
    .superRefine((resources, ctx) => {
      const ids = new Set<string>();
      resources.forEach((resource, index) => {
        if (ids.has(resource.resource_id)) {
          ctx.addIssue({
            code: "custom",
            message: "Resource reference 不能重复。",
            path: [index, "resource_id"],
          });
        }
        ids.add(resource.resource_id);
        const previous = resources[index - 1];
        if (previous && previous.resource_id >= resource.resource_id) {
          ctx.addIssue({
            code: "custom",
            message: "Resource reference 必须按 resource_id 规范升序排列。",
            path: [index],
          });
        }
      });
    });
}

export const runConfigOperationSchema = z.enum(["QUESTION_RUN", "SEMANTIC_BOOTSTRAP_JOB"]);

export const runConfigAdmissionSchema = z.enum(["READY", "BLOCKED", "BOOTSTRAP_REQUIRED"]);

export const effectiveConfigRunCommandEnvelopeSchema = z
  .strictObject({
    run_id: canonicalImmutableIdSchema,
    command_id: canonicalImmutableIdSchema,
    event_id: canonicalImmutableIdSchema,
    outbox_id: canonicalImmutableIdSchema,
    audit_id: canonicalImmutableIdSchema,
    idempotency_key: workspaceIdempotencyKeySchema,
    question: z.string().trim().min(1).max(4_000),
    subagent_catalog_snapshot: subagentCapabilityCatalogSnapshotSchema.optional(),
  })
  .superRefine((command, ctx) => {
    if (
      command.subagent_catalog_snapshot &&
      command.subagent_catalog_snapshot.run_id !== command.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Root Harness catalog must be frozen for the same Run.",
        path: ["subagent_catalog_snapshot", "run_id"],
      });
    }
  });

export const effectiveConfigConversationReferenceSchema = z.strictObject({
  conversation_id: canonicalImmutableIdSchema,
  expected_resource_version: positiveRevisionSchema,
});

export const effectiveConfigConversationBindingSchema = z.strictObject({
  conversation_id: canonicalImmutableIdSchema,
  resource_version: positiveRevisionSchema,
});

export const runConfigUnavailableReasonSchema = z.enum([
  "EXPLICITLY_CLEARED",
  "DEFAULT_NOT_CONFIGURED",
  "DEFAULT_REMOVED",
  "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
  "RESOURCE_DISABLED",
  "RESOURCE_REVISION_MISMATCH",
  "RESOURCE_REVOKED",
  "RESOURCE_KIND_MISMATCH",
  "MODEL_NOT_AVAILABLE",
  "SEMANTIC_RELEASE_NOT_PUBLISHED",
  "SCHEMA_SNAPSHOT_STALE",
  "POLICY_REJECTED",
  "EGRESS_PROVIDER_DENIED",
  "EGRESS_AUDIENCE_DENIED",
  "MENTION_RESOURCE_ID_REQUIRED",
]);

export const runConfigResourceKindSchema = z.enum([
  "MODEL_PROFILE",
  "DATASOURCE",
  "FILE",
  "KNOWLEDGE",
  "MCP_SERVER",
  "SKILL",
  "SEMANTIC_RELEASE",
  "SCHEMA_SNAPSHOT",
  "CONTEXT_POLICY",
  "EGRESS_POLICY",
  "EXECUTION_SAFETY_POLICY",
]);

const mandatoryEffectiveConfigResourceKinds = [
  "MODEL_PROFILE",
  "DATASOURCE",
  "SEMANTIC_RELEASE",
  "SCHEMA_SNAPSHOT",
  "CONTEXT_POLICY",
  "EGRESS_POLICY",
  "EXECUTION_SAFETY_POLICY",
] as const;

const mandatoryEffectiveConfigResourceKindSet = new Set<string>(
  mandatoryEffectiveConfigResourceKinds,
);

const optionalEffectiveConfigResourceKindSet = new Set<string>([
  "FILE",
  "KNOWLEDGE",
  "MCP_SERVER",
  "SKILL",
]);

const optionalEffectiveConfigResourceKinds = ["FILE", "KNOWLEDGE", "MCP_SERVER", "SKILL"] as const;

export const optionalSelectionEvaluationSchema = z
  .strictObject({
    resource_kind: z.enum(optionalEffectiveConfigResourceKinds),
    selection_mode: z.enum(["EXPLICIT_NONE", "INHERIT_DEFAULT", "RESOURCE_IDS"]),
    binding_count: z.number().int().nonnegative().max(1_024),
    defaults_ref: workspaceDefaultsReferenceSchema.nullable(),
  })
  .superRefine((evaluation, ctx) => {
    if ((evaluation.selection_mode === "INHERIT_DEFAULT") !== (evaluation.defaults_ref !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "只有 INHERIT_DEFAULT evaluation 必须且只能绑定 Defaults Authority。",
        path: ["defaults_ref"],
      });
    }
    if (evaluation.selection_mode === "EXPLICIT_NONE" && evaluation.binding_count !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "EXPLICIT_NONE evaluation 的 binding_count 必须为零。",
        path: ["binding_count"],
      });
    }
  });

const canonicalOptionalSelectionEvaluationsSchema = z
  .array(optionalSelectionEvaluationSchema)
  .length(optionalEffectiveConfigResourceKinds.length)
  .superRefine((evaluations, ctx) => {
    evaluations.forEach((evaluation, index) => {
      if (evaluation.resource_kind !== optionalEffectiveConfigResourceKinds[index]) {
        ctx.addIssue({
          code: "custom",
          message: "Optional selection evaluations 必须 exact 且按协议 kind 顺序排列。",
          path: [index, "resource_kind"],
        });
      }
    });
  });

export const runResourceMentionSchema = z.strictObject({
  mention_id: canonicalImmutableIdSchema,
  resource_kind: z.enum(["FILE", "KNOWLEDGE", "MCP_SERVER", "SKILL"]),
  resource_id: canonicalImmutableIdSchema,
  expected_revision: positiveRevisionSchema,
});

export const egressAudienceSchema = z.enum(["PRIVATE", "WORKSPACE", "TENANT", "EXTERNAL"]);
export const egressClassificationSchema = z.enum(SENSITIVITY_LEVEL);

const audienceRank: Record<z.infer<typeof egressAudienceSchema>, number> = {
  PRIVATE: 0,
  WORKSPACE: 1,
  TENANT: 2,
  EXTERNAL: 3,
};

const classificationRank: Record<z.infer<typeof egressClassificationSchema>, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  RESTRICTED: 2,
  SECRET: 3,
};

function canonicalUniqueArraySchema<T extends string>(
  itemSchema: z.ZodType<T>,
  compare: (left: T, right: T) => number,
) {
  return z
    .array(itemSchema)
    .min(1)
    .max(64)
    .superRefine((values, ctx) => {
      const seen = new Set<T>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          ctx.addIssue({
            code: "custom",
            message: "策略集合不能包含重复项。",
            path: [index],
          });
        }
        seen.add(value);
        const previous = values[index - 1];
        if (previous && compare(previous, value) >= 0) {
          ctx.addIssue({
            code: "custom",
            message: "策略集合必须使用规范顺序。",
            path: [index],
          });
        }
      });
    });
}

const canonicalProviderArraySchema = canonicalUniqueArraySchema(
  modelProviderSchema,
  (left, right) => (left < right ? -1 : left > right ? 1 : 0),
);

const canonicalAudienceArraySchema = canonicalUniqueArraySchema(
  egressAudienceSchema,
  (left, right) => audienceRank[left] - audienceRank[right],
);

export const egressPolicyValueSchema = z.strictObject({
  allowed_providers: canonicalProviderArraySchema,
  allowed_audiences: canonicalAudienceArraySchema,
  classification: egressClassificationSchema,
});

export const egressNarrowingOverrideSchema = egressPolicyValueSchema;

export function resolveNarrowedEgressPolicy(
  baseInput: unknown,
  overrideInput: unknown,
): z.infer<typeof egressPolicyValueSchema> {
  const base = egressPolicyValueSchema.parse(baseInput);
  const override = egressNarrowingOverrideSchema.parse(overrideInput);
  if (override.allowed_providers.some((provider) => !base.allowed_providers.includes(provider))) {
    throw new TypeError("EGRESS_PROVIDER_DENIED");
  }
  if (override.allowed_audiences.some((audience) => !base.allowed_audiences.includes(audience))) {
    throw new TypeError("EGRESS_AUDIENCE_DENIED");
  }
  if (classificationRank[override.classification] < classificationRank[base.classification]) {
    throw new TypeError("POLICY_REJECTED");
  }
  return override;
}

export const runConfigOverridesSchema = z.strictObject({
  model: requestedSingleResourceSchema,
  datasource: requestedSingleResourceSchema,
  files: requestedResourceCollectionSchema,
  knowledge: requestedResourceCollectionSchema,
  mcp_servers: requestedResourceCollectionSchema,
  skills: requestedResourceCollectionSchema,
  egress: egressNarrowingOverrideSchema.nullable().default(null),
});

const runConfigRequestCommonShape = {
  schema_version: z.literal("run-config-request@1.0.0"),
  workspace_id: canonicalImmutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  defaults_ref: workspaceDefaultsReferenceSchema,
  overrides: runConfigOverridesSchema,
  mentions: z.array(runResourceMentionSchema).max(128),
};

const questionRunConfigRequestDraftSchema = z.strictObject({
  ...runConfigRequestCommonShape,
  operation: z.literal("QUESTION_RUN"),
  run_id: canonicalImmutableIdSchema,
  conversation_ref: effectiveConfigConversationReferenceSchema,
});

const bootstrapRunConfigRequestDraftSchema = z.strictObject({
  ...runConfigRequestCommonShape,
  operation: z.literal("SEMANTIC_BOOTSTRAP_JOB"),
  job_id: canonicalImmutableIdSchema,
  trigger_question_run_id: canonicalImmutableIdSchema.optional(),
});

type RunConfigRequestDraft =
  | z.infer<typeof questionRunConfigRequestDraftSchema>
  | z.infer<typeof bootstrapRunConfigRequestDraftSchema>;

function addRunConfigRequestIssues(request: RunConfigRequestDraft, ctx: z.RefinementCtx): void {
  const mentionIds = new Set<string>();
  const mentionedResources = new Set<string>();
  const explicitOptionalOverrides = new Set<string>();
  for (const [field, resourceKind] of [
    ["files", "FILE"],
    ["knowledge", "KNOWLEDGE"],
    ["mcp_servers", "MCP_SERVER"],
    ["skills", "SKILL"],
  ] as const) {
    const selection = request.overrides[field];
    if (selection.mode === "RESOURCE_IDS") {
      selection.resources.forEach((resource) => {
        explicitOptionalOverrides.add(`${resourceKind}:${resource.resource_id}`);
      });
    }
  }
  request.mentions.forEach((mention, index) => {
    if (mentionIds.has(mention.mention_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Mention ID 不能重复。",
        path: ["mentions", index, "mention_id"],
      });
    }
    mentionIds.add(mention.mention_id);
    const resourceKey = `${mention.resource_kind}:${mention.resource_id}`;
    if (mentionedResources.has(resourceKey)) {
      ctx.addIssue({
        code: "custom",
        message: "同一 optional resource 不能由多个 Mention 重复选择。",
        path: ["mentions", index, "resource_id"],
      });
    }
    if (explicitOptionalOverrides.has(resourceKey)) {
      ctx.addIssue({
        code: "custom",
        message: "同一 optional resource 不能同时由 Override 与 Mention 选择。",
        path: ["mentions", index, "resource_id"],
      });
    }
    mentionedResources.add(resourceKey);
    const previous = request.mentions[index - 1];
    if (previous && previous.mention_id >= mention.mention_id) {
      ctx.addIssue({
        code: "custom",
        message: "Mention 必须按 mention_id 规范升序排列。",
        path: ["mentions", index],
      });
    }
  });
  if (
    request.operation === "SEMANTIC_BOOTSTRAP_JOB" &&
    request.trigger_question_run_id === request.job_id
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Bootstrap job_id 必须独立于 trigger QUESTION_RUN ID。",
      path: ["job_id"],
    });
  }
  if (request.operation === "SEMANTIC_BOOTSTRAP_JOB") {
    if (request.overrides.model.mode !== "EXPLICIT_NONE") {
      ctx.addIssue({
        code: "custom",
        message: "Semantic Bootstrap 不解析 Model，必须显式选择 EXPLICIT_NONE。",
        path: ["overrides", "model"],
      });
    }
    if (request.overrides.egress !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic Bootstrap 不接受 Egress Override。",
        path: ["overrides", "egress"],
      });
    }
    for (const kind of ["mcp_servers", "skills"] as const) {
      if (request.overrides[kind].mode !== "EXPLICIT_NONE") {
        ctx.addIssue({
          code: "custom",
          message: `Semantic Bootstrap 不解析 ${kind}，必须显式选择 EXPLICIT_NONE。`,
          path: ["overrides", kind],
        });
      }
    }
    request.mentions.forEach((mention, index) => {
      if (mention.resource_kind !== "FILE" && mention.resource_kind !== "KNOWLEDGE") {
        ctx.addIssue({
          code: "custom",
          message: "Semantic Bootstrap Mention 只允许 FILE 或 KNOWLEDGE。",
          path: ["mentions", index, "resource_kind"],
        });
      }
    });
  }
}

const runConfigRequestDraftSchema = z
  .discriminatedUnion("operation", [
    questionRunConfigRequestDraftSchema,
    bootstrapRunConfigRequestDraftSchema,
  ])
  .superRefine(addRunConfigRequestIssues);

export const runConfigRequestSchema = z
  .discriminatedUnion("operation", [
    questionRunConfigRequestDraftSchema.extend({ request_hash: contentHashSchema }),
    bootstrapRunConfigRequestDraftSchema.extend({ request_hash: contentHashSchema }),
  ])
  .superRefine(addRunConfigRequestIssues);

export async function computeRunConfigRequestHash(input: unknown) {
  const request = runConfigRequestDraftSchema.parse(input);
  return sha256ContentHash(request);
}

export async function buildRunConfigRequestCandidate(input: unknown) {
  const request = runConfigRequestDraftSchema.parse(input);
  return runConfigRequestSchema.parse({
    ...request,
    request_hash: await computeRunConfigRequestHash(request),
  });
}

export async function verifyRunConfigRequestCandidate(input: unknown) {
  const request = runConfigRequestSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = request;
  if ((await computeRunConfigRequestHash(draft)) !== request.request_hash) {
    throw new TypeError("RUN_CONFIG_REQUEST_HASH_MISMATCH");
  }
  return request;
}

export const effectiveConfigScopeSchema = workspaceScopedAuthoritySchema.safeExtend({
  principal_id: canonicalImmutableIdSchema,
});

export const configAuthorityBindingSchema = z.strictObject({
  authz_epoch: positiveRevisionSchema,
  membership_version: positiveRevisionSchema,
  workspace_lifecycle_version: positiveRevisionSchema,
  route_resolution_id: canonicalImmutableIdSchema,
  route_resolution_hash: contentHashSchema,
  resolver_policy_version: versionIdentifierSchema,
});

export const effectiveRunConfigReferenceSchema = z.strictObject({
  config_id: canonicalImmutableIdSchema,
  config_revision: positiveRevisionSchema,
  config_hash: contentHashSchema,
});

const legacyTeamProfileRefsSchema = z
  .array(agentProductProfileReferenceSchema)
  .length(3)
  .superRefine((references, ctx) => {
    const expected = agentSpecialistProfileIdSchema.options;
    references.forEach((reference, index) => {
      if (reference.profile_id !== expected[index]) {
        ctx.addIssue({
          code: "custom",
          message: "Legacy Team Profile refs must contain all specialists in canonical order.",
          path: [index, "profile_id"],
        });
      }
    });
  });

const legacyEffectiveConfigTeamLeasePayloadSchema = z
  .strictObject({
    kind: z.literal("START_DATA_AGENT_TEAM"),
    effective_config_ref: effectiveRunConfigReferenceSchema,
    profile_refs: legacyTeamProfileRefsSchema,
  })
  .transform((payload) => ({
    ...payload,
    schema_version: "effective-config-team-lease@1.0.0" as const,
    executor_version: "LEGACY_FIXED@1" as const,
  }));

const normalizedLegacyEffectiveConfigTeamLeasePayloadSchema = z.strictObject({
  schema_version: z.literal("effective-config-team-lease@1.0.0"),
  kind: z.literal("START_DATA_AGENT_TEAM"),
  executor_version: z.literal("LEGACY_FIXED@1"),
  effective_config_ref: effectiveRunConfigReferenceSchema,
  profile_refs: legacyTeamProfileRefsSchema,
});

const adaptiveEffectiveConfigTeamLeasePayloadSchema = z
  .strictObject({
    schema_version: z.literal("effective-config-team-lease@2.0.0"),
    kind: z.literal("START_DATA_AGENT_TEAM"),
    executor_version: z.enum(["LEGACY_FIXED@1", "ADAPTIVE@1"]),
    effective_config_ref: effectiveRunConfigReferenceSchema,
    profile_refs: z.array(agentProductProfileReferenceSchema).min(0).max(3),
    dispatch_plan: agentDispatchPlanSchema,
    dispatch_binding: agentDispatchExecutionBindingSchema,
  })
  .superRefine((payload, ctx) => {
    if (payload.executor_version !== payload.dispatch_binding.effective_executor_version) {
      ctx.addIssue({
        code: "custom",
        message: "Team lease executor_version 必须与 dispatch binding 一致。",
        path: ["executor_version"],
      });
    }
    if (
      JSON.stringify(payload.profile_refs) !==
      JSON.stringify(payload.dispatch_binding.selected_profile_refs)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Adaptive Team profile_refs 必须与 dispatch binding 完全一致。",
        path: ["profile_refs"],
      });
    }
    if (
      payload.dispatch_plan.run_id !== payload.dispatch_binding.run_id ||
      payload.dispatch_plan.plan_id !== payload.dispatch_binding.dispatch_plan_ref.plan_id ||
      payload.dispatch_plan.plan_hash !== payload.dispatch_binding.dispatch_plan_ref.plan_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Team lease dispatch plan 必须与 binding 精确闭合。",
        path: ["dispatch_plan"],
      });
    }
    if (
      payload.executor_version === "LEGACY_FIXED@1" &&
      payload.dispatch_binding.shadow_dispatch_plan_ref === null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Versioned SHADOW lease 必须携带 shadow dispatch plan ref。",
        path: ["dispatch_binding", "shadow_dispatch_plan_ref"],
      });
    }
  });

export const rootHarnessEffectiveConfigTeamLeasePayloadSchema = z.strictObject({
  schema_version: z.literal("effective-config-team-lease@3.0.0"),
  kind: z.literal("START_DATA_AGENT_TEAM"),
  executor_version: z.literal("ROOT_HARNESS@1"),
  effective_config_ref: effectiveRunConfigReferenceSchema,
  catalog_snapshot: subagentCapabilityCatalogSnapshotSchema,
  visible_message_refs: z.array(canonicalImmutableIdSchema).min(1).max(64),
});

export const effectiveConfigRunLeasePayloadSchema = z.union([
  z.strictObject({
    kind: z.literal("START_L2_RESEARCH"),
    effective_config_ref: effectiveRunConfigReferenceSchema,
  }),
  legacyEffectiveConfigTeamLeasePayloadSchema,
  normalizedLegacyEffectiveConfigTeamLeasePayloadSchema,
  adaptiveEffectiveConfigTeamLeasePayloadSchema,
  rootHarnessEffectiveConfigTeamLeasePayloadSchema,
]);

export const effectiveModelProfileSchema = versionedResourceReferenceSchema.extend({
  provider: modelProviderSchema,
  model_id: z.string().trim().min(1).max(256),
  profile_version: versionIdentifierSchema,
});

export const effectiveSemanticReleaseSchema = versionedResourceReferenceSchema.extend({
  datasource_id: canonicalImmutableIdSchema,
  semantic_generation: positiveRevisionSchema,
  publication_status: z.literal("PUBLISHED"),
});

export const effectiveSchemaSnapshotSchema = versionedResourceReferenceSchema.extend({
  datasource_id: canonicalImmutableIdSchema,
  semantic_release_id: canonicalImmutableIdSchema,
  semantic_generation: positiveRevisionSchema,
});

export const effectiveContextPolicySchema = versionedResourceReferenceSchema.extend({
  max_context_tokens: z.number().int().positive().safe(),
  max_resource_bindings: z.number().int().positive().max(1_024),
});

export const effectiveEgressPolicySchema = versionedResourceReferenceSchema.extend({
  ...egressPolicyValueSchema.shape,
});

export const effectiveExecutionSafetyPolicySchema = versionedResourceReferenceSchema.extend({
  max_tool_calls: z.number().int().nonnegative().max(10_000),
  max_provider_calls: z.number().int().nonnegative().max(10_000),
  max_elapsed_ms: z.number().int().positive().safe(),
});

const resourceBindingSourceMatrix = {
  MODEL_PROFILE: ["DEFAULT", "OVERRIDE"],
  DATASOURCE: ["DEFAULT", "OVERRIDE"],
  FILE: ["DEFAULT", "OVERRIDE", "MENTION"],
  KNOWLEDGE: ["DEFAULT", "OVERRIDE", "MENTION"],
  MCP_SERVER: ["DEFAULT", "OVERRIDE", "MENTION"],
  SKILL: ["DEFAULT", "OVERRIDE", "MENTION"],
  SEMANTIC_RELEASE: ["ACTIVE_POINTER"],
  SCHEMA_SNAPSHOT: ["DEFAULT", "ACTIVE_POINTER"],
  CONTEXT_POLICY: ["POLICY"],
  EGRESS_POLICY: ["POLICY"],
  EXECUTION_SAFETY_POLICY: ["POLICY"],
} as const;

export const runConfigResourceBindingSchema = z
  .strictObject({
    resource_kind: runConfigResourceKindSchema,
    mention_id: canonicalImmutableIdSchema.nullable(),
    requested_resource_id: canonicalImmutableIdSchema.nullable(),
    requested_revision: positiveRevisionSchema.nullable(),
    effective_resource: versionedResourceReferenceSchema.nullable(),
    source: z.enum(["DEFAULT", "OVERRIDE", "MENTION", "ACTIVE_POINTER", "POLICY"]),
    availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    unavailable_reason: runConfigUnavailableReasonSchema.nullable(),
  })
  .superRefine((binding, ctx) => {
    if (
      !(resourceBindingSourceMatrix[binding.resource_kind] as readonly string[]).includes(
        binding.source,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${binding.resource_kind} 不能由 ${binding.source} Authority 解析。`,
        path: ["source"],
      });
    }
    if (
      binding.availability === "AVAILABLE" &&
      (!binding.effective_resource || binding.unavailable_reason !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "AVAILABLE binding 必须有 effective resource 且不能有 unavailable reason。",
        path: ["availability"],
      });
    }
    if (
      binding.availability === "UNAVAILABLE" &&
      (binding.effective_resource !== null || binding.unavailable_reason === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "UNAVAILABLE binding 必须无 effective resource 且有稳定 reason。",
        path: ["availability"],
      });
    }
    if ((binding.requested_resource_id === null) !== (binding.requested_revision === null)) {
      ctx.addIssue({
        code: "custom",
        message: "requested resource ID/revision 必须同时存在或同时为空。",
        path: ["requested_resource_id"],
      });
    }
    if ((binding.source === "MENTION") !== (binding.mention_id !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "只有 MENTION binding 必须且只能携带 mention_id。",
        path: ["mention_id"],
      });
    }
    if (
      binding.source === "MENTION" &&
      (binding.requested_resource_id === null || binding.requested_revision === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "MENTION binding 必须冻结 requested resource ID/revision。",
        path: ["requested_resource_id"],
      });
    }
    if (
      binding.availability === "AVAILABLE" &&
      (binding.source === "MENTION" ||
        binding.source === "OVERRIDE" ||
        binding.source === "DEFAULT") &&
      (binding.requested_resource_id === null ||
        binding.requested_revision === null ||
        binding.effective_resource?.resource_id !== binding.requested_resource_id ||
        binding.effective_resource.resource_revision !== binding.requested_revision)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "MENTION/OVERRIDE/DEFAULT AVAILABLE binding 的 requested/effective ID/revision 必须一致。",
        path: ["effective_resource"],
      });
    }
    if (
      binding.availability === "AVAILABLE" &&
      (binding.source === "ACTIVE_POINTER" || binding.source === "POLICY") &&
      binding.requested_resource_id !== null &&
      (binding.effective_resource?.resource_id !== binding.requested_resource_id ||
        binding.effective_resource.resource_revision !== binding.requested_revision)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ACTIVE_POINTER/POLICY 的显式 requested ref 必须与 effective ref 一致。",
        path: ["effective_resource"],
      });
    }
    const reasonKindRestrictions: Partial<
      Record<z.infer<typeof runConfigUnavailableReasonSchema>, ReadonlySet<string>>
    > = {
      MODEL_NOT_AVAILABLE: new Set(["MODEL_PROFILE"]),
      SEMANTIC_RELEASE_NOT_PUBLISHED: new Set(["SEMANTIC_RELEASE"]),
      SCHEMA_SNAPSHOT_STALE: new Set(["SCHEMA_SNAPSHOT"]),
      POLICY_REJECTED: new Set(["CONTEXT_POLICY", "EGRESS_POLICY", "EXECUTION_SAFETY_POLICY"]),
      EGRESS_PROVIDER_DENIED: new Set(["EGRESS_POLICY"]),
      EGRESS_AUDIENCE_DENIED: new Set(["EGRESS_POLICY"]),
      MENTION_RESOURCE_ID_REQUIRED: optionalEffectiveConfigResourceKindSet,
    };
    const allowedKinds = binding.unavailable_reason
      ? reasonKindRestrictions[binding.unavailable_reason]
      : undefined;
    if (allowedKinds && !allowedKinds.has(binding.resource_kind)) {
      ctx.addIssue({
        code: "custom",
        message: `${binding.unavailable_reason} 不能归因于 ${binding.resource_kind} binding。`,
        path: ["unavailable_reason"],
      });
    }
  });

const canonicalResourceBindingsSchema = z
  .array(runConfigResourceBindingSchema)
  .max(1_024)
  .superRefine((bindings, ctx) => {
    const keys = new Set<string>();
    bindings.forEach((binding, index) => {
      const resourceId = binding.effective_resource?.resource_id ?? binding.requested_resource_id;
      const key = `${binding.resource_kind}:${resourceId ?? "NONE"}`;
      if (keys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Resource binding 不能重复。",
          path: [index],
        });
      }
      keys.add(key);
      const previous = bindings[index - 1];
      if (previous) {
        const previousId =
          previous.effective_resource?.resource_id ?? previous.requested_resource_id ?? "NONE";
        const previousKey = `${previous.resource_kind}:${previousId}`;
        if (previousKey >= key) {
          ctx.addIssue({
            code: "custom",
            message: "Resource binding 必须按 kind/resource_id 规范升序排列。",
            path: [index],
          });
        }
      }
    });
  });

function addOptionalSelectionEvaluationIssues(
  container: Readonly<{
    defaults_ref: z.infer<typeof workspaceDefaultsReferenceSchema>;
    resource_bindings: z.infer<typeof canonicalResourceBindingsSchema>;
    optional_selection_evaluations: z.infer<typeof canonicalOptionalSelectionEvaluationsSchema>;
  }>,
  ctx: z.RefinementCtx,
): void {
  for (const evaluation of container.optional_selection_evaluations) {
    const evaluatedBindings = container.resource_bindings.filter(
      (binding) =>
        binding.resource_kind === evaluation.resource_kind && binding.source !== "MENTION",
    );
    const expectedSource =
      evaluation.selection_mode === "INHERIT_DEFAULT"
        ? "DEFAULT"
        : evaluation.selection_mode === "RESOURCE_IDS"
          ? "OVERRIDE"
          : null;
    const defaultsMatch =
      evaluation.selection_mode !== "INHERIT_DEFAULT" ||
      (evaluation.defaults_ref?.defaults_id === container.defaults_ref.defaults_id &&
        evaluation.defaults_ref.defaults_revision === container.defaults_ref.defaults_revision &&
        evaluation.defaults_ref.defaults_hash === container.defaults_ref.defaults_hash);
    if (
      evaluation.binding_count !== evaluatedBindings.length ||
      (expectedSource === null
        ? evaluatedBindings.length !== 0
        : evaluatedBindings.some((binding) => binding.source !== expectedSource)) ||
      !defaultsMatch
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Optional selection evaluation 必须与 Defaults Authority 及 bindings 精确闭合。",
        path: ["optional_selection_evaluations"],
      });
    }
  }
}

function sameVersionedResource(
  left: z.infer<typeof versionedResourceReferenceSchema>,
  right: z.infer<typeof versionedResourceReferenceSchema>,
): boolean {
  return (
    left.resource_id === right.resource_id &&
    left.resource_revision === right.resource_revision &&
    left.resource_hash === right.resource_hash
  );
}

const effectiveRunConfigReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("effective-run-config-receipt@1.0.0"),
    config_id: canonicalImmutableIdSchema,
    config_revision: positiveRevisionSchema,
    scope: effectiveConfigScopeSchema,
    run_id: canonicalImmutableIdSchema,
    operation: z.literal("QUESTION_RUN"),
    admission: z.literal("READY").default("READY"),
    conversation_binding: effectiveConfigConversationBindingSchema,
    request_hash: contentHashSchema,
    defaults_ref: workspaceDefaultsReferenceSchema,
    authority_binding: configAuthorityBindingSchema,
    model: effectiveModelProfileSchema,
    datasource: versionedResourceReferenceSchema,
    semantic_release: effectiveSemanticReleaseSchema,
    schema_snapshot: effectiveSchemaSnapshotSchema,
    context_policy: effectiveContextPolicySchema,
    egress_policy: effectiveEgressPolicySchema,
    execution_safety_policy: effectiveExecutionSafetyPolicySchema,
    resource_bindings: canonicalResourceBindingsSchema,
    optional_selection_evaluations: canonicalOptionalSelectionEvaluationsSchema,
    effective_egress: egressPolicyValueSchema,
  })
  .superRefine((config, ctx) => {
    addOptionalSelectionEvaluationIssues(config, ctx);
    if (
      config.semantic_release.datasource_id !== config.datasource.resource_id ||
      config.schema_snapshot.datasource_id !== config.datasource.resource_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic Release、Schema Snapshot 与 Datasource 必须一致。",
        path: ["schema_snapshot", "datasource_id"],
      });
    }
    if (
      config.schema_snapshot.semantic_release_id !== config.semantic_release.resource_id ||
      config.schema_snapshot.semantic_generation !== config.semantic_release.semantic_generation
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Schema Snapshot 必须绑定相同 Semantic Release 与 Generation。",
        path: ["schema_snapshot", "semantic_release_id"],
      });
    }
    try {
      resolveNarrowedEgressPolicy(
        {
          allowed_providers: config.egress_policy.allowed_providers,
          allowed_audiences: config.egress_policy.allowed_audiences,
          classification: config.egress_policy.classification,
        },
        config.effective_egress,
      );
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "POLICY_REJECTED",
        path: ["effective_egress"],
      });
    }
    if (!config.effective_egress.allowed_providers.includes(config.model.provider)) {
      ctx.addIssue({
        code: "custom",
        message: "Effective Egress 必须允许冻结的 Model Provider。",
        path: ["model", "provider"],
      });
    }
    const expectedMandatoryResources = new Map<
      string,
      z.infer<typeof versionedResourceReferenceSchema>
    >([
      ["MODEL_PROFILE", config.model],
      ["DATASOURCE", config.datasource],
      ["SEMANTIC_RELEASE", config.semantic_release],
      ["SCHEMA_SNAPSHOT", config.schema_snapshot],
      ["CONTEXT_POLICY", config.context_policy],
      ["EGRESS_POLICY", config.egress_policy],
      ["EXECUTION_SAFETY_POLICY", config.execution_safety_policy],
    ]);
    for (const [kind, expected] of expectedMandatoryResources) {
      const matches = config.resource_bindings.filter((binding) => binding.resource_kind === kind);
      if (
        matches.length !== 1 ||
        matches[0]?.availability !== "AVAILABLE" ||
        !matches[0].effective_resource ||
        !sameVersionedResource(matches[0].effective_resource, expected)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `READY Effective Config 必须唯一冻结 exact ${kind} AVAILABLE binding。`,
          path: ["resource_bindings"],
        });
      }
    }
    config.resource_bindings.forEach((binding, index) => {
      if (
        binding.availability === "UNAVAILABLE" &&
        !optionalEffectiveConfigResourceKindSet.has(binding.resource_kind)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "READY Effective Config 只允许 optional resource binding 为 UNAVAILABLE。",
          path: ["resource_bindings", index, "availability"],
        });
      }
    });
  });

export const effectiveRunConfigReceiptCandidateSchema =
  effectiveRunConfigReceiptDraftSchema.safeExtend({
    config_hash: contentHashSchema,
  });

export async function computeEffectiveRunConfigHash(input: unknown) {
  return sha256ContentHash(effectiveRunConfigReceiptDraftSchema.parse(input));
}

export async function buildEffectiveRunConfigReceiptCandidate(input: unknown) {
  const config = effectiveRunConfigReceiptDraftSchema.parse(input);
  return effectiveRunConfigReceiptCandidateSchema.parse({
    ...config,
    config_hash: await computeEffectiveRunConfigHash(config),
  });
}

export async function verifyEffectiveRunConfigReceiptCandidate(input: unknown) {
  const config = effectiveRunConfigReceiptCandidateSchema.parse(input);
  const { config_hash: _configHash, ...draft } = config;
  if ((await computeEffectiveRunConfigHash(draft)) !== config.config_hash) {
    throw new TypeError("EFFECTIVE_RUN_CONFIG_HASH_MISMATCH");
  }
  return config;
}

export const bootstrapSchemaSnapshotBindingSchema = versionedResourceReferenceSchema.extend({
  datasource_id: canonicalImmutableIdSchema,
});

export const bootstrapSourceResourceSchema = z.strictObject({
  resource_kind: z.enum(["FILE", "KNOWLEDGE"]),
  mention_id: canonicalImmutableIdSchema.nullable(),
  resource_id: canonicalImmutableIdSchema,
  resource_revision: positiveRevisionSchema,
  resource_hash: contentHashSchema,
});

const canonicalBootstrapSourceResourcesSchema = z
  .array(bootstrapSourceResourceSchema)
  .max(128)
  .superRefine((resources, ctx) => {
    const keys = new Set<string>();
    resources.forEach((resource, index) => {
      const key = `${resource.resource_kind}:${resource.resource_id}`;
      if (keys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Bootstrap source allowlist 不能重复。",
          path: [index],
        });
      }
      keys.add(key);
      const previous = resources[index - 1];
      if (previous && `${previous.resource_kind}:${previous.resource_id}` >= key) {
        ctx.addIssue({
          code: "custom",
          message: "Bootstrap source allowlist 必须按 kind/resource_id 规范升序排列。",
          path: [index],
        });
      }
    });
  });

export const bootstrapJobConfigCandidateSchema = z
  .strictObject({
    schema_version: z.literal("semantic-bootstrap-job-config@1.0.0"),
    scope: effectiveConfigScopeSchema,
    job_id: canonicalImmutableIdSchema,
    trigger_question_run_id: canonicalImmutableIdSchema.optional(),
    operation: z.literal("SEMANTIC_BOOTSTRAP_JOB"),
    request_hash: contentHashSchema,
    defaults_ref: workspaceDefaultsReferenceSchema,
    authority_binding: configAuthorityBindingSchema,
    datasource: versionedResourceReferenceSchema,
    semantic_release: z.null(),
    schema_snapshot: bootstrapSchemaSnapshotBindingSchema,
    source_resources: canonicalBootstrapSourceResourcesSchema,
    resource_bindings: canonicalResourceBindingsSchema,
  })
  .superRefine((config, ctx) => {
    if (config.trigger_question_run_id === config.job_id) {
      ctx.addIssue({
        code: "custom",
        message: "Bootstrap job_id 必须独立于 trigger QUESTION_RUN ID。",
        path: ["job_id"],
      });
    }
    if (config.schema_snapshot.datasource_id !== config.datasource.resource_id) {
      ctx.addIssue({
        code: "custom",
        message: "Bootstrap Schema Snapshot 必须绑定已解析 Datasource。",
        path: ["schema_snapshot", "datasource_id"],
      });
    }
    const allowedBootstrapKinds = new Set(["DATASOURCE", "FILE", "KNOWLEDGE", "SCHEMA_SNAPSHOT"]);
    const datasourceBindings = config.resource_bindings.filter(
      (binding) => binding.resource_kind === "DATASOURCE",
    );
    const snapshotBindings = config.resource_bindings.filter(
      (binding) => binding.resource_kind === "SCHEMA_SNAPSHOT",
    );
    const datasourceBinding = datasourceBindings[0];
    const snapshotBinding = snapshotBindings[0];
    if (
      datasourceBindings.length !== 1 ||
      datasourceBinding?.availability !== "AVAILABLE" ||
      datasourceBinding?.effective_resource?.resource_id !== config.datasource.resource_id ||
      datasourceBinding.effective_resource.resource_revision !==
        config.datasource.resource_revision ||
      datasourceBinding.effective_resource.resource_hash !== config.datasource.resource_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Bootstrap Job 必须冻结 exact Datasource resource binding。",
        path: ["resource_bindings"],
      });
    }
    if (
      snapshotBindings.length !== 1 ||
      snapshotBinding?.availability !== "AVAILABLE" ||
      snapshotBinding?.effective_resource?.resource_id !== config.schema_snapshot.resource_id ||
      snapshotBinding.effective_resource.resource_revision !==
        config.schema_snapshot.resource_revision ||
      snapshotBinding.effective_resource.resource_hash !== config.schema_snapshot.resource_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Bootstrap Job 必须冻结 exact Schema Snapshot resource binding。",
        path: ["resource_bindings"],
      });
    }
    if (
      config.resource_bindings.some((binding) => !allowedBootstrapKinds.has(binding.resource_kind))
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Bootstrap Job Config 只能冻结 Datasource、Schema Snapshot 与显式 source allowlist。",
        path: ["resource_bindings"],
      });
    }
    const sourceBindings = config.resource_bindings.filter(
      (binding) => binding.resource_kind === "FILE" || binding.resource_kind === "KNOWLEDGE",
    );
    const expectedSourceResources = sourceBindings.map((binding) => ({
      resource_kind: binding.resource_kind as "FILE" | "KNOWLEDGE",
      mention_id: binding.mention_id,
      resource_id: binding.effective_resource?.resource_id,
      resource_revision: binding.effective_resource?.resource_revision,
      resource_hash: binding.effective_resource?.resource_hash,
    }));
    if (
      sourceBindings.some(
        (binding) =>
          binding.requested_resource_id === null ||
          binding.requested_revision === null ||
          binding.availability !== "AVAILABLE" ||
          binding.unavailable_reason !== null ||
          binding.effective_resource?.resource_id !== binding.requested_resource_id ||
          binding.effective_resource.resource_revision !== binding.requested_revision,
      ) ||
      JSON.stringify(expectedSourceResources) !== JSON.stringify(config.source_resources)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Bootstrap source allowlist 必须与 AVAILABLE FILE/KNOWLEDGE bindings 精确一致。",
        path: ["source_resources"],
      });
    }
  });

const resolutionReceiptCommonShape = {
  schema_version: z.literal("run-config-resolution-receipt@1.0.0"),
  resolution_id: canonicalImmutableIdSchema,
  scope: effectiveConfigScopeSchema,
  request_hash: contentHashSchema,
  defaults_ref: workspaceDefaultsReferenceSchema,
  authority_binding: configAuthorityBindingSchema,
  resource_bindings: canonicalResourceBindingsSchema,
  optional_selection_evaluations: canonicalOptionalSelectionEvaluationsSchema,
  resolved_at: canonicalU2TimestampSchema,
};

const questionResolutionShape = {
  ...resolutionReceiptCommonShape,
  run_id: canonicalImmutableIdSchema,
  operation: z.literal("QUESTION_RUN"),
  conversation_ref: effectiveConfigConversationReferenceSchema,
};

const bootstrapResolutionShape = {
  ...resolutionReceiptCommonShape,
  job_id: canonicalImmutableIdSchema,
  trigger_question_run_id: canonicalImmutableIdSchema.optional(),
  operation: z.literal("SEMANTIC_BOOTSTRAP_JOB"),
};

const canonicalUnavailableReasonsSchema = z
  .array(runConfigUnavailableReasonSchema)
  .min(1)
  .max(32)
  .superRefine((reasons, ctx) => {
    reasons.forEach((reason, index) => {
      const previous = reasons[index - 1];
      if (
        previous &&
        runConfigUnavailableReasonSchema.options.indexOf(previous) >=
          runConfigUnavailableReasonSchema.options.indexOf(reason)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Unavailable reasons 必须唯一并按协议顺序排列。",
          path: [index],
        });
      }
    });
  });

const readyResolutionDraftSchema = z.strictObject({
  ...questionResolutionShape,
  admission: z.literal("READY"),
  unavailable_reasons: z.tuple([]),
  effective_config_ref: effectiveRunConfigReferenceSchema,
  required_action: z.null(),
  bootstrap_job_config: z.null(),
});

const blockedUnavailableReasonsSchema = canonicalUnavailableReasonsSchema;

const blockedResolutionDraftSchema = z.strictObject({
  ...questionResolutionShape,
  admission: z.literal("BLOCKED"),
  unavailable_reasons: blockedUnavailableReasonsSchema,
  effective_config_ref: z.null(),
  required_action: z.null(),
  bootstrap_job_config: z.null(),
});

const bootstrapRequiredResolutionDraftSchema = z.strictObject({
  ...questionResolutionShape,
  admission: z.literal("BOOTSTRAP_REQUIRED"),
  unavailable_reasons: canonicalUnavailableReasonsSchema.refine(
    (reasons) => reasons.includes("SEMANTIC_RELEASE_NOT_PUBLISHED"),
    {
      message: "BOOTSTRAP_REQUIRED 必须包含 SEMANTIC_RELEASE_NOT_PUBLISHED。",
    },
  ),
  effective_config_ref: z.null(),
  required_action: z.literal("SEMANTIC_BOOTSTRAP"),
  bootstrap_job_config: z.null(),
});

const bootstrapReadyResolutionDraftSchema = z.strictObject({
  ...bootstrapResolutionShape,
  admission: z.literal("READY"),
  unavailable_reasons: z.tuple([]),
  effective_config_ref: z.null(),
  required_action: z.null(),
  bootstrap_job_config: bootstrapJobConfigCandidateSchema,
});

const bootstrapBlockedResolutionDraftSchema = z.strictObject({
  ...bootstrapResolutionShape,
  admission: z.literal("BLOCKED"),
  unavailable_reasons: blockedUnavailableReasonsSchema,
  effective_config_ref: z.null(),
  required_action: z.null(),
  bootstrap_job_config: z.null(),
});

type ResolutionReceiptDraft =
  | z.infer<typeof readyResolutionDraftSchema>
  | z.infer<typeof blockedResolutionDraftSchema>
  | z.infer<typeof bootstrapRequiredResolutionDraftSchema>
  | z.infer<typeof bootstrapReadyResolutionDraftSchema>
  | z.infer<typeof bootstrapBlockedResolutionDraftSchema>;

function sameAuthorityBinding(
  left: z.infer<typeof configAuthorityBindingSchema>,
  right: z.infer<typeof configAuthorityBindingSchema>,
): boolean {
  return (
    left.authz_epoch === right.authz_epoch &&
    left.membership_version === right.membership_version &&
    left.workspace_lifecycle_version === right.workspace_lifecycle_version &&
    left.route_resolution_id === right.route_resolution_id &&
    left.route_resolution_hash === right.route_resolution_hash &&
    left.resolver_policy_version === right.resolver_policy_version
  );
}

function sameBootstrapEnvelope(
  bootstrap: z.infer<typeof bootstrapJobConfigCandidateSchema>,
  resolution: ResolutionReceiptDraft,
): boolean {
  return (
    bootstrap.request_hash === resolution.request_hash &&
    bootstrap.defaults_ref.defaults_id === resolution.defaults_ref.defaults_id &&
    bootstrap.defaults_ref.defaults_revision === resolution.defaults_ref.defaults_revision &&
    bootstrap.defaults_ref.defaults_hash === resolution.defaults_ref.defaults_hash &&
    bootstrap.scope.app_id === resolution.scope.app_id &&
    bootstrap.scope.tenant_id === resolution.scope.tenant_id &&
    bootstrap.scope.environment === resolution.scope.environment &&
    bootstrap.scope.workspace_id === resolution.scope.workspace_id &&
    bootstrap.scope.principal_id === resolution.scope.principal_id &&
    sameAuthorityBinding(bootstrap.authority_binding, resolution.authority_binding)
  );
}

function addResolutionBindingIssues(
  resolution: ResolutionReceiptDraft,
  ctx: z.RefinementCtx,
): void {
  addOptionalSelectionEvaluationIssues(resolution, ctx);
  const dependencyBindings = new Map(
    ["DATASOURCE", "SEMANTIC_RELEASE", "SCHEMA_SNAPSHOT"].map((kind) => [
      kind,
      resolution.resource_bindings.filter((binding) => binding.resource_kind === kind),
    ]),
  );
  if ([...dependencyBindings.values()].some((bindings) => bindings.length > 1)) {
    ctx.addIssue({
      code: "custom",
      message: "Resolution dependency Authority 每类最多冻结一个 binding。",
      path: ["resource_bindings"],
    });
  }
  const datasourceAvailable = dependencyBindings
    .get("DATASOURCE")
    ?.some((binding) => binding.availability === "AVAILABLE");
  const semanticAvailable = resolution.resource_bindings.some(
    (binding) =>
      binding.resource_kind === "SEMANTIC_RELEASE" && binding.availability === "AVAILABLE",
  );
  const snapshotAvailable = resolution.resource_bindings.some(
    (binding) =>
      binding.resource_kind === "SCHEMA_SNAPSHOT" && binding.availability === "AVAILABLE",
  );
  const dependencyClosureBroken =
    (!datasourceAvailable && (semanticAvailable || snapshotAvailable)) ||
    (resolution.operation === "QUESTION_RUN" && snapshotAvailable && !semanticAvailable);
  if (dependencyClosureBroken) {
    ctx.addIssue({
      code: "custom",
      message: "Resolution 不能把不可用 Authority 的逻辑下游标记为 AVAILABLE。",
      path: ["resource_bindings"],
    });
  }
  if (resolution.operation === "QUESTION_RUN") {
    const mandatoryBindings = resolution.resource_bindings.filter((binding) =>
      mandatoryEffectiveConfigResourceKindSet.has(binding.resource_kind),
    );
    const exactMandatoryKinds = new Set(mandatoryBindings.map((binding) => binding.resource_kind));
    if (
      resolution.admission === "READY" &&
      (mandatoryBindings.length !== mandatoryEffectiveConfigResourceKinds.length ||
        exactMandatoryKinds.size !== mandatoryEffectiveConfigResourceKinds.length)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "QUESTION Resolution 必须恰好包含七类 mandatory resource binding。",
        path: ["resource_bindings"],
      });
    }
    if (
      resolution.admission === "BLOCKED" &&
      exactMandatoryKinds.size !== mandatoryBindings.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "BLOCKED Resolution 的已评估 mandatory kind 不能重复。",
        path: ["resource_bindings"],
      });
    }
    const unavailableMandatoryReasons = runConfigUnavailableReasonSchema.options.filter((reason) =>
      mandatoryBindings.some(
        (binding) =>
          binding.availability === "UNAVAILABLE" && binding.unavailable_reason === reason,
      ),
    );
    if (resolution.admission === "READY") {
      if (
        mandatoryBindings.some((binding) => binding.availability !== "AVAILABLE") ||
        resolution.resource_bindings.some(
          (binding) =>
            binding.availability === "UNAVAILABLE" &&
            !optionalEffectiveConfigResourceKindSet.has(binding.resource_kind),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "READY Resolution 的 mandatory bindings 必须全部 AVAILABLE。",
          path: ["resource_bindings"],
        });
      }
    } else if (resolution.admission === "BLOCKED") {
      const unavailableReasons = runConfigUnavailableReasonSchema.options.filter((reason) =>
        resolution.resource_bindings.some(
          (binding) =>
            binding.availability === "UNAVAILABLE" && binding.unavailable_reason === reason,
        ),
      );
      const semanticUnavailable = unavailableReasons.includes("SEMANTIC_RELEASE_NOT_PUBLISHED");
      const hasNonSemanticBlocker = unavailableReasons.some(
        (reason) => reason !== "SEMANTIC_RELEASE_NOT_PUBLISHED",
      );
      if (
        unavailableMandatoryReasons.length === 0 ||
        JSON.stringify(unavailableReasons) !== JSON.stringify(resolution.unavailable_reasons) ||
        (semanticUnavailable && !hasNonSemanticBlocker)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "BLOCKED 必须含真实 mandatory failure，reasons 精确闭合全部 failures，且仅 Semantic unavailable 必须映射为 BOOTSTRAP_REQUIRED。",
          path: ["unavailable_reasons"],
        });
      }
    } else {
      const semanticBindings = mandatoryBindings.filter(
        (binding) => binding.resource_kind === "SEMANTIC_RELEASE",
      );
      const unavailableBindings = resolution.resource_bindings.filter(
        (binding) => binding.availability === "UNAVAILABLE",
      );
      if (
        unavailableBindings.length !== 1 ||
        semanticBindings.length !== 1 ||
        semanticBindings[0]?.availability !== "UNAVAILABLE" ||
        semanticBindings[0].unavailable_reason !== "SEMANTIC_RELEASE_NOT_PUBLISHED" ||
        mandatoryBindings.some((binding) => binding.resource_kind === "SCHEMA_SNAPSHOT") ||
        mandatoryBindings.length !== mandatoryEffectiveConfigResourceKinds.length - 1 ||
        resolution.resource_bindings.some(
          (binding) =>
            binding.resource_kind === "SEMANTIC_RELEASE" && binding.availability === "AVAILABLE",
        ) ||
        resolution.unavailable_reasons.length !== 1 ||
        resolution.unavailable_reasons[0] !== "SEMANTIC_RELEASE_NOT_PUBLISHED"
      ) {
        ctx.addIssue({
          code: "custom",
          message: "BOOTSTRAP_REQUIRED 必须唯一冻结 unavailable Semantic Release 与固定 reason。",
          path: ["resource_bindings"],
        });
      }
    }
    return;
  }
  if (resolution.admission === "BLOCKED") {
    const unavailableReasons = runConfigUnavailableReasonSchema.options.filter((reason) =>
      resolution.resource_bindings.some(
        (binding) =>
          binding.availability === "UNAVAILABLE" && binding.unavailable_reason === reason,
      ),
    );
    if (
      unavailableReasons.length === 0 ||
      JSON.stringify(unavailableReasons) !== JSON.stringify(resolution.unavailable_reasons) ||
      unavailableReasons.includes("SEMANTIC_RELEASE_NOT_PUBLISHED")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Bootstrap BLOCKED reasons 必须精确等于实际 unavailable bindings。",
        path: ["unavailable_reasons"],
      });
    }
    if (
      resolution.resource_bindings.some(
        (binding) =>
          binding.resource_kind === "SEMANTIC_RELEASE" && binding.availability === "AVAILABLE",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Bootstrap Resolution 不能携带 AVAILABLE Semantic Release。",
        path: ["resource_bindings"],
      });
    }
    return;
  }
  const bootstrap = resolution.bootstrap_job_config;
  const identityMatches =
    bootstrap.job_id === resolution.job_id &&
    bootstrap.trigger_question_run_id === resolution.trigger_question_run_id;
  const bindingsMatch =
    JSON.stringify(bootstrap.resource_bindings) === JSON.stringify(resolution.resource_bindings);
  if (!identityMatches || !sameBootstrapEnvelope(bootstrap, resolution) || !bindingsMatch) {
    ctx.addIssue({
      code: "custom",
      message:
        "Bootstrap Job 必须使用独立 job_id 并与 Resolution 的 trigger/scope/request/defaults/authority 精确一致。",
      path: ["bootstrap_job_config"],
    });
  }
}

const runConfigResolutionReceiptDraftSchema = z
  .union([
    readyResolutionDraftSchema,
    blockedResolutionDraftSchema,
    bootstrapRequiredResolutionDraftSchema,
    bootstrapReadyResolutionDraftSchema,
    bootstrapBlockedResolutionDraftSchema,
  ])
  .superRefine(addResolutionBindingIssues);

export const runConfigResolutionReceiptCandidateSchema = z
  .union([
    readyResolutionDraftSchema.extend({ resolution_hash: contentHashSchema }),
    blockedResolutionDraftSchema.extend({ resolution_hash: contentHashSchema }),
    bootstrapRequiredResolutionDraftSchema.extend({ resolution_hash: contentHashSchema }),
    bootstrapReadyResolutionDraftSchema.extend({ resolution_hash: contentHashSchema }),
    bootstrapBlockedResolutionDraftSchema.extend({ resolution_hash: contentHashSchema }),
  ])
  .superRefine(addResolutionBindingIssues);

export async function computeRunConfigResolutionReceiptHash(input: unknown) {
  return sha256ContentHash(runConfigResolutionReceiptDraftSchema.parse(input));
}

export async function buildRunConfigResolutionReceiptCandidate(input: unknown) {
  const resolution = runConfigResolutionReceiptDraftSchema.parse(input);
  return runConfigResolutionReceiptCandidateSchema.parse({
    ...resolution,
    resolution_hash: await computeRunConfigResolutionReceiptHash(resolution),
  });
}

export async function verifyRunConfigResolutionReceiptCandidate(input: unknown) {
  const resolution = runConfigResolutionReceiptCandidateSchema.parse(input);
  const { resolution_hash: _resolutionHash, ...draft } = resolution;
  if ((await computeRunConfigResolutionReceiptHash(draft)) !== resolution.resolution_hash) {
    throw new TypeError("RUN_CONFIG_RESOLUTION_HASH_MISMATCH");
  }
  return resolution;
}

const contextReceiptBindingCommonShape = {
  schema_version: z.literal("effective-config-context-receipt@1.0.0"),
  receipt_id: canonicalImmutableIdSchema,
  outbox_id: canonicalImmutableIdSchema,
  command_id: canonicalImmutableIdSchema,
  scope: effectiveConfigScopeSchema,
  run_id: canonicalImmutableIdSchema,
  config_ref: effectiveRunConfigReferenceSchema,
  semantic_release: effectiveSemanticReleaseSchema,
  schema_snapshot: effectiveSchemaSnapshotSchema,
  context_policy: versionedResourceReferenceSchema,
  provider: modelProviderSchema,
  audiences: canonicalAudienceArraySchema,
  classification: egressClassificationSchema,
  resource_refs: canonicalVersionedResourceArray(1_024),
  consumed_at: canonicalU2TimestampSchema,
};

const runAcceptanceContextReceiptDraftSchema = z.strictObject({
  ...contextReceiptBindingCommonShape,
  consumer: z.literal("RUN_ACCEPTANCE"),
  consumer_id: canonicalImmutableIdSchema,
  attempt_id: z.null(),
  lease_token: z.null(),
  worker_fence: z.literal(0),
});

const workerStartContextReceiptDraftSchema = z.strictObject({
  ...contextReceiptBindingCommonShape,
  consumer: z.literal("WORKER_START"),
  consumer_id: runtimeIdentifierSchema,
  attempt_id: canonicalImmutableIdSchema,
  lease_token: z.number().int().positive().safe(),
  worker_fence: z.number().int().positive().safe(),
});

const contextReceiptBindingDraftSchema = z
  .discriminatedUnion("consumer", [
    runAcceptanceContextReceiptDraftSchema,
    workerStartContextReceiptDraftSchema,
  ])
  .superRefine((binding, ctx) => {
    if (
      binding.schema_snapshot.semantic_release_id !== binding.semantic_release.resource_id ||
      binding.schema_snapshot.semantic_generation !==
        binding.semantic_release.semantic_generation ||
      binding.schema_snapshot.datasource_id !== binding.semantic_release.datasource_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Context Receipt 的 Release/Snapshot 必须精确一致。",
        path: ["schema_snapshot"],
      });
    }
    if (
      binding.consumer === "RUN_ACCEPTANCE" &&
      (binding.outbox_id !== binding.receipt_id ||
        binding.command_id !== binding.consumer_id ||
        binding.command_id !== binding.config_ref.config_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "RUN_ACCEPTANCE Context Receipt 必须绑定原子 acceptance 的 outbox/command/config identity。",
        path: ["command_id"],
      });
    }
  });

export const contextReceiptBindingSchema = z
  .discriminatedUnion("consumer", [
    runAcceptanceContextReceiptDraftSchema.extend({ receipt_hash: contentHashSchema }),
    workerStartContextReceiptDraftSchema.extend({ receipt_hash: contentHashSchema }),
  ])
  .superRefine((binding, ctx) => {
    if (
      binding.schema_snapshot.semantic_release_id !== binding.semantic_release.resource_id ||
      binding.schema_snapshot.semantic_generation !==
        binding.semantic_release.semantic_generation ||
      binding.schema_snapshot.datasource_id !== binding.semantic_release.datasource_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Context Receipt 的 Release/Snapshot 必须精确一致。",
        path: ["schema_snapshot"],
      });
    }
    if (
      binding.consumer === "RUN_ACCEPTANCE" &&
      (binding.outbox_id !== binding.receipt_id ||
        binding.command_id !== binding.consumer_id ||
        binding.command_id !== binding.config_ref.config_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "RUN_ACCEPTANCE Context Receipt 必须绑定原子 acceptance 的 outbox/command/config identity。",
        path: ["command_id"],
      });
    }
  });

export async function computeContextReceiptBindingHash(input: unknown) {
  return sha256ContentHash(contextReceiptBindingDraftSchema.parse(input));
}

export async function buildContextReceiptBindingCandidate(input: unknown) {
  const binding = contextReceiptBindingDraftSchema.parse(input);
  return contextReceiptBindingSchema.parse({
    ...binding,
    receipt_hash: await computeContextReceiptBindingHash(binding),
  });
}

export async function verifyContextReceiptBindingCandidate(input: unknown) {
  const binding = contextReceiptBindingSchema.parse(input);
  const { receipt_hash: _receiptHash, ...draft } = binding;
  if ((await computeContextReceiptBindingHash(draft)) !== binding.receipt_hash) {
    throw new TypeError("CONTEXT_RECEIPT_HASH_MISMATCH");
  }
  return binding;
}

export type RunConfigOperation = z.infer<typeof runConfigOperationSchema>;
export type RunConfigAdmission = z.infer<typeof runConfigAdmissionSchema>;
export type RunConfigUnavailableReason = z.infer<typeof runConfigUnavailableReasonSchema>;
export type OptionalSelectionEvaluation = z.infer<typeof optionalSelectionEvaluationSchema>;
export type EffectiveConfigRunCommandEnvelope = z.infer<
  typeof effectiveConfigRunCommandEnvelopeSchema
>;
export type EffectiveConfigRunLeasePayload = z.infer<typeof effectiveConfigRunLeasePayloadSchema>;
export type EffectiveConfigConversationReference = z.infer<
  typeof effectiveConfigConversationReferenceSchema
>;
export type EffectiveConfigConversationBinding = z.infer<
  typeof effectiveConfigConversationBindingSchema
>;
export type RunConfigRequest = z.infer<typeof runConfigRequestSchema>;
export type RunConfigOverrides = z.infer<typeof runConfigOverridesSchema>;
export type RunResourceMention = z.infer<typeof runResourceMentionSchema>;
export type EgressPolicyValue = z.infer<typeof egressPolicyValueSchema>;
export type EffectiveRunConfigReference = z.infer<typeof effectiveRunConfigReferenceSchema>;
export type EffectiveRunConfigReceiptCandidate = z.infer<
  typeof effectiveRunConfigReceiptCandidateSchema
>;
export type BootstrapJobConfigCandidate = z.infer<typeof bootstrapJobConfigCandidateSchema>;
export type RunConfigResolutionReceiptCandidate = z.infer<
  typeof runConfigResolutionReceiptCandidateSchema
>;
export type ContextReceiptBinding = z.infer<typeof contextReceiptBindingSchema>;
