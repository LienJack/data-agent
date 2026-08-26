import { z } from "zod";
import {
  contentHashSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { publicBenchmarkCaseSchema } from "./test-center.js";

export const FALCON_SOURCE_COMMIT = "8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5" as const;
export const FALCON_SUITE_VERSION = "1.0.0" as const;
export const FALCON_DATASET_VERSION = "falcon-fixed-8ff29caa-postgres-v1" as const;
export const FALCON_DATABASE_COUNT = 28 as const;
export const FALCON_DEV_CASE_COUNT = 309 as const;
export const FALCON_TEST_CASE_COUNT = 191 as const;
export const FALCON_CASE_COUNT = 500 as const;
export const FALCON24_E1_DB_ID = 24 as const;
export const FALCON24_E1_SCHEMA_NAME = "falcon_db_24" as const;
export const FALCON24_E1_DATABASE_IMPORT_RECEIPT_VERSION =
  "falcon24-e1-database-import@1.0.0" as const;
export const FALCON24_E1_EXPECTED_CATALOG_INVENTORY_HASH =
  "sha256:85dc4e7f64a0b0944ac653b95d446c253b44995e0e2574b3d393f3fb3d2cde87" as const;

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

const falcon24E1CatalogColumnSchema = z.strictObject({
  ordinal: z.number().int().positive().max(1_000),
  column_name: z.string().min(1).max(256),
  data_type: z.string().min(1).max(128),
  is_nullable: z.boolean(),
});

const falcon24E1CatalogTableSchema = z.strictObject({
  table_name: z.string().min(1).max(256),
  columns: z.array(falcon24E1CatalogColumnSchema).min(1).max(1_000),
  row_count: z.number().int().nonnegative(),
  null_count: z.number().int().nonnegative(),
});

const falcon24E1CatalogInventoryMaterialSchema = z.strictObject({
  schema_name: z.literal(FALCON24_E1_SCHEMA_NAME),
  tables: z.array(falcon24E1CatalogTableSchema).min(1).max(1_000),
  table_count: z.number().int().positive(),
  column_count: z.number().int().positive(),
  row_count: z.number().int().nonnegative(),
  null_count: z.number().int().nonnegative(),
  content_digest: contentHashSchema,
});

export const falcon24E1CatalogInventorySchema = falcon24E1CatalogInventoryMaterialSchema.extend({
  inventory_hash: contentHashSchema,
});

export const falcon24E1ImportFailureCodeSchema = z.enum([
  "BUNDLE_HASH_MISMATCH",
  "COLUMN_COUNT_MISMATCH",
  "CONTENT_DIGEST_MISMATCH",
  "INVENTORY_HASH_INVALID",
  "NULL_COUNT_MISMATCH",
  "ROW_COUNT_MISMATCH",
  "TABLE_COUNT_MISMATCH",
]);

const falcon24E1DatabaseImportReceiptMaterialSchema = z
  .strictObject({
    receipt_version: z.literal(FALCON24_E1_DATABASE_IMPORT_RECEIPT_VERSION),
    authority_epoch: z.literal("E1"),
    dataset_version: z.literal(FALCON_DATASET_VERSION),
    source_commit: z.literal(FALCON_SOURCE_COMMIT),
    db_id: z.literal(FALCON24_E1_DB_ID),
    schema_name: z.literal(FALCON24_E1_SCHEMA_NAME),
    target_database: z.literal("data_agent"),
    reader_role: z.literal("falcon_demo_reader"),
    source_sqlite_sha256: contentHashSchema,
    expected_bundle_sha256: contentHashSchema,
    observed_bundle_sha256: contentHashSchema,
    expected_content_digest: contentHashSchema,
    expected_inventory_hash: contentHashSchema,
    catalog_inventory: falcon24E1CatalogInventorySchema,
    status: z.enum(["READY", "HOLD"]),
    failure_codes: z.array(falcon24E1ImportFailureCodeSchema).max(7),
  })
  .superRefine((receipt, context) => {
    const sorted = [...receipt.failure_codes].sort();
    if (
      new Set(receipt.failure_codes).size !== receipt.failure_codes.length ||
      receipt.failure_codes.some((code, index) => code !== sorted[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 E1 import failure_codes 必须唯一且规范排序。",
        path: ["failure_codes"],
      });
    }
    if ((receipt.status === "READY") !== (receipt.failure_codes.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 E1 import status 必须与 failure_codes 闭合。",
        path: ["status"],
      });
    }
  });

export const falcon24E1DatabaseImportReceiptSchema =
  falcon24E1DatabaseImportReceiptMaterialSchema.extend({ receipt_hash: contentHashSchema });

function canonicalizeFalcon24E1Tables(
  tables: readonly z.infer<typeof falcon24E1CatalogTableSchema>[],
): z.infer<typeof falcon24E1CatalogTableSchema>[] {
  return tables
    .map((table) => ({
      ...table,
      columns: [...table.columns].sort(
        (left, right) =>
          left.ordinal - right.ordinal || left.column_name.localeCompare(right.column_name),
      ),
    }))
    .sort((left, right) => left.table_name.localeCompare(right.table_name));
}

