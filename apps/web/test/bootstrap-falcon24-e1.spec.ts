import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runFalcon24E1Bootstrap } from "@/cli/bootstrap-falcon24-e1";

describe("Falcon24 historical E1 bootstrap admission", () => {
  it("does not open the retired authority boundary without explicit confirmation", async () => {
    await expect(
      runFalcon24E1Bootstrap({
        NODE_ENV: "test",
        DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP: "NO",
      }),
    ).resolves.toEqual({
      schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_E1_BOOTSTRAP_CONFIRMATION_REQUIRED",
    });
  });

  it("remains HOLD after confirmation and never exposes an invalid gen1 current", async () => {
    const secret = "must-not-appear-in-result";
    const result = await runFalcon24E1Bootstrap({
      NODE_ENV: "test",
      DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP: "YES",
      DATABASE_URL: "postgres://must-not-connect.invalid/data_agent",
      FALCON24_E1_MODEL_API_KEY: secret,
    });

    expect(result).toEqual({
      schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0",
      terminal: "HOLD",
      reason_code: "FALCON24_E1_BOOTSTRAP_RETIRED_SEMANTIC_SUCCESSOR_REQUIRED",
      production_readiness: "HOLD",
      immutable_history_policy: "NO_GENERATION_1_WRITES",
      required_entrypoint: "finalize:falcon24-authority",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("uses the same fail-closed result in production", async () => {
    await expect(
      runFalcon24E1Bootstrap({
        NODE_ENV: "production",
        DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP: "YES",
      }),
    ).resolves.toMatchObject({
      terminal: "HOLD",
      reason_code: "FALCON24_E1_BOOTSTRAP_RETIRED_SEMANTIC_SUCCESSOR_REQUIRED",
      production_readiness: "HOLD",
    });
  });

  it("has no generation-1 writer, projection payload, or bootstrap publisher import", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/bootstrap-falcon24-e1.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain("projection_payload");
    expect(source).not.toContain("compileSemanticPublicationProjection");
    expect(source).not.toContain("createPostgresGreenfieldBootstrapReleaseAuthority");
    expect(source).not.toContain("bootstrapFalcon24E1");
    expect(source).not.toMatch(/insert\s+into\s+semantic\./iu);
    expect(source).not.toContain("DATABASE_URL");
  });
});
