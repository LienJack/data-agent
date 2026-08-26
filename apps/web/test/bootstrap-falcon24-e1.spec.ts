import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FALCON24_E1_EXPECTED_CATALOG_INVENTORY_HASH } from "@data-agent/contracts/evals";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runFalcon24E1Bootstrap } from "@/cli/bootstrap-falcon24-e1";

describe("Falcon24 E1 bootstrap command", () => {
  it("does not open the authority boundary without the explicit confirmation", async () => {
    const secret = "must-not-appear-in-result";
    const result = await runFalcon24E1Bootstrap({
      NODE_ENV: "test",
      DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP: "NO",
      FALCON24_E1_MODEL_API_KEY: secret,
    });

    expect(result).toEqual({
      schema_version: "falcon24-e1-bootstrap-cli-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_E1_BOOTSTRAP_CONFIRMATION_REQUIRED",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("refuses disposable semantic signers in production before database access", async () => {
    const productionEnvironments = [
      { NODE_ENV: "production", FALCON24_E1_ENVIRONMENT: "local" },
      { NODE_ENV: "test", FALCON24_E1_ENVIRONMENT: "prod" },
      { NODE_ENV: "test", FALCON24_E1_ENVIRONMENT: "production" },
    ] as const;
    for (const environment of productionEnvironments) {
      await expect(
        runFalcon24E1Bootstrap({
          ...environment,
          DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP: "YES",
          DATABASE_URL: "postgres://invalid.example/data_agent",
        }),
      ).rejects.toThrow("FALCON24_E1_PRODUCTION_SIGNER_PROVISION_REQUIRED");
    }
  });

  it("keeps FULL, FALCON24_E1, and NONE import modes mutually exclusive", () => {
    const repositoryRoot = resolve(process.cwd(), "../..");
    const initScript = readFileSync(resolve(repositoryRoot, "infra/docker/init-db.sh"), "utf8");
    const e1Importer = readFileSync(
      resolve(repositoryRoot, "infra/docker/import-falcon24-e1.sh"),
      "utf8",
    );
    const fullCase = initScript.match(/FULL\)([\s\S]*?);;/u)?.[1] ?? "";
    const e1Case = initScript.match(/FALCON24_E1\)([\s\S]*?);;/u)?.[1] ?? "";
    const noneCase = initScript.match(/NONE\)([\s\S]*?);;/u)?.[1] ?? "";

    expect(fullCase).toContain("/import-falcon.sh");
    expect(fullCase).not.toContain("/import-falcon24-e1.sh");
    expect(e1Case).toContain("/import-falcon24-e1.sh");
    expect(e1Case).not.toContain("/import-falcon.sh");
    expect(noneCase).not.toContain("/import-falcon");
    expect(e1Importer).toContain(
      `EXPECTED_CATALOG_INVENTORY_HASH="${FALCON24_E1_EXPECTED_CATALOG_INVENTORY_HASH}"`,
    );

    const sourceManifest = JSON.parse(
      readFileSync(resolve(repositoryRoot, "infra/falcon/v1/source-manifest.json"), "utf8"),
    ) as { database_count: number; files: Array<{ schema_name: string }> };
    expect(sourceManifest.database_count).toBe(28);
    expect(sourceManifest.files).toHaveLength(28);
    expect(sourceManifest.files.some(({ schema_name }) => schema_name === "falcon_db_24")).toBe(
      true,
    );
  });
});
