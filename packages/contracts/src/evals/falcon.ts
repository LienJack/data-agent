import { z } from "zod";
import { contentHashSchema, timestampSchema, versionIdentifierSchema } from "../common/index.js";
import { publicBenchmarkCaseSchema } from "./test-center.js";

export const FALCON_SOURCE_COMMIT = "8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5" as const;
export const FALCON_SUITE_VERSION = "1.0.0" as const;
export const FALCON_DATASET_VERSION = "falcon-fixed-8ff29caa-postgres-v1" as const;
export const FALCON_DATABASE_COUNT = 28 as const;
export const FALCON_DEV_CASE_COUNT = 309 as const;
export const FALCON_TEST_CASE_COUNT = 191 as const;
export const FALCON_CASE_COUNT = 500 as const;

export const falconSchemaNameSchema = z.string().regex(/^falcon_db_(?:0[1-9]|1[0-9]|2[0-8])$/u);

export const falconRegistrySchema = z.enum([
  "DEMO",
  "TUNING",
  "LOCAL_HOLDOUT",
  "OFFICIAL_TEST_BLIND",
]);

export const falconCellSchema = z.union([z.null(), z.string(), z.number(), z.boolean()]);

export const falconExpectedResultSchema = z.strictObject({
  columns: z.array(z.string().min(1).max(256)).max(256),
  rows: z.array(z.array(falconCellSchema).max(256)).max(100_000),
  ordered: z.boolean(),
});

/** Server-only Falcon DEV truth. Never expose this shape through public routes or prompts. */
export const sealedFalconCaseSchema = z.strictObject({
  public_case: publicBenchmarkCaseSchema,
  expected_results: z.array(falconExpectedResultSchema).min(1).max(16),
  source_gold_sql: z.array(z.string().min(1).max(100_000)).min(1).max(16),
  sealed_case_hash: contentHashSchema,
});

export const falconBundleFileSchema = z.strictObject({
  db_id: z.number().int().min(1).max(FALCON_DATABASE_COUNT),
  schema_name: falconSchemaNameSchema,
  relative_path: z.string().regex(/^bundles\/falcon_db_(?:0[1-9]|1[0-9]|2[0-8])\.sql\.gz$/u),
  source_sqlite_sha256: contentHashSchema,
  bundle_sha256: contentHashSchema,
  bundle_bytes: z.number().int().positive(),
  table_count: z.number().int().positive(),
  column_count: z.number().int().positive(),
  row_count: z.number().int().nonnegative(),
  null_count: z.number().int().nonnegative(),
  content_digest: contentHashSchema,
});

export const falconSourceManifestSchema = z.strictObject({
  manifest_version: z.literal("falcon-source-manifest@1.0.0"),
  suite_version: z.literal(FALCON_SUITE_VERSION),
  dataset_version: z.literal(FALCON_DATASET_VERSION),
  repository_url: z.literal("https://github.com/eosphoros-ai/Falcon"),
  source_commit: z.literal(FALCON_SOURCE_COMMIT),
  license_spdx_id: z.literal("Apache-2.0"),
  dev_case_count: z.literal(FALCON_DEV_CASE_COUNT),
  test_case_count: z.literal(FALCON_TEST_CASE_COUNT),
  case_count: z.literal(FALCON_CASE_COUNT),
  database_count: z.literal(FALCON_DATABASE_COUNT),
  demo_case_count: z.literal(10),
  tuning_case_count: z.literal(294),
  local_holdout_case_count: z.literal(5),
  official_test_case_count: z.literal(FALCON_TEST_CASE_COUNT),
  main_demo_db_id: z.literal(24),
  smoke_db_id: z.literal(14),
  files: z.array(falconBundleFileSchema).length(FALCON_DATABASE_COUNT),
  public_cases_sha256: contentHashSchema,
  sealed_cases_sha256: contentHashSchema,
  test_cases_sha256: contentHashSchema,
  compatibility_fixtures_sha256: contentHashSchema,
  source_digest: contentHashSchema,
});

export const falconDatabaseImportReceiptSchema = z.strictObject({
  receipt_version: z.literal("falcon-database-import@1.0.0"),
  db_id: z.number().int().min(1).max(FALCON_DATABASE_COUNT),
  schema_name: falconSchemaNameSchema,
  source_sqlite_sha256: contentHashSchema,
  bundle_sha256: contentHashSchema,
  table_count: z.number().int().positive(),
  column_count: z.number().int().positive(),
  row_count: z.number().int().nonnegative(),
  null_count: z.number().int().nonnegative(),
  content_digest: contentHashSchema,
  postgres_size_bytes: z.number().int().nonnegative(),
  status: z.literal("READY"),
});

export const falconImportReceiptSchema = z.strictObject({
  receipt_version: z.literal("falcon-import@1.0.0"),
  suite_version: z.literal(FALCON_SUITE_VERSION),
  dataset_version: z.literal(FALCON_DATASET_VERSION),
  source_commit: z.literal(FALCON_SOURCE_COMMIT),
  source_digest: contentHashSchema,
  target_database: z.literal("data_agent"),
  reader_role: z.literal("falcon_demo_reader"),
  database_count: z.literal(FALCON_DATABASE_COUNT),
  case_count: z.literal(FALCON_CASE_COUNT),
  dev_case_count: z.literal(FALCON_DEV_CASE_COUNT),
  test_case_count: z.literal(FALCON_TEST_CASE_COUNT),
  databases: z.array(falconDatabaseImportReceiptSchema).length(FALCON_DATABASE_COUNT),
  database_size_before_bytes: z.number().int().nonnegative(),
  database_size_after_bytes: z.number().int().nonnegative(),
  imported_at: timestampSchema,
  imported_by: z.string().min(1).max(128),
  status: z.literal("READY"),
  receipt_hash: contentHashSchema,
});

export const falconSubmissionEntrySchema = z.strictObject({
  question_id: z.string().min(1).max(256),
  db_id: z.number().int().min(1).max(FALCON_DATABASE_COUNT),
  sql: z.string().min(1).max(100_000),
  trace_id: z.uuid(),
});

export const falconSubmissionReceiptSchema = z.strictObject({
  receipt_version: z.literal("falcon-submission@1.0.0"),
  suite_version: versionIdentifierSchema,
  dataset_version: z.literal(FALCON_DATASET_VERSION),
  source_commit: z.literal(FALCON_SOURCE_COMMIT),
  scope: z.literal("OFFICIAL_TEST_BLIND"),
  case_count: z.literal(FALCON_TEST_CASE_COUNT),
  entries_sha256: contentHashSchema,
  artifact_sha256: contentHashSchema,
  generated_at: timestampSchema,
});

export type FalconSchemaName = z.infer<typeof falconSchemaNameSchema>;
export type FalconRegistry = z.infer<typeof falconRegistrySchema>;
export type FalconExpectedResult = z.infer<typeof falconExpectedResultSchema>;
export type SealedFalconCase = z.infer<typeof sealedFalconCaseSchema>;
export type FalconBundleFile = z.infer<typeof falconBundleFileSchema>;
export type FalconSourceManifest = z.infer<typeof falconSourceManifestSchema>;
export type FalconDatabaseImportReceipt = z.infer<typeof falconDatabaseImportReceiptSchema>;
export type FalconImportReceipt = z.infer<typeof falconImportReceiptSchema>;
export type FalconSubmissionEntry = z.infer<typeof falconSubmissionEntrySchema>;
export type FalconSubmissionReceipt = z.infer<typeof falconSubmissionReceiptSchema>;
