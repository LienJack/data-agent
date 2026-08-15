import {
  type SealedBenchmarkCase,
  type SealedFalconCase,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { FalconDevDataset } from "./falcon-dataset.js";
import { falconOracleReference } from "./falcon-oracle.js";
import type { SqlBenchmarkDataset } from "./runner.js";

/**
 * Adapts sealed Falcon expected-result truth to the shared batch runner without
 * placing Gold SQL or expected values in the runner manifest or Agent input.
 */
export async function toFalconSqlBenchmarkDataset(
  dataset: FalconDevDataset,
): Promise<SqlBenchmarkDataset> {
  const publicCases = dataset.public_cases.filter(
    (testCase) => testCase.registry !== "OFFICIAL_TEST_BLIND",
  );
  const sealedCases: SealedBenchmarkCase[] = await Promise.all(
    dataset.sealed_cases.map(async (sealedCase: SealedFalconCase) => {
      const material = {
        public_case: sealedCase.public_case,
        database_relative_path: sealedCase.public_case.database_id,
        gold_sql: falconOracleReference(sealedCase.public_case.case_id),
      };
      return {
        ...material,
        sealed_case_hash: await sha256ContentHash(material),
      };
    }),
  );
  return Object.freeze({
    public_cases: Object.freeze(publicCases),
    sealed_cases: Object.freeze(sealedCases),
    installed_digest: dataset.installed_digest,
    database_path_by_case_id: new Map(
      publicCases.map((testCase) => [testCase.case_id, testCase.database_id]),
    ),
  });
}
