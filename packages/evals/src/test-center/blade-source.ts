import { contentHashSchema } from "@data-agent/contracts";
import { z } from "zod";

export const BLADE_SOURCE_COMMIT = "6118fa8d5007b91aa8c91c518182db82446a4547";
export const BLADE_DATASET_VERSION = "blade-mcq-smoke-v1";
export const BLADE_ARCHIVE_URL =
  "https://codeload.github.com/behavioral-data/BLADE/tar.gz/6118fa8d5007b91aa8c91c518182db82446a4547";
export const BLADE_ARCHIVE_SHA256 =
  "sha256:3734122d0adaa857986dc7076776ebb1ddc4b6db26033e624eb4225d61625330";
export const BLADE_ARCHIVE_BYTES = 15_975_760;
export const BLADE_FULL_MCQ_CASE_COUNT = 188;
export const BLADE_SMOKE_CASE_COUNT = 10;
export const BLADE_SMOKE_DATASETS = [
  "affairs",
  "amtl",
  "boxes",
  "caschools",
  "crofoot",
  "fish",
  "hurricane",
  "mortgage",
  "panda_nuts",
  "reading",
] as const;

export const bladeImportReceiptSchema = z.strictObject({
  receipt_version: z.literal("1.0.0"),
  suite_id: z.literal("blade"),
  suite_version: z.literal("1.0.0"),
  dataset_version: z.literal(BLADE_DATASET_VERSION),
  source_commit: z.literal(BLADE_SOURCE_COMMIT),
  source_url: z.literal(BLADE_ARCHIVE_URL),
  archive_sha256: z.literal(BLADE_ARCHIVE_SHA256),
  archive_bytes: z.literal(BLADE_ARCHIVE_BYTES),
  code_license_spdx_id: z.literal("Apache-2.0"),
  data_license_spdx_id: z.literal("ODC-By-1.0"),
  selected_datasets: z.tuple(
    BLADE_SMOKE_DATASETS.map((value) => z.literal(value)) as [
      z.ZodLiteral<(typeof BLADE_SMOKE_DATASETS)[number]>,
      ...z.ZodLiteral<(typeof BLADE_SMOKE_DATASETS)[number]>[],
    ],
  ),
  selected_case_count: z.literal(BLADE_SMOKE_CASE_COUNT),
  public_cases_sha256: contentHashSchema,
  sealed_cases_sha256: contentHashSchema,
  installed_digest: contentHashSchema,
  installed_at: z.iso.datetime({ offset: true }),
});

export type BladeImportReceipt = z.infer<typeof bladeImportReceiptSchema>;
