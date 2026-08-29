import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("system model certification boundary", () => {
  it("runs as a direct certification workflow without question Run queue/legacy acceptance", async () => {
    const source = await readFile(
      new URL("../src/system-model-certification-cli.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("createPostgresRunQueue");
    expect(source).not.toContain("createRunWorkerRunner");
    expect(source).not.toContain("acceptCommand");
    expect(source).not.toContain("START_L2_RESEARCH");
    expect(source).toContain("runCredentialedProviderCertification");
    expect(source).toContain("createPostgresModelCertificationReceiptStore");
  });

  it("stages E7 only after zero-write credential preflight and uses governed Run ports", async () => {
    const source = await readFile(
      new URL("../src/evals/falcon24-e7-llm-certification-cli.ts", import.meta.url),
      "utf8",
    );
    const credentialPreflight = source.indexOf("!process.env.DEEPSEEK_API_KEY?.trim()");
    const poolConstruction = source.indexOf("const pool = new Pool");

    expect(credentialPreflight).toBeGreaterThan(0);
    expect(poolConstruction).toBeGreaterThan(credentialPreflight);
    expect(source).toContain("database_writes: 0");
    expect(source).toContain("createPostgresRepository");
    expect(source).toContain("createPostgresRunQueue");
    expect(source).toContain("createPostgresRunEventStore");
    expect(source).toContain("createPostgresFalcon24ModelCertificationStageStore");
    expect(source).toContain("runCredentialedProviderCertification");
    expect(source).not.toContain("MOONSHOT_API_KEY");
  });

  it("authorizes production profiles through the dedicated current-profile resolver", async () => {
    const source = await readFile(
      new URL("../src/providers/production-run-bound-provider-dispatcher.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("resolveCurrentExecutionCertification");
    expect(source).not.toContain("createPostgresModelCertificationReceiptStore");
    expect(source).not.toContain("repository.resolveArtifact");
  });
});
