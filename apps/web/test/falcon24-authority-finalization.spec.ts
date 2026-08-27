import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildFalcon24AcceptanceContractHashes,
  runFalcon24AuthorityFinalization,
} from "../src/cli/finalize-falcon24-authority.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const oracleHash = `sha256:${"a".repeat(64)}` as const;

describe("Falcon24 versioned authority finalization", () => {
  it("refuses activation without the destructive confirmation", async () => {
    await expect(runFalcon24AuthorityFinalization({ NODE_ENV: "test" })).resolves.toEqual({
      schema_version: "falcon24-authority-finalization-result@2.0.0",
      authority_epoch: "E2",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_AUTHORITY_ACTIVATION_CONFIRMATION_REQUIRED",
    });
  });

  it("rejects E1 as a v2 activation target before confirmation", async () => {
    await expect(
      runFalcon24AuthorityFinalization({
        NODE_ENV: "test",
        FALCON24_AUTHORITY_EPOCH: "E1",
      }),
    ).rejects.toThrow();
  });

  it("content-addresses every final acceptance contract from its frozen source closure", async () => {
    const left = await buildFalcon24AcceptanceContractHashes({
      repository_root: repositoryRoot,
      oracle_contract_hash: oracleHash,
    });
    const right = await buildFalcon24AcceptanceContractHashes({
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
