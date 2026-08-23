import { contentHashSchema } from "@data-agent/contracts";
import { z } from "zod";

export const INSIGHTBENCH_REPOSITORY_COMMIT = "33c27c1282cb7ed73267d36fb84e27b6ea8aac2b";
export const INSIGHTBENCH_DATASET_COMMIT = "fd1a1cad6ee96be83d1949db1a3eef6b7b992934";
export const INSIGHTBENCH_DATASET_VERSION = "insightbench-hf-fd1a1cad";
export const INSIGHTBENCH_SOURCE_ROOT = `https://huggingface.co/datasets/ServiceNow/insight_bench/resolve/${INSIGHTBENCH_DATASET_COMMIT}`;

export interface InsightBenchSourceFile {
  readonly flag: number;
  readonly kind: "json" | "csv";
  readonly relative_path: string;
  readonly bytes: number;
  readonly sha256: `sha256:${string}`;
}

export const INSIGHTBENCH_SMOKE_FILES: readonly InsightBenchSourceFile[] = Object.freeze([
  {
    flag: 1,
    kind: "json",
    relative_path: "json/flag-1.json",
    bytes: 20_390,
    sha256: "sha256:fd34cb2d85314107b7ae13234feb64121d611cb77fbfd4d871577f21661b5e1e",
  },
  {
    flag: 1,
    kind: "csv",
    relative_path: "notebooks/csvs/flag-1.csv",
    bytes: 111_053,
    sha256: "sha256:7a262de8d6654f97c89775d8392cfd4e9f7fd8f028545cb874fcee3d2cd3278c",
  },
  {
    flag: 2,
    kind: "json",
    relative_path: "json/flag-2.json",
    bytes: 11_795,
    sha256: "sha256:808e500d249e97df74f63e4b8a658ea6f910c9d7202533a7e362c9c8a835d9bb",
  },
  {
    flag: 2,
    kind: "csv",
    relative_path: "notebooks/csvs/flag-2.csv",
    bytes: 97_139,
    sha256: "sha256:585163e1f6b210f61cebac4a37c63b709c8faba60068e46fc0706a1f0c5d2cf4",
  },
  {
    flag: 3,
    kind: "json",
    relative_path: "json/flag-3.json",
    bytes: 8_707,
    sha256: "sha256:6fefbf4853fe694537c70e8b6a38cb252a8f377e72b000bbc0d4cdeeeac910f6",
  },
  {
    flag: 3,
    kind: "csv",
    relative_path: "notebooks/csvs/flag-3.csv",
    bytes: 102_056,
    sha256: "sha256:115b150838b92cf79949e67269989a94a6730edf9001f94d537af72e71e50d36",
  },
  {
    flag: 4,
    kind: "json",
    relative_path: "json/flag-4.json",
    bytes: 20_575,
    sha256: "sha256:04e44473888c500f713aba415bb02b0d62027b367d81991c8b6f27467368c733",
  },
  {
    flag: 4,
    kind: "csv",
    relative_path: "notebooks/csvs/flag-4.csv",
    bytes: 104_704,
    sha256: "sha256:c1ea5dcb9d36c0b596fa78c9e24f3a1fdc5d7067cd152e568b29ecc65a8a9d80",
  },
  {
    flag: 5,
    kind: "json",
    relative_path: "json/flag-5.json",
    bytes: 13_862,
    sha256: "sha256:a9510cd1f7a94de8d36c127f3088f6f0efd049822355c7403f96895cea5907f8",
  },
  {
    flag: 5,
    kind: "csv",
    relative_path: "notebooks/csvs/flag-5.csv",
    bytes: 107_751,
    sha256: "sha256:8f40e2b58afeccb9e65954dd6a536bc2d1c5456bac46d09b8aae80922ffb0368",
  },
]);

const installedFileSchema = z.strictObject({
  relative_path: z.string().min(1).max(1_024),
  bytes: z.number().int().positive(),
  sha256: contentHashSchema,
});

export const insightBenchImportReceiptSchema = z.strictObject({
  receipt_version: z.literal("1.0.0"),
  suite_id: z.literal("insightbench"),
  suite_version: z.literal("1.0.0"),
  dataset_version: z.literal(INSIGHTBENCH_DATASET_VERSION),
  repository_commit: z.literal(INSIGHTBENCH_REPOSITORY_COMMIT),
  dataset_commit: z.literal(INSIGHTBENCH_DATASET_COMMIT),
  license_spdx_id: z.literal("CC-BY-4.0"),
  selected_case_count: z.literal(5),
  source_files: z.array(installedFileSchema).length(10),
  installed_files: z.array(installedFileSchema).length(7),
  installed_digest: contentHashSchema,
  installed_at: z.iso.datetime({ offset: true }),
});

export type InsightBenchImportReceipt = z.infer<typeof insightBenchImportReceiptSchema>;
