import { describe, expect, it } from "vitest";
import {
  loadRunWorkerEnvironment,
  resolveRunWorkerRepositoryRoot,
} from "../src/run-worker-environment.js";

describe("run Worker root environment", () => {
  it("resolves the repository root from both root and apps/worker working directories", () => {
    expect(resolveRunWorkerRepositoryRoot("/repo")).toBe("/repo");
    expect(resolveRunWorkerRepositoryRoot("/repo/apps/worker")).toBe("/repo");
  });

  it("promotes supported provider aliases without overriding canonical keys", () => {
    const legacy = { DeepSeekAPIKey: "legacy-secret", KimiAPIKey: "legacy-kimi" };
    expect(loadRunWorkerEnvironment(legacy)).toMatchObject({
      DEEPSEEK_API_KEY: "legacy-secret",
      MOONSHOT_API_KEY: "legacy-kimi",
    });

    const canonical = {
      DEEPSEEK_API_KEY: "canonical-secret",
      DeepSeekAPIKey: "legacy-secret",
    };
    expect(loadRunWorkerEnvironment(canonical).DEEPSEEK_API_KEY).toBe("canonical-secret");
  });

  it("leaves a missing credential absent so production composition fails closed", () => {
    const loaded = loadRunWorkerEnvironment({});
    expect(loaded.DEEPSEEK_API_KEY).toBeUndefined();
    expect(JSON.stringify({ reason_code: "PROVIDER_CREDENTIAL_UNAVAILABLE" })).not.toContain(
      "secret",
    );
  });
});
