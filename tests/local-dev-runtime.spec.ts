import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyLocalSuperadminAuthority,
  buildLocalApplicationProcessSpecs,
  isLocalSuperadminSyncEnabled,
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
  it("默认 Compose 启用本地基础设施，deploy profile 启用完整长期服务", () => {
    expect(composeServices()).toEqual(["neo4j", "postgres", "python-sandbox"]);
    expect(composeServices("--profile", "deploy")).toEqual([
      "clamav",
      "neo4j",
      "postgres",
      "python-sandbox",
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
    expect(merged.WORKSPACE_DEPLOYMENT_ID).toBe(merged.SEMANTIC_DEPLOYMENT_ID);
    expect(merged.BETTER_AUTH_SECRET).toHaveLength(45);
  });

  it("默认允许并投影随项目分发的 E-commerce 语义域", () => {
    const merged = mergeLocalDevelopmentEnvironment();

    expect(merged.SEMANTIC_ALLOWED_DOMAINS?.split(",")).toContain("ecommerce");
    expect(merged.SEMANTIC_RELATIONSHIP_DOMAINS?.split(",")).toContain("ecommerce");
  });

  it("完整部署启用 Semantic Explorer 与可回退的关系索引", () => {
    const environment = deploymentComposeConfig().services.web.environment;
    expect(environment.SEMANTIC_EXPLORER_ENABLED).toBe("true");
    expect(environment.SEMANTIC_RELATIONSHIP_INDEX_ENABLED).toBe("true");
    expect(environment.SEMANTIC_ALLOWED_DOMAINS.split(",")).toContain("ecommerce");
  });

  it("四个本地应用命令均为 watch/dev 入口，不执行 Docker 应用容器", () => {
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
      {
        name: "semantic-authoring",
        command: "pnpm",
        args: ["--filter", "@data-agent/worker", "dev:semantic-authoring"],
      },
    ]);
  });

  it("仅显式 YES 启用管理员同步，并只在内存环境绑定数据库返回的主体", () => {
    expect(isLocalSuperadminSyncEnabled({ DATA_AGENT_LOCAL_SUPERADMIN_SYNC: "YES" })).toBe(true);
    expect(isLocalSuperadminSyncEnabled({ DATA_AGENT_LOCAL_SUPERADMIN_SYNC: "true" })).toBe(false);
    const bound = applyLocalSuperadminAuthority(
      { WORKER_TENANT_ID: "old-tenant", WORKER_PRINCIPAL_ID: "old-principal" },
      {
        terminal: "SUCCEEDED",
        reason_code: "DEV_SUPERADMIN_SYNC_UNCHANGED",
        workspace_id: "00000000-0000-4000-8000-00000000aa11",
        principal_id: "00000000-0000-4000-8000-000000001001",
      },
    );
    expect(bound.WORKER_TENANT_ID).toBe("00000000-0000-4000-8000-00000000aa11");
    expect(bound.WORKER_PRINCIPAL_ID).toBe("00000000-0000-4000-8000-000000001001");
    expect(bound.SEMANTIC_PRINCIPAL_ID).toBe(bound.WORKER_PRINCIPAL_ID);
    expect(bound.TEST_CENTER_PRINCIPAL_ID).toBe(bound.WORKER_PRINCIPAL_ID);
  });

  it("Worker 镜像执行真正 daemon 入口", () => {
    const dockerfile = readFileSync(`${repositoryRoot}/infra/docker/Dockerfile.worker`, "utf8");
    expect(dockerfile).toContain('CMD ["node", "apps/worker/dist/run-worker-cli.js"]');
    expect(dockerfile).not.toContain('CMD ["node", "apps/worker/dist/index.js"]');
  });

  it("从每个迁移的固定 ledger 声明读取版本与 checksum", () => {
    const migrations = readExpectedMigrations(repositoryRoot);
    expect(migrations).toHaveLength(74);
    expect(migrations[0]).toMatchObject({
      owner_kind: "platform",
      app_id: null,
      migration_version: "20260725000100_platform_foundation",
    });
    expect(migrations.at(-1)).toMatchObject({
      owner_kind: "app",
      app_id: "00000000-0000-4000-8000-00000000da01",
      migration_version: "20260725010670_app_data_agent_atomic_team_acceptance",
    });
  });

  it("空库 runner 为 vanilla PostgreSQL 和三条维护迁移注入显式本地绑定", () => {
    const runner = readFileSync(`${repositoryRoot}/infra/docker/init-db.sh`, "utf8");
    expect(runner).toContain("bootstrap_local_postgres_compatibility");
    for (const version of ["10590", "10600", "10610"]) {
      const prelude = `${version}-local-maintenance-prelude.sql`;
      expect(runner).toContain(prelude);
      expect(
        readFileSync(
          `${repositoryRoot}/infra/supabase/apps/data-agent/migration-support/${prelude}`,
          "utf8",
        ),
      ).toContain("transaction_timeout");
    }
  });
});
