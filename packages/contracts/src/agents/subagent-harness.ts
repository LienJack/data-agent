import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import { knownArtifactTypeSchema } from "../artifacts/types.js";
import {
  type AppScope,
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type AgentProductProfileRegistryItemV2,
  agentProductProfileReferenceV2Schema,
  agentProductProfileRegistryItemV2Schema,
  verifyAgentProductProfileRevisionV2,
} from "./profile-registry.js";
import {
  agentProfileIdSchema,
  subagentDiscoveryDescriptorSchema,
  subagentPublicDiscoveryTextSchema,
} from "./subagent-discovery.js";

export const DELEGATE_TO_SUBAGENT_TOOL_NAME = "delegate_to_subagent@1" as const;
export const MAX_SUBAGENT_CATALOG_ITEMS = 64;

function isSameScope(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function isCanonicallySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
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
      ctx.addIssue({ code: "custom", message, path: [...path, index] });
    }
    seen.add(value);
  });
}

export const subagentCapabilityCatalogItemSchema = z.strictObject({
  profile_ref: agentProductProfileReferenceV2Schema,
  discovery: subagentDiscoveryDescriptorSchema,
});

export async function projectSubagentCapabilityCatalogItem(
  input: AgentProductProfileRegistryItemV2,
) {
  const registryItem = agentProductProfileRegistryItemV2Schema.parse(input);
  const revision = await verifyAgentProductProfileRevisionV2(registryItem.revision);
  if (revision.approval_status !== "APPROVED" || registryItem.head.lifecycle !== "ENABLED") {
    throw new TypeError("SUBAGENT_PROFILE_NOT_ELIGIBLE_FOR_DISCOVERY");
  }
  return deepFreeze(
    subagentCapabilityCatalogItemSchema.parse({
      profile_ref: {
        profile_id: revision.profile_id,
        revision: revision.revision,
        revision_hash: revision.revision_hash,
      },
      discovery: revision.discovery,
    }),
  );
}

const subagentCapabilityCatalogSnapshotDraftSchema = z
  .strictObject({
    schema_version: z.literal("subagent-capability-catalog-snapshot@1.0.0"),
    catalog_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    policy_version: versionIdentifierSchema,
    items: z.array(subagentCapabilityCatalogItemSchema).max(MAX_SUBAGENT_CATALOG_ITEMS),
  })
  .superRefine((snapshot, ctx) => {
    if (!isCanonicallySorted(snapshot.items.map(({ profile_ref }) => profile_ref.profile_id))) {
      ctx.addIssue({
        code: "custom",
        message: "Subagent capability catalog items must be unique and canonically sorted.",
        path: ["items"],
      });
    }
  });

export const subagentCapabilityCatalogSnapshotSchema =
  subagentCapabilityCatalogSnapshotDraftSchema.extend({ snapshot_hash: contentHashSchema });

export async function buildSubagentCapabilityCatalogSnapshot(input: unknown) {
  const draft = subagentCapabilityCatalogSnapshotDraftSchema.parse(input);
  return deepFreeze(
    subagentCapabilityCatalogSnapshotSchema.parse({
      ...draft,
      snapshot_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySubagentCapabilityCatalogSnapshot(input: unknown) {
  const snapshot = subagentCapabilityCatalogSnapshotSchema.parse(input);
  const { snapshot_hash: actual, ...draft } = snapshot;
  if (
    (await sha256ContentHash(subagentCapabilityCatalogSnapshotDraftSchema.parse(draft))) !== actual
  ) {
    throw new TypeError("SUBAGENT_CAPABILITY_CATALOG_SNAPSHOT_HASH_MISMATCH");
  }
  return deepFreeze(snapshot);
}

export const subagentRequestedBudgetSchema = z.strictObject({
  timeout_ms: z.number().int().positive().max(600_000),
  max_steps: z.number().int().positive().max(128),
  max_input_tokens: z.number().int().positive().max(2_000_000),
  max_output_tokens: z.number().int().positive().max(1_000_000),
  max_tool_calls: z.number().int().nonnegative().max(1_000),
  max_context_bytes: z.number().int().positive().max(65_536),
});

export const delegateToSubagentArgumentsSchema = z
  .strictObject({
    profile_id: agentProfileIdSchema,
    objective: z.string().trim().min(1).max(4_000),
    requested_artifact_types: z.array(knownArtifactTypeSchema).min(1).max(16),
    input_artifact_refs: z.array(artifactReferenceSchema).max(64),
    requested_budget: subagentRequestedBudgetSchema,
  })
  .superRefine((call, ctx) => {
    if (!isCanonicallySorted(call.requested_artifact_types)) {
      ctx.addIssue({
        code: "custom",
        message: "Requested Artifact types must be unique and canonically sorted.",
        path: ["requested_artifact_types"],
      });
    }
    addDuplicateIssues(
      call.input_artifact_refs.map(artifactReferenceIdentity),
      ctx,
      ["input_artifact_refs"],
      "Input Artifact references cannot be duplicated.",
    );
  });

export const delegateToSubagentCallSchema = delegateToSubagentArgumentsSchema.safeExtend({
  tool_name: z.literal(DELEGATE_TO_SUBAGENT_TOOL_NAME),
  tool_call_id: z.string().min(1).max(256),
});

const sourceMessageRefsSchema = z
  .array(immutableIdSchema)
  .max(64)
  .superRefine((refs, ctx) => {
    if (!isCanonicallySorted(refs)) {
      ctx.addIssue({
        code: "custom",
        message: "Source message references must be unique and canonically sorted.",
      });
    }
  });

export const rootAgentGeneralTextSectionSchema = z
  .strictObject({
    kind: z.literal("GENERAL_TEXT"),
    text: z.string().trim().min(1).max(16_000),
    basis: z.enum(["GENERAL_KNOWLEDGE", "PROVIDED_CONTEXT"]),
    source_message_refs: sourceMessageRefsSchema,
  })
  .superRefine((section, ctx) => {
    if (section.basis === "GENERAL_KNOWLEDGE" && section.source_message_refs.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "General-knowledge sections cannot claim provided-context message sources.",
        path: ["source_message_refs"],
      });
    }
    if (section.basis === "PROVIDED_CONTEXT" && section.source_message_refs.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provided-context sections must cite at least one visible message.",
        path: ["source_message_refs"],
      });
    }
  });

const factSelectorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_.-]*$/,
    "Artifact fact selectors must be stable dotted field selectors.",
  );

export const rootAgentArtifactFactsSectionSchema = z
  .strictObject({
    kind: z.literal("ARTIFACT_FACTS"),
    artifact_ref: artifactReferenceSchema,
    fact_selectors: z.array(factSelectorSchema).min(1).max(64),
  })
  .superRefine((section, ctx) => {
    if (!isCanonicallySorted(section.fact_selectors)) {
      ctx.addIssue({
        code: "custom",
        message: "Artifact fact selectors must be unique and canonically sorted.",
        path: ["fact_selectors"],
      });
    }
  });

const rootAgentFinalAnswerCandidateSchema = z.strictObject({
  schema_version: z.literal("root-agent-turn-candidate@1.0.0"),
  kind: z.literal("FINAL_ANSWER"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  catalog_snapshot_hash: contentHashSchema,
  sections: z
    .array(
      z.discriminatedUnion("kind", [
        rootAgentGeneralTextSectionSchema,
        rootAgentArtifactFactsSectionSchema,
      ]),
    )
    .min(1)
    .max(64),
  public_summary: subagentPublicDiscoveryTextSchema.max(240),
});

const rootAgentToolCallsCandidateSchema = z.strictObject({
  schema_version: z.literal("root-agent-turn-candidate@1.0.0"),
  kind: z.literal("TOOL_CALLS"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  catalog_snapshot_hash: contentHashSchema,
  tool_calls: z.array(delegateToSubagentCallSchema).min(1).max(8),
  public_summary: subagentPublicDiscoveryTextSchema.max(240),
});

export const rootAgentDecisionCandidateSchema = z
  .discriminatedUnion("kind", [
    rootAgentFinalAnswerCandidateSchema,
    rootAgentToolCallsCandidateSchema,
  ])
  .superRefine((candidate, ctx) => {
    if (candidate.kind === "FINAL_ANSWER") {
      candidate.sections.forEach((section, index) => {
        if (
          section.kind === "ARTIFACT_FACTS" &&
          (!isSameScope(candidate.scope, section.artifact_ref) ||
            candidate.run_id !== section.artifact_ref.run_id)
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Answer Artifact facts must belong to the current scope and Run.",
            path: ["sections", index, "artifact_ref"],
          });
        }
      });
      return;
    }

    addDuplicateIssues(
      candidate.tool_calls.map(({ tool_call_id }) => tool_call_id),
      ctx,
      ["tool_calls"],
      "Tool call IDs cannot be duplicated.",
    );
    candidate.tool_calls.forEach((call, callIndex) => {
      call.input_artifact_refs.forEach((reference, referenceIndex) => {
        if (!isSameScope(candidate.scope, reference) || candidate.run_id !== reference.run_id) {
          ctx.addIssue({
            code: "custom",
            message: "Delegation inputs must belong to the current scope and Run.",
            path: ["tool_calls", callIndex, "input_artifact_refs", referenceIndex],
          });
        }
      });
    });
  });

export type RootAgentDecisionCandidate = z.infer<typeof rootAgentDecisionCandidateSchema>;
export type DelegateToSubagentCall = z.infer<typeof delegateToSubagentCallSchema>;
export type SubagentCapabilityCatalogSnapshot = z.infer<
  typeof subagentCapabilityCatalogSnapshotSchema
