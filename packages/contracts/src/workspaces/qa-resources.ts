import { z } from "zod";
import { immutableIdSchema, timestampSchema } from "../common/index.js";
import { modelProviderSchema } from "../providers/index.js";
import { runConfigRequestSchema } from "../runs/effective-config.js";
import { workspaceConversationSchema, workspaceDatasourceTypeSchema } from "./data-isolation.js";

export const qaModelReadinessSchema = z.enum([
  "RUNNABLE",
  "CERTIFICATION_REQUIRED",
  "CREDENTIAL_UNAVAILABLE",
  "UNBILLABLE",
]);

export const qaModelResourceSchema = z.strictObject({
  model_profile_id: immutableIdSchema,
  config_version: z.number().int().positive().safe(),
  provider: modelProviderSchema,
  model_id: z.string().trim().min(1).max(256),
  display_name: z.string().trim().min(1).max(255),
  readiness: qaModelReadinessSchema,
  selectable: z.boolean(),
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
