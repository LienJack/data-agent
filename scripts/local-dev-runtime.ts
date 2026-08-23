import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, type FSWatcher, readdirSync, readFileSync, watch } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseEnv } from "node:util";
import { normalizeRuntimeEnvironment } from "../packages/platform/src/runtime-config/index.js";
import {
  discoverWorkspaceModules,
  resolveImpactedWorkspaceConsumers,
  resolveWorkspaceConsumerDependencies,
  type WorkspaceConsumerDependencyResolution,
  type WorkspaceModule,
} from "./lib/workspace-architecture.js";
import {
  createWorkspaceBuildAttestation,
  nodeWorkspaceBuildFilesystem,
  parseTurboBuildDryRun,
  projectRuntimeBuildIdentities,
  type RuntimeBuildIdentityProjection,
  readWorkspaceBuildAttestation,
  type TurboBuildDryRun,
  verifyWorkspaceBuildAttestation,
  type WorkspaceBuildAttestation,
  writeWorkspaceBuildAttestation,
} from "./lib/workspace-build-integrity.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const LOCAL_TENANT_ID = "00000000-0000-4000-8000-000000000002";
const LOCAL_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000003";

const LOCAL_DEFAULTS = Object.freeze({
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/data_agent",
  DATA_AGENT_WORKSPACE_FILE_STORAGE_ROOT: resolve(REPOSITORY_ROOT, ".data/workspace-content"),
  SEMANTIC_GOVERNANCE_BACKEND: "postgres",
  SEMANTIC_EXPLORER_ENABLED: "true",
  SEMANTIC_DEPLOYMENT_ID: LOCAL_DEPLOYMENT_ID,
  WORKSPACE_DEPLOYMENT_ID: LOCAL_DEPLOYMENT_ID,
  BETTER_AUTH_SECRET: "data-agent-local-development-secret-change-me",
  BETTER_AUTH_URL: "http://localhost:3000",
  DATA_AGENT_ECOMMERCE_HOST: "127.0.0.1",
  DATA_AGENT_ECOMMERCE_PORT: "5432",
  DATA_AGENT_ECOMMERCE_DATABASE: "data_agent",
  DATA_AGENT_ECOMMERCE_READER_PASSWORD: "data-agent-ecommerce-demo-change-me",
  SEMANTIC_TENANT_ID: LOCAL_TENANT_ID,
  SEMANTIC_PRINCIPAL_ID: LOCAL_PRINCIPAL_ID,
  SEMANTIC_ALLOWED_DOMAINS: "revenue,customer,marketing,sales,ecommerce",
  SEMANTIC_RELATIONSHIP_INDEX_ENABLED: "true",
  SEMANTIC_RELATIONSHIP_DOMAINS: "sales,ecommerce",
  SEMANTIC_RELATIONSHIP_INDEX_HEALTH_PORT: "9090",
  WORKER_DEPLOYMENT_ID: LOCAL_DEPLOYMENT_ID,
  WORKER_TENANT_ID: LOCAL_TENANT_ID,
  WORKER_PRINCIPAL_ID: LOCAL_PRINCIPAL_ID,
  WORKER_ID: "worker-local",
  SEMANTIC_AUTHORING_WORKER_ID: "semantic-authoring-worker-local",
  WORKER_HEALTH_PORT: "9091",
  NEO4J_URI: "bolt://127.0.0.1:7687",
  NEO4J_USERNAME: "neo4j",
  NEO4J_PASSWORD: "data-agent-neo4j",
  NEO4J_DATABASE: "neo4j",
  TEST_CENTER_TENANT_ID: LOCAL_TENANT_ID,
  TEST_CENTER_PRINCIPAL_ID: LOCAL_PRINCIPAL_ID,
  TEST_CENTER_ENVIRONMENT: "local",
});

type EnvironmentLayer = Readonly<Record<string, string | undefined>>;

interface LocalSuperadminSyncResult {
  readonly terminal: "SUCCEEDED" | "SKIPPED" | "HOLD";
  readonly reason_code: string;
  readonly principal_id?: string;
  readonly workspace_id?: string;
}

export function isLocalSuperadminSyncEnabled(environment: EnvironmentLayer): boolean {
  return environment.DATA_AGENT_LOCAL_SUPERADMIN_SYNC?.trim() === "YES";
}

export function applyLocalSuperadminAuthority(
  environment: NodeJS.ProcessEnv,
  result: LocalSuperadminSyncResult,
): NodeJS.ProcessEnv {
  if (result.terminal !== "SUCCEEDED" || !result.principal_id || !result.workspace_id) {
    return environment;
  }
  return {
    ...environment,
    SEMANTIC_TENANT_ID: result.workspace_id,
    SEMANTIC_PRINCIPAL_ID: result.principal_id,
    WORKER_TENANT_ID: result.workspace_id,
    WORKER_PRINCIPAL_ID: result.principal_id,
    TEST_CENTER_TENANT_ID: result.workspace_id,
    TEST_CENTER_PRINCIPAL_ID: result.principal_id,
  };
}

