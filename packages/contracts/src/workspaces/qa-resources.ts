import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  modelCertificationReceiptReferenceSchema,
  modelProviderSchema,
  providerInvocationConnectionProofSchema,
  providerInvocationRecoveryCapabilitiesSchema,
  providerInvocationScopeSchema,
} from "../providers/index.js";
import { runConfigRequestSchema } from "../runs/effective-config.js";
import { modelCertificationStateSchema } from "./billing.js";
import { workspaceConversationSchema, workspaceDatasourceTypeSchema } from "./data-isolation.js";

export const qaModelReadinessSchema = z.enum([
  "AVAILABLE",
  "CERTIFICATION_REQUIRED",
  "CREDENTIAL_UNAVAILABLE",
  "CONTEXT_WINDOW_UNVERIFIED",
  "DISABLED",
  "STALE",
]);

export const qaModelResourceSchema = z
  .strictObject({
    model_profile_id: immutableIdSchema,
    config_version: z.number().int().positive().safe(),
    profile_version: versionIdentifierSchema,
    provider: modelProviderSchema,
    model_id: z.string().trim().min(1).max(256),
    display_name: z.string().trim().min(1).max(255),
    certification_receipt_ref: modelCertificationReceiptReferenceSchema.nullable(),
    api_authentication_state: modelCertificationStateSchema.optional(),
    effective_context_ceiling_tokens: z.number().int().positive().safe().nullable(),
    effective_output_ceiling_tokens: z.number().int().positive().safe().nullable(),
    readiness: qaModelReadinessSchema,
    selectable: z.boolean(),
  })
  .superRefine((model, ctx) => {
    if (model.profile_version !== `model-profile@${model.config_version}`) {
      ctx.addIssue({
        code: "custom",
        message: "QA Model Profile Version 必须精确绑定 Catalog config_version。",
        path: ["profile_version"],
      });
    }
    const hasAnyExecutionAuthority =
      model.certification_receipt_ref !== null ||
      model.effective_context_ceiling_tokens !== null ||
      model.effective_output_ceiling_tokens !== null;
    if (
      model.readiness === "AVAILABLE"
        ? !model.selectable
        : model.selectable || hasAnyExecutionAuthority || model.api_authentication_state === "PASS"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "QA Model 只有 AVAILABLE 分支可选；认证字段仅用于历史投影。",
        path: ["readiness"],
      });
    }
  });

const providerExecutionProfileCommonShape = {
  model_profile_id: immutableIdSchema,
  model_config_version: z.number().int().positive().safe(),
  resource_hash: contentHashSchema,
  profile_version: versionIdentifierSchema,
  provider: modelProviderSchema,
  model_id: z.string().trim().min(1).max(256),
  display_name: z.string().trim().min(1).max(255),
} as const;

const availableProviderExecutionProfileSchema = z.strictObject({
  ...providerExecutionProfileCommonShape,
  adapter_version: versionIdentifierSchema,
  certification_receipt_ref: modelCertificationReceiptReferenceSchema,
  execution_profile_hash: contentHashSchema,
  recovery_capabilities: providerInvocationRecoveryCapabilitiesSchema,
  connection: providerInvocationConnectionProofSchema,
  effective_context_ceiling_tokens: z.number().int().positive().safe(),
  effective_output_ceiling_tokens: z.number().int().positive().safe(),
  readiness: z.literal("AVAILABLE"),
  selectable: z.literal(true),
  unavailable_reason: z.null(),
});

function unavailableProviderExecutionProfileSchema<
  TStatus extends Exclude<z.infer<typeof qaModelReadinessSchema>, "AVAILABLE">,
  TReason extends string,
>(status: TStatus, reason: TReason) {
  return z.strictObject({
    ...providerExecutionProfileCommonShape,
    readiness: z.literal(status),
    selectable: z.literal(false),
    unavailable_reason: z.literal(reason),
  });
}

export const providerExecutionProfileSchema = z
  .discriminatedUnion("readiness", [
    availableProviderExecutionProfileSchema,
    unavailableProviderExecutionProfileSchema(
      "CERTIFICATION_REQUIRED",
      "MODEL_CERTIFICATION_REQUIRED",
    ),
    unavailableProviderExecutionProfileSchema(
      "CREDENTIAL_UNAVAILABLE",
      "MODEL_CREDENTIAL_UNAVAILABLE",
    ),
    unavailableProviderExecutionProfileSchema(
      "CONTEXT_WINDOW_UNVERIFIED",
      "MODEL_CONTEXT_WINDOW_UNVERIFIED",
    ),
    unavailableProviderExecutionProfileSchema("DISABLED", "MODEL_PROFILE_DISABLED"),
    unavailableProviderExecutionProfileSchema("STALE", "MODEL_PROFILE_STALE"),
  ])
  .superRefine((profile, ctx) => {
    if (profile.profile_version !== `model-profile@${profile.model_config_version}`) {
      ctx.addIssue({
        code: "custom",
        message: "Execution Profile Version 必须精确绑定 Catalog config_version。",
        path: ["profile_version"],
      });
    }
  });

