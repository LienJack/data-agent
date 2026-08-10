import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildLocalApplicationProcessSpecs,
  mergeLocalDevelopmentEnvironment,
  readExpectedMigrations,
} from "../scripts/local-dev-runtime.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function composeServices(...args: string[]): string[] {
  return execFileSync("docker", ["compose", ...args, "config", "--services"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

function deploymentComposeConfig(): {
  services: { web: { environment: Record<string, string> } };
} {
  return JSON.parse(
    execFileSync("docker", ["compose", "--profile", "deploy", "config", "--format", "json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  ) as { services: { web: { environment: Record<string, string> } } };
}

describe("local development runtime modes", () => {
  it("默认 Compose 只启用 PostgreSQL 与 Neo4j，deploy profile 启用五个长期服务", () => {
    expect(composeServices()).toEqual(["neo4j", "postgres"]);
    expect(composeServices("--profile", "deploy")).toEqual([
      "neo4j",
      "postgres",
      "relationship-indexer",
      "web",
      "worker",
    ]);
  });

  it("本地环境按显式进程环境 > .env.local > .env > 安全默认值合并", () => {
    const merged = mergeLocalDevelopmentEnvironment({
      processEnvironment: {
        SEMANTIC_ALLOWED_DOMAINS: "explicit",
        DeepSeekAPIKey: "legacy-deepseek",
        KimiAPIKey: "legacy-kimi",
      },
      dotenv: {
        SEMANTIC_ALLOWED_DOMAINS: "dotenv",
        NEO4J_PASSWORD: "dotenv-password",
      },
      dotenvLocal: {
        SEMANTIC_ALLOWED_DOMAINS: "dotenv-local",
      },
    });

    expect(merged.DATABASE_URL).toBe("postgres://postgres:postgres@127.0.0.1:5432/data_agent");
    expect(merged.NEO4J_URI).toBe("bolt://127.0.0.1:7687");
    expect(merged.SEMANTIC_EXPLORER_ENABLED).toBe("true");
    expect(merged.SEMANTIC_ALLOWED_DOMAINS).toBe("explicit");
    expect(merged.NEO4J_PASSWORD).toBe("dotenv-password");
    expect(merged.DEEPSEEK_API_KEY).toBe("legacy-deepseek");
    expect(merged.MOONSHOT_API_KEY).toBe("legacy-kimi");
    expect(merged.WORKER_DEPLOYMENT_ID).toBe(merged.SEMANTIC_DEPLOYMENT_ID);
  });

  it("完整部署启用 Semantic Explorer 与可回退的关系索引", () => {
    const environment = deploymentComposeConfig().services.web.environment;
    expect(environment.SEMANTIC_EXPLORER_ENABLED).toBe("true");
    expect(environment.SEMANTIC_RELATIONSHIP_INDEX_ENABLED).toBe("true");
  });

  it("三个本地应用命令均为 watch/dev 入口，不执行 Docker 应用容器", () => {
    expect(buildLocalApplicationProcessSpecs()).toEqual([
      {
        name: "web",
        command: "pnpm",
        args: ["--filter", "@data-agent/web", "dev"],
      },
      {
        name: "worker",
        command: "pnpm",
        args: ["--filter", "@data-agent/worker", "dev"],
      },
      {
        name: "indexer",
        command: "pnpm",
        args: ["--filter", "@data-agent/worker", "dev:indexer"],
      },
    ]);
  });

  it("Worker 镜像执行真正 daemon 入口", () => {
    const dockerfile = readFileSync(`${repositoryRoot}/infra/docker/Dockerfile.worker`, "utf8");
    expect(dockerfile).toContain('CMD ["node", "apps/worker/dist/run-worker-cli.js"]');
    expect(dockerfile).not.toContain('CMD ["node", "apps/worker/dist/index.js"]');
  });

  it("从每个迁移的固定 ledger 声明读取版本与 checksum", () => {
    const migrations = readExpectedMigrations(repositoryRoot);
    expect(migrations).toHaveLength(29);
    expect(migrations[0]).toMatchObject({
      owner_kind: "platform",
      app_id: null,
      migration_version: "20260725000100_platform_foundation",
    });
    expect(migrations.at(-1)).toMatchObject({
      owner_kind: "app",
      app_id: "00000000-0000-4000-8000-00000000da01",
      migration_version: "20260725010625_app_data_agent_semantic_relationship_index",
    });
  });
});
