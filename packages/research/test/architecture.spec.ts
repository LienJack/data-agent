import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

function moduleSpecifiers(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/\b(?:from\s+|import\s*)["']([^"']+)["']/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function localDependencyPaths(path: string): string[] {
  return moduleSpecifiers(path).flatMap((specifier) => {
    if (!specifier.startsWith(".")) return [];
    const target = resolve(dirname(path), specifier);
    return [target.endsWith(".js") ? `${target.slice(0, -3)}.ts` : target];
  });
}

function findOwnerDependencyCycle(
  graph: ReadonlyMap<string, readonly string[]>,
): readonly string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (owner: string): readonly string[] | null => {
    if (visiting.has(owner)) {
      const cycleStart = stack.indexOf(owner);
      return [...stack.slice(cycleStart), owner];
    }
    if (visited.has(owner)) return null;

    visiting.add(owner);
    stack.push(owner);
    for (const dependency of graph.get(owner) ?? []) {
      const cycle = visit(dependency);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    visiting.delete(owner);
    visited.add(owner);
    return null;
  };

  for (const owner of graph.keys()) {
    const cycle = visit(owner);
    if (cycle !== null) return cycle;
  }
  return null;
}

describe("@data-agent/research 架构边界", () => {
  it("运行时依赖只能是 @data-agent/contracts，并仅开放 root/server 两个入口", () => {
    const manifest = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8")) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
      scripts?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["@data-agent/contracts"]);
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([".", "./server"]);
    expect(manifest.scripts?.["test:research"]).toContain("vitest run");
    expect(manifest.scripts?.["test:architecture"]).toContain(
      "vitest run test/architecture.spec.ts",
    );
  });

  it("递归扫描全部源码，不直接导入 Runtime、Platform、Text2SQL、Mastra 或数据库 SDK", () => {
    const source = sourceFiles(`${packageRoot}/src`)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const forbidden of [
      "@mastra/",
      "@supabase/",
      "@upstash/",
      "@data-agent/agent-runtime",
      "@data-agent/platform",
      "@data-agent/text2sql",
      "@data-agent/worker",
      'from "pg"',
      'from "postgres"',
      "createClient(",
      "new PrismaClient",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("没有 Platform/Worker/Public READY 数据库副作用，根级门禁已真实注册", () => {
    const productionSource = sourceFiles(`${packageRoot}/src`)
      .filter((path) => !path.endsWith("controlled-fixture.ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const forbiddenEffect of [
      "commitPublicTerminal",
      "persistCurrentReadiness",
      "issueRunGrant",
      "INSERT INTO",
      "UPDATE run",
      "supabase.from(",
    ]) {
      expect(productionSource).not.toContain(forbiddenEffect);
    }
    const rootManifest = JSON.parse(readFileSync(`${workspaceRoot}/package.json`, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const turbo = JSON.parse(readFileSync(`${workspaceRoot}/turbo.json`, "utf8")) as {
      tasks?: Record<string, { cache?: boolean; dependsOn?: string[] }>;
    };
    expect(rootManifest.scripts?.["test:research"]).toBe(
      "tsx scripts/run-workspace-gate.ts test:research",
    );
    expect(rootManifest.scripts?.["test:architecture"]).toBe(
      "tsx scripts/run-workspace-gate.ts test:architecture",
    );
    expect(turbo.tasks?.["test:research"]?.dependsOn).toContain("^build");
    expect(turbo.tasks?.["test:research"]?.cache).toBe(false);
    expect(turbo.tasks?.["test:architecture"]?.dependsOn).toContain("^build");
  });

  it("production source 不得跨 owner 绕过 Document-backed reducer boundary", () => {
    const internalReducers = [
      {
        name: "compileEvidencePlanFromResolvedFactsCandidate",
        owner: "planning.ts",
      },
      {
        name: "deriveCoverageStateFromResolvedFactsCandidate",
        owner: "coverage.ts",
      },
      {
        name: "deriveResearchStopDecisionFromResolvedFactsCandidate",
        owner: "stop.ts",
      },
      {
        name: "evaluateEvidenceGatesFromResolvedFacts",
        owner: "readiness/evidence-gates.ts",
        allowedCallers: ["readiness/report-ready-certificate.ts"],
      },
      {
        name: "createReportReadyCertificateFromResolvedFactsCandidate",
        owner: "readiness/report-ready-certificate.ts",
      },
    ] as const;

    const productionSources = sourceFiles(`${packageRoot}/src`);
    for (const reducer of internalReducers) {
      const ownerPath = join(packageRoot, "src", reducer.owner);
      expect(productionSources, `${reducer.name} owner 缺失`).toContain(ownerPath);
      expect(readFileSync(ownerPath, "utf8")).toMatch(
        new RegExp(`\\bfunction\\s+${reducer.name}\\s*\\(`),
      );

      const bypassingSources = productionSources
        .filter((path) => path !== ownerPath)
        .filter(
          (path) =>
            !("allowedCallers" in reducer) ||
            !reducer.allowedCallers.some(
              (allowedCaller) => path === join(packageRoot, "src", allowedCaller),
            ),
        )
        .filter((path) => new RegExp(`\\b${reducer.name}\\s*\\(`).test(readFileSync(path, "utf8")));
      expect(bypassingSources, `${reducer.name} 不得跨 owner 调用`).toEqual([]);
    }
  });

  it("Coverage Document boundary 不得用 never 擦除 resolved artifact 类型", () => {
    const coverageSource = readFileSync(`${packageRoot}/src/coverage.ts`, "utf8");
    expect(coverageSource).not.toMatch(/\.value\s+as never/);
  });

  it("通用 Document resolver 只由 internal owner 实现，领域 owner 不经 evidence-builders 门面取用", () => {
    const sourceRoot = join(packageRoot, "src");
    const documentResolutionOwner = join(sourceRoot, "internal/document-resolution.ts");
    const evidenceFacade = join(sourceRoot, "evidence-builders.ts");
    const ownerPaths = [
      join(sourceRoot, "planning.ts"),
      ...sourceFiles(join(sourceRoot, "evidence")),
      join(sourceRoot, "coverage.ts"),
      join(sourceRoot, "stop.ts"),
      join(sourceRoot, "reporting.ts"),
      ...sourceFiles(join(sourceRoot, "readiness")),
    ];

    expect(sourceFiles(sourceRoot), "typed Document resolver owner 缺失").toContain(
      documentResolutionOwner,
    );
    const documentResolutionSource = readFileSync(documentResolutionOwner, "utf8");
    expect(documentResolutionSource).toContain("resolveResearchDocumentCandidate");

    const resolverImplementations = sourceFiles(sourceRoot)
      .filter((path) => path !== documentResolutionOwner)
      .filter((path) =>
        /\bfunction\s+resolveResearchDocumentCandidate\s*\(/.test(readFileSync(path, "utf8")),
      );
    expect(
      resolverImplementations,
      "通用 Research Document resolver 不得在领域 owner 或兼容门面重复实现",
    ).toEqual([]);

    for (const ownerPath of ownerPaths) {
      const dependencies = localDependencyPaths(ownerPath);
      expect(
        dependencies,
        `${ownerPath} 必须直接依赖 typed resolver owner，不能依赖 evidence-builders 门面`,
      ).not.toContain(evidenceFacade);
      if (readFileSync(ownerPath, "utf8").includes("resolveResearchDocumentCandidate")) {
        expect(dependencies, `${ownerPath} 的 resolver 来源必须是 internal owner`).toContain(
          documentResolutionOwner,
        );
      }
    }
  });

  it("Evidence/Readiness 兼容门面只能 re-export，Artifact builder 实现不得回流巨型门面", () => {
    const sourceRoot = join(packageRoot, "src");
    for (const facade of [
      join(sourceRoot, "evidence-builders.ts"),
      join(sourceRoot, "readiness.ts"),
    ]) {
      const source = readFileSync(facade, "utf8");

      expect(moduleSpecifiers(facade).length).toBeGreaterThan(0);
      expect(source).not.toMatch(/^\s*import\b/m);
      for (const localDeclaration of [
        /^\s*(?:export\s+)?(?:async\s+)?function\b/m,
        /^\s*(?:export\s+)?(?:const|let|var|class|interface|enum|namespace)\b/m,
        /^\s*(?:export\s+)?type\s+\w+\s*=/m,
      ]) {
        expect(source).not.toMatch(localDeclaration);
      }
      const productionConsumers = sourceFiles(sourceRoot)
        .filter((path) => path !== facade)
        .filter((path) => localDependencyPaths(path).includes(facade));
      expect(
        productionConsumers,
        `${facade} 只能保留 deep-import 兼容，production owner 必须直连具体模块`,
      ).toEqual([]);
    }
  });

  it("Evidence owner 不得反向依赖 Server issuer，只能读取 internal transient assurance registry", () => {
    const sourceRoot = join(packageRoot, "src");
    const evidenceRoot = join(sourceRoot, "evidence");
    const serverRoot = join(sourceRoot, "server");
    const transientAssuranceOwner = join(sourceRoot, "internal/transient-oed-assurance.ts");
    const transientAssuranceIssuer = join(serverRoot, "oed-assurance.ts");
    const serverDependencies = sourceFiles(evidenceRoot).flatMap((path) =>
      localDependencyPaths(path)
        .filter((dependency) => dependency.startsWith(`${serverRoot}/`))
        .map((dependency) => ({ dependency, owner: path })),
    );
    const registryWriters = sourceFiles(sourceRoot)
      .filter((path) => path !== transientAssuranceOwner)
      .filter((path) =>
        /\bregisterTransientOedAssuranceMetadata\s*\(/.test(readFileSync(path, "utf8")),
      );

    expect(serverDependencies, "Evidence domain owner 不得反向依赖 Server issuer").toEqual([]);
    expect(
      localDependencyPaths(join(evidenceRoot, "oed-query.ts")),
      "OED Evidence owner 必须从 internal identity registry 做只读 lookup",
    ).toContain(transientAssuranceOwner);
    expect(registryWriters, "Transient OED registry 只能由受控 Server issuer 写入").toEqual([
      transientAssuranceIssuer,
    ]);
  });

  it("Reference identity/Scope/Set 语义只由 internal owner 实现，且不得用 as never 擦除类型", () => {
    const sourceRoot = join(packageRoot, "src");
    const referenceIdentityOwner = join(sourceRoot, "internal/reference-identity.ts");
    const productionSources = sourceFiles(sourceRoot);
    const duplicateDeclarations = productionSources
      .filter((path) => path !== referenceIdentityOwner)
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [
          ...source.matchAll(
            /\bfunction\s+(sameReferenceScope|exactReferenceSet|exactReferenceProjection)\s*\(/g,
          ),
        ].map((match) => ({ name: match[1], owner: path }));
      });
    const erasedIdentityCalls = productionSources.filter((path) =>
      /artifactReferenceIdentity\([^)]*\bas never\b[^)]*\)/.test(readFileSync(path, "utf8")),
    );

    expect(
      duplicateDeclarations,
      "Scope 与 exact-reference-set 变体必须复用 internal/reference-identity owner",
    ).toEqual([]);
    expect(
      erasedIdentityCalls,
      "artifactReferenceIdentity 调用不得用 as never 擦除 typed Reference",
    ).toEqual([]);
  });

  it("Research owner 依赖只能沿 Planning→Evidence→Coverage→Stop→Reporting→Readiness 单向流动", () => {
    const sourceRoot = join(packageRoot, "src");
    const owners = [
      { path: join(sourceRoot, "planning.ts"), layer: 0 },
      { path: join(sourceRoot, "evidence.ts"), layer: 1 },
      { path: join(sourceRoot, "evidence/shared.ts"), layer: 2 },
      { path: join(sourceRoot, "evidence/proof-replay.ts"), layer: 2 },
      { path: join(sourceRoot, "evidence/oed-query.ts"), layer: 3 },
      { path: join(sourceRoot, "evidence/claim-relation.ts"), layer: 4 },
      {
        path: join(sourceRoot, "evidence/check-support-assessment.ts"),
        layer: 5,
      },
      { path: join(sourceRoot, "coverage.ts"), layer: 6 },
      { path: join(sourceRoot, "stop.ts"), layer: 7 },
      { path: join(sourceRoot, "reporting.ts"), layer: 8 },
      { path: join(sourceRoot, "readiness/shared.ts"), layer: 9 },
      { path: join(sourceRoot, "readiness/evidence-gates.ts"), layer: 10 },
      { path: join(sourceRoot, "readiness/report-ready-certificate.ts"), layer: 11 },
    ] as const;
    const layerByOwner = new Map(owners.map(({ path, layer }) => [path, layer]));
    const ownerGraph = new Map<string, readonly string[]>();
    const modularOwnerFiles = [
      ...sourceFiles(join(sourceRoot, "evidence")),
      ...sourceFiles(join(sourceRoot, "readiness")),
    ];

    expect(
      modularOwnerFiles.filter((path) => !layerByOwner.has(path)),
      "新增 owner 必须先登记依赖层级，不能绕开单向图约束",
    ).toEqual([]);

    for (const owner of owners) {
      expect(sourceFiles(sourceRoot), `owner 文件缺失：${owner.path}`).toContain(owner.path);
      const ownerDependencies = localDependencyPaths(owner.path).filter((dependency) =>
        layerByOwner.has(dependency),
      );
      ownerGraph.set(owner.path, ownerDependencies);
      for (const dependency of ownerDependencies) {
        expect(
          layerByOwner.get(dependency),
          `${owner.path} 不得反向依赖更高层 owner ${dependency}`,
        ).toBeLessThanOrEqual(owner.layer);
      }
    }

    expect(findOwnerDependencyCycle(ownerGraph), "同层 owner 也不得形成循环依赖").toBeNull();
  });
});
