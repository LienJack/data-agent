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
});