>;

const subagentDelegationReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("subagent-delegation-receipt@1.0.0"),
    delegation_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    catalog_snapshot_hash: contentHashSchema,
    tool_call_id: z.string().min(1).max(256),
    profile_ref: agentProductProfileReferenceV2Schema,
    task_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    objective_hash: contentHashSchema,
    input_artifact_refs: z.array(artifactReferenceSchema).max(64),
    requested_artifact_types: z.array(knownArtifactTypeSchema).min(1).max(16),
    effective_budget: subagentRequestedBudgetSchema,
    tool_allowlist: z.array(versionIdentifierSchema).min(1).max(64),
    idempotency_key: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/),
  })
  .superRefine((receipt, ctx) => {
    if (!isCanonicallySorted(receipt.requested_artifact_types)) {
      ctx.addIssue({
        code: "custom",
        message: "Delegation output types must be unique and canonically sorted.",
        path: ["requested_artifact_types"],
      });
    }
    if (!isCanonicallySorted(receipt.tool_allowlist)) {
      ctx.addIssue({
        code: "custom",
        message: "Delegation tools must be unique and canonically sorted.",
        path: ["tool_allowlist"],
      });
    }
    const artifactIdentities = receipt.input_artifact_refs.map(artifactReferenceIdentity);
    if (!isCanonicallySorted(artifactIdentities)) {
      ctx.addIssue({
        code: "custom",
        message: "Delegation input Artifacts must be unique and canonically sorted.",
        path: ["input_artifact_refs"],
      });
    }
    receipt.input_artifact_refs.forEach((reference, index) => {
      if (!isSameScope(receipt.scope, reference) || receipt.run_id !== reference.run_id) {
        ctx.addIssue({
          code: "custom",
          message: "Delegation input Artifact escaped the admitted Run.",
          path: ["input_artifact_refs", index],
        });
      }
    });
  });

export const subagentDelegationReceiptSchema = subagentDelegationReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export type SubagentDelegationReceipt = z.infer<typeof subagentDelegationReceiptSchema>;

export async function buildSubagentDelegationReceipt(input: unknown) {
  const draft = subagentDelegationReceiptDraftSchema.parse(input);
  return deepFreeze(
    subagentDelegationReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySubagentDelegationReceipt(input: unknown) {
  const receipt = subagentDelegationReceiptSchema.parse(input);
  const { receipt_hash: actual, ...draft } = receipt;
  if ((await sha256ContentHash(subagentDelegationReceiptDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("SUBAGENT_DELEGATION_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

function artifactTypesAreSubset(allowed: readonly string[], requested: readonly string[]): boolean {
  const allowedTypes = new Set(allowed);
  return requested.every((artifactType) => allowedTypes.has(artifactType));
}

function artifactInputsAreSupported(
  allowed: readonly string[],
  references: readonly ArtifactReference[],
): boolean {
  const allowedTypes = new Set(allowed);
  return references.every((reference) => allowedTypes.has(reference.artifact_type));
}

/**
 * Performs only catalog and Artifact-contract correlation. RBAC, lifecycle,
 * budgets, capabilities and execution admission remain Host responsibilities.
 */
export async function validateRootAgentDecisionAgainstCatalog(input: {
  readonly candidate: unknown;
  readonly catalog: unknown;
}) {
  const catalog = await verifySubagentCapabilityCatalogSnapshot(input.catalog);
  const candidate = rootAgentDecisionCandidateSchema.parse(input.candidate);

  if (
    !isSameScope(candidate.scope, catalog.scope) ||
    candidate.run_id !== catalog.run_id ||
    candidate.catalog_snapshot_hash !== catalog.snapshot_hash
  ) {
    throw new TypeError("ROOT_AGENT_DECISION_CATALOG_CORRELATION_MISMATCH");
  }
  if (candidate.kind === "FINAL_ANSWER") {
    return deepFreeze(candidate);
  }

  const catalogByProfileId = new Map(
    catalog.items.map((item) => [item.profile_ref.profile_id, item] as const),
  );
  for (const call of candidate.tool_calls) {
    const item = catalogByProfileId.get(call.profile_id);
    if (!item) {
      throw new TypeError("ROOT_AGENT_SELECTED_PROFILE_NOT_IN_FROZEN_CATALOG");
    }
    if (
      !artifactTypesAreSubset(item.discovery.produced_artifact_types, call.requested_artifact_types)
    ) {
      throw new TypeError("ROOT_AGENT_REQUESTED_UNSUPPORTED_OUTPUT_ARTIFACT");
    }
    if (
      !artifactInputsAreSupported(
        item.discovery.accepted_input_artifact_types,
        call.input_artifact_refs,
      )
    ) {
      throw new TypeError("ROOT_AGENT_PROVIDED_UNSUPPORTED_INPUT_ARTIFACT");
    }
  }
  return deepFreeze(candidate);
}
