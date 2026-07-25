import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";

export type WorkspaceRole =
  | "contracts"
  | "text2sql"
  | "research"
  | "evals"
  | "agent-runtime"
  | "platform"
  | "app";

export const WORKSPACE_ROLE_BY_DIRECTORY: Readonly<Record<string, WorkspaceRole>> = {
  "packages/contracts": "contracts",
  "packages/text2sql": "text2sql",
  "packages/research": "research",
  "packages/evals": "evals",
  "packages/agent-runtime": "agent-runtime",
  "packages/platform": "platform",
  "apps/web": "app",
  "apps/worker": "app",
};

export const ALLOWED_ROLE_DEPENDENCIES: Readonly<Record<WorkspaceRole, readonly WorkspaceRole[]>> =
  {
    contracts: [],
    text2sql: ["contracts"],
    research: ["contracts"],
    evals: ["contracts"],
    "agent-runtime": ["contracts"],
    platform: ["contracts"],
    app: ["contracts", "agent-runtime", "platform", "text2sql", "research", "evals"],
  };

const workspaceRoots = ["apps", "packages"] as const;
const runtimeDependencyFields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const allDependencyFields = [...runtimeDependencyFields, "devDependencies"] as const;
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const contractsRuntimeAllowlist = new Set(["zod"]);
const domainRoles = new Set<WorkspaceRole>(["text2sql", "research", "evals"]);
const forbiddenDomainRuntimePackages = [
  "@mastra",
  "@redis",
  "@supabase",
  "@upstash/redis",
  "data_agent_sandbox",
  "ioredis",
  "next",
  "redis",
] as const;

type DependencyField = (typeof allDependencyFields)[number];
type JsonObject = Record<string, unknown>;

export interface WorkspaceModule {
  readonly absolutePath: string;
  readonly allDependencies: readonly string[];
  readonly manifestPath: string;
  readonly name: string;
  readonly relativePath: string;
  readonly role: WorkspaceRole | undefined;
  readonly runtimeDependencies: readonly string[];
}

export interface WorkspaceSource {
  readonly moduleName: string;
  readonly path: string;
  readonly source: string;
}

export interface ModuleImportScan {
  readonly moduleSpecifiers: readonly string[];
  readonly nonLiteralModuleLoads: readonly ("import" | "require")[];
}

export interface ArchitectureViolation {
  readonly code:
    | "CIRCULAR_INTERNAL_DEPENDENCY"
    | "CONTRACTS_RUNTIME_DEPENDENCY"
    | "CONTRACTS_SOURCE_DEPENDENCY"
    | "DUPLICATE_WORKSPACE_NAME"
    | "FORBIDDEN_ROLE_DEPENDENCY"
    | "FORBIDDEN_ROLE_RUNTIME_DEPENDENCY"
    | "FORBIDDEN_ROLE_SOURCE_DEPENDENCY"
    | "NON_LITERAL_MODULE_LOAD"
    | "UNDECLARED_INTERNAL_DEPENDENCY"
    | "UNKNOWN_INTERNAL_DEPENDENCY"
    | "UNKNOWN_WORKSPACE_MODULE";
  readonly dependency?: string;
  readonly file?: string;
  readonly message: string;
  readonly module: string;
}

interface ScannerToken {
  readonly kind: SyntaxKind;
  readonly value: string;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "").replace(/\/$/, "");
}

function dependencyNames(manifest: JsonObject, fields: readonly DependencyField[]): string[] {
  const names = new Set<string>();

  for (const field of fields) {
    const dependencies = manifest[field];
    if (!isJsonObject(dependencies)) {
      continue;
    }
    for (const name of Object.keys(dependencies)) {
      names.add(name);
    }
  }

  return [...names].sort();
}

function parseWorkspaceModule(repoRoot: string, modulePath: string): WorkspaceModule {
  const manifestPath = join(modulePath, "package.json");
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isJsonObject(parsed) || typeof parsed.name !== "string" || parsed.name.length === 0) {
    throw new Error(`${manifestPath} 必须声明非空 package name。`);
  }

  const relativePath = normalizeRelativePath(relative(repoRoot, modulePath));
  return {
    absolutePath: modulePath,
    allDependencies: dependencyNames(parsed, allDependencyFields),
    manifestPath,
    name: parsed.name,
    relativePath,
    role: WORKSPACE_ROLE_BY_DIRECTORY[relativePath],
    runtimeDependencies: dependencyNames(parsed, runtimeDependencyFields),
  };
}

