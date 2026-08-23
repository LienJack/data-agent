import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyLocalSuperadminAuthority,
  buildLocalApplicationProcessSpecs,
  injectDockerBuildProvenance,
  isLocalSuperadminSyncEnabled,
  mergeLocalDevelopmentEnvironment,
  RecoverableWorkspaceBuildCoordinator,
  readExpectedMigrations,
  type WorkspaceBuildCoordinatorAdapter,
} from "../scripts/local-dev-runtime.js";
import { parseManagedBuildProvenance } from "../scripts/workspace-build-release.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

afterEach(() => {
  vi.useRealTimers();
});

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
  services: Record<
    "web" | "worker" | "relationship-indexer",
    { build: { args: Record<string, string> }; environment: Record<string, string> }
  >;
} {
  return JSON.parse(
    execFileSync("docker", ["compose", "--profile", "deploy", "config", "--format", "json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  ) as ReturnType<typeof deploymentComposeConfig>;
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
    expect(environment.SEMANTIC_ALLOWED_DOMAINS?.split(",")).toContain("ecommerce");
  });

  it("Docker build provenance 来自当前 checkout，缺失或非法输入失败关闭", () => {
    const environment = injectDockerBuildProvenance({});
    expect(environment.DATA_AGENT_GIT_COMMIT).toMatch(/^[a-f0-9]{7,64}$/);
    expect(environment.DATA_AGENT_GIT_DIRTY).toMatch(/^(true|false)$/);
    expect(() =>
      parseManagedBuildProvenance({ gitCommit: "UNSET", gitDirty: "UNSET" }),
    ).toThrowError("RELEASE_BUILD_GIT_COMMIT_INVALID");
  });

  it("Compose 为 Web、Worker 与 Indexer 显式绑定 build provenance 和 identity", () => {
    const config = deploymentComposeConfig();
    for (const service of ["web", "worker", "relationship-indexer"] as const) {
      expect(config.services[service].build.args).toMatchObject({
        DATA_AGENT_GIT_COMMIT: expect.any(String),
        DATA_AGENT_GIT_DIRTY: expect.any(String),
      });
    }
    expect(config.services.web.environment.DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE).toBeUndefined();
    expect(
      config.services["relationship-indexer"].environment.DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE,
    ).toBe("/app/runtime-build-identity/relationship-indexer.json");
  });

  it("四个本地应用命令均为 watch/dev 入口，不执行 Docker 应用容器", () => {
    expect(buildLocalApplicationProcessSpecs()).toEqual([
      {
        name: "web",
        consumerRole: "web",
        moduleName: "@data-agent/web",
        command: "pnpm",
        args: ["--filter", "@data-agent/web", "dev:guarded"],
      },
      {
        name: "worker",
        consumerRole: "worker",
        moduleName: "@data-agent/worker",
        command: "pnpm",
        args: ["--filter", "@data-agent/worker", "dev:guarded"],
      },
      {
        name: "indexer",
        consumerRole: "relationship-indexer",
        moduleName: "@data-agent/worker",
        command: "pnpm",
        args: ["--filter", "@data-agent/worker", "dev:guarded:indexer"],
      },
      {
        name: "semantic-authoring",
        consumerRole: "semantic-authoring",
        moduleName: "@data-agent/worker",
        command: "pnpm",
        args: ["--filter", "@data-agent/worker", "dev:guarded:semantic-authoring"],
      },
    ]);
  });

  it("package public dev scripts 回到根协调器，raw Next/tsx 只能经过 guarded entry", () => {
    const root = JSON.parse(readFileSync(`${repositoryRoot}/package.json`, "utf8")) as {
      scripts: Record<string, string>;
    };
    const web = JSON.parse(readFileSync(`${repositoryRoot}/apps/web/package.json`, "utf8")) as {
      scripts: Record<string, string>;
    };
    const worker = JSON.parse(
      readFileSync(`${repositoryRoot}/apps/worker/package.json`, "utf8"),
    ) as {
      scripts: Record<string, string>;
    };

    expect(web.scripts.dev).toBe("pnpm --dir ../.. dev:web");
    expect(root.scripts["dev:build"]).toBe("tsx scripts/local-dev-runtime.ts build");
    expect(web.scripts["dev:guarded"]).toContain("guarded-app-entry.ts web");
    expect(worker.scripts.dev).toBe("pnpm --dir ../.. dev:worker");
    expect(worker.scripts["dev:indexer"]).toBe("pnpm --dir ../.. dev:indexer");
    expect(worker.scripts["dev:semantic-authoring"]).toBe(
      "pnpm --dir ../.. dev:semantic-authoring",
    );
    for (const guarded of [
      worker.scripts["dev:guarded"],
      worker.scripts["dev:guarded:indexer"],
      worker.scripts["dev:guarded:semantic-authoring"],
    ]) {
      expect(guarded).toContain("guarded-app-entry.ts");
    }
  });

  it("guarded raw entry 在证明缺失时失败关闭，不启动应用命令", () => {
    const environment = { ...process.env };
    delete environment.DATA_AGENT_BUILD_ATTESTATION_FILE;
    delete environment.DATA_AGENT_RUNTIME_BUILD_CONSUMER_ROLE;
    delete environment.DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE;
    const result = spawnSync("pnpm", ["exec", "tsx", "scripts/guarded-app-entry.ts", "web"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "DEV_WORKSPACE_BUILD_GUARD_MISSING:DATA_AGENT_RUNTIME_BUILD_CONSUMER_ROLE",
    );
    expect(result.stderr).not.toContain("Local:");
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
    expect(dockerfile).toContain("--roles=worker,relationship-indexer,semantic-authoring");
    expect(dockerfile).toContain(
      'ENV DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE="/app/runtime-build-identity/worker.json"',
    );
    expect(dockerfile).not.toContain("attestation.json /app/runtime-build-identity");
  });

  it("从每个迁移的固定 ledger 声明读取版本与 checksum", () => {
    const migrations = readExpectedMigrations(repositoryRoot);
    expect(migrations).toHaveLength(109);
    expect(migrations[0]).toMatchObject({
      owner_kind: "platform",
      app_id: null,
      migration_version: "20260725000100_platform_foundation",
    });
    expect(migrations.at(-1)).toMatchObject({
      owner_kind: "app",
      app_id: "00000000-0000-4000-8000-00000000da01",
      migration_version: "20260725010698_app_data_agent_subagent_harness_runtime_repair",
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

describe("workspace build recovery coordinator", () => {
  type Generation = { readonly id: string };

  function adapter(input: {
    readonly events: string[];
    readonly prepare?: (roles: readonly string[]) => Promise<Generation>;
  }): WorkspaceBuildCoordinatorAdapter<string, Generation> {
    return {
      accept: async (generation, roles) => {
        input.events.push(`accept:${generation.id}:${[...roles].sort().join(",")}`);
      },
      prepare: async (roles) => {
        input.events.push(`prepare:${[...roles].sort().join(",")}`);
        return input.prepare?.(roles) ?? { id: "generation" };
      },
      start: async (roles, generation) => {
        input.events.push(`start:${generation.id}:${[...roles].sort().join(",")}`);
      },
      stop: async (roles) => {
        input.events.push(`stop:${[...roles].sort().join(",")}`);
      },
    };
  }

  it("初始 generation 在 accept 后才启动全部选中角色", async () => {
    const events: string[] = [];
    const coordinator = new RecoverableWorkspaceBuildCoordinator(
      ["web", "worker"],
      adapter({ events }),
      { debounceMs: 10 },
    );

    await coordinator.start();

    expect(events).toEqual([
      "stop:web,worker",
      "prepare:web,worker",
      "accept:generation:web,worker",
      "start:generation:web,worker",
    ]);
    expect(coordinator.state).toBe("running");
  });

  it("失效立即停 affected role；build 失败保持 blocked，显式 retry 可恢复", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let fail = false;
    let generation = 0;
    const coordinator = new RecoverableWorkspaceBuildCoordinator(
      ["web", "worker"],
      adapter({
        events,
        prepare: async () => {
          if (fail) throw new Error("BUILD_FAILED");
          generation += 1;
          return { id: `g${generation}` };
        },
      }),
      { debounceMs: 25 },
    );
    await coordinator.start();
    events.length = 0;

    fail = true;
    await coordinator.invalidate(["web"]);
    expect(events).toEqual(["stop:web"]);
    await vi.advanceTimersByTimeAsync(25);
    await coordinator.waitForIdle();
    expect(coordinator.state).toBe("blocked");
    expect(events).toEqual(["stop:web", "prepare:web"]);

    fail = false;
    await coordinator.retry();
    expect(coordinator.state).toBe("running");
    expect(events.slice(-3)).toEqual(["prepare:web", "accept:g2:web", "start:g2:web"]);
  });

  it("burst invalidation 合并为一次构建，构建中再变化会丢弃旧 generation", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let resolveBuild: ((generation: Generation) => void) | undefined;
    let prepareCount = 0;
    const coordinator = new RecoverableWorkspaceBuildCoordinator(
      ["web", "worker"],
      adapter({
        events,
        prepare: async () => {
          prepareCount += 1;
          if (prepareCount === 1) return { id: "initial" };
          if (prepareCount === 2) {
            return new Promise<Generation>((resolve) => {
              resolveBuild = resolve;
            });
          }
          return { id: "latest" };
        },
      }),
      { debounceMs: 20 },
    );
    await coordinator.start();
    events.length = 0;

    await Promise.all([coordinator.invalidate(["web"]), coordinator.invalidate(["worker"])]);
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(resolveBuild).toBeTypeOf("function"));
    await coordinator.invalidate(["web"]);
    resolveBuild?.({ id: "discarded" });
    await coordinator.waitForIdle();

    expect(events).not.toContain("accept:discarded:web,worker");
    expect(events).toContain("accept:latest:web,worker");
    expect(events.filter((event) => event.startsWith("accept:"))).toHaveLength(1);
  });

  it("shutdown 在 building 状态不接受迟到 generation，并清理全部角色", async () => {
    let resolveBuild: ((generation: Generation) => void) | undefined;
    let prepareCount = 0;
    const events: string[] = [];
    const coordinator = new RecoverableWorkspaceBuildCoordinator(
      ["web", "worker"],
      adapter({
        events,
        prepare: async () => {
          prepareCount += 1;
          if (prepareCount === 1) return { id: "initial" };
          return new Promise<Generation>((resolve) => {
            resolveBuild = resolve;
          });
        },
      }),
      { debounceMs: 0 },
    );
    await coordinator.start();
    events.length = 0;

    const invalidation = coordinator.invalidate(["web"]);
    await vi.waitFor(() => expect(resolveBuild).toBeTypeOf("function"));
    const shutdown = coordinator.shutdown();
    resolveBuild?.({ id: "late" });
    await Promise.all([invalidation, shutdown]);

    expect(coordinator.state).toBe("stopped");
    expect(events).not.toContain("accept:late:web");
    expect(events.at(-1)).toBe("stop:web,worker");
  });
});
