import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeBuildIdentitySchema } from "../packages/contracts/src/operations/runtime-build-identity.js";
import {
  resolveImpactedWorkspaceConsumers,
  resolveWorkspaceConsumerDependencies,
  type WorkspaceModule,
} from "../scripts/lib/workspace-architecture.js";
import {
  createWorkspaceBuildAttestation,
  parseTurboBuildDryRun,
  projectRuntimeBuildIdentities,
  readWorkspaceBuildAttestation,
  verifyWorkspaceBuildAttestation,
  WorkspaceBuildIntegrityError,
  writeWorkspaceBuildAttestation,
} from "../scripts/lib/workspace-build-integrity.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoots: string[] = [];

function workspaceModule(
  name: string,
  relativePath: string,
  allDependencies: readonly string[],
): WorkspaceModule {
  return {
    absolutePath: join("/fixture", relativePath),
    allDependencies,
    manifestPath: join("/fixture", relativePath, "package.json"),
    name,
    relativePath,
    role: relativePath.startsWith("apps/") ? "app" : "platform",
    runtimeDependencies: allDependencies,
  };
}

function turboDryRun(
  tasks: ReadonlyArray<{
    readonly packageName: string;
    readonly directory: string;
    readonly hash: string;
    readonly outputs?: readonly string[];
  }>,
) {
  return parseTurboBuildDryRun({
    version: "1",
    tasks: tasks.map((task) => ({
      taskId: `${task.packageName}#build`,
      task: "build",
      package: task.packageName,
      hash: task.hash,
      outputs: task.outputs ?? ["dist/**"],
      directory: task.directory,
      dependencies: [],
      dependents: [],
    })),
  });
}

async function createBuildFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "workspace-build-integrity-"));
  temporaryRoots.push(root);
  for (const path of [
    "packages/contracts/dist",
    "packages/platform/dist",
    "packages/platform/src",
  ]) {
    await mkdir(join(root, path), { recursive: true });
  }
  for (const [path, content] of [
    ["package.json", "{}"],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'"],
    ["pnpm-workspace.yaml", "packages: []"],
    ["turbo.json", "{}"],
    ["tsconfig.base.json", "{}"],
    [
      "packages/contracts/package.json",
      JSON.stringify({
        name: "@data-agent/contracts",
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      }),
    ],
    [
      "packages/platform/package.json",
      JSON.stringify({
        name: "@data-agent/platform",
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      }),
    ],
    ["packages/contracts/dist/index.js", "export const version = 1;"],
    ["packages/contracts/dist/index.d.ts", "export declare const version = 1;"],
    ["packages/platform/dist/index.js", "export const query = 'new';"],
    ["packages/platform/dist/index.d.ts", 'export declare const query = "new";'],
    ["packages/platform/src/index.ts", "export const query = 'new';"],
  ] as const) {
    await writeFile(join(root, path), content);
  }
  await symlink("index.js", join(root, "packages/platform/dist/current.js"));
  return root;
}

