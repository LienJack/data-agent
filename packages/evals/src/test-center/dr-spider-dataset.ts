import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedBenchmarkCase,
  sealedBenchmarkCaseSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  defaultBenchmarkRoot,
  drSpiderInstallDirectory,
  getVerifiedDrSpiderImportReceipt,
} from "./catalog.js";

export interface DrSpiderDataset {
  readonly installation_directory: string;
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly sealed_cases: readonly SealedBenchmarkCase[];
  readonly database_path_by_case_id: ReadonlyMap<string, string>;
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

export async function loadDrSpiderDataset(
  benchmarkRoot = defaultBenchmarkRoot(),
): Promise<DrSpiderDataset> {
  const receipt = await getVerifiedDrSpiderImportReceipt(benchmarkRoot);
  if (!receipt) throw new Error("BENCHMARK_DATASET_NOT_READY");
  const directory = drSpiderInstallDirectory(benchmarkRoot);
  const [publicCases, sealedCases] = await Promise.all([
    readFile(join(directory, "public-cases.json"), "utf8").then((value) =>
      z.array(publicBenchmarkCaseSchema).parse(JSON.parse(value)),
    ),
    readFile(join(directory, "sealed", "sealed-cases.json"), "utf8").then((value) =>
      z.array(sealedBenchmarkCaseSchema).parse(JSON.parse(value)),
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
  const databasePaths = new Map<string, string>();
  for (const sealedCase of sealedCases) {
    if (
      publicHashes.get(sealedCase.public_case.case_id) !== sealedCase.public_case.public_case_hash
    ) {
      throw new Error("BENCHMARK_DATASET_PUBLIC_SEALED_MISMATCH");
    }
    databasePaths.set(
      sealedCase.public_case.case_id,
      resolveInside(directory, sealedCase.database_relative_path),
    );
  }
  return Object.freeze({
    installation_directory: directory,
    public_cases: Object.freeze(publicCases),
    sealed_cases: Object.freeze(sealedCases),
    database_path_by_case_id: databasePaths,
    installed_digest: receipt.installed_digest,
  });
}
