import { describe, expect, it, vi } from "vitest";
import {
  loadRuntimeEnvironment,
  normalizeRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "../src/runtime-config/index.js";

describe("runtime config boundary", () => {
  it("从 repo root、apps/web 与 apps/worker 解析同一根目录", () => {
    expect(resolveRuntimeRepositoryRoot("/repo")).toBe("/repo");
    expect(resolveRuntimeRepositoryRoot("/repo/apps/web")).toBe("/repo");
    expect(resolveRuntimeRepositoryRoot("/repo/apps/worker")).toBe("/repo");
  });

  it("规范变量优先，旧别名只补缺并返回无 secret 的诊断", () => {
    const environment = {
      DEEPSEEK_API_KEY: "canonical-deepseek",
      DeepSeekAPIKey: "legacy-deepseek",
      KimiAPIKey: "legacy-kimi",
      GLMAPIKey: "legacy-glm",
    };
    const observed = vi.fn();
    const result = normalizeRuntimeEnvironment(environment, observed);

    expect(result.environment).toMatchObject({
      DEEPSEEK_API_KEY: "canonical-deepseek",
      MOONSHOT_API_KEY: "legacy-kimi",
      ZAI_API_KEY: "legacy-glm",
    });
    expect(result.diagnostics).toEqual([
      {
        alias_name: "KimiAPIKey",
        canonical_name: "MOONSHOT_API_KEY",
        reason_code: "RUNTIME_ENV_ALIAS_PROMOTED",
      },
      {
        alias_name: "GLMAPIKey",
        canonical_name: "ZAI_API_KEY",
        reason_code: "RUNTIME_ENV_ALIAS_PROMOTED",
      },
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("legacy-");
    expect(observed).toHaveBeenCalledTimes(2);
  });

  it("Moonshot 别名优先于 Kimi 别名且缺失配置保持缺失", () => {
    const environment = { MoonshotAPIKey: "moonshot", KimiAPIKey: "kimi" };
    const result = normalizeRuntimeEnvironment(environment);

    expect(result.environment.MOONSHOT_API_KEY).toBe("moonshot");
    expect(result.environment.DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("dotenv 对同一 environment/root 幂等，并在别名归一化前执行", () => {
    const environment: NodeJS.ProcessEnv = {};
    const loadEnvConfig = vi.fn(() => {
      environment.DeepSeekAPIKey = "dotenv-secret";
    });
    const first = loadRuntimeEnvironment({
      cwd: "/repo/apps/worker",
      environment,
      load_dotenv: true,
      loadEnvConfig,
    });
    const second = loadRuntimeEnvironment({
      cwd: "/repo/apps/worker",
      environment,
      load_dotenv: true,
      loadEnvConfig,
    });

    expect(first.dotenv_loaded).toBe(true);
    expect(second.dotenv_loaded).toBe(false);
    expect(environment.DEEPSEEK_API_KEY).toBe("dotenv-secret");
    expect(loadEnvConfig).toHaveBeenCalledOnce();
    expect(loadEnvConfig).toHaveBeenCalledWith("/repo", true);
  });
});
