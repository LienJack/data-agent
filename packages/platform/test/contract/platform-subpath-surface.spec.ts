import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as artifacts from "../../src/artifacts/index.js";
import * as platform from "../../src/index.js";
import * as jobs from "../../src/jobs/index.js";
import * as knowledge from "../../src/knowledge/index.js";
import * as persistence from "../../src/persistence/index.js";
import * as providers from "../../src/providers/index.js";
import * as research from "../../src/research/index.js";
import * as runs from "../../src/runs/index.js";
import * as runtimeConfig from "../../src/runtime-config/index.js";
import * as sandbox from "../../src/sandbox/index.js";
import * as semanticPostgres from "../../src/semantic-postgres/index.js";
import * as storage from "../../src/storage/index.js";
import * as tenancy from "../../src/tenancy/index.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("platform package responsibility subpaths", () => {
  it("keeps package exports aligned with source and declaration entrypoints", () => {
    const manifest = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8")) as {
      readonly exports: Readonly<
        Record<string, { readonly import: string; readonly types: string }>
      >;
    };

    for (const [specifier, target] of Object.entries(manifest.exports)) {
      expect(target.import, `${specifier} import target`).toMatch(/^\.\/dist\/.+\.js$/u);
      expect(target.types, `${specifier} declaration target`).toBe(
        target.import.replace(/\.js$/u, ".d.ts"),
      );
      const source = target.import.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts");
      expect(existsSync(`${packageRoot}/${source}`), `${specifier} source entry`).toBe(true);
    }
  });

  it("re-exports critical symbols without wrapper implementations", () => {
    expect(artifacts.buildQueryEvidenceChartDocument).toBe(
      platform.buildQueryEvidenceChartDocument,
    );
    expect(jobs.createPostgresJobQueue).toBe(platform.createPostgresJobQueue);
    expect(knowledge.createPostgresKnowledgeRegistry).toBe(
      platform.createPostgresKnowledgeRegistry,
    );
    expect(persistence.createPostgresRepository).toBe(platform.createPostgresRepository);
    expect(providers.createPostgresProviderInvocationStore).toBe(
      platform.createPostgresProviderInvocationStore,
    );
    expect(research.createPostgresResearchAuthority).toBe(platform.createPostgresResearchAuthority);
    expect(runs.createPostgresRunQueue).toBe(platform.createPostgresRunQueue);
    expect(runtimeConfig.loadRuntimeEnvironment).toBeTypeOf("function");
    expect(sandbox.createPostgresReadOnlyBenchmarkExecutor).toBe(
      platform.createPostgresReadOnlyBenchmarkExecutor,
    );
    expect(semanticPostgres.createPostgresResolvedContextRegistry).toBe(
      platform.createPostgresResolvedContextRegistry,
    );
    expect(storage.createPostgresWorkspaceFiles).toBe(platform.createPostgresWorkspaceFiles);
    expect(tenancy.createPostgresCapabilityAuthority).toBe(
      platform.createPostgresCapabilityAuthority,
    );
  });

  it("does not expose internal transaction or authority implementations", () => {
    expect(persistence).not.toHaveProperty("withAppTransaction");
    expect(tenancy).not.toHaveProperty("createDeploymentRegistry");
    expect(tenancy).not.toHaveProperty("registerLifecycleAuthority");
    expect(tenancy).not.toHaveProperty("resolveLifecycleAuthority");
  });
});
