import {
  benchmarkRunBudgetSchema,
  benchmarkTestSuiteIdSchema,
  buildFalcon24DatabaseVerificationReceiptV2,
  buildFalcon24E1CatalogInventory,
  buildFalcon24E1DatabaseImportReceipt,
  FALCON_CASE_COUNT,
  FALCON_DATABASE_COUNT,
  falcon24DatabaseVerificationReceiptV2Schema,
  falcon24E1DatabaseImportReceiptSchema,
  falconSchemaNameSchema,
  falconSourceManifestSchema,
  sealedFalconCaseSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";

describe("Falcon contracts", () => {
  it("registers Falcon and permits a 500-case frozen batch", () => {
    expect(benchmarkTestSuiteIdSchema.parse("falcon")).toBe("falcon");
    expect(
      benchmarkRunBudgetSchema.parse({
        max_cases: FALCON_CASE_COUNT,
        max_attempts_per_case: 2,
        max_case_duration_ms: 60_000,
        max_batch_duration_ms: 3_600_000,
        max_output_tokens_per_attempt: 4_096,
        concurrency: 1,
      }).max_cases,
    ).toBe(500);
  });

  it("accepts exactly falcon_db_01 through falcon_db_28", () => {
    expect(falconSchemaNameSchema.parse("falcon_db_01")).toBe("falcon_db_01");
    expect(falconSchemaNameSchema.parse("falcon_db_28")).toBe("falcon_db_28");
    expect(falconSchemaNameSchema.safeParse("falcon_db_29").success).toBe(false);
    expect(falconSchemaNameSchema.safeParse("public").success).toBe(false);
  });

  it("requires complete source counts and keeps sealed truth outside public cases", () => {
    const manifest = {
      manifest_version: "falcon-source-manifest@1.0.0",
      suite_version: "1.0.0",
      dataset_version: "falcon-fixed-8ff29caa-postgres-v1",
      repository_url: "https://github.com/eosphoros-ai/Falcon",
      source_commit: "8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5",
      license_spdx_id: "Apache-2.0",
      dev_case_count: 309,
      test_case_count: 191,
      case_count: 500,
      database_count: 28,
      demo_case_count: 10,
      tuning_case_count: 294,
      local_holdout_case_count: 5,
      official_test_case_count: 191,
      main_demo_db_id: 24,
      smoke_db_id: 14,
      files: Array.from({ length: FALCON_DATABASE_COUNT }, (_, index) => {
        const dbId = index + 1;
        const suffix = String(dbId).padStart(2, "0");
        return {
          db_id: dbId,
          schema_name: `falcon_db_${suffix}`,
          relative_path: `bundles/falcon_db_${suffix}.sql.gz`,
          source_sqlite_sha256: `sha256:${"a".repeat(64)}`,
          bundle_sha256: `sha256:${"b".repeat(64)}`,
          bundle_bytes: 1,
          table_count: 1,
          column_count: 1,
          row_count: 0,
          null_count: 0,
          content_digest: `sha256:${"c".repeat(64)}`,
        };
      }),
      public_cases_sha256: `sha256:${"d".repeat(64)}`,
      sealed_cases_sha256: `sha256:${"e".repeat(64)}`,
      test_cases_sha256: `sha256:${"f".repeat(64)}`,
      compatibility_fixtures_sha256: `sha256:${"1".repeat(64)}`,
      source_digest: `sha256:${"2".repeat(64)}`,
    };
    expect(falconSourceManifestSchema.parse(manifest).files).toHaveLength(28);
    expect(falconSourceManifestSchema.safeParse({ ...manifest, case_count: 499 }).success).toBe(
      false,
    );
    expect(sealedFalconCaseSchema.shape).toHaveProperty("expected_results");
  });

  it("builds a deterministic db24-only E1 import receipt and fails closed on drift", async () => {
    const source = {
      db_id: 24,
      schema_name: "falcon_db_24",
      relative_path: "bundles/falcon_db_24.sql.gz",
      source_sqlite_sha256: `sha256:${"1".repeat(64)}`,
      bundle_sha256: `sha256:${"2".repeat(64)}`,
      bundle_bytes: 10,
      table_count: 1,
      column_count: 2,
      row_count: 3,
      null_count: 1,
      content_digest: `sha256:${"3".repeat(64)}`,
    } as const;
    const inventory = await buildFalcon24E1CatalogInventory({
      schema_name: "falcon_db_24",
      tables: [
        {
          table_name: "orders",
          columns: [
            { ordinal: 2, column_name: "note", data_type: "text", is_nullable: true },
            { ordinal: 1, column_name: "id", data_type: "bigint", is_nullable: true },
          ],
          row_count: 3,
          null_count: 1,
        },
      ],
      table_count: 1,
      column_count: 2,
      row_count: 3,
      null_count: 1,
      content_digest: source.content_digest,
    });
    const ready = await buildFalcon24E1DatabaseImportReceipt({
      source,
      observed_bundle_sha256: source.bundle_sha256,
      expected_inventory_hash: inventory.inventory_hash as `sha256:${string}`,
      catalog_inventory: inventory,
    });
    expect(ready.status).toBe("READY");
    expect(ready.failure_codes).toEqual([]);
    expect(
      ready.catalog_inventory.tables[0]?.columns.map(({ column_name }) => column_name),
    ).toEqual(["id", "note"]);
    expect(falcon24E1DatabaseImportReceiptSchema.parse(ready)).toEqual(ready);
    const successor = await buildFalcon24DatabaseVerificationReceiptV2({
      authority_epoch: "E2",
      source,
      observed_bundle_sha256: source.bundle_sha256,
      expected_inventory_hash: inventory.inventory_hash as `sha256:${string}`,
      catalog_inventory: inventory,
    });
    expect(successor.status).toBe("READY");
    expect(successor.authority_epoch).toBe("E2");
    expect(successor.receipt_hash).not.toBe(ready.receipt_hash);
    expect(falcon24DatabaseVerificationReceiptV2Schema.parse(successor)).toEqual(successor);

    const { inventory_hash: _inventoryHash, ...inventoryMaterial } = inventory;
    const driftedInventory = await buildFalcon24E1CatalogInventory({
      ...inventoryMaterial,
      content_digest: `sha256:${"5".repeat(64)}` as `sha256:${string}`,
    });
    const drifted = await buildFalcon24E1DatabaseImportReceipt({
      source,
      observed_bundle_sha256: `sha256:${"4".repeat(64)}` as `sha256:${string}`,
      expected_inventory_hash: inventory.inventory_hash as `sha256:${string}`,
      catalog_inventory: driftedInventory,
    });
    expect(drifted.status).toBe("HOLD");
    expect(drifted.failure_codes).toEqual([
      "BUNDLE_HASH_MISMATCH",
      "CONTENT_DIGEST_MISMATCH",
      "INVENTORY_HASH_INVALID",
    ]);
  });
});
