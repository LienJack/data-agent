import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runFalcon24EpochClosureFailureRecord } from "../src/cli/record-falcon24-epoch-closure-failure.js";

describe("Falcon24 epoch closure failure record control", () => {
  it("refuses writes without explicit confirmation", async () => {
    await expect(runFalcon24EpochClosureFailureRecord({ NODE_ENV: "test" })).resolves.toEqual({
      schema_version: "falcon24-epoch-closure-failure-record-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_EPOCH_CLOSURE_FAILURE_CONFIRMATION_REQUIRED",
    });
  });

  it("loads server authority and records through the unique Falcon Port", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../src/cli/record-falcon24-epoch-closure-failure.ts", import.meta.url),
      ),
      "utf8",
    );

    expect(source).toContain("createPostgresCapabilityAuthority");
    expect(source).toContain("createPostgresFalcon24AuthorityEpoch");
    expect(source).toContain("loadCurrent");
    expect(source).toContain("loadLlmExecutionStage");
    expect(source).toContain("recordEpochClosureFailure");
    expect(source).not.toMatch(/pool\.query|client\.query/u);
    expect(source).not.toMatch(/SUBJECT_HASH|EVIDENCE_HASH|READINESS/u);
  });
});
