import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runFalcon24AuthorityStagingHold } from "../src/cli/hold-falcon24-authority-staging.js";

describe("Falcon24 authority staging HOLD control", () => {
  it("refuses mutation without an explicit confirmation", async () => {
    await expect(runFalcon24AuthorityStagingHold({ NODE_ENV: "test" })).resolves.toEqual({
      schema_version: "falcon24-authority-staging-hold-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_STAGING_HOLD_CONFIRMATION_REQUIRED",
    });
  });

  it("uses only the capability-authorized Falcon authority Port", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/hold-falcon24-authority-staging.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("createPostgresCapabilityAuthority");
    expect(source).toContain("createPostgresFalcon24AuthorityEpoch");
    expect(source).toContain("holdStagingSession");
    expect(source).not.toMatch(/pool\.query|client\.query/u);
  });
});