export const providerExecutionProfileListResultSchema = z.strictObject({
  schema_version: z.literal("provider-execution-profile-list@1.0.0"),
  scope: providerInvocationScopeSchema,
  profiles: z.array(providerExecutionProfileSchema).max(256),
});

export const qaDatasourceResourceSchema = z.strictObject({
  datasource_id: immutableIdSchema,
  display_name: z.string().trim().min(1).max(255),
  type: workspaceDatasourceTypeSchema,
  status: z.enum(["ACTIVE", "DISABLED"]),
  selectable: z.boolean(),
});

export const qaResourceCatalogSchema = z.strictObject({
  schema_version: z.literal("qa-resource-catalog@1.0.0"),
  models: z.array(qaModelResourceSchema),
  datasources: z.array(qaDatasourceResourceSchema),
});

export const qaConversationResourceSwitchInputSchema = z.strictObject({
  schema_version: z.literal("qa-conversation-resource-switch@1.0.0"),
  model_profile_id: immutableIdSchema,
  datasource_id: immutableIdSchema,
  expected_resource_version: z.number().int().positive().safe(),
  idempotency_key: z.string().trim().min(8).max(128),
});

const conversationResourceProjectionSchema = workspaceConversationSchema.extend({
  model_profile_id: immutableIdSchema,
  resource_version: z.number().int().positive().safe(),
});

export const qaConversationResourceSwitchResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("UPDATED_CURRENT"),
    conversation: conversationResourceProjectionSchema,
  }),
  z.strictObject({
    kind: z.literal("CREATED_REPLACEMENT"),
    conversation: conversationResourceProjectionSchema,
    replaced_id: immutableIdSchema,
  }),
]);

export const qaRunBindingSchema = z.strictObject({
  schema_version: z.literal("qa-run-binding@1.0.0"),
  workspace_id: immutableIdSchema,
  run_id: immutableIdSchema,
  conversation_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  datasource_id: immutableIdSchema,
  datasource_binding_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  model_profile_id: immutableIdSchema,
  model_config_version: z.number().int().positive().safe(),
  provider: modelProviderSchema,
  model_id: z.string().trim().min(1).max(256),
  created_at: timestampSchema,
});

export const qaRunStartInputSchema = z.strictObject({
  schema_version: z.literal("qa-run-start@1.0.0"),
  question: z.string().trim().min(1).max(4_000),
  idempotency_key: z.string().trim().min(8).max(256),
});

export const qaRunStartInputV2Schema = z
  .strictObject({
    schema_version: z.literal("qa-run-start@2.0.0"),
    question: z.string().trim().min(1).max(4_000),
    idempotency_key: z.string().trim().min(8).max(256),
    config_request: runConfigRequestSchema,
  })
  .superRefine((request, ctx) => {
    if (request.config_request.operation !== "QUESTION_RUN") {
      ctx.addIssue({
        code: "custom",
        message: "QA Run Start V2 只接受 QUESTION_RUN config request。",
        path: ["config_request", "operation"],
      });
    }
    if (request.idempotency_key !== request.config_request.idempotency_key) {
      ctx.addIssue({
        code: "custom",
        message: "QA Run 与 Config Request 必须使用相同幂等键。",
        path: ["config_request", "idempotency_key"],
      });
    }
  });

export type QaModelReadiness = z.infer<typeof qaModelReadinessSchema>;
export type QaModelResource = z.infer<typeof qaModelResourceSchema>;
export type ProviderExecutionProfile = z.infer<typeof providerExecutionProfileSchema>;
export type QaDatasourceResource = z.infer<typeof qaDatasourceResourceSchema>;
export type QaResourceCatalog = z.infer<typeof qaResourceCatalogSchema>;
export type QaConversationResourceSwitchInput = z.infer<
  typeof qaConversationResourceSwitchInputSchema
>;
export type QaConversationResourceSwitchResult = z.infer<
  typeof qaConversationResourceSwitchResultSchema
>;
export type QaRunBinding = z.infer<typeof qaRunBindingSchema>;
export type QaRunStartInput = z.infer<typeof qaRunStartInputSchema>;
export type QaRunStartInputV2 = z.infer<typeof qaRunStartInputV2Schema>;
