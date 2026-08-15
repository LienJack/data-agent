import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedInsightBenchmarkCase,
  sealedInsightBenchmarkCaseSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  defaultBenchmarkRoot,
  getVerifiedInsightBenchImportReceipt,
  insightBenchInstallDirectory,
} from "./catalog.js";

export interface InsightBenchDataset {
  readonly installation_directory: string;
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly sealed_cases: readonly SealedInsightBenchmarkCase[];
  readonly csv_by_case_id: ReadonlyMap<string, string>;
  readonly installed_digest: string;
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("BENCHMARK_DATASET_PATH_ESCAPE");
  }
  return target;
}

export async function loadInsightBenchDataset(
  benchmarkRoot = defaultBenchmarkRoot(),
): Promise<InsightBenchDataset> {
  const receipt = await getVerifiedInsightBenchImportReceipt(benchmarkRoot);
  if (!receipt) throw new Error("BENCHMARK_DATASET_NOT_READY");
  const directory = insightBenchInstallDirectory(benchmarkRoot);
  const [publicCases, sealedCases] = await Promise.all([
    readFile(join(directory, "public-cases.json"), "utf8").then((value) =>
      z.array(publicBenchmarkCaseSchema).parse(JSON.parse(value)),
    ),
    readFile(join(directory, "sealed", "sealed-cases.json"), "utf8").then((value) =>
      z.array(sealedInsightBenchmarkCaseSchema).parse(JSON.parse(value)),
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
  const csvByCaseId = new Map<string, string>();
  for (const sealedCase of sealedCases) {
    if (
      publicHashes.get(sealedCase.public_case.case_id) !== sealedCase.public_case.public_case_hash
    ) {
      throw new Error("BENCHMARK_DATASET_PUBLIC_SEALED_MISMATCH");
    }
    const csvPath = resolveInside(directory, sealedCase.data_relative_path);
    csvByCaseId.set(sealedCase.public_case.case_id, await readFile(csvPath, "utf8"));
  }
  return Object.freeze({
    installation_directory: directory,
    public_cases: Object.freeze(publicCases),
    sealed_cases: Object.freeze(sealedCases),
    csv_by_case_id: csvByCaseId,
    installed_digest: receipt.installed_digest,
  });
}
