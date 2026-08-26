import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildFalcon24E1AcceptanceContractHashes,
  runFalcon24E1Finalization,
} from "../src/cli/finalize-falcon24-e1.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const oracleHash = `sha256:${"a".repeat(64)}` as const;

describe("Falcon24 E1 finalization", () => {
  it("refuses activation without the destructive confirmation", async () => {
    await expect(runFalcon24E1Finalization({ NODE_ENV: "test" })).resolves.toEqual({
      schema_version: "falcon24-e1-finalization-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_E1_ACTIVATION_CONFIRMATION_REQUIRED",
    });
  });

  it("content-addresses every final acceptance contract from its frozen source closure", async () => {
    const left = await buildFalcon24E1AcceptanceContractHashes({
      repository_root: repositoryRoot,
      oracle_contract_hash: oracleHash,
    });
    const right = await buildFalcon24E1AcceptanceContractHashes({
      repository_root: repositoryRoot,
      oracle_contract_hash: oracleHash,
    });

    expect(right).toEqual(left);
    expect(left.oracle).toBe(oracleHash);
    expect(Object.values(left)).toHaveLength(6);
    expect(new Set(Object.values(left)).size).toBe(6);
    expect(Object.values(left).every((hash) => /^sha256:[a-f0-9]{64}$/u.test(hash))).toBe(true);
  });
});
