import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runFalcon24AuthorityActivationHold } from "../src/cli/hold-falcon24-authority-activation.js";

describe("Falcon24 authority activation HOLD control", () => {
  it("refuses mutation without an explicit confirmation", async () => {
    await expect(runFalcon24AuthorityActivationHold({ NODE_ENV: "test" })).resolves.toEqual({
      schema_version: "falcon24-authority-activation-hold-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_ACTIVATION_HOLD_CONFIRMATION_REQUIRED",
    });
  });

  it("uses exact activation-attempt configuration and only the capability Port", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/hold-falcon24-authority-activation.ts", import.meta.url)),
      "utf8",
    );

    for (const marker of [
      "DATA_AGENT_ALLOW_FALCON24_ACTIVATION_HOLD",
      "FALCON24_ACTIVATION_ATTEMPT_ID",
      "FALCON24_ACTIVATION_BASELINE_ID",
      "FALCON24_ACTIVATION_EXPECTED_BASELINE_HASH",
      "FALCON24_ACTIVATION_FAILURE_CODE",
      "createPostgresCapabilityAuthority",
      "createPostgresFalcon24AuthorityEpoch",
      "holdActivationAttempt",
      'schema_version: "falcon24-activation-request@2.0.0"',
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).not.toMatch(/pool\.query|client\.query/u);
  });
});
