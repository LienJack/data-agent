import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverWorkspaceModules,
  normalizeWorkspaceFilter,
  scanModuleImports,
  validateWorkspaceArchitecture,
  validateWorkspaceModules,
  type WorkspaceModule,
  type WorkspaceRole,
} from "../../../scripts/lib/workspace-architecture.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function workspaceModule(
  relativePath: string,
  name: string,
  role: WorkspaceRole | undefined,
  allDependencies: readonly string[] = [],
  runtimeDependencies: readonly string[] = [],
): WorkspaceModule {
  return {
    absolutePath: join(repoRoot, relativePath),
    allDependencies,
    manifestPath: join(repoRoot, relativePath, "package.json"),
    name,
    relativePath,
    role,
    runtimeDependencies,
  };
}

describe("Workspace 依赖边界", () => {
  it("从 apps/packages manifest 自动发现模块与显式角色", () => {
    const modules = discoverWorkspaceModules(repoRoot);

    expect(
      modules.map(({ name, relativePath, role }) => ({ name, relativePath, role })),
    ).toContainEqual({
      name: "@data-agent/contracts",
      relativePath: "packages/contracts",
      role: "contracts",
    });
  });

  it("未知 Package 必须失败", () => {
    const unknown = workspaceModule("packages/mystery", "@data-agent/mystery", undefined);

    expect(validateWorkspaceModules([unknown])).toEqual([
      expect.objectContaining({
        code: "UNKNOWN_WORKSPACE_MODULE",
        module: "@data-agent/mystery",
      }),
    ]);
  });

  it("执行显式角色矩阵并检测内部循环", () => {
    const contracts = workspaceModule(
      "packages/contracts",
      "@data-agent/contracts",
      "contracts",
      ["@data-agent/text2sql"],
      ["@data-agent/text2sql"],
    );
    const text2sql = workspaceModule(
      "packages/text2sql",
      "@data-agent/text2sql",
      "text2sql",
      ["@data-agent/contracts"],
      ["@data-agent/contracts"],
    );
    const research = workspaceModule(
      "packages/research",
      "@data-agent/research",
      "research",
      ["@data-agent/text2sql"],
      ["@data-agent/text2sql"],
    );
    const violations = validateWorkspaceModules([contracts, text2sql, research]);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FORBIDDEN_ROLE_DEPENDENCY",
          dependency: "@data-agent/text2sql",
          module: "@data-agent/contracts",
        }),
        expect.objectContaining({
          code: "CIRCULAR_INTERNAL_DEPENDENCY",
        }),
        expect.objectContaining({
          code: "FORBIDDEN_ROLE_DEPENDENCY",
          dependency: "@data-agent/text2sql",
          module: "@data-agent/research",
        }),
      ]),
    );
  });

  it("领域 Package 不得直接绑定 Runtime 或 Platform SDK", () => {
    const text2sql = workspaceModule(
      "packages/text2sql",
      "@data-agent/text2sql",
      "text2sql",
      [],
      ["@mastra/core"],
    );
    const sourcePath = join(text2sql.absolutePath, "src", "compiler.ts");
    const violations = validateWorkspaceModules(
      [text2sql],
      [
        {
          moduleName: text2sql.name,
          path: sourcePath,
          source: 'import { createClient } from "@supabase/supabase-js";',
        },
      ],
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FORBIDDEN_ROLE_RUNTIME_DEPENDENCY",
          dependency: "@mastra/core",
        }),
        expect.objectContaining({
          code: "FORBIDDEN_ROLE_SOURCE_DEPENDENCY",
          dependency: "@supabase/supabase-js",
        }),
      ]),
    );
  });

  it("领域 Package 不得绕过 Runtime 直接绑定 AI SDK", () => {
    const research = workspaceModule(
      "packages/research",
      "@data-agent/research",
      "research",
      [],
      ["@ai-sdk/openai", "ai"],
    );
    const sourcePath = join(research.absolutePath, "src", "agent.ts");
    const violations = validateWorkspaceModules(
      [research],
      [
        {
          moduleName: research.name,
          path: sourcePath,
          source: 'import { createAnthropic } from "@ai-sdk/anthropic";',
        },
      ],
    );

    expect(
      violations
        .filter(({ code }) => code.includes("FORBIDDEN_ROLE"))
        .map(({ dependency }) => dependency),
    ).toEqual(["@ai-sdk/openai", "ai", "@ai-sdk/anthropic"]);
  });

  it("App 组合根可消费 Semantic kernel，但 Semantic 不得反向依赖 App", () => {
    const web = workspaceModule(
      "apps/web",
      "@data-agent/web",
      "app",
      ["@data-agent/semantic"],
      ["@data-agent/semantic"],
    );
    const semanticKernel = workspaceModule("packages/semantic", "@data-agent/semantic", "semantic");
    const reverseSemantic = workspaceModule(
      "packages/semantic",
      "@data-agent/semantic",
      "semantic",
      ["@data-agent/web"],
      ["@data-agent/web"],
    );
    const appShell = workspaceModule("apps/web", "@data-agent/web", "app");

    expect(validateWorkspaceModules([web, semanticKernel])).toEqual([]);
    expect(validateWorkspaceModules([reverseSemantic, appShell])).toEqual([
      expect.objectContaining({
        code: "FORBIDDEN_ROLE_DEPENDENCY",
        dependency: "@data-agent/web",
        module: "@data-agent/semantic",
      }),
    ]);
  });

  it("contracts runtime allowlist 当前只允许 zod", () => {
    const contracts = workspaceModule(
      "packages/contracts",
      "@data-agent/contracts",
      "contracts",
      [],
      ["zod", "next", "@upstash/redis", "@redis/client"],
    );

    expect(
      validateWorkspaceModules([contracts])
        .filter(({ code }) => code === "CONTRACTS_RUNTIME_DEPENDENCY")
        .map(({ dependency }) => dependency),
    ).toEqual(["@redis/client", "@upstash/redis", "next"]);
  });

  it("扫描 bare import、字符串与无插值模板 dynamic import", () => {
    const source = `
      import next from "next";
      import { Redis } from "@upstash/redis";
      const redis = await import("redis");
      const mastra = await import(\`@mastra/core\`);
      const client = require("@redis/client");
      const computed = await import(\`next/\${segment}\`);
    `;
    const scan = scanModuleImports(source);

    expect(new Set(scan.moduleSpecifiers)).toEqual(
      new Set(["next", "@upstash/redis", "redis", "@mastra/core", "@redis/client"]),
    );
    expect(scan.nonLiteralModuleLoads).toEqual(["import"]);
  });

  it("扫描 optional、括号化与 comma-operator require 变体", () => {
    const scan = scanModuleImports(`
      const optional = require?.("next");
      const parenthesized = (require)("@upstash/redis");
      const commaOperator = (0, require)("@redis/client");
      const computed = require?.(\`redis/\${driver}\`);
    `);

    expect(new Set(scan.moduleSpecifiers)).toEqual(
      new Set(["next", "@upstash/redis", "@redis/client"]),
    );
    expect(scan.nonLiteralModuleLoads).toEqual(["require"]);
  });

  it("全 Workspace src 扫描对插值 dynamic import 失败关闭", () => {
    const contracts = workspaceModule(
      "packages/contracts",
      "@data-agent/contracts",
      "contracts",
      [],
      ["zod"],
    );
    const sourcePath = join(contracts.absolutePath, "src", "dynamic.ts");
    const violations = validateWorkspaceModules(
      [contracts],
      [
        {
          moduleName: contracts.name,
          path: sourcePath,
          source: `
            import next from "next";
            import { Redis } from "@upstash/redis";
            const redis = await import("redis");
            const mastra = await import(\`@mastra/core\`);
            const client = require("@redis/client");
            const computed = await import(\`next/\${segment}\`);
          `,
        },
      ],
    );

    expect(
      violations
        .filter(({ code }) => code === "CONTRACTS_SOURCE_DEPENDENCY")
        .map(({ dependency }) => dependency),
    ).toEqual(["@mastra/core", "@redis/client", "@upstash/redis", "next", "redis"]);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NON_LITERAL_MODULE_LOAD",
          file: sourcePath,
        }),
      ]),
    );
  });

  it("任意裸 filter 映射为 @data-agent 名称，并保留 scoped/path/Turbo pattern", () => {
    const modules = discoverWorkspaceModules(repoRoot);

    expect(normalizeWorkspaceFilter("contracts", modules)).toBe("@data-agent/contracts");
    expect(normalizeWorkspaceFilter("runtime", modules)).toBe("@data-agent/agent-runtime");
    expect(normalizeWorkspaceFilter("persistence", modules)).toBe("@data-agent/platform");
    expect(normalizeWorkspaceFilter("future-package", modules)).toBe("@data-agent/future-package");
    for (const filter of [
      "@data-agent/contracts",
      "./packages/contracts",
      "packages/contracts",
      "contracts...",
      "^contracts",
      "!contracts",
      "{packages/contracts}",
      "contracts*",
    ]) {
      expect(normalizeWorkspaceFilter(filter, modules)).toBe(filter);
    }
  });

  it("当前 Workspace 架构门禁通过", () => {
    expect(validateWorkspaceArchitecture(repoRoot)).toEqual([]);
  });
});
