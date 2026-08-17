import { z } from "zod";
import { knownArtifactTypeSchema } from "../artifacts/types.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { versionedResourceReferenceSchema } from "../workspaces/defaults.js";
import { workspaceIdempotencyKeySchema } from "../workspaces/identity.js";

export const agentSpecialistProfileIdSchema = z.enum([
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
]);

const runtimeProfileRefSchema = z.strictObject({
  profile_id: agentSpecialistProfileIdSchema,
  revision: z.number().int().positive().safe(),
  profile_hash: contentHashSchema,
});

export const agentProductProfileReferenceSchema = z.strictObject({
  profile_id: agentSpecialistProfileIdSchema,
  revision: z.number().int().positive().safe(),
  revision_hash: contentHashSchema,
});

const skillRefSchema = z.strictObject({
  skill_id: immutableIdSchema,
  revision: z.number().int().positive().safe(),
  revision_hash: contentHashSchema,
});

function canonicalValues(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
}

const agentProductProfileRevisionDraftSchema = z
  .strictObject({
    schema_version: z.literal("agent-product-profile-revision@1.0.0"),
    scope: appScopeSchema,
    profile_id: agentSpecialistProfileIdSchema,
    revision: z.number().int().positive().safe(),
    runtime_profile_ref: runtimeProfileRefSchema,
    model_profile_ref: versionedResourceReferenceSchema,
    prompt_ref: z.strictObject({
      prompt_id: versionIdentifierSchema,
      revision: z.number().int().positive().safe(),
      prompt_hash: contentHashSchema,
    }),
    workflow_ref: z.strictObject({
      workflow_id: versionIdentifierSchema,
      revision: z.number().int().positive().safe(),
      workflow_hash: contentHashSchema,
    }),
    direct_tool_allowlist: z.array(versionIdentifierSchema).min(1).max(64),
    skill_refs: z.array(skillRefSchema).min(1).max(16),
    context_policy_ref: versionedResourceReferenceSchema,
    execution_safety_policy_ref: versionedResourceReferenceSchema,
    expected_output_artifact_types: z.array(knownArtifactTypeSchema).min(1).max(8),
    verifier_contract_hash: contentHashSchema,
    approval_status: z.enum(["APPROVED", "QUARANTINED"]),
  })
  .superRefine((revision, ctx) => {
    if (revision.runtime_profile_ref.profile_id !== revision.profile_id) {
      ctx.addIssue({
        code: "custom",
        message: "Product Profile and runtime Profile identity must match.",
        path: ["runtime_profile_ref", "profile_id"],
      });
    }
    for (const [field, values] of [
      ["direct_tool_allowlist", revision.direct_tool_allowlist],
      ["skill_refs", revision.skill_refs.map(({ skill_id }) => skill_id)],
      ["expected_output_artifact_types", revision.expected_output_artifact_types],
    ] as const) {
      if (!canonicalValues(values)) {
        ctx.addIssue({
          code: "custom",
          message: `${field} must be unique and canonically sorted.`,
          path: [field],
        });
      }
    }
  });

export const agentProductProfileRevisionSchema = agentProductProfileRevisionDraftSchema.extend({
  revision_hash: contentHashSchema,
});