export function discoverWorkspaceModules(repoRoot: string): WorkspaceModule[] {
  return workspaceRoots
    .flatMap((rootName) => {
      const root = join(repoRoot, rootName);
      if (!existsSync(root)) {
        return [];
      }

      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name))
        .filter((modulePath) => existsSync(join(modulePath, "package.json")))
        .map((modulePath) => parseWorkspaceModule(repoRoot, modulePath));
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function collectSourceFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }
    return sourceExtensions.has(extname(path)) ? [path] : [];
  });
}

function* readWorkspaceSources(modules: readonly WorkspaceModule[]): Iterable<WorkspaceSource> {
  for (const module of modules) {
    for (const path of collectSourceFiles(join(module.absolutePath, "src"))) {
      yield {
        moduleName: module.name,
        path,
        source: readFileSync(path, "utf8"),
      };
    }
  }
}

function isLiteralModuleSpecifier(token: ScannerToken | undefined): boolean {
  return (
    token?.kind === SyntaxKind.StringLiteral ||
    token?.kind === SyntaxKind.NoSubstitutionTemplateLiteral
  );
}

function isRequireToken(token: ScannerToken | undefined): boolean {
  return (
    token?.kind === SyntaxKind.RequireKeyword ||
    (token?.kind === SyntaxKind.Identifier && token.value === "require")
  );
}

function scanCall(
  tokens: readonly ScannerToken[],
  openParenIndex: number,
  kind: "import" | "require",
  moduleSpecifiers: Set<string>,
  nonLiteralModuleLoads: Array<"import" | "require">,
): void {
  const argument = tokens[openParenIndex + 1];
  const afterArgument = tokens[openParenIndex + 2];
  const hasLiteralSpecifier =
    isLiteralModuleSpecifier(argument) &&
    (afterArgument?.kind === SyntaxKind.CloseParenToken ||
      afterArgument?.kind === SyntaxKind.CommaToken);

  if (hasLiteralSpecifier && argument) {
    moduleSpecifiers.add(argument.value);
    return;
  }

  nonLiteralModuleLoads.push(kind);
}

function findRequireCallOpenParen(
  tokens: readonly ScannerToken[],
  requireIndex: number,
): number | undefined {
  let cursor = requireIndex + 1;
  if (tokens[cursor]?.kind === SyntaxKind.QuestionDotToken) {
    cursor += 1;
  }
  while (tokens[cursor]?.kind === SyntaxKind.CloseParenToken) {
    cursor += 1;
  }
  return tokens[cursor]?.kind === SyntaxKind.OpenParenToken ? cursor : undefined;
}

export function scanModuleImports(source: string): ModuleImportScan {
  const scanner = createScanner(true, LanguageVariant.JSX, source);
  const tokens: ScannerToken[] = [];

  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    tokens.push({ kind, value: scanner.getTokenValue() });
  }

  const moduleSpecifiers = new Set<string>();
  const nonLiteralModuleLoads: Array<"import" | "require"> = [];

  for (const [index, token] of tokens.entries()) {
    if (
      token.kind === SyntaxKind.ImportKeyword &&
      tokens[index + 1]?.kind === SyntaxKind.OpenParenToken
    ) {
      scanCall(tokens, index + 1, "import", moduleSpecifiers, nonLiteralModuleLoads);
    } else if (isRequireToken(token)) {
      const openParenIndex = findRequireCallOpenParen(tokens, index);
      if (openParenIndex !== undefined) {
        scanCall(tokens, openParenIndex, "require", moduleSpecifiers, nonLiteralModuleLoads);
      }
    }

    if (!isLiteralModuleSpecifier(token)) {
      continue;
    }

    const previous = tokens[index - 1];
    if (previous?.kind === SyntaxKind.ImportKeyword || previous?.kind === SyntaxKind.FromKeyword) {
      moduleSpecifiers.add(token.value);
    }
  }

  return {
    moduleSpecifiers: [...moduleSpecifiers],
    nonLiteralModuleLoads,
  };
}

function packageNameFromSpecifier(specifier: string): string {
  if (!specifier.startsWith("@")) {
    return specifier.split("/")[0] ?? specifier;
  }
  return specifier.split("/").slice(0, 2).join("/");
}

function isForbiddenDomainRuntimePackage(specifier: string): boolean {
  const packageName = packageNameFromSpecifier(specifier);
  return forbiddenDomainRuntimePackages.some(
    (forbidden) => packageName === forbidden || packageName.startsWith(`${forbidden}/`),
  );
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || isAbsolute(specifier) || specifier.startsWith("file:");
}

function isPathWithin(path: string, root: string): boolean {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  );
}