export function mergeLocalDevelopmentEnvironment(
  input: Readonly<{
    processEnvironment?: EnvironmentLayer;
    dotenv?: EnvironmentLayer;
    dotenvLocal?: EnvironmentLayer;
  }> = {},
): NodeJS.ProcessEnv {
  const merged: Record<string, string> = { ...LOCAL_DEFAULTS };
  for (const layer of [input.dotenv, input.dotenvLocal, input.processEnvironment]) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  normalizeRuntimeEnvironment(merged);
  merged.WORKER_DEPLOYMENT_ID ||= merged.SEMANTIC_DEPLOYMENT_ID ?? LOCAL_DEPLOYMENT_ID;
  merged.WORKSPACE_DEPLOYMENT_ID ||= merged.SEMANTIC_DEPLOYMENT_ID ?? LOCAL_DEPLOYMENT_ID;
  merged.WORKER_TENANT_ID ||= merged.SEMANTIC_TENANT_ID ?? LOCAL_TENANT_ID;
  merged.WORKER_PRINCIPAL_ID ||= merged.SEMANTIC_PRINCIPAL_ID ?? LOCAL_PRINCIPAL_ID;
  return merged;
}

export function injectDockerBuildProvenance(
  environment: NodeJS.ProcessEnv,
  repositoryRoot = REPOSITORY_ROOT,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    DATA_AGENT_GIT_COMMIT: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    DATA_AGENT_GIT_DIRTY: String(
      execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim().length > 0,
    ),
  };
}

function readEnvironmentFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(path, "utf8"))).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function loadLocalDevelopmentEnvironment(): NodeJS.ProcessEnv {
  return mergeLocalDevelopmentEnvironment({
    dotenv: readEnvironmentFile(resolve(REPOSITORY_ROOT, ".env")),
    dotenvLocal: readEnvironmentFile(resolve(REPOSITORY_ROOT, ".env.local")),
    processEnvironment: process.env,
  });
}

export interface LocalApplicationProcessSpec {
  readonly name: "web" | "worker" | "indexer" | "semantic-authoring";
  readonly consumerRole: "web" | "worker" | "relationship-indexer" | "semantic-authoring";
  readonly moduleName: "@data-agent/web" | "@data-agent/worker";
  readonly command: "pnpm";
  readonly args: readonly string[];
}

export function buildLocalApplicationProcessSpecs(): readonly LocalApplicationProcessSpec[] {
  return [
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
  ];
}

export type WorkspaceBuildCoordinatorState =
  | "idle"
  | "building"
  | "blocked"
  | "running"
  | "stopped";

export interface WorkspaceBuildCoordinatorAdapter<Role extends string, Generation> {
  readonly prepare: (roles: readonly Role[]) => Promise<Generation>;
  readonly accept: (generation: Generation, roles: readonly Role[]) => Promise<void>;
  readonly start: (roles: readonly Role[], generation: Generation) => Promise<void>;
  readonly stop: (roles: readonly Role[]) => Promise<void>;
  readonly shutdown?: () => Promise<void>;
}

export class RecoverableWorkspaceBuildCoordinator<Role extends string, Generation> {
  readonly #roles: readonly Role[];
  readonly #roleSet: ReadonlySet<Role>;
  readonly #adapter: WorkspaceBuildCoordinatorAdapter<Role, Generation>;
  readonly #debounceMs: number;
  readonly #pending = new Set<Role>();
  readonly #blocked = new Set<Role>();
  readonly #idleWaiters = new Set<() => void>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #activeDrain: Promise<void> | undefined;
  #state: WorkspaceBuildCoordinatorState = "idle";

  constructor(
    roles: readonly Role[],
    adapter: WorkspaceBuildCoordinatorAdapter<Role, Generation>,
    options: Readonly<{ debounceMs?: number }> = {},
  ) {
    this.#roles = [...new Set(roles)].sort();
    this.#roleSet = new Set(this.#roles);
    this.#adapter = adapter;
    this.#debounceMs = options.debounceMs ?? 100;
  }

  get state(): WorkspaceBuildCoordinatorState {
    return this.#state;
  }

