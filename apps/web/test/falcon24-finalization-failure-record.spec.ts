import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runFalcon24FinalizationFailureRecord } from "../src/cli/record-falcon24-finalization-failure.js";

describe("Falcon24 finalization failure record control", () => {
  it("refuses writes without explicit confirmation", async () => {
    await expect(runFalcon24FinalizationFailureRecord({ NODE_ENV: "test" })).resolves.toEqual({
      schema_version: "falcon24-finalization-failure-record-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_FINALIZATION_FAILURE_CONFIRMATION_REQUIRED",
    });
  });

  it("loads exact E9 authority and records only through the Falcon port", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/record-falcon24-finalization-failure.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("createPostgresCapabilityAuthority");
    expect(source).toContain("createPostgresFalcon24AuthorityEpoch");
    expect(source).toContain('current?.authority_epoch !== "E9"');
    expect(source).toContain("loadLlmExecutionStage");
    expect(source).toContain("recordFinalizationFailure");
    expect(source).not.toMatch(/pool\.query|client\.query/u);
    expect(source).not.toMatch(/DEFINITION_HASH|EVIDENCE_HASH|SQLSTATE.*environment/u);
  });
});