export async function buildAgentProductProfileRevision(input: unknown) {
  const draft = agentProductProfileRevisionDraftSchema.parse(input);
  return deepFreeze(
    agentProductProfileRevisionSchema.parse({
      ...draft,
      revision_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyAgentProductProfileRevision(input: unknown) {
  const revision = agentProductProfileRevisionSchema.parse(input);
  const { revision_hash: actual, ...draft } = revision;
  if ((await sha256ContentHash(agentProductProfileRevisionDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("AGENT_PRODUCT_PROFILE_REVISION_HASH_MISMATCH");
  }
  return deepFreeze(revision);
}

export const agentProductProfileHeadSchema = z.strictObject({
  schema_version: z.literal("agent-product-profile-head@1.0.0"),
  scope: appScopeSchema,
  profile_id: agentSpecialistProfileIdSchema,
  active_revision: z.number().int().positive().safe(),
  active_revision_hash: contentHashSchema,
  lifecycle: z.enum(["ENABLED", "DISABLED", "QUARANTINED", "REVOKED"]),
  version: z.number().int().positive().safe(),
  updated_at: timestampSchema,
});

export const agentProductProfileRegistryItemSchema = z
  .strictObject({
    schema_version: z.literal("agent-product-profile-registry-item@1.0.0"),
    revision: agentProductProfileRevisionSchema,
    head: agentProductProfileHeadSchema,
  })
  .superRefine((item, ctx) => {
    if (
      item.revision.profile_id !== item.head.profile_id ||
      item.revision.scope.app_id !== item.head.scope.app_id ||
      item.revision.scope.tenant_id !== item.head.scope.tenant_id ||
      item.revision.scope.environment !== item.head.scope.environment ||
      item.revision.revision !== item.head.active_revision ||
      item.revision.revision_hash !== item.head.active_revision_hash
    ) {
      ctx.addIssue({ code: "custom", message: "Profile Head must close over the exact Revision." });
    }
  });

const agentProductProfileCommitCommandDraftSchema = z.strictObject({
  schema_version: z.literal("agent-product-profile-commit-command@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  actor_principal_id: immutableIdSchema,
  revision: agentProductProfileRevisionSchema,
  expected_head_version: z.number().int().nonnegative().safe(),
  target_lifecycle: z.enum(["ENABLED", "DISABLED", "QUARANTINED"]),
});

export const agentProductProfileCommitCommandSchema =
  agentProductProfileCommitCommandDraftSchema.extend({ command_hash: contentHashSchema });

export async function buildAgentProductProfileCommitCommand(input: unknown) {
  const draft = agentProductProfileCommitCommandDraftSchema.parse(input);
  return deepFreeze(
    agentProductProfileCommitCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyAgentProductProfileCommitCommand(input: unknown) {
  const command = agentProductProfileCommitCommandSchema.parse(input);
  const { command_hash: actual, ...draft } = command;
  if (
    (await sha256ContentHash(agentProductProfileCommitCommandDraftSchema.parse(draft))) !== actual
  ) {
    throw new TypeError("AGENT_PRODUCT_PROFILE_COMMIT_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

export const agentProductProfileCommitResultSchema = z.strictObject({
  schema_version: z.literal("agent-product-profile-commit-result@1.0.0"),
  disposition: z.enum(["COMMITTED", "REPLAYED"]),
  operation_id: immutableIdSchema,
  command_hash: contentHashSchema,
  item: agentProductProfileRegistryItemSchema,
});

export const agentProductProfileListResultSchema = z
  .strictObject({
    schema_version: z.literal("agent-product-profile-list-result@1.0.0"),
    items: z.array(agentProductProfileRegistryItemSchema).max(3),
  })
  .superRefine((result, ctx) => {
    if (!canonicalValues(result.items.map(({ revision }) => revision.profile_id))) {
      ctx.addIssue({
        code: "custom",
        message: "Agent Product Profile items must be unique and canonically sorted.",
        path: ["items"],
      });
    }
  });

export type AgentSpecialistProfileId = z.infer<typeof agentSpecialistProfileIdSchema>;
export type AgentProductProfileReference = z.infer<typeof agentProductProfileReferenceSchema>;
export type AgentProductProfileRevision = z.infer<typeof agentProductProfileRevisionSchema>;
export type AgentProductProfileHead = z.infer<typeof agentProductProfileHeadSchema>;
export type AgentProductProfileRegistryItem = z.infer<typeof agentProductProfileRegistryItemSchema>;
export type AgentProductProfileCommitCommand = z.infer<
  typeof agentProductProfileCommitCommandSchema
>;