function findImportedWorkspaceModule(
  specifier: string,
  sourcePath: string,
  modules: readonly WorkspaceModule[],
  moduleByName: ReadonlyMap<string, WorkspaceModule>,
): WorkspaceModule | undefined {
  for (const [name, module] of moduleByName) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      return module;
    }
  }

  if (!isLocalSpecifier(specifier)) {
    return undefined;
  }

  const importedPath = specifier.startsWith("file:")
    ? resolve(dirname(sourcePath), specifier.slice("file:".length))
    : resolve(dirname(sourcePath), specifier);
  return modules.find((module) => isPathWithin(importedPath, module.absolutePath));
}

function addViolation(
  violations: ArchitectureViolation[],
  seen: Set<string>,
  violation: ArchitectureViolation,
): void {
  const key = [
    violation.code,
    violation.module,
    violation.dependency ?? "",
    violation.file ?? "",
  ].join("\u0000");
  if (!seen.has(key)) {
    seen.add(key);
    violations.push(violation);
  }
}

function addInternalDependency(
  source: WorkspaceModule,
  target: WorkspaceModule,
  graph: Map<string, Set<string>>,
  violations: ArchitectureViolation[],
  seen: Set<string>,
  file?: string,
): void {
  graph.get(source.name)?.add(target.name);
  if (!source.role || !target.role) {
    return;
  }

  if (!ALLOWED_ROLE_DEPENDENCIES[source.role].includes(target.role)) {
    addViolation(violations, seen, {
      code: "FORBIDDEN_ROLE_DEPENDENCY",
      dependency: target.name,
      ...(file ? { file } : {}),
      message: `${source.relativePath} (${source.role}) 不得依赖 ${target.relativePath} (${target.role})。`,
      module: source.name,
    });
  }
}

function detectCycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const visit = (name: string): void => {
    state.set(name, "visiting");
    stack.push(name);

    for (const dependency of graph.get(name) ?? []) {
      const dependencyState = state.get(dependency);
      if (dependencyState === "visiting") {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = [...new Set(cycle)].sort().join("\u0000");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      } else if (dependencyState !== "visited") {
        visit(dependency);
      }
    }

    stack.pop();
    state.set(name, "visited");
  };

  for (const name of graph.keys()) {
    if (!state.has(name)) {
      visit(name);
    }
  }

  return cycles;
}