export async function buildFalcon24E1CatalogInventory(input: unknown) {
  const parsed = falcon24E1CatalogInventoryMaterialSchema.parse(input);
  const tables = canonicalizeFalcon24E1Tables(parsed.tables);
  const material = { ...parsed, tables };
  if (
    material.table_count !== tables.length ||
    material.column_count !== tables.reduce((total, table) => total + table.columns.length, 0) ||
    material.row_count !== tables.reduce((total, table) => total + table.row_count, 0) ||
    material.null_count !== tables.reduce((total, table) => total + table.null_count, 0)
  ) {
    throw new TypeError("FALCON24_E1_CATALOG_INVENTORY_TOTALS_INVALID");
  }
  return falcon24E1CatalogInventorySchema.parse({
    ...material,
    inventory_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24E1CatalogInventory(input: unknown) {
  const inventory = falcon24E1CatalogInventorySchema.parse(input);
  const { inventory_hash: observedHash, ...material } = inventory;
  const rebuilt = await buildFalcon24E1CatalogInventory(material);
  if (rebuilt.inventory_hash !== observedHash) {
    throw new TypeError("FALCON24_E1_CATALOG_INVENTORY_HASH_INVALID");
  }
  return inventory;
}

export async function buildFalcon24E1DatabaseImportReceipt(input: {
  readonly source: FalconBundleFile;
  readonly observed_bundle_sha256: `sha256:${string}`;
  readonly expected_inventory_hash: `sha256:${string}`;
  readonly catalog_inventory: unknown;
}) {
  const source = falconBundleFileSchema.parse(input.source);
  if (source.db_id !== FALCON24_E1_DB_ID || source.schema_name !== FALCON24_E1_SCHEMA_NAME) {
    throw new TypeError("FALCON24_E1_SOURCE_SCOPE_INVALID");
  }
  const catalogInventory = await verifyFalcon24E1CatalogInventory(input.catalog_inventory);
  const failureCodes = [
    ...(input.observed_bundle_sha256 === source.bundle_sha256 ? [] : ["BUNDLE_HASH_MISMATCH"]),
    ...(catalogInventory.column_count === source.column_count ? [] : ["COLUMN_COUNT_MISMATCH"]),
    ...(catalogInventory.content_digest === source.content_digest
      ? []
      : ["CONTENT_DIGEST_MISMATCH"]),
    ...(catalogInventory.inventory_hash === input.expected_inventory_hash
      ? []
      : ["INVENTORY_HASH_INVALID"]),
    ...(catalogInventory.null_count === source.null_count ? [] : ["NULL_COUNT_MISMATCH"]),
    ...(catalogInventory.row_count === source.row_count ? [] : ["ROW_COUNT_MISMATCH"]),
    ...(catalogInventory.table_count === source.table_count ? [] : ["TABLE_COUNT_MISMATCH"]),
  ].sort() as z.infer<typeof falcon24E1ImportFailureCodeSchema>[];
  const material = falcon24E1DatabaseImportReceiptMaterialSchema.parse({
    receipt_version: FALCON24_E1_DATABASE_IMPORT_RECEIPT_VERSION,
    authority_epoch: "E1",
    dataset_version: FALCON_DATASET_VERSION,
    source_commit: FALCON_SOURCE_COMMIT,
    db_id: FALCON24_E1_DB_ID,
    schema_name: FALCON24_E1_SCHEMA_NAME,
    target_database: "data_agent",
    reader_role: "falcon_demo_reader",
    source_sqlite_sha256: source.source_sqlite_sha256,
    expected_bundle_sha256: source.bundle_sha256,
    observed_bundle_sha256: input.observed_bundle_sha256,
    expected_content_digest: source.content_digest,
    expected_inventory_hash: input.expected_inventory_hash,
    catalog_inventory: catalogInventory,
    status: failureCodes.length === 0 ? "READY" : "HOLD",
    failure_codes: failureCodes,
  });
  return falcon24E1DatabaseImportReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24E1DatabaseImportReceipt(input: unknown) {
  const receipt = falcon24E1DatabaseImportReceiptSchema.parse(input);
  await verifyFalcon24E1CatalogInventory(receipt.catalog_inventory);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_E1_DATABASE_IMPORT_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

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
export type Falcon24E1CatalogInventory = z.infer<typeof falcon24E1CatalogInventorySchema>;
export type Falcon24E1DatabaseImportReceipt = z.infer<typeof falcon24E1DatabaseImportReceiptSchema>;
export type FalconSubmissionEntry = z.infer<typeof falconSubmissionEntrySchema>;
export type FalconSubmissionReceipt = z.infer<typeof falconSubmissionReceiptSchema>;