function buildDryRun(hashSuffix = "1") {
  return turboDryRun([
    {
      packageName: "@data-agent/contracts",
      directory: "packages/contracts",
      hash: hashSuffix.repeat(16),
    },
    {
      packageName: "@data-agent/platform",
      directory: "packages/platform",
      hash: `${hashSuffix.repeat(15)}2`,
    },
  ]);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("Workspace build dependency impact", () => {
  it("从唯一 Workspace graph 推导传递依赖和 shared-package 影响面", () => {
    const modules = [
      workspaceModule("@data-agent/contracts", "packages/contracts", []),
      workspaceModule("@data-agent/platform", "packages/platform", ["@data-agent/contracts"]),
      workspaceModule("@data-agent/web-only", "packages/web-only", []),
      workspaceModule("@data-agent/web", "apps/web", [
        "@data-agent/platform",
        "@data-agent/web-only",
      ]),
      workspaceModule("@data-agent/worker", "apps/worker", ["@data-agent/platform"]),
    ];
    const resolution = resolveWorkspaceConsumerDependencies(modules, [
      { consumerId: "web", moduleName: "@data-agent/web" },
      { consumerId: "worker", moduleName: "@data-agent/worker" },
      { consumerId: "relationship-indexer", moduleName: "@data-agent/worker" },
    ]);

    expect(resolution).toEqual([
      {
        consumerId: "relationship-indexer",
        moduleName: "@data-agent/worker",
        dependencyNames: ["@data-agent/contracts", "@data-agent/platform"],
      },
      {
        consumerId: "web",
        moduleName: "@data-agent/web",
        dependencyNames: ["@data-agent/contracts", "@data-agent/platform", "@data-agent/web-only"],
      },
      {
        consumerId: "worker",
        moduleName: "@data-agent/worker",
        dependencyNames: ["@data-agent/contracts", "@data-agent/platform"],
      },
    ]);
    expect(resolveImpactedWorkspaceConsumers(resolution, ["@data-agent/platform"])).toEqual([
      "relationship-indexer",
      "web",
      "worker",
    ]);
    expect(resolveImpactedWorkspaceConsumers(resolution, ["@data-agent/web-only"])).toEqual([
      "web",
    ]);
  });
});

describe("Workspace build attestation", () => {
  it("对稳定 task/output 生成可由跨层 contract 解析的 deterministic per-role identity", async () => {
    const root = await createBuildFixture();
    const before = buildDryRun();
    const after = turboDryRun(
      [...before.tasks].reverse().map((task) => ({
        packageName: task.package_name,
        directory: task.directory,
        hash: task.task_hash,
        outputs: task.outputs,
      })),
    );
    const attestation = createWorkspaceBuildAttestation({
      repoRoot: root,
      beforeBuild: before,
      afterBuild: after,
      consumers: [
        {
          consumerRole: "web",
          packageNames: ["@data-agent/platform", "@data-agent/contracts"],
        },
      ],
      builtAt: "2026-08-22T00:00:00.000Z",
      gitCommit: "a".repeat(40),
      gitDirty: true,
    });
    const [identity] = projectRuntimeBuildIdentities(attestation);

    expect(identity).toBeDefined();
    expect(runtimeBuildIdentitySchema.parse(identity)).toEqual(identity);
    expect(attestation.consumers[0]?.package_tasks.map((task) => task.package_name)).toEqual([
      "@data-agent/contracts",
      "@data-agent/platform",
    ]);
    expect(attestation.consumers[0]?.package_tasks[1]?.output_digest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );

    const nextGeneration = createWorkspaceBuildAttestation({
      repoRoot: root,
      beforeBuild: before,
      afterBuild: after,
      consumers: [
        {
          consumerRole: "web",
          packageNames: ["@data-agent/contracts", "@data-agent/platform"],
        },
      ],
      builtAt: "2026-08-22T00:00:01.000Z",
      gitCommit: "a".repeat(40),
      gitDirty: true,
    });
    expect(nextGeneration.consumers[0]?.build_id).toBe(attestation.consumers[0]?.build_id);
    expect(nextGeneration.generation_id).not.toBe(attestation.generation_id);
  });

  it("对 malformed Turbo graph 和缺失 outputs 使用稳定失败码", async () => {
    expect(() => parseTurboBuildDryRun({ tasks: "missing" })).toThrowError(
      expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_GRAPH_INVALID" }),
    );

    const root = await createBuildFixture();
    await rm(join(root, "packages/platform/dist"), { recursive: true });
    expect(() =>
      createWorkspaceBuildAttestation({
        repoRoot: root,
        beforeBuild: buildDryRun(),
        afterBuild: buildDryRun(),
        consumers: [{ consumerRole: "web", packageNames: ["@data-agent/platform"] }],
        builtAt: "2026-08-22T00:00:00.000Z",
        gitCommit: "a".repeat(40),
        gitDirty: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_OUTPUT_MISSING" }));
  });

  it("构建中 task hash 漂移时不生成新证明", async () => {
    const root = await createBuildFixture();
    expect(() =>
      createWorkspaceBuildAttestation({
        repoRoot: root,
        beforeBuild: buildDryRun("1"),
        afterBuild: buildDryRun("2"),
        consumers: [{ consumerRole: "web", packageNames: ["@data-agent/platform"] }],
        builtAt: "2026-08-22T00:00:00.000Z",
        gitCommit: "a".repeat(40),
        gitDirty: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_CHANGED_DURING_BUILD" }));
  });

  it("原子保存证明，并拒绝 stale task、篡改 output 与 truncated manifest", async () => {
    const root = await createBuildFixture();
    const attestation = createWorkspaceBuildAttestation({
      repoRoot: root,
      beforeBuild: buildDryRun(),
      afterBuild: buildDryRun(),
      consumers: [{ consumerRole: "web", packageNames: ["@data-agent/platform"] }],
      builtAt: "2026-08-22T00:00:00.000Z",
      gitCommit: "a".repeat(40),
      gitDirty: false,
    });
    const path = join(root, ".turbo/data-agent-dev/attestation.json");
    writeWorkspaceBuildAttestation(path, attestation);

    expect(readWorkspaceBuildAttestation(path)).toEqual(attestation);
    expect(
      verifyWorkspaceBuildAttestation({ repoRoot: root, attestation, currentBuild: buildDryRun() }),
    ).toEqual(attestation);

    expect(() =>
      verifyWorkspaceBuildAttestation({
        repoRoot: root,
        attestation,
        currentBuild: buildDryRun("2"),
      }),
    ).toThrowError(expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_STALE" }));

    await writeFile(join(root, "packages/platform/dist/index.js"), "tampered");
    expect(() =>
      verifyWorkspaceBuildAttestation({ repoRoot: root, attestation, currentBuild: buildDryRun() }),
    ).toThrowError(expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_OUTPUT_MISMATCH" }));

    await writeFile(path, "{");
    expect(() => readWorkspaceBuildAttestation(path)).toThrowError(
      expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_ATTESTATION_INVALID" }),
    );
    expect(readFileSync(path, "utf8")).toBe("{");
  });

  it("拒绝 resolution trace 源码已修但 dist 仍执行旧 runs.active_attempt_id", async () => {
    const root = await createBuildFixture();
    const sourcePath = join(root, "packages/platform/src/index.ts");
    const outputPath = join(root, "packages/platform/dist/index.js");
    await writeFile(sourcePath, "export const query = 'run.active_attempt_id';");
    await writeFile(outputPath, "export const query = 'run.active_attempt_id';");
    const staleAttestation = createWorkspaceBuildAttestation({
      repoRoot: root,
      beforeBuild: buildDryRun("1"),
      afterBuild: buildDryRun("1"),
      consumers: [{ consumerRole: "web", packageNames: ["@data-agent/platform"] }],
      builtAt: "2026-08-22T00:00:00.000Z",
      gitCommit: "a".repeat(40),
      gitDirty: false,
    });

    await writeFile(sourcePath, "export const query = 'from run_attempts as active_candidate';");
    expect(readFileSync(outputPath, "utf8")).toContain("run.active_attempt_id");
    expect(() =>
      verifyWorkspaceBuildAttestation({
        repoRoot: root,
        attestation: staleAttestation,
        currentBuild: buildDryRun("2"),
      }),
    ).toThrowError(expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_STALE" }));

    await writeFile(outputPath, "export const query = 'from run_attempts as active_candidate';");
    const rebuiltAttestation = createWorkspaceBuildAttestation({
      repoRoot: root,
      beforeBuild: buildDryRun("2"),
      afterBuild: buildDryRun("2"),
      consumers: [{ consumerRole: "web", packageNames: ["@data-agent/platform"] }],
      builtAt: "2026-08-22T00:00:01.000Z",
      gitCommit: "a".repeat(40),
      gitDirty: false,
    });
    expect(
      verifyWorkspaceBuildAttestation({
        repoRoot: root,
        attestation: rebuiltAttestation,
        currentBuild: buildDryRun("2"),
      }),
    ).toEqual(rebuiltAttestation);
    expect(readFileSync(outputPath, "utf8")).not.toContain("run.active_attempt_id");
  });

  it("拒绝 export 指向声明 outputs 之外或缺失的文件", async () => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, "packages/platform/package.json"),
      JSON.stringify({
        name: "@data-agent/platform",
        exports: { ".": { import: "./src/index.ts", types: "./dist/index.d.ts" } },
      }),
    );

    expect(() =>
      createWorkspaceBuildAttestation({
        repoRoot: root,
        beforeBuild: buildDryRun(),
        afterBuild: buildDryRun(),
        consumers: [{ consumerRole: "web", packageNames: ["@data-agent/platform"] }],
        builtAt: "2026-08-22T00:00:00.000Z",
        gitCommit: "a".repeat(40),
        gitDirty: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "DEV_WORKSPACE_BUILD_EXPORT_OUTSIDE_OUTPUTS" }));
  });

  it("Turbo contract 为 Web 声明最终输出并排除 cache", async () => {
    const turbo = JSON.parse(await readFile(join(repositoryRoot, "turbo.json"), "utf8")) as {
      tasks: Record<string, { outputs?: string[] }>;
    };
    expect(turbo.tasks["@data-agent/web#build"]?.outputs).toEqual([".next/**", "!.next/cache/**"]);
  });
});

it("公开错误类型保留稳定 reason code", () => {
  const error = new WorkspaceBuildIntegrityError("DEV_WORKSPACE_BUILD_STALE", "stale");
  expect(error).toMatchObject({
    name: "WorkspaceBuildIntegrityError",
    code: "DEV_WORKSPACE_BUILD_STALE",
  });
});
