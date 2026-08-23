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
  birdInstallDirectory,
  defaultBenchmarkRoot,
  getVerifiedBirdImportReceipt,
} from "./catalog.js";

export interface BirdMiniDevDataset {
  readonly installation_directory: string;
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly sealed_cases: readonly SealedBenchmarkCase[];
  readonly published_predictions: Readonly<Record<string, string>>;
  readonly database_path: string;
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

export async function loadBirdMiniDevDataset(
  benchmarkRoot = defaultBenchmarkRoot(),
): Promise<BirdMiniDevDataset> {
  const receipt = await getVerifiedBirdImportReceipt(benchmarkRoot);
  if (!receipt) throw new Error("BENCHMARK_DATASET_NOT_READY");
  const directory = birdInstallDirectory(benchmarkRoot);
  const [publicCases, sealedCases, predictions] = await Promise.all([
    readFile(join(directory, "public-cases.json"), "utf8").then((value) =>
      z.array(publicBenchmarkCaseSchema).parse(JSON.parse(value)),
    ),
    readFile(join(directory, "sealed", "sealed-cases.json"), "utf8").then((value) =>
      z.array(sealedBenchmarkCaseSchema).parse(JSON.parse(value)),
    ),
    readFile(join(directory, "agents", "gpt-4-turbo-published.json"), "utf8").then((value) =>
      z.record(z.string(), z.string()).parse(JSON.parse(value)),
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
    published_predictions: Object.freeze(predictions),
    database_path: resolveInside(directory, "databases/superhero.sqlite"),
    installed_digest: receipt.installed_digest,
  });
}