  async start(): Promise<void> {
    if (this.#state !== "idle") {
      throw new Error(`DEV_WORKSPACE_COORDINATOR_ALREADY_STARTED:${this.#state}`);
    }
    await this.#adapter.stop(this.#roles);
    for (const role of this.#roles) this.#pending.add(role);
    await this.#drain();
  }

  async invalidate(roles: readonly Role[]): Promise<void> {
    if (this.#state === "stopped") return;
    const affected = [...new Set(roles.filter((role) => this.#roleSet.has(role)))].sort();
    if (affected.length === 0) return;
    for (const role of affected) this.#pending.add(role);
    await this.#adapter.stop(affected);
    this.#schedule();
  }

  async retry(): Promise<void> {
    if (this.#state === "stopped") return;
    for (const role of this.#blocked) this.#pending.add(role);
    this.#blocked.clear();
    if (this.#pending.size === 0) return;
    await this.#drain();
  }

  async waitForIdle(): Promise<void> {
    if (!this.#timer && !this.#activeDrain) return;
    await new Promise<void>((resolveIdle) => this.#idleWaiters.add(resolveIdle));
  }

  async shutdown(): Promise<void> {
    if (this.#state === "stopped") return;
    this.#state = "stopped";
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#pending.clear();
    this.#blocked.clear();
    if (this.#adapter.shutdown) await this.#adapter.shutdown();
    else await this.#adapter.stop(this.#roles);
    await this.#activeDrain;
    this.#resolveIdleWaiters();
  }

  #schedule(): void {
    if (this.#activeDrain) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#drain();
    }, this.#debounceMs);
  }

  async #drain(): Promise<void> {
    if (this.#activeDrain) return this.#activeDrain;
    const drain = async (): Promise<void> => {
      while (this.#pending.size > 0 && this.#state !== "stopped") {
        const batch = [...this.#pending].sort();
        this.#pending.clear();
        this.#state = "building";
        let generation: Generation;
        try {
          generation = await this.#adapter.prepare(batch);
        } catch (error) {
          if (this.#recordFailure(batch, error) === "retry") continue;
          return;
        }
        if (this.#isStopped()) return;
        if (this.#pending.size > 0) {
          for (const role of batch) this.#pending.add(role);
          continue;
        }

        try {
          await this.#adapter.accept(generation, batch);
        } catch (error) {
          if (this.#recordFailure(batch, error) === "retry") continue;
          return;
        }
        if (this.#isStopped()) return;
        if (this.#pending.size > 0) {
          for (const role of batch) this.#pending.add(role);
          continue;
        }

        try {
          await this.#adapter.start(batch, generation);
        } catch (error) {
          await this.#adapter.stop(batch);
          if (this.#recordFailure(batch, error) === "retry") continue;
          return;
        }
        if (this.#pending.size > 0) {
          await this.#adapter.stop([...this.#pending].sort());
          for (const role of batch) this.#pending.add(role);
          continue;
        }
        this.#state = "running";
      }
    };
    this.#activeDrain = drain().finally(() => {
      this.#activeDrain = undefined;
      this.#resolveIdleWaiters();
    });
    return this.#activeDrain;
  }

  #isStopped(): boolean {
    return this.#state === "stopped";
  }

  #resolveIdleWaiters(): void {
    if (this.#timer || this.#activeDrain) return;
    for (const resolveIdle of this.#idleWaiters) resolveIdle();
    this.#idleWaiters.clear();
  }

  #recordFailure(batch: readonly Role[], error: unknown): "blocked" | "retry" | "stopped" {
    if (this.#isStopped()) return "stopped";
    if (this.#pending.size > 0) {
      for (const role of batch) this.#pending.add(role);
      return "retry";
    }
    for (const role of batch) this.#blocked.add(role);
    this.#state = "blocked";
    console.error(
      `DEV_WORKSPACE_BUILD_FAILED:${error instanceof Error ? error.message : String(error)}`,
    );
    return "blocked";
  }
}

interface PreparedLocalWorkspaceGeneration {
  readonly attestation: WorkspaceBuildAttestation;
  readonly identities: ReadonlyMap<
    LocalApplicationProcessSpec["name"],
    RuntimeBuildIdentityProjection
  >;
}

type UnexpectedApplicationExitHandler = (
  name: LocalApplicationProcessSpec["name"],
  code: number | null,
  signal: NodeJS.Signals | null,
) => void;

const WORKSPACE_BUILD_RUNTIME_DIRECTORY = resolve(REPOSITORY_ROOT, ".turbo/data-agent-dev");

function attestationPath(name: LocalApplicationProcessSpec["name"]): string {
  return resolve(WORKSPACE_BUILD_RUNTIME_DIRECTORY, `${name}.attestation.json`);
}

function identityPath(name: LocalApplicationProcessSpec["name"]): string {
  return resolve(WORKSPACE_BUILD_RUNTIME_DIRECTORY, `${name}.identity.json`);
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function waitForChildExit(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(() => {
      signalProcessGroup(child, "SIGKILL");
      resolveExit();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

class LocalWorkspaceBuildAdapter
  implements
    WorkspaceBuildCoordinatorAdapter<
      LocalApplicationProcessSpec["name"],
      PreparedLocalWorkspaceGeneration
    >
{
  readonly #specs: readonly LocalApplicationProcessSpec[];
  readonly #environment: NodeJS.ProcessEnv;
  readonly #children = new Map<LocalApplicationProcessSpec["name"], ChildProcess>();
  readonly #expectedStops = new Set<LocalApplicationProcessSpec["name"]>();
  readonly #onUnexpectedExit: UnexpectedApplicationExitHandler;
  readonly #onAccepted: () => void;
  #modules: readonly WorkspaceModule[] = [];
  #resolutions: readonly WorkspaceConsumerDependencyResolution[] = [];
  #activeTool: ChildProcess | undefined;
  #shuttingDown = false;

  constructor(
    specs: readonly LocalApplicationProcessSpec[],
    environment: NodeJS.ProcessEnv,
    onUnexpectedExit: UnexpectedApplicationExitHandler,
    onAccepted: () => void = () => undefined,
  ) {
    this.#specs = specs;
    this.#environment = environment;
    this.#onUnexpectedExit = onUnexpectedExit;
    this.#onAccepted = onAccepted;
    this.refreshGraph();
  }

  refreshGraph(): void {
    this.#modules = discoverWorkspaceModules(REPOSITORY_ROOT);
    this.#resolutions = resolveWorkspaceConsumerDependencies(
      this.#modules,
      this.#specs.map((spec) => ({ consumerId: spec.name, moduleName: spec.moduleName })),
    );
  }

  impactedConsumers(changedModuleNames: readonly string[]): LocalApplicationProcessSpec["name"][] {
    const impacted = new Set(
      resolveImpactedWorkspaceConsumers(this.#resolutions, changedModuleNames),
    );
    return this.#specs.map((spec) => spec.name).filter((name) => impacted.has(name));
  }

  watchedDependencyModules(): readonly WorkspaceModule[] {
    const dependencyNames = new Set(
      this.#resolutions.flatMap((resolution) => resolution.dependencyNames),
    );
    return this.#modules.filter((module) => dependencyNames.has(module.name));
  }

  watchedConsumerModules(): readonly WorkspaceModule[] {
    const consumerModuleNames = new Set<string>(this.#specs.map((spec) => spec.moduleName));
    return this.#modules.filter((module) => consumerModuleNames.has(module.name));
  }

  async prepare(
    roles: readonly LocalApplicationProcessSpec["name"][],
  ): Promise<PreparedLocalWorkspaceGeneration> {
    this.refreshGraph();
    const selectedSpecs = this.#specs.filter((spec) => roles.includes(spec.name));
    const selectedResolutions = this.#resolutions.filter((resolution) =>
      roles.includes(resolution.consumerId as LocalApplicationProcessSpec["name"]),
    );
    if (selectedSpecs.length !== roles.length || selectedResolutions.length !== roles.length) {
      throw new Error("DEV_WORKSPACE_BUILD_GRAPH_INVALID");
    }
    const filters = [
      ...new Set(selectedSpecs.map((spec) => `--filter=${spec.moduleName}^...`)),
    ].sort();
    const beforeBuild = await this.#dryRun(filters);
    await this.#runTurbo(["run", "build", ...filters], false);
    const afterBuild = await this.#dryRun(filters);
    const attestation = createWorkspaceBuildAttestation({
      repoRoot: REPOSITORY_ROOT,
      beforeBuild,
      afterBuild,
      consumers: selectedSpecs.map((spec) => {
        const resolution = selectedResolutions.find(
          (candidate) => candidate.consumerId === spec.name,
        );
        if (!resolution) throw new Error("DEV_WORKSPACE_BUILD_GRAPH_INVALID");
        return {
          consumerRole: spec.consumerRole,
          packageNames: resolution.dependencyNames,
        };
      }),
      builtAt: new Date().toISOString(),
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
      }).trim(),
      gitDirty:
        execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
          cwd: REPOSITORY_ROOT,
          encoding: "utf8",
        }).trim().length > 0,
    });
    const projectionByRole = new Map(
      projectRuntimeBuildIdentities(attestation).map((identity) => [
        identity.consumer_role,
        identity,
      ]),
    );
    return {
      attestation,
      identities: new Map(
        selectedSpecs.map((spec) => {
          const identity = projectionByRole.get(spec.consumerRole);
          if (!identity) throw new Error("DEV_WORKSPACE_BUILD_GRAPH_INVALID");
          return [spec.name, identity];
        }),
      ),
    };
  }

  async accept(
    generation: PreparedLocalWorkspaceGeneration,
    roles: readonly LocalApplicationProcessSpec["name"][],
  ): Promise<void> {
    for (const role of roles) {
      const identity = generation.identities.get(role);
      if (!identity) throw new Error(`DEV_WORKSPACE_BUILD_GRAPH_INVALID:${role}`);
      writeWorkspaceBuildAttestation(attestationPath(role), generation.attestation);
      nodeWorkspaceBuildFilesystem.writeTextAtomically(
        identityPath(role),
        `${JSON.stringify(identity, null, 2)}\n`,
      );
    }
    this.#onAccepted();
  }

  async start(
    roles: readonly LocalApplicationProcessSpec["name"][],
    generation: PreparedLocalWorkspaceGeneration,
  ): Promise<void> {
    for (const role of roles) {
      const spec = this.#specs.find((candidate) => candidate.name === role);
      const identity = generation.identities.get(role);
      if (!spec || !identity) throw new Error(`DEV_WORKSPACE_BUILD_GRAPH_INVALID:${role}`);
      const child = spawn(spec.command, [...spec.args], {
        cwd: REPOSITORY_ROOT,
        detached: true,
        env: {
          ...this.#environment,
          DATA_AGENT_BUILD_ATTESTATION_FILE: attestationPath(role),
          DATA_AGENT_RUNTIME_BUILD_CONSUMER_ROLE: spec.consumerRole,
          DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: identityPath(role),
        },
        stdio: "inherit",
      });
      this.#children.set(role, child);
      child.once("error", () => {
        if (!this.#expectedStops.has(role) && !this.#shuttingDown) {
          this.#onUnexpectedExit(role, 1, null);
        }
      });
      child.once("exit", (code, signal) => {
        if (this.#children.get(role) === child) this.#children.delete(role);
        if (this.#expectedStops.delete(role) || this.#shuttingDown) return;
        this.#onUnexpectedExit(role, code, signal);
      });
    }
  }

  async stop(roles: readonly LocalApplicationProcessSpec["name"][]): Promise<void> {
    await Promise.all(
      roles.map(async (role) => {
        const child = this.#children.get(role);
        if (!child) return;
        this.#expectedStops.add(role);
        signalProcessGroup(child, "SIGTERM");
        await waitForChildExit(child);
      }),
    );
  }

  async auditRunning(): Promise<LocalApplicationProcessSpec["name"][]> {
    const roles = [...this.#children.keys()].sort();
    return this.auditRoles(roles);
  }

  async auditRoles(
    roles: readonly LocalApplicationProcessSpec["name"][],
  ): Promise<LocalApplicationProcessSpec["name"][]> {
    if (roles.length === 0 || this.#activeTool) return [];
    try {
      const filters = [
        ...new Set(
          this.#specs
            .filter((spec) => roles.includes(spec.name))
            .map((spec) => `--filter=${spec.moduleName}^...`),
        ),
      ].sort();
      const currentBuild = await this.#dryRun(filters);
      return roles.filter((role) => {
        try {
          const spec = this.#specs.find((candidate) => candidate.name === role);
          if (!spec) return true;
          const attestation = readWorkspaceBuildAttestation(attestationPath(role));
          verifyWorkspaceBuildAttestation({
            repoRoot: REPOSITORY_ROOT,
            attestation,
            currentBuild,
          });
          const expectedIdentity = projectRuntimeBuildIdentities(attestation).find(
            (identity) => identity.consumer_role === spec.consumerRole,
          );
          const storedIdentity: unknown = JSON.parse(
            nodeWorkspaceBuildFilesystem.readText(identityPath(role)),
          );
          return !expectedIdentity || !isDeepStrictEqual(storedIdentity, expectedIdentity);
        } catch {
          return true;
        }
      });
    } catch {
      return [...roles];
    }
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    if (this.#activeTool) signalProcessGroup(this.#activeTool, "SIGTERM");
    await this.stop(this.#specs.map((spec) => spec.name));
  }

  async #dryRun(filters: readonly string[]): Promise<TurboBuildDryRun> {
    const output = await this.#runTurbo(["run", "build", "--dry=json", ...filters], true);
    try {
      return parseTurboBuildDryRun(JSON.parse(output));
    } catch (error) {
      throw new Error(
        `DEV_WORKSPACE_BUILD_GRAPH_INVALID:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #runTurbo(args: readonly string[], captureOutput: boolean): Promise<string> {
    if (this.#activeTool) throw new Error("DEV_WORKSPACE_BUILD_TOOL_BUSY");
    return new Promise<string>((resolveCommand, rejectCommand) => {
      const child = spawn("pnpm", ["turbo", ...args], {
        cwd: REPOSITORY_ROOT,
        detached: true,
        env: this.#environment,
        stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
      });
      this.#activeTool = child;
      let stdout = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (this.#activeTool === child) this.#activeTool = undefined;
        if (error) rejectCommand(error);
        else resolveCommand(stdout);
      };
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        if (code === 0) finish();
        else finish(new Error(`DEV_WORKSPACE_BUILD_FAILED:${code ?? signal ?? "unknown"}`));
      });
    });
  }
}

class LocalWorkspaceInputWatcher {
  readonly #adapter: LocalWorkspaceBuildAdapter;
  readonly #roles: readonly LocalApplicationProcessSpec["name"][];
  readonly #onInvalidation: (roles: readonly LocalApplicationProcessSpec["name"][]) => void;
  #watchers: FSWatcher[] = [];

  constructor(
    adapter: LocalWorkspaceBuildAdapter,
    roles: readonly LocalApplicationProcessSpec["name"][],
    onInvalidation: (roles: readonly LocalApplicationProcessSpec["name"][]) => void,
  ) {
    this.#adapter = adapter;
    this.#roles = roles;
    this.#onInvalidation = onInvalidation;
  }

  refresh(): void {
    this.close();
    const watchedPaths = new Set<string>();
    const addWatcher = (path: string, recursive: boolean, invalidate: () => void): void => {
      if (!existsSync(path) || watchedPaths.has(path)) return;
      watchedPaths.add(path);
      this.#watchers.push(
        watch(path, { recursive }, () => {
          invalidate();
        }),
      );
    };

    for (const module of this.#adapter.watchedDependencyModules()) {
      const invalidateModule = () => {
        this.#onInvalidation(this.#adapter.impactedConsumers([module.name]));
      };
      addWatcher(resolve(module.absolutePath, "src"), true, invalidateModule);
      addWatcher(resolve(module.absolutePath, "package.json"), false, () => {
        this.#onInvalidation(this.#roles);
      });
      for (const file of ["tsconfig.json", "tsconfig.build.json"]) {
        addWatcher(resolve(module.absolutePath, file), false, invalidateModule);
      }
    }

    for (const module of this.#adapter.watchedConsumerModules()) {
      addWatcher(resolve(module.absolutePath, "package.json"), false, () => {
        this.#onInvalidation(this.#roles);
      });
    }

    const invalidateGraph = () => {
      this.#onInvalidation(this.#roles);
    };
    for (const file of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "turbo.json",
      "tsconfig.base.json",
    ]) {
      addWatcher(resolve(REPOSITORY_ROOT, file), false, invalidateGraph);
    }
  }

  close(): void {
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers = [];
  }
}

function runCommand(command: string, args: readonly string[], environment = process.env): void {
  const result = spawnSync(command, [...args], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`COMMAND_FAILED:${command}:${result.status ?? "signal"}`);
  }
}

function runOptionalLocalSuperadminSync(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!isLocalSuperadminSyncEnabled(environment)) return environment;
  const result = spawnSync("pnpm", ["exec", "tsx", "apps/web/src/cli/local-superadmin-sync.ts"], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  let parsed: LocalSuperadminSyncResult;
  try {
    parsed = JSON.parse(result.stdout) as LocalSuperadminSyncResult;
  } catch {
    throw new Error("DEV_SUPERADMIN_SYNC_RESULT_INVALID");
  }
  if (result.status !== 0 || parsed.terminal !== "SUCCEEDED") {
    throw new Error(parsed.reason_code || "DEV_SUPERADMIN_SYNC_FAILED");
  }
  console.info(`Local superadmin sync: ${parsed.reason_code}`);
  return applyLocalSuperadminAuthority(environment, parsed);
}

interface ComposeContainerState {
  readonly Service?: string;
  readonly State?: string;
  readonly Health?: string;
}

function parseJsonLines<T>(value: string): readonly T[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function assertDatabaseContainersHealthy(): void {
  const output = execFileSync(
    "docker",
    ["compose", "ps", "--format", "json", "postgres", "neo4j"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  const states = parseJsonLines<ComposeContainerState>(output);
  for (const service of ["postgres", "neo4j"] as const) {
    const state = states.find((candidate) => candidate.Service === service);
    if (state?.State !== "running" || state.Health !== "healthy") {
      throw new Error(`DEV_DATABASE_NOT_HEALTHY:${service}`);
    }
  }
}

interface ExpectedMigration {
  readonly owner_kind: "platform" | "app";
  readonly app_id: string | null;
  readonly migration_version: string;
  readonly migration_checksum: string;
}

interface VerifiedMigrationRuntimeFact {
  readonly migration_ready: true;
  readonly migration_frontier: `sha256:${string}`;
}

const MIGRATION_CALL_PATTERN =
  /platform\.assert_migration_checksum\(\s*'(platform|app)'\s*,\s*(null|'([0-9a-f-]{36})'::uuid)\s*,\s*'([0-9]{14}_[a-z][a-z0-9_]{1,96})'\s*,\s*'(sha256:[0-9a-f]{64})'\s*\)/g;

export function readExpectedMigrations(
  repositoryRoot: string = REPOSITORY_ROOT,
): readonly ExpectedMigration[] {
  const directories = [
    resolve(repositoryRoot, "infra/supabase/platform/migrations"),
    resolve(repositoryRoot, "infra/supabase/apps/data-agent/migrations"),
  ];
  const migrations: ExpectedMigration[] = [];
  for (const directory of directories) {
    for (const filename of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const source = readFileSync(resolve(directory, filename), "utf8");
      const matches = [...source.matchAll(MIGRATION_CALL_PATTERN)];
      if (matches.length !== 1) {
        throw new Error(`MIGRATION_LEDGER_DECLARATION_INVALID:${filename}:${matches.length}`);
      }
      const match = matches[0];
      const ownerKind = match?.[1];
      const migrationVersion = match?.[4];
      const migrationChecksum = match?.[5];
      if (
        (ownerKind !== "platform" && ownerKind !== "app") ||
        !migrationVersion ||
        !migrationChecksum ||
        `${migrationVersion}.sql` !== filename
      ) {
        throw new Error(`MIGRATION_LEDGER_DECLARATION_INVALID:${filename}`);
      }
      migrations.push({
        owner_kind: ownerKind,
        app_id: ownerKind === "app" ? (match?.[3] ?? null) : null,
        migration_version: migrationVersion,
        migration_checksum: migrationChecksum,
      });
    }
  }
  return migrations;
}

function readMigrationLedger(): Map<string, string> {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-A",
      "-t",
      "-F",
      "|",
      "-U",
      "postgres",
      "-d",
      "data_agent",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "select owner_kind, coalesce(app_id::text, ''), migration_version, migration_checksum from platform.migration_ledger order by owner_kind, app_id, migration_version",
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  const ledger = new Map<string, string>();
  for (const line of output
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [ownerKind, appId, version, checksum] = line.split("|");
    if (!ownerKind || appId === undefined || !version || !checksum) {
      throw new Error("MIGRATION_LEDGER_RESULT_INVALID");
    }
    ledger.set(`${ownerKind}|${appId}|${version}`, checksum);
  }
  return ledger;
}

function assertMigrationLedgerCurrent(): VerifiedMigrationRuntimeFact {
  const expected = readExpectedMigrations();
  const ledger = readMigrationLedger();
  const failures: string[] = [];
  for (const migration of expected) {
    const key = `${migration.owner_kind}|${migration.app_id ?? ""}|${migration.migration_version}`;
    const actual = ledger.get(key);
    if (actual !== migration.migration_checksum) {
      failures.push(`${migration.migration_version}:${actual ? "CHECKSUM_MISMATCH" : "MISSING"}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`DEV_MIGRATIONS_NOT_READY:${failures.join(",")}\nRun: pnpm dev:migrate`);
  }
  return {
    migration_ready: true,
    migration_frontier: `sha256:${createHash("sha256")
      .update(
        JSON.stringify([...ledger.entries()].sort(([left], [right]) => left.localeCompare(right))),
      )
      .digest("hex")}`,
  };
}

function assertAuthorityMapping(environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-A",
      "-t",
      "-U",
      "postgres",
      "-d",
      "data_agent",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `deployment_id=${environment.WORKER_DEPLOYMENT_ID ?? ""}`,
      "-v",
      `tenant_id=${environment.WORKER_TENANT_ID ?? ""}`,
      "-v",
      `principal_id=${environment.WORKER_PRINCIPAL_ID ?? ""}`,
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      input:
        "select count(*) from platform.resolve_backend_authority(:'deployment_id'::uuid, :'tenant_id'::uuid, :'principal_id'::uuid, true);\n",
    },
  );
  if (result.status !== 0 || result.stdout.trim() !== "1") {
    throw new Error("DEV_AUTHORITY_MAPPING_NOT_READY");
  }
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise<boolean>((resolvePort) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolvePort(listening);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function assertApplicationPortsFree(): Promise<void> {
  for (const [name, port] of [
    ["web", 3000],
    ["relationship-indexer", 9090],
    ["worker", 9091],
  ] as const) {
    if (await isPortListening(port)) {
      throw new Error(`DEV_PORT_IN_USE:${name}:${port}`);
    }
  }
}

function assertNoExistingNextDevelopmentProcess(): void {
  const lockPath = resolve(REPOSITORY_ROOT, "apps/web/.next/dev/lock");
  if (!existsSync(lockPath)) return;
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      readonly pid?: unknown;
      readonly port?: unknown;
    };
    if (!Number.isSafeInteger(lock.pid) || Number(lock.pid) <= 0) return;
    try {
      process.kill(Number(lock.pid), 0);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ESRCH"
      ) {
        return;
      }
      throw error;
    }
    throw new Error(`DEV_NEXT_PROCESS_ALREADY_RUNNING:${String(lock.pid)}:${String(lock.port)}`);
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
}

async function runDevelopmentCheck(
  environment: NodeJS.ProcessEnv,
): Promise<VerifiedMigrationRuntimeFact> {
  assertDatabaseContainersHealthy();
  const migrationFact = assertMigrationLedgerCurrent();
  assertAuthorityMapping(environment);
  assertNoExistingNextDevelopmentProcess();
  await assertApplicationPortsFree();
  console.info("Development readiness passed: databases, migrations, authority, and ports.");
  return migrationFact;
}

async function superviseApplications(
  specs: readonly LocalApplicationProcessSpec[],
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  let exitCode = 0;
  let finishing = false;
  let finishRun: (() => void) | undefined;
  let watcher: LocalWorkspaceInputWatcher | undefined;
  let coordinator:
    | RecoverableWorkspaceBuildCoordinator<
        LocalApplicationProcessSpec["name"],
        PreparedLocalWorkspaceGeneration
      >
    | undefined;
  const adapter = new LocalWorkspaceBuildAdapter(
    specs,
    environment,
    (name, code, signal) => {
      console.error(
        `Local application ${name} exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "none"}`,
      );
      exitCode = code && code > 0 ? code : 1;
      void finish();
    },
    () => watcher?.refresh(),
  );
  coordinator = new RecoverableWorkspaceBuildCoordinator(
    specs.map((spec) => spec.name),
    adapter,
  );
  watcher = new LocalWorkspaceInputWatcher(
    adapter,
    specs.map((spec) => spec.name),
    (roles) => {
      void coordinator?.invalidate(roles);
    },
  );

  let auditRunning = false;
  const audit = setInterval(() => {
    if (auditRunning || coordinator?.state !== "running") return;
    auditRunning = true;
    void adapter
      .auditRunning()
      .then((staleRoles) => coordinator?.invalidate(staleRoles))
      .finally(() => {
        auditRunning = false;
      });
  }, 2_000);

  const finishPromise = new Promise<void>((resolveRun) => {
    finishRun = () => resolveRun();
  });
  async function finish(): Promise<void> {
    if (finishing) return;
    finishing = true;
    clearInterval(audit);
    watcher?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGUSR2", retry);
    await coordinator?.shutdown();
    finishRun?.();
  }
  const stop = () => {
    void finish();
  };
  const retry = () => {
    void coordinator?.retry();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.on("SIGUSR2", retry);
  watcher.refresh();

  try {
    await coordinator.start();
    await finishPromise;
    return exitCode;
  } finally {
    await finish();
  }
}

async function assertWorkspaceBuildReadiness(
  specs: readonly LocalApplicationProcessSpec[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const adapter = new LocalWorkspaceBuildAdapter(specs, environment, () => undefined);
  try {
    const stale = await adapter.auditRoles(specs.map((spec) => spec.name));
    if (stale.length > 0) {
      throw new Error(`DEV_WORKSPACE_BUILD_NOT_READY:${stale.join(",")}`);
    }
  } finally {
    await adapter.shutdown();
  }
}

async function refreshWorkspaceBuildReadiness(
  specs: readonly LocalApplicationProcessSpec[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const adapter = new LocalWorkspaceBuildAdapter(specs, environment, () => undefined);
  try {
    const roles = specs.map((spec) => spec.name);
    const generation = await adapter.prepare(roles);
    await adapter.accept(generation, roles);
    console.info(`Workspace build generation accepted: ${generation.attestation.generation_id}`);
  } finally {
    await adapter.shutdown();
  }
}

function selectApplicationSpecs(
  command: "apps" | LocalApplicationProcessSpec["name"],
): readonly LocalApplicationProcessSpec[] {
  const specs = buildLocalApplicationProcessSpecs();
  return command === "apps" ? specs : specs.filter((spec) => spec.name === command);
}

type RuntimeCommand =
  | "dev"
  | "build"
  | "infra"
  | "migrate"
  | "check"
  | "apps"
  | "web"
  | "worker"
  | "indexer"
  | "semantic-authoring"
  | "docker-migrate"
  | "docker-up"
  | "docker-down";

async function main(command: RuntimeCommand | undefined): Promise<number> {
  let environment = loadLocalDevelopmentEnvironment();
  switch (command) {
    case "infra":
      runCommand(
        "docker",
        ["compose", "--profile", "deploy", "stop", "web", "worker", "relationship-indexer"],
        environment,
      );
      runCommand(
        "docker",
        ["compose", "--profile", "deploy", "rm", "-f", "web", "worker", "relationship-indexer"],
        environment,
      );
      runCommand("docker", ["compose", "up", "-d", "--wait", "postgres", "neo4j"], environment);
      return 0;
    case "migrate":
      await main("infra");
      runCommand(
        "docker",
        ["compose", "--profile", "migrate", "run", "--rm", "migration"],
        environment,
      );
      assertMigrationLedgerCurrent();
      return 0;
    case "check":
      await runDevelopmentCheck(environment);
      await assertWorkspaceBuildReadiness(buildLocalApplicationProcessSpecs(), environment);
      console.info("Workspace build readiness passed for all managed consumers.");
      return 0;
    case "build":
      await refreshWorkspaceBuildReadiness(buildLocalApplicationProcessSpecs(), environment);
      return 0;
    case "dev": {
      await main("infra");
      // Admin sync depends on the newest governed SQL surface. Keep the
      // existing migration-ledger diagnostic ahead of any optional write so a
      // stale local database still receives the actionable migrate message.
      assertMigrationLedgerCurrent();
      environment = runOptionalLocalSuperadminSync(environment);
      const migrationFact = await runDevelopmentCheck(environment);
      environment = {
        ...environment,
        DATA_AGENT_MIGRATION_READY: String(migrationFact.migration_ready),
        DATA_AGENT_MIGRATION_FRONTIER: migrationFact.migration_frontier,
      };
      return superviseApplications(buildLocalApplicationProcessSpecs(), environment);
    }
    case "apps":
    case "web":
    case "worker":
    case "indexer":
    case "semantic-authoring":
      return superviseApplications(selectApplicationSpecs(command), environment);
    case "docker-migrate":
      runCommand("docker", ["compose", "up", "-d", "--wait", "postgres"], environment);
      runCommand(
        "docker",
        ["compose", "--profile", "migrate", "run", "--rm", "migration"],
        environment,
      );
      assertMigrationLedgerCurrent();
      return 0;
    case "docker-up":
      environment = injectDockerBuildProvenance(environment);
      runCommand(
        "docker",
        ["compose", "--profile", "deploy", "up", "--build", "-d", "--wait"],
        environment,
      );
      return 0;
    case "docker-down":
      runCommand("docker", ["compose", "--profile", "deploy", "down"], environment);
      return 0;
    default:
      console.error(
        "Usage: local-dev-runtime.ts <dev|build|infra|migrate|check|apps|web|worker|indexer|semantic-authoring|docker-migrate|docker-up|docker-down>",
      );
      return 2;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main(process.argv[2] as RuntimeCommand | undefined)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "LOCAL_RUNTIME_FAILED");
      process.exitCode = 1;
    });
}
