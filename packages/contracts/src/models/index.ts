import { z } from "zod";
import { environmentSchema, immutableIdSchema, timestampSchema } from "../common/primitives.js";
import { modelCapabilitiesSchema, modelProviderSchema } from "../providers/index.js";

export const globalModelCredentialRefSchema = z.strictObject({
  schema_version: z.literal("global-model-credential-ref@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  credential_ref_id: immutableIdSchema,
  secret_ref_id: immutableIdSchema,
  secret_version: z.number().int().positive(),
  rotation_state: z.enum(["ACTIVE", "ROTATION_PENDING", "REVOCATION_PENDING", "REVOKED"]),
});

export const modelVendorIdSchema = z.enum([
  "deepseek",
  "kimi",
  "glm",
  "openai",
  "anthropic",
  "grok",
  "gemini",
  "volcengine",
  "siliconflow",
  "openai-compatible",
]);

export const modelProviderConnectionSourceSchema = z.enum(["environment", "manual"]);
export const modelProviderConnectionStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const modelProviderConnectionHealthSchema = z.enum([
  "configured",
  "untested",
  "connected",
  "failed",
]);

export const modelProviderConnectionSchema = z.strictObject({
  schema_version: z.literal("model-provider-connection@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  provider_connection_id: immutableIdSchema,
  vendor_id: modelVendorIdSchema,
  runtime_provider: modelProviderSchema,
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  credential_ref: globalModelCredentialRefSchema.nullable(),
  source: modelProviderConnectionSourceSchema,
  status: modelProviderConnectionStatusSchema,
  health: modelProviderConnectionHealthSchema,
  config_version: z.number().int().positive(),
  created_by: immutableIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const upsertModelProviderConnectionInputSchema = z.strictObject({
  schema_version: z.literal("model-provider-upsert@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  provider_connection_id: immutableIdSchema,
  vendor_id: modelVendorIdSchema,
  runtime_provider: modelProviderSchema,
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  credential_ref: globalModelCredentialRefSchema.nullable(),
  expected_config_version: z.number().int().nonnegative(),
});

export const archiveModelProviderConnectionInputSchema = z.strictObject({
  schema_version: z.literal("model-provider-archive@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  provider_connection_id: immutableIdSchema,
  expected_config_version: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export const modelProviderSelectionItemSchema = z.strictObject({
  model_profile_id: immutableIdSchema,
  model_id: z.string().min(1).max(256),
  display_name: z.string().min(1).max(255),
  capabilities: modelCapabilitiesSchema,
  enabled: z.boolean(),
  expected_config_version: z.number().int().nonnegative(),
});

export const modelProviderSelectionInputSchema = z.strictObject({
  schema_version: z.literal("model-provider-selection@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  provider_connection_id: immutableIdSchema,
  expected_connection_version: z.number().int().positive(),
  models: z.array(modelProviderSelectionItemSchema).min(1).max(1000),
});

export const environmentModelCatalogEntrySchema = z.strictObject({
  model_profile_id: immutableIdSchema,
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  display_name: z.string().min(1).max(255),
  base_url: z
    .url()
    .max(2048)
    .refine((value) => value.startsWith("https://"), "环境模型 Base URL 必须使用 HTTPS"),
  capabilities: modelCapabilitiesSchema,
  is_system_default: z.boolean(),
});

export const syncEnvironmentModelCatalogInputSchema = z
  .strictObject({
    schema_version: z.literal("environment-model-catalog-sync@1.0.0"),
    models: z.array(environmentModelCatalogEntrySchema).max(7),
  })
  .superRefine((value, ctx) => {
    const profileIds = new Set<string>();
    let defaultCount = 0;
    for (const [index, model] of value.models.entries()) {
      if (profileIds.has(model.model_profile_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["models", index, "model_profile_id"],
          message: "环境模型 Profile ID 不能重复",
        });
      }
      profileIds.add(model.model_profile_id);
      if (model.is_system_default) defaultCount += 1;
    }
    if (defaultCount > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["models"],
        message: "环境模型最多只能有一个系统默认模型",
      });
    }
  });

export const modelCatalogEntrySchema = z.strictObject({
  schema_version: z.literal("model-catalog-entry@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  model_profile_id: immutableIdSchema,
  provider_connection_id: immutableIdSchema.optional(),
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  capabilities: modelCapabilitiesSchema,
  credential_ref: globalModelCredentialRefSchema.nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED"]),
  config_version: z.number().int().positive(),
  is_system_default: z.boolean(),
  created_by: immutableIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const modelCertificationStateSchema = z.enum(["NOT_CERTIFIED", "PASS"]);

export const startModelCertificationInputSchema = z.strictObject({
  schema_version: z.literal("model-certification-start@1.0.0"),
  model_profile_id: immutableIdSchema,
  expected_config_version: z.number().int().positive().safe(),
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
});

export const recordModelApiAuthenticationInputSchema = z.strictObject({
  schema_version: z.literal("model-api-authentication@1.0.0"),
  model_profile_id: immutableIdSchema,
  expected_config_version: z.number().int().positive().safe(),
  response_item_count: z.number().int().positive().max(1_000),
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
});

export const modelCertificationPublicViewSchema = z.strictObject({
  schema_version: z.literal("model-certification-view@1.0.0"),
  model_profile_id: immutableIdSchema,
  model_config_version: z.number().int().positive().safe(),
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  state: modelCertificationStateSchema,
  completed_at: timestampSchema.nullable(),
});

export const upsertModelCatalogEntryInputSchema = z.strictObject({
  schema_version: z.literal("model-catalog-upsert@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  model_profile_id: immutableIdSchema,
  provider_connection_id: immutableIdSchema.optional(),
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  capabilities: modelCapabilitiesSchema,
  credential_ref: globalModelCredentialRefSchema.nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED"]),
  is_system_default: z.boolean().default(false),
  expected_config_version: z.number().int().nonnegative(),
});

export const modelCatalogStatusInputSchema = z.strictObject({
  schema_version: z.literal("model-catalog-status@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  model_profile_id: immutableIdSchema,
  status: z.enum(["ACTIVE", "DISABLED"]),
  expected_config_version: z.number().int().positive(),
});

export type GlobalModelCredentialRef = z.infer<typeof globalModelCredentialRefSchema>;
export type ModelVendorId = z.infer<typeof modelVendorIdSchema>;
export type ModelProviderConnection = z.infer<typeof modelProviderConnectionSchema>;
export type UpsertModelProviderConnectionInput = z.infer<
  typeof upsertModelProviderConnectionInputSchema
>;
export type ArchiveModelProviderConnectionInput = z.infer<
  typeof archiveModelProviderConnectionInputSchema
>;
export type ModelProviderSelectionInput = z.infer<typeof modelProviderSelectionInputSchema>;
export type EnvironmentModelCatalogEntry = z.infer<typeof environmentModelCatalogEntrySchema>;
export type SyncEnvironmentModelCatalogInput = z.infer<
  typeof syncEnvironmentModelCatalogInputSchema
>;
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;
export type ModelCertificationPublicView = z.infer<typeof modelCertificationPublicViewSchema>;
export type RecordModelApiAuthenticationInput = z.infer<
  typeof recordModelApiAuthenticationInputSchema
>;
export type StartModelCertificationInput = z.infer<typeof startModelCertificationInputSchema>;
export type UpsertModelCatalogEntryInput = z.infer<typeof upsertModelCatalogEntryInputSchema>;
export type ModelCatalogStatusInput = z.infer<typeof modelCatalogStatusInputSchema>;
