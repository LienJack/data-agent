import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedMultipleChoiceBenchmarkCase,
  sealedMultipleChoiceBenchmarkCaseSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  bladeInstallDirectory,
  defaultBenchmarkRoot,
  getVerifiedBladeImportReceipt,
} from "./catalog.js";

export interface BladeDataset {
  readonly installation_directory: string;
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly sealed_cases: readonly SealedMultipleChoiceBenchmarkCase[];
  readonly installed_digest: string;
}

export async function loadBladeDataset(
  benchmarkRoot = defaultBenchmarkRoot(),
): Promise<BladeDataset> {
  const receipt = await getVerifiedBladeImportReceipt(benchmarkRoot);
  if (!receipt) throw new Error("BENCHMARK_DATASET_NOT_READY");
  const directory = bladeInstallDirectory(benchmarkRoot);
  const [publicCases, sealedCases] = await Promise.all([
    readFile(join(directory, "public-cases.json"), "utf8").then((value) =>
      z.array(publicBenchmarkCaseSchema).parse(JSON.parse(value)),
    ),
    readFile(join(directory, "sealed", "sealed-cases.json"), "utf8").then((value) =>
      z.array(sealedMultipleChoiceBenchmarkCaseSchema).parse(JSON.parse(value)),
    ),
  ]);
  if (
    publicCases.length !== receipt.selected_case_count ||
    sealedCases.length !== receipt.selected_case_count
  ) {
    throw new Error("BENCHMARK_DATASET_CASE_COUNT_MISMATCH");
  }
  const publicHashes = new Map(
    publicCases.map((testCase) => [testCase.case_id, testCase.public_case_hash]),
  );
  for (const sealedCase of sealedCases) {
    if (
      publicHashes.get(sealedCase.public_case.case_id) !== sealedCase.public_case.public_case_hash
    ) {
      throw new Error("BENCHMARK_DATASET_PUBLIC_SEALED_MISMATCH");
    }
  }
  return Object.freeze({
    installation_directory: directory,
    public_cases: Object.freeze(publicCases),
    sealed_cases: Object.freeze(sealedCases),
    installed_digest: receipt.installed_digest,
  });
}
