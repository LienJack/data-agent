import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as runtime from "../src/index.js";

describe("Agent Runtime 公共出口", () => {
  it("Package 只发布稳定根入口，不发布测试 Authority 子路径或产物", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      readonly exports: Readonly<Record<string, unknown>>;
    };

    expect(Object.keys(manifest.exports)).toEqual(["."]);
    expect(existsSync(new URL("../dist/testing", import.meta.url))).toBe(false);
  });

  it("只暴露项目稳定组合入口，不泄漏 Mastra、Provider SDK 或原始凭据工厂", () => {
    const exports = Object.keys(runtime);

    expect(exports).toContain("createLiveProviderCredentialedSmoke");
    expect(exports).toContain("createModelProviderPort");
    expect(exports).toContain("ServerModelResponseSchemaRegistry");
    expect(exports).not.toContain("Agent");
    expect(exports).not.toContain("Mastra");
    expect(exports).not.toContain("MastraTeamRuntime");
    expect(exports).not.toContain("createPersistedSubagentController");
    expect(exports).not.toContain("MastraModelProviderAdapter");
    expect(exports).not.toContain("createMastraModelExecutionBridge");
    expect(exports).not.toContain("createMastraModelExecutionBridgeForTesting");
    expect(exports).not.toContain("createOpenAI");
    expect(exports).not.toContain("createAnthropic");
    expect(exports).not.toContain("createProviderRuntimeModel");
    expect(exports).not.toContain("runProviderTransportSmokeForTesting");
    expect(exports).not.toContain("authorizeProviderCredentialedSmokeForTesting");
    expect(exports).not.toContain("authorizeLiveProviderCredentialedSmoke");
    expect(exports).not.toContain("requireCredential");
    expect(exports.filter((name) => name.toLowerCase().includes("mastra"))).toEqual([]);
  });
});
