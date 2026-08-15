import { contentHashSchema } from "@data-agent/contracts";
import { z } from "zod";

export const DR_SPIDER_SOURCE_COMMIT = "c64694a4a278ab0faff08ce7a3501d46f458b431";
export const DR_SPIDER_DATASET_VERSION = "dr-spider-dbcontent-smoke-v5";
export const DR_SPIDER_ARCHIVE_URL = `https://media.githubusercontent.com/media/awslabs/diagnostic-robustness-text-to-sql/${DR_SPIDER_SOURCE_COMMIT}/data.tar.gz`;
export const DR_SPIDER_ARCHIVE_SHA256 =
  "sha256:d0f47e4d2c9202f4fd2d956a34e9dd1ff8180c1c9e58cf5b530c13fefaaa3ba9";
export const DR_SPIDER_ARCHIVE_BYTES = 168_450_638;
export const DR_SPIDER_FULL_POST_CASE_COUNT = 15_269;
export const DR_SPIDER_SMOKE_CASE_COUNT = 10;

export const drSpiderImportReceiptSchema = z.strictObject({
  receipt_version: z.literal("1.0.0"),
  suite_id: z.literal("dr-spider"),
  suite_version: z.literal("1.0.0"),
  dataset_version: z.literal(DR_SPIDER_DATASET_VERSION),
  source_commit: z.literal(DR_SPIDER_SOURCE_COMMIT),
  source_url: z.literal(DR_SPIDER_ARCHIVE_URL),
  archive_sha256: z.literal(DR_SPIDER_ARCHIVE_SHA256),
  archive_bytes: z.literal(DR_SPIDER_ARCHIVE_BYTES),
  license_spdx_id: z.literal("CC-BY-4.0"),
  perturbation: z.literal("DB_DBcontent_equivalence"),
  selected_database_ids: z.tuple([z.literal("tvshow_0"), z.literal("dog_kennels_0")]),
  selected_case_count: z.literal(DR_SPIDER_SMOKE_CASE_COUNT),
  installed_files: z
    .array(
      z.strictObject({
        relative_path: z.string().min(1),
        bytes: z.number().int().nonnegative(),
        sha256: contentHashSchema,
      }),
    )
    .min(3),
  installed_digest: contentHashSchema,
  installed_at: z.iso.datetime({ offset: true }),
});

export type DrSpiderImportReceipt = z.infer<typeof drSpiderImportReceiptSchema>;