export function validateWorkspaceModules(
  modules: readonly WorkspaceModule[],
  sources: Iterable<WorkspaceSource> = [],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const seen = new Set<string>();
  const moduleByName = new Map<string, WorkspaceModule>();

  for (const module of modules) {
    const existing = moduleByName.get(module.name);
    if (existing) {
      addViolation(violations, seen, {
        code: "DUPLICATE_WORKSPACE_NAME",
        file: module.manifestPath,
        message: `${module.name} 同时由 ${existing.relativePath} 与 ${module.relativePath} 声明。`,
        module: module.name,
      });
    } else {
      moduleByName.set(module.name, module);
    }

    if (!module.role) {
      addViolation(violations, seen, {
        code: "UNKNOWN_WORKSPACE_MODULE",
        file: module.manifestPath,
        message: `${module.relativePath} 没有显式 WorkspaceRole。`,
        module: module.name,
      });
    }
  }

  const graph = new Map(modules.map((module) => [module.name, new Set<string>()]));

  for (const module of modules) {
    for (const dependency of module.allDependencies) {
      const target = moduleByName.get(dependency);
      if (target) {
        addInternalDependency(module, target, graph, violations, seen, module.manifestPath);
      } else if (dependency.startsWith("@data-agent/")) {
        addViolation(violations, seen, {
          code: "UNKNOWN_INTERNAL_DEPENDENCY",
          dependency,
          file: module.manifestPath,
          message: `${module.relativePath} 声明了不存在的内部包 ${dependency}。`,
          module: module.name,
        });
      }
    }

    if (module.role !== "contracts") {
      if (module.role && domainRoles.has(module.role)) {
        for (const dependency of module.runtimeDependencies) {
          if (!isForbiddenDomainRuntimePackage(dependency)) {
            continue;
          }
          addViolation(violations, seen, {
            code: "FORBIDDEN_ROLE_RUNTIME_DEPENDENCY",
            dependency,
            file: module.manifestPath,
            message: `${module.relativePath} 不得直接依赖 Runtime/Platform SDK ${dependency}。`,
            module: module.name,
          });
        }
      }
    } else {
      for (const dependency of module.runtimeDependencies) {
        if (
          moduleByName.has(dependency) ||
          contractsRuntimeAllowlist.has(packageNameFromSpecifier(dependency))
        ) {
          continue;
        }
        addViolation(violations, seen, {
          code: "CONTRACTS_RUNTIME_DEPENDENCY",
          dependency,
          file: module.manifestPath,
          message: `contracts 的第三方 runtime dependency 仅允许 zod，发现 ${dependency}。`,
          module: module.name,
        });
      }
    }
  }

  for (const source of sources) {
    const module = moduleByName.get(source.moduleName);
    if (!module) {
      throw new Error(`${source.path} 关联了未发现的 Workspace Package ${source.moduleName}。`);
    }

    const scan = scanModuleImports(source.source);
    for (const moduleLoad of scan.nonLiteralModuleLoads) {
      addViolation(violations, seen, {
        code: "NON_LITERAL_MODULE_LOAD",
        file: source.path,
        message: `${source.path} 使用了非字面量 ${moduleLoad}，依赖边界无法静态证明，必须失败关闭。`,
        module: module.name,
      });
    }

    for (const specifier of scan.moduleSpecifiers) {
      const target = findImportedWorkspaceModule(specifier, source.path, modules, moduleByName);
      if (target) {
        if (target.name === module.name) {
          continue;
        }
        addInternalDependency(module, target, graph, violations, seen, source.path);
        if (!module.allDependencies.includes(target.name)) {
          addViolation(violations, seen, {
            code: "UNDECLARED_INTERNAL_DEPENDENCY",
            dependency: target.name,
            file: source.path,
            message: `${module.relativePath} 导入 ${target.name}，但 manifest 未声明该依赖。`,
            module: module.name,
          });
        }
        continue;
      }

      if (specifier.startsWith("@data-agent/")) {
        addViolation(violations, seen, {
          code: "UNKNOWN_INTERNAL_DEPENDENCY",
          dependency: specifier,
          file: source.path,
          message: `${source.path} 导入了未发现的内部包 ${specifier}。`,
          module: module.name,
        });
        continue;
      }

      if (
        module.role === "contracts" &&
        !isLocalSpecifier(specifier) &&
        !isBuiltin(specifier) &&
        !contractsRuntimeAllowlist.has(packageNameFromSpecifier(specifier))
      ) {
        addViolation(violations, seen, {
          code: "CONTRACTS_SOURCE_DEPENDENCY",
          dependency: specifier,
          file: source.path,
          message: `contracts 源码仅可导入 zod 或 Node builtin，发现 ${specifier}。`,
          module: module.name,
        });
      } else if (
        module.role &&
        domainRoles.has(module.role) &&
        isForbiddenDomainRuntimePackage(specifier)
      ) {
        addViolation(violations, seen, {
          code: "FORBIDDEN_ROLE_SOURCE_DEPENDENCY",
          dependency: specifier,
          file: source.path,
          message: `${module.relativePath} 不得直接导入 Runtime/Platform SDK ${specifier}。`,
          module: module.name,
        });
      }
    }
  }

  for (const cycle of detectCycles(graph)) {
    addViolation(violations, seen, {
      code: "CIRCULAR_INTERNAL_DEPENDENCY",
      dependency: cycle.join(" -> "),
      message: `Workspace 内部依赖形成循环：${cycle.join(" -> ")}。`,
      module: cycle[0] ?? "workspace",
    });
  }

  return violations.sort((left, right) =>
    [left.code, left.module, left.file ?? "", left.dependency ?? ""]
      .join("\u0000")
      .localeCompare(
        [right.code, right.module, right.file ?? "", right.dependency ?? ""].join("\u0000"),
      ),
  );
}

export function validateWorkspaceArchitecture(repoRoot: string): ArchitectureViolation[] {
  const modules = discoverWorkspaceModules(repoRoot);
  return validateWorkspaceModules(modules, readWorkspaceSources(modules));
}

function isBarePackageFilter(filter: string): boolean {
  return !filter.includes("...") && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filter);
}

export function normalizeWorkspaceFilter(
  filter: string,
  modules: readonly WorkspaceModule[],
): string {
  if (!isBarePackageFilter(filter)) {
    return filter;
  }

  const matchingModules = modules.filter(
    (module) =>
      basename(module.relativePath) === filter ||
      module.name === filter ||
      module.name === `@data-agent/${filter}`,
  );
  if (matchingModules.length > 1) {
    throw new Error(
      `裸 Filter ${filter} 同时匹配 ${matchingModules.map((module) => module.name).join(", ")}。`,
    );
  }

  return matchingModules[0]?.name ?? `@data-agent/${filter}`;
}
